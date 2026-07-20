// Feature 4: Filter/search — hides rows whose key or values don't match the query
function filterKeys(query) {
  const q = query.trim().toLowerCase()
  document.querySelectorAll('#tbody tr[data-key]').forEach(row => {
    const key = (row.dataset.key || '').toLowerCase()
    const vals = Array.from(row.querySelectorAll('textarea'), ta => ta.value.toLowerCase()).join(' ')
    row.style.display = !q || key.includes(q) || vals.includes(q) ? '' : 'none'
  })
}

// Feature 5: Highlight empty translation cells with amber background + show count
function markMissing() {
  let count = 0
  document.querySelectorAll('textarea.val-input').forEach(ta => {
    const td = ta.closest('td')
    if (!ta.value.trim()) { td.classList.add('missing'); count++ }
    else td.classList.remove('missing')
  })
  const el = document.getElementById('missing-count')
  if (count > 0) { el.style.display = ''; el.textContent = `⚠ ${count} missing` }
  else el.style.display = 'none'
}

// Feature 6: Per-language completeness pills in statusbar
function updateCompleteness() {
  const { languages, keys } = state
  const entries = Object.entries(keys)
  const total = entries.length
  if (!total) { document.getElementById('completeness-pills').innerHTML = ''; return }
  const pills = languages.map(lang => {
    const filled = entries.filter(([, vals]) => (vals[lang] ?? '').trim() !== '').length
    const pct = Math.round((filled / total) * 100)
    const cls = pct >= 90 ? 'pill-green' : pct >= 70 ? 'pill-amber' : 'pill-red'
    return `<span class="pill ${cls}">${lang} ${filled}/${total} ${pct}%</span>`
  })
  document.getElementById('completeness-pills').innerHTML = pills.join('')
}

let state = { languages: [], keys: {}, dir: 'messages/', namespaces: [] }
let activeNamespace = null
let dirty = false

async function load() {
  try {
    const r = await fetch('/api/messages')
    state = await r.json()

    const nsSelect = document.getElementById('ns-select')
    nsSelect.innerHTML = ''
    if (state.namespaces) {
      if (!activeNamespace && state.namespaces.length > 0) {
        activeNamespace = state.namespaces[0];
      }
      state.namespaces.forEach(ns => {
        const opt = document.createElement('option')
        opt.value = ns
        opt.textContent = ns
        nsSelect.appendChild(opt)
      })
    }

    const params = new URLSearchParams(window.location.search)
    if (params.has('ns')) {
      activeNamespace = params.get('ns')
      nsSelect.value = activeNamespace
    }
    if (params.has('q')) {
      document.getElementById('search').value = params.get('q')
    }

    render()
    if (params.has('q')) filterKeys(params.get('q'))
  } catch(e) {
    setStatus('error', 'Failed to load — is the server running?')
  }
}

function switchNamespace(ns) {
  if (dirty) {
    if (!confirm("You have unsaved changes! Discard them and switch?")) {
      document.getElementById('ns-select').value = activeNamespace
      return
    }
  }
  state.keys = { ...state.keys, ...collectState() }
  activeNamespace = ns
  dirty = false
  render()
}

function render() {
  document.getElementById('dir-label').textContent = state.dir

  const keysToRender = Object.keys(state.keys).filter(k => {
    if (!activeNamespace) return true;
    return k.startsWith(activeNamespace + ':');
  })

  document.getElementById('info-label').textContent = `${keysToRender.length} keys · ${state.languages.length} langs`

  let h = `<tr>
    <th class="th-key">Key (${keysToRender.length})</th>`
  state.languages.forEach(l => h += `<th class="th-lang">${esc(l)}</th>`)
  h += `<th class="th-del"></th></tr>`
  document.getElementById('thead').innerHTML = h

  let b = ''
  keysToRender.forEach(k => {
    b += `<tr data-key="${esc(k)}">
      <td class="td-key">
        <div class="key-wrap">
          <input class="key-input" type="text" value="${esc(k)}"
            onchange="renameKey('${esc(k)}', this)"
            oninput="markDirty()">
        </div>
      </td>`
    state.languages.forEach(l => {
      b += `<td>
        <textarea class="val-input" data-lang="${esc(l)}"
          oninput="autoResize(this); markDirty()">${esc(state.keys[k][l] ?? '')}</textarea>
      </td>`
    })
    b += `<td><button class="btn" style="color:#ef4444;background:transparent;padding:6px;width:30px;font-size:16px" onclick="deleteKey('${esc(k)}')">×</button></td>
    </tr>`
  })

  if (!keysToRender.length) {
     b = `<tr><td colspan="${state.languages.length + 2}">
        <div class="empty">
          <h2>No translations yet in this namespace</h2>
          <p>Click "＋ Add Key" to create your first translation key.</p>
        </div>
      </td></tr>`
  }

  document.getElementById('tbody').innerHTML = b

  document.querySelectorAll('textarea').forEach(autoResize)
  markMissing()
  updateCompleteness()
  dirty = false
  setStatus('ok', 'Ready')
}

