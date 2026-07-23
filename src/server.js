import { createServer } from 'http';
import { readdir, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { networkInterfaces } from 'os';
import { scan, computeAudit } from './scanner.js';
import { resolveConfig } from './config.js';
import {
  HTTP_STATUS,
  MIME_TYPES,
  TIMINGS,
  REGEX_PATTERNS,
  DEFAULT_NAMESPACES,
  API_ROUTES,
  LIMITS,
} from './constants.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * SHA-256 hash helper for timing-safe password comparison.
 */
const sha256 = (str) => createHash('sha256').update(String(str)).digest();

/**
 * Response Helper Functions
 */
function sendResponse(res, statusCode, contentType, body, extraHeaders = {}) {
  res.writeHead(statusCode, { 'Content-Type': contentType, ...extraHeaders });
  res.end(body);
}

function sendJson(res, data, statusCode = HTTP_STATUS.OK, extraHeaders = {}) {
  sendResponse(res, statusCode, MIME_TYPES.JSON, JSON.stringify(data), extraHeaders);
}

function sendHtml(res, html, statusCode = HTTP_STATUS.OK) {
  sendResponse(res, statusCode, MIME_TYPES.HTML, html);
}

function sendError(res, message, statusCode = HTTP_STATUS.INTERNAL_SERVER_ERROR) {
  sendJson(res, { error: message }, statusCode);
}

/**
 * Reads request stream body as UTF-8 string using Buffer concatenation.
 * Preserves multi-byte UTF-8 sequences cleanly across TCP chunk boundaries.
 */
function readRequestBody(req, maxBytes = null) {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks = [];
    let totalBytes = 0;
    req.on('data', (chunk) => {
      chunks.push(chunk);
      totalBytes += chunk.length;
      if (maxBytes && totalBytes > maxBytes) {
        req.destroy();
        rejectPromise(new Error('Payload too large'));
      }
    });
    req.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')));
    req.on('error', (err) => rejectPromise(err));
  });
}

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

  let uiHtml = await readFile(join(__dirname, 'public', 'index.html'), 'utf8');
  let loginHtml = LOGIN_HTML;

  if (title) {
    const safe = escapeHtml(title);
    uiHtml = uiHtml
      .replace('<title>locale-studio</title>', `<title>${safe}</title>`)
      .replace(
        '<div class="topbar-logo" onclick="goHome()">locale<span>-studio</span></div>',
        `<div class="topbar-logo" onclick="goHome()">${safe}</div>`
      );
    loginHtml = loginHtml
      .replace('<title>locale-studio — login</title>', `<title>${safe} — login</title>`)
      .replace('<h1>locale-<span>studio</span></h1>', `<h1>${safe}</h1>`);
  }

  const sessions = new Set();

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);

    // Auth Middleware
    if (password) {
      const match = (req.headers.cookie || '').match(REGEX_PATTERNS.SESSION_COOKIE);
      const isAuthed = match && sessions.has(match[1]);

      if (!isAuthed) {
        if (url.pathname === API_ROUTES.LOGIN && req.method === 'POST') {
          return handleLogin(req, res, password, sessions);
        }
        if (url.pathname === API_ROUTES.HOME || url.pathname === API_ROUTES.INDEX_HTML) {
          return sendHtml(res, loginHtml);
        }
        return sendError(res, 'Authentication required', HTTP_STATUS.UNAUTHORIZED);
      }
    }

    // Static Index HTML
    if (url.pathname === API_ROUTES.HOME || url.pathname === API_ROUTES.INDEX_HTML) {
      return sendHtml(res, uiHtml);
    }

    // Static Assets (/public/*)
    if (url.pathname.startsWith('/public/')) {
      return handlePublicStatic(url.pathname, res);
    }

    // API Routes
    if (url.pathname === API_ROUTES.MESSAGES && req.method === 'GET') {
      return handleGetMessages(dir, res);
    }

    if (url.pathname === API_ROUTES.SAVE && req.method === 'POST') {
      return handleSaveMessages(req, res, dir);
    }

    if (url.pathname === API_ROUTES.EXPORT_CSV && req.method === 'GET') {
      return handleExportCSV(dir, res);
    }

    if (url.pathname === API_ROUTES.IMPORT_CSV && req.method === 'POST') {
      return handleImportCSV(req, res, dir);
    }

    if (url.pathname === API_ROUTES.AUDIT && req.method === 'GET') {
      return handleAudit(scanDir, dir, res);
    }

    // Fallback 404
    sendResponse(res, HTTP_STATUS.NOT_FOUND, MIME_TYPES.TEXT, 'Not found');
  });

  server.listen(port, () => {
    const serverUrl = `http://localhost:${port}`;
    console.log(`\n  locale-studio`);
    console.log(`  ─────────────────────────────────`);
    console.log(`  Local:   \x1b[36m${serverUrl}\x1b[0m`);
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
    if (!password) openBrowser(serverUrl);
  });
}

