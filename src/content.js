// ===========================================================================
// ChatGPT Enhanced - Content Script Entry Point
// ===========================================================================
// Modular architecture:
//   src/compat/selectors.js  — centralized DOM selector strategies
//   src/chatlog.js           — incremental DOM-based message logging
//   src/export.js            — export in MD/TXT/JSON/PDF + context package
//   src/content.js           — this file: orchestrator + feature implementations
// ===========================================================================

import { queryAll, extractId, findSidebarRoot, findHistorySidebar, sidebarChatLinks, sidebarLandmark } from './compat/selectors.js';
import { setupTitleRename } from './rename.js';
import { modusIcon } from './ui-icons.js';
import { conversationId } from './context-data.js';
import { renderInspector, positionInspector, closeInspectorDetails, conversationDates } from './inspector.js';
import { DEFAULT_SETTINGS, loadSettings } from './settings.js';
import { scanAndLog, exportLog } from './chatlog.js';
import {
  extractFromDOM,
  toMarkdown, toPlainText, toJSON, toContextPackage, toPdfHtml,
  downloadBlob, printHtml,
} from './export.js';

// ---------------------------------------------------------------------------
// SETTINGS
// ---------------------------------------------------------------------------
let _s = { ...DEFAULT_SETTINGS };

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------
function isDark() {
  return document.documentElement.classList.contains('dark');
}

