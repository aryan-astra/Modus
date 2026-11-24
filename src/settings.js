export const DEFAULT_SETTINGS = {
  lagFix: true,
  compactSidebar: true,
  bulkActions: true,
  modelBadge: true,
  contextBar: true,
  contextWarning: false,
  dateGroups: false,
  saveTranscripts: false,
};

export async function loadSettings() {
  const saved = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  const missing = Object.keys(DEFAULT_SETTINGS).filter(key => !(key in saved));
  const old = missing.length ? await chrome.storage.sync.get(missing).catch(() => ({})) : {};
  return { ...DEFAULT_SETTINGS, ...old, ...saved };
}
