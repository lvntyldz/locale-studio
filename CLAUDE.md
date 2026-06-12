# CLAUDE.md — json-i18n-editor

## BigPicture

`json-i18n-editor` is a **zero-dependency, local browser-based editor** for JSON i18n files.
No cloud, no auth, no config. Run via `npx`, edit translations in a spreadsheet UI, save back to disk.

### Architecture (two files, that's it)

```
bin/cli.js      CLI entry — parses --dir / --port, calls startServer()
src/server.js   Node HTTP server (no framework) — serves ui.html + REST API
src/ui.html     Single-file browser app — vanilla JS, no bundler
```

**Request flow:**
```
browser  →  GET /api/messages  →  server reads *.json files, flattenObject(), returns { languages, keys, dir }
browser  →  POST /api/save     →  server receives flat keys, writes back to *.json files
```

**Known gap (TODO 1):** `POST /api/save` currently writes flat JSON.  
If the source file was nested (e.g. `{ "hero": { "title": "…" } }`), it becomes flat after first save.  
Fix: implement `unflattenObject()` and restore structure before writing.

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
| 1 | **Round-trip nested JSON** | `server.js` — add `unflattenObject()`, use it in `/api/save` | TODO |
| 2 | **Export CSV** | `server.js` → `GET /api/export/csv` · `ui.html` → `exportCSV()` button | TODO |
| 3 | **Import CSV** | `server.js` → `POST /api/import/csv` · `ui.html` → file-input + `importCSV()` | TODO |
| 4 | **Filter/search** | `ui.html` only — search input in topbar, `filterKeys(query)` hides rows | TODO |
| 5 | **Missing translation indicator** | `ui.html` only — amber/red highlight on empty cells, count in statusbar | TODO |
| 6 | **Completeness per language** | `ui.html` only — pills in statusbar: `en: 12/14 (86%)`, colour-coded | TODO |

Features 1-3 touch the server. Features 4-6 are pure UI (no server changes needed).

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

---

## Dev / test setup

```bash
# Create test fixtures
mkdir -p /tmp/test-i18n-editor/messages
echo '{ "hero": { "title": "Hello", "subtitle": "World" }, "nav": { "home": "Home" } }' \
  > /tmp/test-i18n-editor/messages/en.json
echo '{ "hero": { "title": "Hola" } }' \
  > /tmp/test-i18n-editor/messages/es.json

# Run the editor
node /home/braies/projects/json-i18n-editor/bin/cli.js --dir /tmp/test-i18n-editor/messages
```

Open `http://localhost:3737` to verify. After save, `cat` the JSON files to confirm round-trip.

---

## Git workflow

- Branch: `develop` (always).
- Never push to `main` directly.
- PR: `develop → main` for releases.
