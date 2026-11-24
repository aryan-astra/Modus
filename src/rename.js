import { conversationId } from './context-data.js';
import { modusIcon } from './ui-icons.js';

const titleSelectors = '[class*="conversation-title-inline"], [data-testid="conversation-title"]';
const nativeTitleField = '[role="dialog"] input[aria-label="Chat title"], [role="dialog"] input[name="title"]';
let titleRename;

function findNativeTitle(id, current) {
  if (!id) return null;
  const sidebarTitle = _findChatLink(id)?.textContent.trim();
  for (const header of document.querySelectorAll('header')) {
    if (!header.querySelector('button[aria-label="Chat actions"]')) continue;
    const visible = element => element === current || element.getClientRects().length;
    const known = [...header.querySelectorAll(titleSelectors)].find(visible);
    if (known) return known;
    if (!sidebarTitle) continue;
    const match = [...header.querySelectorAll('h1, h2, [role="heading"], span, div')].find(element =>
      visible(element) && !element.closest('button, a, [role="button"]') &&
      !element.querySelector('button, a, [role="button"]') && element.textContent.trim() === sidebarTitle);
    if (match) return match;
  }
  return null;
}

export function setupTitleRename() {
  const id = conversationId(location.pathname);
  const title = findNativeTitle(id, titleRename?.title);
  if (titleRename?.title === title && titleRename?.id === id && titleRename.button.isConnected) return;
  if (titleRename) {
    titleRename.cancel?.();
    titleRename.button.remove();
    titleRename.title.removeAttribute('data-modus-title');
    titleRename.title.removeAttribute('data-modus-editing');
    titleRename = undefined;
  }
  if (!title) return;

  title.dataset.modusTitle = '';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'cgpt-title-rename';
  button.setAttribute('aria-label', 'Rename chat');
  button.title = 'Rename chat';
  button.innerHTML = modusIcon('pencil');
  const record = { id, title, button };
  titleRename = record;
  title.append(button);
  button.addEventListener('click', () => editTitle(record));
}

function editTitle(record) {
  const { title, button, id } = record;
  if (record.editor?.isConnected || record.saving) return;
  const previous = title.textContent.trim();
  if (!previous) return;
  const editor = document.createElement('input');
  editor.type = 'text';
  editor.className = 'cgpt-title-input';
  editor.setAttribute('aria-label', 'Chat title');
  editor.value = previous;
  record.editor = editor;
  title.dataset.modusEditing = '';
  title.after(editor);
  editor.focus();
  editor.select();

  let finished = false;
  const finish = async (save, focus = false) => {
    if (finished) return;
    finished = true;
    record.cancel = undefined;
    const value = editor.value.trim();
    editor.remove();
    delete title.dataset.modusEditing;
    record.editor = null;
    if (conversationId(location.pathname) !== id) return;
    if (!save || !value || value === previous) {
      if (focus) button.focus();
      return;
    }
    record.saving = true;
    button.setAttribute('aria-busy', 'true');
    try {
      const ok = await submitNativeRename(record, value);
      if (conversationId(location.pathname) !== id) return;
      if (!ok) showRenameError(titleRename?.title || title);
      if (focus && !document.querySelector(nativeTitleField)) titleRename?.button.focus({ preventScroll: true });
    } catch {
      if (conversationId(location.pathname) === id) showRenameError(titleRename?.title || title);
    } finally {
      record.saving = false;
      button.removeAttribute('aria-busy');
    }
  };
  record.cancel = () => finish(false);
  editor.addEventListener('keydown', event => {
    if (event.isComposing || !['Enter', 'Escape'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    finish(event.key === 'Enter', true);
  });
  editor.addEventListener('blur', () => finish(true), { once: true });
}

function showRenameError(title) {
  if (!title.isConnected) return;
  const status = document.createElement('span');
  status.className = 'cgpt-title-status';
  status.setAttribute('role', 'status');
  status.textContent = 'Rename could not be confirmed. Try Chat actions.';
  title.after(status);
  setTimeout(() => status.remove(), 4200);
}

async function submitNativeRename({ title, id }, value) {
  const trigger = title.closest('header')?.querySelector('button[aria-label="Chat actions"]');
  const onChat = () => conversationId(location.pathname) === id;
  const active = () => trigger?.isConnected && onChat();
  if (!active() || document.querySelector(nativeTitleField)) return false;
  const ownMenu = () => {
    const linked = document.getElementById(trigger.getAttribute('aria-controls') || '');
    return linked || [...document.querySelectorAll('[role="menu"]')].find(node =>
      trigger.id && node.getAttribute('aria-labelledby') === trigger.id);
  };
  const option = () => {
    const menu = ownMenu();
    return menu && _nativeControl(menu, '[role="menuitem"], button', 'rename');
  };
  if (trigger.getAttribute('aria-expanded') !== 'true') {
    trigger.click();
    if (!option() && trigger.getAttribute('aria-expanded') !== 'true') {
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
    }
  }
  const rename = await _waitForControl(() => active() && option());
  if (!rename || !active()) {
    if (active() && ownMenu()) {
      ownMenu().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    }
    return false;
  }

  rename.click();
  const field = await _waitForControl(() => onChat() && document.querySelector(nativeTitleField));
  if (!field || !onChat()) return false;
  if (field.maxLength > 0 && value.length > field.maxLength) { field.focus(); return false; }
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setter) return false;
  setter.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  const owner = field.closest('[role="dialog"]');
  const save = await _waitForControl(() => onChat() && field.isConnected &&
    _nativeControl(owner, 'button:not(:disabled):not([aria-disabled="true"])', 'save'));
  if (!save || !onChat() || field.value !== value) return false;
  save.click();
  return Boolean(await _waitForControl(() => onChat() && !field.isConnected &&
    findNativeTitle(id, title)?.textContent.trim() === value, 4000));
}
