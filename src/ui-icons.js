export const modusIcons = {
  activity: '<path d="M4 17v-4m5 4V7m6 10v-7m5 7V4"/>',
  pencil: '<path d="m15 5 4 4M4 20l4-1 13-13-4-4L4 15l-1 5h1Z"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 16-5-5L5 21"/>',
  schedule: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 10h18m-12 5 2 2 4-4"/>',
  library: '<rect x="3" y="4" width="5" height="16" rx="1"/><path d="M12 4v16m4-15 5 14"/>',
  plugins: '<path d="M12 3v4m-5 0h10v4a5 5 0 0 1-10 0V7Zm2-4v4m6-4v4m-3 9v5"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m16 8-2 6-6 2 2-6 6-2Z"/>',
  code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M4 15v5h16v-5"/>',
  archive: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v12h14V8m-9 4h4"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/>',
  file: '<path d="M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10l-7-7Zm0 0v7h7M8 14h8m-8 3h6"/>',
  rows: '<path d="M6 6h14M6 12h14M6 18h14M3 6h.01M3 12h.01M3 18h.01"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 4H6a2 2 0 0 0-2 2v10"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  check: '<path d="m5 12 4 4 10-10"/>',
  chevron: '<path d="m8 10 4 4 4-4"/>',
  pulse: '<path d="M13 2 5 13h6l-1 9 9-12h-6l1-8Z"/>',
  sidebar: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16m-3-11h.01M6 13h.01"/>',
};

export function modusIcon(name) {
  return `<svg class="cgpt-icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${modusIcons[name] || ''}</svg>`;
}
