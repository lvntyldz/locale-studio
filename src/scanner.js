import { readdir, readFile } from 'fs/promises';
import { join, relative } from 'path';

// Capture group 1 is always the translation key.
// (?!\s*\+) rejects "NS." + key string-concat prefix inside wrapper definitions.
const KEY = `["'\`]([\\w.-]+)["'\`](?!\\s*\\+)`;

// The (?<![\w$.]) lookbehind is load-bearing: without it, `split(".")`,
// `format("2d")` etc. match the generic t( pattern via their trailing `t(`.
export const defaultPatterns = [
  `(?<![\\w$.])t\\(\\s*[\\w$.]+\\s*,\\s*${KEY}`, // t(lang, "key") — lang-first helpers (Astro, custom)
  `(?<![\\w$.])t\\(\\s*${KEY}`, // t("key") — i18next, react-i18next, Next
  `\\$t\\(\\s*${KEY}`, // $t("key") — Vue / Nuxt
  `i18n\\.t\\(\\s*${KEY}`, // i18n.t("key") — vue-i18n explicit
  `(?<![\\w$.])translate\\(\\s*${KEY}`, // translate("key") — generic
  `${KEY}\\s*\\|\\s*translate`, // 'key' | translate — Angular template pipe
];

// Call sites that should have matched a static pattern. Any that didn't is a
// dynamic key (t(`item_${i}`), t(lang, key)) — the unused list can't see those.
// The first arg must start like an identifier or template literal: this skips
// CSS transform translate(-50%, …) and empty/numeric calls. `(?<!function )`
// skips the t()/translate() function definitions themselves.
const CALL_SITE =
  /(?:(?<![\w$.])(?<!function )\$?t|i18n\.t|(?<![\w$.])(?<!function )translate)\(\s*(?=[\w$`])(?!["'])/g;

// Detects per-file namespace wrapper functions of the form:
//   const NAME = (params) => func(`NS.${key}`)
//   const NAME = (params) => func("NS." + key)
//   const NAME = useCallback((params) => func(`NS.${key}`), [...])
// Group 1: wrapper name, Group 2: inner callee, Group 3/4: namespace (template / concat)
const WRAPPER_DEF =
  /const\s+(\w+)\s*=\s*(?:useCallback\s*\(\s*)?(?:\([^)=\n]{0,80}\)|[\w$]+)\s*(?::[^=>\n]{0,40})?\s*=>\s*([\w$]+)\(\s*(?:`([A-Z][A-Z0-9_]*)\.|"([A-Z][A-Z0-9_]*)\."\s*\+)/g;

function detectNamespaceWrappers(text) {
  WRAPPER_DEF.lastIndex = 0;
  const results = [];
  let m;
  while ((m = WRAPPER_DEF.exec(text))) {
    const prefix = m[3] || m[4];
    if (prefix) results.push({ name: m[1], callee: m[2], prefix, range: [m.index, m.index + m[0].length] });
  }
  return results;
}

// A wrapper candidate is trusted when its inner callee is demonstrably i18n:
// either a canonical name (t, $t, translate, i18n) or aliased from
// useTranslation()/useI18n() in the same file (const { t: translation } = useTranslation()).
function isI18nCallee(callee, text) {
  if (/^(\$?t|translate|i18n)$/.test(callee)) return true;
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

  const used = new Map();
  const dynamicCalls = [];

  for (const file of files) {
    const text = await readFile(file, 'utf8');
    const rel = relative(cwd, file);
    const lineAt = makeLineLookup(text);
    const staticAt = new Set();

    // Namespace wrapper pre-pass: const t = (key) => base(`NS.${key}`)
    // Resolves t("KEY") as NS.KEY before the generic auto patterns run.
    // A wrapper is accepted if its namespace exists in the JSON files, or its
    // callee is provably i18n (covers brand-new namespaces with no keys yet).
    // Rejected candidates fall through to the generic patterns untouched.
    const candidates = detectNamespaceWrappers(text);
    const candidateRanges = candidates.map((c) => c.range);
    const inDef = (idx, ranges) => ranges.some(([s, e]) => idx >= s && idx < e);
    const wrapperPositions = new Set();
    const dynAt = new Set();
    const defRanges = [];
    for (const { name, callee, prefix, range } of candidates) {
      if (knownNamespaces && !knownNamespaces.has(prefix) && !isI18nCallee(callee, text)) continue;
      defRanges.push(range);
      const safeN = name.replace(/\$/g, '\\$');
      const wre = new RegExp(`(?<![\\w$.])${safeN}\\(\\s*["'\`]([\\w.-]+)["'\`]`, 'g');
      let wm;
      while ((wm = wre.exec(text))) {
        wrapperPositions.add(wm.index);
        staticAt.add(wm.index);
        const fullKey = `${prefix}.${wm[1]}`;
        if (!used.has(fullKey)) used.set(fullKey, []);
        used.get(fullKey).push({ file: rel, line: lineAt(wm.index) });
        if (wm.index === wre.lastIndex) wre.lastIndex++;
      }
      // Non-literal args to a wrapper (t(variable), t(`X_${i}`)) are dynamic keys.
      const wdyn = new RegExp(`(?<![\\w$.])${safeN}\\(\\s*(?=[\\w$\`])(?!["'])`, 'g');
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

    CALL_SITE.lastIndex = 0;
    let m;
    while ((m = CALL_SITE.exec(text))) {
      if (staticAt.has(m.index) || dynAt.has(m.index)) continue;
      // Skip calls inside an accepted wrapper definition (const t = (k) => base(`NS.${k}`))
      if (inDef(m.index, defRanges)) continue;
      dynamicCalls.push({ file: rel, line: lineAt(m.index) });
    }
  }

  return { used, dynamicCalls, filesScanned: files.length };
}

// Cross-reference scan results against the flattened JSON keys.
export function computeAudit({ used, dynamicCalls, languages, keys }) {
  const jsonKeys = new Set(Object.keys(keys));

  const missing = [...used]
    .filter(([key]) => !jsonKeys.has(key))
    .map(([key, refs]) => ({ key, refs }))
    .sort((a, b) => a.key.localeCompare(b.key));

  const unused = [...jsonKeys].filter((k) => !used.has(k)).sort();

  const untranslated = {};
  for (const lang of languages) {
    const list = Object.keys(keys).filter((k) => !(keys[k][lang] ?? '').trim());
    if (list.length) untranslated[lang] = list.sort();
  }

  return { missing, unused, untranslated, dynamicCalls };
}

export async function walkFiles(dir, extensions, ignore, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (ignore.some((p) => full.includes(p))) continue;
    if (e.isDirectory()) await walkFiles(full, extensions, ignore, out);
    else if (e.isFile() && extensions.some((ext) => e.name.endsWith(ext))) out.push(full);
  }
  return out;
}

function makeLineLookup(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') starts.push(i + 1);
  }
  return (idx) => {
    let lo = 0,
      hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= idx) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}