function _chatIdFromPath() {
  return conversationId(location.pathname);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Extension context safety
let _dead = false;
let _uiReady = false;
function _extCtxOk() {
  if (_dead) return false;
  try { return !!chrome.runtime?.id; }
  catch { _dead = true; return false; }
}
function _killScript() {
  _dead = true;
  try { _mutObs?.disconnect(); } catch {}
}
function _isCtxErr(e) {
  const msg = (e?.message || String(e) || '').toLowerCase();
  return msg.includes('invalidat') || msg.includes('extension context') || !_extCtxOk();
}

async function _storeGet(keys) {
  if (!_extCtxOk()) return {};
  return chrome.storage.local.get(keys);
}

async function _storeSet(values) {
  if (!_extCtxOk()) throw new Error('Extension context invalidated');
  await chrome.storage.local.set(values);
}

// ---------------------------------------------------------------------------
// FEATURE 1 — Typing Lag Fix (content-visibility virtualization)
// ---------------------------------------------------------------------------
function setupVirtualization() {
  observeMessages();
}

function teardownVirtualization() {
  document.querySelectorAll('[data-cgpt-lite-turn]').forEach(turn => delete turn.dataset.cgptLiteTurn);
}

function observeMessages() {
  if (!_s.lagFix) return;
  const transcript = document.querySelector('[role="region"][aria-label="Conversation"], main');
  if (!transcript || transcript.querySelector('[data-virtualized-turn]')) return;
  const messages = queryAll('msgBlock', transcript);
  if (messages.length < 24) return;
  // Let the browser size and paint older legacy turns when they approach
  // the viewport. ChatGPT's native virtualizer owns modern transcripts.
  for (let i = 0; i < messages.length - 12; i++) {
    const message = messages[i];
    if (!message.dataset.cgptLiteTurn) message.dataset.cgptLiteTurn = '1';
  }
}

// ---------------------------------------------------------------------------
// FEATURE 2 — Bulk Checkbox Injection
// ---------------------------------------------------------------------------
let _selectedIds = new Set();
let _lastCb = null;
const previouslyEncrypted = new Set();
const ID_ALIAS_KEY = 'cgpt_id_aliases';
const PENDING_ID_KEY = 'cgpt_pending_conversation';
let _idAliases = new Map();
let _idAliasesLoadPromise = null;

function _loadIdAliases() {
  if (_idAliasesLoadPromise) return _idAliasesLoadPromise;
  _idAliasesLoadPromise = _storeGet([ID_ALIAS_KEY]).then(data => {
    _idAliases = new Map(Object.entries(data[ID_ALIAS_KEY] || {}));
    return _idAliases;
  });
  return _idAliasesLoadPromise;
}

function _resolveChatId(id) {
  let current = id;
  const seen = new Set();
  while (current && _idAliases.has(current) && !seen.has(current)) {
    seen.add(current);
    current = _idAliases.get(current);
  }
  return current;
}

function _rememberPendingId() {
  const id = _chatIdFromPath();
  if (!id?.startsWith('WEB:')) return;
  const link = sidebarChatLinks(_getHistoryNav())
    .find(el => extractId(el.getAttribute('href')) === id);
  const title = (link?.innerText || document.title || '').trim().slice(0, 160);
  _storeSet({ [PENDING_ID_KEY]: { id, title, at: Date.now() } }).catch(() => {});
}

function _reconcilePendingId() {
  const currentId = _chatIdFromPath();
  if (!currentId || currentId.startsWith('WEB:')) {
    _rememberPendingId();
    return;
  }
  _storeGet([PENDING_ID_KEY]).then(data => {
    const pending = data[PENDING_ID_KEY];
    if (!pending?.id || pending.id === currentId || _resolveChatId(pending.id) === currentId || Date.now() - (pending.at || 0) > 300000) return;
    const normalize = value => (value || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const pendingTitle = normalize(pending.title);
    const expected = (!pendingTitle || pendingTitle === 'chatgpt' || pendingTitle.startsWith('chatgpt ')) ? normalize(document.title) : pendingTitle;
    const candidates = [...document.querySelectorAll('a[href^="/c/"],a[href^="/uc/"]')]
      .map(link => ({ id: extractId(link.getAttribute('href')), text: normalize(link.innerText) }))
      .filter(item => item.id);
    const match = candidates.find(item => item.id === currentId && (!expected || item.text === expected || item.text.includes(expected) || expected.includes(item.text)));
    if (!match) return;
    _migrateChatId(pending.id, currentId);
    return _storeSet({ [PENDING_ID_KEY]: null });
  }).catch(() => {});
}

function _migrateChatId(oldId, newId) {
  if (!oldId || !newId || oldId === newId) return;
  _idAliases.set(oldId, newId);
  if (_selectedIds.delete(oldId)) _selectedIds.add(newId);
  return _storeSet({ [ID_ALIAS_KEY]: Object.fromEntries(_idAliases) }).catch(() => {});
}

const selectionInputs = new WeakMap();

function injectCheckboxes() {
  const nav = _getHistoryNav();
  const links = sidebarChatLinks(nav);
  const controlsInUse = new Set();
  links.forEach((link, idx) => {
    const rawChatId = extractId(link.pathname);
    if (!rawChatId) return;
    const chatId = _resolveChatId(rawChatId) || rawChatId;
    const previousId = link.dataset.cgptId;
    if (previousId !== chatId) _trackPathAlias(previousId, chatId);
    link.dataset.cgptId = chatId;
    link.classList.add('cgpt-bulk-item');
    const name = link.getAttribute('aria-label') || link.textContent.trim() || 'chat';
    const existing = selectionInputs.get(link);
    const parent = link.parentElement;
    const row = parent && parent.querySelectorAll(':scope > a[href]').length === 1 &&
      getComputedStyle(parent).display !== 'contents' ? parent : link;
    if (existing?.parentElement?.parentElement === row) {
      controlsInUse.add(existing.parentElement);
      existing.dataset.index = idx;
      existing.dataset.chatId = chatId;
      existing.checked = _selectedIds.has(chatId);
      existing.setAttribute('aria-label', `Select ${name}`);
      return;
    }
    const previousRow = existing?.parentElement?.parentElement;
    existing?.parentElement?.remove();
    if (previousRow && !previousRow.querySelector(':scope > .cgpt-select-control')) {
      previousRow.classList.remove('cgpt-select-row');
      previousRow.removeAttribute('data-modus-select-position');
    }

    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.className = 'cgpt-cb';
    cb.setAttribute('aria-label', `Select ${name}`);
    cb.dataset.chatId = chatId; cb.dataset.index = idx;
    cb.checked = _selectedIds.has(chatId);

    let shiftSelection = false;
    cb.addEventListener('click', e => { e.stopPropagation(); shiftSelection = e.shiftKey; });
    cb.addEventListener('change', e => {
      e.stopPropagation();
      const currentChatId = cb.dataset.chatId || chatId;
      const currentNav = _getHistoryNav();
      const controls = currentNav?.querySelectorAll('.cgpt-cb') || [];
      if (shiftSelection && currentNav?.contains(_lastCb) && _lastCb !== cb) {
        const lo = Math.min(+_lastCb.dataset.index, +cb.dataset.index);
        const hi = Math.max(+_lastCb.dataset.index, +cb.dataset.index);
        const st = _lastCb.checked;
        controls.forEach(o => {
          const i = +o.dataset.index;
          if (i >= lo && i <= hi) {
            st ? _selectedIds.add(o.dataset.chatId) : _selectedIds.delete(o.dataset.chatId);
          }
        });
      } else {
        cb.checked ? _selectedIds.add(currentChatId) : _selectedIds.delete(currentChatId);
      }
      for (const control of controls) control.checked = _selectedIds.has(control.dataset.chatId);
      _lastCb = cb;
      _renderActionBar();
    });
    const select = document.createElement('label');
    select.className = 'cgpt-select-control';
    const appearance = document.createElement('span');
    appearance.className = 'cgpt-select-mark';
    appearance.innerHTML = modusIcon('check');
    select.append(cb, appearance);
    controlsInUse.add(select);
    selectionInputs.set(link, cb);
    const { position } = getComputedStyle(row);
    if (!position || position === 'static') {
      row.setAttribute('data-modus-select-position', '');
    }
    if (row !== link) {
      row.classList.add('cgpt-select-row');
      link.before(select);
    } else {
      link.prepend(select);
    }
  });
  for (const control of document.querySelectorAll('.cgpt-select-control')) {
    if (controlsInUse.has(control)) continue;
    const row = control.parentElement;
    const link = row.matches('a.cgpt-bulk-item') ? row : control.nextElementSibling;
    control.remove();
    if (!row.querySelector(':scope > .cgpt-select-control')) {
      row.classList.remove('cgpt-select-row');
      row.removeAttribute('data-modus-select-position');
    }
    if (link?.matches('a.cgpt-bulk-item') && !links.includes(link)) {
      link.classList.remove('cgpt-bulk-item');
      delete link.dataset.cgptId;
    }
  }
  if (_selectedIds.size) _renderActionBar(nav);
}

// ---------------------------------------------------------------------------
// ACTION BAR
// ---------------------------------------------------------------------------
function selectionButton(label, icon, action, style = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `cgpt-ui-button ${style}`;
  if (icon) button.innerHTML = modusIcon(icon);
  const title = document.createElement('span');
  title.textContent = label;
  button.append(title);
  button.addEventListener('click', action);
  return button;
}

function _renderActionBar(nav = _getHistoryNav()) {
  let bar = document.getElementById('cgpt-action-bar');
  if (!_selectedIds.size) { bar?.remove(); return; }
  const host = document.fullscreenElement || document.body;
  if (!bar) {
    bar = document.createElement('section');
    bar.id = 'cgpt-action-bar';
    bar.className = 'cgpt-surface';
    bar.setAttribute('aria-label', 'Selected chats');

    const summary = document.createElement('div');
    summary.className = 'cgpt-selection-summary';
    const count = document.createElement('span');
    count.id = 'cgpt-count';
    count.setAttribute('aria-live', 'polite');
    summary.append(count, selectionButton('All shown', null, _selectAll), selectionButton('Clear', null, _deselectAll));

    const actions = document.createElement('div');
    actions.className = 'cgpt-selection-actions';
    const exportButton = selectionButton('Export', 'download', () => _showExportModal([..._selectedIds]), 'cgpt-is-primary');
    exportButton.id = 'cgpt-exp-btn';
    actions.append(exportButton, selectionButton('Archive', 'archive', () => _bulkAction('archive')),
      selectionButton('Delete', 'trash', () => _bulkAction('delete'), 'cgpt-is-danger'));
    bar.append(summary, actions);
  }
  if (bar.parentElement !== host) host.append(bar);
  const bounds = nav?.getBoundingClientRect();
  const sidebarVisible = nav && host.contains(nav);
  bar.hidden = !sidebarVisible;
  if (bounds?.width) {
    const left = Math.max(0, bounds.left);
    const right = Math.min(innerWidth, bounds.right);
    bar.hidden = !sidebarVisible || right <= left;
    bar.style.setProperty('--cgpt-selection-left', `${left}px`);
    bar.style.setProperty('--cgpt-selection-width', `${right - left}px`);
  }
  const count = bar.querySelector('#cgpt-count');
  const label = `${_selectedIds.size} selected`;
  if (!_bulkRunning && count.textContent !== label) count.textContent = label;

}

// Bulk actions use the native controls for chats already visible in the sidebar.
let _bulkRunning = false;

function _selectAll() {
  document.querySelectorAll('.cgpt-cb').forEach(cb => {
    if (!cb.getClientRects().length) return;
    cb.checked = true;
    _selectedIds.add(cb.dataset.chatId);
  });
  _renderActionBar();
}

function _deselectAll() {
  const returnFocus = document.getElementById('cgpt-action-bar')?.contains(document.activeElement) ? _lastCb : null;
  _selectedIds.clear();
  _lastCb = null;
  document.querySelectorAll('.cgpt-cb').forEach(cb => {
    cb.checked = false;
  });
  _renderActionBar();
  returnFocus?.focus({ preventScroll: true });
}

function _nativeControlText(node) {
  if (node.nodeType === 3) return node.nodeValue;
  if (node.nodeType !== 1 || node.matches('[aria-hidden="true"], [hidden], [inert], svg, kbd, script, style')) return '';
  return [...node.childNodes].map(_nativeControlText).join('');
}

function _nativeControl(root, selector, label) {
  const expected = label.trim().toLowerCase();
  return [...root.querySelectorAll(selector)].find(element => {
    if (!element.getClientRects().length || element.closest('[aria-hidden="true"], [hidden], [inert]')) return false;
    const labelledBy = (element.getAttribute('aria-labelledby') || '').trim().split(/\s+/)
      .map(id => element.ownerDocument.getElementById(id)).filter(Boolean).map(_nativeControlText).join(' ').trim();
    const name = labelledBy || element.getAttribute('aria-label') || _nativeControlText(element);
    return name.replace(/\s+/g, ' ').trim().toLowerCase() === expected;
  });
}

async function _waitForControl(find, timeout = 2500) {
  const until = Date.now() + timeout;
  while (_extCtxOk() && Date.now() < until) {
    const result = find();
    if (result) return result;
    await sleep(50);
  }
  return null;
}

function _findChatActions(link) {
  const links = 'a[href*="/c/"], a[href*="/uc/"]';
  for (let row = link; row && (row === link || row.querySelectorAll(links).length === 1); row = row.parentElement) {
    const trigger = row.querySelector('button[aria-label="Chat actions"], button[data-testid="history-item-options"], button[data-testid*="conversation-options"]');
    if (trigger) return trigger;
  }
  return null;
}

async function _applyNativeAction(link, action) {
  const trigger = _findChatActions(link);
  if (!trigger || !trigger.getClientRects().length || trigger.getAttribute('aria-expanded') === 'true') return false;
  const id = trigger.getAttribute('aria-controls') || trigger.id.replace(/-trigger$/, '-items');
  const menuAction = () => {
    const menu = id ? document.getElementById(id) : null;
    const root = menu || (trigger.getAttribute('aria-expanded') === 'true'
      ? document.querySelector('[role="menu"][aria-label="Chat actions"]') : null);
    if (!root) return null;
    return _nativeControl(root, '[role="menuitem"], button, a', action);
  };
  if (menuAction()) return false;
  trigger.click();
  if (!menuAction() && trigger.getAttribute('aria-expanded') !== 'true') {
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }
  const item = await _waitForControl(menuAction);
  if (!item) return false;
  item.click();
  if (action === 'delete') {
    const confirm = await _waitForControl(() =>
      _nativeControl(document, '[role="dialog"] button, [role="alertdialog"] button, dialog[open] button', 'delete'));
    if (!confirm) return false;
    confirm.click();
  }
  return Boolean(await _waitForControl(() => !link.isConnected, 4000));
}

async function _bulkAction(action) {
  if (!_selectedIds.size || !_extCtxOk() || _bulkRunning) return;
  _bulkRunning = true;
  const ids = [..._selectedIds];
  try {
    if (action === 'delete') {
      const ok = await _modal({
        title: `Delete ${ids.length} conversation${ids.length === 1 ? '' : 's'}?`,
        message: 'ChatGPT permanently deletes these conversations.',
        buttons: [{ label: 'Cancel', value: false }, { label: 'Delete', danger: true, value: true }],
      });
      if (!ok) return;
    }
    let done = 0;
    for (const [index, id] of ids.entries()) {
      const count = document.getElementById('cgpt-count');
      if (count) count.textContent = `${action === 'delete' ? 'Deleting' : 'Archiving'} ${index + 1}/${ids.length}…`;
      const link = _findChatLink(id);
      if (!link || !await _applyNativeAction(link, action)) break;
      _selectedIds.delete(id);
      done++;
    }
    if (done < ids.length) {
      await _modal({
        title: `${done} of ${ids.length} chats ${action === 'delete' ? 'deleted' : 'archived'}`,
        message: 'Check the remaining chats in the sidebar before trying again.',
        buttons: [{ label: 'Close', value: true }],
      });
    }
  } finally {
    _bulkRunning = false;
    _renderActionBar();
  }
}

// ---------------------------------------------------------------------------
// MODAL
// ---------------------------------------------------------------------------
function _modal({ title, message, buttons }) {
  return new Promise(resolve => {
    const dark = isDark();
    const overlay = document.createElement('div');
    Object.assign(overlay.style, { position:'fixed', inset:'0', background:'rgba(0,0,0,.55)', zIndex:'1000000', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'inherit' });
    const box = document.createElement('div');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', title);
    box.setAttribute('aria-modal', 'true');
    Object.assign(box.style, { background: dark ? '#2a2a2a' : '#fff', color: dark ? '#ececec' : '#111', borderRadius:'14px', padding:'24px 28px 20px', width:'min(380px,90vw)', boxShadow:'0 16px 48px rgba(0,0,0,.45)', display:'flex', flexDirection:'column', gap:'12px' });
    const t = document.createElement('div'); t.textContent = title; Object.assign(t.style, { fontWeight:'700', fontSize:'16px' });
    const m = document.createElement('div'); m.textContent = message; Object.assign(m.style, { fontSize:'14px', opacity:'.7', marginBottom:'4px' });
    const row = document.createElement('div'); Object.assign(row.style, { display:'flex', gap:'8px', justifyContent:'flex-end' });
    const previousFocus = document.activeElement;
    const close = value => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      previousFocus?.focus();
      resolve(value);
    };
    const onKey = event => {
      if (event.key === 'Escape') close(null);
    };
    buttons.forEach(({ label, value, danger }) => {
      const b = document.createElement('button'); b.textContent = label;
      Object.assign(b.style, { background: danger ? '#c0392b' : (dark ? '#3a3b45' : '#f0f0f0'), color: danger ? '#fff' : (dark ? '#ececec' : '#111'), border:'none', borderRadius:'8px', padding:'8px 18px', fontSize:'14px', fontWeight:'600', cursor:'pointer', fontFamily:'inherit' });
      b.onclick = () => close(value);
      row.appendChild(b);
    });
    overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });
    document.addEventListener('keydown', onKey);
    box.append(t, m, row); overlay.appendChild(box); document.body.appendChild(overlay);
    setTimeout(() => row.firstElementChild?.focus(), 10);
  });
}

