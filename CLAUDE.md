# CLAUDE.md — json-i18n-editor

## BigPicture

`json-i18n-editor` is a **zero-dependency, local browser-based editor** for JSON i18n files.
No cloud, no config required. Run via `npx`, edit translations in a spreadsheet UI, save back to disk.
Optional password protection (`--password`) for running it online (VPS/staging/LAN) — no SSL, that's a reverse proxy's job.

### Architecture

```
bin/cli.js      CLI entry — UI mode (startServer) + `audit` (terminal, CI) + `init` (generate config)
src/server.js   Node HTTP server (no framework) — serves ui.html + REST API
src/ui.html     Single-file browser app — vanilla JS, no bundler
src/scanner.js  Code scanner — finds t("key") calls in source files, computes missing/unused
src/config.js   Scan config resolution: i18n.scan.json → package.json field → defaults
src/init.js     `init` subcommand — auto-detects locales dir, framework, custom t() helpers
```

**Request flow:**
```
browser  →  GET /api/messages  →  server reads *.json files, flattenObject(), returns { languages, keys, dir }
browser  →  POST /api/save     →  server receives flat keys, unflattenObject(), writes back to *.json files
browser  →  GET /api/audit     →  server scans source code, cross-references keys, returns { missing, unused, untranslated, dynamicCalls }
```

---

## Coding rules

- **No dependencies.** Keep `package.json` dependency-free. Node stdlib only.
- **No bundler.** `ui.html` is a single self-contained HTML file. All JS/CSS inline.
- **No TypeScript.** Plain ESM `.js`.
- **No framework** in the browser (no React, no Vue). Vanilla DOM.
- Preserve the flat-object API between server and browser — both sides use dot-notation keys internally.

---

## Feature roadmap (implement one at a time)

| # | Feature | Files touched | Status |
|---|---------|--------------|--------|
| 1 | **Round-trip nested JSON** | `server.js` — add `unflattenObject()`, use it in `/api/save` | DONE (v0.2.0) |
| 2 | **Export CSV** | `server.js` → `GET /api/export/csv` · `ui.html` → `exportCSV()` button | DONE (v0.2.0) |
| 3 | **Import CSV** | `server.js` → `POST /api/import/csv` · `ui.html` → file-input + `importCSV()` | DONE (v0.2.0) |
| 4 | **Filter/search** | `ui.html` only — search input in topbar, `filterKeys(query)` hides rows | DONE (v0.3.0) |
| 5 | **Missing translation indicator** | `ui.html` only — amber/red highlight on empty cells, count in statusbar | DONE (v0.3.0) |
| 6 | **Completeness per language** | `ui.html` only — pills in statusbar: `en: 12/14 (86%)`, colour-coded | DONE (v0.3.0) |
| 7 | **Code scanner / audit** | `scanner.js` + `config.js` (new) · `server.js` → `GET /api/audit` · `ui.html` → Audit panel · `cli.js` → `audit` subcommand | DONE (v0.3.0) |
| 8 | **`init` — auto-generate i18n.scan.json** | `init.js` (new) · `cli.js` → `init` subcommand, `--force`, config `"dir"` field | DONE (v0.5.0) |
| 9 | **Password-protected online mode** | `server.js` → login page + session cookies · `cli.js` → `--password`, `JSON_I18N_PASSWORD` env | DONE (v0.7.0) |

**Backlog (not scheduled):** persist an "ignore" list for unused keys in `i18n.scan.json` · react-i18next namespaces (`ns:key`) · `--strict` flag so unused keys also fail CI · directory-per-language layouts (`locales/<lang>/*.json`, i18next public/locales style).

---

## Implementation notes per feature

### 1 — Round-trip nested JSON
- `flattenObject()` already exists in `server.js`.
- Add `unflattenObject(flat)`: split each dot-key, create nested object structure.
- In `/api/save`: for each lang, call `unflattenObject(langFlat)` before `JSON.stringify`.
- Edge case: keys that literally contain a dot (e.g. `"v1.0.label"`) — decide: escape or accept ambiguity. Simplest: no escaping, document it.
- Keep original file indentation (2 spaces, same as current).

