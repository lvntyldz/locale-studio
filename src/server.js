import { createServer } from 'http'
import { readdir, readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { exec } from 'child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))

export async function startServer({ dir, port }) {
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

        res.writeHead(200, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ languages, keys, dir }))
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ error: e.message }))
      }
    }

    if (url.pathname === '/api/save' && req.method === 'POST') {
      let body = ''
      req.on('data', d => body += d)
      req.on('end', async () => {
        try {
          const { languages, keys } = JSON.parse(body)
          for (const lang of languages) {
            const obj = {}
            for (const [key, vals] of Object.entries(keys)) {
              if (vals[lang] !== undefined) obj[key] = vals[lang]
            }
            await writeFile(join(dir, `${lang}.json`), JSON.stringify(obj, null, 2) + '\n')
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