// ---------------------------------------------------------------------------
// FEATURE 3 — Compact Sidebar
// ---------------------------------------------------------------------------
const compactItems = {
  images: ['Images', 'image'],
  scheduled: ['Tasks', 'schedule'],
  library: ['Library', 'library'],
  plugins: ['Plugins', 'plugins'],
  apps: ['Apps', 'plugins'],
  codex: ['Codex', 'code'],
  deep_research: ['Research', 'compass'],
  explore: ['Explore', 'compass'],
};
let compactSources = [];
let exploreObserver;

function _getHistoryNav() {
  return findHistorySidebar();
}

function _findNewChatElement(nav = findSidebarRoot()) {
  return [...(nav?.querySelectorAll('a, button') || [])].find(element =>
    element.matches('[data-testid="create-new-chat-button"], [data-octane-navigation-item="new_chat"]') ||
    (element.getAttribute('aria-label') || element.textContent).trim().toLowerCase() === 'new chat');
}

function _sidebarRow(element) {
  return element.closest('li') || element;
}

function _clearCompactSidebar() {
  exploreObserver?.disconnect();
  for (const menu of document.querySelectorAll('[data-modus-explore-menu]')) {
    delete menu.dataset.modusExploreMenu;
    menu.style.removeProperty('--modus-menu-left');
    menu.style.removeProperty('--modus-menu-top');
  }
  document.getElementById('cgpt-icon-grid')?.remove();
  for (const { row, native, name, tabindex, ariaHidden } of compactSources) {
    delete row.dataset.cgptGridHidden;
    if (name !== 'explore') continue;
    delete native.dataset.cgptExploreSource;
    native.style.removeProperty('--cgpt-explore-left');
    native.style.removeProperty('--cgpt-explore-top');
    if (tabindex === null) native.removeAttribute('tabindex'); else native.setAttribute('tabindex', tabindex);
    if (ariaHidden === null) native.removeAttribute('aria-hidden'); else native.setAttribute('aria-hidden', ariaHidden);
  }
  compactSources = [];
}

