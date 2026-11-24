import { modusIcon } from './ui-icons.js';
import { SNIFF_SOURCE, conversationId, buildContextSnapshot, formatTokenCount } from './context-data.js';
import { sidebarLandmark } from './compat/selectors.js';

const observations = new Map();
const conversationDates = new Map();
const observationKinds = new Set(['conversation', 'turn', 'account', 'models', 'init', 'images', 'memory', 'instructions']);
let inspectorFrame = 0;
let dismissedWarning;
let traffic = 0;

function scheduleInspector() {
  if (!_uiReady || inspectorFrame) return;
  inspectorFrame = requestAnimationFrame(() => {
    inspectorFrame = 0;
    if (_extCtxOk()) renderInspector();
  });
}

function ingestObservation(event) {
  if (event.source !== window || event.origin !== location.origin) return;
  const item = event.data;
  if (item?.source !== SNIFF_SOURCE || !Number.isSafeInteger(item.request) || !Number.isSafeInteger(item.revision) ||
    !Number.isFinite(item.at) || !['start', 'data', 'end', 'error'].includes(item.phase)) return;

  if (item.kind === 'traffic') {
    const count = item.data?.count;
    if (!Number.isSafeInteger(count) || count <= traffic) return;
    traffic = count;
    if (traffic === 1) scheduleInspector();
    return;
  }

  if (item.kind === 'conversations') {
    if (!Array.isArray(item.data)) return;
    for (const { id, time } of item.data) {
      if (!conversationDates.has(id) && conversationDates.size >= 1000) conversationDates.delete(conversationDates.keys().next().value);
      const previous = conversationDates.get(id);
      if (!previous || item.request >= previous.request) conversationDates.set(id, { time, request: item.request });
    }
    if (_uiReady && _s.dateGroups) _scheduleDateGroups();
    return;
  }

  if (!observationKinds.has(item.kind) || (item.kind === 'conversation' && !item.id)) return;
  if (item.id != null && (typeof item.id !== 'string' || !/^[\w:-]{1,128}$/.test(item.id))) return;
  rememberObservation(item.kind, ['turn', 'conversation'].includes(item.kind) ? item.id : null, item);
  if (item.kind === 'turn' && item.id && /^(?:WEB:|local-chatgpt:)[\w-]+$/.test(item.originId) && item.originId !== item.id) {
    rememberObservation('turn', item.originId, item);
  }
  scheduleInspector();
}

function rememberObservation(kind, id, item) {
  const key = `${kind}:${id ?? ''}`;
  const prior = observations.get(key);
  if (prior && (prior.request > item.request || prior.request === item.request && prior.revision >= item.revision)) return;
  observations.delete(key);
  observations.set(key, item);
  if (observations.size > 80) observations.delete(observations.keys().next().value);
}

function observedConversation(id) {
  if (!id) return {};
  const history = observations.get(`conversation:${id}`);
  const turn = observations.get(`turn:${id}`);
  if (!turn || turn.phase === 'error') return { data: history?.data, at: history?.at, status: history ? 'ready' : 'waiting' };
  const reply = turn.data;
  const sameReply = Boolean(reply?.replyId && history?.data?.replyId === reply.replyId);
  const newerDetail = history?.request > turn.request && history.data?.replyAt >= turn.startedAt - 2000;
  const detail = sameReply || newerDetail ? history.data : null;
  const data = { requested: reply?.requested ?? history?.data?.requested };
  for (const field of ['model', 'used', 'output', 'total', 'files']) {
    data[field] = (newerDetail && !sameReply ? detail?.[field] : reply?.[field] ?? detail?.[field]) ?? null;
  }
  return {
    data,
    limits: reply?.limits,
    limitsAt: reply?.limits ? turn.at : null,
    at: data.model || data.used !== null || detail ? turn.at : null,
    status: turn.phase === 'end' ? 'ready' : 'streaming',
  };
}

function getInspectorSnapshot() {
  const chat = observedConversation(conversationId(location.pathname));
  const result = { conversation: chat.data };
  for (const kind of ['models', 'account', 'init', 'images', 'memory', 'instructions']) result[kind] = observations.get(`${kind}:`)?.data;
  if (chat.limits) result.init = {
    ...result.init, ...chat.limits, fileSizeMb: chat.limits.fileSizeMb ?? result.init?.fileSizeMb,
  };
  return {
    ...buildContextSnapshot(result),
    status: chat.status ?? 'waiting',
    at: chat.at,
    limitsAt: chat.limitsAt ?? observations.get('init:')?.at,
    uploadsAt: observations.get('images:')?.at,
  };
}

