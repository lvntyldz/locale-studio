# locale-studio

A local, browser-based editor and auditing tool for your JSON translation files. There is no cloud, no account, and zero external dependencies.

- **Spreadsheet UI** — Edit inline, search/filter keys, import/export CSV, and see completeness metrics for each language.
- **Multi-Namespace Support** — Supports translation files grouped by language folders and namespace files (e.g., `locales/en/common.json` and `locales/es/common.json`).
- **Alt+Click Inspector** — Alt+Click on any translated text in your web application to open its key directly in the editor and copy it to the clipboard.
- **Audit Tool** — Scans your code to find translation keys that are missing from JSON or keys in JSON that are not used in your code. Works on any framework and is ready for CI.
- **Online Mode** — Protect the editor with a password (`--password`) to edit translations on a staging server.

## Quick Start

```bash
cd your-project
npx locale-studio init     # Detects your setup and creates i18n.scan.json
npx locale-studio          # Opens the editor in your browser
npx locale-studio audit    # Runs the audit in your terminal (exits 1 if keys are missing)
```

Or install it as a development dependency:

```json
{
  "devDependencies": {
    "locale-studio": "^0.9.0"
  },
  "scripts": {
    "i18n": "locale-studio",
    "audit:i18n": "locale-studio audit"
  }
}
```

## Folder Structure

Locale Studio expects your translation files to be organized by language folders and namespace files:

```
locales/
  en/
    common.json    { "welcome": "Welcome" }
    login.json     { "title": "Log In" }
  es/
    common.json    { "welcome": "Bienvenido" }
    login.json     { "title": "Iniciar sesión" }
```

In the editor UI, keys are shown as `namespace:key` (for example, `common:welcome`).

## Alt+Click Inspector Integration

You can easily locate translation keys from your running web app in development. 

### React Integration
Import the hook in your main layout or app file:

```jsx
import { useI18nInspector } from 'locale-studio/react';

function App() {
  // This hook is inactive in production automatically
  useI18nInspector();
  
  return <YourApp />;
}
```

### Vanilla JS Integration
Import and initialize the client script:

```js
import { initI18nInspector } from 'locale-studio/client';

if (process.env.NODE_ENV !== 'production') {
  initI18nInspector();
}
```

### Setup i18next PostProcessor
Add the `devtools` postProcessor to your i18n configuration:

```js
import i18n from 'i18next';
import { devtoolsPostProcessor } from 'locale-studio/client';

i18n
  .use(devtoolsPostProcessor)
  .init({
    postProcess: ['devtools'],
    // your other options...
  });
```

When you hold `Alt` (or `Option` on Mac) and click on any translated text on your website, Locale Studio will copy the key to your clipboard and open the editor on the exact page.

## Options

```
locale-studio [command] [options]

Commands:
  (none)   Open the editor UI
  audit    Check translation keys in terminal (no browser)
  init     Detect project setup and write i18n.scan.json

Options:
  --dir <path>    Locales folder (default: "dir" from config, or ./messages)
  --port <port>   UI port (default: 3737)
  --scan <path>   Source code directory to scan (default: from config, or ./src)
  --password <p>  Password for online mode
  --title <t>     Custom title for white-labeling
  --force         Overwrite i18n.scan.json during init
```

## License

MIT