function _connectExploreShortcut(button, native) {
  const synchronize = () => {
    const expanded = native.getAttribute('aria-expanded') === 'true';
    button.setAttribute('aria-expanded', String(expanded));
    const id = native.getAttribute('aria-controls');
    if (id && expanded) {
      button.setAttribute('aria-controls', id);
      requestAnimationFrame(() => {
        const menu = document.getElementById(id);
        if (!menu || native.getAttribute('aria-expanded') !== 'true') return;
        const positioned = menu.closest('[data-radix-popper-content-wrapper]') || menu;
        const sidebar = _getHistoryNav()?.getBoundingClientRect();
        const rect = button.getBoundingClientRect();
        const width = positioned.getBoundingClientRect().width || 160;
        const leftEdge = Math.max(8, (sidebar?.left ?? 0) + 8);
        const rightEdge = Math.min(innerWidth, sidebar?.right || innerWidth) - width - 8;
        const left = Math.max(leftEdge, Math.min(rect.left + (rect.width - width) / 2, rightEdge));
        positioned.dataset.modusExploreMenu = '1';
        positioned.style.setProperty('--modus-menu-left', `${Math.round(left)}px`);
        positioned.style.setProperty('--modus-menu-top', `${Math.round(rect.bottom + 5)}px`);
      });
    } else {
      button.removeAttribute('aria-controls');
      requestAnimationFrame(() => { if (document.activeElement === native) button.focus(); });
    }
  };
  button.setAttribute('aria-haspopup', 'menu');
  exploreObserver = new MutationObserver(synchronize);
  exploreObserver.observe(native, { attributes: true, attributeFilter: ['aria-expanded', 'aria-controls'] });
  synchronize();
  button.addEventListener('click', () => {
    if (!native.isConnected || native.getAttribute('aria-expanded') === 'true') return;
    const anchor = button.getBoundingClientRect();
    native.style.setProperty('--cgpt-explore-left', `${Math.round(anchor.left)}px`);
    native.style.setProperty('--cgpt-explore-top', `${Math.round(anchor.bottom)}px`);
    native.click();
    // Radix dropdowns use Enter rather than click on the anchor.
    if (native.getAttribute('aria-expanded') !== 'true') {
      requestAnimationFrame(() => {
        if (native.isConnected && native.getAttribute('aria-expanded') !== 'true') {
          native.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
        }
      });
    }
  });
}

