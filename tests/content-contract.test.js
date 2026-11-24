import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const read = file => readFile(new URL('../' + file, import.meta.url), 'utf8');
const sniffer = await read('net-sniffer.js');
const content = await read('content.js');
const manifest = JSON.parse(await read('manifest.json'));

function fakePage(path) {
  const dom = new JSDOM(`<!DOCTYPE html><body>
    <nav aria-label="Chat history"><ul>
      <li><button>New chat</button></li><li><button>Images</button></li>
      <li><button aria-haspopup="menu">More</button></li>
      <li><a href="/c/test-chat">Example</a></li>
    </ul></nav><main></main>`, {
    url: 'https://chatgpt.com' + path, runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const { window } = dom;
  window.Element.prototype.getClientRects = () => [{}];
  const events = [];
  const listeners = [];
  window.addEventListener('message', event => events.push(event.data));
  window.postMessage = (data, origin) => queueMicrotask(() => {
    assert.equal(origin, window.location.origin);
    window.dispatchEvent(new window.MessageEvent('message', { data, origin, source: window }));
  });
  window.chrome = { runtime: { id: 'test' }, storage: {
    local: { get: async () => ({ lagFix: false }), set: async () => {} },
    sync: { get: async () => ({}) },
    onChanged: { addListener: listener => listeners.push(listener) },
  } };
  window.matchMedia = () => ({ addEventListener() {} });
  window.TextDecoder = TextDecoder;
  return { dom, window, events, listeners };
}

async function waitFor(find) {
  for (let tries = 0; tries < 100; tries++) {
    const result = find();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('Expected browser state was not reached');
}

function jsonResponse(path, body) {
  const response = new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  Object.defineProperty(response, 'url', { value: 'https://chatgpt.com' + path });
  return response;
}

it('ships passive MAIN-world and isolated scripts without header access', async () => {
  assert.deepEqual(manifest.permissions, ['storage']);
  assert.ok(manifest.content_scripts.every(spec => spec.run_at === 'document_start'));
  assert.ok(manifest.content_scripts.some(spec => spec.world === 'MAIN' && spec.js.includes('net-sniffer.js')));
  assert.doesNotMatch(content, /\bfetch\s*\(|\bXMLHttpRequest\b/);
  assert.doesNotMatch(await read('background.js'), /chrome\.webRequest/);
});

it('replays early metadata, keeps conversations independent and applies local settings', async t => {
  const { dom, window, listeners, events } = fakePage('/c/test-chat');
  t.after(() => dom.window.close());
  const path = '/backend-api/conversations/test-chat';
  const response = jsonResponse(path, {
    conversation_id: 'test-chat', current_node: 'r', messages: [{
      id: 'r', author: { role: 'assistant' }, content: { parts: ['private reply'] },
      metadata: { model_slug: 'observed-reply', usage: { input_tokens: 1240 } },
    }],
  });
  const original = Promise.resolve(response);
  let calls = 0;
  window.fetch = () => { calls++; return original; };
  window.eval(sniffer);
  assert.equal(window.fetch(path), original);
  assert.equal(await response.clone().json().then(data => data.current_node), 'r');
  await waitFor(() => events.find(event => event.kind === 'conversation'));
  assert.ok(events.every(event => !JSON.stringify(event).includes('private reply')));
  window.eval(content);
  const badge = await waitFor(() => window.document.getElementById('cgpt-activity-button'));
  assert.equal(badge.textContent.trim(), 'observed-reply');
  badge.click();
  assert.match(window.document.getElementById('cgpt-ctx-popover').textContent, /1,240/);
  await waitFor(() => window.document.querySelector('#cgpt-icon-grid button'));
  assert.equal(window.document.querySelectorAll('#cgpt-icon-grid button').length, 1);
  assert.equal(window.document.querySelector('button[aria-haspopup="menu"]').textContent, 'More');
  window.history.pushState(null, '', '/c/unknown');
  window.dispatchEvent(new window.PopStateEvent('popstate'));
  assert.equal(badge.getAttribute('aria-label'), 'Chat activity');
  assert.equal(window.document.getElementById('cgpt-ctx-popover').hidden, true);
  listeners[0]({ modelBadge: { newValue: false } }, 'local');
  assert.equal(badge.hidden, false);
  listeners[0]({ contextBar: { newValue: false } }, 'local');
  assert.equal(window.document.getElementById('cgpt-activity-button'), null);
  assert.equal(calls, 1);
});

it('observes SSE metadata across chunk boundaries while leaving the page stream readable', async t => {
  const { dom, window, events } = fakePage('/c/test-chat');
  t.after(() => dom.window.close());
  const chunks = [
    'data: {"conversation_id":"test-chat","message":{"id":"r","author":{"role":"assistant"},"metadata":{"model_slug":"stream-mo',
    'del"}}}\r\n\r',
    '\ndata: {"p":"/message/metadata/usage","o":"add","v":{"input_tokens":45}}\n\ndata: [DONE]\n\n',
  ];
  const streamed = new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  }), { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
  Object.defineProperty(streamed, 'url', { value: 'https://chatgpt.com/backend-api/f/conversation' });
  window.fetch = async () => streamed;
  window.eval(sniffer);
  assert.equal(await (await window.fetch('/backend-api/f/conversation', { method: 'POST' })).text(), chunks.join(''));
  const observed = await waitFor(() => events.find(event => event.data?.used === 45));
  assert.equal(observed.data.model, 'stream-model');
  assert.equal(observed.id, 'test-chat');
  assert.equal(events[0].phase, 'start');
});

it('reads native XHR JSON without publishing request headers or memory text', async t => {
  const { dom, window, events } = fakePage('/');
  t.after(() => dom.window.close());
  class ExampleRequest extends window.EventTarget {
    open(method, url) { this.responseURL = new URL(url, window.location.origin).href; }
    send() {
      this.status = 200;
      this.response = { memory_enabled: true, memories: [{ content: 'private memory' }] };
      this.dispatchEvent(new window.Event('loadend'));
    }
  }
  window.XMLHttpRequest = ExampleRequest;
  window.eval(sniffer);
  const request = new window.XMLHttpRequest();
  request.open('GET', '/backend-api/memories');
  request.responseType = 'json';
  request.send();
  const event = await waitFor(() => events.find(event => event.kind === 'memory'));
  assert.deepEqual({ ...event.data }, { enabled: true, count: 1 });
  assert.equal(request.response.memories[0].content, 'private memory');
});

it('archives a selected sidebar row through its own native menu', async t => {
  const { dom, window } = fakePage('/c/test-chat');
  t.after(() => dom.window.close());
  const { document } = window;
  const link = document.querySelector('a[href="/c/test-chat"]');
  const row = link.parentElement;
  const trigger = document.createElement('button');
  trigger.id = 'native-menu-trigger';
  trigger.setAttribute('aria-label', 'Chat actions');
  trigger.addEventListener('click', () => {
    const menu = document.createElement('div');
    menu.id = 'native-menu-items';
    const item = document.createElement('button');
    item.textContent = 'Archive';
    item.addEventListener('click', () => { row.remove(); menu.remove(); });
    menu.append(item);
    document.body.append(menu);
  });
  row.append(trigger);
  window.eval(content);
  const checkbox = await waitFor(() => row.querySelector('input.cgpt-cb'));
  assert.equal(checkbox.getAttribute('aria-label'), 'Select Example');
  assert.equal(link.contains(checkbox), false);
  checkbox.click();
  const archive = await waitFor(() => [...document.querySelectorAll('#cgpt-action-bar button')].find(button => button.textContent === 'Archive'));
  archive.click();
  await waitFor(() => !row.isConnected && !document.querySelector('#cgpt-action-bar'));
});


it('keeps the account-specific Explore menu reachable from the top shortcuts', async t => {
  const { dom, window, listeners } = fakePage('/c/test-chat');
  t.after(() => dom.window.close());
  const { document } = window;
  const native = document.querySelector('button[aria-haspopup="menu"]');
  native.textContent = 'Explore';
  const reveal = () => {
    native.setAttribute('aria-expanded', 'true');
    native.setAttribute('aria-controls', 'native-explore');
  };
  native.addEventListener('keydown', event => { if (event.key === 'Enter') reveal(); });
  window.eval(content);
  const proxy = await waitFor(() => document.querySelector('#cgpt-icon-grid button[aria-haspopup="menu"]'));
  assert.equal(proxy.getAttribute('aria-label'), 'Explore');
  proxy.click();
  await waitFor(() => proxy.getAttribute('aria-controls') === 'native-explore');
  listeners[0]({ compactSidebar: { newValue: false } }, 'local');
  assert.equal(native.hasAttribute('aria-hidden'), false);
  assert.equal(document.getElementById('cgpt-icon-grid'), null);
});


it('saves the inline title through the native rename dialog on Enter and blur', async t => {
  const { dom, window } = fakePage('/c/test-chat');
  t.after(() => dom.window.close());
  const { document } = window;
  const header = document.createElement('header');
  header.innerHTML = '<div class="conversation-title-inline">Old title</div><button aria-label="Chat actions" id="native-trigger">More</button>';
  document.body.prepend(header);
  let saves = 0;
  header.querySelector('button').onclick = () => {
    const menu = document.createElement('div');
    menu.id = 'native-actions';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-labelledby', 'native-trigger');
    menu.innerHTML = '<div role="menuitem"><div data-menu-row-content="true"><span>Rename</span><span aria-hidden="true">R</span></div></div>';
    document.body.append(menu);
    menu.querySelector('[role="menuitem"]').onclick = () => {
      menu.remove();
      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      dialog.innerHTML = '<input aria-label="Chat title"><button disabled>Save</button>';
      document.body.append(dialog);
      const input = dialog.querySelector('input');
      const save = dialog.querySelector('button');
      input.oninput = () => { save.disabled = !input.value.trim(); };
      save.onclick = () => {
        saves++;
        header.firstElementChild.firstChild.nodeValue = input.value;
        dialog.remove();
      };
    };
  };
  window.eval(content);
  const rename = await waitFor(() => header.querySelector('.cgpt-title-rename'));
  rename.click();
  let input = await waitFor(() => header.querySelector('.cgpt-title-input'));
  input.value = 'First change';
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter' }));
  await waitFor(() => saves === 1);
  assert.equal(header.firstElementChild.textContent, 'First change');
  await waitFor(() => !rename.hasAttribute('aria-busy'));
  rename.click();
  input = await waitFor(() => header.querySelector('.cgpt-title-input'));
  input.value = 'Second change';
  input.dispatchEvent(new window.FocusEvent('blur'));
  await waitFor(() => saves === 2);
  assert.equal(header.firstElementChild.textContent, 'Second change');
  await waitFor(() => !rename.hasAttribute('aria-busy'));
  rename.click();
  input = await waitFor(() => header.querySelector('.cgpt-title-input'));
  input.value = 'Cancelled';
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(header.querySelector('.cgpt-title-input'), null);
  assert.equal(saves, 2);
});

it('puts date headings outside native chat rows and collapses the row and its actions', async t => {
  const { dom, window, listeners } = fakePage('/c/test-chat');
  t.after(() => dom.window.close());
  const { document } = window;
  const link = document.querySelector('a[href="/c/test-chat"]');
  const row = link.parentElement;
  row.innerHTML = '<div><a href="/c/test-chat">Example</a></div><div><button aria-label="Chat actions">More</button></div>';
  window.eval(content);
  await waitFor(() => document.getElementById('cgpt-activity-button'));
  listeners[0]({ bulkActions: { newValue: false }, dateGroups: { newValue: true } }, 'local');
  window.postMessage({ source: 'cgpt-modus-net', kind: 'conversations', phase: 'data', request: 1, revision: 1, at: Date.now(),
    data: [{ id: 'test-chat', time: new Date().toISOString() }] }, window.location.origin);
  const group = await waitFor(() => document.querySelector('[data-cgpt-dg-hdr]'));
  assert.equal(group.nextElementSibling, row);
  group.querySelector('button').click();
  assert.equal(row.classList.contains('cgpt-dg-hidden'), true);
  assert.equal(group.querySelector('button').getAttribute('aria-expanded'), 'false');
});

it('applies rendering containment only to older turns in non-virtualized chats', async t => {
  const { dom, window, listeners } = fakePage('/c/test-chat');
  t.after(() => dom.window.close());
  const { document } = window;
  const transcript = document.querySelector('main');
  transcript.innerHTML = '<div data-message-author-role="assistant">Legacy turn</div>'.repeat(30);
  window.eval(content);
  await waitFor(() => document.getElementById('cgpt-activity-button'));
  listeners[0]({ lagFix: { newValue: true } }, 'local');
  assert.equal(transcript.querySelectorAll('[data-cgpt-lite-turn]').length, 18);
  listeners[0]({ lagFix: { newValue: false } }, 'local');
  assert.equal(transcript.querySelectorAll('[data-cgpt-lite-turn]').length, 0);
  transcript.firstElementChild.dataset.virtualizedTurn = '';
  listeners[0]({ lagFix: { newValue: true } }, 'local');
  assert.equal(transcript.querySelectorAll('[data-cgpt-lite-turn]').length, 0);
});
