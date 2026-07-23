/**
 * Locale Studio - Client Application Script
 * Clean Code Refactored Version with Enums & Constants
 */

// ==========================================
// 0. Constants and Enums
// ==========================================
const TIMINGS = Object.freeze({
  TOAST_DURATION_MS: 2500,
  ROW_HIGHLIGHT_DELAY_MS: 50,
});

const COMPLETENESS_THRESHOLDS = Object.freeze({
  HIGH: 90,
  MEDIUM: 70,
});

const CSS_CLASSES = Object.freeze({
  NEW_ROW: 'new-row',
  MISSING: 'missing',
  DIRTY: 'dirty',
  ERROR: 'error',
  PILL_GREEN: 'pill-green',
  PILL_AMBER: 'pill-amber',
  PILL_RED: 'pill-red',
});

const DOM_IDS = Object.freeze({
  TBODY: 'tbody',
  THEAD: 'thead',
  SEARCH: 'search',
  NS_SELECT: 'ns-select',
  DIR_LABEL: 'dir-label',
  INFO_LABEL: 'info-label',
  SAVE_BTN: 'save-btn',
  MISSING_COUNT: 'missing-count',
  COMPLETENESS_PILLS: 'completeness-pills',
  AUDIT_PANEL: 'audit-panel',
  AUDIT_BADGE: 'audit-badge',
  TOAST: 'toast',
  DOT: 'dot',
  STATUS_MSG: 'status-msg',
});

const KEYBOARD_KEYS = Object.freeze({
  SAVE: 's',
});

// ==========================================
// 1. Application State
// ==========================================
let state = {
  languages: [],
  keys: {},
  dir: 'messages/',
  namespaces: [],
};

let activeNamespace = null;
let dirty = false;
let auditData = null;

// ==========================================
// 2. Utility & Helper Functions
// ==========================================

/**
 * Escapes HTML entities to prevent XSS in rendered templates.
 */
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Automatically resizes textarea height based on content.
 */
function autoResize(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.max(38, el.scrollHeight) + 'px';
}

/**
 * Displays a transient toast notification.
 */
function showToast(message, type = '') {
  const toastEl = document.getElementById(DOM_IDS.TOAST);
  if (!toastEl) return;

  toastEl.textContent = message;
  toastEl.className = `toast show ${type}`;

  clearTimeout(toastEl._timer);
  toastEl._timer = setTimeout(() => {
    toastEl.className = 'toast';
  }, TIMINGS.TOAST_DURATION_MS);
}

/**
 * Updates status bar message and dot indicator.
 */
function setStatus(type, message) {
  const dot = document.getElementById(DOM_IDS.DOT);
  const statusMsg = document.getElementById(DOM_IDS.STATUS_MSG);

  if (statusMsg) statusMsg.textContent = message;
  if (dot) {
    dot.className = 'dot' + (type === CSS_CLASSES.DIRTY ? ' dirty' : type === CSS_CLASSES.ERROR ? ' error' : '');
  }
}

/**
 * Marks current state as unsaved (dirty).
 */
function markDirty() {
  if (!dirty) {
    dirty = true;
    setStatus(CSS_CLASSES.DIRTY, 'Unsaved changes');
  }
}

/**
 * Determines default namespace to fall back on ('common' or first available).
 */
function getDefaultNamespace() {
  if (state.namespaces && state.namespaces.includes('common')) {
    return 'common';
  }
  return (state.namespaces && state.namespaces[0]) || 'common';
}

/**
 * Smoothly scrolls to a key's table row and highlights it.
 */
function highlightRow(key, focusInput = false) {
  setTimeout(() => {
    const safeKey = CSS.escape(key);
    const row = document.querySelector(`tr[data-key="${safeKey}"]`);
    if (row) {
      row.classList.add(CSS_CLASSES.NEW_ROW);
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (focusInput) {
        row.querySelector('textarea')?.focus();
      }
    }
  }, TIMINGS.ROW_HIGHLIGHT_DELAY_MS);
}

// ==========================================
// 3. State Management & Data Fetching
// ==========================================

/**
 * Reads all current form values from table rows and merges them into state keys.
 */