function setupCompactSidebar() {
  const nav = findSidebarRoot() || _getHistoryNav();
  if (!nav) { _clearCompactSidebar(); return; }
  const sources = [];
  const seen = new Set();
  for (const native of nav.querySelectorAll('a, button')) {
    if (native.closest('#cgpt-icon-grid') || native.closest('a[href*="/c/"], a[href*="/uc/"]')) continue;
    const href = native.getAttribute('href') || '';
    const label = (native.getAttribute('aria-label') || native.textContent).trim();
    const name = native.getAttribute('data-octane-navigation-item') || href.match(/^\/([a-z_]+)(?:[/?#]|$)/)?.[1] || label.toLowerCase();
    if (!Object.hasOwn(compactItems, name) || seen.has(name)) continue;
    if (native.hasAttribute('aria-haspopup') && native.getAttribute('aria-haspopup') !== 'false' && name !== 'explore') continue;
    const row = _sidebarRow(native);
    if (row !== native && row.querySelectorAll('a, button').length !== 1) continue;
    if (!native.getClientRects().length && row.dataset.cgptGridHidden !== '1') continue;
    const previous = compactSources.find(source => source.native === native);
    seen.add(name);
    sources.push({ native, row, name, label, tabindex: previous ? previous.tabindex : native.getAttribute('tabindex'),
      ariaHidden: previous ? previous.ariaHidden : native.getAttribute('aria-hidden') });
  }

  const grid = document.getElementById('cgpt-icon-grid');
  if (grid?.isConnected && sources.length === compactSources.length &&
      sources.every(({ native }, index) => native === compactSources[index].native)) return;
  _clearCompactSidebar();
  const first = sources[0]?.row;
  if (!first) return;

  const group = document.createElement(first.matches('li') ? 'li' : 'div');
  group.id = 'cgpt-icon-grid';
  group.setAttribute('aria-label', 'ChatGPT shortcuts');
  for (const { native, name, label, row } of sources) {
    const [short, icon] = compactItems[name];
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cgpt-grid-btn';
    button.setAttribute('aria-label', label || short);
    button.title = label || short;
    button.innerHTML = modusIcon(icon);
    const title = document.createElement('span');
    title.textContent = short;
    button.append(title);
    if (name === 'explore') {
      native.dataset.cgptExploreSource = '1';
      native.setAttribute('tabindex', '-1');
      native.setAttribute('aria-hidden', 'true');
      _connectExploreShortcut(button, native);
    } else {
      row.dataset.cgptGridHidden = '1';
      button.addEventListener('click', () => { if (native.isConnected) native.click(); });
    }
    group.append(button);
  }
  first.before(group);
  compactSources = sources;
}

// ---------------------------------------------------------------------------
// FEATURE 8 — Date Groups
// ---------------------------------------------------------------------------
let dateGroupsScheduled = false;
const collapsedDates = new Set();

function _bucket(value) {
  const created = typeof value === 'number' ? new Date(value < 1e12 ? value * 1000 : value) : new Date(value);
  if (Number.isNaN(created.getTime())) return null;
  const today = new Date();
  const start = offset => new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset);
  if (created >= start(0)) return 'Today';
  if (created >= start(1)) return 'Yesterday';
  if (created >= start(6)) return 'Last 7 days';
  if (created >= start(29)) return 'Last 30 days';
  return 'Older';
}

function _scheduleDateGroups() {
  if (dateGroupsScheduled) return;
  dateGroupsScheduled = true;
  requestAnimationFrame(() => {
    dateGroupsScheduled = false;
    if (_s.dateGroups && _extCtxOk()) setupDateGroups();
  });
}

function setupDateGroups() {
  const nav = _getHistoryNav();
  if (!nav) return;
  const groups = new Map();
  for (const link of sidebarChatLinks(nav)) {
    const date = conversationDates.get(extractId(link.getAttribute('href')));
    const bucket = date ? _bucket(date.time) : null;
    const actions = _findChatActions(link);
    let row = _sidebarRow(link);
    if (actions) {
      for (let candidate = link.parentElement; candidate && candidate !== nav; candidate = candidate.parentElement) {
        if (!candidate.contains(actions)) continue;
        row = candidate;
        break;
      }
    } else if (row === link && link.parentElement?.classList.contains('cgpt-select-row')) {
      row = link.parentElement;
    }
    row.classList.toggle('cgpt-dg-hidden', Boolean(bucket && collapsedDates.has(bucket)));
    if (!bucket) continue;
    if (!groups.has(bucket)) groups.set(bucket, row);
  }

  for (const heading of nav.querySelectorAll('[data-cgpt-dg-hdr]')) {
    if (heading.nextElementSibling === groups.get(heading.dataset.cgptDgHdr)) groups.delete(heading.dataset.cgptDgHdr);
    else heading.remove();
  }
  for (const [bucket, row] of groups) {
    const heading = document.createElement(row.matches('li') ? 'li' : 'div');
    heading.dataset.cgptDgHdr = bucket;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cgpt-dg-hdr';
    button.innerHTML = modusIcon('chevron');
    button.append(document.createTextNode(bucket));
    button.setAttribute('aria-expanded', String(!collapsedDates.has(bucket)));
    button.onclick = () => {
      if (!collapsedDates.delete(bucket)) collapsedDates.add(bucket);
      button.setAttribute('aria-expanded', String(!collapsedDates.has(bucket)));
      setupDateGroups();
    };
    heading.append(button);
    row.before(heading);
  }
}

function teardownDateGroups() {
  collapsedDates.clear();
  document.querySelectorAll('[data-cgpt-dg-hdr]').forEach(el => el.remove());
  document.querySelectorAll('.cgpt-dg-hidden').forEach(el => el.classList.remove('cgpt-dg-hidden'));
}

function _findChatLink(id) {
  const nav = _getHistoryNav();
  if (!nav) return null;
  const resolved = _resolveChatId(id) || id;
  const matches = sidebarChatLinks(nav).filter(link => _resolveChatId(extractId(link.pathname)) === resolved);
  return matches.find(link => link.getClientRects().length && _findChatActions(link)) || matches[0] || null;
}

// ---------------------------------------------------------------------------
// FEATURE 10 — Export (improved, DOM-first)
// ---------------------------------------------------------------------------
const exportFormats = [
  { id: 'md', name: 'Markdown', extension: '.md', icon: 'file', summary: 'Keeps headings, lists and code' },
  { id: 'txt', name: 'Plain text', extension: '.txt', icon: 'rows', summary: 'A readable transcript for any editor' },
  { id: 'pdf', name: 'PDF', extension: '', icon: 'file', summary: 'Opens a print-ready transcript' },
  { id: 'json', name: 'JSON', extension: '.json', icon: 'code', summary: 'Structured data with message roles' },
  { id: 'ctx', name: 'Context package', extension: '.txt', icon: 'copy', summary: 'One chat, ready to share with another AI' },
];

function _showExportModal(ids) {
  if (!ids.length || document.getElementById('cgpt-export-sheet')) return;
  const focus = document.activeElement;
  const previousFocus = focus?.closest('#cgpt-ctx-popover') ? document.getElementById('cgpt-activity-button') : focus;
  const dialog = document.createElement('dialog');
  dialog.id = 'cgpt-export-sheet';
  dialog.className = 'cgpt-surface';
  dialog.setAttribute('aria-labelledby', 'cgpt-export-title');
  dialog.innerHTML = `
    <form>
      <header class="cgpt-export-header">
        <div class="cgpt-export-emblem">${modusIcon('download')}</div>
        <button class="cgpt-ui-button cgpt-export-close" type="button" aria-label="Close export">${modusIcon('close')}</button>
        <h2 id="cgpt-export-title">${ids.length === 1 ? 'Export chat' : `Export ${ids.length} chats`}</h2>
        <p>Save a copy of the messages available in this browser.</p>
      </header>
      <fieldset>
        <legend>File format</legend>
        <div class="cgpt-export-formats"></div>
      </fieldset>
      <footer class="cgpt-export-footer">
        <p role="status" class="cgpt-export-status" hidden></p>
        <button class="cgpt-ui-button cgpt-is-primary" type="submit">${modusIcon('download')}<span>Download .md</span></button>
      </footer>
    </form>`;

  const form = dialog.querySelector('form');
  const list = dialog.querySelector('.cgpt-export-formats');
  const fields = dialog.querySelector('fieldset');
  const state = dialog.querySelector('.cgpt-export-status');
  const submit = dialog.querySelector('[type="submit"]');
  const close = dialog.querySelector('.cgpt-export-close');
  const submitLabel = submit.querySelector('span');
  let format = exportFormats[0];
  for (const option of exportFormats.filter(item => item.id !== 'ctx' || ids.length === 1)) {
    const label = document.createElement('label');
    label.className = 'cgpt-format-option';
    label.innerHTML = `
      <input type="radio" name="format" value="${option.id}">
      <span class="cgpt-format-icon">${modusIcon(option.icon)}</span>
      <span class="cgpt-format-copy"><strong>${option.name}</strong><small>${option.summary}</small></span>
      <span class="cgpt-format-extension">${option.extension}</span>
      <span class="cgpt-format-mark">${modusIcon('check')}</span>`;
    const radio = label.querySelector('input');
    radio.checked = option === format;
    radio.addEventListener('change', () => {
      format = option;
      submitLabel.textContent = option.id === 'pdf' ? 'Open print view' : `Download ${option.extension}`;
      state.hidden = true;
    });
    list.append(label);
  }
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog && !submit.disabled) dialog.close(); });
  dialog.addEventListener('cancel', event => { if (submit.disabled) event.preventDefault(); });
  dialog.addEventListener('close', () => {
    dialog.remove();
    previousFocus?.focus({ preventScroll: true });
  }, { once: true });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submit.disabled) return;
    const buttonTitle = submitLabel.textContent;
    let printWindow;
    try {
      if (format.id === 'pdf') {
        printWindow = window.open('', '_blank', 'width=940,height=720');
        if (!printWindow) throw new Error('Allow pop-ups to open the print view.');
      }
      submit.disabled = close.disabled = fields.disabled = true;
      submitLabel.textContent = 'Preparing export';
      state.hidden = false;
      state.classList.remove('cgpt-export-error');
      await _runExport(format.id, ids, state, printWindow);
      dialog.close();
    } catch (error) {
      printWindow?.close();
      state.textContent = error.message;
      state.hidden = false;
      state.classList.add('cgpt-export-error');
    } finally {
      submit.disabled = close.disabled = fields.disabled = false;
      submitLabel.textContent = buttonTitle;
    }
  });
  document.body.append(dialog);
  closeInspectorDetails();
  dialog.showModal();
  form.querySelector('input:checked')?.focus();
}

