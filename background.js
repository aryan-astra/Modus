async function removeLegacyRequestHeaders() {
  await chrome.storage.local.remove('chatgpt_headers');
}

chrome.runtime.onInstalled.addListener(() => {
  removeLegacyRequestHeaders().catch(error => console.error('[Modus] Legacy header cleanup failed:', error.message));
});
