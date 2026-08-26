const THEME_KEY = 'universal-cad-theme-v2';
const UI_LEVEL_KEY = 'universal-cad-ui-level-v1';
const NOTIFICATION_KEY = 'universal-cad-notifications-v1';
const MAX_NOTIFICATIONS = 60;

const $ = (id) => document.getElementById(id);
function storageGet(key, fallback = null) { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } }
function storageSet(key, value) { try { localStorage.setItem(key, value); } catch { /* storage is optional */ } }
function emit(type, detail = {}) {
  if (typeof window?.dispatchEvent === 'function' && typeof CustomEvent === 'function') window.dispatchEvent(new CustomEvent(type, { detail }));
}

const WORKSPACES = {
  home: {
    title: 'Home',
    subtitle: 'Project status, recent work, recovery, and quick actions.',
  },
  import: {
    title: 'Import',
    subtitle: 'Open CAD, manufacturing data, archives, and project backups.',
  },
  editor: {
    title: 'Board Editor',
    subtitle: 'Edit board, component, package, and land geometry.',
  },
  mapping: {
    title: 'Mapping',
    subtitle: 'Map source records, CAD lands, revisions, and manual confirmations.',
  },
  npi: {
    title: 'NPI Preparation',
    subtitle: 'Prepare packages, alignment, panelization, reconciliation, and automation.',
  },
  validation: {
    title: 'Validation',
    subtitle: 'Review CAD health, compatibility, revision changes, and locatable issues.',
  },
  export: {
    title: 'Export',
    subtitle: 'Preflight and export manufacturing data, reports, BOM, and project backups.',
  },
};