function exportCurrentChat() {
  const id = _resolveChatId(_chatIdFromPath());
  if (id) _showExportModal([id]);
}

async function _runExport(format, ids, progress, printWindow) {
  if (!_extCtxOk()) throw new Error('Refresh ChatGPT and try again.');

  const convos = [];
  for (const [index, id] of ids.entries()) {
    if (progress) progress.textContent = `Reading ${index + 1} of ${ids.length}…`;
    let convo = _resolveChatId(_chatIdFromPath()) === id ? extractFromDOM() : null;
    if (!convo?.messages.length) convo = await exportLog(id);
    if (!convo?.messages.length) throw new Error('Open each selected chat to make its transcript available, then retry.');
    if (!convo.title) convo.title = _findChatLink(id)?.textContent.trim() || 'Untitled';
    convos.push(convo);
  }
  if (!convos.length) throw new Error('Select a chat first.');

  const date = new Date().toISOString().slice(0,10);
  const sanitize = t => (t||'chat').replace(/[^\p{L}\p{N}\s_-]/gu,'').trim().replace(/\s+/g,'_').slice(0,60)||'chat';
  const base = convos.length===1 ? `${sanitize(convos[0].title)}_${date}` : `chatgpt-export_${date}`;

  if (format==='md')   downloadBlob(toMarkdown(convos), `${base}.md`, 'text/markdown');
  if (format==='txt')  downloadBlob(toPlainText(convos), `${base}.txt`, 'text/plain');
  if (format==='json') downloadBlob(toJSON(convos), `${base}.json`, 'application/json');
  if (format==='ctx')  downloadBlob(toContextPackage(convos[0]), `${base}_context.txt`, 'text/plain');
  if (format==='pdf')  printHtml(toPdfHtml(convos), printWindow);
}

