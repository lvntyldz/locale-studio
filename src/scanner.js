import { readdir, readFile } from 'fs/promises';
import { join, relative } from 'path';
import { PLURAL_SUFFIXES, REGEX_PATTERNS } from './constants.js';

// Capture group 1 is always the translation key.
// (?!\s*\+) rejects "NS." + key string-concat prefix inside wrapper definitions.
const KEY = `["'\`]([\\w.:/-]+)["'\`](?!\\s*\\+)`;

// The (?<![\w$.]) lookbehind is load-bearing: without it, `split(".")`,
// `format("2d")` etc. match the generic t( pattern via their trailing `t(`.
// Supports optional chaining e.g. t?.('key') or i18n?.t?.('key').
export const defaultPatterns = [
  `(?<![\\w$.])t(?:\\?\\.)?\\(\\s*[\\w$.]+\\s*,\\s*${KEY}`, // t?.(lang, "key") — lang-first helpers (Astro, custom)
  `(?<![\\w$.])t(?:\\?\\.)?\\(\\s*${KEY}`, // t?.("key") — i18next, react-i18next, Next
  `\\$t(?:\\?\\.)?\\(\\s*${KEY}`, // $t?.("key") — Vue / Nuxt
  `i18n(?:\\?\\.)?t(?:\\?\\.)?\\(\\s*${KEY}`, // i18n?.t?.("key") — vue-i18n explicit
  `(?<![\\w$.])translate(?:\\?\\.)?\\(\\s*${KEY}`, // translate?.("key") — generic
  `${KEY}\\s*\\|\\s*translate`, // 'key' | translate — Angular template pipe
];

