import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { extractId, findByText, findSidebarRoot, nodeMatches, queryAll, queryFirst } from '../src/compat/selectors.js';

describe('selector compatibility integration', () => {
  it('extracts both authenticated and guest conversation ids', () => {
    assert.equal(extractId('/c/abc-123?x=1'), 'abc-123');
    assert.equal(extractId('/uc/abc-456#x'), 'abc-456');
    assert.equal(extractId('/c/WEB:temporary-123'), 'WEB:temporary-123');
    assert.equal(extractId('/'), null);
  });

  it('matches the current sidebar and message structures', () => {
    const dom = new JSDOM(`<!doctype html><body>
      <aside aria-label="Sidebar">
        <a href="/uc/abc-123">Guest chat</a>
        <a href="/images" data-octane-navigation-item="images">Images</a>
        <button aria-label="Deep research" data-octane-navigation-item="deep_research">Deep research</button>
      </aside>
      <main><ul><li data-message-role="user">Hello</li><li data-message-role="assistant">Hi</li></ul></main>
      <header><span role="button">ChatGPT</span></header>
    </body>`);
    const { document } = dom.window;
    assert.equal(queryFirst('modelBtn', document), null);
    assert.equal(queryFirst('sidebarRoot', document).tagName, 'ASIDE');
    assert.equal(queryAll('sidebarLink', document).length, 1);
    assert.equal(queryAll('msgBlock', document).length, 2);
    assert.ok(queryAll('sidebarTools', document).length >= 1);
    assert.equal(nodeMatches(document.querySelector('button[aria-label="Deep research"]'), 'sidebarTools'), true);
    assert.equal(nodeMatches(document.querySelector('li[data-message-role="user"]'), 'msgBlock'), true);
  });

  it('prefers the composer model control over sidebar menus', () => {
    const dom = new JSDOM(`<!doctype html><body>
      <header><button aria-haspopup="menu">Recents</button></header>
      <main><button class="__composer-pill">Think</button></main>
    </body>`);
    assert.equal(queryFirst('modelBtn', dom.window.document).textContent, 'Think');
  });

  it('finds a common sidebar root across separate nav regions', () => {
    const dom = new JSDOM(`<!doctype html><body>
      <div class="sidebar-shell">
        <nav aria-label="Sidebar"><a href="/">New chat</a></nav>
        <nav aria-label="Chat history"><a href="/images">Images</a><a href="/c/abc-123">Chat</a></nav>
      </div>
    </body>`);
    const root = findSidebarRoot(dom.window.document);
    assert.equal(root?.className, 'sidebar-shell');
  });

  it('finds text using the supplied document root', () => {
    const dom = new JSDOM('<!doctype html><body><div><span>Search chats</span></div></body>');
    const found = findByText('Search chats', dom.window.document.body);
    assert.equal(found?.textContent, 'Search chats');
  });
});
