const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const repoRoot = path.resolve(__dirname, '..');
  const extensionPath = repoRoot;
  const userDataDir = path.join(repoRoot, 'playwright-user-data-test');
  fs.mkdirSync(userDataDir, { recursive: true });

  const errors = [];
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded' });
  console.log('Browser launched. Log in if required, then press ENTER to run checks.');
  process.stdin.resume();
  await new Promise((resolve) => process.stdin.once('data', resolve));

  const result = await page.evaluate(() => {
    const links = [...document.querySelectorAll('a[href^="/c/"], a[href^="/uc/"]')];
    const grid = document.getElementById('cgpt-icon-grid');
    const hiddenTools = [...document.querySelectorAll('[data-cgpt-grid-hidden]')]
      .filter((element) => getComputedStyle(element).display !== 'none')
      .map((element) => element.textContent.trim());
    return {
      url: location.href,
      modelBadge: !!document.getElementById('cgpt-model-badge'),
      contextBar: !!document.getElementById('cgpt-ctx-bar'),
      compactGrid: {
        exists: !!grid,
        visible: !!grid && grid.offsetParent !== null,
        childCount: grid?.children.length || 0,
      },
      sidebar: {
        conversationLinks: links.length,
        checkboxes: document.querySelectorAll('.cgpt-cb').length,
        firstLinkHasCheckbox: !!links[0]?.querySelector('.cgpt-cb'),
        firstLinkBulkClass: !!links[0]?.classList.contains('cgpt-bulk-item'),
        hiddenTools,
      },
      messageBlocks: document.querySelectorAll('[data-message-author-role], [data-message-role]').length,
      vaultHeader: !!document.getElementById('cgpt-vault-hdr'),
    };
  });

  console.log('\nFull test result:');
  console.log(JSON.stringify({ ...result, consoleErrors: errors }, null, 2));
  console.log('\nPress ENTER to close the browser and exit.');
  await new Promise((resolve) => process.stdin.once('data', resolve));
  await context.close();
})();
