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

  const state = {
    tab: 'overview',
    goldenText: '',
    bomLayout: normalizeBomLayout(),
    customProfiles: loadJson(EXPORT_PROFILE_KEY, []),
    lastCalibration: null,
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
      compatibility: renderCompatibility,
      packages: renderPackages,
      reconcile: renderReconciliation,
      revisions: renderRevisions,
      panel: renderPanel,
      bom: renderBomLayout,
      golden: renderGolden,
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
  $('npiOpenProjectStorage')?.addEventListener('click', () => context.openProjectStorage?.());

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