window.addEventListener('message', ingestObservation);
window.postMessage({ source: SNIFF_SOURCE, phase: 'ready' }, location.origin);

function getInspector() {
  if (!activitySurface) {
    const inspector = activitySurface = document.createElement('section');
    inspector.id = 'cgpt-top-inspector';
    inspector.setAttribute('aria-label', 'Modus chat activity');
    inspector.innerHTML = `
      <button type="button" id="cgpt-activity-button" class="cgpt-topbtn" aria-controls="cgpt-ctx-popover" aria-expanded="false">
        ${modusIcon('activity')}
        <span id="cgpt-badge-label">Activity</span>
        <span class="cgpt-activity-chevron">${modusIcon('chevron')}</span>
      </button>
      <div id="cgpt-ctx-popover" class="cgpt-menu cgpt-surface" role="region" aria-labelledby="cgpt-activity-heading" tabindex="-1" hidden></div>
      <div id="cgpt-ctx-warn" class="cgpt-context-warning cgpt-surface" hidden>
        <span role="status">This reply used at least 90% of the reported context window.</span>
        <button type="button" aria-label="Dismiss context warning">&#215;</button>
      </div>`;
    const panel = inspector.querySelector('.cgpt-menu');
    const button = inspector.querySelector('.cgpt-topbtn');
    button.addEventListener('click', () => {
      if (!panel.hidden) closeInspectorDetails(true);
      else {
        panel.hidden = false;
        button.setAttribute('aria-expanded', 'true');
        renderInspectorDetails(panel, getInspectorSnapshot());
        positionInspector();
        panel.focus();
      }
    });
    inspector.querySelector('.cgpt-context-warning button').addEventListener('click', () => {
      dismissedWarning = observedConversation(conversationId(location.pathname)).at;
      inspector.querySelector('.cgpt-context-warning').hidden = true;
    });
    document.body.append(inspector);
  }
  return activitySurface;
}

function closeInspectorDetails(restoreFocus = false) {
  const panel = document.getElementById('cgpt-ctx-popover');
  if (!panel || panel.hidden) return;
  panel.hidden = true;
  const trigger = document.getElementById('cgpt-activity-button');
  trigger?.setAttribute('aria-expanded', 'false');
  if (restoreFocus) trigger?.focus();
}

document.addEventListener('pointerdown', event => {
  if (!event.target.closest?.('#cgpt-top-inspector')) closeInspectorDetails();
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeInspectorDetails(true);
});

const activityLandmark = 'header, [role="banner"], [role="toolbar"], [role="tablist"]';
const activityControl = 'button, a[href], input, [role="button"], [role="tab"], [role="switch"], [role="radio"], [role="combobox"], [data-modus-title], [data-testid="conversation-title"]';
const ignoredActivityArea = '#cgpt-top-inspector, #cgpt-action-bar, [role="dialog"], [role="menu"], [data-message-author-role], [data-message-role], [hidden], [inert], [aria-hidden="true"], [data-desktop-sidebar], [data-sidebar], [role="complementary"], [aria-label="Sidebar" i], [aria-label="Chat history" i]';
const activityGap = 8;
let activitySurface;
let activityLayoutFrame = 0;
const activityResize = typeof ResizeObserver === 'function' ? new ResizeObserver(queueActivityLayout) : null;
const activityObserved = new Set();

function queueActivityLayout() {
  if (!activitySurface || activityLayoutFrame) return;
  activityLayoutFrame = requestAnimationFrame(() => {
    activityLayoutFrame = 0;
    positionInspector();
  });
}

function observeActivityLayout(elements) {
  if (!activityResize) return;
  const next = new Set(elements);
  for (const element of activityObserved) {
    if (next.has(element)) continue;
    activityResize.unobserve(element);
    activityObserved.delete(element);
  }
  for (const element of next) {
    if (activityObserved.has(element)) continue;
    activityResize.observe(element);
    activityObserved.add(element);
  }
}

function activitySlot(left, right, top, width, height, occupied) {
  let x = right - width;
  for (const rect of occupied) {
    if (rect.top >= top + height + activityGap || rect.bottom + activityGap <= top) continue;
    if (x < rect.right + activityGap && x + width > rect.left - activityGap) x = rect.left - activityGap - width;
  }
  return x >= left ? x : null;
}

