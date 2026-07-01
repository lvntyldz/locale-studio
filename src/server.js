import { createServer } from 'http'
import { readdir, readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { exec } from 'child_process'
import { scan, computeAudit } from './scanner.js'
import { resolveConfig } from './config.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

export async function startServer({ dir, port, scanDir }) {
  if (!existsSync(dir)) {
    console.error(`\n  ❌  Directory not found: ${dir}`)
    console.error(`      Create it first or use --dir to specify the path.\n`)
    process.exit(1)
  }

  const uiHtml = await readFile(join(__dirname, 'ui.html'), 'utf8')

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`)

    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      return res.end(uiHtml)
    }

    if (url.pathname === '/api/messages' && req.method === 'GET') {
      try {
        const data = await loadMessages(dir)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ ...data, dir }))
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ error: e.message }))
      }
    }

    // Feature 1: round-trip — unflatten dot-keys back to nested structure before writing
    if (url.pathname === '/api/save' && req.method === 'POST') {
      let body = ''
      req.on('data', d => body += d)
      req.on('end', async () => {
        try {
          const { languages, keys } = JSON.parse(body)
          for (const lang of languages) {
            const flat = {}
            for (const [key, vals] of Object.entries(keys)) {
              if (vals[lang] !== undefined) flat[key] = vals[lang]
            }
            const nested = unflattenObject(flat)
            await writeFile(join(dir, `${lang}.json`), JSON.stringify(nested, null, 2) + '\n')
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: e.message }))
        }
      })
      return
    }

    // Feature 2: Export CSV — RFC-4180, header row: key,lang1,lang2,...
    if (url.pathname === '/api/export/csv' && req.method === 'GET') {
      try {
        const { languages, keys } = await loadMessages(dir)
        const rows = [['key', ...languages]]
        for (const [key, vals] of Object.entries(keys)) {
          rows.push([key, ...languages.map(l => vals[l] ?? '')])
        }
        const csv = rows.map(row => row.map(csvField).join(',')).join('\r\n')
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename=messages.csv'
        })
        return res.end(csv)
      } catch (e) {
        res.writeHead(500)
        return res.end('Error: ' + e.message)
      }
    }

    // Feature 3: Import CSV — merge into current state, return merged { languages, keys, dir }
    if (url.pathname === '/api/import/csv' && req.method === 'POST') {
      let body = ''
      req.on('data', d => body += d)
      req.on('end', async () => {
        try {
          const { languages: csvLangs, keys: csvKeys } = parseCSV(body)
          if (!csvLangs.length) throw new Error('CSV has no language columns')

          const { languages: existingLangs, keys: existingKeys } = await loadMessages(dir)
          const allLangs = [...new Set([...existingLangs, ...csvLangs])]

          // Merge: existing as base, CSV overwrites matching keys/langs, new keys added
          const merged = {}
          for (const [key, vals] of Object.entries(existingKeys)) {
            merged[key] = { ...vals }
          }
          for (const [key, vals] of Object.entries(csvKeys)) {
            if (!merged[key]) merged[key] = {}
            for (const lang of csvLangs) {
              merged[key][lang] = vals[lang] ?? ''
            }
          }
          // Fill any missing lang slots
          for (const key of Object.keys(merged)) {
            for (const lang of allLangs) {
              if (merged[key][lang] === undefined) merged[key][lang] = ''
            }
          }

          const sortedKeys = {}
          for (const k of Object.keys(merged).sort()) sortedKeys[k] = merged[k]

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ languages: allLangs, keys: sortedKeys, dir }))
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: e.message }))
        }
      })
      return
    }

    // Feature 7: audit — cross-reference t() calls in source code against JSON keys
    if (url.pathname === '/api/audit' && req.method === 'GET') {
      try {
        const cfg = await resolveConfig()
        const root = resolve(process.cwd(), scanDir ?? cfg.scanDir)
        if (!existsSync(root)) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          return res.end(JSON.stringify({
            error: `Scan directory not found: ${root}. Set "scanDir" in i18n.scan.json or run with --scan <dir>.`
          }))
        }
        const { languages, keys } = await loadMessages(dir)
        const { used, dynamicCalls, filesScanned } = await scan({ ...cfg, scanDir: root, knownKeys: new Set(Object.keys(keys)) })
        const audit = computeAudit({ used, dynamicCalls, languages, keys })
        res.writeHead(200, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ ...audit, scanDir: root, filesScanned }))
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ error: e.message }))
      }
    }

    res.writeHead(404)
    res.end('Not found')
  })

  server.listen(port, () => {
    const url = `http://localhost:${port}`
    console.log(`\n  json-i18n-editor`)
    console.log(`  ─────────────────────────────────`)
    console.log(`  Local:   \x1b[36m${url}\x1b[0m`)
    console.log(`  Dir:     \x1b[33m${dir}\x1b[0m`)
    console.log(`  Press \x1b[1mCtrl+C\x1b[0m to stop\n`)
    openBrowser(url)
  })
}

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'start'
    : 'xdg-open'
  exec(`${cmd} ${url}`)
}

export async function loadMessages(dir) {
  const files = (await readdir(dir)).filter(f => f.endsWith('.json')).sort()
  const languages = files.map(f => f.replace('.json', ''))
  const allKeys = new Set()
  const raw = {}

  for (const lang of languages) {
    const content = JSON.parse(await readFile(join(dir, `${lang}.json`), 'utf8'))
    raw[lang] = flattenObject(content)
    Object.keys(raw[lang]).forEach(k => allKeys.add(k))
  }

  const keys = {}
  for (const key of [...allKeys].sort()) {
    keys[key] = {}
    for (const lang of languages) {
      keys[key][lang] = raw[lang]?.[key] ?? ''
    }
  }

  return { languages, keys }
}

function flattenObject(obj, prefix = '') {
  const result = {}
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(result, flattenObject(v, key))
    } else {
      result[key] = String(v ?? '')
    }
  }
  return result
}

function unflattenObject(flat) {
  const result = {}
  for (const [dotKey, value] of Object.entries(flat)) {
    const parts = dotKey.split('.')
    let cur = result
    for (let i = 0; i < parts.length - 1; i++) {
      if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) {
        cur[parts[i]] = {}
      }
      cur = cur[parts[i]]
    }
    cur[parts[parts.length - 1]] = value
  }
  return result
}

function csvField(v) {
  const s = String(v ?? '')
  return /[,"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

function parseCSV(text) {
  const rows = []
  let cur = ''
  let inQuote = false
  let fields = []

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuote) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++ }
        else inQuote = false
      } else {
        cur += c
      }
    } else {
      if (c === '"') {
        inQuote = true
      } else if (c === ',') {
        fields.push(cur); cur = ''
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++
        fields.push(cur); cur = ''
        if (fields.length > 1 || fields[0] !== '') rows.push(fields)
        fields = []
      } else {
        cur += c
      }
    }
  }
  if (fields.length || cur) { fields.push(cur); rows.push(fields) }

  if (!rows.length) return { languages: [], keys: {} }
  const [header, ...dataRows] = rows
  const langs = header.slice(1).map(l => l.trim())
  const keys = {}
  for (const row of dataRows) {
    const key = row[0]?.trim()
    if (!key) continue
    keys[key] = {}
    langs.forEach((lang, i) => { keys[key][lang] = row[i + 1] ?? '' })
  }
  return { languages: langs, keys }
}
