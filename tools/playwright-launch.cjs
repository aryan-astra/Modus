const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const repoRoot = path.resolve(__dirname, '..');
  const extensionPath = repoRoot;
  const userDataDir = path.join(repoRoot, 'playwright-user-data');
  fs.mkdirSync(userDataDir, { recursive: true });

  console.log('Launching persistent Chromium with the unpacked extension...');
  console.log('Extension path:', extensionPath);

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
    viewport: null,
  });

  const page = await context.newPage();
  await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded' });

  console.log('\nBrowser launched. Log in if you want authenticated coverage, then press ENTER.');
  process.stdin.resume();
  await new Promise((resolve) => process.stdin.once('data', resolve));

  console.log('\nRunning smoke checks...');
  const checks = await page.evaluate(() => ({
    url: location.href,
    modelBadge: !!document.getElementById('cgpt-model-badge'),
    contextBar: !!document.getElementById('cgpt-ctx-bar'),
    compactGrid: !!document.getElementById('cgpt-icon-grid'),
    conversationLinks: document.querySelectorAll('a[href^="/c/"], a[href^="/uc/"]').length,
    checkboxes: document.querySelectorAll('.cgpt-cb').length,
    vaultHeader: !!document.getElementById('cgpt-vault-hdr'),
  }));
  console.log(JSON.stringify(checks, null, 2));

  console.log('\nPress ENTER to close the browser and exit.');
  await new Promise((resolve) => process.stdin.once('data', resolve));
  await context.close();
})();