// Call sites that should have matched a static pattern. Any that didn't is a
// dynamic key (t(`item_${i}`), t(lang, key)) — the unused list can't see those.
const CALL_SITE =
  /(?:(?<![\w$.])(?<!function )\$?t(?:\\?\\.)?|i18n(?:\\?\\.)?t(?:\\?\\.)?|(?<![\w$.])(?<!function )translate(?:\\?\\.)?)\(\s*(?=[\w$`])(?!["'])/g;

// Detects per-file namespace wrapper functions and useTranslation() bindings:
//   const NAME = (params) => func(`NS.${key}`)
//   const NAME = (params) => func("NS." + key)
//   const { t: ALIAS } = useTranslation('NS')
const WRAPPER_DEF =
  /const\s+(\w+)\s*=\s*(?:useCallback\s*\(\s*)?(?:\([^)=\n]{0,80}\)|[\w$]+)\s*(?::[^=>\n]{0,40})?\s*=>\s*([\w$]+)\(\s*(?:`([A-Z][A-Z0-9_]*)\.|"([A-Z][A-Z0-9_]*)\."\s*\+)/g;

const USE_TRANSLATION_ALIAS_DEF =
  /const\s+\{\s*t\s*:\s*(\w+)\s*\}\s*=\s*use(?:Translation|I18n)\s*\(\s*(?:['"`]([\w-]+)['"`]|\[\s*['"`]([\w-]+)['"`])/g;

function detectNamespaceWrappers(text) {
  const results = [];

  WRAPPER_DEF.lastIndex = 0;
  let m;
  while ((m = WRAPPER_DEF.exec(text))) {
    const prefix = m[3] || m[4];
    if (prefix) results.push({ name: m[1], callee: m[2], prefix, range: [m.index, m.index + m[0].length] });
  }

  USE_TRANSLATION_ALIAS_DEF.lastIndex = 0;
  let tm;
  while ((tm = USE_TRANSLATION_ALIAS_DEF.exec(text))) {
    const name = tm[1];
    const prefix = tm[2] || tm[3];
    if (name && prefix) {
      results.push({ name, callee: 'useTranslation', prefix, range: [tm.index, tm.index + tm[0].length] });
    }
  }

  return results;
}

// A wrapper candidate is trusted when its inner callee is demonstrably i18n:
// either a canonical name (t, $t, translate, i18n) or aliased from
// useTranslation()/useI18n() in the same file.
function isI18nCallee(callee, text) {
  if (/^(\$?t|translate|i18n|useTranslation)$/.test(callee)) return true;
  const safe = callee.replace(/\$/g, '\\$');
  return new RegExp(`\\bt\\s*:\\s*${safe}\\b`).test(text) && /\buse(Translation|I18n)\s*\(/.test(text);
}

export async function scan({ scanDir, patterns = ['auto'], extensions, ignore, knownKeys }, cwd = process.cwd()) {
  const sources = patterns.flatMap((p) => (p === 'auto' ? defaultPatterns : [p]));
  const regexes = sources.map((p) => new RegExp(p, 'g'));
  const files = await walkFiles(scanDir, extensions, ignore);

  // Ground truth for wrapper validation: only namespaces that actually exist in
  // the JSON files are trusted. Rejects lookalikes (`const log = s => f(`FATAL.${s}`)`).
  const knownNamespaces = knownKeys
    ? new Set([...knownKeys].filter((k) => k.includes('.')).map((k) => k.slice(0, k.indexOf('.'))))
    : null;

  // Build lookup table from bare sub-key / full key to known JSON keys for detecting string literals
  const knownBareToFull = new Map();
  if (knownKeys) {
    for (const fullKey of knownKeys) {
      const colonIdx = fullKey.indexOf(':');
      if (colonIdx !== -1) {
        const bareKey = fullKey.slice(colonIdx + 1);
        if (bareKey.includes('.')) {
          if (!knownBareToFull.has(bareKey)) knownBareToFull.set(bareKey, []);
          knownBareToFull.get(bareKey).push(fullKey);
        }
      }
      if (!knownBareToFull.has(fullKey)) knownBareToFull.set(fullKey, []);
      knownBareToFull.get(fullKey).push(fullKey);
    }
  }

  const used = new Map();
  const dynamicCalls = [];

  for (const file of files) {
    const text = await readFile(file, 'utf8');
    const rel = relative(cwd, file);
    const lineAt = makeLineLookup(text);
    const staticAt = new Set();

    // Namespace wrapper & useTranslation alias pre-pass:
    // e.g. const { t: tProfile } = useTranslation('profile') -> tProfile("menu.couponss") resolves to profile:menu.couponss
    const candidates = detectNamespaceWrappers(text);
    const candidateRanges = candidates.map((c) => c.range).filter(Boolean);
    const inDef = (idx, ranges) => ranges.some(([s, e]) => idx >= s && idx < e);
    const wrapperPositions = new Set();
    const dynAt = new Set();
    const defRanges = [];
    for (const { name, callee, prefix, range } of candidates) {
      if (knownNamespaces && !knownNamespaces.has(prefix) && !isI18nCallee(callee, text)) continue;
      if (range) defRanges.push(range);
      const safeN = name.replace(/\$/g, '\\$');
      const wre = new RegExp(`(?<![\\w$.])${safeN}(?:\\?\\.)?\\(\\s*["'\`]([\\w.-]+)["'\`]`, 'g');
      let wm;
      while ((wm = wre.exec(text))) {
        wrapperPositions.add(wm.index);
        staticAt.add(wm.index);
        const rawKey = wm[1];
        let fullKey;
        if (rawKey.includes(':')) {
          fullKey = rawKey;
        } else if (name !== 't' && prefix) {
          fullKey = (prefix.includes(':') || prefix.includes('.')) ? `${prefix}.${rawKey}` : `${prefix}:${rawKey}`;
        } else {
          fullKey = rawKey;
        }
        if (!used.has(fullKey)) used.set(fullKey, []);
        used.get(fullKey).push({ file: rel, line: lineAt(wm.index) });
        if (wm.index === wre.lastIndex) wre.lastIndex++;
      }
      // Non-literal args to a wrapper (t(variable), t(`X_${i}`)) are dynamic keys.
      const wdyn = new RegExp(`(?<![\\w$.])${safeN}(?:\\?\\.)?\\(\\s*(?=[\\w$\`])(?!["'])`, 'g');
      let dm;
      while ((dm = wdyn.exec(text))) {
        if (dynAt.has(dm.index)) continue;
        if (inDef(dm.index, candidateRanges)) continue;
        dynAt.add(dm.index);
        dynamicCalls.push({ file: rel, line: lineAt(dm.index) });
      }
    }

    for (const re of regexes) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) {
        if (wrapperPositions.has(m.index)) {
          if (m.index === re.lastIndex) re.lastIndex++;
          continue; // already resolved as namespace.KEY above
        }
        staticAt.add(m.index);
        const key = m[1];
        if (!used.has(key)) used.set(key, []);
        used.get(key).push({ file: rel, line: lineAt(m.index) });
        if (m.index === re.lastIndex) re.lastIndex++;
      }
    }

    // Dynamic key discovery: t(variable), t(`item_${i}`)
    CALL_SITE.lastIndex = 0;
    let cm;
    while ((cm = CALL_SITE.exec(text))) {
      if (staticAt.has(cm.index) || dynAt.has(cm.index)) {
        if (cm.index === CALL_SITE.lastIndex) CALL_SITE.lastIndex++;
        continue;
      }
      if (inDef(cm.index, defRanges)) {
        if (cm.index === CALL_SITE.lastIndex) CALL_SITE.lastIndex++;
        continue;
      }

      // Check if this dynamic call has a literal prefix e.g. t(`status.${state}`) or t("status." + s)
      const sub = text.slice(cm.index);
      const lm = sub.match(/^(?:(?<![\w$.])(?<!function )\$?t(?:\\?\\.)?|i18n(?:\\?\\.)?t(?:\\?\\.)?|(?<![\w$.])(?<!function )translate(?:\\?\\.)?)\(\s*(?:`([\w.:/-]+)\.\$\{)|(?:["'`\s]*([\w.:/-]+)\.["'`]\s*\+)/);
      if (lm) {
        const val = lm[1] || lm[2];
        if (!used.has(`__dynamic_prefix:${val}`)) used.set(`__dynamic_prefix:${val}`, []);
        used.get(`__dynamic_prefix:${val}`).push({ file: rel, line: lineAt(cm.index) });
      } else {
        dynamicCalls.push({ file: rel, line: lineAt(cm.index) });
      }

      if (cm.index === CALL_SITE.lastIndex) CALL_SITE.lastIndex++;
    }

    // Extract dynamic template literal prefixes (e.g. `prefix.${var}` or "prefix." + var)
    const DYN_PREFIX_RE = new RegExp(REGEX_PATTERNS.DYN_PREFIX.source, 'g');
    let pm;
    while ((pm = DYN_PREFIX_RE.exec(text))) {
      const p = pm[1] || pm[2];
      if (p && p.length > 1) {
        if (!used.has(`__dynamic_prefix:${p}`)) used.set(`__dynamic_prefix:${p}`, []);
        used.get(`__dynamic_prefix:${p}`).push({ file: rel, line: lineAt(pm.index) });
      }
    }

    // Bare key literal pass: finds string literals in code matching multi-segment known keys
    // e.g. label: 'validation.firstNameRequired' or 'themeModeSwitch.lightLabel'
    if (knownBareToFull.size > 0) {
      const BARE_LITERAL_RE = /["'\`]([\w.-]+\.[\w.-]+)["'\`]/g;
      let bm;
      while ((bm = BARE_LITERAL_RE.exec(text))) {
        const val = bm[1];
        if (knownBareToFull.has(val)) {
          staticAt.add(bm.index);
          const fullKeys = knownBareToFull.get(val);
          for (const fk of fullKeys) {
            if (!used.has(fk)) used.set(fk, []);
            used.get(fk).push({ file: rel, line: lineAt(bm.index) });
          }
        }
      }
    }
  }

  return { used, dynamicCalls, filesScanned: files.length };
}

function resolveKeyMatches(key, jsonKeys, knownNamespaces) {
  if (jsonKeys.has(key)) {
    return [key];
  }

  const directPlurals = PLURAL_SUFFIXES.map((suf) => key + suf).filter((k) => jsonKeys.has(k));
  if (directPlurals.length > 0) {
    return directPlurals;
  }

  if (!key.includes(':')) {
    const nsMatches = [];
    for (const ns of knownNamespaces) {
      const nsKey = `${ns}:${key}`;
      if (jsonKeys.has(nsKey)) {
        nsMatches.push(nsKey);
      }
      for (const suf of PLURAL_SUFFIXES) {
        const nsPluralKey = nsKey + suf;
        if (jsonKeys.has(nsPluralKey)) {
          nsMatches.push(nsPluralKey);
        }
      }
    }
    if (nsMatches.length > 0) {
      return nsMatches;
    }
  }

  return [];
}

// Cross-reference scan results against the flattened JSON keys.
export function computeAudit({ used, dynamicCalls, languages, keys }) {
  const jsonKeys = new Set(Object.keys(keys));
  const knownNamespaces = new Set();
  for (const k of jsonKeys) {
    const colonIdx = k.indexOf(':');
    if (colonIdx !== -1) {
      knownNamespaces.add(k.slice(0, colonIdx));
    }
  }

  const matchedJsonKeys = new Set();
  const missing = [];
  const dynamicPrefixes = new Set();

  for (const [key, refs] of used) {
    if (key.startsWith('__dynamic_prefix:')) {
      dynamicPrefixes.add(key.slice('__dynamic_prefix:'.length));
      continue;
    }
    const matches = resolveKeyMatches(key, jsonKeys, knownNamespaces);
    if (matches.length > 0) {
      for (const m of matches) {
        matchedJsonKeys.add(m);
      }
    } else {
      missing.push({ key, refs });
    }
  }

  // Dynamic prefix resolution pass for remaining JSON keys
  if (dynamicPrefixes.size > 0) {
    for (const k of jsonKeys) {
      if (matchedJsonKeys.has(k)) continue;
      const colonIdx = k.indexOf(':');
      const ns = colonIdx !== -1 ? k.slice(0, colonIdx) : '';
      const bareKey = colonIdx !== -1 ? k.slice(colonIdx + 1) : k;

      let isMatch = false;
      for (const p of dynamicPrefixes) {
        if (k.startsWith(p + '.') || bareKey.startsWith(p + '.') || k === p || bareKey === p) {
          isMatch = true;
          break;
        }
      }
      if (isMatch) {
        matchedJsonKeys.add(k);
      }
    }
  }

  const unused = [...jsonKeys].filter((k) => !matchedJsonKeys.has(k)).sort();
  const untranslated = computeUntranslated({ languages, keys, matchedJsonKeys });

  return { missing, unused, untranslated, dynamicCalls: dynamicCalls.length };
}

function computeUntranslated({ languages, keys, matchedJsonKeys }) {
  const untranslated = {};
  for (const lang of languages) {
    const missingForLang = [];
    for (const key of Object.keys(keys)) {
      if (!matchedJsonKeys.has(key)) continue;
      const val = keys[key][lang];
      if (val === undefined || val === '') {
        missingForLang.push(key);
      }
    }
    if (missingForLang.length > 0) {
      untranslated[lang] = missingForLang.sort();
    }
  }
  return untranslated;
}

export async function walkFiles(dir, extensions, ignorePatterns = []) {
  const extSet = new Set(extensions);
  const ignoreRes = ignorePatterns.map((p) => new RegExp(p.replace(/\./g, '\\.').replace(/\*/g, '.*')));
  const files = [];

  async function walk(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (ignoreRes.some((re) => re.test(full) || re.test(entry.name))) continue;
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        const dotIdx = entry.name.lastIndexOf('.');
        const ext = dotIdx !== -1 ? entry.name.slice(dotIdx) : '';
        if (extSet.has(ext)) files.push(full);
      }
    }
  }

  await walk(dir);
  return files.sort();
}

function makeLineLookup(text) {
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') lineStarts.push(i + 1);
  }
  return (offset) => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (lineStarts[mid] <= offset) low = mid + 1;
      else high = mid - 1;
    }
    return high + 1;
  };
}
