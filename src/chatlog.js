import { extractFromDOM } from './export.js';

const LOG_PREFIX = 'cgpt_chatlog_snapshot:';
const LEGACY_LOG_KEY = 'cgpt_chatlog_v1';
const MAX_LOG_AGE_MS = 90 * 24 * 60 * 60 * 1000;

export async function scanAndLog(chatId) {
  const chat = extractFromDOM();
  if (chat?.chatId !== chatId || !chat.messages.length) return;
  await chrome.storage.local.set({ [LOG_PREFIX + chatId]: { ...chat, capturedAt: Date.now() } });
}

export async function exportLog(chatId) {
  const key = LOG_PREFIX + chatId;
  const { [key]: snapshot } = await chrome.storage.local.get(key);
  if (snapshot?.chatId === chatId && Date.now() - snapshot.capturedAt < MAX_LOG_AGE_MS) {
    return { ...snapshot, source: 'Saved transcript', exportedAt: new Date().toISOString() };
  }
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_LOG_KEY) || '{}');
    const messages = (Object.hasOwn(legacy, chatId) && Array.isArray(legacy[chatId]) ? legacy[chatId] : [])
      .filter(item => Date.now() - item.updatedAt < MAX_LOG_AGE_MS)
      .map(({ role, text }) => ({ role, text }));
    return messages.length ? { chatId, messages, messageCount: messages.length, source: 'Legacy chat log' } : null;
  } catch { return null; }
}

export async function clearLog(chatId) {
  await chrome.storage.local.remove(LOG_PREFIX + chatId);
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_LOG_KEY) || '{}');
    if (Object.hasOwn(legacy, chatId)) {
      delete legacy[chatId];
      localStorage.setItem(LEGACY_LOG_KEY, JSON.stringify(legacy));
    }
  } catch { /* older storage may be unavailable */ }
}