/**
 * Handler: Password Login
 */
async function handleLogin(req, res, password, sessions) {
  try {
    const rawBody = await readRequestBody(req, LIMITS.MAX_LOGIN_BODY_BYTES);
    let ok = false;
    try {
      const attempt = JSON.parse(rawBody).password;
      ok = typeof attempt === 'string' && timingSafeEqual(sha256(attempt), sha256(password));
    } catch {}

    if (!ok) {
      await new Promise((resolve) => setTimeout(resolve, TIMINGS.BRUTE_FORCE_DELAY_MS));
      return sendError(res, 'Wrong password', HTTP_STATUS.UNAUTHORIZED);
    }

    const token = randomBytes(LIMITS.TOKEN_BYTES).toString('hex');
    sessions.add(token);
    if (sessions.size > LIMITS.MAX_SESSIONS_COUNT) {
      sessions.delete(sessions.values().next().value);
    }

    sendJson(
      res,
      { ok: true },
      HTTP_STATUS.OK,
      { 'Set-Cookie': `i18n_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${TIMINGS.SESSION_MAX_AGE_SEC}` }
    );
  } catch (err) {
    sendError(res, err.message, HTTP_STATUS.BAD_REQUEST);
  }
}

/**
 * Handler: Serve Static Assets
 */
async function handlePublicStatic(pathname, res) {
  const ext = path.extname(pathname);
  const mimeMap = {
    '.css': MIME_TYPES.CSS,
    '.js': MIME_TYPES.JAVASCRIPT,
    '.svg': MIME_TYPES.SVG,
    '.png': MIME_TYPES.PNG,
    '.html': MIME_TYPES.HTML,
  };
  const contentType = mimeMap[ext] || MIME_TYPES.TEXT;

  try {
    const filePath = join(__dirname, pathname);
    if (!filePath.startsWith(join(__dirname, 'public'))) {
      throw new Error('Forbidden path');
    }
    const fileContent = await readFile(filePath);
    sendResponse(res, HTTP_STATUS.OK, contentType, fileContent);
  } catch {
    sendResponse(res, HTTP_STATUS.NOT_FOUND, MIME_TYPES.TEXT, 'Not found');
  }
}

/**
 * Handler: GET /api/messages
 */
async function handleGetMessages(dir, res) {
  try {
    const data = await loadMessages(dir);
    sendJson(res, { ...data, dir });
  } catch (err) {
    sendError(res, err.message);
  }
}

/**
 * Handler: POST /api/save
 */
