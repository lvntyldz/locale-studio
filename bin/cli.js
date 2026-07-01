#!/usr/bin/env node
import { startServer, loadMessages } from '../src/server.js'
import { scan, computeAudit } from '../src/scanner.js'
import { resolveConfig } from '../src/config.js'
import { runInit } from '../src/init.js'
import { existsSync } from 'fs'
import { resolve } from 'path'

const argv = process.argv.slice(2)
const command = argv[0] && !argv[0].startsWith('-') ? argv.shift() : null
const args = argv
const COMMANDS = [null, 'audit', 'init']

function getArg(flag, def) {
  const i = args.indexOf(flag)
  return i !== -1 && args[i + 1] ? args[i + 1] : def
}

if (args.includes('--help') || args.includes('-h') || !COMMANDS.includes(command)) {
  console.log(`
  json-i18n-editor — Edit your JSON translation files in a browser

  Usage:
    npx json-i18n-editor [options]          Open the editor UI
    npx json-i18n-editor audit [options]    Audit keys in terminal (no browser)
    npx json-i18n-editor init [options]     Detect project setup, write i18n.scan.json

  Options:
    --dir <path>    Path to messages folder (default: "dir" from config, else ./messages)
    --port <port>   Port to listen on (default: 3737, UI mode only)
    --scan <path>   Source dir to scan for t() calls (default: from config or ./src)
    --force         init only: overwrite an existing i18n.scan.json
    --help          Show this help

  Audit exit codes:
    0  no missing keys
    1  keys used in code but absent from the JSON files (CI-friendly)

  init auto-detects: the locales folder (<lang>.json files), the framework
  (extensions to scan), and custom translation helpers — any function called
  with ≥3 of your existing keys as string literals gets a generated pattern.

  Config (first wins): i18n.scan.json in cwd, "json-i18n-editor" field in
  package.json, built-in defaults. Paths are relative to cwd.

  Examples:
    npx json-i18n-editor init
    npx json-i18n-editor
    npx json-i18n-editor audit
    npx json-i18n-editor audit --dir ./src/i18n/locales --scan ./src
  `)
  process.exit(!COMMANDS.includes(command) ? 1 : 0)
}

const cfg = await resolveConfig()
const dirArg = getArg('--dir', null)
const dir = resolve(process.cwd(), dirArg ?? cfg.dir ?? 'messages')
const port = parseInt(getArg('--port', '3737'), 10)
const scanArg = getArg('--scan', null)

if (command === 'audit') {
  await runAudit()
} else if (command === 'init') {
  await runInit({ dirArg, scanArg, force: args.includes('--force') })
} else {
  startServer({ dir, port, scanDir: scanArg })
}

async function runAudit() {
  if (!existsSync(dir)) {
    console.error(`\n  ❌  Messages directory not found: ${dir}`)
    console.error(`      Run \x1b[36mjson-i18n-editor init\x1b[0m to auto-detect it, or pass --dir <path>.\n`)
    process.exit(1)
  }
  const scanDir = resolve(process.cwd(), scanArg ?? cfg.scanDir)
  if (!existsSync(scanDir)) {
    console.error(`\n  ❌  Scan directory not found: ${scanDir}`)
    console.error(`      Set "scanDir" in i18n.scan.json or run with --scan <dir>.\n`)
    process.exit(1)
  }

  const { languages, keys } = await loadMessages(dir)
  const { used, dynamicCalls, filesScanned } = await scan({ ...cfg, scanDir, knownKeys: new Set(Object.keys(keys)) })
  const { missing, unused, untranslated } = computeAudit({ used, dynamicCalls, languages, keys })

  console.log(`\n  json-i18n-editor audit`)
  console.log(`  ─────────────────────────────────`)
  console.log(`  Scanned ${filesScanned} files in ${scanDir}`)
  console.log(`  ${Object.keys(keys).length} keys · ${languages.join(', ')}\n`)

  if (missing.length) {
    const pad = Math.max(...missing.map(m => m.key.length))
    console.log(`  ❌  ${missing.length} missing key${missing.length !== 1 ? 's' : ''} (used in code, not in any JSON):`)
    for (const { key, refs } of missing) {
      console.log(`      \x1b[31m${key.padEnd(pad)}\x1b[0m  ${refs.map(r => `${r.file}:${r.line}`).join(', ')}`)
    }
    console.log()
  } else {
    console.log(`  ✅  No missing keys — every t() call has a JSON entry.\n`)
  }

  if (unused.length) {
    console.log(`  ⚠   ${unused.length} unused key${unused.length !== 1 ? 's' : ''} (in JSON, never used in code):`)
    for (const key of unused) console.log(`      \x1b[33m${key}\x1b[0m`)
    console.log()
  }

  if (dynamicCalls.length) {
    console.log(`  ⚠   ${dynamicCalls.length} dynamic key call${dynamicCalls.length !== 1 ? 's' : ''} — the unused list may be incomplete:`)
    for (const { file, line } of dynamicCalls) console.log(`      ${file}:${line}`)
    console.log()
  }

  for (const [lang, list] of Object.entries(untranslated)) {
    console.log(`  ⚠   ${lang}: ${list.length} untranslated key${list.length !== 1 ? 's' : ''} (${list.slice(0, 5).join(', ')}${list.length > 5 ? ', …' : ''})`)
  }
  if (Object.keys(untranslated).length) console.log()

  if (cfg.configSource === 'defaults' && unused.length >= 10) {
    console.log(`  💡  Many unused keys and no config found — if this project uses a custom`)
    console.log(`      translation helper, run \x1b[36mjson-i18n-editor init\x1b[0m to auto-detect it.\n`)
  }

  process.exit(missing.length ? 1 : 0)
}