function collectState() {
  const currentKeys = {};
  document.querySelectorAll('tr[data-key]').forEach((row) => {
    const keyInput = row.querySelector('.key-input');
    const keyName = keyInput ? keyInput.value.trim() : row.dataset.key;

    if (!keyName) return;

    currentKeys[keyName] = {};
    state.languages.forEach((lang) => {
      const textarea = row.querySelector(`textarea[data-lang="${lang}"]`);
      currentKeys[keyName][lang] = textarea ? textarea.value : '';
    });
  });
  return currentKeys;
}

/**
 * Initial load: fetches translations and populates namespace dropdown.
 */
async function load() {
  try {
    const response = await fetch('/api/messages');
    state = await response.json();

    const nsSelect = document.getElementById(DOM_IDS.NS_SELECT);
    if (nsSelect) {
      nsSelect.innerHTML = '';
      if (state.namespaces) {
        if (!activeNamespace && state.namespaces.length > 0) {
          activeNamespace = state.namespaces[0];
        }
        state.namespaces.forEach((ns) => {
          const opt = document.createElement('option');
          opt.value = ns;
          opt.textContent = ns;
          nsSelect.appendChild(opt);
        });
      }
    }

    const params = new URLSearchParams(window.location.search);
    if (params.has('ns')) {
      activeNamespace = params.get('ns');
      if (nsSelect) nsSelect.value = activeNamespace;
    }
    if (params.has('q')) {
      const searchInput = document.getElementById(DOM_IDS.SEARCH);
      if (searchInput) searchInput.value = params.get('q');
    }

    render();

    if (params.has('q')) {
      filterKeys(params.get('q'));
    }
  } catch (error) {
    setStatus(CSS_CLASSES.ERROR, 'Failed to load — is the server running?');
  }
}

/**
 * Saves all translation keys to the server.
 */
async function saveAll() {
  state.keys = { ...state.keys, ...collectState() };
  const btn = document.getElementById(DOM_IDS.SAVE_BTN);
  if (btn) {
    btn.textContent = 'Saving…';
    btn.classList.add('saving');
  }
  setStatus(CSS_CLASSES.DIRTY, 'Saving…');

  try {
    const response = await fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
    });

    if (!response.ok) throw new Error('Server error');

    dirty = false;
    if (btn) {
      btn.textContent = 'Save';
      btn.classList.remove('saving');
    }
    setStatus('ok', 'Saved');
    showToast('Saved ✓', 'ok');
  } catch (error) {
    if (btn) {
      btn.textContent = 'Save';
      btn.classList.remove('saving');
    }
    setStatus(CSS_CLASSES.ERROR, 'Error saving');
    showToast('Error saving files', 'err');
  }
}

// ==========================================
// 4. Main Rendering Engine
// ==========================================

/**
 * Main render function: builds table header, rows, and updates indicators.
 */
function render() {
  const dirLabel = document.getElementById(DOM_IDS.DIR_LABEL);
  if (dirLabel) dirLabel.textContent = state.dir;

  const keysToRender = Object.keys(state.keys).filter((key) => {
    if (!activeNamespace) return true;
    return key.startsWith(activeNamespace + ':');
  });

  const infoLabel = document.getElementById(DOM_IDS.INFO_LABEL);
  if (infoLabel) {
    infoLabel.textContent = `${keysToRender.length} keys · ${state.languages.length} langs`;
  }

  // Build <thead>
  let headHtml = `<tr><th class="th-key">Key (${keysToRender.length})</th>`;
  state.languages.forEach((lang) => {
    headHtml += `<th class="th-lang">${esc(lang)}</th>`;
  });
  headHtml += `<th class="th-del"></th></tr>`;

  const thead = document.getElementById(DOM_IDS.THEAD);
  if (thead) thead.innerHTML = headHtml;

  // Build <tbody>
  let bodyHtml = '';
  keysToRender.forEach((key) => {
    bodyHtml += `<tr data-key="${esc(key)}">
      <td class="td-key">
        <div class="key-wrap">
          <input class="key-input" type="text" value="${esc(key)}"
            onchange="renameKey('${esc(key)}', this)"
            oninput="markDirty()">
        </div>
      </td>`;

    state.languages.forEach((lang) => {
      const val = state.keys[key][lang] ?? '';
      bodyHtml += `<td>
        <textarea class="val-input" data-lang="${esc(lang)}"
          oninput="autoResize(this); markDirty()">${esc(val)}</textarea>
      </td>`;
    });

    bodyHtml += `<td>
      <button class="btn" style="color:#ef4444;background:transparent;padding:6px;width:30px;font-size:16px" onclick="deleteKey('${esc(key)}')">×</button>
    </td></tr>`;
  });

  if (!keysToRender.length) {
    bodyHtml = `<tr><td colspan="${state.languages.length + 2}">
      <div class="empty">
        <h2>No translations yet in this namespace</h2>
        <p>Click "＋ Add Key" to create your first translation key.</p>
      </div>
    </td></tr>`;
  }

  const tbody = document.getElementById(DOM_IDS.TBODY);
  if (tbody) tbody.innerHTML = bodyHtml;

  document.querySelectorAll('textarea').forEach(autoResize);
  markMissing();
  updateCompleteness();

  dirty = false;
  setStatus('ok', 'Ready');
}