function safeJsonParse(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function storedNotifications() {
  return safeJsonParse(storageGet(NOTIFICATION_KEY, '[]') || '[]', []);
}

function saveNotifications(items) {
  storageSet(NOTIFICATION_KEY, JSON.stringify(items.slice(0, MAX_NOTIFICATIONS)));
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function resolvedTheme(preference) {
  if (preference === 'light' || preference === 'dark') return preference;
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function applyTheme(preference, { announce = false } = {}) {
  const normalized = ['light', 'dark', 'system'].includes(preference) ? preference : 'system';
  const resolved = resolvedTheme(normalized);
  document.documentElement.dataset.themePreference = normalized;
  document.documentElement.dataset.theme = resolved;
  storageSet(THEME_KEY, normalized);
  const themeMeta = $('themeColorMeta') || document.querySelector('meta[name="theme-color"]');
  if (themeMeta) themeMeta.content = resolved === 'light' ? '#f4f7fb' : '#071019';
  document.querySelectorAll('[data-theme-choice]').forEach((button) => {
    button.classList.toggle('active', button.dataset.themeChoice === normalized);
    button.setAttribute('aria-pressed', button.dataset.themeChoice === normalized ? 'true' : 'false');
  });
  const trigger = $('themeToggleButton');
  if (trigger) {
    const icon = normalized === 'system' ? '◐' : resolved === 'light' ? '☀' : '☾';
    trigger.querySelector('[data-theme-icon]')?.replaceChildren(document.createTextNode(icon));
    trigger.querySelector('[data-theme-label]')?.replaceChildren(document.createTextNode(normalized === 'system' ? 'System' : resolved === 'light' ? 'Light' : 'Dark'));
    trigger.title = `Theme: ${normalized}`;
  }
  emit('universalcad:themechange', { preference: normalized, resolved });
  if (announce) emit('universalcad:notify', { message: `Theme changed to ${normalized}.`, type: 'info' });
  return resolved;
}

function applyUiLevel(level) {
  const normalized = level === 'advanced' ? 'advanced' : 'standard';
  document.body.dataset.uiLevel = normalized;
  storageSet(UI_LEVEL_KEY, normalized);
  const select = $('uiLevelSelect');
  if (select) select.value = normalized;
  const label = $('uiLevelBadge');
  if (label) label.textContent = normalized === 'advanced' ? 'Advanced tools' : 'Standard tools';
}

function clickWhenEnabled(id) {
  const button = $(id);
  if (!button) return false;
  if (button.disabled) {
    emit('universalcad:notify', { message: 'Open a compatible project before using this command.', type: 'warning' });
    return false;
  }
  button.click();
  return true;
}

function setEmbeddedModalState(overlay, embedded = true) {
  if (!overlay) return;
  overlay.classList.toggle('workspace-embedded', embedded);
  overlay.setAttribute?.('aria-modal', embedded ? 'false' : 'true');
}

function dockWorkspaceSurfaces() {
  const editor = $('cadEditorOverlay');
  const editorHost = $('editorWorkspaceHost');
  if (editor && editorHost) { editorHost.append(editor); setEmbeddedModalState(editor, true); }

  const npi = $('npiWorkspaceOverlay');
  const npiHost = $('npiWorkspaceHost');
  if (npi && npiHost) { npiHost.append(npi); setEmbeddedModalState(npi, true); }

  const exportCenter = $('exportCenterOverlay');
  const exportHost = $('exportWorkspaceHost');
  if (exportCenter && exportHost) { exportHost.append(exportCenter); setEmbeddedModalState(exportCenter, true); }
}

function npiTabsForWorkspace(workspace) {
  const allowed = {
    npi: new Set(['packages', 'alignment', 'panel', 'automation', 'reconcile']),
    validation: new Set(['overview', 'pcb-data', 'compatibility', 'revisions', 'golden']),
    export: new Set(['bom']),
  }[workspace] || new Set(['overview']);
  const overlay = $('npiWorkspaceOverlay');
  overlay?.querySelectorAll?.('[data-npi-tab]').forEach((button) => { button.hidden = !allowed.has(button.dataset.npiTab); });
  overlay?.querySelectorAll?.('.npi-tab-group').forEach((label) => { label.hidden = true; });
  return allowed;
}

function dockNpiForWorkspace(workspace = 'npi', tab = null) {
  const overlay = $('npiWorkspaceOverlay');
  const host = workspace === 'validation' ? $('validationWorkspaceHost') : workspace === 'export' ? $('exportWorkspaceNpiHost') : $('npiWorkspaceHost');
  if (!overlay || !host) return false;
  host.append(overlay);
  setEmbeddedModalState(overlay, true);
  overlay.classList.remove('hidden');
  const allowed = npiTabsForWorkspace(workspace);
  const preferred = tab && allowed.has(tab) ? tab : [...allowed][0];
  const title = $('npiWorkspaceTitle');
  const summary = $('npiWorkspaceSummary');
  if (title) title.textContent = workspace === 'validation' ? 'Validation Center' : workspace === 'export' ? 'BOM Export Designer' : 'NPI Preparation';
  if (summary && !summary.textContent.trim()) summary.textContent = 'Open a project to use this workspace.';
  requestAnimationFrame(() => overlay.querySelector?.(`[data-npi-tab="${preferred}"]`)?.click());
  return true;
}

function openNpiTab(tab = 'overview', workspace = null) {
  const targetWorkspace = workspace || (tab === 'bom' ? 'export' : 'npi');
  if (document.body.dataset.workspace !== targetWorkspace) setWorkspace(targetWorkspace, { action: false });
  return dockNpiForWorkspace(targetWorkspace, tab);
}

function updateWorkspaceHome() {
  const set = (id, value) => { const node = $(id); if (node) node.textContent = value || '—'; };
  set('homeProjectStatus', $('projectStatus')?.textContent || 'No project open');
  set('homeMapped', $('mappedStat')?.textContent || '0');
  set('homeConfirmed', $('verifiedStat')?.textContent || '0');
  set('homeUnmapped', $('unmappedStat')?.textContent || '0');
  set('homeCadLands', $('xmlLandStat')?.textContent || '0');
  set('homeRawParts', $('componentStat')?.textContent || '0');
  set('homeBuild', $('buildInfoBadge')?.textContent || 'v0.29.1');
  set('homeActiveCad', $('activeCadSelect')?.selectedOptions?.[0]?.textContent || 'No CAD loaded');
}

function setWorkspace(name, { action = true } = {}) {
  const next = WORKSPACES[name] ? name : 'mapping';
  document.body.dataset.workspace = next;
  document.querySelectorAll('[data-workspace-route]').forEach((button) => {
    const active = button.dataset.workspaceRoute === next;
    button.classList.toggle('active', active);
    button.setAttribute('aria-current', active ? 'page' : 'false');
  });
  document.querySelectorAll('[data-route-page]').forEach((page) => page.classList.toggle('active', page.dataset.routePage === next));
  const info = WORKSPACES[next];
  const breadcrumb = $('workspaceBreadcrumb');
  const title = $('workspaceContextTitle');
  const subtitle = $('workspaceContextSubtitle');
  if (breadcrumb) breadcrumb.textContent = `Project / ${info.title}`;
  if (title) title.textContent = info.title;
  if (subtitle) subtitle.textContent = info.subtitle;
  updateWorkspaceHome();

  const editorEmpty = $('editorWorkspaceEmpty');
  const exportHost = $('exportWorkspaceHost');
  const exportNpiHost = $('exportWorkspaceNpiHost');
  const exportBack = $('exportWorkspaceBackButton');

  if (next === 'npi') dockNpiForWorkspace('npi', 'packages');
  if (next === 'validation') dockNpiForWorkspace('validation', 'overview');
  if (next === 'export') {
    const center = $('exportCenterOverlay');
    if (center && exportHost && center.parentElement !== exportHost) exportHost.append(center);
    setEmbeddedModalState(center, true);
    center?.classList.remove('hidden');
    exportHost?.classList.remove('hidden');
    exportNpiHost?.classList.add('hidden');
    exportBack?.classList.add('hidden');
  }

  if (!action) return;
  if (next === 'import') {
    document.querySelector('.left-panel')?.scrollTo?.({ top: 0, behavior: 'smooth' });
    setTimeout(() => $('dropZone')?.focus?.(), 0);
  } else if (next === 'editor') {
    const opened = clickWhenEnabled('cadEditorButton');
    editorEmpty?.classList.toggle('hidden', opened);
  } else if (next === 'mapping') {
    $('searchInput')?.focus?.();
  }
}

function runGlobalSearch() {
  const value = String($('globalSearchInput')?.value || '').trim();
  if (!value) return;
  const existing = $('searchInput');
  if (existing) existing.value = value;
  setWorkspace('mapping', { action: false });
  clickWhenEnabled('searchButton');
}

function openExportCenter() {
  if ($('exportCenterOverlay')?.classList.contains('workspace-embedded')) { setWorkspace('export', { action: false }); return; }
  $('exportCenterOverlay')?.classList.remove('hidden');
  $('exportCenterCloseButton')?.focus?.();
}
function closeExportCenter() {
  const overlay = $('exportCenterOverlay');
  if (overlay?.classList.contains('workspace-embedded')) { setWorkspace('home', { action: false }); return; }
  overlay?.classList.add('hidden');
}

function openCommandPalette() {
  const overlay = $('commandPaletteOverlay');
  if (!overlay) return;
  overlay.classList.remove('hidden');
  const input = $('commandPaletteInput');
  if (input) { input.value = ''; filterCommands(''); requestAnimationFrame(() => input.focus()); }
}
function closeCommandPalette() { $('commandPaletteOverlay')?.classList.add('hidden'); }

const COMMANDS = [
  { id: 'home', label: 'Open Home', group: 'Navigation', keywords: 'dashboard recent project', run: () => setWorkspace('home') },
  { id: 'import', label: 'Open Import', group: 'Navigation', keywords: 'file cad archive xml bom xlsx', run: () => setWorkspace('import') },
  { id: 'editor', label: 'Open Board Editor', group: 'Board', keywords: 'cad component package land geometry', run: () => setWorkspace('editor') },
  { id: 'mapping', label: 'Open Mapping', group: 'Mapping', keywords: 'grid land source manual', run: () => setWorkspace('mapping') },
  { id: 'npi', label: 'Open NPI Preparation', group: 'NPI', keywords: 'package alignment panel reconcile', run: () => setWorkspace('npi') },
  { id: 'validation', label: 'Open Validation', group: 'Validation', keywords: 'health issue compare compatibility', run: () => setWorkspace('validation') },
  { id: 'export', label: 'Open Export Center', group: 'Export', keywords: 'csv excel bom backup cad xml', run: () => setWorkspace('export') },
  { id: 'grid-map', label: 'Grid / Land Map', group: 'Mapping', keywords: 'alias sequence pin naming', run: () => clickWhenEnabled('cadEditorGridMapButton') || clickWhenEnabled('cadEditorButton') },
  { id: 'name-inspector', label: 'Open Name Inspector', group: 'Validation', keywords: 'duplicate land rename audit', run: () => clickWhenEnabled('cadInspectorButton') },
  { id: 'cad-compare', label: 'Compare CAD Revisions', group: 'Validation', keywords: 'original generated compare', run: () => clickWhenEnabled('cadCompareButton') },
  { id: 'manual-teach', label: 'Open Manual Teach', group: 'Mapping', keywords: 'anchor confirm manual', run: () => clickWhenEnabled('teachButton') },
  { id: 'project-manager', label: 'Open Project Manager', group: 'Project', keywords: 'autosave recovery storage recent', run: () => clickWhenEnabled('storageManagerButton') },
  { id: 'bom', label: 'Open BOM Layout Designer', group: 'Export', keywords: 'bom column row excel location', run: () => openNpiTab('bom') },
  { id: 'pcb-data', label: 'Open PCB Data Explorer', group: 'NPI', keywords: 'layers nets vias traces cross probe electrical', run: () => openNpiTab('pcb-data') },
  { id: 'packages', label: 'Open Package Library', group: 'NPI', keywords: 'recognition footprint', run: () => openNpiTab('packages') },
  { id: 'alignment', label: 'Open Coordinate Alignment', group: 'NPI', keywords: 'registration offset rotation scale', advanced: true, run: () => openNpiTab('alignment') },
  { id: 'panel', label: 'Open Panelization', group: 'NPI', keywords: 'array rows columns pitch', advanced: true, run: () => openNpiTab('panel') },
  { id: 'automation', label: 'Open Smart Automation', group: 'NPI', keywords: 'rotation auto fix suggestion', advanced: true, run: () => openNpiTab('automation') },
  { id: 'golden', label: 'Open Reference Template', group: 'Validation', keywords: 'golden template structural compatibility', advanced: true, run: () => openNpiTab('golden') },
  { id: 'fit', label: 'Fit Board to View', group: 'View', keywords: 'zoom center', run: () => clickWhenEnabled('fitButton') },
  { id: 'undo', label: 'Undo', group: 'History', keywords: 'revert ctrl z', run: () => clickWhenEnabled('undoButton') },
  { id: 'redo', label: 'Redo', group: 'History', keywords: 'repeat ctrl y', run: () => clickWhenEnabled('redoButton') },
  { id: 'theme-light', label: 'Use Light Theme', group: 'Appearance', keywords: 'bright light theme', run: () => applyTheme('light', { announce: true }) },
  { id: 'theme-dark', label: 'Use Dark Theme', group: 'Appearance', keywords: 'dark night theme', run: () => applyTheme('dark', { announce: true }) },
  { id: 'theme-system', label: 'Follow System Theme', group: 'Appearance', keywords: 'automatic theme system', run: () => applyTheme('system', { announce: true }) },
];

function commandAllowed(command) {
  return !(command.advanced && document.body.dataset.uiLevel !== 'advanced');
}

function renderCommands() {
  const list = $('commandPaletteList');
  if (!list) return;
  list.replaceChildren();
  COMMANDS.filter(commandAllowed).forEach((command) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'command-palette-item';
    button.dataset.commandId = command.id;
    button.dataset.commandSearch = `${command.label} ${command.group} ${command.keywords || ''}`.toLowerCase();
    const group = document.createElement('span');
    group.textContent = command.group;
    const label = document.createElement('strong');
    label.textContent = command.label;
    button.append(group, label);
    button.addEventListener('click', () => { closeCommandPalette(); command.run(); });
    list.append(button);
  });
  filterCommands($('commandPaletteInput')?.value || '');
}

function filterCommands(query) {
  const tokens = String(query || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
  document.querySelectorAll('.command-palette-item').forEach((item) => {
    const haystack = item.dataset.commandSearch || '';
    item.hidden = tokens.some((token) => !haystack.includes(token));
  });
  const first = [...document.querySelectorAll('.command-palette-item:not([hidden])')][0];
  document.querySelectorAll('.command-palette-item').forEach((item) => item.classList.toggle('keyboard-active', item === first));
}

function stepPalette(delta) {
  const visible = [...document.querySelectorAll('.command-palette-item:not([hidden])')];
  if (!visible.length) return;
  let index = visible.findIndex((item) => item.classList.contains('keyboard-active'));
  index = index < 0 ? 0 : (index + delta + visible.length) % visible.length;
  document.querySelectorAll('.command-palette-item').forEach((item) => item.classList.remove('keyboard-active'));
  visible[index].classList.add('keyboard-active');
  visible[index].scrollIntoView({ block: 'nearest' });
}

function executeActiveCommand() {
  document.querySelector('.command-palette-item.keyboard-active:not([hidden])')?.click();
}

function renderNotifications(items = storedNotifications()) {
  const list = $('notificationList');
  if (!list) return;
  list.replaceChildren();
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'notification-empty';
    empty.textContent = 'No notifications yet.';
    list.append(empty);
  }
  items.forEach((item) => {
    const row = document.createElement('article');
    row.className = `notification-item ${item.type || 'info'}`;
    const marker = document.createElement('span');
    marker.className = 'notification-marker';
    const body = document.createElement('div');
    const message = document.createElement('strong');
    message.textContent = item.message;
    const time = document.createElement('small');
    time.textContent = formatTime(item.time);
    body.append(message, time);
    row.append(marker, body);
    list.append(row);
  });
  const badge = $('notificationBadge');
  if (badge) {
    badge.textContent = String(Math.min(items.length, 99));
    badge.classList.toggle('hidden', !items.length);
  }
}

function addNotification(message, type = 'info') {
  const text = String(message || '').trim();
  if (!text) return;
  const items = storedNotifications();
  const latest = items[0];
  if (latest?.message === text && Date.now() - Number(latest.time || 0) < 1200) return;
  items.unshift({ message: text, type, time: Date.now() });
  saveNotifications(items);
  renderNotifications(items);
}

function openNotifications() {
  $('notificationDrawer')?.classList.add('open');
  $('notificationBackdrop')?.classList.remove('hidden');
  $('notificationCloseButton')?.focus?.();
}
function closeNotifications() {
  $('notificationDrawer')?.classList.remove('open');
  $('notificationBackdrop')?.classList.add('hidden');
}

function routeExportTarget(target) {
  if (target === 'bom') {
    const exportHost = $('exportWorkspaceHost');
    const exportNpiHost = $('exportWorkspaceNpiHost');
    exportHost?.classList.add('hidden');
    exportNpiHost?.classList.remove('hidden');
    $('exportWorkspaceBackButton')?.classList.remove('hidden');
    dockNpiForWorkspace('export', 'bom');
    return;
  }
  if (target === 'cad') { setWorkspace('editor'); return; }
  const map = {
    csv: 'exportCsvButton',
    excel: 'exportExcelButton',
    json: 'exportJsonButton',
    'project-backup': 'projectBackupButton',
    'project-manager': 'storageManagerButton',
  };
  const id = map[target];
  if (!id) return;
  clickWhenEnabled(id);
}

function bindShellEvents() {
  document.querySelectorAll('[data-workspace-route]').forEach((button) => button.addEventListener('click', () => setWorkspace(button.dataset.workspaceRoute)));
  document.querySelectorAll('[data-ui-route]').forEach((button) => button.addEventListener('click', () => setWorkspace(button.dataset.uiRoute)));
  $('globalSearchButton')?.addEventListener('click', runGlobalSearch);
  $('globalSearchInput')?.addEventListener('keydown', (event) => { if (event.key === 'Enter') runGlobalSearch(); });

  $('themeToggleButton')?.addEventListener('click', (event) => {
    event.stopPropagation();
    const menu = $('themeMenu');
    menu?.classList.toggle('hidden');
    $('themeToggleButton')?.setAttribute('aria-expanded', menu?.classList.contains('hidden') ? 'false' : 'true');
  });
  document.querySelectorAll('[data-theme-choice]').forEach((button) => button.addEventListener('click', () => {
    applyTheme(button.dataset.themeChoice, { announce: true });
    $('themeMenu')?.classList.add('hidden');
    $('themeToggleButton')?.setAttribute('aria-expanded', 'false');
  }));
  $('uiLevelSelect')?.addEventListener('change', (event) => { applyUiLevel(event.target.value); renderCommands(); });
  document.addEventListener('click', (event) => { if (!event.target.closest('.theme-control')) { $('themeMenu')?.classList.add('hidden'); $('themeToggleButton')?.setAttribute('aria-expanded', 'false'); } });

  $('commandPaletteButton')?.addEventListener('click', openCommandPalette);
  $('commandPaletteCloseButton')?.addEventListener('click', closeCommandPalette);
  $('commandPaletteOverlay')?.addEventListener('click', (event) => { if (event.target === $('commandPaletteOverlay')) closeCommandPalette(); });
  $('commandPaletteInput')?.addEventListener('input', (event) => filterCommands(event.target.value));
  $('commandPaletteInput')?.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); stepPalette(1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); stepPalette(-1); }
    else if (event.key === 'Enter') { event.preventDefault(); executeActiveCommand(); }
    else if (event.key === 'Escape') closeCommandPalette();
  });

  $('notificationButton')?.addEventListener('click', openNotifications);
  $('notificationCloseButton')?.addEventListener('click', closeNotifications);
  $('notificationBackdrop')?.addEventListener('click', closeNotifications);
  $('notificationClearButton')?.addEventListener('click', () => { saveNotifications([]); renderNotifications([]); });

  $('exportCenterCloseButton')?.addEventListener('click', closeExportCenter);
  $('exportCenterCancelButton')?.addEventListener('click', closeExportCenter);
  $('exportCenterOverlay')?.addEventListener('click', (event) => { if (event.target === $('exportCenterOverlay') && !$('exportCenterOverlay')?.classList.contains('workspace-embedded')) closeExportCenter(); });
  $('exportWorkspaceBackButton')?.addEventListener('click', () => setWorkspace('export', { action: false }));
  document.querySelectorAll('[data-export-target]').forEach((button) => button.addEventListener('click', () => routeExportTarget(button.dataset.exportTarget)));

  window.addEventListener('universalcad:notify', (event) => addNotification(event.detail?.message, event.detail?.type || 'info'));
  window.addEventListener('universalcad:workspace', (event) => setWorkspace(event.detail?.workspace || 'mapping', { action: event.detail?.action !== false }));
  window.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault(); openCommandPalette(); return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f' && !event.target.closest('input,textarea,select')) {
      event.preventDefault(); $('globalSearchInput')?.focus(); return;
    }
    if (event.key === 'Escape') {
      closeCommandPalette(); closeNotifications(); if (!$('exportCenterOverlay')?.classList.contains('workspace-embedded')) closeExportCenter();
    }
  });
}