### 2 — Export CSV
- Server: `GET /api/export/csv` — build RFC-4180 CSV: header row `key,lang1,lang2,…`, one row per key.
  Quote fields that contain commas, quotes, or newlines. Escape `"` as `""`.
- Response headers: `Content-Type: text/csv`, `Content-Disposition: attachment; filename=messages.csv`.
- UI: button `⬇ Export CSV` next to Save. On click: `window.location = '/api/export/csv'`.

### 3 — Import CSV
- UI: hidden `<input type="file" accept=".csv">`, triggered by a button `⬆ Import CSV`.
- On file select: read with `FileReader`, POST raw CSV text to `/api/import/csv` as `text/plain`.
- Server: parse CSV → merge into current keys (add new, overwrite existing, keep untouched).
- Return merged `{ languages, keys }` — browser calls `render()` and `markDirty()`.
- Handle new languages in CSV (add column to state).

### 4 — Filter/search
- Add `<input id="search" placeholder="Filter keys…">` in topbar (between dir-label and info).
- `filterKeys(query)` iterates `tr[data-key]`, shows/hides based on whether key or any value contains query.
- Don't re-render (no full DOM rebuild). Just toggle `display: none`.
- Clear filter with Escape key.

### 5 — Missing translation indicator
- After every `render()` call, run `markMissing()`.
- For each `textarea.val-input` that is empty: add class `missing` to its parent `td`.
- CSS: `.missing { background: #fef3c7 !important; }` (amber).
- Show count in statusbar: `3 missing`.
- On `saveAll()` with missing values: warn via toast but allow save (no blocking).

### 6 — Completeness per language
- After `render()`, compute per-language `{ total, filled }`.
- Inject into statusbar as small pills: `<span class="pill pill-green">en 14/14</span>`.
- Thresholds: green ≥ 90%, amber ≥ 70%, red < 70%.
- Place after the `Ctrl+S` hint in statusbar.

### 7 — Code scanner / audit
- `scanner.js` exports `scan({ scanDir, patterns, extensions, ignore })` → `{ used: Map<key, [{file, line}]>, dynamicCalls, filesScanned }` and `computeAudit()` → `{ missing, unused, untranslated, dynamicCalls }`.
- Default patterns cover `t(lang, "key")`, `t("key")`, `$t("key")`, `i18n.t("key")`, `translate("key")`, `'key' | translate`. The `(?<![\w$.])` lookbehind is load-bearing — without it `split(".")` / `format("2d")` match via their trailing `t(`.
- Dynamic-key calls (`t(\`item_${i}\`)`, `t(lang, key)`) can't be resolved statically: they're reported separately so the unused list carries a "may be incomplete" warning. CSS `translate(-50%, …)` and `function t(...)` definitions are excluded from this detection.
- **Namespace wrappers** (v0.6.0): per-file helpers like `const t = (key) => translation(\`LOGIN.${key}\`)` (template-literal, `"NS." + key` concat, and `useCallback(...)` variants) are detected by `WRAPPER_DEF` and resolved in a pre-pass — `t("USERNAME")` audits as `LOGIN.USERNAME`. Anti-false-positive gate: a wrapper is only trusted if its UPPERCASE namespace exists in the JSON keys **or** its inner callee is provably i18n (`t`/`$t`/`translate`/`i18n`, or aliased via `t: name` from `useTranslation()`/`useI18n()` in the same file) — the second branch covers whole namespaces missing from JSON (a wrapper for a not-yet-translated module). `scan()` takes optional `knownKeys` for this; server, cli and init all pass it. Wrapper calls with non-literal args (`tc(variable)`) are reported as dynamic. The `(?!\s*\+)` lookahead in `KEY` stops `"NS." + key` concat prefixes being captured as keys.
- Config resolution (`config.js`, first wins): `i18n.scan.json` in cwd → `"json-i18n-editor"` field in cwd's `package.json` → defaults. Paths are relative to the cwd the CLI runs from, **not** to `--dir`. `"patterns": ["auto"]` expands to the defaults; custom regexes (capture group 1 = the key) can be mixed in for project-specific helpers like `getT(lang, "key")`.
- CLI: `json-i18n-editor audit [--dir <locales>] [--scan <src>]` — no browser, exit 1 if missing keys (CI gate), exit 0 otherwise. Unused/dynamic/untranslated are warnings only. `--dir` falls back to the config's `"dir"` field, then `./messages`.
- UI: `🔍 Audit` button in topbar (red badge = missing count, populated on load), collapsible panel above the table. `[＋ Add]` on a missing key reuses the dirty-state flow (`collectState()` + `render()` + `markDirty()`) — nothing is written to disk until the user saves. `[× Delete]` on unused reuses `deleteKey()`.

