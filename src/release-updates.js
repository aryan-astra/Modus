const repository = 'https://github.com/aryan-astra/Modus';
const latestRelease = 'https://api.github.com/repos/aryan-astra/Modus/releases/latest';
const maxNoticeAge = 7 * 24 * 60 * 60 * 1000;

export const releaseStateKey = 'modusReleaseCheck';
export const checkReleaseMessage = 'modus-check-release';

function versionParts(version) {
  if (typeof version !== 'string' || !/^(?:0|[1-9]\d{0,4})(?:\.(?:0|[1-9]\d{0,4})){2}$/.test(version)) return null;
  const parts = version.split('.').map(Number);
  return parts.every(part => part <= 65535) ? parts : null;
}

function tagVersion(tag) {
  if (typeof tag !== 'string' || !tag.startsWith('v')) return null;
  const version = tag.slice(1);
  return versionParts(version) ? version : null;
}

export function availableUpdate(state, installedVersion, now = Date.now()) {
  const version = tagVersion(state?.tag);
  if (!version || !Number.isFinite(state?.verifiedAt) || now - state.verifiedAt >= maxNoticeAge) return null;
  const installed = versionParts(installedVersion);
  if (!installed) return null;
  const parts = versionParts(version);
  const difference = parts.findIndex((part, index) => part !== installed[index]);
  if (difference < 0 || parts[difference] < installed[difference]) return null;
  return { version, url: repository + '/releases/tag/' + state.tag };
}

export async function fetchReleaseTag() {
  const response = await fetch(latestRelease, {
    credentials: 'omit',
    redirect: 'error',
    signal: AbortSignal.timeout(8000),
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('GitHub release check failed');
  const release = await response.json();
  const tag = release?.tag_name;
  const name = 'modus-' + tag + '.zip';
  if (release?.draft !== false || release?.prerelease !== false || !tagVersion(tag) ||
      !Array.isArray(release.assets) || !release.assets.some(asset =>
        asset?.name === name && asset.state === 'uploaded' && asset.size > 0)) {
    throw new Error('No installable stable release');
  }
  return tag;
}