// Batch sidebar and conversation updates on native DOM changes.
let refreshFrame = 0;
let logTimer = 0;
let lastPath = location.pathname;

function scheduleLog() {
  clearTimeout(logTimer);
  const chatId = _chatIdFromPath();
  if (!_s.saveTranscripts || !chatId || previouslyEncrypted.has(chatId)) return;
  logTimer = setTimeout(() => {
    if (_extCtxOk() && _s.saveTranscripts && !previouslyEncrypted.has(chatId) && chatId === _chatIdFromPath()) {
      scanAndLog(chatId).catch(error => console.error('[Modus] Could not save chat log:', error.message));
    }
  }, 2200);
}

function scheduleRefresh() {
  if (!_uiReady || refreshFrame) return;
  refreshFrame = requestAnimationFrame(() => {
    refreshFrame = 0;
    if (!_extCtxOk()) return;
    if (_s.bulkActions) injectCheckboxes();
    if (_s.compactSidebar) setupCompactSidebar();
    if (_s.dateGroups) _scheduleDateGroups();
    if (_s.lagFix) observeMessages();
    positionInspector();
    setupTitleRename();
  });
}

function _trackPathAlias(before, after) {
  if (before && after && before !== after && before.startsWith('WEB:') && !after.startsWith('WEB:')) _migrateChatId(before, after);
}