### 8 — `init` subcommand (auto-generate i18n.scan.json, any stack)
- `init.js` exports `runInit({ dirArg, scanArg, force })`. Refuses to overwrite an existing `i18n.scan.json` unless `--force`.
- **Locales dir:** BFS (depth ≤ 4, skipping node_modules/dist/.next/etc.) for dirs containing valid `<lang>.json` files (`/^[a-z]{2,3}([-_][A-Za-z]{2,4})?\.json$/`). Best candidate = most lang files, then shallowest. Directory-per-language layouts are detected and reported as unsupported.
- **Extensions:** from package.json deps markers (astro/vue/nuxt/svelte/@angular/core/react/next/preact/solid-js), union if several; no package.json or no match → defaults.
- **Custom helper discovery (the stack-agnostic trick):** the JSON keys are ground truth. Scan for `ident("key")` / `ident(arg, "key")` / `.ident(…)` where the literal is an *existing* key. An identifier qualifies with ≥3 distinct known keys plus ≥1 not covered by auto patterns (and not in a blocklist of string/DOM/test methods). Generates the pattern with proper variant: bare vs method-style (`\.name\(`), key-first vs lang-first, `$` escaped (svelte-i18n `$_`). Verified to discover `getT` (lang-first custom helper), `tr` (vue), `$_` (svelte), `.instant` (ngx-translate), `.t` (react props), `__` (no package.json at all).
- Writes config including `"dir"` (locales path) so `json-i18n-editor` / `audit` need no flags afterwards; prints detected setup, coverage before/after, and suggested package.json scripts.
- `audit` prints a "run init" hint when running on pure defaults with ≥10 unused keys.

### 9 — Password-protected online mode
- `--password <pass>` (or `JSON_I18N_PASSWORD` env var) gates the whole server: unauthenticated `/` serves an inline login page (`LOGIN_HTML` in `server.js`), every other route returns 401 JSON. Without the flag, behavior is byte-identical to before.
- `POST /api/login` compares sha256 digests via `crypto.timingSafeEqual` (equal-length buffers), sleeps 800 ms on failure (brute-force throttle), caps the request body at 4 KB.
- Sessions: random 32-byte hex tokens in an in-memory `Set` (restart = re-login), cookie `i18n_session` with `HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`, capped at 100 concurrent (oldest evicted). The browser UI needs no changes — cookies ride along automatically.
- Banner prints LAN IPs (`os.networkInterfaces`) and a plain-HTTP warning when password mode is on; the auto-open-browser is skipped (headless servers).
- Deliberately no SSL/TLS — that's a reverse proxy's job (documented in README).

---

## Dev / test setup

```bash
# Create test fixtures
mkdir -p /tmp/test-i18n-editor/messages
echo '{ "hero": { "title": "Hello", "subtitle": "World" }, "nav": { "home": "Home" } }' \
  > /tmp/test-i18n-editor/messages/en.json
echo '{ "hero": { "title": "Hola" } }' \
  > /tmp/test-i18n-editor/messages/es.json

# Run the editor (from the repo root)
node bin/cli.js --dir /tmp/test-i18n-editor/messages

# Run the audit (terminal-only; create some t() calls in /tmp/test-i18n-editor/src first)
cd /tmp/test-i18n-editor && node <repo-root>/bin/cli.js audit --dir messages --scan src
```

Open `http://localhost:3737` to verify. After save, `cat` the JSON files to confirm round-trip.
Real-world smoke test: run `bin/cli.js init` + `bin/cli.js audit` from the root of any real project with JSON locales (React/Vue/Angular/Svelte/Astro…) and check the missing/unused/dynamic lists against the actual code.

---

## Git workflow

- Branch: `develop` (always).
- Never push to `main` directly.
- PR: `develop → main` for releases.