async function handleSaveMessages(req, res, dir) {
  try {
    const rawBody = await readRequestBody(req);
    const { languages, keys, namespaces } = JSON.parse(rawBody);

    for (const lang of languages) {
      const byNs = {};
      for (const [fullKey, vals] of Object.entries(keys)) {
        if (vals[lang] !== undefined) {
          const idx = fullKey.indexOf(':');
          let ns, key;
          if (idx === -1) {
            ns = (namespaces && namespaces.includes(DEFAULT_NAMESPACES[0]))
              ? DEFAULT_NAMESPACES[0]
              : ((namespaces && namespaces.includes(DEFAULT_NAMESPACES[1]))
                ? DEFAULT_NAMESPACES[1]
                : ((namespaces && namespaces[0]) || DEFAULT_NAMESPACES[0]));
            key = fullKey;
          } else {
            ns = fullKey.substring(0, idx);
            key = fullKey.substring(idx + 1);
          }
          if (!byNs[ns]) byNs[ns] = {};
          byNs[ns][key] = vals[lang];
        }
      }

      if (REGEX_PATTERNS.PATH_TRAVERSAL.test(lang)) {
        throw new Error('Invalid language name');
      }

      const langDir = join(dir, lang);
      if (!existsSync(langDir)) {
        const fsPromises = await import('fs/promises');
        await fsPromises.mkdir(langDir, { recursive: true });
      }

      for (const [ns, flat] of Object.entries(byNs)) {
        if (REGEX_PATTERNS.PATH_TRAVERSAL.test(ns)) {
          throw new Error('Invalid namespace name');
        }
        const nsFile = join(langDir, `${ns}.json`);
        let existingData = {};
        try {
          if (existsSync(nsFile)) {
            existingData = JSON.parse(await readFile(nsFile, 'utf8'));
          }
        } catch {}

        const nested = applyUpdatesAndPreserveOrder(existingData, flat);
        const newContent = JSON.stringify(nested, null, 2) + '\n';

        let oldContent = '';
        try {
          oldContent = await readFile(nsFile, 'utf8');
        } catch {}

        if (oldContent !== newContent) {
          await writeFile(nsFile, newContent);
        }
      }
    }
    sendJson(res, { ok: true });
  } catch (err) {
    sendError(res, err.message);
  }
}

/**
 * Handler: GET /api/export/csv
 */
async function handleExportCSV(dir, res) {
  try {
    const { languages, keys } = await loadMessages(dir);
    const rows = [['key', ...languages]];
    for (const [key, vals] of Object.entries(keys)) {
      rows.push([key, ...languages.map((l) => vals[l] ?? '')]);
    }
    const csv = rows.map((row) => row.map(csvField).join(',')).join('\r\n');
    sendResponse(res, HTTP_STATUS.OK, MIME_TYPES.CSV, csv, {
      'Content-Disposition': 'attachment; filename=messages.csv',
    });
  } catch (err) {
    sendResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, MIME_TYPES.TEXT, 'Error: ' + err.message);
  }
}

/**
 * Handler: POST /api/import/csv
 */
async function handleImportCSV(req, res, dir) {
  try {
    const rawBody = await readRequestBody(req);
    const { languages: csvLangs, keys: csvKeys } = parseCSV(rawBody);
    if (!csvLangs.length) throw new Error('CSV has no language columns');

    const { languages: existingLangs, keys: existingKeys } = await loadMessages(dir);
    const allLangs = [...new Set([...existingLangs, ...csvLangs])];

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
    for (const key of Object.keys(merged)) {
      for (const lang of allLangs) {
        if (merged[key][lang] === undefined) merged[key][lang] = '';
      }
    }

    const sortedKeys = {};
    for (const k of Object.keys(merged).sort()) sortedKeys[k] = merged[k];

    sendJson(res, { languages: allLangs, keys: sortedKeys, dir });
  } catch (err) {
    sendError(res, err.message, HTTP_STATUS.BAD_REQUEST);
  }
}

/**
 * Handler: GET /api/audit
 */
async function handleAudit(scanDir, dir, res) {
  try {
    const cfg = await resolveConfig();
    const root = resolve(process.cwd(), scanDir ?? cfg.scanDir);
    if (!existsSync(root)) {
      return sendError(
        res,
        `Scan directory not found: ${root}. Set "scanDir" in i18n.scan.json or run with --scan <dir>.`,
        HTTP_STATUS.BAD_REQUEST
      );
    }
    const { languages, keys } = await loadMessages(dir);
    const { used, dynamicCalls, filesScanned } = await scan({
      ...cfg,
      scanDir: root,
      knownKeys: new Set(Object.keys(keys)),
    });
    const audit = computeAudit({ used, dynamicCalls, languages, keys });
    sendJson(res, { ...audit, scanDir: root, filesScanned });
  } catch (err) {
    sendError(res, err.message);
  }
}

function externalIPs() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

function escapeHtml(str) {
  return String(str).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]
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
    if (REGEX_PATTERNS.PATH_TRAVERSAL.test(lang)) {
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
