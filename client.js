const INVISIBLE_MARKER_REGEX = /\uFEFF([\u200B\u200C\u200D]+)\u200E/g;

function encodeInvisible(str) {
  const encoded = str
    .split('')
    .map((c) => {
      return c
        .charCodeAt(0)
        .toString(2)
        .split('')
        .map((bit) => (bit === '1' ? '\u200B' : '\u200C'))
        .join('');
    })
    .join('\u200D');
  return '\uFEFF' + encoded + '\u200E';
}

function decodeInvisible(encodedStr) {
  return encodedStr
    .split('\u200D')
    .map((charBits) => {
      const binary = charBits
        .split('')
        .map((bit) => (bit === '\u200B' ? '1' : '0'))
        .join('');
      return String.fromCharCode(parseInt(binary, 2));
    })
    .join('');
}

function showEditorToastAndOpen(ns, key, options) {
  const editorPort = options.editorPort || 3737;
  const pingPort = options.pingPort || 3736;
  
  const toast = document.createElement('div');
  toast.textContent = `📋 Copied: ${key} (Opening Locale Studio...)`;
  Object.assign(toast.style, {
    position: 'fixed',
    bottom: '20px',
    right: '20px',
    background: '#10b981',
    color: 'white',
    padding: '12px 24px',
    borderRadius: '8px',
    fontFamily: 'system-ui, sans-serif',
    fontSize: '14px',
    fontWeight: '600',
    zIndex: '999999',
    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
    transition: 'opacity 0.3s ease',
  });
  document.body.appendChild(toast);

  fetch(`http://localhost:${pingPort}/start?ns=${ns}`, { method: 'POST' })
    .then(() => {
      // Open the editor in a new tab, passing the namespace and key
      window.open(`http://localhost:${editorPort}/?ns=${encodeURIComponent(ns)}&q=${encodeURIComponent(key)}`, '_blank');
    })
    .catch(() => {
      // Fallback open if ping server isn't running or needed
      window.open(`http://localhost:${editorPort}/?ns=${encodeURIComponent(ns)}&q=${encodeURIComponent(key)}`, '_blank');
    })
    .finally(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    });
}

export const devtoolsPostProcessor = {
  type: 'postProcessor',
  name: 'devtools',
  process: function (value, key, options, translator) {
    if (!value || typeof value !== 'string') return value;

    let actualKey = Array.isArray(key) ? key[0] : key;
    let ns = options.ns || (translator && translator.options && translator.options.defaultNS) || 'common';

    // If key contains a namespace prefix (e.g., 'passenger:key'), extract it.
    const nsSeparator = (translator && translator.options && translator.options.nsSeparator) || ':';
    if (typeof actualKey === 'string' && actualKey.includes(nsSeparator)) {
      const parts = actualKey.split(nsSeparator);
      ns = parts[0];
      actualKey = parts.slice(1).join(nsSeparator);
    }

    return value + encodeInvisible(ns + ':' + actualKey);
  },
};

export function initI18nInspector(options = {}) {
  const handleGlobalClick = async (e) => {
    // Opt to use Alt/Option + Click. Standard Cmd+Click is often used for "open link in new tab".
    if (!e.altKey) return;

    const target = e.target;
    if (!target) return;

    // Extract text content or input value/placeholder
    const text = target.textContent || target.value || target.placeholder || '';

    const matches = [...text.matchAll(INVISIBLE_MARKER_REGEX)];
    if (matches.length > 0) {
      // Prevent default behavior (e.g. following links, submitting forms)
      e.preventDefault();
      e.stopPropagation();

      const match = matches[matches.length - 1];
      const decoded = decodeInvisible(match[1]);
      const [ns, ...keyParts] = decoded.split(':');
      const key = keyParts.join(':');

      try {
        await navigator.clipboard.writeText(key);
      } catch (err) {
        console.error('[i18n-inspector] Failed to copy to clipboard:', err);
      }

      showEditorToastAndOpen(ns, key, options);
    }
  };

  document.addEventListener('click', handleGlobalClick, { capture: true });
  return () => {
    document.removeEventListener('click', handleGlobalClick, { capture: true });
  };
}
