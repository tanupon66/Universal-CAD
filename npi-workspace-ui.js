import {
  getExportProfiles,
  evaluateFormatCompatibility,
  buildConversionLossReport,
  buildPackageLibrary,
  packageLevelMapping,
  reconcileNpiData,
  buildSmartRevisionCompare,
  buildThreeWayCompare,
  analyzeGoldenTemplate,
  compareExportToGolden,
  estimateCoordinateCalibration,
  createPanelArray,
  buildRevisionTimeline,
  calculateCadHealth,
  buildVisualValidationMarkers,
  buildProjectWorkspaceSummary,
  mergeGeneratedIntoGoldenTemplate,
  applyCoordinateCalibrationToModel,
} from './npi-platform.js';
import {
  BOM_FIELDS,
  buildBomRows,
  buildBomCsv,
  buildBomXlsx,
  normalizeBomLayout,
  moveBomField,
  bomLayoutColumnLetter,
} from './bom-export.js';
import { safeDownloadName } from './export-safety.js';
import { cloneCadValue } from './universal-cad-model.js';
import { DEFAULT_TARGET_PROFILE, validateModelAgainstTargetProfile } from './target-profile-engine.js';
import { runSmartNpiAutomation, proposeRotationNormalization } from './npi-automation.js';
import { processInChunks } from './worker-pipeline.js';
import { buildLayerSummary, buildNetSummary, queryCrossProbe, validatePcbFoundation } from './pcb-data-foundation.js';
import { buildCoordinateSystemManager, createCoordinateSystem } from './coordinate-system-manager.js';

const PACKAGE_LIBRARY_KEY = 'universal-cad-package-library-v1';
const EXPORT_PROFILE_KEY = 'universal-cad-export-profiles-v1';
const $ = (id) => document.getElementById(id);

function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = value == null ? '—' : String(value);
}