function _onNav() {
  if (!_uiReady || lastPath === location.pathname) return;
  const before = conversationId(lastPath);
  const after = _chatIdFromPath();
  lastPath = location.pathname;
  const replacesTemporary = before?.startsWith('WEB:') && after && !after.startsWith('WEB:');
  if (replacesTemporary) _trackPathAlias(before, after);
  closeInspectorDetails();
  _rememberPendingId();
  setupTitleRename();
  scheduleRefresh();
  renderInspector();
  scheduleLog();
}

const _mutObs = new MutationObserver(mutations => {
  if (!_extCtxOk()) { _mutObs.disconnect(); return; }
  _onNav();
  for (const mutation of mutations) {
    const element = mutation.target.nodeType === 1 ? mutation.target : mutation.target.parentElement;
    if (element?.matches('[data-modus-title]') && !element.querySelector('.cgpt-title-rename')) scheduleRefresh();
    if (!element || element.closest('#cgpt-top-inspector, #cgpt-action-bar, #cgpt-export-sheet, #cgpt-icon-grid, [data-cgpt-dg-hdr], [data-modus-title]')) continue;
    if (mutation.type === 'childList') {
      const changed = [...mutation.addedNodes, ...mutation.removedNodes];
      if (changed.length && changed.every(node => node.nodeType === 1 &&
        node.matches('[id^="cgpt-"], [class^="cgpt-"], [data-cgpt-dg-hdr], [data-modus-title]'))) continue;
    }
    const layoutRegion = 'header, [role="banner"], [role="toolbar"], [role="tablist"], ' + sidebarLandmark;
    if (element.closest(layoutRegion) || (mutation.type === 'childList' &&
      [...mutation.addedNodes, ...mutation.removedNodes].some(node => node.nodeType === 1 &&
        (node.matches(layoutRegion + ', main, [role="main"]') ||
          node.querySelector(layoutRegion + ', main, [role="main"]'))))) {
      scheduleRefresh();
    } else if (element.closest('main, #main, [role="region"][aria-label="Conversation"]')) {
      scheduleLog();
      if (mutation.type === 'childList' && [...mutation.addedNodes].some(node => node.nodeType === 1 &&
        (node.matches('[data-message-author-role], [data-message-role]') ||
          node.querySelector('[data-message-author-role], [data-message-role]')))) scheduleRefresh();
    }
  }
});

window.navigation?.addEventListener('currententrychange', _onNav);
window.addEventListener('popstate', _onNav);
window.addEventListener('resize', () => { positionInspector(); scheduleRefresh(); });
document.addEventListener('fullscreenchange', scheduleRefresh);
document.addEventListener('pointerup', () => { if (_uiReady) scheduleRefresh(); });

// ---------------------------------------------------------------------------
// SETTINGS
// ---------------------------------------------------------------------------
function _apply(key) {
  switch (key) {
    case 'lagFix':
      if (_s.lagFix) { setupVirtualization(); observeMessages(); }
      else teardownVirtualization();
      break;
    case 'saveTranscripts':
      scheduleLog();
      break;
    case 'bulkActions':
      if (_s.bulkActions) { injectCheckboxes(); break; }
      document.querySelectorAll('.cgpt-select-control').forEach(control => control.remove());
      document.querySelectorAll('.cgpt-select-row').forEach(row => row.classList.remove('cgpt-select-row'));
      document.querySelectorAll('[data-modus-select-position]').forEach(row => row.removeAttribute('data-modus-select-position'));
      document.querySelectorAll('.cgpt-bulk-item').forEach(link => {
        link.classList.remove('cgpt-bulk-item');
        delete link.dataset.cgptId;
      });
      document.getElementById('cgpt-action-bar')?.remove();
      _selectedIds.clear(); _lastCb = null;
      break;
    case 'compactSidebar':
      if (_s.compactSidebar) setupCompactSidebar(); else _clearCompactSidebar();
      break;
    case 'modelBadge':
    case 'contextBar':
    case 'contextWarning':
      renderInspector();
      break;
    case 'dateGroups':
      if (_s.dateGroups) setupDateGroups(); else teardownDateGroups();
      break;
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (!_uiReady || !_extCtxOk() || area !== 'local') return;
  for (const [key, change] of Object.entries(changes)) {
    if (!(key in DEFAULT_SETTINGS)) continue;
    _s[key] = change.newValue ?? DEFAULT_SETTINGS[key];
    _apply(key);
  }
});

async function boot() {
  _s = await loadSettings();
  await _loadIdAliases();
  if (!_extCtxOk()) return;
  const legacy = await _storeGet(['cgpt_encrypted_ids']);
  for (const id of legacy.cgpt_encrypted_ids || []) previouslyEncrypted.add(id);
  _rememberPendingId();
  _reconcilePendingId();
  if (_s.lagFix) setupVirtualization();
  renderInspector();
  _mutObs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href', 'hidden', 'aria-hidden', 'inert'] });
  scheduleRefresh();
  scheduleLog();
}

const scheduleBoot = () => {
  if (_dead || _uiReady) return;
  const launch = () => {
    if (_dead || _uiReady) return;
    _uiReady = true;
    boot().catch(error => { if (!_isCtxErr(error)) console.error('[Modus] Could not initialize:', error.message); });
  };
  if ('requestIdleCallback' in window) {
    requestIdleCallback(launch, { timeout: 2000 });
  } else {
    setTimeout(launch, 0);
  }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', scheduleBoot, { once: true });
} else {
  scheduleBoot();
}
