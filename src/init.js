import { readdir, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, relative, resolve } from 'path';
import { defaultConfig } from './config.js';
import { scan, walkFiles } from './scanner.js';
import { loadMessages } from './server.js';

const LANG_FILE = /^[a-z]{2,3}([-_][A-Za-z]{2,4})?\.json$/;
const LANG_DIR = /^[a-z]{2,3}([-_][A-Za-z]{2,4})?$/;

// Directories never worth descending into while looking for locale files.
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  'vendor',
  'target',
  '.git',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.astro',
  '.output',
  '.vercel',
  '.netlify',
  '.cache',
  '.idea',
  '.vscode',
]);

// Framework markers in package.json dependencies → source extensions to scan.
const FRAMEWORKS = [
  [['astro'], ['.astro', '.ts', '.tsx', '.js', '.jsx']],
  [
    ['vue', 'nuxt'],
    ['.vue', '.ts', '.js'],
  ],
  [
    ['svelte', '@sveltejs/kit'],
    ['.svelte', '.ts', '.js'],
  ],
  [['@angular/core'], ['.ts', '.html']],
  [
    ['react', 'next', 'preact', 'solid-js'],
    ['.tsx', '.jsx', '.ts', '.js'],
  ],
];

// Identifiers that often take key-shaped string literals but are never i18n
// helpers. The known-keys check filters most noise; this is the safety net.
const BLOCKLIST = new Set([
  'if',
  'for',
  'while',
  'switch',
  'return',
  'typeof',
  'catch',
  'function',
  'includes',
  'startsWith',
  'endsWith',
  'indexOf',
  'lastIndexOf',
  'split',
  'replace',
  'replaceAll',
  'match',
  'exec',
  'test',
  'concat',
  'join',
  'push',
  'add',
  'has',
  'get',
  'set',
  'delete',
  'remove',
  'getItem',
  'setItem',
  'removeItem',
  'getAttribute',
  'setAttribute',
  'querySelector',
  'querySelectorAll',
  'getElementById',
  'getElementsByClassName',
  'closest',
  'contains',
  'find',
  'filter',
  'map',
  'some',
  'every',
  'emit',
  'on',
  'off',
  'once',
  'addEventListener',
  'removeEventListener',
  'dispatchEvent',
  'require',
  'import',
  'define',
  'fetch',
  'open',
  'send',
  'log',
  'warn',
  'error',
  'info',
  'debug',
  'assert',
  'expect',
  'describe',
  'it',
  'track',
]);

// Already covered by the default patterns — rediscovering them adds nothing.
const AUTO_COVERED = new Set(['t', '$t', 'translate']);

