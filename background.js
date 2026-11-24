import { availableUpdate, checkReleaseMessage, fetchReleaseTag, releaseStateKey } from './src/release-updates.js';

const checkAlarm = 'modus-release-check';
const checkMinutes = 360;
const retryMinutes = 30;
let pendingCheck;

async function ensureReleaseAlarm() {
  if (!await chrome.alarms.get(checkAlarm)) {
    await chrome.alarms.create(checkAlarm, { periodInMinutes: checkMinutes });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.remove('chatgpt_headers').catch(error => console.error('[Modus] Legacy header cleanup failed:', error.message));
  refreshRelease().catch(reportReleaseError);
});

chrome.runtime.onStartup.addListener(() => { refreshRelease().catch(reportReleaseError); });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === checkAlarm) refreshRelease().catch(reportReleaseError);
});

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message !== checkReleaseMessage || sender.id !== chrome.runtime.id ||
      sender.url !== chrome.runtime.getURL('popup.html')) return false;
  refreshRelease().then(reply, error => {
    reportReleaseError(error);
    reply(undefined);
  });
  return true;
});

ensureReleaseAlarm().catch(reportReleaseError);

function reportReleaseError(error) {
  console.warn('[Modus] Could not check for releases:', error.message);
}

function refreshRelease() {
  pendingCheck ??= checkRelease().finally(() => { pendingCheck = undefined; });
  return pendingCheck;
}

async function checkRelease() {
  const { [releaseStateKey]: cached } = await chrome.storage.local.get(releaseStateKey);
  const now = Date.now();
  let state = cached;
  if (!Number.isFinite(cached?.nextCheckAt) || cached.nextCheckAt <= now ||
      cached.nextCheckAt > now + checkMinutes * 60000) {
    try {
      const tag = await fetchReleaseTag();
      state = { tag, verifiedAt: now, nextCheckAt: now + checkMinutes * 60000 };
    } catch {
      state = { tag: cached?.tag, verifiedAt: cached?.verifiedAt, nextCheckAt: now + retryMinutes * 60000 };
    }
    await chrome.storage.local.set({ [releaseStateKey]: state });
  }
  const update = availableUpdate(state, chrome.runtime.getManifest().version, now);
  await Promise.all([
    chrome.action.setBadgeBackgroundColor({ color: '#3158B8' }),
    chrome.action.setBadgeText({ text: update ? 'NEW' : '' }),
    chrome.action.setTitle({ title: update ? 'Modus · Update available (v' + update.version + ')' : 'Modus' }),
  ]).catch(reportReleaseError);
  return update;
}