/**
 * Filter/search: hides rows whose key or values don't match query.
 */
function filterKeys(query) {
  const q = query.trim().toLowerCase();
  document.querySelectorAll('#tbody tr[data-key]').forEach((row) => {
    const key = (row.dataset.key || '').toLowerCase();
    const values = Array.from(row.querySelectorAll('textarea'), (ta) => ta.value.toLowerCase()).join(' ');
    row.style.display = !q || key.includes(q) || values.includes(q) ? '' : 'none';
  });
}

/**
 * Highlights empty translation cells and displays missing count badge.
 */
function markMissing() {
  let count = 0;
  document.querySelectorAll('textarea.val-input').forEach((textarea) => {
    const cell = textarea.closest('td');
    if (!textarea.value.trim()) {
      if (cell) cell.classList.add(CSS_CLASSES.MISSING);
      count++;
    } else if (cell) {
      cell.classList.remove(CSS_CLASSES.MISSING);
    }
  });

  const missingEl = document.getElementById(DOM_IDS.MISSING_COUNT);
  if (missingEl) {
    if (count > 0) {
      missingEl.style.display = '';
      missingEl.textContent = `⚠ ${count} missing`;
    } else {
      missingEl.style.display = 'none';
    }
  }
}

/**
 * Renders per-language completeness pills in status bar.
 */
function updateCompleteness() {
  const { languages, keys } = state;
  const entries = Object.entries(keys);
  const total = entries.length;
  const pillsEl = document.getElementById(DOM_IDS.COMPLETENESS_PILLS);

  if (!pillsEl) return;

  if (!total) {
    pillsEl.innerHTML = '';
    return;
  }

  const pillsHtml = languages.map((lang) => {
    const filled = entries.filter(([, vals]) => (vals[lang] ?? '').trim() !== '').length;
    const pct = Math.round((filled / total) * 100);
    const colorClass = pct >= COMPLETENESS_THRESHOLDS.HIGH
      ? CSS_CLASSES.PILL_GREEN
      : pct >= COMPLETENESS_THRESHOLDS.MEDIUM
        ? CSS_CLASSES.PILL_AMBER
        : CSS_CLASSES.PILL_RED;
    return `<span class="pill ${colorClass}">${lang} ${filled}/${total} ${pct}%</span>`;
  });

  pillsEl.innerHTML = pillsHtml.join('');
}

// ==========================================
// 5. Namespace & Key Operations
// ==========================================

/**
 * Switches current active namespace, prompting if unsaved changes exist.
 */
function switchNamespace(ns) {
  if (dirty) {
    if (!confirm('You have unsaved changes! Discard them and switch?')) {
      const nsSelect = document.getElementById(DOM_IDS.NS_SELECT);
      if (nsSelect) nsSelect.value = activeNamespace;
      return;
    }
  }

  state.keys = { ...state.keys, ...collectState() };
  activeNamespace = ns;
  dirty = false;
  render();
}

/**
 * Renames an existing translation key.
 */
