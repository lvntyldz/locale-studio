import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { DEFAULT_CONFIG } from './constants.js';

export const defaultConfig = {
  scanDir: DEFAULT_CONFIG.SCAN_DIR,
  extensions: [...DEFAULT_CONFIG.EXTENSIONS],
  patterns: [...DEFAULT_CONFIG.PATTERNS],
  ignore: [...DEFAULT_CONFIG.IGNORE],
};

/**
 * Resolution order (first wins): i18n.scan.json in cwd, then the
 * "locale-studio" field in cwd's package.json, then defaults.
 */
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
      if (pkg['locale-studio']) {
        fileCfg = pkg['locale-studio'];
        configSource = 'package.json';
      }
    }
  }

  return { ...defaultConfig, ...fileCfg, configSource };
}