function positionInspector() {
  const inspector = activitySurface;
  if (!inspector) return;
  const host = document.fullscreenElement || document.body;
  if (inspector.parentElement !== host) host.append(inspector);
  const viewport = window.visualViewport;
  const visible = {
    left: viewport?.offsetLeft || 0, top: viewport?.offsetTop || 0,
    right: (viewport?.offsetLeft || 0) + (viewport?.width || innerWidth),
    bottom: (viewport?.offsetTop || 0) + (viewport?.height || innerHeight),
  };
  const mainSelector = 'main, [role="main"]';
  const composer = host.querySelector('#prompt-textarea');
  const main = host.matches(mainSelector) ? host : composer?.closest(mainSelector) ||
    [...host.querySelectorAll(mainSelector)].find(region => region.getBoundingClientRect().width > 0);
  const mainRect = main?.getBoundingClientRect();
  const content = mainRect?.width ? mainRect : visible;
  const contentLeft = Math.max(visible.left, content.left);
  const contentRight = Math.min(visible.right, content.right);
  const contentTop = Math.max(visible.top, content.top);
  const left = contentLeft + activityGap;
  const right = contentRight - activityGap;
  const button = inspector.querySelector('.cgpt-topbtn');
  const setPixels = (name, value) => {
    const length = value + 'px';
    if (inspector.style.getPropertyValue(name) !== length) inspector.style.setProperty(name, length);
  };
  setPixels('--cgpt-toolbar-max-width', Math.max(0, right - left));
  const buttonRect = button.getBoundingClientRect();
  const height = buttonRect.height || 36;
  const width = button.hidden ? Math.min(36, right - left) : buttonRect.width || Math.min(120, right - left);
  const bandBottom = contentTop + height * 2;
  const observed = [host, button, ...(main && main !== host ? [main] : [])];
  const occupied = [];
  for (const element of host.querySelectorAll(activityLandmark + ', ' + activityControl)) {
    if (element.closest(ignoredActivityArea)) continue;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height || rect.bottom <= visible.top || rect.top >= bandBottom ||
        rect.left >= contentRight || rect.right <= contentLeft ||
        element.checkVisibility?.({ visibilityProperty: true }) === false) continue;
    observed.push(element);
    // Full-width headers supply the row height. Their children supply the occupied space.
    if (!element.matches(activityLandmark) || element.matches('[role="tablist"]') ||
        rect.width < contentRight - contentLeft - activityGap * 2) occupied.push(rect);
  }
  observeActivityLayout(observed);
  occupied.sort((a, b) => b.right - a.right);
  const firstControl = occupied.reduce((first, rect) => !first || rect.top < first.top ? rect : first, null);
  let top = firstControl ? Math.max(visible.top + activityGap, firstControl.top + (firstControl.height - height) / 2) :
    contentTop + activityGap;
  let x = activitySlot(left, right, top, width, height, occupied);
  if (x === null) {
    top = Math.max(top, ...occupied.map(rect => rect.bottom + activityGap));
    x = right - width;
  }
  const panelWidth = Math.min(286, right - left);
  const panelTop = top + (button.hidden ? 0 : height + activityGap);
  inspector.toggleAttribute('data-positioned', right > left && panelTop < visible.bottom);
  setPixels('--cgpt-toolbar-left', x);
  setPixels('--cgpt-toolbar-top', top);
  setPixels('--cgpt-panel-left', Math.max(left, Math.min(x + width - panelWidth, right - panelWidth)));
  setPixels('--cgpt-panel-top', panelTop);
  setPixels('--cgpt-panel-width', Math.max(0, panelWidth));
  setPixels('--cgpt-panel-height', Math.max(0, visible.bottom - panelTop - activityGap));
}

document.addEventListener('fullscreenchange', queueActivityLayout);
document.addEventListener('transitionend', event => {
  if (event.target.closest?.(activityLandmark + ', ' + sidebarLandmark)) queueActivityLayout();
});
window.visualViewport?.addEventListener('resize', queueActivityLayout);
window.visualViewport?.addEventListener('scroll', queueActivityLayout);

