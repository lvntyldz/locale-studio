#!/usr/bin/env node
import { startServer, loadMessages } from '../src/server.js'
import { scan, computeAudit } from '../src/scanner.js'
import { resolveConfig } from '../src/config.js'
import { existsSync } from 'fs'
import { resolve } from 'path'

const argv = process.argv.slice(2)
const command = argv[0] && !argv[0].startsWith('-') ? argv.shift() : null
const args = argv

function getArg(flag, def) {
  const i = args.indexOf(flag)
  return i !== -1 && args[i + 1] ? args[i + 1] : def
}

if (args.includes('--help') || args.includes('-h') || (command && command !== 'audit')) {
  console.log(`
  json-i18n-editor — Edit your JSON translation files in a browser

  Usage:
    npx json-i18n-editor [options]          Open the editor UI
    npx json-i18n-editor audit [options]    Audit keys in terminal (no browser)

  Options:
    --dir <path>    Path to messages folder (default: ./messages)
    --port <port>   Port to listen on (default: 3737, UI mode only)
    --scan <path>   Source dir to scan for t() calls (default: from config or ./src)
    --help          Show this help

  Audit exit codes:
    0  no missing keys
    1  keys used in code but absent from the JSON files (CI-friendly)

  Config (first wins): i18n.scan.json in cwd, "json-i18n-editor" field in
  package.json, built-in defaults. Paths are relative to cwd.

  Examples:
    npx json-i18n-editor
    npx json-i18n-editor --dir ./src/i18n/messages
    npx json-i18n-editor audit --dir ./src/i18n/locales --scan ./src
  `)
  process.exit(command && command !== 'audit' ? 1 : 0)
}

const dir = resolve(process.cwd(), getArg('--dir', 'messages'))
const port = parseInt(getArg('--port', '3737'), 10)
const scanArg = getArg('--scan', null)

if (command === 'audit') {
  await runAudit()
} else {
  startServer({ dir, port, scanDir: scanArg })
}

async function runAudit() {
  if (!existsSync(dir)) {
    console.error(`\n  ❌  Messages directory not found: ${dir}\n`)
    process.exit(1)
  }
  const cfg = await resolveConfig()
  const scanDir = resolve(process.cwd(), scanArg ?? cfg.scanDir)
  if (!existsSync(scanDir)) {
    console.error(`\n  ❌  Scan directory not found: ${scanDir}`)
    console.error(`      Set "scanDir" in i18n.scan.json or run with --scan <dir>.\n`)
    process.exit(1)
  }

  const { used, dynamicCalls, filesScanned } = await scan({ ...cfg, scanDir })
  const { languages, keys } = await loadMessages(dir)
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

  process.exit(missing.length ? 1 : 0)
}
