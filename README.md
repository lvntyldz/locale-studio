# json-i18n-editor

A local browser-based editor for your JSON translation files. No cloud, no account, no config.

Opens a spreadsheet-style UI where you can add, edit and delete translation keys across all your languages.

## Usage

```bash
# Run directly without installing
npx json-i18n-editor

# Or install as dev dependency
npm install json-i18n-editor --save-dev
```

Add to your `package.json`:
```json
{
  "scripts": {
    "i18n": "json-i18n-editor"
  }
}
```

Then run:
```bash
npm run i18n
```

## Options

```
--dir <path>    Path to messages folder (default: ./messages)
--port <port>   Port (default: 3737)
```

## Expected folder structure

```
messages/
  es.json
  it.json
  en.json
```

Each file is a flat or nested JSON object with string values.

## How it works

1. Reads all `*.json` files from the messages directory
2. Opens `http://localhost:3737` in your browser
3. Shows a table: rows = keys, columns = languages
4. Edit inline, add/delete keys, press **Save** or `Ctrl+S`
5. Writes back to the JSON files on disk

## License

MIT