function htmlEscape(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function formatNumber(value, digits = 3) {
  return Number.isFinite(Number(value))
    ? Number(value).toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')
    : '—';
}

function loadJson(key, fallback = []) {
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
  catch { return fallback; }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function objectsFromTable(table) {
  if (!table?.activeSheet?.rows?.length) return [];
  const rows = table.activeSheet.rows;
  const header = rows[0].map((value) => String(value ?? '').trim());
  return rows.slice(1)
    .filter((row) => row.some((value) => String(value ?? '').trim()))
    .map((row) => Object.fromEntries(header.map((name, index) => [name || `column${index + 1}`, row[index]])));
}

function normalizeRawRows(table) {
  const rows = objectsFromTable(table);
  return rows.map((row) => {
    const entries = Object.entries(row);
    const pick = (pattern) => entries.find(([key]) => pattern.test(key))?.[1] ?? '';
    return {
      location: pick(/ref|location|designator/i),
      reference: pick(/ref|location|designator/i),
      partNumber: pick(/part|mpn|pn/i),
      description: pick(/desc/i),
      package: pick(/package|footprint/i),
      quantity: pick(/qty|quantity/i),
      side: pick(/side/i),
      rotation: pick(/rot|angle/i),
      x: pick(/^x$|pos.*x|center.*x/i),
      y: pick(/^y$|pos.*y|center.*y/i),
    };
  });
}

export function initNpiWorkspace(context = {}) {
  const overlay = $('npiWorkspaceOverlay');
  if (!overlay) return { refresh() {} };

  // Newer feature tabs are injected defensively so older cached/index shells remain compatible during PWA update.
  const tabNav = overlay.querySelector?.('.npi-tabs');
  if (tabNav && !overlay.querySelector?.('[data-npi-tab="pcb-data"]')) {
    const button = document.createElement('button'); button.type = 'button'; button.dataset.npiTab = 'pcb-data'; button.textContent = 'PCB Data';
    const overview = tabNav.querySelector('[data-npi-tab="overview"]'); overview?.after(button) || tabNav.prepend(button);
  }
  if (tabNav && !overlay.querySelector?.('[data-npi-tab="automation"]')) {
    const button = document.createElement('button'); button.type = 'button'; button.dataset.npiTab = 'automation'; button.textContent = 'Automation';
    const compatibility = tabNav.querySelector('[data-npi-tab="compatibility"]'); compatibility?.after(button) || tabNav.append(button);
  }
  const workspaceBody = overlay.querySelector?.('.npi-workspace-body');
  if (workspaceBody && !overlay.querySelector?.('[data-npi-panel="pcb-data"]')) {
    const section = document.createElement('section'); section.className = 'npi-panel'; section.dataset.npiPanel = 'pcb-data';
    section.innerHTML = `<div class="npi-section-card pcb-data-foundation"><div class="npi-section-heading"><div><span class="eyebrow">PCB DATA FOUNDATION</span><h3>Layer & Net Explorer</h3><p id="npiPcbDataSummary">Electrical and layer records preserved from supported structured sources appear here.</p></div></div><div class="npi-score-grid compact"><article class="npi-metric-card"><span>Layers</span><strong id="npiPcbLayerCount">0</strong><small>Stack and manufacturing layers</small></article><article class="npi-metric-card"><span>Nets</span><strong id="npiPcbNetCount">0</strong><small>Electrical connectivity records</small></article><article class="npi-metric-card"><span>Vias / Traces</span><strong id="npiPcbRouteCount">0 / 0</strong><small>Normalized routing objects</small></article><article class="npi-metric-card"><span>Foundation Health</span><strong id="npiPcbHealth">—</strong><small id="npiPcbIssueCount">0 issue(s)</small></article></div><div class="npi-form-grid compact"><label>Cross-probe search<input id="npiPcbSearch" placeholder="U56, A1, GND, top..." type="search"/></label><div class="npi-readout"><span>Coordinate systems</span><strong id="npiCoordinateSystemCount">1</strong></div></div><div id="npiPcbSearchResults" class="npi-list"></div><div class="npi-split-grid"><div><h4>Layer Manager</h4><div class="npi-table-wrap"><table><thead><tr><th>Layer</th><th>Side</th><th>Type</th><th>Objects</th></tr></thead><tbody id="npiPcbLayerBody"></tbody></table></div></div><div><h4>Net Explorer</h4><div class="npi-table-wrap"><table><thead><tr><th>Net</th><th>Connections</th><th>Vias</th><th>Traces</th></tr></thead><tbody id="npiPcbNetBody"></tbody></table></div></div></div><p class="helper-text">Cross-probe uses the current project revision. Layer/net records are preserved across placement and land edits even when the active export format cannot serialize them.</p></div>`;
    const overviewPanel = workspaceBody.querySelector('[data-npi-panel="overview"]'); overviewPanel?.after(section) || workspaceBody.prepend(section);
  }
  if (workspaceBody && !overlay.querySelector?.('[data-npi-panel="automation"]')) {
    const section = document.createElement('section'); section.className = 'npi-panel'; section.dataset.npiPanel = 'automation';
    section.innerHTML = `<div class="npi-section-card"><div class="npi-section-heading"><div><span class="eyebrow">SMART NPI AUTOMATION</span><h3>Safe Automation Preview</h3><p id="npiAutomationSummary">Analyze the current revision before applying any automatic correction.</p></div></div><div class="npi-form-grid compact"><label>Rotation snap tolerance (degrees)<input id="npiAutomationRotationTolerance" min="0" max="10" step="0.1" type="number" value="2"/></label><div class="npi-readout"><span>Generic target readiness</span><strong id="npiTargetReadiness">—</strong></div></div><div class="npi-actions"><button id="npiAutomationAnalyze" type="button">Analyze Suggestions</button><button class="primary" id="npiAutomationApplyRotations" type="button">Apply Safe Rotation Fixes</button></div><p class="helper-text">Automation never mutates the immutable source. Applying suggestions creates a normal project revision and remains undo/rollback compatible.</p><div class="npi-table-wrap"><table><thead><tr><th>Type</th><th>Subject</th><th>Suggestion</th><th>Confidence / rule</th></tr></thead><tbody id="npiAutomationBody"></tbody></table></div></div>`;
    const packages = workspaceBody.querySelector('[data-npi-panel="packages"]'); packages?.before(section) || workspaceBody.append(section);
  }

  const state = {
    tab: 'overview',
    goldenText: '',
    bomLayout: normalizeBomLayout(),
    customProfiles: loadJson(EXPORT_PROFILE_KEY, []),
    lastCalibration: null,
    automationPreview: null,
  };

  const getProject = () => context.getProject?.() || null;
  const getModel = () => context.getModel?.() || getProject()?.currentModel || null;
  const getRaw = () => context.getRawData?.() || null;
  const download = (blob, name) => context.download?.(blob, safeDownloadName(name));
  const toast = (message) => context.toast?.(message);

  function currentBom() {
    const model = getModel();
    const raw = normalizeRawRows(getRaw());
    return buildBomRows(model, { bom: model?.bom?.length ? model.bom : raw });
  }

  function setTab(tab) {
    state.tab = tab;
    if (typeof overlay.querySelectorAll === 'function') overlay.querySelectorAll('[data-npi-tab]').forEach((button) => button.classList.toggle('active', button.dataset.npiTab === tab));
    if (typeof overlay.querySelectorAll === 'function') overlay.querySelectorAll('[data-npi-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.npiPanel === tab));
    renderTab(tab);
  }

  function open() {
    overlay.classList.remove('hidden');
    refresh();
    $('npiCloseButton')?.focus();
  }

  function close() {
    overlay.classList.add('hidden');
    $('npiWorkspaceButton')?.focus();
  }

  function renderOverview() {
    const project = getProject();
    const model = getModel();
    if (!model) {
      setText('npiHealthScore', '—');
      setText('npiWorkspaceSummary', 'Open a CAD project to start NPI preparation.');
      setText('npiProjectWorkspaceDetails', 'No active project.');
      return;
    }
    const health = calculateCadHealth(model, { bom: currentBom() });
    const summary = buildProjectWorkspaceSummary(project || { currentModel: model });
    setText('npiHealthScore', health.score);
    setText('npiHealthGrade', health.grade);
    setText('npiWorkspaceSummary', `${summary.name} · Revision ${summary.revision} · ${summary.current.components} components · ${summary.current.lands} lands · ${summary.exportCount} exports`);
    setText('npiProjectWorkspaceDetails', `${summary.sourceCount} source file(s) · ${summary.revisionCount} revision(s) · ${summary.changeSetCount} change set(s) · ${summary.exportCount} export snapshot(s)`);
    setText('npiHealthDetails', health.summary);

    const markers = buildVisualValidationMarkers(health.validation);
    setText('npiVisualIssueCount', `${markers.length} locatable issues`);
    const list = $('npiVisualIssueList');
    if (list) {
      list.innerHTML = '';
      markers.slice(0, 100).forEach((marker) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'npi-list-row';
        row.innerHTML = `<strong>${htmlEscape(marker.code)}</strong><span>${htmlEscape(marker.message)}</span>`;
        row.addEventListener('click', () => context.locateIssue?.(marker));
        list.append(row);
      });
      if (!markers.length) list.innerHTML = '<p class="npi-empty">No locatable validation issues.</p>';
    }

    const compare = buildThreeWayCompare(project || {});
    setText(
      'npiThreeWaySummary',
      compare.sourceToWorking
        ? `Source → Working: ${compare.sourceToWorking.added} added, ${compare.sourceToWorking.removed} removed, ${compare.sourceToWorking.moved} moved, ${compare.sourceToWorking.changed} metadata changes${compare.hasExport ? ' · Working → last export available' : ''}`
        : 'No revision comparison available.',
    );
  }

  function renderPcbData() {
    const model = getModel();
    const layerBody = $('npiPcbLayerBody'); const netBody = $('npiPcbNetBody'); const results = $('npiPcbSearchResults');
    if (!model) {
      setText('npiPcbDataSummary', 'Open a CAD project to inspect PCB data.'); setText('npiPcbLayerCount', 0); setText('npiPcbNetCount', 0); setText('npiPcbRouteCount', '0 / 0'); setText('npiPcbHealth', '—');
      if (layerBody) layerBody.innerHTML = ''; if (netBody) netBody.innerHTML = ''; if (results) results.innerHTML = ''; return;
    }
    const validation = validatePcbFoundation(model); const layers = buildLayerSummary(model); const nets = buildNetSummary(model);
    setText('npiPcbLayerCount', layers.length); setText('npiPcbNetCount', nets.length); setText('npiPcbRouteCount', `${model.vias?.length || 0} / ${model.traces?.length || 0}`);
    setText('npiPcbHealth', validation.valid ? 'Ready' : 'Review'); setText('npiPcbIssueCount', `${validation.issues.length} issue(s)`);
    const foundation = model.metadata?.pcbFoundation; setText('npiPcbDataSummary', `${foundation?.sourceFormat || model.sourceFormat || 'working model'} · ${layers.length} layers · ${nets.length} nets · ${model.vias?.length || 0} vias · ${model.traces?.length || 0} traces · ${model.holes?.length || 0} holes${foundation?.warnings?.length ? ` · ${foundation.warnings.length} import warning(s)` : ''}`);
    const systems = model.coordinateSystems?.length ? model.coordinateSystems : [createCoordinateSystem({ id:'board', name:'Board Coordinate', units:model.units || 'mm', origin:model.coordinateSystem?.origin || {x:0,y:0} })];
    try { const manager=buildCoordinateSystemManager(systems); setText('npiCoordinateSystemCount', manager.systems.length); } catch { setText('npiCoordinateSystemCount', 'Invalid'); }
    if (layerBody) {
      layerBody.innerHTML = '';
      for (const layer of layers.slice(0, 300)) { const tr=document.createElement('tr'); const objectCount=Object.values(layer.counts || {}).reduce((sum,value)=>sum+Number(value||0),0); tr.innerHTML=`<td><button class="npi-link-button" type="button">${htmlEscape(layer.name)}</button></td><td>${htmlEscape(layer.side)}</td><td>${htmlEscape(layer.type)}</td><td>${objectCount}</td>`; tr.querySelector('button')?.addEventListener('click',()=>context.crossProbe?.({type:'layer',label:layer.name,layerId:layer.id})); layerBody.append(tr); }
      if (!layers.length) layerBody.innerHTML='<tr><td colspan="4" class="npi-empty">No layer records are present in the current normalized model.</td></tr>';
    }
    if (netBody) {
      netBody.innerHTML = '';
      for (const net of nets.slice(0, 500)) { const tr=document.createElement('tr'); tr.innerHTML=`<td><button class="npi-link-button" type="button">${htmlEscape(net.name)}</button></td><td>${net.connectionCount}</td><td>${net.viaCount}</td><td>${net.traceCount}</td>`; tr.querySelector('button')?.addEventListener('click',()=>context.crossProbe?.({type:'net',label:net.name,netId:net.id,connections:net.connections})); netBody.append(tr); }
      if (!nets.length) netBody.innerHTML='<tr><td colspan="4" class="npi-empty">No electrical net records are present in the current normalized model.</td></tr>';
    }
    const query=String($('npiPcbSearch')?.value || '').trim();
    if (results) {
      results.innerHTML='';
      if (query) {
        const matches=queryCrossProbe(model,query,{limit:40});
        for(const item of matches){const button=document.createElement('button');button.type='button';button.className='npi-list-row';button.innerHTML=`<strong>${htmlEscape(item.type.toUpperCase())}</strong><span>${htmlEscape(item.label)}</span>`;button.addEventListener('click',()=>context.crossProbe?.(item));results.append(button);} if(!matches.length)results.innerHTML='<p class="npi-empty">No matching PCB object.</p>';
      }
    }
  }

  function renderCompatibility() {
    const model = getModel();
    const select = $('npiProfileSelect');
    if (!select) return;
    const profiles = getExportProfiles(state.customProfiles);
    const current = select.value || profiles[0]?.id;
    select.innerHTML = '';
    profiles.forEach((profile) => {
      const option = document.createElement('option');
      option.value = profile.id;
      option.textContent = profile.name;
      select.append(option);
    });
    select.value = profiles.some((profile) => profile.id === current) ? current : profiles[0]?.id || '';
    const profile = profiles.find((item) => item.id === select.value);
    if (!model || !profile) {
      setText('npiCompatibilityStatus', 'No project');
      return;
    }

    const result = evaluateFormatCompatibility(model, profile);
    const loss = buildConversionLossReport(model, profile.format);
    setText('npiCompatibilityStatus', result.status.replaceAll('-', ' '));
    setText('npiCompatibilityCounts', `${result.counts.components} components · ${result.counts.lands} lands · ${result.issues.length} issues`);
    setText('npiLossScore', `${loss.lossPercent}% estimated conversion loss`);
    const list = $('npiCompatibilityIssues');
    if (!list) return;
    list.innerHTML = '';
    const issues = [
      ...result.issues,
      ...loss.reduced.map((item) => ({ level: 'warning', code: 'REDUCED', message: `${item.category}: ${item.reason}` })),
      ...loss.omitted.map((item) => ({ level: 'blocking', code: 'OMITTED', message: `${item.category}: ${item.reason}` })),
    ];
    issues.forEach((issue) => {
      const div = document.createElement('div');
      div.className = `npi-issue ${issue.level}`;
      div.innerHTML = `<b>${htmlEscape(issue.code)}</b><span>${htmlEscape(issue.message)}</span>`;
      list.append(div);
    });
    if (!list.children.length) list.innerHTML = '<p class="npi-empty">No compatibility issues detected.</p>';
  }

  function saveCustomProfile() {
    const selected = getExportProfiles(state.customProfiles).find((item) => item.id === $('npiProfileSelect')?.value);
    if (!selected) return;
    const name = String($('npiCustomProfileName')?.value || '').trim() || `${selected.name} Custom`;
    const id = `custom-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || Date.now()}`;
    const precision = Math.max(0, Math.min(9, Number($('npiCustomProfilePrecision')?.value ?? selected.precision ?? 3)));
    const custom = { ...selected, id, name, precision, custom: true };
    const byId = new Map(state.customProfiles.map((item) => [item.id, item]));
    byId.set(id, custom);
    state.customProfiles = [...byId.values()];
    saveJson(EXPORT_PROFILE_KEY, state.customProfiles);
    renderCompatibility();
    $('npiProfileSelect').value = id;
    renderCompatibility();
    toast?.(`Saved custom export profile “${name}”.`);
  }

  function deleteCustomProfile() {
    const id = $('npiProfileSelect')?.value;
    const item = state.customProfiles.find((profile) => profile.id === id);
    if (!item) {
      toast?.('Built-in profiles cannot be deleted.');
      return;
    }
    state.customProfiles = state.customProfiles.filter((profile) => profile.id !== id);
    saveJson(EXPORT_PROFILE_KEY, state.customProfiles);
    renderCompatibility();
    toast?.('Custom export profile deleted.');
  }

  function renderPackages() {
    const model = getModel();
    const list = $('npiPackageTableBody');
    if (!list) return;
    list.innerHTML = '';
    if (!model) return;
    const rows = buildPackageLibrary(model);
    const original = getProject()?.parsedSourceModel;
    const mapping = original ? packageLevelMapping(original, model) : [];
    const mapBy = new Map(mapping.map((item) => [String(item.targetPackageId), item]));
    rows.forEach((pkg) => {
      const tr = document.createElement('tr');
      const matched = mapBy.get(String(pkg.id));
      tr.innerHTML = `<td>${htmlEscape(pkg.name)}</td><td>${pkg.landCount}</td><td>${htmlEscape(pkg.recognition.family)}</td><td>${Math.round(pkg.recognition.confidence * 100)}%</td><td>${matched ? `${htmlEscape(matched.sourceName)} (${Math.round(matched.score * 100)}%)` : '—'}</td>`;
      list.append(tr);
    });
    const saved = loadJson(PACKAGE_LIBRARY_KEY, []);
    setText('npiPackageLibrarySummary', `${rows.length} packages in project · ${saved.length} saved locally`);
  }

  function renderReconciliation() {
    const model = getModel();
    const raw = normalizeRawRows(getRaw());
    const bom = currentBom();
    const result = reconcileNpiData(model, bom, raw);
    setText('npiReconcileSummary', `${result.counts.cad} CAD · ${result.counts.bom} BOM · ${result.counts.placement} placement · ${result.counts.errors} errors · ${result.counts.warnings} warnings`);
    const body = $('npiReconcileBody');
    if (!body) return;
    body.innerHTML = '';
    result.issues.slice(0, 500).forEach((issue) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${htmlEscape(issue.reference)}</td><td>${htmlEscape(issue.type)}</td><td>${htmlEscape(issue.severity)}</td><td>${htmlEscape(issue.message)}</td>`;
      body.append(tr);
    });
    if (!result.issues.length) body.innerHTML = '<tr><td colspan="4">No reconciliation conflicts.</td></tr>';
  }

  function renderRevisions() {
    const project = getProject();
    const body = $('npiRevisionBody');
    if (!body) return;
    body.innerHTML = '';
    const rows = buildRevisionTimeline(project || {});
    rows.forEach((revision) => {
      const tr = document.createElement('tr');
      const changes = revision.changeSet?.changes?.map?.((change) => change.type).filter(Boolean).slice(0, 4).join(', ') || '—';
      tr.innerHTML = `<td>R${revision.revision}</td><td>${htmlEscape(revision.createdAt || '')}</td><td>${htmlEscape(revision.validationStatus)}</td><td>${revision.componentCount}</td><td>${revision.landCount}</td><td>${htmlEscape(changes)}</td><td></td>`;
      const actionCell = tr.lastElementChild;
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = Number(revision.revision) === Number(project?.appliedRevision) ? 'Current' : 'Restore as New Revision';
      button.disabled = Number(revision.revision) === Number(project?.appliedRevision);
      button.addEventListener('click', async () => {
        const accepted = await context.confirm?.({
          title: 'Restore Previous Revision?',
          message: `Revision ${revision.revision} will be copied into a new revision. Existing history will be preserved.`,
          confirmText: 'Yes - Restore',
        });
        if (accepted === false) return;
        try {
          const result = await context.restoreRevision?.(revision.revision);
          toast?.(`Restored revision ${revision.revision} as revision ${result?.revision ?? 'new'}.`);
          refresh();
        } catch (error) { toast?.(error.message); }
      });
      actionCell.append(button);
      body.append(tr);
    });
    const compare = buildSmartRevisionCompare(project || {});
    setText('npiRevisionCompareSummary', compare.rows?.length
      ? `Latest comparison: ${compare.summary.changed} changed · ${compare.summary.added} added · ${compare.summary.removed} removed · ${compare.summary.unchanged} unchanged`
      : 'Not enough revisions to compare.');
  }

  function renderPanel() {
    const model = getModel();
    if (!model) return [];
    const rows = Number($('npiPanelRows')?.value || 1);
    const columns = Number($('npiPanelColumns')?.value || 1);
    const pitchX = Number($('npiPanelPitchX')?.value || model.boardDefinition?.width || 0);
    const pitchY = Number($('npiPanelPitchY')?.value || model.boardDefinition?.height || 0);
    const rotation = Number($('npiPanelRotation')?.value || 0);
    const mirror = Boolean($('npiPanelMirror')?.checked);
    const instances = createPanelArray(model, { rows, columns, pitchX, pitchY, rotation, mirror });
    setText('npiPanelSummary', `${instances.length} board instances · ${rows} × ${columns} · pitch ${formatNumber(pitchX)} × ${formatNumber(pitchY)} ${model.units || 'mm'}`);
    return instances;
  }

  function renderBomLayout() {
    const body = $('npiBomLayoutBody');
    if (!body) return;
    body.innerHTML = '';
    state.bomLayout.order.forEach((key, index) => {
      const row = document.createElement('div');
      row.className = 'npi-bom-field';
      const label = BOM_FIELDS.find((field) => field.key === key)?.label || key;
      const positionLabel = state.bomLayout.orientation === 'columns' ? bomLayoutColumnLetter(state.bomLayout, key) : String(index + 1);
      row.innerHTML = `<span class="npi-column-letter">${positionLabel}</span><strong>${htmlEscape(label)}</strong><select aria-label="Move ${htmlEscape(label)}"></select><div><button type="button" data-dir="up" title="Move up">↑</button><button type="button" data-dir="down" title="Move down">↓</button></div>`;
      const select = row.querySelector('select');
      state.bomLayout.order.forEach((_, targetIndex) => {
        const option = document.createElement('option');
        option.value = String(targetIndex);
        option.textContent = state.bomLayout.orientation === 'columns' ? bomLayoutColumnLetter({ ...state.bomLayout, order: state.bomLayout.order }, state.bomLayout.order[targetIndex]) : `Row ${targetIndex + 1}`;
        if (targetIndex === index) option.selected = true;
        select.append(option);
      });
      select.addEventListener('change', () => {
        state.bomLayout = moveBomField(state.bomLayout, key, Number(select.value));
        renderBomLayout();
      });
      row.querySelector('[data-dir="up"]').addEventListener('click', () => {
        state.bomLayout = moveBomField(state.bomLayout, key, index - 1);
        renderBomLayout();
      });
      row.querySelector('[data-dir="down"]').addEventListener('click', () => {
        state.bomLayout = moveBomField(state.bomLayout, key, index + 1);
        renderBomLayout();
      });
      body.append(row);
    });
    setText('npiBomSummary', `${currentBom().length} BOM rows · ${state.bomLayout.orientation === 'columns' ? 'Fields are columns (A, B, C…)' : 'Fields are rows (1, 2, 3…)'}`);
  }


  function renderAutomation() {
    const model = getModel();
    const summary = $('npiAutomationSummary');
    const body = $('npiAutomationBody');
    if (!model) { if (summary) summary.textContent = 'Open a CAD project to run automation analysis.'; if (body) body.innerHTML = ''; return; }
    const target = validateModelAgainstTargetProfile(model, DEFAULT_TARGET_PROFILE);
    const preview = runSmartNpiAutomation(model, { rotation: { tolerance: Number($('npiAutomationRotationTolerance')?.value || 2) } });
    state.automationPreview = preview;
    if (summary) summary.textContent = `${preview.packageRecognition.length} package pattern(s) · ${preview.rotationNormalization.length} safe rotation suggestion(s) · ${target.summary.blocking} target blocking issue(s)`;
    if (body) {
      body.innerHTML = '';
      const rows = [
        ...preview.rotationNormalization.slice(0, 80).map((item) => ({ type: 'Rotation', subject: item.reference || item.componentId, detail: `${item.from}° → ${item.to}° (Δ ${formatNumber(item.delta, 3)}°)`, confidence: 'Tolerance rule' })),
        ...preview.packageRecognition.slice(0, 80).map((item) => ({ type: 'Package', subject: item.currentName || item.packageId, detail: item.suggestedFamily, confidence: `${Math.round(Number(item.confidence || 0) * 100)}%` })),
      ];
      for (const item of rows) { const tr = document.createElement('tr'); tr.innerHTML = `<td>${htmlEscape(item.type)}</td><td>${htmlEscape(item.subject)}</td><td>${htmlEscape(item.detail)}</td><td>${htmlEscape(item.confidence)}</td>`; body.append(tr); }
      if (!rows.length) body.innerHTML = '<tr><td colspan="4" class="npi-empty">No automation suggestions.</td></tr>';
    }
    setText('npiTargetReadiness', target.compatible ? 'Ready' : 'Needs review');
  }

  function renderGolden() {
    if (!state.goldenText) {
      setText('npiGoldenSummary', 'Load a trusted reference XML to compare structure and formatting.');
      return;
    }
    const analysis = analyzeGoldenTemplate(state.goldenText);
    setText('npiGoldenSummary', `Root ${analysis.root || '—'} · ${analysis.tags.length} tag types · max ${analysis.maxDecimals} decimals · ${analysis.lineEnding}`);
  }

  function renderTab(tab) {
    ({
      overview: renderOverview,
      'pcb-data': renderPcbData,
      compatibility: renderCompatibility,
      packages: renderPackages,
      reconcile: renderReconciliation,
      revisions: renderRevisions,
      panel: renderPanel,
      bom: renderBomLayout,
      golden: renderGolden,
      automation: renderAutomation,
    }[tab] || (() => {}))();
  }

  function refresh() {
    renderOverview();
    renderTab(state.tab);
  }

  $('npiWorkspaceButton')?.addEventListener('click', open);
  $('npiCloseButton')?.addEventListener('click', close);
  overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
  if (typeof overlay.querySelectorAll === 'function') overlay.querySelectorAll('[data-npi-tab]').forEach((button) => button.addEventListener('click', () => setTab(button.dataset.npiTab)));
  $('npiPcbSearch')?.addEventListener('input', renderPcbData);
  $('npiOpenProjectStorage')?.addEventListener('click', () => context.openProjectStorage?.());


  $('npiAutomationAnalyze')?.addEventListener('click', renderAutomation);
  $('npiAutomationApplyRotations')?.addEventListener('click', async () => {
    const model = getModel(); if (!model) return;
    const tolerance = Number($('npiAutomationRotationTolerance')?.value || 2);
    const proposals = proposeRotationNormalization(model, { tolerance });
    if (!proposals.length) { toast?.('No safe rotation normalization suggestions.'); return; }
    const next = cloneCadValue(model); const byId = new Map((next.components || []).map((item) => [String(item.id), item]));
    await processInChunks(proposals, async (chunk) => { for (const item of chunk) { const component = byId.get(String(item.componentId)); if (component) component.rotation = item.to; } return chunk.length; }, { chunkSize: 250 });
    try {
      const result = await context.commitModelChange?.({ label: 'Apply safe NPI rotation normalization', model: next, changes: proposals.map((item) => ({ type: 'normalize-rotation', ...item })) });
      toast?.(`Applied ${proposals.length} rotation normalization(s) as revision ${result?.revision ?? 'new'}.`); refresh();
    } catch (error) { toast?.(error.message); }
  });

  $('npiProfileSelect')?.addEventListener('change', renderCompatibility);
  $('npiSaveCustomProfile')?.addEventListener('click', saveCustomProfile);
  $('npiDeleteCustomProfile')?.addEventListener('click', deleteCustomProfile);
  $('npiExportProfileJson')?.addEventListener('click', () => {
    const profile = getExportProfiles(state.customProfiles).find((item) => item.id === $('npiProfileSelect')?.value);
    if (!profile) return;
    download(new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' }), `${profile.id}-export-profile.json`);
  });

  $('npiSavePackageLibrary')?.addEventListener('click', () => {
    const rows = buildPackageLibrary(getModel());
    const previous = loadJson(PACKAGE_LIBRARY_KEY, []);
    const bySignature = new Map(previous.map((item) => [item.signature || item.name, item]));
    rows.forEach((item) => bySignature.set(item.signature || item.name, item));
    saveJson(PACKAGE_LIBRARY_KEY, [...bySignature.values()]);
    renderPackages();
    toast?.('Package library saved locally.');
  });
  $('npiClearPackageLibrary')?.addEventListener('click', () => {
    saveJson(PACKAGE_LIBRARY_KEY, []);
    renderPackages();
    toast?.('Local package library cleared.');
  });

  $('npiCarryMappings')?.addEventListener('click', async () => {
    try {
      const result = await context.carryMappings?.();
      toast?.(`Mapping recalculated. ${result?.preserved ?? 0} manual mapping(s) preserved.`);
      renderReconciliation();
    } catch (error) { toast?.(error.message); }
  });

  ['npiPanelRows', 'npiPanelColumns', 'npiPanelPitchX', 'npiPanelPitchY', 'npiPanelRotation', 'npiPanelMirror']
    .forEach((id) => $(id)?.addEventListener('input', renderPanel));
  $('npiApplyPanel')?.addEventListener('click', async () => {
    const model = getModel();
    if (!model) return;
    const next = cloneCadValue(model);
    next.panelInstances = renderPanel() || [];
    try {
      const result = await context.commitModelChange?.({
        label: 'Update panel definition',
        model: next,
        changes: [{ type: 'set-panel-array', instanceCount: next.panelInstances.length }],
      });
      toast?.(`Panel definition committed as revision ${result?.revision ?? 'new'}.`);
      refresh();
    } catch (error) { toast?.(error.message); }
  });

  $('npiBomOrientation')?.addEventListener('change', () => {
    state.bomLayout = { ...state.bomLayout, orientation: $('npiBomOrientation').value };
    renderBomLayout();
  });
  $('npiBomResetLayout')?.addEventListener('click', () => {
    state.bomLayout = normalizeBomLayout();
    renderBomLayout();
  });
  $('npiBomExportCsv')?.addEventListener('click', () => {
    const rows = currentBom();
    download(new Blob(['\ufeff', buildBomCsv(rows, state.bomLayout)], { type: 'text/csv;charset=utf-8' }), `bom-r${getProject()?.appliedRevision || 0}.csv`);
  });
  $('npiBomExportXlsx')?.addEventListener('click', async () => {
    const rows = currentBom();
    const blob = await buildBomXlsx(rows, state.bomLayout, { title: `BOM Revision ${getProject()?.appliedRevision || 0}` });
    download(blob, `bom-r${getProject()?.appliedRevision || 0}.xlsx`);
  });

  $('npiGoldenFile')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    state.goldenText = await file.text();
    renderGolden();
    event.target.value = '';
  });
  $('npiGoldenCompare')?.addEventListener('click', async () => {
    if (!state.goldenText) return;
    const xml = await context.getInspectionXml?.();
    if (!xml) {
      setText('npiGoldenCompareResult', 'No current inspection XML is available.');
      return;
    }
    const result = compareExportToGolden(xml, state.goldenText);
    setText('npiGoldenCompareResult', `${result.compatible ? 'Structurally compatible' : 'Differences found'} · root ${result.rootMatch ? 'match' : 'differs'} · ${result.missingTags.length} missing tags · ${result.attributeDifferences.length} attribute differences · ${result.extraTags.length} extra tags`);
  });
  $('npiGoldenExport')?.addEventListener('click', async () => {
    if (!state.goldenText) return;
    const xml = await context.getInspectionXml?.();
    if (!xml) return;
    try {
      const merged = mergeGeneratedIntoGoldenTemplate(state.goldenText, xml);
      download(new Blob([merged], { type: 'application/xml;charset=utf-8' }), `template-preserved-r${getProject()?.appliedRevision || 0}.xml`);
    } catch (error) { setText('npiGoldenCompareResult', error.message); }
  });

  $('npiCalibrationRun')?.addEventListener('click', () => {
    try {
      const pairs = [1, 2, 3].map((index) => ({
        source: { x: Number($(`npiSx${index}`)?.value), y: Number($(`npiSy${index}`)?.value) },
        target: { x: Number($(`npiTx${index}`)?.value), y: Number($(`npiTy${index}`)?.value) },
      })).filter((pair) => Object.values(pair.source).every(Number.isFinite) && Object.values(pair.target).every(Number.isFinite));
      state.lastCalibration = estimateCoordinateCalibration(pairs, { allowScale: $('npiCalibrationScale')?.checked });
      setText('npiCalibrationResult', `Offset X ${formatNumber(state.lastCalibration.translation.x, 6)} · Y ${formatNumber(state.lastCalibration.translation.y, 6)} · rotation ${formatNumber(state.lastCalibration.rotation, 6)}° · scale ${formatNumber(state.lastCalibration.scale, 9)} · RMS ${formatNumber(state.lastCalibration.rms, 6)}`);
    } catch (error) { setText('npiCalibrationResult', error.message); }
  });
  $('npiApplyCalibration')?.addEventListener('click', async () => {
    const model = getModel();
    if (!state.lastCalibration || !model) return;
    const next = applyCoordinateCalibrationToModel(cloneCadValue(model), state.lastCalibration);
    try {
      const result = await context.commitModelChange?.({
        label: 'Apply coordinate calibration',
        model: next,
        changes: [{ type: 'coordinate-calibration', calibration: cloneCadValue(state.lastCalibration) }],
      });
      toast?.(`Alignment committed as revision ${result?.revision ?? 'new'}.`);
      refresh();
    } catch (error) { toast?.(error.message); }
  });

  if (typeof document.addEventListener === 'function') document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !overlay.classList.contains('hidden')) close();
  });

  setTab('overview');
  return { open, close, refresh };
}
