/**
 * Shared Constants and Enums for Locale Studio
 */

export const TIMINGS = Object.freeze({
  TOAST_DURATION_MS: 2500,
  ROW_HIGHLIGHT_DELAY_MS: 50,
  BRUTE_FORCE_DELAY_MS: 800,
  SESSION_MAX_AGE_SEC: 86400,
});

export const HTTP_STATUS = Object.freeze({
  OK: 200,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,
});

export const MIME_TYPES = Object.freeze({
  JSON: 'application/json',
  HTML: 'text/html; charset=utf-8',
  CSV: 'text/csv; charset=utf-8',
  TEXT: 'text/plain; charset=utf-8',
  CSS: 'text/css',
  JAVASCRIPT: 'text/javascript',
  SVG: 'image/svg+xml',
  PNG: 'image/png',
});

export const API_ROUTES = Object.freeze({
  HOME: '/',
  INDEX_HTML: '/index.html',
  MESSAGES: '/api/messages',
  SAVE: '/api/save',
  EXPORT_CSV: '/api/export/csv',
  IMPORT_CSV: '/api/import/csv',
  AUDIT: '/api/audit',
  LOGIN: '/api/login',
});

export const LIMITS = Object.freeze({
  MAX_LOGIN_BODY_BYTES: 4096,
  MAX_SESSIONS_COUNT: 100,
  TOKEN_BYTES: 32,
});

export const PLURAL_SUFFIXES = Object.freeze([
  '_one',
  '_other',
  '_zero',
  '_two',
  '_few',
  '_many',
  '_0',
  '_1',
  '_2',
]);

export const DEFAULT_NAMESPACES = Object.freeze(['common', 'translation']);

export const REGEX_PATTERNS = Object.freeze({
  LANG_FILE: /^[a-z]{2,3}([-_][A-Za-z]{2,4})?\.json$/,
  LANG_DIR: /^[a-z]{2,3}([-_][A-Za-z]{2,4})?$/,
  DYN_PREFIX: /(?:`([\w.:/-]+)\.\$\{)|(?:["'`\s]*([\w.:/-]+)\.["'`]\s*\+)/g,
  PATH_TRAVERSAL: /[\\/\\\\]|^\.\./,
  SESSION_COOKIE: /(?:^|;\s*)i18n_session=([a-f0-9]{64})/,
});

export const DEFAULT_CONFIG = Object.freeze({
  SCAN_DIR: 'src',
  EXTENSIONS: Object.freeze(['.astro', '.ts', '.tsx', '.vue', '.svelte', '.js', '.jsx', '.html']),
  PATTERNS: Object.freeze(['auto']),
  IGNORE: Object.freeze(['node_modules', 'dist', '.git', '.test.']),
});
