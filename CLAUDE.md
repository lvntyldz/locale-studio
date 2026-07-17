# CLAUDE.md — locale-studio

## Big Picture

`locale-studio` is a **zero-dependency, local browser-based editor** for JSON i18n files.
It works entirely offline. You run it with `npx`, edit translations in a spreadsheet-style UI, and save directly to your files.
You can protect the editor with a password (`--password`) if you run it online (on a VPS, staging box, or local network). We do not include SSL in this tool; that is the job of a reverse proxy.

### Architecture

```
bin/cli.js      CLI entry point — handles UI mode (startServer), audit mode, and init mode
bin/proxy.js    Proxy server — starts the main CLI editor and runs a ping server on port 3736 for Alt+Click integration
client.js       Browser script — handles Alt+Click click handlers and encodes/decodes zero-width characters
react.js        React hook — provides useI18nInspector for easy development integration
src/server.js   Node HTTP server (no framework) — serves ui.html and REST API
src/ui.html     Single-file browser application — written in vanilla JS with no bundler
src/scanner.js  Code scanner — finds t("key") calls in source files and checks for missing/unused keys
src/config.js   Config resolver — resolves options from i18n.scan.json, package.json, or defaults
src/init.js     `init` subcommand — detects local directories, framework, and custom translation helpers
```

**Request flow:**

```
browser  →  GET /api/messages  →  server reads [lang]/[namespace].json files, flattens objects, returns languages, keys, and namespaces
browser  →  POST /api/save     →  server receives flat keys, groups them by namespace, unflattens, and writes to files
browser  →  GET /api/audit     →  server scans source code, checks against keys, and returns missing, unused, and untranslated keys
```

---

## Coding Rules

- **No external dependencies.** Keep `package.json` dependency-free. Use only Node.js standard libraries.
- **No bundler.** `ui.html` is a single self-contained HTML file. All JS/CSS must be inline.
- **No TypeScript.** Use plain ESM `.js` files.
- **No client framework.** Do not use React or Vue in the browser UI. Use vanilla DOM APIs.
- **Dot-notation keys.** Keep the flat dot-notation format for communication between the server and the browser.

---

## Feature Roadmap

| #   | Feature                                   | Files touched                                                                 | Status        |
| --- | ----------------------------------------- | ----------------------------------------------------------------------------- | ------------- |
| 1   | **Round-trip nested JSON**                | `server.js` — add `unflattenObject()`, use it in `/api/save`                  | DONE (v0.2.0) |
| 2   | **Export CSV**                            | `server.js` → `GET /api/export/csv`, `ui.html` → export button                | DONE (v0.2.0) |
| 3   | **Import CSV**                            | `server.js` → `POST /api/import/csv`, `ui.html` → import button               | DONE (v0.2.0) |
| 4   | **Filter/search**                         | `ui.html` — search input in topbar, filter keys without full render           | DONE (v0.3.0) |
| 5   | **Missing translation indicator**         | `ui.html` — highlight empty cells and show count in status bar               | DONE (v0.3.0) |
| 6   | **Completeness per language**             | `ui.html` — show color-coded completeness pills in status bar                 | DONE (v0.3.0) |
| 7   | **Code scanner / audit**                  | `scanner.js`, `config.js`, `server.js` → `/api/audit`, `cli.js` → `audit` cmd | DONE (v0.3.0) |
| 8   | **`init` configuration generator**        | `init.js`, `cli.js` → `init` cmd, `--force` flag                              | DONE (v0.5.0) |
| 9   | **Password-protected online mode**        | `server.js` → login page, session cookies, `cli.js` → `--password`            | DONE (v0.7.0) |
| 10  | **White-label branding**                  | `server.js` → replace product name in UI with `--title` value                  | DONE (v0.8.0) |
| 11  | **Multi-Namespace support**               | `server.js`, `init.js`, `ui.html` — load/save by namespaces in folders         | DONE (v0.9.0) |
| 12  | **Alt+Click Inspector integration**        | `client.js`, `react.js`, `bin/proxy.js` — interactive devtools helper         | DONE (v0.9.0) |

---

## Implementation Details

### 11 — Multi-Namespace Support

- The locales directory uses subdirectories for each language (e.g. `locales/en/`).
- Inside each language folder, we have namespace JSON files (e.g. `common.json`, `login.json`).
- On load, keys are flattened and prefixed with their namespace (for example: `common:welcome`).
- The UI contains a dropdown to filter and view keys by a specific namespace or all namespaces.
- URL query parameters (`?ns=...&q=...`) allow direct navigation and filtering.

### 12 — Alt+Click Inspector Integration

- The `devtools` postProcessor embeds invisible zero-width character markers into translated strings.
- In development, the client script listens to global clicks. Holding `Alt` (or `Option` on macOS) and clicking text decodes the key and namespace from the text.
- It then copies the key to the clipboard and opens the Locale Studio UI at the correct namespace and query.
- The proxy server runs a backend helper on port 3736 to communicate with the client app.

---

## Development and Testing

```bash
# 1. Create a test directory with namespace folders
mkdir -p /tmp/test-locale-studio/messages/en
mkdir -p /tmp/test-locale-studio/messages/es

# 2. Add some test namespace files
echo '{ "welcome": "Welcome", "logout": "Log Out" }' > /tmp/test-locale-studio/messages/en/common.json
echo '{ "welcome": "Bienvenido" }' > /tmp/test-locale-studio/messages/es/common.json

# 3. Start the editor (from repo root)
node bin/cli.js --dir /tmp/test-locale-studio/messages

# 4. Or start with the proxy server (Alt+Click integration test)
node bin/proxy.js --dir /tmp/test-locale-studio/messages
```

Open `http://localhost:3737` in your browser to verify.

---

## Git Workflow

- Main branch: `main`.
- All development happens in feature branches or forks.
- Open pull requests for review before merging changes into `main`.