function renderInspector() {
  if (!_s.modelBadge && !_s.contextBar && !_s.contextWarning) {
    activitySurface?.remove();
    activitySurface = null;
    observeActivityLayout([]);
    return;
  }
  const snapshot = getInspectorSnapshot();
  const inspector = getInspector();
  const button = inspector.querySelector('.cgpt-topbtn');
  const label = _s.modelBadge && snapshot.model ? snapshot.model : 'Activity';
  button.hidden = !_s.modelBadge && !_s.contextBar;
  button.querySelector('#cgpt-badge-label').textContent = label;
  if (snapshot.model) button.dataset.responseModel = snapshot.model;
  else delete button.dataset.responseModel;
  button.title = 'Chat activity';
  button.setAttribute('aria-label', label === 'Activity' ? 'Chat activity' : `Chat activity, response model ${label}`);
  if (button.hidden) closeInspectorDetails();
  const panel = inspector.querySelector('.cgpt-menu');
  if (!panel.hidden) renderInspectorDetails(panel, snapshot);

  const ratio = snapshot.used !== null && snapshot.total !== null ? snapshot.used / snapshot.total : null;
  inspector.querySelector('.cgpt-context-warning').hidden =
    !_s.contextWarning || ratio === null || ratio < 0.9 || snapshot.at === dismissedWarning;
  positionInspector();
}

function resetLabel(value, observedAt) {
  const at = typeof value === 'number' && observedAt ? observedAt + value * 1000
    : typeof value === 'string' ? Date.parse(value) : null;
  if (at === null || !Number.isFinite(at)) return '';
  const reset = new Date(at);
  const today = new Date();
  const sameDay = reset.toDateString() === today.toDateString();
  return `Resets ${reset.toLocaleString(undefined, sameDay ? { timeStyle: 'short' } : { dateStyle: 'short', timeStyle: 'short' })}`;
}

function usageRing(percent, label, detail) {
  const ring = document.createElement('span');
  ring.className = 'cgpt-usage-ring';
  if (percent != null) {
    ring.dataset.known = '';
    ring.style.setProperty('--cgpt-progress', `${Math.min(100, Math.max(0, percent))}%`);
  }
  ring.tabIndex = 0;
  ring.setAttribute('role', 'img');
  ring.setAttribute('aria-label', detail);
  const center = document.createElement('span');
  center.textContent = label;
  center.setAttribute('aria-hidden', 'true');
  const tip = document.createElement('span');
  tip.className = 'cgpt-usage-tip';
  tip.setAttribute('aria-hidden', 'true');
  tip.textContent = detail;
  ring.append(center, tip);
  return ring;
}

function quotaRow(name, data, observedAt) {
  const { remaining, used, total, percent } = data;
  const consumed = used ?? (total != null && remaining != null && remaining <= total ? total - remaining : null);
  const fraction = percent ?? (consumed != null && total > 0 ? Math.round(consumed / total * 100) : null);
  const detail = [
    remaining == null ? null : `${remaining} remaining`,
    consumed == null ? null : `${consumed} used`,
    total == null ? null : `${total} total`,
  ].filter(Boolean).join(' \u00B7 ');
  const reset = resetLabel(data.reset, observedAt);
  if (fraction == null && !detail && !reset) return null;

  const row = document.createElement('div');
  row.className = 'cgpt-quota-row';
  row.append(usageRing(fraction, fraction != null ? `${Math.round(fraction)}%` : remaining ?? '\u2013',
    `${name}: ${[fraction != null ? `${fraction}% used` : null, detail, reset].filter(Boolean).join(' \u00B7 ')}`));
  const text = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = name;
  const sub = document.createElement('span');
  sub.textContent = fraction == null && remaining != null
    ? [`${remaining} left`, reset].filter(Boolean).join(' \u00B7 ') : reset;
  text.append(title, sub);
  row.append(text);
  return row;
}

function inspectorRows(rows) {
  const list = document.createElement('dl');
  for (const [label, value] of rows) {
    if (value == null || value === '') continue;
    const row = document.createElement('div');
    const term = document.createElement('dt');
    term.textContent = label;
    const detail = document.createElement('dd');
    detail.textContent = value;
    row.append(term, detail);
    list.append(row);
  }
  return list;
}

function appendInspectorDetails(panel, label, rows, summary, previous) {
  const list = inspectorRows(rows);
  if (!list.children.length) return;
  const details = document.createElement('details');
  details.dataset.group = label;
  details.open = previous.has(label);
  const header = document.createElement('summary');
  header.textContent = label;
  if (summary) {
    const value = document.createElement('span');
    value.className = 'cgpt-details-summary';
    value.textContent = summary;
    header.append(value);
  }
  header.insertAdjacentHTML('beforeend', modusIcon('chevron'));
  details.append(header, list);
  panel.append(details);
}

