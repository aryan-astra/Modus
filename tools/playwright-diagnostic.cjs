const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const repoRoot = path.resolve(__dirname, '..');
  const extensionPath = repoRoot;
  const userDataDir = path.join(repoRoot, 'playwright-user-data-diagnostic');
  fs.mkdirSync(userDataDir, { recursive: true });

  const errors = [];
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
    viewport: null,
  });
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded' });
  console.log('Browser launched with the unpacked extension.');
  console.log('Log in if authenticated coverage is required, open a conversation, then press ENTER.');
  process.stdin.resume();
  await new Promise((resolve) => process.stdin.once('data', resolve));

  const result = await page.evaluate(() => {
    const links = [...document.querySelectorAll('a[href^="/c/"], a[href^="/uc/"]')];
    const hiddenTools = [...document.querySelectorAll('[data-cgpt-grid-hidden]')]
      .filter((element) => getComputedStyle(element).display !== 'none')
      .map((element) => element.textContent.trim());
    const firstLink = links[0];
    return {
      url: location.href,
      markers: {
        modelBadge: !!document.getElementById('cgpt-model-badge'),
        contextBar: !!document.getElementById('cgpt-ctx-bar'),
        compactGrid: !!document.getElementById('cgpt-icon-grid'),
        vaultHeader: !!document.getElementById('cgpt-vault-hdr'),
      },
      sidebar: {
        conversationLinks: links.length,
        checkboxes: document.querySelectorAll('.cgpt-cb').length,
        firstLinkHasCheckbox: !!firstLink?.querySelector('.cgpt-cb'),
        firstLinkBulkClass: !!firstLink?.classList.contains('cgpt-bulk-item'),
        hiddenTools,
      },
      messageBlocks: document.querySelectorAll('[data-message-author-role], [data-message-role]').length,
    };
  });

  console.log('\nDiagnostics:');
  console.log(JSON.stringify({ ...result, consoleErrors: errors }, null, 2));
  console.log('\nPress ENTER to close the browser and exit.');
  await new Promise((resolve) => process.stdin.once('data', resolve));
  await context.close();
})();
