import { it } from 'node:test';
import assert from 'node:assert/strict';
import { availableUpdate, checkReleaseMessage, releaseStateKey } from '../src/release-updates.js';

it('compares stable releases numerically and expires stale notices', () => {
  const verifiedAt = Date.now();
  assert.deepEqual(availableUpdate({ tag: 'v3.10.0', verifiedAt }, '3.9.9'), {
    version: '3.10.0',
    url: 'https://github.com/aryan-astra/Modus/releases/tag/v3.10.0',
  });
  for (const tag of ['v3.9.9', 'v3.9.6', 'v4.0.0-beta.1', 'v4.0.0/?x=1', 'v4.000.0']) {
    assert.equal(availableUpdate({ tag, verifiedAt }, '3.9.9'), null);
  }
  assert.equal(availableUpdate({ tag: 'v4.0.0', verifiedAt: verifiedAt - 8 * 86400000 }, '3.9.9'), null);
});

it('checks by default, shares concurrent checks, caches valid ZIPs and clears the badge after updating', async t => {
  const handlers = {};
  const storage = {};
  const badge = {};
  let version = '3.9.6';
  let requests = 0;
  const alarms = new Map();
  const event = name => ({ addListener(listener) { handlers[name] = listener; } });
  const originalFetch = globalThis.fetch;
  globalThis.chrome = {
    runtime: {
      id: 'modus',
      onInstalled: event('installed'),
      onStartup: event('startup'),
      onMessage: event('message'),
      getManifest: () => ({ version }),
      getURL: path => 'chrome-extension://modus/' + path,
    },
    storage: { local: {
      get: async key => ({ [key]: storage[key] }),
      set: async value => { Object.assign(storage, value); },
      remove: async key => { delete storage[key]; },
    } },
    alarms: {
      get: async name => alarms.get(name),
      create: async (name, options) => { alarms.set(name, options); },
      onAlarm: event('alarm'),
    },
    action: {
      setBadgeBackgroundColor: async () => {},
      setBadgeText: async ({ text }) => { badge.text = text; },
      setTitle: async ({ title }) => { badge.title = title; },
    },
  };
  t.after(() => {
    delete globalThis.chrome;
    globalThis.fetch = originalFetch;
  });
  let release = { tag_name: 'v3.10.0', draft: false, prerelease: false,
    assets: [{ name: 'modus-v3.10.0.zip', state: 'uploaded', size: 100 }] };
  let offline = false;
  globalThis.fetch = async (url, options) => {
    requests++;
    assert.equal(url, 'https://api.github.com/repos/aryan-astra/Modus/releases/latest');
    assert.equal(options.credentials, 'omit');
    if (offline) throw new Error('Offline');
    return Response.json(release);
  };
  await import('../background.js');
  const sender = { id: 'modus', url: 'chrome-extension://modus/popup.html' };
  const openPopup = () => new Promise(resolve => {
    assert.equal(handlers.message(checkReleaseMessage, sender, resolve), true);
  });

  handlers.installed();
  const [first, concurrent] = await Promise.all([openPopup(), openPopup()]);
  assert.equal(alarms.get('modus-release-check').periodInMinutes, 360);
  assert.equal(first.version, '3.10.0');
  assert.deepEqual(concurrent, first);
  assert.equal(requests, 1);
  assert.equal(badge.text, 'NEW');
  assert.match(badge.title, /3\.10\.0/);
  assert.equal(handlers.message(checkReleaseMessage, { ...sender, url: 'https://chatgpt.com/' }, () => {}), false);

  storage[releaseStateKey].nextCheckAt = 0;
  offline = true;
  handlers.alarm({ name: 'modus-release-check' });
  assert.deepEqual(await openPopup(), first);
  assert.equal(requests, 2);
  assert.deepEqual(await openPopup(), first);
  assert.equal(requests, 2);

  version = '3.10.0';
  handlers.installed();
  assert.equal(await openPopup(), null);
  assert.equal(badge.text, '');

  offline = false;
  version = '3.9.6';
  delete storage[releaseStateKey];
  release = { ...release, tag_name: 'v3.11.0', assets: [] };
  assert.equal(await openPopup(), null);
  assert.equal(badge.text, '');
});