function renameKey(oldKey, input) {
  const newKey = input.value.trim();

  if (!newKey || newKey === oldKey) {
    input.value = oldKey;
    return;
  }

  if (state.keys[newKey] !== undefined) {
    showToast('Key already exists', 'err');
    input.value = oldKey;
    return;
  }

  const values = state.keys[oldKey];
  delete state.keys[oldKey];
  state.keys[newKey] = values;

  const row = input.closest('tr');
  if (row) row.dataset.key = newKey;

  input.value = newKey;
  markDirty();
}

/**
 * Manually adds a new key via prompt dialog.
 */
function addKey() {
  const inputKey = prompt('New key name (e.g. hero_title):');
  if (!inputKey?.trim()) return;

  let finalKey = inputKey.trim();

  if (!finalKey.includes(':') && activeNamespace) {
    finalKey = activeNamespace + ':' + finalKey;
  }

  if (state.keys[finalKey] !== undefined) {
    showToast('Key already exists', 'err');
    highlightRow(finalKey, true);
    return;
  }

  state.keys = { ...state.keys, ...collectState() };
  state.keys[finalKey] = Object.fromEntries(state.languages.map((l) => [l, '']));
  render();
  markDirty();

  highlightRow(finalKey, true);
}

/**
 * Deletes a translation key.
 */
function deleteKey(key) {
  if (!confirm(`Delete key "${key}"?\nThis cannot be undone.`)) return;

  state.keys = { ...state.keys, ...collectState() };
  delete state.keys[key];
  render();
  markDirty();
}

// ==========================================
// 6. CSV Import / Export
// ==========================================

function exportCSV() {
  const link = document.createElement('a');
  link.href = '/api/export/csv';
  link.download = 'messages.csv';
  link.click();
}

