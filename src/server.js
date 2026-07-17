import { createServer } from 'http';
import { readdir, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { networkInterfaces } from 'os';
import { scan, computeAudit } from './scanner.js';
import { resolveConfig } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Feature 9: password protection for online/production use.
// Sessions are in-memory tokens (restart = re-login). sha256 both sides so
// timingSafeEqual always gets equal-length buffers.
const sha256 = (s) => createHash('sha256').update(String(s)).digest();

const LOGIN_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>locale-studio — login</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
         background: #f1f5f9; color: #1e293b; display: flex; align-items: center;
         justify-content: center; min-height: 100vh; margin: 0; }
  .card { background: #0f172a; color: #f8fafc; padding: 2rem 2.5rem; border-radius: 12px;
          box-shadow: 0 10px 30px rgba(15,23,42,.25); width: 300px; }
  .card h1 { font-size: 1.05rem; margin: 0 0 .25rem; }
  .card h1 span { color: #38bdf8; }
  .card p { color: #64748b; font-size: .8rem; margin: 0 0 1.25rem; }
  input { width: 100%; box-sizing: border-box; padding: .6rem .75rem; border-radius: 8px;
          border: 1px solid #334155; background: #1e293b; color: #f8fafc; font-size: .9rem; }
  input:focus { outline: 2px solid #38bdf8; border-color: transparent; }
  button { width: 100%; margin-top: .75rem; padding: .6rem; border: 0; border-radius: 8px;
           background: #38bdf8; color: #0f172a; font-weight: 600; font-size: .9rem; cursor: pointer; }
  button:hover { background: #7dd3fc; }
  .err { color: #f87171; font-size: .8rem; min-height: 1.1rem; margin: .5rem 0 0; }
</style></head><body>
<form class="card" id="f">
  <h1>locale-<span>studio</span></h1>
  <p>This editor is password-protected.</p>
  <input type="password" id="pw" placeholder="Password" autofocus autocomplete="current-password">
  <button type="submit">Unlock</button>
  <p class="err" id="err"></p>
</form>
<script>
  document.getElementById('f').addEventListener('submit', async (e) => {
    e.preventDefault()
    const err = document.getElementById('err')
    err.textContent = ''
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: document.getElementById('pw').value })
    })
    if (r.ok) location.reload()
    else err.textContent = 'Wrong password, try again.'
  })
</script></body></html>`;

export async function startServer({ dir, port, scanDir, password, title }) {
  if (!existsSync(dir)) {
    console.error(`\n  ❌  Directory not found: ${dir}`);
    console.error(`      Create it first or use --dir to specify the path.\n`);
    process.exit(1);
  }

  let uiHtml = await readFile(join(__dirname, 'ui.html'), 'utf8');
  let loginHtml = LOGIN_HTML;
  if (title) {
    // Feature: white-label branding — replace the product name in the page
    // title, the topbar logo and the login card with the project's own title.
    const safe = escapeHtml(title);
    uiHtml = uiHtml
      .replace('<title>locale-studio</title>', `<title>${safe}</title>`)
      .replace(
        '<div class="topbar-logo">locale<span>-studio</span></div>',
        `<div class="topbar-logo">${safe}</div>`
      );
    loginHtml = loginHtml
      .replace('<title>locale-studio — login</title>', `<title>${safe} — login</title>`)
      .replace('<h1>locale-<span>studio</span></h1>', `<h1>${safe}</h1>`);
  }
  const sessions = new Set();

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);

    if (password) {
      const m = (req.headers.cookie || '').match(/(?:^|;\s*)i18n_session=([a-f0-9]{64})/);
      const authed = m && sessions.has(m[1]);

      if (!authed) {
        if (url.pathname === '/api/login' && req.method === 'POST') {
          let body = '';
          req.on('data', (d) => {
            body += d;
            if (body.length > 4096) req.destroy();
          });
          req.on('end', async () => {
            let ok = false;
            try {
              const attempt = JSON.parse(body).password;
              ok = typeof attempt === 'string' && timingSafeEqual(sha256(attempt), sha256(password));
            } catch {}
            if (!ok) {
              await new Promise((r) => setTimeout(r, 800)); // slow down brute force
              res.writeHead(401, { 'Content-Type': 'application/json' });
              return res.end(JSON.stringify({ error: 'Wrong password' }));
            }
            const token = randomBytes(32).toString('hex');
            sessions.add(token);
            if (sessions.size > 100) sessions.delete(sessions.values().next().value); // oldest out
            res.writeHead(200, {
              'Content-Type': 'application/json',
              'Set-Cookie': `i18n_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`,
            });
            return res.end(JSON.stringify({ ok: true }));
          });
          return;
        }
        if (url.pathname === '/' || url.pathname === '/index.html') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          return res.end(loginHtml);
        }
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Authentication required' }));
      }
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(uiHtml);
    }

    if (url.pathname === '/api/messages' && req.method === 'GET') {
      try {
        const data = await loadMessages(dir);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ...data, dir }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: e.message }));
      }
    }

    // Feature 1: round-trip — unflatten dot-keys back to nested structure before writing
    if (url.pathname === '/api/save' && req.method === 'POST') {
      const chunks = [];
      req.on('data', (d) => chunks.push(d));
      req.on('end', async () => {
        const body = Buffer.concat(chunks).toString('utf8');
        try {
          const { languages, keys } = JSON.parse(body);
          for (const lang of languages) {
            const byNs = {};
            for (const [fullKey, vals] of Object.entries(keys)) {
              if (vals[lang] !== undefined) {
                const parts = fullKey.split(':');
                const ns = parts[0];
                const key = parts.slice(1).join(':');
                if (!byNs[ns]) byNs[ns] = {};
                byNs[ns][key] = vals[lang];
              }
            }
            // SECURITY FIX: Prevent Path Traversal
            if (/[\\/\\\\]|^\.\./.test(lang)) {
              throw new Error('Invalid language name');
            }
            const langDir = join(dir, lang);
            if (!existsSync(langDir)) {
              const fsPromises = await import('fs/promises');
              await fsPromises.mkdir(langDir, { recursive: true });
            }
            for (const [ns, flat] of Object.entries(byNs)) {
              // SECURITY FIX: Prevent Path Traversal
              if (/[\\/\\\\]|^\.\./.test(ns)) {
                throw new Error('Invalid namespace name');
              }
              const nsFile = join(langDir, `${ns}.json`);
              let existingData = {};
              try {
                if (existsSync(nsFile)) {
                  existingData = JSON.parse(await readFile(nsFile, 'utf8'));
                }
              } catch (e) {}

              const nested = applyUpdatesAndPreserveOrder(existingData, flat);
              const newContent = JSON.stringify(nested, null, 2) + '\n';

              let oldContent = '';
              try {
                oldContent = await readFile(nsFile, 'utf8');
              } catch (e) {}

              if (oldContent !== newContent) {
                await writeFile(nsFile, newContent);
              }
            }
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // Feature 2: Export CSV — RFC-4180, header row: key,lang1,lang2,...
    if (url.pathname === '/api/export/csv' && req.method === 'GET') {
      try {
        const { languages, keys } = await loadMessages(dir);
        const rows = [['key', ...languages]];
        for (const [key, vals] of Object.entries(keys)) {
          rows.push([key, ...languages.map((l) => vals[l] ?? '')]);
        }
        const csv = rows.map((row) => row.map(csvField).join(',')).join('\r\n');
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename=messages.csv',
        });
        return res.end(csv);
      } catch (e) {
        res.writeHead(500);
        return res.end('Error: ' + e.message);
      }
    }

    // Feature 3: Import CSV — merge into current state, return merged { languages, keys, dir }
    if (url.pathname === '/api/import/csv' && req.method === 'POST') {
      const chunks = [];
      req.on('data', (d) => chunks.push(d));
      req.on('end', async () => {
        const body = Buffer.concat(chunks).toString('utf8');
        try {
          const { languages: csvLangs, keys: csvKeys } = parseCSV(body);
          if (!csvLangs.length) throw new Error('CSV has no language columns');

          const { languages: existingLangs, keys: existingKeys } = await loadMessages(dir);
          const allLangs = [...new Set([...existingLangs, ...csvLangs])];

          // Merge: existing as base, CSV overwrites matching keys/langs, new keys added
          const merged = {};
          for (const [key, vals] of Object.entries(existingKeys)) {
            merged[key] = { ...vals };
          }
          for (const [key, vals] of Object.entries(csvKeys)) {
            if (!merged[key]) merged[key] = {};
            for (const lang of csvLangs) {
              merged[key][lang] = vals[lang] ?? '';
            }
          }
          // Fill any missing lang slots
          for (const key of Object.keys(merged)) {
            for (const lang of allLangs) {
              if (merged[key][lang] === undefined) merged[key][lang] = '';
            }
          }

          const sortedKeys = {};
          for (const k of Object.keys(merged).sort()) sortedKeys[k] = merged[k];

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ languages: allLangs, keys: sortedKeys, dir }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // Feature 7: audit — cross-reference t() calls in source code against JSON keys
    if (url.pathname === '/api/audit' && req.method === 'GET') {
      try {
        const cfg = await resolveConfig();
        const root = resolve(process.cwd(), scanDir ?? cfg.scanDir);
        if (!existsSync(root)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(
            JSON.stringify({
              error: `Scan directory not found: ${root}. Set "scanDir" in i18n.scan.json or run with --scan <dir>.`,
            })
          );
        }
        const { languages, keys } = await loadMessages(dir);
        const { used, dynamicCalls, filesScanned } = await scan({
          ...cfg,
          scanDir: root,
          knownKeys: new Set(Object.keys(keys)),
        });
        const audit = computeAudit({ used, dynamicCalls, languages, keys });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ...audit, scanDir: root, filesScanned }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: e.message }));
      }
    }

    res.writeHead(404);
    res.end('Not found');
  });

  server.listen(port, () => {
    const url = `http://localhost:${port}`;
    console.log(`\n  locale-studio`);
    console.log(`  ─────────────────────────────────`);
    console.log(`  Local:   \x1b[36m${url}\x1b[0m`);
    if (password) {
      for (const ip of externalIPs()) {
        console.log(`  Network: \x1b[36mhttp://${ip}:${port}\x1b[0m`);
      }
      console.log(
        `  Auth:    \x1b[32mpassword required\x1b[0m (plain HTTP — use behind a reverse proxy for sensitive data)`
      );
    }
    console.log(`  Dir:     \x1b[33m${dir}\x1b[0m`);
    console.log(`  Press \x1b[1mCtrl+C\x1b[0m to stop\n`);
    if (!password) openBrowser(url);
  });
}