function autoResize(el) {
  el.style.height = 'auto'
  el.style.height = Math.max(38, el.scrollHeight) + 'px'
}

function markDirty() {
  if (!dirty) {
    dirty = true
    setStatus('dirty', 'Unsaved changes')
  }
}

function setStatus(type, msg) {
  const dot = document.getElementById('dot')
  document.getElementById('status-msg').textContent = msg
  dot.className = 'dot' + (type === 'dirty' ? ' dirty' : type === 'error' ? ' error' : '')
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;')
}

function collectState() {
  const keys = {}
  document.querySelectorAll('tr[data-key]').forEach(row => {
    const keyInput = row.querySelector('.key-input')
    const key = keyInput ? keyInput.value.trim() : row.dataset.key
    if (!key) return
    keys[key] = {}
    state.languages.forEach(lang => {
      const ta = row.querySelector(`textarea[data-lang="${lang}"]`)
      keys[key][lang] = ta ? ta.value : ''
    })
  })
  return keys
}

function renameKey(oldKey, input) {
  const newKey = input.value.trim()
  if (!newKey || newKey === oldKey) { input.value = oldKey; return }
  if (state.keys[newKey] !== undefined) {
    showToast('Key already exists', 'err')
    input.value = oldKey
    return
  }
  const vals = state.keys[oldKey]
  delete state.keys[oldKey]
  state.keys[newKey] = vals
  // Update row data-key
  const row = input.closest('tr')
  if (row) row.dataset.key = newKey
  input.value = newKey
  markDirty()
}

function addKey() {
  const key = prompt('New key name (e.g. hero_title):')
  if (!key?.trim()) return
  let finalKey = key.trim()
  
  if (!finalKey.includes(':') && activeNamespace) {
    finalKey = activeNamespace + ':' + finalKey;
  }
  
  if (state.keys[finalKey] !== undefined) { 
    showToast('Key already exists', 'err')
    const safeKey = CSS.escape(finalKey)
    const row = document.querySelector(`tr[data-key="${safeKey}"]`)
    if (row) {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' })
      row.classList.add('new-row')
      row.querySelector('textarea')?.focus()
    }
    return 
  }

  state.keys = { ...state.keys, ...collectState() }
  state.keys[finalKey] = Object.fromEntries(state.languages.map(l => [l, '']))
  render()
  markDirty()

  setTimeout(() => {
    const safeKey = CSS.escape(finalKey)
    const row = document.querySelector(`tr[data-key="${safeKey}"]`)
    if (row) {
      row.classList.add('new-row')
      row.querySelector('textarea')?.focus()
      row.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, 50)
}

function deleteKey(key) {
  if (!confirm(`Delete key "${key}"?\nThis cannot be undone.`)) return
  state.keys = { ...state.keys, ...collectState() }
  delete state.keys[key]
  render()
  markDirty()
}

async function saveAll() {
  state.keys = { ...state.keys, ...collectState() }
  const btn = document.getElementById('save-btn')
  btn.textContent = 'Saving…'
  btn.classList.add('saving')
  setStatus('dirty', 'Saving…')

  try {
    const r = await fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state)
    })
    if (!r.ok) throw new Error('Server error')
    dirty = false
    btn.textContent = 'Save'
    btn.classList.remove('saving')
    setStatus('ok', 'Saved')
    showToast('Saved ✓', 'ok')
  } catch(e) {
    btn.textContent = 'Save'
    btn.classList.remove('saving')
    setStatus('error', 'Error saving')
    showToast('Error saving files', 'err')
  }
}

function showToast(msg, type = '') {
  const t = document.getElementById('toast')
  t.textContent = msg
  t.className = `toast show ${type}`
  clearTimeout(t._timer)
  t._timer = setTimeout(() => t.className = 'toast', 2500)
}

// Feature 2: Export CSV
function exportCSV() {
  const a = document.createElement('a')
  a.href = '/api/export/csv'
  a.download = 'messages.csv'
  a.click()
}

// Feature 3: Import CSV
async function importCSV(input) {
  const file = input.files[0]
  if (!file) return
  input.value = ''
  setStatus('dirty', 'Importing…')
  try {
    const text = await file.text()
    const r = await fetch('/api/import/csv', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: text
    })
    const data = await r.json()
    if (!r.ok) throw new Error(data.error || 'Import failed')
    state = data
    render()
    markDirty()
    showToast(`Imported ${Object.keys(data.keys).length} keys ✓`, 'ok')
  } catch (e) {
    setStatus('error', 'Import error')
    showToast('Import failed: ' + e.message, 'err')
  }
}

// Feature 7: Audit — code scanner results (missing / unused / dynamic keys)
let auditData = null