async function importCSV(input) {
  const file = input.files?.[0];
  if (!file) return;

  input.value = '';
  setStatus(CSS_CLASSES.DIRTY, 'Importing…');

  try {
    const text = await file.text();
    const response = await fetch('/api/import/csv', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: text,
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Import failed');

    state = data;
    render();
    markDirty();
    showToast(`Imported ${Object.keys(data.keys).length} keys ✓`, 'ok');
  } catch (error) {
    setStatus(CSS_CLASSES.ERROR, 'Import error');
    showToast('Import failed: ' + error.message, 'err');
  }
}

// ==========================================
// 7. Audit Engine (Scanner & Recommendations)
// ==========================================

async function toggleAudit() {
  const panel = document.getElementById(DOM_IDS.AUDIT_PANEL);
  if (!panel) return;

  if (panel.style.display !== 'none') {
    panel.style.display = 'none';
    return;
  }

  panel.style.display = '';
  panel.innerHTML = '<div class="audit-meta">Scanning…</div>';
  await refreshAudit();
}

async function refreshAudit({ silent = false } = {}) {
  try {
    const response = await fetch('/api/audit');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Audit failed');
    auditData = data;
  } catch (error) {
    auditData = { error: error.message };
  }

  updateAuditBadge();
  if (!silent) renderAuditPanel();
}

function updateAuditBadge() {
  const badge = document.getElementById(DOM_IDS.AUDIT_BADGE);
  if (!badge) return;

  const count = auditData?.missing?.length || 0;
  badge.style.display = count ? '' : 'none';
  badge.textContent = count;
}

function renderAuditPanel() {
  const panel = document.getElementById(DOM_IDS.AUDIT_PANEL);
  if (!panel || panel.style.display === 'none') return;

  if (!auditData) {
    panel.innerHTML = '<div class="empty">Loading audit data...</div>';
    return;
  }

  const missingCount = auditData.missing ? auditData.missing.length : 0;
  const unusedCount = auditData.unused ? auditData.unused.length : 0;

  let html = `<div class="audit-head">
    <h2><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/></svg> Audit Results</h2>
    <div class="audit-meta">Scanned ${auditData.filesScanned || 0} files in ${esc(auditData.scanDir)}</div>
  </div>`;

  if (missingCount === 0 && unusedCount === 0) {
    html += `<div class="empty">
      <h2>All good!</h2>
      <p>No missing or unused translations found.</p>
    </div>`;
  } else {
    if (missingCount > 0) {
      html += `<div class="audit-section">
        <h3><span>Missing Keys</span> <span class="pill pill-amber">${missingCount}</span></h3>`;
      auditData.missing.forEach((item) => {
        const refsText = (item.refs || []).map((r) => `${r.file}:${r.line}`).join(', ');
        html += `<div class="audit-row">
          <div class="audit-row-content">
            <span class="audit-key-text">${esc(item.key)}</span>
            <div class="audit-ref">${esc(refsText)}</div>
          </div>
          <button class="audit-mini-btn" onclick="auditAddKey('${esc(item.key)}')"><img src="/public/assets/add_dark.svg" class="icon" /> Add</button>
        </div>`;
      });
      html += `</div>`;
    }

    if (unusedCount > 0) {
      html += `<div class="audit-section">
        <h3><span>Unused Keys</span> <span class="pill pill-red">${unusedCount}</span></h3>`;
      auditData.unused.forEach((key) => {
        html += `<div class="audit-row">
          <div class="audit-row-content">
            <span class="audit-key-text">${esc(key)}</span>
          </div>
          <button class="audit-mini-btn danger" onclick="auditDeleteKey('${esc(key)}')"><img src="/public/assets/del_red.svg" class="icon" /> Delete</button>
        </div>`;
      });
      html += `</div>`;
    }

    if (auditData.dynamicCalls > 0) {
      html += `<div class="audit-warn">
        <strong>Note:</strong> Found ${auditData.dynamicCalls} dynamic t() calls (e.g. <code>t(variable)</code>). 
        These cannot be statically analyzed.
      </div>`;
    }
  }

  panel.innerHTML = html;
}

function auditAddKey(key) {
  let finalKey = key;
  let targetNs = null;

  if (finalKey.includes(':')) {
    targetNs = finalKey.split(':')[0];
  } else {
    targetNs = getDefaultNamespace();
    finalKey = targetNs + ':' + finalKey;
  }

  // Save current uncommitted input state
  state.keys = { ...state.keys, ...collectState() };

  // Switch active namespace if different so the target namespace is shown on screen
  if (targetNs && state.namespaces && state.namespaces.includes(targetNs) && activeNamespace !== targetNs) {
    activeNamespace = targetNs;
    const nsSelect = document.getElementById(DOM_IDS.NS_SELECT);
    if (nsSelect) nsSelect.value = targetNs;
  }

  if (state.keys[finalKey] !== undefined) {
    render();
    highlightRow(finalKey);
    return;
  }

  state.keys[finalKey] = Object.fromEntries(state.languages.map((l) => [l, '']));
  render();
  markDirty();

  auditData.missing = auditData.missing.filter((m) => m.key !== key);
  updateAuditBadge();
  renderAuditPanel();

  highlightRow(finalKey);
  showToast(`Added "${finalKey}" in ${targetNs} — fill it in and save`, 'ok');
}

function auditDeleteKey(key) {
  deleteKey(key);
  if (state.keys[key] === undefined) {
    auditData.unused = auditData.unused.filter((k) => k !== key);
    renderAuditPanel();
  }
}

// ==========================================
// 8. Navigation & Event Listeners
// ==========================================

function goHome() {
  if (dirty) {
    if (!confirm('You have unsaved changes! Discard them and return to home?')) {
      return;
    }
    dirty = false;
  }
  window.location.href = '/';
}

// Keyboard shortcuts (Ctrl+S / Cmd+S to Save)
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === KEYBOARD_KEYS.SAVE) {
    e.preventDefault();
    saveAll();
  }
});

// Prompt user before refreshing or navigating away with unsaved changes
window.addEventListener('beforeunload', (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// Close audit panel when clicking outside of it
document.addEventListener('click', (e) => {
  const panel = document.getElementById(DOM_IDS.AUDIT_PANEL);
  const auditBtn = document.querySelector('.btn-audit');
  if (
    panel &&
    panel.style.display !== 'none' &&
    !panel.contains(e.target) &&
    (!auditBtn || !auditBtn.contains(e.target))
  ) {
    panel.style.display = 'none';
  }
});

// Initial boot
load();
refreshAudit({ silent: true });