function externalIPs() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${cmd} ${url}`);
}

export async function loadMessages(dir) {
  const items = await readdir(dir, { withFileTypes: true });
  const languages = items
    .filter((i) => i.isDirectory())
    .map((i) => i.name)
    .sort();
  const allKeys = new Set();
  const namespaces = new Set();
  const raw = {};

  for (const lang of languages) {
    raw[lang] = {};
    // SECURITY FIX: Prevent Path Traversal
            if (/[\\/\\\\]|^\.\./.test(lang)) {
              throw new Error('Invalid language name');
            }
            const langDir = join(dir, lang);
    const nsFiles = (await readdir(langDir)).filter((f) => f.endsWith('.json')).sort();

    for (const nsFile of nsFiles) {
      const ns = nsFile.replace('.json', '');
      namespaces.add(ns);
      const content = JSON.parse(await readFile(join(langDir, nsFile), 'utf8'));
      const flat = flattenObject(content);

      for (const [k, v] of Object.entries(flat)) {
        const fullKey = `${ns}:${k}`;
        raw[lang][fullKey] = v;
        allKeys.add(fullKey);
      }
    }
  }

  const keys = {};
  for (const k of Array.from(allKeys).sort()) {
    keys[k] = {};
    for (const lang of languages) {
      if (raw[lang][k] !== undefined) keys[k][lang] = raw[lang][k];
    }
  }
  return { languages, keys, namespaces: Array.from(namespaces).sort() };
}

function flattenObject(obj, prefix = '') {
  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(result, flattenObject(v, key));
    } else {
      result[key] = String(v ?? '');
    }
  }
  return result;
}

function unflattenObject(flat) {
  const result = {};
  for (const [dotKey, value] of Object.entries(flat)) {
    const parts = dotKey.split('.');
    let cur = result;
    for (let i = 0; i < parts.length - 1; i++) {
      if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) {
        cur[parts[i]] = {};
      }
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
  }
  return result;
}

function csvField(v) {
  const s = String(v ?? '');
  return /[,"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function parseCSV(text) {
  const rows = [];
  let cur = '';
  let inQuote = false;
  let fields = [];

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuote = false;
      } else {
        cur += c;
      }
    } else {
      if (c === '"') {
        inQuote = true;
      } else if (c === ',') {
        fields.push(cur);
        cur = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        fields.push(cur);
        cur = '';
        if (fields.length > 1 || fields[0] !== '') rows.push(fields);
        fields = [];
      } else {
        cur += c;
      }
    }
  }
  if (fields.length || cur) {
    fields.push(cur);
    rows.push(fields);
  }

  if (!rows.length) return { languages: [], keys: {} };
  const [header, ...dataRows] = rows;
  const langs = header.slice(1).map((l) => l.trim());
  const keys = {};
  for (const row of dataRows) {
    const key = row[0]?.trim();
    if (!key) continue;
    keys[key] = {};
    langs.forEach((lang, i) => {
      keys[key][lang] = row[i + 1] ?? '';
    });
  }
  return { languages: langs, keys };
}

function applyUpdatesAndPreserveOrder(existingData, flatNewData) {
  function removeMissing(obj, prefix = '') {
    for (const k of Object.keys(obj)) {
      const dotKey = prefix ? `${prefix}.${k}` : k;
      if (typeof obj[k] === 'object' && obj[k] !== null && !Array.isArray(obj[k])) {
        removeMissing(obj[k], dotKey);
        if (Object.keys(obj[k]).length === 0) delete obj[k];
      } else {
        if (flatNewData[dotKey] === undefined) {
          delete obj[k];
        }
      }
    }
  }
  removeMissing(existingData);

  for (const [dotKey, value] of Object.entries(flatNewData)) {
    const parts = dotKey.split('.');
    let cur = existingData;
    for (let i = 0; i < parts.length - 1; i++) {
      if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) {
        cur[parts[i]] = {};
      }
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
  }

  return existingData;
}