// ident( "key" ) or ident( firstArg, "key" ) — optionally method-style (.ident).
// Group 1: leading dot, 2: identifier, 3: lang-style first arg, 4: the key.
const DISCOVER = /(\.?)([A-Za-z_$][\w$]*)\s*\(\s*(?:([\w$.]+)\s*,\s*)?["'`]([\w.-]+)["'`]/g;

export async function runInit({ cwd = process.cwd(), dirArg = null, scanArg = null, force = false }) {
  const out = [];
  const configPath = join(cwd, 'i18n.scan.json');
  if (existsSync(configPath) && !force) {
    console.error(`\n  ❌  i18n.scan.json already exists. Edit it directly or re-run with --force to regenerate.\n`);
    process.exit(1);
  }

  // 1 — locales directory
  let localesDir = dirArg ? resolve(cwd, dirArg) : null;
  if (!localesDir) {
    const { candidates } = await findLocaleDirs(cwd);
    if (!candidates.length) {
      console.error(`\n  ❌  No locales directory found (looked for directories like en/, es/ containing JSON files).`);
      console.error(`      Run again with --dir <path>.\n`);
      process.exit(1);
    }
    localesDir = candidates[0].path;
    if (candidates.length > 1) {
      out.push(
        `  ·  Other locale dir candidates: ${candidates
          .slice(1, 4)
          .map((c) => relative(cwd, c.path))
          .join(', ')} — use --dir to override.`
      );
    }
  }
  const { languages, keys } = await loadMessages(localesDir);
  if (!languages.length) {
    console.error(`\n  ❌  No <lang>.json files in ${localesDir}. Run again with --dir <path>.\n`);
    process.exit(1);
  }
  const knownKeys = new Set(Object.keys(keys));

  // 2 — framework → extensions
  const { names: frameworks, extensions } = await detectFrameworks(cwd);

  // 3 — scan dir
  const scanDir = resolve(
    cwd,
    scanArg ?? (existsSync(join(cwd, 'src')) ? 'src' : existsSync(join(cwd, 'app')) ? 'app' : '.')
  );

  // 4 — baseline scan with auto patterns, then discover custom helpers
  const ignore = defaultConfig.ignore;
  const base = await scan({ scanDir, patterns: ['auto'], extensions, ignore, knownKeys }, cwd);
  const coveredKeys = new Set([...base.used.keys()].filter((k) => knownKeys.has(k)));
  const discovered = await discoverPatterns({ scanDir, extensions, ignore, knownKeys, coveredKeys });

  // 5 — write config + verify coverage with it
  const config = {
    dir: relative(cwd, localesDir),
    scanDir: relative(cwd, scanDir) || '.',
    extensions,
    patterns: ['auto', ...discovered.map((d) => d.pattern)],
    ignore,
  };
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');

  const final = await scan({ ...config, scanDir, knownKeys }, cwd);
  const usedKnown = [...final.used.keys()].filter((k) => knownKeys.has(k)).length;

  console.log(`\n  locale-studio init`);
  console.log(`  ─────────────────────────────────`);
  console.log(`  Locales:    ${relative(cwd, localesDir)}  (${languages.join(', ')} — ${knownKeys.size} keys)`);
  console.log(`  Framework:  ${frameworks.length ? frameworks.join(' + ') : 'unknown (using default extensions)'}`);
  console.log(
    `  Scan dir:   ${relative(cwd, scanDir) || '.'}  (${final.filesScanned} files, extensions ${extensions.join(' ')})`
  );
  for (const d of discovered) {
    console.log(
      `  Helper:     ${d.dotted ? '.' : ''}${d.name}(${d.langFirst ? 'lang, ' : ''}"key")  — found with ${d.keys.size} known keys → custom pattern added`
    );
  }
  for (const line of out) console.log(line);
  console.log(
    `\n  Coverage:   ${usedKnown}/${knownKeys.size} keys referenced from code (auto only: ${coveredKeys.size})`
  );
  console.log(`\n  ✅  Wrote i18n.scan.json`);
  console.log(`\n  Suggested package.json scripts:`);
  console.log(`      "i18n":       "locale-studio"`);
  console.log(`      "audit:i18n": "locale-studio audit"`);
  console.log(`\n  Next: run \x1b[36mlocale-studio audit\x1b[0m (exit 1 on missing keys — CI-ready)\n`);
}

export async function discoverPatterns({ scanDir, extensions, ignore, knownKeys, coveredKeys }) {
  const files = await walkFiles(scanDir, extensions, ignore);
  const variants = new Map();

  for (const file of files) {
    const text = await readFile(file, 'utf8');
    DISCOVER.lastIndex = 0;
    let m;
    while ((m = DISCOVER.exec(text))) {
      const [, dot, name, firstArg, key] = m;
      if (!knownKeys.has(key)) continue;
      if (BLOCKLIST.has(name)) continue;
      if (!dot && AUTO_COVERED.has(name)) continue;
      const sig = `${dot}${name}|${firstArg ? 'lang' : 'key'}`;
      if (!variants.has(sig)) variants.set(sig, { dotted: !!dot, name, langFirst: !!firstArg, keys: new Set() });
      variants.get(sig).keys.add(key);
    }
  }

  // A helper qualifies if it hits ≥3 distinct known keys (kills coincidences)
  // and contributes at least one key the auto patterns didn't already cover.
  return [...variants.values()]
    .filter((v) => v.keys.size >= 3 && [...v.keys].some((k) => !coveredKeys.has(k)))
    .sort((a, b) => b.keys.size - a.keys.size)
    .map((v) => ({ ...v, pattern: patternFor(v) }));
}

function patternFor({ dotted, name, langFirst }) {
  const esc = name.replace(/\$/g, '\\$');
  const prefix = dotted ? '\\.' : '(?<![\\w$.])';
  const args = langFirst ? '\\s*[\\w$.]+\\s*,\\s*' : '\\s*';
  return `${prefix}${esc}\\(${args}["'\`]([\\w.-]+)["'\`]`;
}

async function detectFrameworks(cwd) {
  const pkgPath = join(cwd, 'package.json');
  if (!existsSync(pkgPath)) return { names: [], extensions: defaultConfig.extensions };
  let pkg;
  try {
    pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
  } catch {
    return { names: [], extensions: defaultConfig.extensions };
  }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const names = [];
  const exts = new Set();
  for (const [markers, extensions] of FRAMEWORKS) {
    if (markers.some((m) => deps[m])) {
      names.push(markers.find((m) => deps[m]));
      extensions.forEach((e) => exts.add(e));
    }
  }
  return exts.size ? { names, extensions: [...exts] } : { names, extensions: defaultConfig.extensions };
}

async function findLocaleDirs(cwd, maxDepth = 4) {
  const candidates = [];
  const queue = [{ dir: cwd, depth: 0 }];

  while (queue.length) {
    const { dir, depth } = queue.shift();
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    const langDirs = entries.filter((e) => e.isDirectory() && LANG_DIR.test(e.name));
    if (langDirs.length >= 1) {
      let hasJsonInSubdirs = false;
      const langs = [];
      for (const sub of langDirs) {
        try {
          const inner = await readdir(join(dir, sub.name));
          const jsonFiles = inner.filter((f) => f.endsWith('.json'));
          if (jsonFiles.length > 0) {
            hasJsonInSubdirs = true;
            langs.push(sub.name);
          }
        } catch {
          /* ignore */
        }
      }
      if (hasJsonInSubdirs) {
        candidates.push({ path: dir, depth, langs });
      }
    }

    if (depth < maxDepth) {
      for (const e of entries) {
        if (e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) {
          queue.push({ dir: join(dir, e.name), depth: depth + 1 });
        }
      }
    }
  }

  candidates.sort((a, b) => b.langs.length - a.langs.length || a.depth - b.depth || a.path.localeCompare(b.path));
  return { candidates, langDirLayouts: [] };
}
