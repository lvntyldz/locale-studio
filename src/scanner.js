import { readdir, readFile } from 'fs/promises'
import { join, relative } from 'path'

// Capture group 1 is always the translation key.
const KEY = `["'\`]([\\w.-]+)["'\`]`

// The (?<![\w$.]) lookbehind is load-bearing: without it, `split(".")`,
// `format("2d")` etc. match the generic t( pattern via their trailing `t(`.
export const defaultPatterns = [
  `(?<![\\w$.])t\\(\\s*[\\w$.]+\\s*,\\s*${KEY}`, // t(lang, "key") — lang-first helpers (Astro, custom)
  `(?<![\\w$.])t\\(\\s*${KEY}`,                  // t("key") — i18next, react-i18next, Next
  `\\$t\\(\\s*${KEY}`,                           // $t("key") — Vue / Nuxt
  `i18n\\.t\\(\\s*${KEY}`,                       // i18n.t("key") — vue-i18n explicit
  `(?<![\\w$.])translate\\(\\s*${KEY}`,          // translate("key") — generic
  `${KEY}\\s*\\|\\s*translate`,                  // 'key' | translate — Angular template pipe
]

// Call sites that should have matched a static pattern. Any that didn't is a
// dynamic key (t(`item_${i}`), t(lang, key)) — the unused list can't see those.
// The first arg must start like an identifier or template literal: this skips
// CSS transform translate(-50%, …) and empty/numeric calls. `(?<!function )`
// skips the t()/translate() function definitions themselves.
const CALL_SITE = /(?:(?<![\w$.])(?<!function )\$?t|i18n\.t|(?<![\w$.])(?<!function )translate)\(\s*(?=[\w$`])(?!["'])/g

export async function scan({ scanDir, patterns = ['auto'], extensions, ignore }, cwd = process.cwd()) {
  const sources = patterns.flatMap(p => p === 'auto' ? defaultPatterns : [p])
  const regexes = sources.map(p => new RegExp(p, 'g'))
  const files = await walkFiles(scanDir, extensions, ignore)

  const used = new Map()
  const dynamicCalls = []

  for (const file of files) {
    const text = await readFile(file, 'utf8')
    const rel = relative(cwd, file)
    const lineAt = makeLineLookup(text)
    const staticAt = new Set()

    for (const re of regexes) {
      re.lastIndex = 0
      let m
      while ((m = re.exec(text))) {
        staticAt.add(m.index)
        const key = m[1]
        if (!used.has(key)) used.set(key, [])
        used.get(key).push({ file: rel, line: lineAt(m.index) })
        if (m.index === re.lastIndex) re.lastIndex++
      }
    }

    CALL_SITE.lastIndex = 0
    let m
    while ((m = CALL_SITE.exec(text))) {
      if (!staticAt.has(m.index)) dynamicCalls.push({ file: rel, line: lineAt(m.index) })
    }
  }

  return { used, dynamicCalls, filesScanned: files.length }
}

// Cross-reference scan results against the flattened JSON keys.
export function computeAudit({ used, dynamicCalls, languages, keys }) {
  const jsonKeys = new Set(Object.keys(keys))

  const missing = [...used]
    .filter(([key]) => !jsonKeys.has(key))
    .map(([key, refs]) => ({ key, refs }))
    .sort((a, b) => a.key.localeCompare(b.key))

  const unused = [...jsonKeys].filter(k => !used.has(k)).sort()

  const untranslated = {}
  for (const lang of languages) {
    const list = Object.keys(keys).filter(k => !(keys[k][lang] ?? '').trim())
    if (list.length) untranslated[lang] = list.sort()
  }

  return { missing, unused, untranslated, dynamicCalls }
}

export async function walkFiles(dir, extensions, ignore, out = []) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const full = join(dir, e.name)
    if (ignore.some(p => full.includes(p))) continue
    if (e.isDirectory()) await walkFiles(full, extensions, ignore, out)
    else if (e.isFile() && extensions.some(ext => e.name.endsWith(ext))) out.push(full)
  }
  return out
}

function makeLineLookup(text) {
  const starts = [0]
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') starts.push(i + 1)
  }
  return idx => {
    let lo = 0, hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (starts[mid] <= idx) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }
}
