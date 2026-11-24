// Checks the local Chrome remote-debugging endpoint and lists targets.
// Usage: node tools/cdp-check.cjs
const http = require('node:http');

function get(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: 9222, path }, (res) => {
      let s = '';
      res.on('data', (c) => (s += c));
      res.on('end', () => {
        try { resolve(JSON.parse(s)); } catch (e) { reject(new Error('non-JSON: ' + s.slice(0, 200))); }
      });
    }).on('error', reject);
  });
}

(async () => {
  const ver = await get('/json/version');
  console.log('browser:', ver.Browser, '| ws:', ver.webSocketDebuggerUrl);
  const tabs = await get('/json/list');
  for (const t of tabs) {
    if (t.type !== 'page') continue;
    console.log('-', t.title.slice(0, 60), '|', t.url.slice(0, 100));
  }
})().catch((e) => { console.error('CDP-UNREACHABLE:', e.message); process.exit(1); });
