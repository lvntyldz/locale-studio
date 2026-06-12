#!/usr/bin/env node
import { startServer } from '../src/server.js'
import { resolve } from 'path'

const args = process.argv.slice(2)

function getArg(flag, def) {
  const i = args.indexOf(flag)
  return i !== -1 && args[i + 1] ? args[i + 1] : def
}

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
  json-i18n-editor — Edit your JSON translation files in a browser

  Usage:
    npx json-i18n-editor [options]

  Options:
    --dir <path>    Path to messages folder (default: ./messages)
    --port <port>   Port to listen on (default: 3737)
    --help          Show this help

  Examples:
    npx json-i18n-editor
    npx json-i18n-editor --dir ./src/i18n/messages
    npx json-i18n-editor --dir ./locales --port 4000
  `)
  process.exit(0)
}

const dir = resolve(process.cwd(), getArg('--dir', 'messages'))
const port = parseInt(getArg('--port', '3737'), 10)

startServer({ dir, port })