async function toggleAudit() {
  const panel = document.getElementById('audit-panel')
  if (panel.style.display !== 'none') { panel.style.display = 'none'; return }
  panel.style.display = ''
  panel.innerHTML = '<div class="audit-meta">Scanning…</div>'
  await refreshAudit()
}

async function refreshAudit({ silent = false } = {}) {
  try {
    const r = await fetch('/api/audit')
    const data = await r.json()
    if (!r.ok) throw new Error(data.error || 'Audit failed')
    auditData = data
  } catch (e) {
    auditData = { error: e.message }
  }
  updateAuditBadge()
  if (!silent) renderAuditPanel()
}

function updateAuditBadge() {
  const badge = document.getElementById('audit-badge')
  const count = auditData?.missing?.length || 0
  badge.style.display = count ? '' : 'none'
  badge.textContent = count
}

function renderAuditPanel() {
  const panel = document.getElementById('audit-panel')
  if (panel.style.display === 'none') return
  
  if (!auditData) {
    panel.innerHTML = '<div class="empty">Loading audit data...</div>'
    return
  }

  const m = auditData.missing.length
  const u = auditData.unused.length
  let html = `<div class="audit-head">
    <h2><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/></svg> Audit Results</h2>
    <div class="audit-meta">Scanned ${auditData.filesScanned} files in ${auditData.scanDir}</div>
  </div>`

  if (m === 0 && u === 0) {
    html += `<div class="empty">
      <h2>All good!</h2>
      <p>No missing or unused translations found.</p>
    </div>`
  } else {
    if (m > 0) {
      html += `<div class="audit-section">
        <h3><span>Missing Keys</span> <span class="pill pill-amber">${m}</span></h3>`
      auditData.missing.forEach(item => {
        html += `<div class="audit-row">
          <div class="audit-row-content">
            <span class="audit-key-text">${item.key}</span>
            <div class="audit-ref">${item.file}:${item.line}</div>
          </div>
          <button class="audit-mini-btn" onclick="auditAddKey('${esc(item.key)}')"><img src="/public/assets/add_dark.svg" class="icon" /> Add</button>
        </div>`
      })
      html += `</div>`
    }
    
    if (u > 0) {
      html += `<div class="audit-section">
        <h3><span>Unused Keys</span> <span class="pill pill-red">${u}</span></h3>`
      auditData.unused.forEach(key => {
        html += `<div class="audit-row">
          <div class="audit-row-content">
            <span class="audit-key-text">${key}</span>
          </div>
          <button class="audit-mini-btn danger" onclick="auditDeleteKey('${esc(key)}')"><img src="/public/assets/del_red.svg" class="icon" /> Delete</button>
        </div>`
      })
      html += `</div>`
    }
    
    if (auditData.dynamicCalls > 0) {
      html += `<div class="audit-warn">
        <strong>Note:</strong> Found ${auditData.dynamicCalls} dynamic t() calls (e.g. <code>t(variable)</code>). 
        These cannot be statically analyzed.
      </div>`
    }
  }

  panel.innerHTML = html
}

function auditAddKey(key) {
  let finalKey = key;
  if (!finalKey.includes(':') && activeNamespace) {
    finalKey = activeNamespace + ':' + finalKey;
  }
  
  if (state.keys[finalKey] !== undefined) {
    const row = document.querySelector(`tr[data-key="${finalKey}"]`)
    if (row) {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' })
      row.classList.add('new-row')
    }
    return
  }
  
  state.keys = { ...state.keys, ...collectState() }
  state.keys[finalKey] = Object.fromEntries(state.languages.map(l => [l, '']))
  render()
  markDirty()
  
  auditData.missing = auditData.missing.filter(m => m.key !== key)
  updateAuditBadge()
  renderAuditPanel()
  
  setTimeout(() => {
    // Escape finalKey for querySelector since it might contain dots (e.g. accentPicker.darkAccentText)
    const safeKey = CSS.escape(finalKey)
    const row = document.querySelector(`tr[data-key="${safeKey}"]`)
    if (row) { 
      row.classList.add('new-row'); 
      row.scrollIntoView({ behavior: 'smooth', block: 'center' }) 
    }
  }, 50)
  
  showToast(`Added "${finalKey}" — fill it in and save`, 'ok')
}

function auditDeleteKey(key) {
  deleteKey(key)
  if (state.keys[key] === undefined) {
    auditData.unused = auditData.unused.filter(k => k !== key)
    renderAuditPanel()
  }
}

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveAll() }
})

load()
refreshAudit({ silent: true })
// Close audit panel when clicking outside
document.addEventListener('click', (e) => {
  const panel = document.getElementById('audit-panel');
  const auditBtn = document.querySelector('.btn-audit');
  if (panel.style.display !== 'none' && !panel.contains(e.target) && (!auditBtn || !auditBtn.contains(e.target))) {
    panel.style.display = 'none';
  }
});
