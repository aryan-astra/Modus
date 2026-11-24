import { loadSettings } from './src/settings.js';
import { availableUpdate, checkReleaseMessage, releaseStateKey } from './src/release-updates.js';

const groups = {
  activity: [
    ['modelBadge', 'Response model', 'Shows the model ChatGPT reports for the current reply, when available.'],
    ['contextBar', 'Context usage', 'Shows token counts and fills the context ring when ChatGPT reports both usage and the window size.'],
    ['contextWarning', 'Context warning', 'Shows an alert when the reported input reaches 90% of the reported context window.'],
  ],
  workspace: [
    ['lagFix', 'Long-chat rendering', 'Lets the browser defer rendering older turns in legacy chats. ChatGPT manages rendering in newer chats.'],
    ['compactSidebar', 'Sidebar shortcuts', 'Moves Images, Library, Explore, and other available tools into a compact icon strip.'],
    ['bulkActions', 'Chat selection', 'Adds checkboxes for exporting, archiving, or deleting chats shown in the sidebar.'],
    ['dateGroups', 'Group by date', 'Adds collapsible date headings using timestamps from ChatGPT.'],
    ['saveTranscripts', 'Save transcripts', 'Keeps local copies of opened chats so you can export them later from the sidebar.'],
  ],
};

const status = document.getElementById('settings-status');
const help = document.getElementById('settings-help');
const title = document.getElementById('help-title');
const copy = document.getElementById('help-copy');
let activeHelp;

function showError(message) {
  status.textContent = message;
  status.hidden = false;
}

function closeHelp() {
  activeHelp?.setAttribute('aria-expanded', 'false');
  activeHelp = null;
  help.hidden = true;
}

function showHelp(button, name, description) {
  if (activeHelp !== button) closeHelp();
  activeHelp = button;
  activeHelp.setAttribute('aria-expanded', 'true');
  title.textContent = name;
  copy.textContent = description;
  help.hidden = false;
}

function createSetting([key, name, description]) {
  const row = document.createElement('div');
  row.className = 'setting';
  const label = document.createElement('label');
  label.htmlFor = key;
  label.textContent = name;

  const hint = document.createElement('button');
  hint.type = 'button';
  hint.className = 'setting-hint';
  hint.setAttribute('aria-label', `About ${name}`);
  hint.setAttribute('aria-controls', help.id);
  hint.setAttribute('aria-expanded', 'false');
  hint.textContent = '?';
  const reveal = () => showHelp(hint, name, description);
  hint.addEventListener('pointerenter', reveal);
  hint.addEventListener('focus', reveal);
  hint.addEventListener('click', reveal);

  const control = document.createElement('input');
  control.type = 'checkbox';
  control.id = key;
  control.setAttribute('role', 'switch');
  control.disabled = true;
  row.append(label, hint, control);
  return { key, row, control };
}

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && activeHelp) closeHelp();
});
document.addEventListener('pointerdown', event => {
  if (!event.target.closest('.setting-hint, #settings-help')) closeHelp();
});
document.addEventListener('focusin', event => {
  if (!event.target.closest('.setting-hint, #settings-help')) closeHelp();
});

async function init() {
  document.getElementById('ext-version').textContent = `v${chrome.runtime.getManifest().version}`;
  const controls = [];
  for (const [group, definitions] of Object.entries(groups)) {
    const list = document.getElementById(`${group}-settings`);
    for (const definition of definitions) {
      const setting = createSetting(definition);
      controls.push(setting);
      list.append(setting.row);
    }
  }

  const settings = await loadSettings();
  for (const { key, control } of controls) {
    control.checked = Boolean(settings[key]);
    control.disabled = false;
    control.addEventListener('change', async () => {
      const previous = settings[key];
      const next = control.checked;
      control.disabled = true;
      status.hidden = true;
      try {
        await chrome.storage.local.set({ [key]: next });
        settings[key] = next;
      } catch {
        control.checked = previous;
        showError('Could not save this setting.');
      } finally {
        control.disabled = false;
      }
    });
  }
}

function showReleaseUpdate(update) {
  const notice = document.getElementById('release-notice');
  const announcement = document.getElementById('release-announcement');
  const link = document.getElementById('release-link');
  if (!update) {
    notice.hidden = true;
    link.removeAttribute('href');
    announcement.textContent = '';
    return;
  }
  const label = 'Modus v' + update.version + ' is ready to download';
  link.href = update.url;
  notice.hidden = false;
  document.getElementById('release-version').textContent = label;
  if (announcement.textContent !== label) announcement.textContent = label;
}

async function refreshPopupRelease() {
  const { version } = chrome.runtime.getManifest();
  const stored = await chrome.storage.local.get(releaseStateKey).catch(() => ({}));
  showReleaseUpdate(availableUpdate(stored[releaseStateKey], version));
  const update = await chrome.runtime.sendMessage(checkReleaseMessage);
  if (update !== undefined) showReleaseUpdate(update);
}

init().catch(() => showError('Could not load Modus settings.'));
refreshPopupRelease().catch(() => {});