function observeHomeMetrics() {
  const nodes = ['projectStatus', 'mappedStat', 'verifiedStat', 'unmappedStat', 'xmlLandStat', 'componentStat', 'buildInfoBadge', 'activeCadSelect']
    .map((id) => $(id)).filter(Boolean);
  const observer = new MutationObserver(updateWorkspaceHome);
  nodes.forEach((node) => observer.observe(node, { childList: true, subtree: true, characterData: true, attributes: true }));
  $('activeCadSelect')?.addEventListener('change', updateWorkspaceHome);
}

export function initUiShell() {
  if (typeof document === 'undefined' || !document.documentElement || typeof document.addEventListener !== 'function') {
    return {
      setWorkspace() {}, applyTheme() {}, openCommandPalette() {}, openExportCenter() {}, addNotification() {}, refreshHome() {},
    };
  }
  let preference = 'system';
  let level = 'standard';
  preference = storageGet(THEME_KEY, 'system') || 'system'; level = storageGet(UI_LEVEL_KEY, 'standard') || 'standard';
  applyTheme(preference);
  applyUiLevel(level);
  renderCommands();
  renderNotifications();
  dockWorkspaceSurfaces();
  bindShellEvents();
  observeHomeMetrics();
  setWorkspace('home', { action: false });
  addNotification('Universal CAD Studio v0.29.1 workspace navigation is ready.', 'success');

  const media = window.matchMedia?.('(prefers-color-scheme: light)');
  media?.addEventListener?.('change', () => {
    if ((document.documentElement.dataset.themePreference || 'system') === 'system') applyTheme('system');
  });

  return {
    setWorkspace,
    applyTheme,
    openCommandPalette,
    openExportCenter,
    addNotification,
    refreshHome: updateWorkspaceHome,
  };
}
