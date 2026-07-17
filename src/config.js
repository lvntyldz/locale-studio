import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

export const defaultConfig = {
  scanDir: 'src',
  extensions: ['.astro', '.ts', '.tsx', '.vue', '.svelte', '.js', '.jsx', '.html'],
  patterns: ['auto'],
  ignore: ['node_modules', 'dist', '.git', '.test.'],
};

// Resolution order (first wins): i18n.scan.json in cwd, then the
// "json-i18n-editor" field in cwd's package.json, then defaults.
// Paths in the config are relative to the cwd the CLI runs from.
// The optional "dir" field points at the locales folder so the CLI
// works without --dir. configSource tells the CLI where config came from.
export async function resolveConfig(cwd = process.cwd()) {
  let fileCfg = {};
  let configSource = 'defaults';

  const scanFile = join(cwd, 'i18n.scan.json');
  if (existsSync(scanFile)) {
    fileCfg = JSON.parse(await readFile(scanFile, 'utf8'));
    configSource = 'i18n.scan.json';
  } else {
    const pkgFile = join(cwd, 'package.json');
    if (existsSync(pkgFile)) {
      const pkg = JSON.parse(await readFile(pkgFile, 'utf8'));
      if (pkg['json-i18n-editor']) {
        fileCfg = pkg['json-i18n-editor'];
        configSource = 'package.json';
      }
    }
  }

  return { ...defaultConfig, ...fileCfg, configSource };
}
