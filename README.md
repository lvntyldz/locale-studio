# json-i18n-editor

A local browser-based editor and auditor for your JSON translation files. No cloud, no account, zero dependencies.

- **Edit** — spreadsheet-style UI: rows = keys, columns = languages. Inline editing, search, CSV import/export, missing-translation highlights, per-language completeness.
- **Audit** — scans your source code for translation calls and cross-references them against your JSON files: keys used in code but missing from JSON (the ones that silently break your UI), and keys in JSON never used in code. Works with any framework.
- **Online mode** — run it on a server with `--password` and edit translations from anywhere: login screen, session cookies, no extra setup.

## Quick start

```bash
cd your-project
npx json-i18n-editor init     # auto-detects your setup, writes i18n.scan.json
npx json-i18n-editor          # opens the editor UI
npx json-i18n-editor audit    # terminal audit — exit 1 if keys are missing (CI-ready)
```

Or install as a dev dependency and add scripts:

```json
{
  "scripts": {
    "i18n": "json-i18n-editor",
    "audit:i18n": "json-i18n-editor audit"
  }
}
```

## The editor

1. Reads all `*.json` files from the locales directory
2. Opens `http://localhost:3737` in your browser
3. Edit inline, add/delete/rename keys, filter, press **Save** or `Ctrl+S`
4. Writes back to disk preserving nested structure
5. The **🔍 Audit** button shows scan results in-app: add a missing key with one click, delete unused ones

Expected layout — one JSON file per language, flat or nested:

```
locales/
  en.json      { "hero": { "title": "Hello" } }
  es.json      { "hero": { "title": "Hola" } }
```

## The audit

`json-i18n-editor audit` scans your source files for translation calls and reports:

```
  ❌  2 missing keys (used in code, not in any JSON):
      hero.badge    src/pages/index.astro:14
      footer.phone  src/layouts/Layout.astro:92

  ⚠   6 unused keys (in JSON, never used in code)
  ⚠   2 dynamic key calls — the unused list may be incomplete
  ⚠   es: 3 untranslated keys
```

Exit code 1 when keys are missing, 0 otherwise — drop `audit:i18n` into CI to block deploys with broken translations.

Recognized out of the box: `t("key")`, `t(lang, "key")`, `$t("key")` (Vue/Nuxt), `i18n.t("key")`, `translate("key")`, `'key' | translate` (Angular). Keys built dynamically (`` t(`item_${i}`) ``) can't be resolved statically; they're counted and reported.

**Namespace wrappers** are resolved automatically. If a file defines a local helper that prefixes a namespace —

```ts
const t = (key: string) => translation(`LOGIN.${key}`)   // template literal
const tc = (key: string) => translation("COMMON." + key) // string concat, useCallback(...) too
```

— then `t("USERNAME")` is correctly audited as `LOGIN.USERNAME`, not `USERNAME`. A wrapper is trusted only when its namespace exists in your JSON files or its inner function is provably i18n (`t`, `translate`, or aliased from `useTranslation()`/`useI18n()`), so lookalike functions never produce false positives.

## Online / production mode

Run the editor on a server (VPS, staging box, LAN machine) and protect it with a password:

```bash
npx json-i18n-editor --password mysecret
# or, keep the password out of shell history:
JSON_I18N_PASSWORD=mysecret npx json-i18n-editor
```

Anyone opening the URL gets a login screen; every API call (read, save, import, audit) requires the session cookie. Sessions live in memory — restarting the server logs everyone out. Wrong attempts are throttled.

Works with any project layout — same `--dir`/config resolution as local mode. The editor is a plain HTTP server on a port: use it directly, or put any reverse proxy of your choice in front for TLS — it needs zero configuration to sit behind one.

Brand it for a client with `--title` (or the `JSON_I18N_TITLE` env var):

```bash
npx json-i18n-editor --password mysecret --title "Acme Corp — Translations"
```

The page title, topbar and login screen show your title instead of the product name.

## `init` — works with any stack

`npx json-i18n-editor init` writes `i18n.scan.json` by detecting:

- **Your locales folder** — searches for directories of `<lang>.json` files
- **Your framework** — package.json dependencies → which file extensions to scan
- **Your custom helpers** — any function called with 3+ of your existing keys as string literals gets a generated pattern automatically. No framework knowledge needed: your keys are the ground truth. Discovers things like `getT(lang, "key")`, `$_("key")` (svelte-i18n), `.instant("key")` (ngx-translate), `__("key")`

```json
{
  "dir": "src/i18n/locales",
  "scanDir": "src",
  "extensions": [".astro", ".ts", ".tsx"],
  "patterns": ["auto", "(?<![\\w$.])getT\\(\\s*[\\w$.]+\\s*,\\s*[\"'`]([\\w.-]+)[\"'`]"],
  "ignore": ["node_modules", "dist", ".git", ".test."]
}
```

`"auto"` expands to the built-in patterns; add your own regexes (capture group 1 = the key) for anything exotic. Config can also live in a `"json-i18n-editor"` field in package.json. With `"dir"` set, no flags are needed for any command.

## Options

```
json-i18n-editor [command] [options]

Commands:
  (none)   Open the editor UI
  audit    Terminal audit, no browser — exit 1 on missing keys
  init     Detect project setup, write i18n.scan.json

Options:
  --dir <path>    Locales folder (default: "dir" from config, else ./messages)
  --port <port>   UI port (default: 3737)
  --scan <path>   Source dir to scan (default: from config, else ./src)
  --force         init only: overwrite existing i18n.scan.json
```

## License

MIT