function formatFeature(feature) {
  const name = feature.replace(/[_-]+/g, ' ');
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function renderInspectorDetails(panel, snapshot) {
  const previous = new Set([...panel.querySelectorAll('details[open]')].map(details => details.dataset.group));
  const first = !panel.querySelector('header');
  const focus = document.activeElement?.closest?.('#cgpt-ctx-popover summary, #cgpt-ctx-popover button');
  const lastControl = focus?.closest('details')?.dataset.group || focus?.id;
  const header = document.createElement('header');
  const heading = document.createElement('h2');
  heading.id = 'cgpt-activity-heading';
  heading.textContent = 'Activity';
  const close = document.createElement('button');
  close.id = 'cgpt-activity-close';
  close.type = 'button';
  close.className = 'cgpt-ui-button cgpt-icon-button';
  close.setAttribute('aria-label', 'Close chat activity');
  close.innerHTML = modusIcon('close');
  close.onclick = () => closeInspectorDetails(true);
  header.append(heading, close);
  panel.replaceChildren(header);

  const tokens = value => value == null ? null : formatTokenCount(value);
  const section = document.createElement('section');
  section.className = 'cgpt-activity-summary';
  const label = document.createElement('div');
  const primary = document.createElement('strong');
  primary.textContent = _s.modelBadge && snapshot.model ? snapshot.model : 'Context';
  const usage = document.createElement('p');
  let summary = '';
  if (_s.contextBar) {
    summary = [
      snapshot.used == null ? null : `${tokens(snapshot.used)} input`,
      snapshot.output == null ? null : `${tokens(snapshot.output)} output`,
      snapshot.total == null ? null : `${tokens(snapshot.total)} window`,
    ].filter(Boolean).join(' \u00B7 ');
    if (!summary) {
      summary = snapshot.status === 'streaming' ? 'Reading reply\u2026'
        : snapshot.status === 'waiting' ? 'Waiting for a reply' : 'Token counts unavailable';
    }
  }
  usage.textContent = summary;
  label.append(primary);
  if (summary) label.append(usage);
  if (_s.contextBar && snapshot.used != null && snapshot.total > 0) {
    const percentage = Math.round(snapshot.used / snapshot.total * 100);
    section.append(usageRing(percentage, `${percentage}%`, `Context: ${percentage}% used \u00B7 ${summary}`));
  }
  section.append(label);
  panel.append(section);

  const quotas = [
    ...(snapshot.uploads ? [{ ...snapshot.uploads, total: snapshot.uploads.limit ?? snapshot.uploads.total, feature: 'Uploads', observedAt: snapshot.uploadsAt }] : []),
    ...snapshot.limits.map(row => ({ ...row, observedAt: snapshot.limitsAt })),
  ].map(row => quotaRow(formatFeature(row.feature), row, row.observedAt)).filter(Boolean);
  if (quotas.length) {
    const limits = document.createElement('details');
    limits.dataset.group = 'Limits';
    limits.open = first || previous.has('Limits');
    const disclosure = document.createElement('summary');
    disclosure.textContent = 'Limits';
    disclosure.insertAdjacentHTML('beforeend', modusIcon('chevron'));
    limits.append(disclosure, ...quotas);
    panel.append(limits);
  }

  appendInspectorDetails(panel, 'Details', [
    ['Plan', snapshot.plan],
    ['Account default', snapshot.defaultModel],
    ['Conversation default', snapshot.requested],
    ['Attachments', tokens(snapshot.files)],
    ['Max attachment size', snapshot.fileSizeMb == null ? null : `${snapshot.fileSizeMb} MB`],
    ['Memory', snapshot.memory?.enabled == null ? null : snapshot.memory.enabled ? 'On' : 'Off'],
    ['Saved memories', tokens(snapshot.memory?.count)],
    ['Custom instructions', snapshot.instructions?.enabled == null ? null : snapshot.instructions.enabled ? 'On' : 'Off'],
    ['Blocked features', snapshot.blocked.length ? snapshot.blocked.map(formatFeature).join(', ') : null],
    ['Responses observed', tokens(traffic || null)],
  ], snapshot.plan, previous);

  if (conversationId(location.pathname)) {
    const footer = document.createElement('footer');
    footer.className = 'cgpt-inspector-footer';
    const button = selectionButton('Export chat', 'download', exportCurrentChat);
    button.id = 'cgpt-activity-export';
    footer.append(button);
    panel.append(footer);
  }
  if (lastControl) {
    const restored = document.getElementById(lastControl) ||
      [...panel.querySelectorAll('details')].find(details => details.dataset.group === lastControl)?.querySelector('summary');
    restored?.focus({ preventScroll: true });
  }
}
