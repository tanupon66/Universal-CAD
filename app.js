import {
  autoDetectSchema,
  buildMappings,
  buildCadOnlyMappings,
  columnName,
  extractProjectFiles,
  parseInspectionXml,
  parseXlsx,
} from './parsers.js';
import {
  createSequencePreview,
  findLandIndex,
  getAnchorRange,
  restoreMapping,
  snapshotMapping,
  stateForLand,
  stateForUnmapped,
} from './manual-pattern.js';
import {
  buildCadNameAudit,
  cadAuditToCsv,
  cadLandKey,
  generateCadRenames,
  normalizeCadName,
  rewriteCadXml,
} from './cad-inspector.js';
import { buildCadComparison, cadComparisonToCsv } from './cad-compare.js';
import { buildComponentReportXlsx } from './xlsx-report.js';
import { buildZones, canvasToPngBytes, histogramModel, renderHistogramImage, renderOverviewImage, renderZoneImage } from './component-report.js';
import { packageOutputInfo, readCadPackageFile, rebuildCadPackage } from './archive-package.js';
import {
  addComponent,
  addLand,
  createCadEditorModel,
  cloneCadEditorModel,
  cloneCadEditorModelAsync,
  cadEditorModelToDataAsync,
  componentBounds,
  deleteComponent,
  deleteLand,
  duplicateLand,
  modelSummary,
  moveComponent,
  moveLand,
  normalizeSide,
  renumberAllComponentsA1,
  renumberComponentA1,
  serializeCadEditorModel,
  serializeCadEditorModelStandalone,
  serializeCadEditorModelStandaloneAsync,
  splitComponentLands,
  splitLandRectangle,
  mergeLandRectangles,
  validateCadEditorModel,
  validateCadEditorModelAsync,
} from './cad-editor.js';
import {
  createProjectSession,
  prepareProjectRevision,
  commitPreparedProjectRevision,
  projectSessionCheckpoint,
  restoreProjectSessionCheckpoint,
  createProjectExportSnapshot,
  currentProjectLegacyCad,
  exportProjectBackup,
  importProjectBackup,
} from './project-session.js';
import { exportPreflight, validateUniversalCad } from './validation-center.js';
import { ExportError, ImportError, TransactionError as CadTransactionError, asCadError } from './cad-errors.js';
import { csvCell as escapeCsv, safeDownloadName } from './export-safety.js';
import { createDiagnosticReport, diagnosticText } from './diagnostics.js';
import { detectCadFormat } from './format-detector.js';
import { decodeTextBytes, parseDelimitedText } from './delimited-import.js';
import { buildLandSpatialIndex } from './spatial-index.js';
import { PerformanceDiagnostics } from './performance-diagnostics.js';
import {
  createProjectStorageRecord, saveProjectRecord, listProjectRecords, loadProjectRecord, deleteProjectRecord,
  duplicateProjectRecord, clearTemporaryCache, storageUsage, createAutosaveController,
} from './project-storage.js';

const BOARD_VIEW = '__board__';
const CAD_EDITOR_RENDER_LIMIT = 500;
const CAD_EDITOR_LIGHT_SELECTION_LIMIT = 160;
const $ = (id) => document.getElementById(id);
const els = {
  projectFile: $('projectFile'), dropZone: $('dropZone'), resetButton: $('resetButton'),
  originalCadButton: $('originalCadButton'), originalCadFile: $('originalCadFile'), generatedCadButton: $('generatedCadButton'), generatedCadFile: $('generatedCadFile'),
  archiveCadButton: $('archiveCadButton'), archiveCadFile: $('archiveCadFile'),
  restoreButton: $('restoreButton'), restoreFile: $('restoreFile'), projectBackupButton: $('projectBackupButton'), recoveryButton: $('recoveryButton'), storageManagerButton: $('storageManagerButton'),
  xmlFileName: $('xmlFileName'), generatedXmlFileName: $('generatedXmlFileName'), xlsxFileName: $('xlsxFileName'), archiveFileName: $('archiveFileName'), importMessage: $('importMessage'), archiveDiagnostics: $('archiveDiagnostics'), archiveDiagnosticsText: $('archiveDiagnosticsText'),
  progressWrap: $('progressWrap'), projectStatus: $('projectStatus'), buildInfoBadge: $('buildInfoBadge'),
  componentColumn: $('componentColumn'), packageColumn: $('packageColumn'), landColumn: $('landColumn'),
  measurementColumn: $('measurementColumn'), remapButton: $('remapButton'),
  mappedStat: $('mappedStat'), verifiedStat: $('verifiedStat'), unmappedStat: $('unmappedStat'), xmlLandStat: $('xmlLandStat'), componentStat: $('componentStat'),
  mappingFormula: $('mappingFormula'), activeCadSelect: $('activeCadSelect'), componentSelect: $('componentSelect'), heatmapToggle: $('heatmapToggle'), labelToggle: $('labelToggle'),
  duplicateToggle: $('duplicateToggle'), duplicateOnlyToggle: $('duplicateOnlyToggle'), cadCompareOverlayToggle: $('cadCompareOverlayToggle'), duplicateNameSelect: $('duplicateNameSelect'), duplicateSummaryMini: $('duplicateSummaryMini'),
  fitButton: $('fitButton'), zoomInButton: $('zoomInButton'), zoomOutButton: $('zoomOutButton'),
  searchInput: $('searchInput'), searchButton: $('searchButton'), cadEditorButton: $('cadEditorButton'), detailPanelButton: $('detailPanelButton'), detailPanelCloseButton: $('detailPanelCloseButton'), detailPanelBackdrop: $('detailPanelBackdrop'), cadInspectorButton: $('cadInspectorButton'), cadCompareButton: $('cadCompareButton'), manualButton: $('manualButton'), teachButton: $('teachButton'),
  undoButton: $('undoButton'), redoButton: $('redoButton'), exportCsvButton: $('exportCsvButton'), exportExcelButton: $('exportExcelButton'), exportJsonButton: $('exportJsonButton'),
  canvas: $('cadCanvas'), viewerTitle: $('viewerTitle'), viewerSubtitle: $('viewerSubtitle'), tooltip: $('tooltip'), manualBanner: $('manualBanner'),
  editCurrentLabel: $('editCurrentLabel'), exitEditButton: $('exitEditButton'), editPrevButton: $('editPrevButton'), editNextButton: $('editNextButton'), editAutoNext: $('editAutoNext'), editLockConfirmed: $('editLockConfirmed'),
  tableFilter: $('tableFilter'), mappingTableBody: $('mappingTableBody'), tableSummary: $('tableSummary'), prevPage: $('prevPage'), nextPage: $('nextPage'), pageLabel: $('pageLabel'),
  selectedTitle: $('selectedTitle'), selectedSubTitle: $('selectedSubTitle'), dLocal: $('dLocal'), dGlobal: $('dGlobal'), dCad: $('dCad'), dComponent: $('dComponent'),
  dX: $('dX'), dY: $('dY'), dMeasurement: $('dMeasurement'), dConfidence: $('dConfidence'), dRow: $('dRow'), dMethod: $('dMethod'), dVerified: $('dVerified'), dAnchor: $('dAnchor'),
  measurementHistogram: $('measurementHistogram'), histogramBins: $('histogramBins'), histogramMessage: $('histogramMessage'), expandHistogramButton: $('expandHistogramButton'),
  histCount: $('histCount'), histMin: $('histMin'), histAverage: $('histAverage'), histMedian: $('histMedian'), histMax: $('histMax'),
  histogramOverlay: $('histogramOverlay'), closeHistogramButton: $('closeHistogramButton'), detailedHistogramPart: $('detailedHistogramPart'),
  detailedHistogramCanvas: $('detailedHistogramCanvas'), detailedHistogramBins: $('detailedHistogramBins'), histogramYMode: $('histogramYMode'),
  histogramRangeMin: $('histogramRangeMin'), histogramRangeMax: $('histogramRangeMax'), applyHistogramRangeButton: $('applyHistogramRangeButton'),
  resetHistogramRangeButton: $('resetHistogramRangeButton'), zoomHistogramBinButton: $('zoomHistogramBinButton'), exportHistogramButton: $('exportHistogramButton'),
  histogramTooltip: $('histogramTooltip'), histogramSelectionLabel: $('histogramSelectionLabel'), histogramCadFilter: $('histogramCadFilter'), detailedHistogramMessage: $('detailedHistogramMessage'),
  detailHistTotal: $('detailHistTotal'), detailHistInRange: $('detailHistInRange'), detailHistMin: $('detailHistMin'), detailHistQ1: $('detailHistQ1'),
  detailHistAverage: $('detailHistAverage'), detailHistMedian: $('detailHistMedian'), detailHistQ3: $('detailHistQ3'), detailHistMax: $('detailHistMax'), detailHistStdDev: $('detailHistStdDev'),
  selectedBinRange: $('selectedBinRange'), selectedBinCount: $('selectedBinCount'), selectedBinPercent: $('selectedBinPercent'), selectedBinCumulative: $('selectedBinCumulative'),
  anchorButton: $('anchorButton'), unmapButton: $('unmapButton'), nudgePrevButton: $('nudgePrevButton'), nudgeNextButton: $('nudgeNextButton'),
  aliasInput: $('aliasInput'), saveAliasButton: $('saveAliasButton'), duplicateWarning: $('duplicateWarning'), rawData: $('rawData'), copyRawButton: $('copyRawButton'),
  duplicatePanel: $('duplicatePanel'), duplicateGroupCount: $('duplicateGroupCount'), duplicatePanelMessage: $('duplicatePanelMessage'), duplicatePositionList: $('duplicatePositionList'), fitDuplicateButton: $('fitDuplicateButton'), clearDuplicateButton: $('clearDuplicateButton'),
  cadInspectorOverlay: $('cadInspectorOverlay'), closeCadInspectorButton: $('closeCadInspectorButton'), cadInspectorScope: $('cadInspectorScope'), cadMaxLength: $('cadMaxLength'), cadOverflowMode: $('cadOverflowMode'), cadDuplicateMode: $('cadDuplicateMode'), cadDuplicateCharacter: $('cadDuplicateCharacter'), cadNamePrefix: $('cadNamePrefix'), cadIssueFilter: $('cadIssueFilter'), cadInspectorSearch: $('cadInspectorSearch'), cadRulePreview: $('cadRulePreview'),
  cadAuditTotal: $('cadAuditTotal'), cadAuditValid: $('cadAuditValid'), cadAuditUnresolved: $('cadAuditUnresolved'), cadAuditDuplicateGroups: $('cadAuditDuplicateGroups'), cadAuditDuplicateLands: $('cadAuditDuplicateLands'), cadAuditTooLong: $('cadAuditTooLong'), cadAuditBlank: $('cadAuditBlank'), cadAuditChanged: $('cadAuditChanged'),
  cadAutoFixButton: $('cadAutoFixButton'), cadRenameAllButton: $('cadRenameAllButton'), cadResetNamesButton: $('cadResetNamesButton'), cadExportReportButton: $('cadExportReportButton'), cadApplyNamesButton: $('cadApplyNamesButton'), cadExportXmlButton: $('cadExportXmlButton'), cadInspectorMessage: $('cadInspectorMessage'),
  cadInspectorTableBody: $('cadInspectorTableBody'), cadInspectorTableSummary: $('cadInspectorTableSummary'), cadInspectorPrevPage: $('cadInspectorPrevPage'), cadInspectorNextPage: $('cadInspectorNextPage'), cadInspectorPageLabel: $('cadInspectorPageLabel'),
  cadCompareOverlay: $('cadCompareOverlay'), closeCadCompareButton: $('closeCadCompareButton'), cadCompareTolerance: $('cadCompareTolerance'), cadCompareFilter: $('cadCompareFilter'), cadCompareSearch: $('cadCompareSearch'), rebuildCadCompareButton: $('rebuildCadCompareButton'),
  cadCompareComponents: $('cadCompareComponents'), cadCompareMatched: $('cadCompareMatched'), cadCompareRenamed: $('cadCompareRenamed'), cadCompareMoved: $('cadCompareMoved'), cadCompareMissing: $('cadCompareMissing'), cadCompareExtra: $('cadCompareExtra'), cadCompareMessage: $('cadCompareMessage'),
  useOriginalCadButton: $('useOriginalCadButton'), useGeneratedCadButton: $('useGeneratedCadButton'), fitCadCompareButton: $('fitCadCompareButton'), exportCadCompareButton: $('exportCadCompareButton'), cadCompareTableBody: $('cadCompareTableBody'), cadCompareTableSummary: $('cadCompareTableSummary'), cadComparePrevPage: $('cadComparePrevPage'), cadCompareNextPage: $('cadCompareNextPage'), cadComparePageLabel: $('cadComparePageLabel'),
  teachOverlay: $('teachOverlay'), closeTeachButton: $('closeTeachButton'), teachComponentLabel: $('teachComponentLabel'),
  anchorCountLabel: $('anchorCountLabel'), anchorList: $('anchorList'), clearAnchorsButton: $('clearAnchorsButton'),
  patternDirection: $('patternDirection'), patternShift: $('patternShift'), patternStart: $('patternStart'), patternEnd: $('patternEnd'), preserveAnchors: $('preserveAnchors'),
  previewPatternButton: $('previewPatternButton'), fillBetweenButton: $('fillBetweenButton'), clearPreviewButton: $('clearPreviewButton'),
  previewTitle: $('previewTitle'), previewDirectionBadge: $('previewDirectionBadge'), previewApplicable: $('previewApplicable'), previewHigh: $('previewHigh'), previewReview: $('previewReview'), previewConflict: $('previewConflict'),
  previewFormula: $('previewFormula'), previewWarning: $('previewWarning'), applyPatternButton: $('applyPatternButton'), applyHighButton: $('applyHighButton'),
  previewForwardButton: $('previewForwardButton'), previewReverseButton: $('previewReverseButton'), shiftAllPrevButton: $('shiftAllPrevButton'), shiftAllNextButton: $('shiftAllNextButton'), unmapRangeButton: $('unmapRangeButton'),
  componentReportOverlay: $('componentReportOverlay'), closeComponentReportButton: $('closeComponentReportButton'), cancelComponentReportButton: $('cancelComponentReportButton'),
  componentReportScope: $('componentReportScope'), componentReportZones: $('componentReportZones'), componentReportLabels: $('componentReportLabels'), componentReportNameSource: $('componentReportNameSource'), componentReportResolution: $('componentReportResolution'), componentReportHeatmap: $('componentReportHeatmap'), componentReportCompatibility: $('componentReportCompatibility'),
  componentReportPartCount: $('componentReportPartCount'), componentReportLandCount: $('componentReportLandCount'), componentReportZoneCount: $('componentReportZoneCount'), componentReportMeasurementCount: $('componentReportMeasurementCount'), componentReportMessage: $('componentReportMessage'), generateComponentReportButton: $('generateComponentReportButton'),
  cadEditorOverlay: $('cadEditorOverlay'), closeCadEditorButton: $('closeCadEditorButton'), cadEditorSource: $('cadEditorSource'),
  cadEditorComponentCount: $('cadEditorComponentCount'), cadEditorLandCount: $('cadEditorLandCount'), cadEditorTopCount: $('cadEditorTopCount'), cadEditorBottomCount: $('cadEditorBottomCount'), cadEditorUnknownCount: $('cadEditorUnknownCount'),
  cadEditorUndoButton: $('cadEditorUndoButton'), cadEditorRedoButton: $('cadEditorRedoButton'), cadEditorHistoryStatus: $('cadEditorHistoryStatus'),
  cadEditorCanvas: $('cadEditorCanvas'), cadEditorCanvasWrap: $('cadEditorCanvasWrap'), cadEditorSelectTool: $('cadEditorSelectTool'), cadEditorPanTool: $('cadEditorPanTool'), cadEditorComponentMode: $('cadEditorComponentMode'), cadEditorLandMode: $('cadEditorLandMode'), cadEditorVisualSearch: $('cadEditorVisualSearch'), cadEditorVisualSideFilter: $('cadEditorVisualSideFilter'), cadEditorFitButton: $('cadEditorFitButton'), cadEditorZoomInButton: $('cadEditorZoomInButton'), cadEditorZoomOutButton: $('cadEditorZoomOutButton'), cadEditorLabelToggle: $('cadEditorLabelToggle'), cadEditorGridToggle: $('cadEditorGridToggle'), cadEditorSnapToggle: $('cadEditorSnapToggle'), cadEditorSelectionLabel: $('cadEditorSelectionLabel'), cadEditorSelectionHint: $('cadEditorSelectionHint'),
  cadStudioDirtyBadge: $('cadStudioDirtyBadge'), cadStudioOpenButton: $('cadStudioOpenButton'), cadEditorSelectionBar: $('cadEditorSelectionBar'), cadEditorContextMenu: $('cadEditorContextMenu'),
  cadEditorRotateLeftButton: $('cadEditorRotateLeftButton'), cadEditorRotateRightButton: $('cadEditorRotateRightButton'), cadEditorFlipSideButton: $('cadEditorFlipSideButton'), cadEditorAlignLeftButton: $('cadEditorAlignLeftButton'), cadEditorAlignCenterXButton: $('cadEditorAlignCenterXButton'), cadEditorAlignRightButton: $('cadEditorAlignRightButton'), cadEditorAlignTopButton: $('cadEditorAlignTopButton'), cadEditorAlignCenterYButton: $('cadEditorAlignCenterYButton'), cadEditorAlignBottomButton: $('cadEditorAlignBottomButton'),
  cadEditorInfoType: $('cadEditorInfoType'), cadEditorInfoName: $('cadEditorInfoName'), cadEditorInfoPackage: $('cadEditorInfoPackage'), cadEditorInfoSide: $('cadEditorInfoSide'), cadEditorInfoPosition: $('cadEditorInfoPosition'), cadEditorInfoSize: $('cadEditorInfoSize'), cadEditorDockDuplicateButton: $('cadEditorDockDuplicateButton'), cadEditorDockRotateButton: $('cadEditorDockRotateButton'), cadEditorDockFlipButton: $('cadEditorDockFlipButton'), cadNavigatorFitSearchButton: $('cadNavigatorFitSearchButton'), cadNavigatorClearSearchButton: $('cadNavigatorClearSearchButton'), cadEditorCursorX: $('cadEditorCursorX'), cadEditorCursorY: $('cadEditorCursorY'), cadEditorZoomStatus: $('cadEditorZoomStatus'), cadLayerTopCount: $('cadLayerTopCount'), cadLayerBottomCount: $('cadLayerBottomCount'),
  cadEditorPropertyTitle: $('cadEditorPropertyTitle'), cadEditorPropertySubtitle: $('cadEditorPropertySubtitle'), cadEditorSelectAllButton: $('cadEditorSelectAllButton'), cadEditorClearSelectionButton: $('cadEditorClearSelectionButton'), cadEditorMoveDx: $('cadEditorMoveDx'), cadEditorMoveDy: $('cadEditorMoveDy'), cadEditorNudgeStep: $('cadEditorNudgeStep'), cadEditorMoveButton: $('cadEditorMoveButton'),
  cadEditorComponentLabel: $('cadEditorComponentLabel'), cadEditorAddComponentButton: $('cadEditorAddComponentButton'), cadEditorComponentSearch: $('cadEditorComponentSearch'), cadEditorComponentList: $('cadEditorComponentList'), cadEditorDeleteComponentButton: $('cadEditorDeleteComponentButton'),
  cadEditorComponentId: $('cadEditorComponentId'), cadEditorComponentName: $('cadEditorComponentName'), cadEditorPackageName: $('cadEditorPackageName'), cadEditorRevision: $('cadEditorRevision'), cadEditorCenterX: $('cadEditorCenterX'), cadEditorCenterY: $('cadEditorCenterY'), cadEditorAngle: $('cadEditorAngle'), cadEditorSaveComponentButton: $('cadEditorSaveComponentButton'),
  cadEditorLandLabel: $('cadEditorLandLabel'), cadEditorSideFilter: $('cadEditorSideFilter'), cadEditorLandSearch: $('cadEditorLandSearch'), cadEditorRenumberComponentButton: $('cadEditorRenumberComponentButton'), cadEditorRenumberAllButton: $('cadEditorRenumberAllButton'), cadEditorAddLandButton: $('cadEditorAddLandButton'), cadEditorDuplicateLandButton: $('cadEditorDuplicateLandButton'), cadEditorCutLandButton: $('cadEditorCutLandButton'), cadEditorMergeLandButton: $('cadEditorMergeLandButton'), cadEditorSplitLandButton: $('cadEditorSplitLandButton'), cadEditorDeleteLandButton: $('cadEditorDeleteLandButton'), cadEditorLandTableBody: $('cadEditorLandTableBody'),
  cadEditorLandId: $('cadEditorLandId'), cadEditorLandName: $('cadEditorLandName'), cadEditorLandSide: $('cadEditorLandSide'), cadEditorLandLeft: $('cadEditorLandLeft'), cadEditorLandTop: $('cadEditorLandTop'), cadEditorLandWidth: $('cadEditorLandWidth'), cadEditorLandLength: $('cadEditorLandLength'), cadEditorSaveLandButton: $('cadEditorSaveLandButton'),
  cadEditorMessage: $('cadEditorMessage'), cadEditorExportSide: $('cadEditorExportSide'), cadEditorApplyButton: $('cadEditorApplyButton'), cadEditorExportXmlButton: $('cadEditorExportXmlButton'), cadEditorExportTgzButton: $('cadEditorExportTgzButton'),
  cadEditorConfirmOverlay: $('cadEditorConfirmOverlay'), cadEditorConfirmDialog: $('cadEditorConfirmDialog'), cadEditorConfirmIcon: $('cadEditorConfirmIcon'), cadEditorConfirmEyebrow: $('cadEditorConfirmEyebrow'), cadEditorConfirmTitle: $('cadEditorConfirmTitle'), cadEditorConfirmMessage: $('cadEditorConfirmMessage'), cadEditorConfirmSummary: $('cadEditorConfirmSummary'), cadEditorConfirmNo: $('cadEditorConfirmNo'), cadEditorConfirmYes: $('cadEditorConfirmYes'), cadEditorBusyOverlay: $('cadEditorBusyOverlay'), cadEditorBusyTitle: $('cadEditorBusyTitle'), cadEditorBusyDetail: $('cadEditorBusyDetail'), cadEditorBusyProgress: $('cadEditorBusyProgress'), cadEditorBusyCancelButton: $('cadEditorBusyCancelButton'), cadEditorBusyCloseButton: $('cadEditorBusyCloseButton'),
  appConfirmOverlay: $('appConfirmOverlay'), appConfirmTitle: $('appConfirmTitle'), appConfirmMessage: $('appConfirmMessage'), appConfirmDetail: $('appConfirmDetail'), appConfirmCancel: $('appConfirmCancel'), appConfirmAccept: $('appConfirmAccept'),
  globalErrorOverlay: $('globalErrorOverlay'), globalErrorTitle: $('globalErrorTitle'), globalErrorCode: $('globalErrorCode'), globalErrorStage: $('globalErrorStage'), globalErrorFile: $('globalErrorFile'), globalErrorMessage: $('globalErrorMessage'), globalErrorRemediation: $('globalErrorRemediation'), globalErrorTechnical: $('globalErrorTechnical'), globalErrorCopy: $('globalErrorCopy'), globalErrorDownload: $('globalErrorDownload'), globalErrorClose: $('globalErrorClose'),
  storageOverlay: $('storageOverlay'), storageCloseButton: $('storageCloseButton'), storageCloseFooterButton: $('storageCloseFooterButton'), storageUsageText: $('storageUsageText'), storageProjectCount: $('storageProjectCount'), storageProjectList: $('storageProjectList'), storageRefreshButton: $('storageRefreshButton'), storageClearTempButton: $('storageClearTempButton'),
  toast: $('toast'), installButton: $('installButton'), appUpdateButton: $('appUpdateButton'),
};


function closeDetailsDrawer() {
  document.querySelector('.right-panel')?.classList.remove('open');
  els.detailPanelBackdrop?.classList.add('hidden');
  els.detailPanelButton?.setAttribute?.('aria-expanded', 'false');
}
function openDetailsDrawer() {
  document.querySelector('.right-panel')?.classList.add('open');
  els.detailPanelBackdrop?.classList.remove('hidden');
  els.detailPanelButton?.setAttribute?.('aria-expanded', 'true');
}
function toggleDetailsDrawer() {
  const panel = document.querySelector('.right-panel');
  if (panel?.classList.contains('open')) closeDetailsDrawer();
  else openDetailsDrawer();
}

async function loadBuildInformation() {
  if (!els.buildInfoBadge) return;
  try {
    const response = await fetch('./build-info.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const info = await response.json();
    const commit = info.commit && info.commit !== 'unavailable' ? ` · ${String(info.commit).slice(0, 12)}` : '';
    els.buildInfoBadge.textContent = `v${info.appVersion || '0.20.0'}${commit} · Schema ${info.schemaVersion || 2}`;
    els.buildInfoBadge.title = `Build: ${info.buildDate || 'development'} | Commit: ${info.commit || 'unavailable'} | Schema: ${info.schemaVersion || 2}`;
  } catch {
    // Development mode may be opened directly from source without generated build-info.json.
    els.buildInfoBadge.textContent = 'v0.20.0 · Development · Schema 2';
  }
}

const state = {
  xmlText: null, xlsxBuffer: null, xmlData: null, xlsxData: null, schema: null, mappingData: null,
  selectedComponentId: null, selected: null, hoveredLand: null, manualMode: false, preview: null,
  edit: { enabled: false, autoNext: true, lockConfirmed: true },
  undoStack: [], redoStack: [], page: 1, pageSize: 80, filter: 'all',
  view: { scale: 1, offsetX: 0, offsetY: 0 }, dragging: false, lastPointer: null, dragStart: null,
  fileNames: { xml: '', generatedXml: '', xlsx: '' }, installPrompt: null,
  cadFiles: { original: null, generated: null }, activeCadRole: null, viewerSpatialIndex: null, diagnostics: new PerformanceDiagnostics(), recoveryRecord: null, serviceWorkerRegistration: null,
  cadCompare: { result: null, tolerance: 0.08, filter: 'changed', search: '', page: 1, pageSize: 120, selectedRow: null, overlayEnabled: false },
  histogram: { rangeMin: null, rangeMax: null, selectedBin: null, hoveredBin: null, layout: null, drag: null, filterEnabled: false },
  duplicateView: { enabled: true, dimOthers: false, selectedName: '' },
  cadInspector: { renames: new Map(), maxLength: 5, prefix: 'A', overflowMode: 'keep-start', duplicateMode: 'replace-character', duplicateCharacter: '_', scope: 'all', filter: 'all', search: '', page: 1, pageSize: 120, audit: null },
  cadEditor: { model: null, selectedComponentUid: null, selectedComponentUids: new Set(), selectedLandUid: null, selectedLandUids: new Set(), componentSearch: '', landSearch: '', sideFilter: 'all', clipboard: [], busy: false, busyToken: 0, busyStartedAt: 0, taskCancelRequested: false, pendingCloseAfterTask: false, pendingActionAfterClose: null, busyWatchdog: null, viewerRefreshPending: false, confirm: { mode: null, pendingAction: null }, history: { undo: [], redo: [], limit: 40, restoring: false }, visual: { scale: 1, offsetX: 0, offsetY: 0, tool: 'select', mode: 'component', search: '', side: 'all', labels: true, grid: true, snap: true, interaction: null, spaceDown: false, hoverHandle: null, boundsCache: new Map() } },
};

const ctx = els.canvas.getContext('2d', { alpha: false });
const histogramCtx = els.measurementHistogram.getContext('2d');
const detailedHistogramCtx = els.detailedHistogramCanvas.getContext('2d');
const cadEditorCtx = els.cadEditorCanvas.getContext('2d', { alpha: false });
const formatInt = new Intl.NumberFormat('th-TH');
const formatFloat = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 4 });

function cadRoleLabel(role) { return role === 'generated' ? 'Generated CAD' : 'Original CAD'; }
function activeCadFile() { return state.activeCadRole ? state.cadFiles[state.activeCadRole] : null; }
function ensureProjectSession(file = activeCadFile()) {
  if (!file) return null;
  if (!file.projectSession) {
    file.projectSession = createProjectSession({
      name: file.name,
      fileName: file.name,
      sourceFormat: file.sourceFormat || file.archive?.candidate?.format || 'inspection-xml',
      sourceText: file.text || '',
      legacyCad: file.data,
    });
    file.originalSource = file.projectSession.originalSource;
  }
  return file.projectSession;
}
function projectRevision(file = activeCadFile()) { return Number(file?.projectSession?.project?.appliedRevision ?? file?.editRevision ?? 0); }
function projectExportMetadata(file, exportFormat, validationStatus = 'passed') {
  const session = ensureProjectSession(file);
  if (!session) return { projectId: '', revisionNumber: 0, exportTime: new Date().toISOString(), sourceFormat: 'unknown', exportFormat, validationStatus, acceptedWarnings: [] };
  const snapshot = createProjectExportSnapshot(session, {
    exportFormat,
    sourceFormat: file.sourceFormat || file.archive?.candidate?.format || 'inspection-xml',
    validationStatus,
    acceptedWarnings: session.project.acceptedWarnings || [],
  });
  return {
    projectId: snapshot.projectId,
    revisionNumber: snapshot.revisionNumber,
    exportTime: snapshot.exportTime,
    sourceFormat: snapshot.sourceFormat,
    exportFormat: snapshot.exportFormat,
    validationStatus: snapshot.validationStatus,
    acceptedWarnings: snapshot.acceptedWarnings,
  };
}
function alternateCadRole() { return state.activeCadRole === 'original' ? 'generated' : state.activeCadRole === 'generated' ? 'original' : null; }
function alternateCadData() { const role = alternateCadRole(); return role ? state.cadFiles[role]?.data || null : null; }
function mappingOrder(mapping) { const value = Number(mapping?.rawOrder ?? mapping?.sourceRow ?? mapping?.localIndex); return Number.isFinite(value) ? value : 0; }
function mappingLabel(mapping) { return String(mapping?.rawLandId ?? mapping?.localIndex ?? ''); }
function syncCadFileLabels() {
  els.xmlFileName.textContent = state.cadFiles.original?.name || '—';
  els.generatedXmlFileName.textContent = state.cadFiles.generated?.name || '—';
  els.xlsxFileName.textContent = state.fileNames.xlsx || '—';
  const archive = activeCadFile()?.archive || state.cadFiles.original?.archive || state.cadFiles.generated?.archive;
  els.archiveFileName.textContent = archive?.name || '—';
}
function populateActiveCadSelect() {
  const previous = state.activeCadRole;
  els.activeCadSelect.innerHTML = '';
  for (const role of ['original', 'generated']) {
    const file = state.cadFiles[role]; if (!file) continue;
    const option = document.createElement('option'); option.value = role;
    option.textContent = `${cadRoleLabel(role)} · ${file.data.components.length} parts · ${formatInt.format(file.data.totalLands)} lands`;
    els.activeCadSelect.append(option);
  }
  if (!els.activeCadSelect.options.length) {
    const option = document.createElement('option'); option.value = ''; option.textContent = '— ยังไม่มี CAD —'; els.activeCadSelect.append(option);
    els.activeCadSelect.disabled = true;
  } else {
    els.activeCadSelect.disabled = false;
    els.activeCadSelect.value = state.activeCadRole && state.cadFiles[state.activeCadRole] ? state.activeCadRole : (previous && state.cadFiles[previous] ? previous : els.activeCadSelect.options[0].value);
  }
}
function saveActiveCadSession() {
  const file = activeCadFile(); if (!file) return;
  file.renames = state.cadInspector.renames;
}
function mappingIdentity(mapping) {
  if (!mapping) return '';
  if (mapping.sourceRecordId) return String(mapping.sourceRecordId);
  if (mapping.sourceRow != null) return `row:${Number(mapping.sourceRow)}`;
  return `${String(mapping.componentName || '')}\u0000${String(mapping.rawLandId ?? mapping.localIndex ?? '')}`;
}
function preserveManualMappings(previousMappingData, nextMappingData, cadData) {
  if (!previousMappingData?.mappings?.length || !nextMappingData?.mappings?.length) return nextMappingData;
  const priorByKey = new Map(previousMappingData.mappings.map((item) => [mappingIdentity(item), item]));
  const componentById = cadData?.componentById || new Map((cadData?.components || []).map((component) => [String(component.id), component]));
  for (const mapping of nextMappingData.mappings) {
    const previous = priorByKey.get(mappingIdentity(mapping));
    if (!previous || !(previous.manual || previous.mappingMethod === 'manual-direct' || previous.mappingMethod === 'manual-anchor')) continue;
    const component = componentById.get(String(previous.componentId));
    const land = component?.lands?.find((item) => String(item.globalId) === String(previous.globalId));
    if (!land) {
      mapping.previousMapping = { componentId: previous.componentId, globalId: previous.globalId, mappingMethod: previous.mappingMethod };
      mapping.matchStatus = 'conflict';
      mapping.mappingConflict = true;
      continue;
    }
    Object.assign(mapping, {
      componentId: component.id,
      componentName: component.name || mapping.componentName,
      packageName: component.packageName || mapping.packageName,
      globalId: land.globalId,
      cadName: land.cadName || '',
      left: land.left, top: land.top, centerX: land.centerX, centerY: land.centerY, width: land.width, length: land.length,
      mapped: true, manual: true, verified: true, confidence: 100,
      anchorLocked: Boolean(previous.anchorLocked),
      mappingMethod: previous.mappingMethod || 'manual-direct',
      matchStatus: 'manually-confirmed',
      manualReason: previous.manualReason || '',
      mappingHistory: [...(previous.mappingHistory || [])],
      previousMapping: previous.previousMapping || null,
    });
  }
  return nextMappingData;
}
function prepareMappingForCadData(cadData, { previousMappingData = state.mappingData, revision = 0 } = {}) {
  if (!cadData) return { schema: null, mappingData: null };
  if (!state.xlsxData) {
    return { schema: null, mappingData: buildCadOnlyMappings(cadData, { revision }) };
  }
  const schema = autoDetectSchema(state.xlsxData.activeSheet.rows, cadData, { alternateCadData: alternateCadData() });
  const mappingData = buildMappings(cadData, state.xlsxData, schema, { alternateCadData: alternateCadData(), coordinateTolerance: state.cadCompare.tolerance });
  mappingData.revision = revision;
  for (const mapping of mappingData.mappings || []) mapping.revision = revision;
  return { schema, mappingData: preserveManualMappings(previousMappingData, mappingData, cadData) };
}
function rebuildMappingForActiveCad() {
  const finishTiming = state.diagnostics.start('mapping', { revision: projectRevision(), hasRawData: Boolean(state.xlsxData) });
  if (!state.xmlData) {
    state.schema = null; state.mappingData = null; state.selected = null; state.page = 1;
    for (const select of [els.componentColumn, els.packageColumn, els.landColumn, els.measurementColumn]) select.innerHTML = '';
    els.mappingTableBody.innerHTML = '';
    finishTiming({ components: 0, mappings: 0 });
    return;
  }
  const prepared = prepareMappingForCadData(state.xmlData, { revision: Number(activeCadFile()?.editRevision || 0) });
  state.schema = prepared.schema;
  state.mappingData = prepared.mappingData;
  if (state.xlsxData && state.schema) populateSchemaControls();
  else for (const select of [els.componentColumn, els.packageColumn, els.landColumn, els.measurementColumn]) select.innerHTML = '';
  normalizeMappings();
  state.undoStack = []; state.redoStack = []; state.preview = null; state.selected = null; state.page = 1;
  finishTiming({ components: state.xmlData.components.length, mappings: state.mappingData?.mappings?.length || 0 });
}
function activateCad(role, { rebuild = true, fit = true } = {}) {
  const file = state.cadFiles[role]; if (!file) return false;
  saveActiveCadSession();
  state.activeCadRole = role; state.viewerSpatialIndex = null;
  state.xmlText = file.editedText || file.text; state.xmlData = file.data; state.fileNames.xml = file.name;
  state.cadInspector.renames = file.renames || new Map(); file.renames = state.cadInspector.renames;
  state.cadInspector.audit = null; state.selected = null; state.preview = null; state.page = 1; state.duplicateView.selectedName = '';
  resetHistogramState();
  state.selectedComponentId = BOARD_VIEW;
  if (rebuild) rebuildMappingForActiveCad();
  populateActiveCadSelect();
  populateComponents(BOARD_VIEW);
  updateStats(); renderTable(); renderTeachPanel(); refreshDuplicateControls(); clearDetails();
  if (fit) fitView(); else draw();
  renderHistogram(); renderDetailedHistogram();
  return true;
}
function storeCadFile(role, xmlText, name, options = {}) {
  const data = parseInspectionXml(xmlText);
  const previous = state.cadFiles[role];
  const archive = options.archive || previous?.archive || null;
  const sourceFormat = options.sourceFormat || archive?.candidate?.format || 'inspection-xml';
  const projectSession = createProjectSession({ name, fileName: name, sourceFormat, sourceText: xmlText, legacyCad: data });
  state.cadFiles[role] = {
    role, name, sourceFormat,
    text: xmlText,
    originalSource: projectSession.originalSource,
    projectSession,
    editedText: null,
    data,
    renames: new Map(),
    archive,
    editorModel: null,
    appliedEditorSnapshot: null,
    mappingDirty: false,
    viewerDirty: false,
    editRevision: 0,
  };
  if (role === 'generated') state.fileNames.generatedXml = name;
  syncCadFileLabels(); populateActiveCadSelect();
  return state.cadFiles[role];
}
function canCompareCad() { return Boolean(state.cadFiles.original?.data && state.cadFiles.generated?.data); }
function availablePairLabel() {
  const hasRaw = Boolean(state.xlsxData);
  const hasOriginal = Boolean(state.cadFiles.original?.data);
  const hasGenerated = Boolean(state.cadFiles.generated?.data);
  if (hasRaw && hasOriginal && hasGenerated) return `Raw Data ↔ ${cadRoleLabel(state.activeCadRole)} พร้อมสะพาน Original ↔ Generated`;
  if (hasRaw && state.xmlData) return `Raw Data ↔ ${cadRoleLabel(state.activeCadRole)}`;
  if (hasOriginal && hasGenerated) return 'Original CAD ↔ Generated CAD';
  if (state.xmlData) return `${cadRoleLabel(state.activeCadRole)} Viewer`;
  if (hasRaw) return 'Raw Data รอ CAD อีกหนึ่งไฟล์';
  return 'ยังไม่มีคู่ข้อมูล';
}
function rebuildCadComparison({ showToast = false } = {}) {
  if (!canCompareCad()) { state.cadCompare.result = null; updateCadCompareControls(); return null; }
  state.cadCompare.tolerance = Math.max(0.0001, Number(els.cadCompareTolerance.value) || state.cadCompare.tolerance || 0.08);
  state.cadCompare.result = buildCadComparison(state.cadFiles.original.data, state.cadFiles.generated.data, { coordinateTolerance: state.cadCompare.tolerance, moveTolerance: 0.001 });
  state.cadCompare.page = 1; state.cadCompare.selectedRow = null;
  updateCadCompareControls(); renderCadCompare(); draw();
  if (showToast) toast(`จับคู่ CAD ได้ ${formatInt.format(state.cadCompare.result.summary.matchedLands)} Land · เปลี่ยนชื่อ ${formatInt.format(state.cadCompare.result.summary.renamed + state.cadCompare.result.summary.renamedMoved)} จุด`);
  return state.cadCompare.result;
}
function updateCadCompareControls() {
  const ready = canCompareCad();
  els.cadCompareButton.disabled = !ready;
  els.cadCompareOverlayToggle.disabled = !ready || !state.cadCompare.result;
  els.cadCompareOverlayToggle.checked = Boolean(state.cadCompare.overlayEnabled && ready && state.cadCompare.result);
}
function cadCompareStatusLabel(status) {
  return ({ unchanged: 'ตรงกัน', renamed: 'เปลี่ยนชื่อ', moved: 'ตำแหน่งเปลี่ยน', 'renamed-moved': 'ชื่อและตำแหน่งเปลี่ยน', 'missing-generated': 'ไม่พบใน CAD ใหม่', 'extra-generated': 'เกินมาใน CAD ใหม่' })[status] || status;
}
function filteredCadCompareRows() {
  const result = state.cadCompare.result; if (!result) return [];
  const filter = state.cadCompare.filter;
  const search = state.cadCompare.search.trim().toLowerCase();
  return result.rows.filter((row) => {
    let pass = true;
    if (filter === 'changed') pass = row.status !== 'unchanged';
    else if (filter === 'renamed') pass = row.status === 'renamed' || row.status === 'renamed-moved';
    else if (filter === 'moved') pass = row.status === 'moved' || row.status === 'renamed-moved';
    else if (filter === 'missing') pass = row.status === 'missing-generated' || row.status === 'extra-generated';
    if (!pass || !search) return pass;
    return [row.originalComponentName, row.generatedComponentName, row.originalGlobalId, row.generatedGlobalId, row.originalName, row.generatedName, row.status].some((value) => String(value ?? '').toLowerCase().includes(search));
  });
}
function renderCadCompare() {
  const result = state.cadCompare.result;
  els.cadCompareTableBody.innerHTML = '';
  if (!result) {
    for (const id of ['cadCompareComponents','cadCompareMatched','cadCompareRenamed','cadCompareMoved','cadCompareMissing','cadCompareExtra']) els[id].textContent = '0';
    els.cadCompareMessage.textContent = 'อัปโหลด Original CAD และ Generated CAD เพื่อเริ่มเปรียบเทียบ';
    els.cadCompareTableSummary.textContent = '0 รายการ'; els.cadComparePageLabel.textContent = '1 / 1'; return;
  }
  const summary = result.summary;
  els.cadCompareComponents.textContent = `${formatInt.format(summary.matchedComponents)} / ${formatInt.format(summary.originalComponents)}`;
  els.cadCompareMatched.textContent = formatInt.format(summary.matchedLands);
  els.cadCompareRenamed.textContent = formatInt.format(summary.renamed + summary.renamedMoved);
  els.cadCompareMoved.textContent = formatInt.format(summary.moved + summary.renamedMoved);
  els.cadCompareMissing.textContent = formatInt.format(summary.missingGenerated);
  els.cadCompareExtra.textContent = formatInt.format(summary.extraGenerated);
  els.cadCompareMessage.textContent = `จับคู่ XML ID ก่อน และใช้พิกัดภายใน ${formatFloat.format(summary.coordinateTolerance)} mm เป็นแผนสำรอง · Original ${state.cadFiles.original.name} ↔ Generated ${state.cadFiles.generated.name}`;
  const rows = filteredCadCompareRows();
  const pages = Math.max(1, Math.ceil(rows.length / state.cadCompare.pageSize));
  state.cadCompare.page = Math.max(1, Math.min(pages, state.cadCompare.page));
  const start = (state.cadCompare.page - 1) * state.cadCompare.pageSize;
  const shown = rows.slice(start, start + state.cadCompare.pageSize);
  for (const item of shown) {
    const tr = document.createElement('tr');
    if (state.cadCompare.selectedRow === item) tr.classList.add('active');
    const values = [
      item.originalComponentName || item.generatedComponentName || '—', item.originalGlobalId ?? '—', item.originalName || '—',
      item.generatedGlobalId ?? '—', item.generatedName || '—', item.distance == null ? '—' : formatFloat.format(item.distance), item.landMethod,
    ];
    for (const value of values) { const td = document.createElement('td'); td.textContent = String(value); tr.append(td); }
    const statusTd = document.createElement('td'); const badge = document.createElement('span'); badge.className = `cad-compare-status ${item.status}`; badge.textContent = cadCompareStatusLabel(item.status); statusTd.append(badge); tr.append(statusTd);
    const actionTd = document.createElement('td'); const button = document.createElement('button'); button.type = 'button'; button.className = 'compare-locate-button'; button.textContent = 'ดู'; button.disabled = item.originalGlobalId == null && item.generatedGlobalId == null; button.addEventListener('click', () => locateCadCompareRow(item)); actionTd.append(button); tr.append(actionTd);
    tr.addEventListener('dblclick', () => locateCadCompareRow(item));
    els.cadCompareTableBody.append(tr);
  }
  if (!shown.length) { const tr = document.createElement('tr'); const td = document.createElement('td'); td.colSpan = 9; td.className = 'empty-state'; td.textContent = 'ไม่พบรายการตามตัวกรอง'; tr.append(td); els.cadCompareTableBody.append(tr); }
  els.cadCompareTableSummary.textContent = `${formatInt.format(rows.length)} รายการ · แสดง ${rows.length ? formatInt.format(start + 1) : 0}–${formatInt.format(Math.min(start + shown.length, rows.length))}`;
  els.cadComparePageLabel.textContent = `${state.cadCompare.page} / ${pages}`;
  els.cadComparePrevPage.disabled = state.cadCompare.page <= 1; els.cadCompareNextPage.disabled = state.cadCompare.page >= pages;
}
function openCadCompare() {
  if (!canCompareCad()) return toast('กรุณาอัปโหลด Original CAD และ Generated CAD ก่อน');
  if (!state.cadCompare.result) rebuildCadComparison();
  els.cadCompareTolerance.value = state.cadCompare.tolerance;
  els.cadCompareFilter.value = state.cadCompare.filter; els.cadCompareSearch.value = state.cadCompare.search;
  renderCadCompare(); els.cadCompareOverlay.classList.remove('hidden');
}
function closeCadCompare() { els.cadCompareOverlay.classList.add('hidden'); }
function locateCadCompareRow(row) {
  state.cadCompare.selectedRow = row; state.cadCompare.overlayEnabled = true; updateCadCompareControls();
  const role = row.originalGlobalId != null ? 'original' : 'generated';
  activateCad(role, { rebuild: true, fit: false });
  const componentId = role === 'original' ? row.originalComponentId : row.generatedComponentId;
  if (componentId != null) {
    const targetComponent = state.xmlData?.componentById.get(String(componentId));
    let option = [...els.componentSelect.options].find((candidate) => candidate.value === String(componentId));
    if (!option && targetComponent) {
      option = document.createElement('option'); option.value = String(componentId);
      option.textContent = `${targetComponent.name || `ID ${targetComponent.id}`} · CAD Compare · ${formatInt.format(targetComponent.lands.length)} lands`;
      els.componentSelect.append(option);
    }
    state.selectedComponentId = String(componentId); els.componentSelect.value = String(componentId); refreshDuplicateControls();
  }
  const component = currentComponent();
  const globalId = role === 'original' ? row.originalGlobalId : row.generatedGlobalId;
  const land = component?.lands.find((candidate) => Number(candidate.globalId) === Number(globalId));
  if (land) selectLand(land);
  fitCadCompareRow(row); renderCadCompare(); closeCadCompare();
}
function fitCadCompareRow(row = state.cadCompare.selectedRow) {
  if (!row) return toast('เลือกรายการที่ต้องการดูก่อน');
  const lands = [];
  if (Number.isFinite(Number(row.originalX)) && Number.isFinite(Number(row.originalY))) lands.push({ centerX: Number(row.originalX), centerY: Number(row.originalY) });
  if (Number.isFinite(Number(row.generatedX)) && Number.isFinite(Number(row.generatedY))) lands.push({ centerX: Number(row.generatedX), centerY: Number(row.generatedY) });
  fitLands(lands, 1.5);
}
function exportCadComparison() {
  if (!state.cadCompare.result) return;
  const original = (state.cadFiles.original?.name || 'original').replace(/\.xml$/i, '');
  const generated = (state.cadFiles.generated?.name || 'generated').replace(/\.xml$/i, '');
  downloadBlob(new Blob(['\ufeff', cadComparisonToCsv(state.cadCompare.result)], { type: 'text/csv;charset=utf-8' }), `${original}_to_${generated}_mapping.csv`);
}


function isVerifiedMapping(mapping) {
  if (!mapping) return false;
  return Boolean(mapping.verified || (mapping.anchorLocked && mapping.manual && ['manual-anchor', 'manual-direct', 'restored-confirmed'].includes(String(mapping.mappingMethod || ''))));
}
function isUnsafeGeneratedMapping(mapping) {
  const method = String(mapping?.mappingMethod || '');
  return method.startsWith('taught-') || method === 'manual-swap' || method === 'pattern-suggestion';
}
function updateEditPanel() {
  const enabled = Boolean(state.edit.enabled);
  state.manualMode = enabled;
  els.manualBanner.classList.toggle('hidden', !enabled);
  els.manualButton.classList.toggle('edit-active', enabled);
  els.manualButton.textContent = enabled ? 'ออกจาก Edit' : 'โหมด Edit';
  els.editAutoNext.checked = state.edit.autoNext;
  els.editLockConfirmed.checked = state.edit.lockConfirmed;
  const mapping = state.selected;
  els.editCurrentLabel.textContent = mapping
    ? `กำลังแก้ X-ray ${mapping.localIndex} · ปัจจุบัน ${mapping.cadName || 'Unmapped'}`
    : 'เลือก X-ray Land จากตารางหรือค้นหา';
  els.editPrevButton.disabled = !enabled || !mapping;
  els.editNextButton.disabled = !enabled || !mapping;
  els.canvas.style.cursor = enabled ? 'crosshair' : '';
  if (enabled) els.manualBanner.classList.remove('preview-active');
}
function setEditMode(enabled) {
  state.edit.enabled = Boolean(enabled);
  updateEditPanel();
  draw();
}
function advanceSelected(delta) {
  const mappings = currentMappings().slice().sort((a, b) => mappingOrder(a) - mappingOrder(b));
  if (!mappings.length) return;
  let index = state.selected ? mappings.indexOf(state.selected) : -1;
  index = Math.max(0, Math.min(mappings.length - 1, index + delta));
  selectMapping(mappings[index], false);
  updateEditPanel();
}

let appConfirmPending = null;
function closeAppConfirm(result = false) {
  const pending = appConfirmPending;
  appConfirmPending = null;
  els.appConfirmOverlay?.classList.add('hidden');
  document.body.classList.remove('app-confirm-open');
  if (els.appConfirmAccept) els.appConfirmAccept.disabled = false;
  if (els.appConfirmCancel) els.appConfirmCancel.disabled = false;
  pending?.resolve?.(Boolean(result));
}
function requestAppConfirm({ title = 'ยืนยันการทำรายการ', message = '', detail = '', confirmText = 'Yes - ยืนยัน', cancelText = 'ยกเลิก', destructive = false } = {}) {
  if (!els.appConfirmOverlay) return Promise.resolve(false);
  if (appConfirmPending) closeAppConfirm(false);
  els.appConfirmTitle.textContent = title;
  els.appConfirmMessage.textContent = message;
  els.appConfirmDetail.textContent = detail || '';
  els.appConfirmDetail.classList.toggle('hidden', !detail);
  els.appConfirmAccept.textContent = confirmText;
  els.appConfirmCancel.textContent = cancelText;
  els.appConfirmAccept.classList.toggle('danger', Boolean(destructive));
  els.appConfirmOverlay.classList.remove('hidden');
  document.body.classList.add('app-confirm-open');
  requestAnimationFrame(() => els.appConfirmAccept?.focus());
  return new Promise((resolve) => { appConfirmPending = { resolve }; });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function toast(message, timeout = 2800) {
  els.toast.textContent = message;
  els.toast.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => els.toast.classList.add('hidden'), timeout);
}
let currentDiagnosticReport = null;
function closeGlobalError() {
  els.globalErrorOverlay?.classList.add('hidden');
  document.body.classList.remove('global-error-open');
  currentDiagnosticReport = null;
}
function showGlobalError(error, context = {}) {
  const file = activeCadFile();
  currentDiagnosticReport = createDiagnosticReport(error, {
    appVersion: '0.20.0', schemaVersion: file?.projectSession?.project?.schemaVersion || 2,
    projectId: file?.projectSession?.project?.projectId || '', revision: projectRevision(file),
    fileName: context.fileName || error?.fileName || file?.name || '', metrics: state.diagnostics?.snapshot?.() || [], ...context,
  });
  const diagnostic = currentDiagnosticReport.error || {};
  els.globalErrorTitle.textContent = context.title || 'ไม่สามารถดำเนินการได้';
  els.globalErrorCode.textContent = diagnostic.code || 'UNEXPECTED_ERROR';
  els.globalErrorStage.textContent = diagnostic.stage || context.operation || 'unknown';
  els.globalErrorFile.textContent = diagnostic.fileName || context.fileName || '—';
  els.globalErrorMessage.textContent = diagnostic.message || String(error);
  els.globalErrorRemediation.textContent = diagnostic.remediation || 'ตรวจรายละเอียดแล้วลองใหม่';
  els.globalErrorTechnical.textContent = diagnostic.technicalDetail || 'ไม่มีรายละเอียดเพิ่มเติม';
  els.globalErrorOverlay?.classList.remove('hidden');
  document.body.classList.add('global-error-open');
  requestAnimationFrame(() => els.globalErrorClose?.focus());
}
async function copyCurrentDiagnostic() {
  if (!currentDiagnosticReport) return;
  const text = diagnosticText(currentDiagnosticReport);
  try { await navigator.clipboard.writeText(text); toast('คัดลอก Diagnostic แล้ว'); }
  catch { toast('Browser ไม่อนุญาตให้คัดลอก Diagnostic', 4200); }
}
function downloadCurrentDiagnostic() {
  if (!currentDiagnosticReport) return;
  const stamp = currentDiagnosticReport.createdAt.replace(/[:.]/g, '-');
  downloadBlob(new Blob([diagnosticText(currentDiagnosticReport)], { type: 'application/json;charset=utf-8' }), safeDownloadName(`universal-cad-diagnostic-${stamp}.json`));
}

function setLoading(active, message = '') {
  els.progressWrap.classList.toggle('hidden', !active);
  if (message) els.importMessage.textContent = message;
  document.body.style.cursor = active ? 'progress' : '';
}
function nextFrame() { return new Promise((resolve) => requestAnimationFrame(resolve)); }
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}


function jsonBackupReplacer(_key, value) {
  if (value instanceof Map) return { __cadType: 'Map', entries: [...value.entries()] };
  if (value instanceof Set) return { __cadType: 'Set', values: [...value.values()] };
  if (value instanceof Uint8Array) return { __cadType: 'Uint8Array', values: Array.from(value) };
  return value;
}
function jsonBackupReviver(_key, value) {
  if (value?.__cadType === 'Map') return new Map(value.entries || []);
  if (value?.__cadType === 'Set') return new Set(value.values || []);
  if (value?.__cadType === 'Uint8Array') return new Uint8Array(value.values || []);
  return value;
}
function mappingWorkspaceSnapshot() {
  return (state.mappingData?.mappings || [])
    .filter((mapping) => mapping.manual || mapping.anchorLocked || mapping.alias || mapping.mappingHistory?.length || mapping.mappingMethod === 'manual-unmapped')
    .map((mapping) => ({
      sourceRow: mapping.sourceRow, sourceRecordId: mapping.sourceRecordId, componentName: mapping.componentName,
      rawLandId: mapping.rawLandId, localIndex: mapping.localIndex, componentId: mapping.componentId,
      globalId: mapping.globalId, cadName: mapping.cadName, mapped: mapping.mapped, manual: mapping.manual,
      verified: mapping.verified, anchorLocked: mapping.anchorLocked, alias: mapping.alias || '', confidence: mapping.confidence,
      mappingMethod: mapping.mappingMethod, manualReason: mapping.manualReason || '', mappingHistory: mapping.mappingHistory || [],
      previousMapping: mapping.previousMapping || null,
    }));
}
function projectWorkspaceSnapshot() {
  return {
    workspaceSchemaVersion: 1,
    activeCadRole: state.activeCadRole || 'original',
    fileNames: { ...state.fileNames },
    xlsxData: state.xlsxData || null,
    schema: state.schema ? { componentCol: state.schema.componentCol, packageCol: state.schema.packageCol, landCol: state.schema.landCol, landMode: state.schema.landMode, measurementCol: state.schema.measurementCol } : null,
    mappingOverrides: mappingWorkspaceSnapshot(),
    cadNameRules: { maxLength: state.cadInspector.maxLength, prefix: state.cadInspector.prefix, overflowMode: state.cadInspector.overflowMode, duplicateMode: state.cadInspector.duplicateMode, duplicateCharacter: state.cadInspector.duplicateCharacter },
    savedDiagnostics: state.diagnostics.snapshot(),
  };
}
const autosaveController = createAutosaveController(async ({ session, workspace }) => {
  const record = createProjectStorageRecord(session, workspace);
  await saveProjectRecord(record);
  state.recoveryRecord = record;
  await refreshRecoveryNotice();
  return record;
}, 1400, (error) => showGlobalError(error, { title: 'Autosave ไม่สำเร็จ', operation: 'autosave-background' }));
function scheduleProjectAutosave(file = activeCadFile()) {
  const session = ensureProjectSession(file);
  if (!session?.project?.recovery?.complete) return false;
  autosaveController.schedule({ session, workspace: projectWorkspaceSnapshot() });
  return true;
}
function formatBytes(value) {
  if (value == null || !Number.isFinite(Number(value))) return 'ไม่ทราบ';
  const units = ['B', 'KB', 'MB', 'GB']; let amount = Number(value); let index = 0;
  while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index += 1; }
  return `${amount.toLocaleString('th-TH', { maximumFractionDigits: index ? 1 : 0 })} ${units[index]}`;
}
async function refreshRecoveryNotice() {
  if (!globalThis.indexedDB) { els.recoveryButton.disabled = true; return []; }
  try {
    const records = await listProjectRecords();
    const currentId = activeCadFile()?.projectSession?.project?.projectId;
    state.recoveryRecord = records.find((record) => record.id !== currentId) || records[0] || null;
    els.recoveryButton.disabled = !state.recoveryRecord;
    els.recoveryButton.classList.toggle('recovery-ready', Boolean(state.recoveryRecord));
    els.recoveryButton.textContent = state.recoveryRecord ? `กู้คืน Autosave · R${state.recoveryRecord.revision}` : 'กู้คืน Autosave';
    return records;
  } catch (error) {
    console.warn('Recovery list unavailable', error);
    els.recoveryButton.disabled = true;
    return [];
  }
}
function projectTextFromSession(session, legacy) {
  const modelText = session?.project?.currentModel?.metadata?.workingXml;
  const sourceText = session?.project?.sourceFiles?.find((item) => item.text)?.text;
  if (modelText || sourceText) return String(modelText || sourceText);
  return serializeCadEditorModelStandalone(createCadEditorModel(legacy));
}
async function restoreStoredProject(recordOrPayload, { announce = true } = {}) {
  const payload = recordOrPayload?.project ? { project: recordOrPayload.project } : recordOrPayload;
  const workspace = recordOrPayload?.workspace || recordOrPayload?.projectWorkspace || {};
  const session = importProjectBackup(payload);
  const legacy = currentProjectLegacyCad(session);
  if (!legacy?.components) throw new Error('Project Backup ไม่มี Applied CAD Revision ที่กู้คืนได้');
  const workingXml = projectTextFromSession(session, legacy);
  const project = session.project;
  const source = session.originalSource || project.sourceFiles?.[0] || null;
  const role = workspace.activeCadRole === 'generated' ? 'generated' : 'original';
  resetProject();
  state.xlsxData = workspace.xlsxData || null;
  state.xlsxBuffer = null;
  state.fileNames = { xml: '', generatedXml: '', xlsx: '', ...(workspace.fileNames || {}) };
  state.mappingData = Array.isArray(workspace.mappingOverrides) ? { mappings: workspace.mappingOverrides } : null;
  const editorModel = createCadEditorModel(legacy);
  editorModel.changed = false;
  state.cadFiles[role] = {
    role, name: project.name || source?.name || 'Recovered CAD', sourceFormat: source?.format || project.currentModel?.sourceFormat || 'inspection-xml',
    text: source?.text || workingXml, originalSource: source, projectSession: session,
    editedText: workingXml, data: legacy, renames: new Map(), archive: null, editorModel,
    appliedEditorSnapshot: cloneCadEditorModel(editorModel), mappingDirty: false, viewerDirty: false,
    editRevision: Number(project.appliedRevision || 0), lastValidation: { issues: project.currentModel?.validationIssues || [] },
  };
  if (workspace.cadNameRules) Object.assign(state.cadInspector, workspace.cadNameRules);
  if (role === 'generated') state.fileNames.generatedXml = state.cadFiles[role].name;
  activateCad(role, { rebuild: true, fit: true });
  syncCadFileLabels();
  els.importMessage.textContent = `กู้คืน Project ${project.name} · Revision ${project.appliedRevision} สำเร็จ`;
  scheduleProjectAutosave(state.cadFiles[role]);
  if (announce) toast(`กู้คืน Project Revision ${project.appliedRevision} สำเร็จ`, 4800);
  return state.cadFiles[role];
}
function exportFullProjectBackup() {
  try {
    const file = activeCadFile(); const session = ensureProjectSession(file);
    if (!session) throw new Error('ยังไม่มี Project สำหรับ Backup');
    const payload = JSON.parse(exportProjectBackup(session));
    payload.appVersion = '0.20.0'; payload.projectWorkspace = projectWorkspaceSnapshot();
    payload.exportedAt = new Date().toISOString();
    const content = JSON.stringify(payload, jsonBackupReplacer, 2);
    downloadBlob(new Blob([content], { type: 'application/json;charset=utf-8' }), safeDownloadName(`${session.project.name || 'cad-project'}-r${session.project.appliedRevision}-backup-v0.20.0.json`));
    toast(`Export Project Backup Revision ${session.project.appliedRevision} สำเร็จ`);
  } catch (error) { showGlobalError(error, { title: 'Export Project Backup ไม่สำเร็จ', operation: 'project-backup-export' }); }
}
function closeStorageManager() { els.storageOverlay.classList.add('hidden'); }
async function renderStorageManager() {
  const [records, usage] = await Promise.all([listProjectRecords(), storageUsage()]);
  els.storageUsageText.textContent = usage.usage == null ? 'Browser ไม่รายงาน Storage Quota' : `ใช้ ${formatBytes(usage.usage)} จาก ${formatBytes(usage.quota)}${usage.percent == null ? '' : ` (${usage.percent.toFixed(1)}%)`}`;
  els.storageProjectCount.textContent = `${formatInt.format(records.length)} Project`;
  els.storageProjectList.innerHTML = '';
  if (!records.length) { const empty = document.createElement('div'); empty.className = 'storage-empty'; empty.textContent = 'ยังไม่มี Autosave ที่สมบูรณ์'; els.storageProjectList.append(empty); return; }
  for (const record of records) {
    const row = document.createElement('div'); row.className = 'storage-project-row'; row.dataset.projectId = record.id;
    const meta = document.createElement('div'); meta.className = 'storage-project-meta';
    const title = document.createElement('strong'); title.textContent = record.name;
    const detail = document.createElement('small'); detail.textContent = `Revision ${record.revision} · ${new Date(record.updatedAt).toLocaleString('th-TH')} · Schema ${record.schemaVersion}`;
    meta.append(title, detail);
    const actions = document.createElement('div'); actions.className = 'storage-project-actions';
    for (const [action, label] of [['restore','กู้คืน'],['duplicate','Duplicate'],['delete','ลบ']]) { const button = document.createElement('button'); button.type = 'button'; button.dataset.storageAction = action; button.textContent = label; if (action === 'restore') button.className = 'primary'; actions.append(button); }
    row.append(meta, actions); els.storageProjectList.append(row);
  }
}
async function openStorageManager() { els.storageOverlay.classList.remove('hidden'); await renderStorageManager(); els.storageCloseButton.focus(); }
async function handleStorageAction(event) {
  const button = event.target.closest('[data-storage-action]'); if (!button) return;
  const row = button.closest('[data-project-id]'); const id = row?.dataset.projectId; if (!id) return;
  button.disabled = true;
  try {
    if (button.dataset.storageAction === 'restore') { const record = await loadProjectRecord(id); if (record) { await restoreStoredProject(record); closeStorageManager(); } }
    else if (button.dataset.storageAction === 'duplicate') { await duplicateProjectRecord(id); await renderStorageManager(); await refreshRecoveryNotice(); toast('Duplicate Project สำเร็จ'); }
    else if (button.dataset.storageAction === 'delete') {
      const accepted = await requestAppConfirm({ title: 'ลบ Project ที่บันทึกไว้?', message: 'การลบนี้ลบเฉพาะ Autosave ใน Browser และไม่ลบไฟล์ต้นฉบับบนอุปกรณ์', confirmText: 'Yes - ลบ Project' });
      if (accepted) { await deleteProjectRecord(id); await renderStorageManager(); await refreshRecoveryNotice(); toast('ลบ Project ที่บันทึกไว้แล้ว'); }
    }
  } catch (error) { showGlobalError(error, { title: 'จัดการ Project ไม่สำเร็จ', operation: `storage-${button.dataset.storageAction}` }); }
  finally { button.disabled = false; }
}

function cadInspectorComponentIds(scope = state.cadInspector.scope) {
  if (scope === 'all') return null;
  if (scope === 'current') return state.selectedComponentId == null || isBoardView() ? null : new Set([String(state.selectedComponentId)]);
  const ids = (state.mappingData?.componentSummaries || [])
    .filter((summary) => summary.componentId != null)
    .map((summary) => String(summary.componentId));
  return new Set(ids);
}
function buildCurrentCadAudit(scope = state.cadInspector.scope) {
  return buildCadNameAudit(state.xmlData, state.cadInspector.renames, {
    maxLength: state.cadInspector.maxLength,
    componentIds: cadInspectorComponentIds(scope),
  });
}
function cadIssueLabel(issue) {
  return ({ duplicate: 'ชื่อซ้ำ', 'too-long': 'เกินความยาว', blank: 'ชื่อว่าง' })[issue] || issue;
}
function cadInspectorFilteredItems(audit) {
  const filter = state.cadInspector.filter;
  const search = state.cadInspector.search.trim().toLowerCase();
  return audit.items.filter((item) => {
    if (filter === 'issues' && item.valid) return false;
    if (filter === 'duplicate' && !item.issues.includes('duplicate')) return false;
    if (filter === 'too-long' && !item.issues.includes('too-long')) return false;
    if (filter === 'blank' && !item.issues.includes('blank')) return false;
    if (filter === 'changed' && !item.changed) return false;
    if (filter === 'valid' && !item.valid) return false;
    if (!search) return true;
    return [item.componentName, item.packageName, item.globalId, item.localIndex, item.originalName, item.proposedName]
      .some((value) => String(value ?? '').toLowerCase().includes(search));
  });
}
function renderCadInspectorTable() {
  const audit = state.cadInspector.audit || buildCurrentCadAudit();
  const items = cadInspectorFilteredItems(audit);
  const pages = Math.max(1, Math.ceil(items.length / state.cadInspector.pageSize));
  state.cadInspector.page = Math.max(1, Math.min(pages, state.cadInspector.page));
  const start = (state.cadInspector.page - 1) * state.cadInspector.pageSize;
  const shown = items.slice(start, start + state.cadInspector.pageSize);
  els.cadInspectorTableBody.innerHTML = '';

  for (const item of shown) {
    const row = document.createElement('tr');
    row.className = item.valid ? 'cad-valid-row' : 'cad-invalid-row';
    const componentCell = document.createElement('td');
    const componentName = document.createElement('strong'); componentName.textContent = item.componentName;
    const componentMeta = document.createElement('small'); componentMeta.textContent = item.packageName || '—';
    componentCell.append(componentName, document.createElement('br'), componentMeta);
    const localCell = document.createElement('td'); localCell.textContent = item.localIndex ?? '—';
    const idCell = document.createElement('td'); idCell.textContent = item.globalId ?? '—';
    const originalCell = document.createElement('td'); originalCell.className = 'cad-name-original'; originalCell.textContent = item.originalName || '(ว่าง)';
    const finalCell = document.createElement('td');
    const input = document.createElement('input'); input.className = `cad-name-input${item.valid ? '' : ' invalid'}`; input.value = item.proposedName; input.dataset.key = item.key; input.autocomplete = 'off'; input.spellcheck = false;
    input.addEventListener('change', () => {
      const value = normalizeCadName(input.value).toUpperCase();
      if (value === item.originalName) state.cadInspector.renames.delete(item.key);
      else state.cadInspector.renames.set(item.key, value);
      applyCadNamesToProject({ silent: true });
      refreshCadInspector();
    });
    finalCell.append(input);
    const lengthCell = document.createElement('td'); lengthCell.textContent = `${item.length}/${state.cadInspector.maxLength}`;
    const issueCell = document.createElement('td'); const issueList = document.createElement('div'); issueList.className = 'cad-issue-list';
    if (item.valid) { const chip = document.createElement('span'); chip.className = 'cad-issue-chip ok'; chip.textContent = item.changed ? 'ผ่าน' : 'ปกติ'; issueList.append(chip); }
    for (const issue of item.issues) { const chip = document.createElement('span'); chip.className = `cad-issue-chip ${issue}`; chip.textContent = cadIssueLabel(issue); issueList.append(chip); }
    if (item.changed) { const chip = document.createElement('span'); chip.className = 'cad-issue-chip changed'; chip.textContent = 'แก้แล้ว'; issueList.append(chip); }
    issueCell.append(issueList);
    const actionCell = document.createElement('td'); const locate = document.createElement('button'); locate.type = 'button'; locate.className = 'cad-row-action'; locate.textContent = 'ดูตำแหน่ง'; locate.addEventListener('click', () => locateCadAuditItem(item)); actionCell.append(locate);
    row.append(componentCell, localCell, idCell, originalCell, finalCell, lengthCell, issueCell, actionCell);
    els.cadInspectorTableBody.append(row);
  }

  if (!shown.length) {
    const row = document.createElement('tr'); const cell = document.createElement('td'); cell.colSpan = 8; cell.className = 'empty-state'; cell.textContent = 'ไม่พบรายการตามตัวกรอง'; row.append(cell); els.cadInspectorTableBody.append(row);
  }
  els.cadInspectorTableSummary.textContent = `${formatInt.format(items.length)} รายการ · แสดง ${items.length ? formatInt.format(start + 1) : 0}–${formatInt.format(Math.min(start + shown.length, items.length))}`;
  els.cadInspectorPageLabel.textContent = `${state.cadInspector.page} / ${pages}`;
  els.cadInspectorPrevPage.disabled = state.cadInspector.page <= 1;
  els.cadInspectorNextPage.disabled = state.cadInspector.page >= pages;
}
function cadRulePreviewText() {
  const maxLength = state.cadInspector.maxLength;
  const overflowExample = 'ABCDEFG';
  const chars = [...overflowExample];
  const trimmed = state.cadInspector.overflowMode === 'keep-end'
    ? chars.slice(-maxLength).join('')
    : state.cadInspector.overflowMode === 'regenerate'
      ? 'A1'
      : chars.slice(0, maxLength).join('');
  const duplicateBase = 'AB_CD';
  let duplicateExample;
  if (state.cadInspector.duplicateMode === 'regenerate') duplicateExample = 'A1';
  else if (state.cadInspector.duplicateMode === 'suffix') duplicateExample = `${duplicateBase.slice(0, Math.max(0, maxLength - 1))}1`.slice(0, maxLength);
  else duplicateExample = duplicateBase.includes(state.cadInspector.duplicateCharacter)
    ? duplicateBase.replace(state.cadInspector.duplicateCharacter, '1').slice(0, maxLength)
    : `${duplicateBase.slice(0, Math.max(0, maxLength - 1))}1`.slice(0, maxLength);
  return `${overflowExample} → ${trimmed} · ${duplicateBase}, ${duplicateBase} → ${duplicateBase}, ${duplicateExample}`;
}
function updateCadRuleControls() {
  const usesCharacter = state.cadInspector.duplicateMode === 'replace-character';
  els.cadDuplicateCharacter.disabled = !usesCharacter;
  const span = els.cadRulePreview?.querySelector('span');
  if (span) span.textContent = cadRulePreviewText();
}
function refreshCadInspector() {
  if (!state.xmlData) return;
  state.cadInspector.maxLength = Math.max(2, Number(els.cadMaxLength.value) || 5);
  state.cadInspector.prefix = String(els.cadNamePrefix.value || 'A').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, Math.max(1, state.cadInspector.maxLength - 1)) || 'A';
  els.cadNamePrefix.value = state.cadInspector.prefix;
  state.cadInspector.overflowMode = els.cadOverflowMode.value || 'keep-start';
  state.cadInspector.duplicateMode = els.cadDuplicateMode.value || 'replace-character';
  state.cadInspector.duplicateCharacter = [...String(els.cadDuplicateCharacter.value || '_')][0] || '_';
  els.cadDuplicateCharacter.value = state.cadInspector.duplicateCharacter;
  state.cadInspector.scope = els.cadInspectorScope.value;
  state.cadInspector.filter = els.cadIssueFilter.value;
  state.cadInspector.search = els.cadInspectorSearch.value;
  const audit = buildCurrentCadAudit(); state.cadInspector.audit = audit;
  const summary = audit.summary;
  els.cadAuditTotal.textContent = formatInt.format(summary.total);
  els.cadAuditValid.textContent = formatInt.format(summary.valid);
  els.cadAuditUnresolved.textContent = formatInt.format(summary.unresolved);
  els.cadAuditDuplicateGroups.textContent = formatInt.format(summary.duplicateGroups);
  els.cadAuditDuplicateLands.textContent = formatInt.format(summary.duplicateLands);
  els.cadAuditTooLong.textContent = formatInt.format(summary.tooLong);
  els.cadAuditBlank.textContent = formatInt.format(summary.blank);
  els.cadAuditChanged.textContent = formatInt.format(summary.changed);
  const fullAudit = buildCurrentCadAudit('all');
  els.cadExportXmlButton.disabled = fullAudit.summary.unresolved > 0;
  els.cadExportXmlButton.title = fullAudit.summary.unresolved ? `ยังมีชื่อไม่ผ่าน ${fullAudit.summary.unresolved} จุดใน CAD` : 'พร้อมส่งออก XML';
  els.cadApplyNamesButton.disabled = state.cadInspector.renames.size === 0;
  els.cadResetNamesButton.disabled = state.cadInspector.renames.size === 0;
  els.cadInspectorMessage.textContent = fullAudit.summary.unresolved
    ? `ขอบเขตนี้ยังมีปัญหา ${formatInt.format(summary.unresolved)} จุด · ทั้ง CAD ยังไม่ผ่าน ${formatInt.format(fullAudit.summary.unresolved)} จุด จึงยัง Export XML ไม่ได้`
    : `CAD ผ่านการตรวจทั้งหมดแล้ว · ชื่อไม่ซ้ำภายใน Component และยาวไม่เกิน ${state.cadInspector.maxLength} ตัวอักษร`;
  updateCadRuleControls();
  renderCadInspectorTable();
}
function openCadInspector() {
  if (!state.xmlData) return toast('กรุณานำเข้า CAD XML ก่อน');
  els.cadInspectorScope.value = state.cadInspector.scope;
  els.cadMaxLength.value = state.cadInspector.maxLength;
  els.cadOverflowMode.value = state.cadInspector.overflowMode;
  els.cadDuplicateMode.value = state.cadInspector.duplicateMode;
  els.cadDuplicateCharacter.value = state.cadInspector.duplicateCharacter;
  els.cadNamePrefix.value = state.cadInspector.prefix;
  els.cadIssueFilter.value = state.cadInspector.filter;
  els.cadInspectorSearch.value = state.cadInspector.search;
  state.cadInspector.page = 1;
  els.cadInspectorOverlay.classList.remove('hidden');
  refreshCadInspector();
}
function closeCadInspector() { els.cadInspectorOverlay.classList.add('hidden'); }
async function generateCadNames(renameAll = false) {
  if (!state.xmlData) return;
  if (renameAll && !(await requestAppConfirm({ title: 'สร้างชื่อ Land ใหม่ทั้งหมด?', message: 'ชื่อเดิมจะยังอยู่ใน Immutable Source และจะเปลี่ยนเฉพาะ Working Model จนกว่าจะ Apply/Export', detail: `ขอบเขต: ${state.cadInspector.scope}`, confirmText: 'Yes - สร้างชื่อใหม่' }))) return;
  try {
    const result = generateCadRenames(state.xmlData, state.cadInspector.renames, {
      maxLength: state.cadInspector.maxLength,
      prefix: state.cadInspector.prefix,
      overflowMode: state.cadInspector.overflowMode,
      duplicateMode: state.cadInspector.duplicateMode,
      duplicateCharacter: state.cadInspector.duplicateCharacter,
      renameAll,
      componentIds: cadInspectorComponentIds(),
    });
    state.cadInspector.renames = result.renames;
    state.cadInspector.page = 1;
    applyCadNamesToProject({ silent: true });
    refreshCadInspector();
    toast(`สร้างชื่อที่ไม่ซ้ำและซิงก์กับ Viewer แล้ว ${formatInt.format(result.generated)} จุด`);
  } catch (error) { toast(error.message, 5200); }
}
function syncCadNamesToEditorModel(file = activeCadFile()) {
  if (!file?.editorModel || !file?.data) return 0;
  const dataByComponent = new Map((file.data.components || []).map((component) => [String(component.id), component]));
  let changed = 0;
  for (const editorComponent of file.editorModel.components || []) {
    const sourceComponent = dataByComponent.get(String(editorComponent.originalId ?? editorComponent.id));
    if (!sourceComponent) continue;
    const sourceByGlobalId = new Map((sourceComponent.lands || []).map((land) => [String(land.globalId), land]));
    for (const editorLand of editorComponent.lands || []) {
      const sourceLand = sourceByGlobalId.get(String(editorLand.originalGlobalId ?? editorLand.globalId));
      if (!sourceLand) continue;
      const nextName = String(sourceLand.cadName ?? '');
      if (editorLand.cadName !== nextName) {
        editorLand.cadName = nextName;
        changed += 1;
      }
    }
  }
  return changed;
}
function applyCadNamesToProject({ silent = false } = {}) {
  if (!state.xmlData) return 0;
  const file = activeCadFile();
  const changedComponents = new Set();
  for (const component of state.xmlData.components) {
    for (const land of component.lands || []) {
      const key = cadLandKey(component.id, land.globalId);
      const original = land.originalCadName ?? land.cadName;
      if (state.cadInspector.renames.has(key)) {
        if (land.originalCadName == null) land.originalCadName = original;
        land.cadName = normalizeCadName(state.cadInspector.renames.get(key));
        changedComponents.add(component);
      } else if (land.originalCadName != null) {
        land.cadName = land.originalCadName;
        delete land.originalCadName;
        changedComponents.add(component);
      }
    }
  }
  for (const component of changedComponents) duplicateGroupCache.delete(component);
  if (state.mappingData) {
    for (const mapping of state.mappingData.mappings) {
      if (mapping.globalId == null || mapping.componentId == null) continue;
      const component = state.xmlData.componentById.get(String(mapping.componentId));
      const land = component?.lands.find((candidate) => Number(candidate.globalId) === Number(mapping.globalId));
      if (land) mapping.cadName = land.cadName;
    }
    for (const mapping of state.mappingData.mappings) {
      if (mapping.globalId == null || mapping.componentId == null) continue;
      const component = state.xmlData.componentById.get(String(mapping.componentId));
      const land = component?.lands.find((candidate) => Number(candidate.globalId) === Number(mapping.globalId));
      if (land) mapping.duplicateCadNameCount = duplicateCountForLand(land);
    }
  }
  if (file) {
    file.data = state.xmlData;
    file.renames = state.cadInspector.renames;
    syncCadNamesToEditorModel(file);
  }
  state.cadInspector.audit = null;
  saveActiveCadSession();
  if (canCompareCad()) rebuildCadComparison();
  refreshDuplicateControls(); renderTable(); draw(); updateStats();
  if (state.selected) selectMapping(state.selected, false);
  if (state.cadEditor.model && file?.editorModel === state.cadEditor.model) renderCadEditor();
  if (!silent) toast(`ซิงก์ชื่อใหม่กับหน้า Viewer แล้ว ${formatInt.format(state.cadInspector.renames.size)} จุด`);
  return changedComponents.size;
}
async function resetCadNames() {
  if (!state.cadInspector.renames.size) return;
  if (!(await requestAppConfirm({ title: 'คืนชื่อ CAD จากต้นฉบับ?', message: 'ชื่อที่แก้ใน Working Model จะถูกคืนค่า แต่ไฟล์ต้นฉบับยังไม่ถูกแก้ไข', confirmText: 'Yes - คืนชื่อเดิม', destructive: true }))) return;
  state.cadInspector.renames.clear();
  applyCadNamesToProject({ silent: true });
  state.cadInspector.page = 1; refreshCadInspector(); toast('คืนชื่อเดิมแล้ว');
}
function locateCadAuditItem(item) {
  const component = state.xmlData?.componentById.get(String(item.componentId));
  const land = component?.lands.find((candidate) => Number(candidate.globalId) === Number(item.globalId));
  if (!component || !land) return;
  let option = [...els.componentSelect.options].find((candidate) => candidate.value === String(component.id));
  if (!option) { option = document.createElement('option'); option.value = String(component.id); option.textContent = `${component.name} · CAD Inspector · ${formatInt.format(component.lands.length)} lands`; els.componentSelect.append(option); }
  state.selectedComponentId = String(component.id); els.componentSelect.value = String(component.id); state.duplicateView.selectedName = '';
  closeCadInspector(); refreshDuplicateControls(); fitView(); selectLand(land); toast(`ตำแหน่ง ${component.name} / XML ID ${item.globalId}`);
}
function exportCadAuditReport() {
  const audit = buildCurrentCadAudit();
  const board = state.xmlData?.board?.Name || 'cad';
  downloadBlob(new Blob(['\ufeff', cadAuditToCsv(audit)], { type: 'text/csv;charset=utf-8' }), `${board}_cad_name_audit.csv`);
}
function exportCorrectedCadXml() {
  if (!state.xmlData || !state.xmlText) return;
  const fullAudit = buildCurrentCadAudit('all');
  if (fullAudit.summary.unresolved) {
    state.cadInspector.scope = 'all'; state.cadInspector.filter = 'issues'; state.cadInspector.page = 1;
    els.cadInspectorScope.value = 'all'; els.cadIssueFilter.value = 'issues'; refreshCadInspector();
    return toast(`ยัง Export ไม่ได้: CAD มีชื่อไม่ผ่าน ${formatInt.format(fullAudit.summary.unresolved)} จุด`, 5200);
  }
  const output = rewriteCadXml(state.xmlText, state.cadInspector.renames);
  const original = state.fileNames.xml || 'cad.xml';
  const stem = original.replace(/\.xml$/i, '');
  downloadBlob(new Blob([output], { type: 'application/xml;charset=utf-8' }), `${stem}_cad_checked.xml`);
  toast(`Export CAD XML สำเร็จ · แก้ชื่อ ${formatInt.format(state.cadInspector.renames.size)} จุด`);
}

function isBoardView() { return state.selectedComponentId === BOARD_VIEW; }
function boardComponents() { return (state.xmlData?.components || []).filter((component) => component.lands?.length); }
function currentComponent() { return isBoardView() ? null : (state.xmlData?.componentById.get(String(state.selectedComponentId)) || null); }
function currentMappings() {
  if (!state.mappingData) return [];
  if (isBoardView()) return state.mappingData.mappings.slice();
  return state.mappingData.mappings.filter((mapping) => String(mapping.componentId) === String(state.selectedComponentId));
}
function visibleComponents() {
  const component = currentComponent();
  return component ? [component] : (isBoardView() ? boardComponents() : []);
}
function boardBounds() {
  const components = visibleComponents();
  const bounds = components.map((component) => component.bounds).filter(Boolean);
  if (!bounds.length) return null;
  return { minX: Math.min(...bounds.map((item) => item.minX)), maxX: Math.max(...bounds.map((item) => item.maxX)), minY: Math.min(...bounds.map((item) => item.minY)), maxY: Math.max(...bounds.map((item) => item.maxY)) };
}
function mappingKey(componentId, globalId) { return `${String(componentId ?? '')}\u0000${String(globalId ?? '')}`; }

function cadOnlyTableRow(component, land) {
  return {
    cadOnly: true, land, sourceRow: null, rawOrder: null, rawLandId: '', localIndex: null, cadLocalIndex: land.localIndex,
    componentName: component.name || `ID ${component.id}`, packageName: component.packageName || '', componentId: component.id,
    globalId: land.globalId, cadName: land.cadName || '', left: land.left, top: land.top, centerX: land.centerX, centerY: land.centerY,
    width: land.width, length: land.length, measurement: null, confidence: null, mapped: true, manual: false, verified: false,
    anchorLocked: false, mappingMethod: 'cad-only', duplicateCadNameCount: duplicateCountForLand(land), raw: null,
  };
}
function cadLocalIndexFor(mapping, component = currentComponent()) {
  if (mapping?.cadLocalIndex != null) return mapping.cadLocalIndex;
  const owner = component || (mapping?.componentId != null ? state.xmlData?.componentById.get(String(mapping.componentId)) : null);
  if (!owner || mapping?.globalId == null) return null;
  const land = owner.lands.find((item) => Number(item.globalId) === Number(mapping.globalId));
  return land?.localIndex ?? null;
}
function tableRowsForComponent(component) {
  const mappings = state.mappingData ? state.mappingData.mappings.filter((mapping) => String(mapping.componentId) === String(component.id)) : [];
  const byGlobal = new Map();
  for (const mapping of mappings) {
    if (!mapping.mapped || mapping.globalId == null) continue;
    const key = Number(mapping.globalId);
    if (!byGlobal.has(key)) byGlobal.set(key, []);
    byGlobal.get(key).push(mapping);
  }
  const rows = [];
  const included = new Set();
  for (const land of component.lands) {
    const matched = byGlobal.get(Number(land.globalId)) || [];
    if (matched.length) {
      for (const mapping of matched) { rows.push(mapping); included.add(mapping); }
    } else rows.push(cadOnlyTableRow(component, land));
  }
  for (const mapping of mappings) if (!included.has(mapping)) rows.push(mapping);
  return rows;
}
function currentTableRows() {
  if (isBoardView()) return boardComponents().flatMap((component) => tableRowsForComponent(component));
  const component = currentComponent();
  return component ? tableRowsForComponent(component) : [];
}

function mappingByGlobalId() {
  const map = new Map();
  for (const mapping of currentMappings()) if (mapping.globalId != null) map.set(Number(mapping.globalId), mapping);
  return map;
}
function duplicateCountForLand(land) {
  const component = state.xmlData?.componentById.get(String(land?.componentId));
  if (!component || !land?.cadName) return 1;
  return duplicateGroupsForComponent(component).get(String(land.cadName).trim())?.length || 1;
}
const duplicateGroupCache = new WeakMap();
function duplicateGroupsForComponent(component = currentComponent()) {
  if (!component) return new Map();
  const cached = duplicateGroupCache.get(component);
  if (cached) return cached;
  const all = new Map();
  for (const land of component.lands || []) {
    const name = String(land.cadName || '').trim();
    if (!name) continue;
    if (!all.has(name)) all.set(name, []);
    all.get(name).push(land);
  }
  const duplicates = new Map([...all].filter(([, lands]) => lands.length > 1).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })));
  duplicateGroupCache.set(component, duplicates);
  return duplicates;
}
function selectedDuplicateLands() {
  return duplicateGroupsForComponent().get(state.duplicateView.selectedName) || [];
}
function setSelectedDuplicateName(name, { fit = false, selectFirst = false } = {}) {
  const groups = duplicateGroupsForComponent();
  state.duplicateView.selectedName = groups.has(name) ? name : '';
  if (els.duplicateNameSelect) els.duplicateNameSelect.value = state.duplicateView.selectedName;
  renderDuplicatePanel();
  if (selectFirst && state.duplicateView.selectedName) {
    const first = groups.get(state.duplicateView.selectedName)?.[0];
    if (first) selectLand(first);
  }
  if (fit && state.duplicateView.selectedName) fitDuplicateGroup();
  else draw();
}
function refreshDuplicateControls() {
  const groups = duplicateGroupsForComponent();
  const current = groups.has(state.duplicateView.selectedName) ? state.duplicateView.selectedName : '';
  state.duplicateView.selectedName = current;
  els.duplicateNameSelect.innerHTML = '';
  const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = groups.size ? `— เลือกจาก ${formatInt.format(groups.size)} ชื่อซ้ำ —` : '— ไม่พบชื่อซ้ำ —'; els.duplicateNameSelect.append(placeholder);
  for (const [name, lands] of groups) { const option = document.createElement('option'); option.value = name; option.textContent = `${name} · ${formatInt.format(lands.length)} ตำแหน่ง`; els.duplicateNameSelect.append(option); }
  els.duplicateNameSelect.value = current;
  els.duplicateNameSelect.disabled = groups.size === 0;
  els.duplicateToggle.disabled = groups.size === 0;
  els.duplicateOnlyToggle.disabled = groups.size === 0 || !state.duplicateView.enabled;
  const duplicateLandCount = [...groups.values()].reduce((sum, lands) => sum + lands.length, 0);
  els.duplicateSummaryMini.textContent = groups.size ? `${formatInt.format(groups.size)} ชื่อซ้ำ · รวม ${formatInt.format(duplicateLandCount)} ตำแหน่งใน ${currentComponent()?.name || 'Part'}` : 'ไม่พบชื่อ CAD ซ้ำใน Part นี้';
  renderDuplicatePanel();
}
function renderDuplicatePanel() {
  const groups = duplicateGroupsForComponent();
  const name = state.duplicateView.selectedName;
  const lands = groups.get(name) || [];
  els.duplicateGroupCount.textContent = formatInt.format(groups.size);
  els.duplicatePositionList.innerHTML = '';
  els.fitDuplicateButton.disabled = lands.length === 0;
  els.clearDuplicateButton.disabled = lands.length === 0;
  if (!groups.size) {
    els.duplicatePanelMessage.textContent = 'ไม่พบชื่อ CAD ซ้ำใน Part ที่เลือก';
    els.duplicatePositionList.innerHTML = '<p class="empty-state">ไม่มีตำแหน่งซ้ำ</p>';
    return;
  }
  if (!lands.length) {
    els.duplicatePanelMessage.textContent = `พบ ${formatInt.format(groups.size)} ชื่อซ้ำ เลือก Land หรือชื่อจากเมนูด้านซ้ายเพื่อดูตำแหน่งทั้งหมด`;
    els.duplicatePositionList.innerHTML = '<p class="empty-state">ยังไม่ได้เลือกกลุ่มชื่อซ้ำ</p>';
    return;
  }
  els.duplicatePanelMessage.textContent = `${name} พบซ้ำ ${formatInt.format(lands.length)} ตำแหน่ง เส้นประบนกราฟิกเชื่อมตำแหน่งในกลุ่มเดียวกัน`;
  const byGlobal = mappingByGlobalId();
  lands.forEach((land, index) => {
    const mapping = byGlobal.get(Number(land.globalId));
    const button = document.createElement('button'); button.type = 'button'; button.className = 'duplicate-position-item';
    if (state.selected && Number(state.selected.globalId) === Number(land.globalId)) button.classList.add('active');
    const text = document.createElement('div'); const title = document.createElement('strong'); title.textContent = `${name} · XML ${land.globalId}`;
    const meta = document.createElement('span'); meta.textContent = `X ${formatFloat.format(land.centerX)} · Y ${formatFloat.format(land.centerY)}${mapping ? ` · X-ray ${mapping.localIndex}` : ' · ไม่มีข้อมูลดิบ'}`;
    text.append(title, meta); const badge = document.createElement('i'); badge.className = 'duplicate-position-index'; badge.textContent = String(index + 1); button.append(text, badge);
    button.addEventListener('click', () => { selectLand(land); centerOn(land.centerX, land.centerY); });
    els.duplicatePositionList.append(button);
  });
}
function normalizeMappings() {
  for (const mapping of state.mappingData?.mappings || []) {
    if (mapping.anchorLocked == null) mapping.anchorLocked = false;
    if (!mapping.mappingMethod) mapping.mappingMethod = mapping.mapped ? 'local-order-guess' : 'unmapped';
    if (mapping.alias == null) mapping.alias = '';
    mapping.verified = isVerifiedMapping(mapping);
    if (!mapping.verified && mapping.mapped && !mapping.mappingMethod) mapping.mappingMethod = 'local-order-guess';
    mapping.sourceRecordId ||= mapping.sourceRow != null ? `source-row:${mapping.sourceRow}` : `source:${mapping.componentName || ''}:${mapping.rawLandId ?? mapping.localIndex ?? ''}`;
    mapping.targetRecordId = mapping.mapped && mapping.globalId != null ? `cad-land:${mapping.componentId}:${mapping.globalId}` : null;
    mapping.matchScore = Number.isFinite(Number(mapping.matchScore)) ? Number(mapping.matchScore) : Number(mapping.confidence || 0) / 100;
    mapping.fieldComparison ||= { reference: mapping.componentName || '', land: mapping.rawLandId ?? mapping.localIndex ?? '', cadName: mapping.cadName || '' };
    mapping.userConfirmation = Boolean(mapping.manual && mapping.verified);
    mapping.mappingState = mapping.mappingConflict ? 'conflict' : (mapping.mappingMethod === 'ignored' ? 'ignored' : (mapping.manual && mapping.verified ? 'manual-match' : (mapping.verified ? 'confirmed-match' : (mapping.mapped ? 'suggested-match' : 'candidate-match'))));
    if (mapping.mappingConflict) mapping.matchStatus = 'conflict';
    else if (mapping.mappingMethod === 'ignored') mapping.matchStatus = 'ignored';
    else if (mapping.manual && mapping.verified) mapping.matchStatus = 'manually-confirmed';
    else if (!mapping.mapped) mapping.matchStatus = 'missing';
    else if (mapping.verified && ['exact-cad-name', 'exact-other-cad-name', 'xml-global-id'].includes(mapping.mappingMethod)) mapping.matchStatus = 'exact-match';
    else if (Number(mapping.confidence || 0) >= 85) mapping.matchStatus = 'strong-match';
    else mapping.matchStatus = 'possible-match';
    mapping.mappingHistory ||= [];
    mapping.revision = Number(mapping.revision ?? state.mappingData?.revision ?? projectRevision());
  }
  recomputeStats();
}
function recomputeStats() {
  if (!state.mappingData) return;
  const mappings = state.mappingData.mappings;
  state.mappingData.stats = {
    total: mappings.length,
    mapped: mappings.filter((m) => m.mapped).length,
    verified: mappings.filter(isVerifiedMapping).length,
    unverified: mappings.filter((m) => m.mapped && !isVerifiedMapping(m)).length,
    unmapped: mappings.filter((m) => !m.mapped).length,
    ambiguous: mappings.filter((m) => Number(m.ambiguityCount) > 1).length,
    exactCadName: mappings.filter((m) => m.mappingMethod === 'exact-cad-name').length,
    exactOtherCadName: mappings.filter((m) => m.mappingMethod === 'exact-other-cad-name').length,
    xmlGlobalId: mappings.filter((m) => m.mappingMethod === 'xml-global-id').length,
    localOrderGuess: mappings.filter((m) => m.mappingMethod === 'local-order-guess').length,
    duplicateCadNames: mappings.filter((m) => m.duplicateCadNameCount > 1).length,
    manual: mappings.filter((m) => m.manual).length,
    anchors: mappings.filter((m) => m.anchorLocked).length,
  };
}
function refreshHistoryButtons() {
  els.undoButton.disabled = state.undoStack.length === 0;
  els.redoButton.disabled = state.redoStack.length === 0;
  els.undoButton.title = state.undoStack.length ? state.undoStack[state.undoStack.length - 1].label : '';
  els.redoButton.title = state.redoStack.length ? state.redoStack[state.redoStack.length - 1].label : '';
}
function snapshotsEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function applyTransaction(label, changes, record = true) {
  const useful = changes.filter(({ before, after }) => !snapshotsEqual(before, after));
  if (!useful.length) return false;
  for (const change of useful) {
    const after = { ...change.after };
    if (record) {
      const audit = {
        action: label,
        timestamp: new Date().toISOString(),
        revision: projectRevision(),
        sourceRecordId: change.mapping.sourceRecordId || mappingIdentity(change.mapping),
        previousTargetRecordId: change.before?.globalId == null ? null : `cad-land:${change.before.componentId}:${change.before.globalId}`,
        targetRecordId: after.globalId == null ? null : `cad-land:${after.componentId}:${after.globalId}`,
        matchMethod: after.mappingMethod || '',
        matchScore: Number(after.confidence || 0) / 100,
        userConfirmation: Boolean(after.manual && after.verified),
        reason: String(after.manualReason || label),
      };
      after.mappingHistory = [...(change.before?.mappingHistory || change.mapping.mappingHistory || []), audit];
      if (after.manual) after.manualReason ||= label;
    }
    restoreMapping(change.mapping, after);
    change.after = after;
  }
  if (record) {
    state.undoStack.push({ label, changes: useful });
    if (state.undoStack.length > 24) state.undoStack.shift();
    state.redoStack = [];
  }
  state.preview = null;
  refreshAfterEdit();
  if (record) scheduleProjectAutosave();
  return true;
}
function undo() {
  const action = state.undoStack.pop(); if (!action) return;
  for (const change of action.changes) restoreMapping(change.mapping, change.before);
  state.redoStack.push(action); state.preview = null; refreshAfterEdit(); toast(`Undo: ${action.label}`);
}
function redo() {
  const action = state.redoStack.pop(); if (!action) return;
  for (const change of action.changes) restoreMapping(change.mapping, change.after);
  state.undoStack.push(action); state.preview = null; refreshAfterEdit(); toast(`Redo: ${action.label}`);
}
function refreshAfterEdit() {
  if (!state.preview && !state.manualMode) {
    els.manualBanner.classList.add('hidden');
    els.manualBanner.classList.remove('preview-active');
  }
  recomputeStats(); updateStats(); updateDetails(); updateEditPanel(); renderTable(); renderTeachPanel(); renderDuplicatePanel(); draw(); renderHistogram(); refreshHistoryButtons();
}

function columnOptionLabel(descriptor) {
  const header = descriptor.header ? String(descriptor.header) : 'ไม่มีหัวคอลัมน์';
  const sample = descriptor.sample !== '' ? `ตัวอย่าง ${String(descriptor.sample).slice(0, 28)}` : 'ไม่มีข้อมูล';
  return `${columnName(descriptor.col)} · ${header} · ${sample}`;
}
function fillColumnSelect(select, descriptors, selected, optional = false) {
  select.innerHTML = '';
  if (optional) { const none = document.createElement('option'); none.value = ''; none.textContent = '— ไม่ใช้คอลัมน์นี้ —'; select.append(none); }
  for (const descriptor of descriptors) {
    const option = document.createElement('option'); option.value = String(descriptor.col); option.textContent = columnOptionLabel(descriptor); option.selected = descriptor.col === selected; select.append(option);
  }
}
function inferLandMode(descriptor) {
  if (!descriptor) return 'auto';
  if ((descriptor.cadNameRatio || 0) >= 0.2 || (descriptor.cadNameHits || 0) > (descriptor.globalIdHits || 0)) return 'cad-name';
  if ((descriptor.sequentialRatio || 0) >= 0.8) return 'local-index';
  if ((descriptor.globalIdRatio || 0) >= 0.5) return 'global-id';
  return 'auto';
}
function readSchemaControls() {
  const optional = (select) => select.value === '' ? null : Number(select.value);
  const landCol = Number(els.landColumn.value);
  const descriptor = state.schema?.descriptors?.find((item) => item.col === landCol);
  return { ...state.schema, componentCol: Number(els.componentColumn.value), packageCol: Number(els.packageColumn.value), landCol, landMode: inferLandMode(descriptor), measurementCol: optional(els.measurementColumn) };
}
function populateSchemaControls() {
  if (!state.schema) return;
  const d = state.schema.descriptors;
  fillColumnSelect(els.componentColumn, d, state.schema.componentCol);
  fillColumnSelect(els.packageColumn, d, state.schema.packageCol);
  fillColumnSelect(els.landColumn, d, state.schema.landCol);
  fillColumnSelect(els.measurementColumn, d, state.schema.measurementCol, true);
}
function populateComponents(preferredId = null) {
  els.componentSelect.innerHTML = '';
  if (!state.xmlData) { state.selectedComponentId = null; return; }
  const summaries = state.mappingData?.componentSummaries || [];
  const summaryById = new Map();
  for (const summary of summaries) {
    if (summary.componentId == null) continue;
    const key = String(summary.componentId);
    if (!summaryById.has(key)) summaryById.set(key, summary);
  }
  const components = state.xmlData.components
    .filter((component) => component.lands?.length)
    .sort((a, b) => {
      const ar = summaryById.has(String(a.id)) ? 0 : 1;
      const br = summaryById.has(String(b.id)) ? 0 : 1;
      return ar - br || String(a.name).localeCompare(String(b.name), undefined, { numeric: true }) || (b.lands.length - a.lands.length);
    });

  const boardOption = document.createElement('option');
  boardOption.value = BOARD_VIEW;
  boardOption.textContent = `ทั้งบอร์ด · ${formatInt.format(components.length)} Components · ${formatInt.format(state.xmlData.totalLands || 0)} lands`;
  els.componentSelect.append(boardOption);

  for (const component of components) {
    const summary = summaryById.get(String(component.id));
    const option = document.createElement('option'); option.value = String(component.id);
    const sourceLabel = summary ? `Raw ${formatInt.format(summary.xrayCount)} · CAD ${formatInt.format(component.lands.length)}` : `CAD only · ${formatInt.format(component.lands.length)} lands`;
    option.textContent = `${component.name || `ID ${component.id}`} · ${component.packageName || 'ไม่ทราบ package'} · ${sourceLabel}`;
    els.componentSelect.append(option);
  }
  for (const summary of summaries.filter((item) => item.componentId == null)) {
    const option = document.createElement('option'); option.disabled = true;
    option.textContent = `${summary.componentName || 'ไม่ทราบชื่อ'} · ไม่พบ Component นี้ใน CAD · Raw ${formatInt.format(summary.xrayCount)} rows`;
    els.componentSelect.append(option);
  }
  const allowed = new Set([BOARD_VIEW, ...components.map((component) => String(component.id))]);
  const candidate = preferredId == null ? BOARD_VIEW : String(preferredId);
  const chosen = allowed.has(candidate) ? candidate : BOARD_VIEW;
  state.selectedComponentId = chosen;
  els.componentSelect.value = chosen;
  refreshDuplicateControls();
}

function updateStats() {
  const stats = state.mappingData?.stats;
  const cadOnlySummary = !stats && state.cadCompare.result ? state.cadCompare.result.summary : null;
  els.mappedStat.textContent = formatInt.format(stats?.mapped ?? cadOnlySummary?.matchedLands ?? 0);
  els.verifiedStat.textContent = formatInt.format(stats?.verified ?? cadOnlySummary?.matchedLands ?? 0);
  els.unmappedStat.textContent = formatInt.format(stats?.unmapped ?? ((cadOnlySummary?.missingGenerated || 0) + (cadOnlySummary?.extraGenerated || 0)));
  const summaries = state.mappingData?.componentSummaries || [];
  els.xmlLandStat.textContent = formatInt.format(state.xmlData?.totalLands || 0);
  els.componentStat.textContent = formatInt.format(state.xmlData?.components.filter((component) => component.lands?.length).length || 0);
  const summary = summaries.find((item) => String(item.componentId) === String(state.selectedComponentId));
  const anchors = currentMappings().filter((mapping) => mapping.anchorLocked).length;
  if (summary && stats) {
    const methods = [];
    if (stats.exactCadName) methods.push(`ชื่อ CAD ตรง ${formatInt.format(stats.exactCadName)}`);
    if (stats.exactOtherCadName) methods.push(`ผ่าน CAD อีกฝั่ง ${formatInt.format(stats.exactOtherCadName)}`);
    if (stats.xmlGlobalId) methods.push(`XML ID ${formatInt.format(stats.xmlGlobalId)}`);
    if (stats.localOrderGuess) methods.push(`เดาลำดับ ${formatInt.format(stats.localOrderGuess)}`);
    if (stats.ambiguous) methods.push(`ชื่อกำกวม ${formatInt.format(stats.ambiguous)}`);
    els.mappingFormula.innerHTML = `Component ${escapeHtml(summary.componentName)}: คอลัมน์ ${escapeHtml(columnName(state.schema?.landCol ?? 0))} · โหมด ${escapeHtml(state.schema?.landMode || 'auto')} · รองรับตัวเลขและข้อความ<br>${escapeHtml(methods.join(' · ') || 'ยังไม่พบคู่')} · Confirmed ${formatInt.format(stats.verified || 0)} · Anchor ${formatInt.format(anchors)}`;
  } else if (state.mappingData && currentComponent()) els.mappingFormula.textContent = `${currentComponent().name}: CAD only · ไม่มีข้อมูลดิบของ Component นี้ แต่ยังดู แก้ชื่อ และ Export CAD ได้`;
  else if (canCompareCad() && state.cadCompare.result) els.mappingFormula.textContent = `Original CAD ↔ Generated CAD จับคู่โดย XML ID และพิกัดได้ ${formatInt.format(state.cadCompare.result.summary.matchedLands)} Land โดยไม่ต้องใช้ข้อมูลดิบ`;
  else if (state.xmlData) els.mappingFormula.textContent = `${cadRoleLabel(state.activeCadRole)} เปิดแบบ CAD Viewer · อัปโหลด XLSX หรือ CAD อีกฝั่งเพื่อ Mapping`;
  else els.mappingFormula.textContent = 'ยังไม่มีสูตร Mapping';
  const ready = Boolean(state.xmlData && state.xlsxData && state.mappingData);
  els.exportCsvButton.disabled = !state.xmlData;
  if (ready) els.projectStatus.textContent = `${availablePairLabel()} · ${formatInt.format(stats.verified || 0)} verified · ${formatInt.format(stats.unverified || 0)} unverified`;
  else if (canCompareCad() && state.cadCompare.result) els.projectStatus.textContent = `${availablePairLabel()} · ${formatInt.format(state.cadCompare.result.summary.matchedLands)} matched`;
  else if (state.xmlData) els.projectStatus.textContent = `${availablePairLabel()} · ${formatInt.format(state.xmlData.totalLands)} lands`;
  else els.projectStatus.textContent = 'ยังไม่ได้เปิดโปรเจกต์';
  els.projectStatus.className = `status-pill ${state.xmlData ? 'ready' : 'muted'}`;
  els.remapButton.disabled = !state.xmlData || !state.xlsxData;
  els.cadInspectorButton.disabled = !state.xmlData;
  els.cadEditorButton.disabled = !state.xmlData;
  els.exportCsvButton.disabled = !state.xmlData; els.exportExcelButton.disabled = !state.xmlData; els.exportJsonButton.disabled = !state.xmlData; els.restoreButton.disabled = false; els.projectBackupButton.disabled = !state.xmlData; els.teachButton.disabled = !ready;
  els.manualButton.disabled = !ready;
  populateActiveCadSelect(); updateCadCompareControls(); refreshHistoryButtons();
}
async function runMapping() {
  if (!state.xmlData || !state.xlsxData) return;
  const hasManual = state.mappingData?.mappings.some((m) => m.manual || m.anchorLocked);
  if (hasManual && !(await requestAppConfirm({ title: 'คำนวณ Mapping ใหม่?', message: 'ระบบจะคำนวณ Candidate ใหม่และพยายามรักษา Manual Mapping ที่ Target ยังถูกต้อง', detail: 'Manual Mapping ที่ Target หายไปจะเปลี่ยนเป็น Conflict แทนการถูกลบทิ้ง', confirmText: 'Yes - คำนวณใหม่' }))) return;
  state.schema = readSchemaControls(); state.mappingData = buildMappings(state.xmlData, state.xlsxData, state.schema, { alternateCadData: alternateCadData(), coordinateTolerance: state.cadCompare.tolerance }); normalizeMappings(); resetHistogramState();
  state.undoStack = []; state.redoStack = []; state.preview = null;
  state.selectedComponentId = BOARD_VIEW;
  populateComponents(BOARD_VIEW); state.page = 1;
  updateStats(); renderTable(); renderTeachPanel(); fitView(); draw(); renderHistogram();
  toast(`จับคู่สำเร็จ ${formatInt.format(state.mappingData.stats.mapped)} จาก ${formatInt.format(state.mappingData.stats.total)} รายการ`);
}
async function processFile(file, cadRole = 'auto') {
  if (!file) return;
  const importStarted = performance.now();
  let importSucceeded = false;
  let autoOpenEditor = false;
  setLoading(true, `กำลังเปิด ${file.name}…`); await nextFrame();
  try {
    const lowerName = String(file.name || '').toLowerCase();
    let archive = null;
    let project = { xmlText: null, xlsxBuffer: null, tableData: null, names: { xml: '', xlsx: '' } };

    if (lowerName.endsWith('.xlsx')) {
      project = await extractProjectFiles(file);
    } else {
      const probeBytes = new Uint8Array(await file.arrayBuffer());
      const probe = detectCadFormat({ name: file.name, mimeType: file.type, bytes: probeBytes });
      if (['cad-xy-delimited', 'cad-xy-bom-delimited', 'bom-delimited', 'delimited-text'].includes(probe.format)) {
        const text = decodeTextBytes(probeBytes, probe.encoding);
        project.tableData = parseDelimitedText(text, { fileName: file.name, encoding: probe.encoding, detection: probe, sheetName: probe.format.includes('bom') ? 'BOM / Placement' : 'CAD XY' });
        project.names.xlsx = file.name;
        els.archiveDiagnostics.classList.remove('hidden');
        els.archiveDiagnosticsText.textContent = [`Format: ${probe.format}`, `Encoding: ${probe.encoding}`, `Delimiter: ${project.tableData.delimiter === '\t' ? 'TAB' : project.tableData.delimiter}`, `Rows: ${project.tableData.rowCount}`, `Columns: ${project.tableData.columnCount}`, `Unit hint: ${project.tableData.unit}`, ...project.tableData.warnings].join('\n');
      } else if (['gerber', 'excellon'].includes(probe.format)) {
        throw new ImportError(`${probe.format.toUpperCase()} ถูกตรวจพบ แต่เวอร์ชันนี้รองรับเฉพาะ Format Detection/Preflight และยังไม่มี Geometry Viewer/Writer ที่ครบถ้วน`, { stage: 'format-adapter', fileName: file.name, code: `PARTIAL_${probe.format.toUpperCase()}_IMPORT`, remediation: 'เก็บไฟล์ต้นฉบับไว้ และใช้ ODB++/IPC-2581/Inspection XML หรือ CAD XY สำหรับ Workflow ที่ต้องแก้ไข Component/Land', context: probe });
      } else {
      // ZIP อาจเป็นโปรเจกต์เดิมที่มี XLSX อยู่ข้าง CAD จึงอ่าน XLSX เพิ่มโดยไม่รบกวน Archive tree
      if (lowerName.endsWith('.zip')) {
        try {
          const directProject = await extractProjectFiles(file);
          if (directProject.xlsxBuffer) {
            project.xlsxBuffer = directProject.xlsxBuffer;
            project.names.xlsx = directProject.names.xlsx || file.name;
          }
        } catch { /* Nested ZIP/TGZ จะถูกอ่านด้วย package reader ด้านล่าง */ }
      }

      els.importMessage.textContent = 'กำลังแตก TGZ/ZIP และตรวจ components.Z, eda/data.Z, XML…'; await nextFrame();
      const packageInfo = await readCadPackageFile(file);
      els.archiveDiagnostics.classList.remove('hidden');
      els.archiveDiagnosticsText.textContent = packageInfo.diagnostics.length
        ? packageInfo.diagnostics.join('\n')
        : `Archive: ${file.name}\nไม่พบข้อความวินิจฉัยเพิ่มเติม`;
      const selected = packageInfo.candidates[0];
      if (!selected) {
        if (!project.xlsxBuffer) {
          const detail = packageInfo.diagnostics.length ? ` · ${packageInfo.diagnostics.slice(0, 3).join(' · ')}` : '';
          throw new ImportError(`ไม่พบ CAD ที่รองรับภายในไฟล์${detail}`, { stage: 'format-detection', fileName: file.name, code: 'IMPORT_NO_SUPPORTED_CAD', remediation: 'ตรวจ Diagnostic Report ว่าไฟล์ใดและโครงสร้างใดถูกตรวจพบ แล้วเลือกไฟล์ CAD/BOM/XY ที่รองรับ', context: { diagnostics: packageInfo.diagnostics.slice(0, 20), candidateCount: packageInfo.candidates.length } });
        }
      } else {
        archive = {
          name: file.name,
          packageInfo,
          candidate: selected,
          candidatePaths: packageInfo.candidates.map((item) => item.displayPath),
        };
        project.xmlText = selected.text;
        project.names.xml = selected.format === 'odb++' ? `${file.name.replace(/\.(?:zip|tgz|tar\.gz|tar|gz)$/i, '') || 'odb'}_converted.xml` : (selected.node?.name || selected.displayPath || file.name);
        const rootLabel = packageInfo.root.kind.toUpperCase();
        const nested = packageInfo.candidates.length > 1 ? ` · พบตัวเลือก ${packageInfo.candidates.length} รายการ` : '';
        const formatLabel = selected.format === 'odb++' ? `ODB++ → XML · ${selected.odbInfo.components} Components / ${selected.odbInfo.lands} Lands` : `CAD XML ${selected.displayPath}`;
        els.importMessage.textContent = `${rootLabel} → ${formatLabel}${nested}`;
      }
      }
    }

    let importedRole = null;
    if (project.xmlText) {
      importedRole = cadRole === 'generated' ? 'generated' : 'original';
      els.importMessage.textContent = `กำลังอ่าน ${cadRoleLabel(importedRole)}…`; await nextFrame();
      storeCadFile(importedRole, project.xmlText, project.names.xml || file.name, { archive, sourceFormat: archive?.candidate?.format || 'inspection-xml' });
    }
    if (project.xlsxBuffer) {
      state.xlsxBuffer = project.xlsxBuffer; state.fileNames.xlsx = project.names.xlsx || file.name;
      els.importMessage.textContent = 'กำลังอ่านตารางผล X-ray จาก XLSX…'; await nextFrame();
      state.xlsxData = await parseXlsx(project.xlsxBuffer);
    } else if (project.tableData) {
      state.xlsxBuffer = null; state.fileNames.xlsx = project.names.xlsx || file.name;
      state.xlsxData = project.tableData;
      els.importMessage.textContent = `เปิด ${project.tableData.format} แล้ว · ${formatInt.format(project.tableData.rowCount)} แถว · เลือกคอลัมน์เพื่อ Mapping`;
    }
    syncCadFileLabels();

    if (importedRole) {
      const shouldActivate = !state.activeCadRole || state.activeCadRole === importedRole || importedRole === 'original' || !state.cadFiles.original;
      if (shouldActivate) activateCad(importedRole, { rebuild: true, fit: true });
      else if (state.xlsxData && state.xmlData) rebuildMappingForActiveCad();
    } else if (state.xmlData && state.xlsxData) {
      rebuildMappingForActiveCad(); populateComponents(state.selectedComponentId || BOARD_VIEW); fitView();
    }

    if (canCompareCad()) {
      rebuildCadComparison();
      const summary = state.cadCompare.result.summary;
      els.importMessage.textContent = `${availablePairLabel()} · CAD↔CAD จับคู่ ${formatInt.format(summary.matchedLands)} Land · เปลี่ยนชื่อ ${formatInt.format(summary.renamed + summary.renamedMoved)} จุด${state.mappingData ? ` · Raw verified ${formatInt.format(state.mappingData.stats.verified || 0)}` : ''}`;
      if (importedRole === 'generated') openCadCompare();
    } else if (state.xmlData && state.xlsxData && state.mappingData) {
      const summaries = state.mappingData.componentSummaries;
      const matchedParts = summaries.filter((summary) => summary.matched).length;
      const exactParts = summaries.filter((summary) => summary.countMatch).length;
      const missingParts = summaries.length - matchedParts;
      els.importMessage.textContent = `เปิดทั้งบอร์ดแล้ว · Raw ${formatInt.format(summaries.length)} Part · จับคู่ CAD ${formatInt.format(matchedParts)} Part · จำนวน Land ตรง ${formatInt.format(exactParts)} Part${missingParts ? ` · ไม่พบใน CAD ${formatInt.format(missingParts)} Part` : ''}`;
    } else if (state.xmlData) {
      const convertedOdb = archive?.candidate?.format === 'odb++';
      const archiveLabel = convertedOdb
        ? ` · e-PM/ODB++ ถูกแปลงเป็น XML (เลือก Export Top/Bottom ได้; ไม่แก้ TGZ ต้นฉบับ)`
        : (archive?.packageInfo?.root?.kind ? ` · ${archive.packageInfo.root.kind.toUpperCase()} รองรับ Export กลับโครงสร้างเดิม` : '');
      els.importMessage.textContent = `เปิด ${cadRoleLabel(state.activeCadRole)} แล้ว · แสดงทั้งบอร์ด ${formatInt.format(state.xmlData.components.length)} Components / ${formatInt.format(state.xmlData.totalLands)} Lands${archiveLabel}`;
    } else if (state.xlsxData) els.importMessage.textContent = 'เปิด XLSX แล้ว · เพิ่ม Original CAD หรือ Generated CAD อย่างใดอย่างหนึ่งเพื่อ Mapping';

    populateComponents(state.selectedComponentId || BOARD_VIEW); updateStats(); renderTable(); renderTeachPanel(); refreshDuplicateControls(); draw(); renderHistogram();
    autoOpenEditor = Boolean(importedRole && state.xmlData && !state.xlsxData && !canCompareCad());
  } catch (error) {
    const typed = asCadError(error, ImportError, { stage: error?.stage || 'import', fileName: file.name, code: error?.code || 'IMPORT_FAILED' });
    console.error(typed); els.importMessage.textContent = `นำเข้าไม่สำเร็จ [${typed.code}] · ${typed.message}`; toast(`นำเข้าไม่สำเร็จ [${typed.code}]`, 6200);
    showGlobalError(typed, { title: 'นำเข้าไฟล์ไม่สำเร็จ', operation: 'import', fileName: file.name });
  } finally {
    state.diagnostics.record('import', performance.now() - importStarted, { success: importSucceeded, fileName: String(file.name || '').slice(0, 180), components: state.xmlData?.components?.length || 0, packages: new Set((state.xmlData?.components || []).map((item) => item.packageName)).size, lands: state.xmlData?.totalLands || 0 });
    setLoading(false); els.projectFile.value = ''; els.originalCadFile.value = ''; els.generatedCadFile.value = ''; els.archiveCadFile.value = '';
    if (autoOpenEditor) setTimeout(() => { if (state.xmlData) openCadEditor(); }, 0);
  }
}
function resetProject() {
  autosaveController.cancel();
  Object.assign(state, {
    xmlText: null, xlsxBuffer: null, xmlData: null, xlsxData: null, schema: null, mappingData: null,
    selectedComponentId: null, selected: null, hoveredLand: null, manualMode: false, preview: null,
    edit: { enabled: false, autoNext: true, lockConfirmed: true }, undoStack: [], redoStack: [], page: 1,
    fileNames: { xml: '', generatedXml: '', xlsx: '' }, cadFiles: { original: null, generated: null }, activeCadRole: null, viewerSpatialIndex: null,
    cadCompare: { result: null, tolerance: 0.08, filter: 'changed', search: '', page: 1, pageSize: 120, selectedRow: null, overlayEnabled: false },
    view: { scale: 1, offsetX: 0, offsetY: 0 }, dragStart: null,
    duplicateView: { enabled: true, dimOthers: false, selectedName: '' },
    cadInspector: { renames: new Map(), maxLength: 5, prefix: 'A', overflowMode: 'keep-start', duplicateMode: 'replace-character', duplicateCharacter: '_', scope: 'all', filter: 'all', search: '', page: 1, pageSize: 120, audit: null },
    cadEditor: { model: null, selectedComponentUid: null, selectedComponentUids: new Set(), selectedLandUid: null, selectedLandUids: new Set(), componentSearch: '', landSearch: '', sideFilter: 'all', clipboard: [], busy: false, busyToken: 0, busyStartedAt: 0, taskCancelRequested: false, pendingCloseAfterTask: false, pendingActionAfterClose: null, busyWatchdog: null, viewerRefreshPending: false, confirm: { mode: null, pendingAction: null }, history: { undo: [], redo: [], limit: 40, restoring: false }, visual: { scale: 1, offsetX: 0, offsetY: 0, tool: 'select', mode: 'component', search: '', side: 'all', labels: true, grid: true, snap: true, interaction: null, spaceDown: false, hoverHandle: null, boundsCache: new Map() } },
  });
  resetHistogramState();
  document.body.classList.remove('cad-editor-open', 'app-confirm-open');
  if (appConfirmPending) closeAppConfirm(false);
  els.archiveDiagnostics?.classList.add('hidden');
  if (els.archiveDiagnosticsText) els.archiveDiagnosticsText.textContent = '—';
  closeDetailsDrawer();
  for (const overlay of [els.histogramOverlay, els.cadInspectorOverlay, els.cadCompareOverlay, els.componentReportOverlay, els.teachOverlay, els.cadEditorOverlay]) overlay.classList.add('hidden');
  els.duplicateToggle.checked = true; els.duplicateOnlyToggle.checked = false; els.cadCompareOverlayToggle.checked = false;
  syncCadFileLabels(); els.importMessage.textContent = 'ไฟล์จะถูกประมวลผลในเครื่อง ไม่อัปโหลดไปยังเซิร์ฟเวอร์';
  for (const select of [els.componentColumn, els.packageColumn, els.landColumn, els.measurementColumn, els.componentSelect, els.activeCadSelect]) select.innerHTML = '';
  els.mappingTableBody.innerHTML = ''; clearDetails(); refreshDuplicateControls(); renderTeachPanel(); updateEditPanel(); updateStats(); renderCadCompare(); draw(); renderHistogram();
}
function filteredMappings() {
  const mappings = currentTableRows();
  switch (state.filter) {
    case 'duplicate': return mappings.filter((m) => m.duplicateCadNameCount > 1);
    case 'verified': return mappings.filter((m) => !m.cadOnly && isVerifiedMapping(m));
    case 'unverified': return mappings.filter((m) => !m.cadOnly && m.mapped && !isVerifiedMapping(m));
    case 'unmapped': return mappings.filter((m) => !m.cadOnly && !m.mapped);
    case 'cad-only': return mappings.filter((m) => m.cadOnly);
    default: return mappings;
  }
}
function syncMappingRowsFromActiveCad() {
  if (!state.mappingData?.mappings || !state.xmlData) return 0;
  const componentIndex = new Map();
  for (const component of state.xmlData.components || []) {
    const landById = new Map();
    const nameCounts = new Map();
    for (const land of component.lands || []) {
      landById.set(Number(land.globalId), land);
      const name = String(land.cadName || '').trim();
      if (name) nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
    }
    componentIndex.set(String(component.id), { component, landById, nameCounts });
  }
  let changed = 0;
  for (const mapping of state.mappingData.mappings) {
    if (mapping.componentId == null || mapping.globalId == null) continue;
    const indexed = componentIndex.get(String(mapping.componentId));
    const component = indexed?.component;
    const land = indexed?.landById.get(Number(mapping.globalId));
    if (!component || !land) continue;
    const name = String(land.cadName || '').trim();
    const next = {
      componentName: component.name || mapping.componentName || '',
      packageName: component.packageName || mapping.packageName || '',
      cadName: land.cadName || '',
      left: land.left ?? null,
      top: land.top ?? null,
      centerX: land.centerX ?? null,
      centerY: land.centerY ?? null,
      width: land.width ?? null,
      length: land.length ?? null,
      duplicateCadNameCount: name ? (indexed.nameCounts.get(name) || 1) : 1,
    };
    for (const [key, value] of Object.entries(next)) {
      if (mapping[key] !== value) { mapping[key] = value; changed += 1; }
    }
  }
  return changed;
}

function mappingStatus(mapping) {
  if (mapping.cadOnly) return { text: 'CAD only', cls: 'cad-only' };
  const status = mapping.matchStatus || '';
  if (status === 'conflict') return { text: 'Conflict', cls: 'unmapped' };
  if (status === 'ignored') return { text: 'Ignored', cls: 'unmapped' };
  if (status === 'manually-confirmed') return { text: 'Manually Confirmed', cls: 'verified' };
  if (status === 'exact-match') return { text: 'Exact Match', cls: 'verified' };
  if (status === 'strong-match') return { text: 'Strong Match', cls: isVerifiedMapping(mapping) ? 'verified' : 'unverified' };
  if (status === 'possible-match') return { text: 'Possible Match', cls: 'unverified' };
  if (!mapping.mapped) {
    if (Number(mapping.ambiguityCount) > 1) return { text: `Conflict ×${mapping.ambiguityCount}`, cls: 'unmapped' };
    return { text: 'Missing', cls: 'unmapped' };
  }
  return { text: isVerifiedMapping(mapping) ? 'Confirmed Match' : 'Suggested Match', cls: isVerifiedMapping(mapping) ? 'verified' : 'unverified' };
}
function renderTable() {
  syncMappingRowsFromActiveCad();
  const all = filteredMappings(); const pages = Math.max(1, Math.ceil(all.length / state.pageSize)); state.page = Math.min(Math.max(1, state.page), pages);
  const start = (state.page - 1) * state.pageSize; const rows = all.slice(start, start + state.pageSize);
  const previewMappings = new Set(state.preview?.proposals.map((p) => p.mapping) || []); els.mappingTableBody.innerHTML = ''; const fragment = document.createDocumentFragment();
  const component = currentComponent();
  for (const mapping of rows) {
    const tr = document.createElement('tr');
    const sameSelected = state.selected === mapping || (mapping.cadOnly && state.selected?.cadOnly && Number(state.selected.globalId) === Number(mapping.globalId));
    if (sameSelected) tr.classList.add('active');
    if (mapping.cadOnly) tr.classList.add('cad-only-row'); else if (isVerifiedMapping(mapping)) tr.classList.add('verified-row'); else if (mapping.mapped) tr.classList.add('unverified-row');
    if (previewMappings.has(mapping)) tr.classList.add('preview-row');
    const values = [
      mapping.cadOnly ? '—' : (mapping.rawLandId ?? mapping.localIndex ?? '—'),
      mapping.componentName || component?.name || '—', mapping.packageName || component?.packageName || '—', cadLocalIndexFor(mapping, component) ?? '—',
      mapping.globalId ?? '—', mapping.cadName || '—',
      Number.isFinite(mapping.centerX) ? formatFloat.format(mapping.centerX) : '—', Number.isFinite(mapping.centerY) ? formatFloat.format(mapping.centerY) : '—',
      Number.isFinite(mapping.width) ? formatFloat.format(mapping.width) : '—', Number.isFinite(mapping.length) ? formatFloat.format(mapping.length) : '—',
      mapping.measurement ?? '—', mapping.mappingMethod || '—', mapping.confidence == null ? '—' : `${mapping.confidence}%`,
    ];
    for (const value of values) { const td = document.createElement('td'); td.textContent = value; tr.append(td); }
    const status = mappingStatus(mapping); const statusTd = document.createElement('td'); const chip = document.createElement('span'); chip.className = `status-chip ${status.cls}`; chip.textContent = status.text; statusTd.append(chip); tr.append(statusTd);
    tr.addEventListener('click', () => selectMapping(mapping, true)); fragment.append(tr);
  }
  const visibleLandCount = isBoardView() ? (state.xmlData?.totalLands || 0) : (component?.lands?.length || 0);
  els.mappingTableBody.append(fragment); els.tableSummary.textContent = `${formatInt.format(all.length)} รายการ · CAD ${formatInt.format(visibleLandCount)} lands${isBoardView() ? ' · ทั้งบอร์ด' : ''}`; els.pageLabel.textContent = `${state.page} / ${pages}`; els.prevPage.disabled = state.page <= 1; els.nextPage.disabled = state.page >= pages;
}
function selectMapping(mapping, center = false) {
  state.selected = mapping; if (!state.edit.enabled) { state.manualMode = false; els.manualBanner.classList.add('hidden'); els.manualBanner.classList.remove('preview-active'); }
  if (mapping.componentId != null && String(mapping.componentId) !== String(state.selectedComponentId)) { state.selectedComponentId = String(mapping.componentId); els.componentSelect.value = String(mapping.componentId); state.duplicateView.selectedName = ''; refreshDuplicateControls(); fitView(); }
  if (mapping.duplicateCadNameCount > 1 && mapping.cadName) { state.duplicateView.selectedName = String(mapping.cadName).trim(); els.duplicateNameSelect.value = state.duplicateView.selectedName; }
  updateDetails(); updateEditPanel(); renderDuplicatePanel(); renderTable(); if (center && Number.isFinite(mapping.centerX) && Number.isFinite(mapping.centerY)) centerOn(mapping.centerX, mapping.centerY); draw(); renderHistogram();
}
function clearDetails() {
  state.selected = null; els.selectedTitle.textContent = 'ยังไม่ได้เลือก'; els.selectedSubTitle.textContent = 'ค้นหาหรือคลิกตำแหน่งบนกราฟิก';
  for (const el of [els.dLocal, els.dGlobal, els.dCad, els.dComponent, els.dX, els.dY, els.dMeasurement, els.dConfidence, els.dRow, els.dMethod, els.dVerified, els.dAnchor]) el.textContent = '—';
  els.rawData.textContent = '—'; els.aliasInput.value = ''; els.aliasInput.disabled = true; els.saveAliasButton.disabled = true; els.copyRawButton.disabled = true; els.duplicateWarning.classList.add('hidden');
  for (const button of [els.anchorButton, els.unmapButton, els.nudgePrevButton, els.nudgeNextButton]) button.disabled = true;
  updateEditPanel();
  closeDetailsDrawer();
}
function updateDetails() {
  const mapping = state.selected; if (!mapping) return clearDetails();
  els.selectedTitle.textContent = mapping.alias || mapping.cadName || `Land ${mapping.localIndex}`; els.selectedSubTitle.textContent = `${mapping.componentName || 'Unknown component'} · ${mapping.packageName || 'Unknown package'}`;
  els.dLocal.textContent = mapping.cadOnly ? '—' : (mapping.rawLandId ?? mapping.localIndex ?? '—'); els.dGlobal.textContent = mapping.globalId ?? '—'; els.dCad.textContent = mapping.cadName || '—'; els.dComponent.textContent = mapping.componentName || '—';
  els.dX.textContent = Number.isFinite(mapping.centerX) ? `${formatFloat.format(mapping.centerX)} mm` : '—'; els.dY.textContent = Number.isFinite(mapping.centerY) ? `${formatFloat.format(mapping.centerY)} mm` : '—';
  els.dMeasurement.textContent = mapping.measurement ?? '—'; els.dConfidence.textContent = `${mapping.confidence ?? 0}%${mapping.manual ? ' · manual' : ''}`; els.dRow.textContent = mapping.sourceRow ?? '—';
  els.dMethod.textContent = mapping.mappingMethod || (mapping.manual ? 'manual' : 'auto'); els.dVerified.textContent = mapping.cadOnly ? 'CAD only' : (isVerifiedMapping(mapping) ? 'ยืนยันแล้ว' : 'ยังไม่ยืนยัน'); els.dAnchor.textContent = mapping.cadOnly ? '—' : (mapping.anchorLocked ? 'ล็อกแล้ว' : 'ไม่ล็อก');
  els.aliasInput.disabled = Boolean(mapping.cadOnly); els.saveAliasButton.disabled = Boolean(mapping.cadOnly); els.copyRawButton.disabled = !mapping.raw; els.aliasInput.value = mapping.alias || '';
  els.rawData.textContent = mapping.raw ? mapping.raw.map((value, index) => `${columnName(index)}: ${value ?? ''}`).join('\n') : JSON.stringify(mapping, null, 2);
  if (mapping.duplicateCadNameCount > 1) { state.duplicateView.selectedName = String(mapping.cadName || '').trim(); els.duplicateNameSelect.value = state.duplicateView.selectedName; els.duplicateWarning.textContent = `ชื่อ CAD ${mapping.cadName} พบซ้ำ ${mapping.duplicateCadNameCount} ตำแหน่ง ระบบไฮไลต์ทุกตำแหน่งบนกราฟิกและเชื่อมด้วยเส้นประ`; els.duplicateWarning.classList.remove('hidden'); }
  else els.duplicateWarning.classList.add('hidden');
  els.manualButton.disabled = !state.mappingData; const editableMapping = Boolean(state.mappingData && !mapping.cadOnly && mapping.sourceRow != null); els.anchorButton.disabled = !editableMapping || !mapping.mapped; els.anchorButton.textContent = mapping.anchorLocked ? 'ปลด Anchor' : 'ล็อกเป็น Anchor'; els.unmapButton.disabled = !editableMapping || !mapping.mapped; els.nudgePrevButton.disabled = !editableMapping || !mapping.mapped; els.nudgeNextButton.disabled = !editableMapping || !mapping.mapped;
}

function getCanvasPoint(event) { const rect = els.canvas.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; }
function worldToScreen(x, y) { return { x: x * state.view.scale + state.view.offsetX, y: -y * state.view.scale + state.view.offsetY }; }
function screenToWorld(x, y) { return { x: (x - state.view.offsetX) / state.view.scale, y: (state.view.offsetY - y) / state.view.scale }; }
function fitView() {
  const bounds = boardBounds(); if (!bounds || !els.canvas.clientWidth || !els.canvas.clientHeight) return;
  const { minX, maxX, minY, maxY } = bounds; const pad = isBoardView() ? 38 : 24; const extra = isBoardView() ? 8 : 3;
  const width = Math.max(1, maxX - minX + extra); const height = Math.max(1, maxY - minY + extra);
  const scale = Math.max(0.05, Math.min((els.canvas.clientWidth - pad * 2) / width, (els.canvas.clientHeight - pad * 2) / height));
  state.view.scale = scale; state.view.offsetX = els.canvas.clientWidth / 2 - ((minX + maxX) / 2) * scale; state.view.offsetY = els.canvas.clientHeight / 2 + ((minY + maxY) / 2) * scale; draw();
}
function centerOn(x, y) { state.view.offsetX = els.canvas.clientWidth / 2 - x * state.view.scale; state.view.offsetY = els.canvas.clientHeight / 2 + y * state.view.scale; draw(); }
function fitLands(lands, paddingWorld = 1.2) {
  if (!lands?.length || !els.canvas.clientWidth || !els.canvas.clientHeight) return;
  const xs = lands.map((land) => Number(land.centerX)).filter(Number.isFinite);
  const ys = lands.map((land) => Number(land.centerY)).filter(Number.isFinite);
  if (!xs.length || !ys.length) return;
  let minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  if (minX === maxX) { minX -= 0.5; maxX += 0.5; }
  if (minY === maxY) { minY -= 0.5; maxY += 0.5; }
  minX -= paddingWorld; maxX += paddingWorld; minY -= paddingWorld; maxY += paddingWorld;
  const pad = 42; const width = Math.max(0.4, maxX - minX); const height = Math.max(0.4, maxY - minY);
  state.view.scale = Math.max(0.25, Math.min(450, (els.canvas.clientWidth - pad * 2) / width, (els.canvas.clientHeight - pad * 2) / height));
  state.view.offsetX = els.canvas.clientWidth / 2 - ((minX + maxX) / 2) * state.view.scale;
  state.view.offsetY = els.canvas.clientHeight / 2 + ((minY + maxY) / 2) * state.view.scale;
  draw();
}
function fitDuplicateGroup() {
  const lands = selectedDuplicateLands();
  if (!lands.length) return toast('ยังไม่ได้เลือกชื่อ CAD ซ้ำ');
  fitLands(lands, 1.6);
}
function zoomAt(factor, screenX = els.canvas.clientWidth / 2, screenY = els.canvas.clientHeight / 2) {
  const world = screenToWorld(screenX, screenY); const newScale = Math.min(450, Math.max(0.25, state.view.scale * factor)); state.view.scale = newScale; state.view.offsetX = screenX - world.x * newScale; state.view.offsetY = screenY + world.y * newScale; draw();
}
function renderHistogram() {
  const canvas = els.measurementHistogram;
  const hctx = histogramCtx;
  if (!canvas || !hctx) return;
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const width = canvas.clientWidth || 260;
  const height = canvas.clientHeight || 170;
  const targetW = Math.round(width * dpr);
  const targetH = Math.round(height * dpr);
  if (canvas.width !== targetW || canvas.height !== targetH) { canvas.width = targetW; canvas.height = targetH; }
  hctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  hctx.clearRect(0, 0, width, height);
  hctx.fillStyle = '#0b1320';
  hctx.fillRect(0, 0, width, height);

  const values = currentMappings().map((mapping) => Number(mapping.measurement)).filter(Number.isFinite).sort((a, b) => a - b);
  const component = currentComponent();
  els.histCount.textContent = formatInt.format(values.length);
  if (!values.length) {
    for (const el of [els.histMin, els.histAverage, els.histMedian, els.histMax]) el.textContent = '—';
    els.histogramMessage.textContent = component ? `${component.name}: ไม่พบ Measurement ที่เป็นตัวเลขในข้อมูลดิบ` : 'เลือก Part ที่พบในข้อมูลดิบเพื่อแสดง Histogram';
    hctx.fillStyle = '#91a0b7'; hctx.font = '11px system-ui'; hctx.textAlign = 'center'; hctx.textBaseline = 'middle'; hctx.fillText('No numeric measurement data', width / 2, height / 2);
    if (!els.histogramOverlay.classList.contains('hidden')) renderDetailedHistogram();
    return;
  }

  const min = values[0];
  const max = values[values.length - 1];
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const middle = Math.floor(values.length / 2);
  const median = values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
  const display = (value) => formatFloat.format(value);
  els.histMin.textContent = display(min); els.histAverage.textContent = display(average); els.histMedian.textContent = display(median); els.histMax.textContent = display(max);

  const requestedBins = Math.max(5, Math.min(80, Number(els.histogramBins.value) || 20));
  const binCount = max === min ? 1 : requestedBins;
  const span = max - min || 1;
  const counts = Array(binCount).fill(0);
  for (const value of values) {
    const index = max === min ? 0 : Math.min(binCount - 1, Math.floor(((value - min) / span) * binCount));
    counts[index] += 1;
  }
  const peak = Math.max(...counts, 1);
  const margin = { left: 36, right: 10, top: 12, bottom: 25 };
  const chartW = Math.max(1, width - margin.left - margin.right);
  const chartH = Math.max(1, height - margin.top - margin.bottom);

  hctx.strokeStyle = 'rgba(145,160,183,.16)'; hctx.lineWidth = 1;
  for (let step = 0; step <= 2; step += 1) {
    const y = margin.top + chartH * (step / 2);
    hctx.beginPath(); hctx.moveTo(margin.left, y); hctx.lineTo(width - margin.right, y); hctx.stroke();
  }
  const slot = chartW / binCount;
  const gap = Math.min(2, slot * 0.18);
  counts.forEach((count, index) => {
    const barH = (count / peak) * chartH;
    const ratio = binCount === 1 ? 0.5 : index / (binCount - 1);
    hctx.fillStyle = `hsl(${210 - ratio * 190} 78% 58%)`;
    hctx.fillRect(margin.left + index * slot + gap / 2, margin.top + chartH - barH, Math.max(1, slot - gap), barH);
  });

  hctx.fillStyle = '#91a0b7'; hctx.font = '9px system-ui'; hctx.textBaseline = 'top';
  hctx.textAlign = 'left'; hctx.fillText(display(min), margin.left, height - margin.bottom + 6);
  hctx.textAlign = 'right'; hctx.fillText(display(max), width - margin.right, height - margin.bottom + 6);
  hctx.textBaseline = 'middle'; hctx.fillText(formatInt.format(peak), margin.left - 5, margin.top + 2);
  hctx.fillText('0', margin.left - 5, margin.top + chartH);

  const selectedMeasurement = Number(state.selected?.measurement);
  if (Number.isFinite(selectedMeasurement) && String(state.selected?.componentId) === String(state.selectedComponentId)) {
    const ratio = max === min ? 0.5 : Math.max(0, Math.min(1, (selectedMeasurement - min) / span));
    const x = margin.left + ratio * chartW;
    hctx.strokeStyle = '#ffffff'; hctx.lineWidth = 1.5; hctx.beginPath(); hctx.moveTo(x, margin.top); hctx.lineTo(x, margin.top + chartH); hctx.stroke();
    hctx.fillStyle = '#ffffff'; hctx.textAlign = x > width * 0.72 ? 'right' : 'left'; hctx.textBaseline = 'top'; hctx.fillText(display(selectedMeasurement), x + (x > width * 0.72 ? -4 : 4), margin.top + 2);
  }

  const binWidth = binCount === 1 ? 0 : span / binCount;
  els.histogramMessage.textContent = `${component?.name || 'Part'} · ${formatInt.format(values.length)} ค่า · ${binCount} bins${binWidth ? ` · bin width ${display(binWidth)}` : ''}`;
  if (!els.histogramOverlay.classList.contains('hidden')) renderDetailedHistogram();
}

function measurementValues() {
  return currentMappings().map((mapping) => Number(mapping.measurement)).filter(Number.isFinite).sort((a, b) => a - b);
}
function quantile(sortedValues, q) {
  if (!sortedValues.length) return NaN;
  if (sortedValues.length === 1) return sortedValues[0];
  const position = (sortedValues.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}
function histogramStats(sortedValues) {
  if (!sortedValues.length) return null;
  const average = sortedValues.reduce((sum, value) => sum + value, 0) / sortedValues.length;
  const variance = sortedValues.reduce((sum, value) => sum + ((value - average) ** 2), 0) / sortedValues.length;
  return {
    count: sortedValues.length,
    min: sortedValues[0],
    q1: quantile(sortedValues, 0.25),
    average,
    median: quantile(sortedValues, 0.5),
    q3: quantile(sortedValues, 0.75),
    max: sortedValues[sortedValues.length - 1],
    stdDev: Math.sqrt(variance),
  };
}
function clampHistogramRange(fullMin, fullMax, requestedMin, requestedMax) {
  let min = Number.isFinite(requestedMin) ? requestedMin : fullMin;
  let max = Number.isFinite(requestedMax) ? requestedMax : fullMax;
  min = Math.max(fullMin, Math.min(fullMax, min));
  max = Math.max(fullMin, Math.min(fullMax, max));
  if (min > max) [min, max] = [max, min];
  if (min === max && fullMin !== fullMax) {
    const padding = Math.max((fullMax - fullMin) / 200, Number.EPSILON);
    min = Math.max(fullMin, min - padding);
    max = Math.min(fullMax, max + padding);
  }
  return { min, max };
}
function buildDetailedHistogramModel() {
  const values = measurementValues();
  if (!values.length) return { values, bins: [], inRange: [] };
  const fullMin = values[0];
  const fullMax = values[values.length - 1];
  const requestedMin = state.histogram.rangeMin == null ? NaN : Number(state.histogram.rangeMin);
  const requestedMax = state.histogram.rangeMax == null ? NaN : Number(state.histogram.rangeMax);
  const active = clampHistogramRange(fullMin, fullMax, requestedMin, requestedMax);
  const rangeMin = state.histogram.rangeMin == null ? fullMin : active.min;
  const rangeMax = state.histogram.rangeMax == null ? fullMax : active.max;
  const inRange = values.filter((value) => value >= rangeMin && value <= rangeMax);
  const requestedBins = Math.max(5, Math.min(400, Number(els.detailedHistogramBins.value) || 50));
  const binCount = rangeMax === rangeMin ? 1 : requestedBins;
  const span = rangeMax - rangeMin || 1;
  const bins = Array.from({ length: binCount }, (_, index) => {
    const low = rangeMin + span * (index / binCount);
    const high = index === binCount - 1 ? rangeMax : rangeMin + span * ((index + 1) / binCount);
    return { index, low, high, count: 0, cumulative: 0 };
  });
  for (const value of inRange) {
    const index = rangeMax === rangeMin ? 0 : Math.min(binCount - 1, Math.floor(((value - rangeMin) / span) * binCount));
    bins[index].count += 1;
  }
  let cumulative = 0;
  for (const bin of bins) { cumulative += bin.count; bin.cumulative = cumulative; }
  return { values, fullMin, fullMax, rangeMin, rangeMax, span, inRange, bins, stats: histogramStats(inRange) };
}
function formatHistogramRange(low, high, isLast = false) {
  return `${formatFloat.format(low)} ${isLast ? '≤ x ≤' : '≤ x <'} ${formatFloat.format(high)}`;
}
function updateSelectedBinDetails(model) {
  const bin = model.bins?.[state.histogram.selectedBin];
  els.zoomHistogramBinButton.disabled = !bin;
  if (!bin) {
    els.selectedBinRange.textContent = 'ยังไม่ได้เลือกแท่ง';
    els.selectedBinCount.textContent = '—';
    els.selectedBinPercent.textContent = '—';
    els.selectedBinCumulative.textContent = '—';
    return;
  }
  const denominator = model.inRange.length || 1;
  els.selectedBinRange.textContent = formatHistogramRange(bin.low, bin.high, bin.index === model.bins.length - 1);
  els.selectedBinCount.textContent = formatInt.format(bin.count);
  els.selectedBinPercent.textContent = `${formatFloat.format((bin.count / denominator) * 100)}%`;
  els.selectedBinCumulative.textContent = `${formatInt.format(bin.cumulative)} · ${formatFloat.format((bin.cumulative / denominator) * 100)}%`;
}
function renderDetailedHistogram() {
  const canvas = els.detailedHistogramCanvas;
  const hctx = detailedHistogramCtx;
  if (!canvas || !hctx) return;
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const width = canvas.clientWidth || 920;
  const height = canvas.clientHeight || 560;
  const targetW = Math.round(width * dpr);
  const targetH = Math.round(height * dpr);
  if (canvas.width !== targetW || canvas.height !== targetH) { canvas.width = targetW; canvas.height = targetH; }
  hctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  hctx.clearRect(0, 0, width, height);
  hctx.fillStyle = '#0b1320';
  hctx.fillRect(0, 0, width, height);

  const component = currentComponent();
  const model = buildDetailedHistogramModel();
  els.detailedHistogramPart.textContent = component ? `${component.name} · ${component.packageName || 'Unknown package'} · Measurement ${formatInt.format(model.values.length)} ค่า` : 'เลือก Part เพื่อแสดงข้อมูล';
  els.detailHistTotal.textContent = formatInt.format(model.values.length);
  els.detailHistInRange.textContent = formatInt.format(model.inRange.length);
  if (!model.values.length) {
    for (const el of [els.detailHistMin, els.detailHistQ1, els.detailHistAverage, els.detailHistMedian, els.detailHistQ3, els.detailHistMax, els.detailHistStdDev]) el.textContent = '—';
    els.detailedHistogramMessage.textContent = component ? `${component.name}: ไม่พบ Measurement ที่เป็นตัวเลข` : 'เลือก Part ที่พบในข้อมูลดิบ';
    hctx.fillStyle = '#91a0b7'; hctx.font = '14px system-ui'; hctx.textAlign = 'center'; hctx.textBaseline = 'middle'; hctx.fillText('No numeric measurement data', width / 2, height / 2);
    state.histogram.layout = null; updateSelectedBinDetails(model); return;
  }

  const stat = model.stats;
  const display = (value) => Number.isFinite(value) ? formatFloat.format(value) : '—';
  els.detailHistMin.textContent = display(stat?.min); els.detailHistQ1.textContent = display(stat?.q1); els.detailHistAverage.textContent = display(stat?.average);
  els.detailHistMedian.textContent = display(stat?.median); els.detailHistQ3.textContent = display(stat?.q3); els.detailHistMax.textContent = display(stat?.max); els.detailHistStdDev.textContent = display(stat?.stdDev);
  if (document.activeElement !== els.histogramRangeMin) els.histogramRangeMin.value = state.histogram.rangeMin == null ? '' : String(model.rangeMin);
  if (document.activeElement !== els.histogramRangeMax) els.histogramRangeMax.value = state.histogram.rangeMax == null ? '' : String(model.rangeMax);

  const margin = { left: 68, right: 26, top: 34, bottom: 58 };
  const chartW = Math.max(1, width - margin.left - margin.right);
  const chartH = Math.max(1, height - margin.top - margin.bottom);
  const yMode = els.histogramYMode.value === 'percent' ? 'percent' : 'count';
  const denominator = model.inRange.length || 1;
  const barValues = model.bins.map((bin) => yMode === 'percent' ? (bin.count / denominator) * 100 : bin.count);
  const peak = Math.max(...barValues, yMode === 'percent' ? 0.01 : 1);

  hctx.strokeStyle = 'rgba(145,160,183,.18)'; hctx.lineWidth = 1;
  hctx.fillStyle = '#91a0b7'; hctx.font = '10px system-ui';
  for (let step = 0; step <= 5; step += 1) {
    const ratio = step / 5;
    const y = margin.top + chartH * ratio;
    hctx.beginPath(); hctx.moveTo(margin.left, y); hctx.lineTo(width - margin.right, y); hctx.stroke();
    const value = peak * (1 - ratio);
    hctx.textAlign = 'right'; hctx.textBaseline = 'middle'; hctx.fillText(yMode === 'percent' ? `${formatFloat.format(value)}%` : formatInt.format(Math.round(value)), margin.left - 8, y);
  }

  const slot = chartW / model.bins.length;
  const gap = Math.min(3, slot * 0.22);
  model.bins.forEach((bin, index) => {
    const value = barValues[index];
    const barH = (value / peak) * chartH;
    const ratio = model.bins.length === 1 ? 0.5 : index / (model.bins.length - 1);
    hctx.fillStyle = `hsl(${210 - ratio * 190} 78% 58%)`;
    hctx.globalAlpha = state.histogram.selectedBin == null || state.histogram.selectedBin === index ? 0.92 : 0.52;
    hctx.fillRect(margin.left + index * slot + gap / 2, margin.top + chartH - barH, Math.max(1, slot - gap), barH);
    hctx.globalAlpha = 1;
    if (state.histogram.selectedBin === index || state.histogram.hoveredBin === index) {
      hctx.strokeStyle = state.histogram.selectedBin === index ? '#ffffff' : '#56d6c5'; hctx.lineWidth = state.histogram.selectedBin === index ? 2 : 1.2;
      hctx.strokeRect(margin.left + index * slot + gap / 2, margin.top + chartH - barH, Math.max(1, slot - gap), Math.max(1, barH));
    }
  });

  hctx.fillStyle = '#91a0b7'; hctx.textBaseline = 'top';
  const xTickCount = Math.min(8, Math.max(2, Math.floor(chartW / 115)));
  for (let tick = 0; tick <= xTickCount; tick += 1) {
    const ratio = tick / xTickCount;
    const x = margin.left + chartW * ratio;
    const value = model.rangeMin + model.span * ratio;
    hctx.strokeStyle = 'rgba(145,160,183,.24)'; hctx.beginPath(); hctx.moveTo(x, margin.top + chartH); hctx.lineTo(x, margin.top + chartH + 5); hctx.stroke();
    hctx.textAlign = tick === 0 ? 'left' : tick === xTickCount ? 'right' : 'center'; hctx.fillText(display(value), x, margin.top + chartH + 9);
  }
  hctx.textAlign = 'center'; hctx.fillText('Measurement', margin.left + chartW / 2, height - 17);

  const selectedMeasurement = Number(state.selected?.measurement);
  if (Number.isFinite(selectedMeasurement) && selectedMeasurement >= model.rangeMin && selectedMeasurement <= model.rangeMax && String(state.selected?.componentId) === String(state.selectedComponentId)) {
    const ratio = model.rangeMax === model.rangeMin ? 0.5 : (selectedMeasurement - model.rangeMin) / model.span;
    const x = margin.left + ratio * chartW;
    hctx.strokeStyle = '#ffffff'; hctx.lineWidth = 1.5; hctx.setLineDash([5, 4]); hctx.beginPath(); hctx.moveTo(x, margin.top); hctx.lineTo(x, margin.top + chartH); hctx.stroke(); hctx.setLineDash([]);
    hctx.fillStyle = '#ffffff'; hctx.textAlign = x > width * 0.75 ? 'right' : 'left'; hctx.textBaseline = 'top'; hctx.fillText(`Selected ${display(selectedMeasurement)}`, x + (x > width * 0.75 ? -6 : 6), margin.top + 4);
  }

  if (state.histogram.drag) {
    const x1 = Math.max(margin.left, Math.min(margin.left + chartW, state.histogram.drag.startX));
    const x2 = Math.max(margin.left, Math.min(margin.left + chartW, state.histogram.drag.currentX));
    const left = Math.min(x1, x2); const selectionW = Math.abs(x2 - x1);
    hctx.fillStyle = 'rgba(43,167,255,.16)'; hctx.fillRect(left, margin.top, selectionW, chartH);
    hctx.strokeStyle = 'rgba(43,167,255,.9)'; hctx.lineWidth = 1; hctx.strokeRect(left, margin.top, selectionW, chartH);
    const low = model.rangeMin + ((left - margin.left) / chartW) * model.span;
    const high = model.rangeMin + (((left + selectionW) - margin.left) / chartW) * model.span;
    els.histogramSelectionLabel.textContent = `${display(low)} – ${display(high)}`; els.histogramSelectionLabel.classList.remove('hidden');
  } else els.histogramSelectionLabel.classList.add('hidden');

  state.histogram.layout = { ...model, margin, chartW, chartH, slot, width, height, yMode, peak };
  updateSelectedBinDetails(model);
  const binWidth = model.bins.length === 1 ? 0 : model.span / model.bins.length;
  els.detailedHistogramMessage.textContent = `${component?.name || 'Part'} · ช่วง ${display(model.rangeMin)} ถึง ${display(model.rangeMax)} · ${formatInt.format(model.inRange.length)} ค่า · ${model.bins.length} bins${binWidth ? ` · bin width ${display(binWidth)}` : ''}`;
}
function openDetailedHistogram() {
  els.histogramOverlay.classList.remove('hidden');
  requestAnimationFrame(() => { renderDetailedHistogram(); requestAnimationFrame(renderDetailedHistogram); });
}
function closeDetailedHistogram() {
  els.histogramOverlay.classList.add('hidden');
  els.histogramTooltip.classList.add('hidden');
  state.histogram.drag = null; state.histogram.hoveredBin = null;
}
function detailedHistogramPoint(event) {
  const rect = els.detailedHistogramCanvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}
function histogramValueAtX(x, layout = state.histogram.layout) {
  if (!layout) return NaN;
  const ratio = Math.max(0, Math.min(1, (x - layout.margin.left) / layout.chartW));
  return layout.rangeMin + ratio * layout.span;
}
function histogramBinAtPoint(point) {
  const layout = state.histogram.layout;
  if (!layout || point.x < layout.margin.left || point.x > layout.margin.left + layout.chartW || point.y < layout.margin.top || point.y > layout.margin.top + layout.chartH) return null;
  return Math.max(0, Math.min(layout.bins.length - 1, Math.floor((point.x - layout.margin.left) / layout.slot)));
}
function showDetailedHistogramTooltip(event, binIndex) {
  const layout = state.histogram.layout;
  const bin = layout?.bins?.[binIndex];
  if (!bin) { els.histogramTooltip.classList.add('hidden'); return; }
  const denominator = layout.inRange.length || 1;
  els.histogramTooltip.innerHTML = `<strong>${formatHistogramRange(bin.low, bin.high, bin.index === layout.bins.length - 1)}</strong><br>Count: ${formatInt.format(bin.count)}<br>Percent: ${formatFloat.format((bin.count / denominator) * 100)}%<br>Cumulative: ${formatInt.format(bin.cumulative)} (${formatFloat.format((bin.cumulative / denominator) * 100)}%)`;
  const rect = els.detailedHistogramCanvas.getBoundingClientRect();
  const wrapRect = els.detailedHistogramCanvas.parentElement.getBoundingClientRect();
  let left = event.clientX - wrapRect.left + 14; let top = event.clientY - wrapRect.top + 14;
  if (left + 250 > rect.width) left -= 265;
  if (top + 110 > rect.height) top -= 120;
  els.histogramTooltip.style.left = `${Math.max(6, left)}px`; els.histogramTooltip.style.top = `${Math.max(6, top)}px`; els.histogramTooltip.classList.remove('hidden');
}
function setHistogramRange(min, max) {
  const values = measurementValues();
  if (!values.length) return;
  const range = clampHistogramRange(values[0], values[values.length - 1], Number(min), Number(max));
  state.histogram.rangeMin = range.min; state.histogram.rangeMax = range.max; state.histogram.selectedBin = null; state.histogram.hoveredBin = null;
  renderDetailedHistogram(); draw();
}
function applyHistogramRangeFromInputs() {
  const values = measurementValues(); if (!values.length) return;
  const min = els.histogramRangeMin.value === '' ? values[0] : Number(els.histogramRangeMin.value);
  const max = els.histogramRangeMax.value === '' ? values[values.length - 1] : Number(els.histogramRangeMax.value);
  if (!Number.isFinite(min) || !Number.isFinite(max)) { toast('กรุณากรอกช่วง Measurement เป็นตัวเลข'); return; }
  setHistogramRange(min, max);
}
function resetHistogramRange() {
  state.histogram.rangeMin = null; state.histogram.rangeMax = null; state.histogram.selectedBin = null; state.histogram.hoveredBin = null; state.histogram.drag = null;
  els.histogramRangeMin.value = ''; els.histogramRangeMax.value = ''; renderDetailedHistogram(); draw();
}
function zoomToSelectedHistogramBin() {
  const layout = state.histogram.layout; const bin = layout?.bins?.[state.histogram.selectedBin]; if (!bin) return;
  setHistogramRange(bin.low, bin.high);
}
function exportHistogramCsv() {
  const model = buildDetailedHistogramModel(); if (!model.bins.length) { toast('ไม่มี Measurement สำหรับส่งออก'); return; }
  const denominator = model.inRange.length || 1;
  const rows = [['bin','lower_bound','upper_bound','count','percent','cumulative_count','cumulative_percent']];
  for (const bin of model.bins) rows.push([bin.index + 1, bin.low, bin.high, bin.count, (bin.count / denominator) * 100, bin.cumulative, (bin.cumulative / denominator) * 100]);
  const csv = rows.map((row) => row.map(escapeCsv).join(',')).join('\r\n');
  const componentName = currentComponent()?.name || 'part';
  downloadBlob(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }), `${componentName}_measurement_histogram.csv`);
}
function resetHistogramState() {
  state.histogram = { rangeMin: null, rangeMax: null, selectedBin: null, hoveredBin: null, layout: null, drag: null, filterEnabled: false };
  if (els.histogramCadFilter) els.histogramCadFilter.checked = false;
}

function measurementColor(mapping, minMeasurement, maxMeasurement) {
  if (!mapping) return '#506078';
  if (els.heatmapToggle.checked && Number.isFinite(Number(mapping.measurement))) {
    const ratio = maxMeasurement > minMeasurement ? (Number(mapping.measurement) - minMeasurement) / (maxMeasurement - minMeasurement) : 0.5;
    return `hsl(${210 - Math.max(0, Math.min(1, ratio)) * 190} 78% 58%)`;
  }
  return '#62a9e8';
}
function drawGrid(width, height) {
  const spacingWorld = state.view.scale < 5 ? 20 : state.view.scale < 15 ? 10 : state.view.scale < 45 ? 5 : 1; const spacing = spacingWorld * state.view.scale; if (spacing < 12) return;
  const startX = ((state.view.offsetX % spacing) + spacing) % spacing; const startY = ((state.view.offsetY % spacing) + spacing) % spacing; ctx.strokeStyle = 'rgba(80,101,129,.12)'; ctx.lineWidth = 1; ctx.beginPath();
  for (let x = startX; x < width; x += spacing) { ctx.moveTo(x, 0); ctx.lineTo(x, height); } for (let y = startY; y < height; y += spacing) { ctx.moveTo(0, y); ctx.lineTo(width, y); } ctx.stroke();
}
function previewStatusByGlobalId() { const map = new Map(); for (const [globalId, proposal] of state.preview?.lookup || []) map.set(globalId, proposal.status); return map; }
function comparisonRowsForCurrentComponent() {
  const result = state.cadCompare.result; const component = currentComponent();
  if (!result || !component) return [];
  return state.activeCadRole === 'generated'
    ? (result.byGeneratedComponentId.get(String(component.id)) || [])
    : (result.byOriginalComponentId.get(String(component.id)) || []);
}
function drawCadComparisonOverlay(width, height) {
  if (!state.cadCompare.overlayEnabled || !state.cadCompare.result) return;
  const rows = comparisonRowsForCurrentComponent(); if (!rows.length) return;
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const row of rows) {
    const ox = Number(row.originalX), oy = Number(row.originalY), gx = Number(row.generatedX), gy = Number(row.generatedY);
    const hasOriginal = Number.isFinite(ox) && Number.isFinite(oy); const hasGenerated = Number.isFinite(gx) && Number.isFinite(gy);
    const originalPoint = hasOriginal ? worldToScreen(ox, oy) : null; const generatedPoint = hasGenerated ? worldToScreen(gx, gy) : null;
    const selected = state.cadCompare.selectedRow === row;
    if (originalPoint && generatedPoint && row.distance != null && Number(row.distance) > 0.001) {
      ctx.beginPath(); ctx.moveTo(originalPoint.x, originalPoint.y); ctx.lineTo(generatedPoint.x, generatedPoint.y);
      ctx.strokeStyle = selected ? 'rgba(255,255,255,.95)' : 'rgba(255,209,102,.62)'; ctx.lineWidth = selected ? 2 : 1; ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]);
    }
    if (state.activeCadRole !== 'original' && originalPoint && originalPoint.x > -20 && originalPoint.x < width + 20 && originalPoint.y > -20 && originalPoint.y < height + 20) {
      ctx.beginPath(); ctx.arc(originalPoint.x, originalPoint.y, selected ? 7 : 4.5, 0, Math.PI * 2); ctx.strokeStyle = '#56d6c5'; ctx.lineWidth = selected ? 2.5 : 1.3; ctx.stroke();
    }
    if (state.activeCadRole !== 'generated' && generatedPoint && generatedPoint.x > -20 && generatedPoint.x < width + 20 && generatedPoint.y > -20 && generatedPoint.y < height + 20) {
      ctx.beginPath(); ctx.arc(generatedPoint.x, generatedPoint.y, selected ? 7 : 4.5, 0, Math.PI * 2); ctx.strokeStyle = '#ff75dc'; ctx.lineWidth = selected ? 2.5 : 1.3; ctx.stroke();
    }
    if (selected) {
      const labelPoint = state.activeCadRole === 'generated' ? originalPoint : generatedPoint;
      if (labelPoint) { ctx.fillStyle = '#fff'; ctx.font = 'bold 10px ui-monospace, monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText(`${row.originalName || '—'} → ${row.generatedName || '—'}`, labelPoint.x + 9, labelPoint.y - 7); }
    }
  }
  ctx.restore();
}
function draw() {
  const renderStarted = performance.now();
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const width = els.canvas.clientWidth || 1; const height = els.canvas.clientHeight || 1;
  const targetW = Math.round(width * dpr); const targetH = Math.round(height * dpr);
  if (els.canvas.width !== targetW || els.canvas.height !== targetH) { els.canvas.width = targetW; els.canvas.height = targetH; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = '#090f19'; ctx.fillRect(0, 0, width, height); drawGrid(width, height);

  const components = visibleComponents();
  if (!components.length) { els.viewerTitle.textContent = 'ไม่มีข้อมูล'; els.viewerSubtitle.textContent = 'นำเข้าไฟล์เพื่อแสดงตำแหน่ง Land'; return; }
  const boardMode = isBoardView();
  const activeComponent = currentComponent();
  const current = currentMappings();
  const byKey = new Map();
  for (const mapping of current) if (mapping.globalId != null) byKey.set(mappingKey(mapping.componentId, mapping.globalId), mapping);
  const measurements = current.map((m) => Number(m.measurement)).filter(Number.isFinite);
  const minMeasurement = measurements.length ? Math.min(...measurements) : 0;
  const maxMeasurement = measurements.length ? Math.max(...measurements) : 1;
  const histogramFilterActive = Boolean(state.histogram.filterEnabled && measurements.length);
  const histogramFilterMin = state.histogram.rangeMin == null ? minMeasurement : Number(state.histogram.rangeMin);
  const histogramFilterMax = state.histogram.rangeMax == null ? maxMeasurement : Number(state.histogram.rangeMax);
  const previewByGlobal = boardMode ? new Map() : previewStatusByGlobalId();
  const activeDuplicates = boardMode ? new Map() : duplicateGroupsForComponent(activeComponent);
  const duplicateLandCount = [...activeDuplicates.values()].reduce((sum, lands) => sum + lands.length, 0);

  if (boardMode) {
    els.viewerTitle.textContent = `${state.xmlData?.board?.Name || 'CAD Board'} · ทั้งบอร์ด`;
    els.viewerSubtitle.textContent = `${formatInt.format(components.length)} Components · ${formatInt.format(state.xmlData?.totalLands || 0)} lands · คลิกจุดหรือเลือก Component เพื่อดูรายละเอียด · scale ${state.view.scale.toFixed(2)} px/mm`;
  } else {
    els.viewerTitle.textContent = `${activeComponent.name} · ${activeComponent.packageName || 'Unknown package'}`;
    els.viewerSubtitle.textContent = `${formatInt.format(activeComponent.lands.length)} lands · ชื่อซ้ำ ${formatInt.format(activeDuplicates.size)} กลุ่ม / ${formatInt.format(duplicateLandCount)} จุด · scale ${state.view.scale.toFixed(1)} px/mm${state.preview ? ' · Preview active' : ''}`;
  }

  const showLandLabels = els.labelToggle.checked && state.view.scale >= (boardMode ? 48 : 28);
  const showComponentLabels = boardMode && state.view.scale >= 1.2;
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.font = '9px ui-monospace, monospace';

  if (!boardMode) {
    const selectedDuplicateGroup = state.duplicateView.enabled ? (activeDuplicates.get(state.duplicateView.selectedName) || []) : [];
    if (selectedDuplicateGroup.length > 1) {
      const points = selectedDuplicateGroup.map((land) => worldToScreen(land.centerX, land.centerY)).filter((point) => point.x > -100 && point.x < width + 100 && point.y > -100 && point.y < height + 100);
      if (points.length > 1) { ctx.save(); ctx.setLineDash([6, 5]); ctx.strokeStyle = 'rgba(255,209,102,.72)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y); for (const point of points.slice(1)) ctx.lineTo(point.x, point.y); ctx.stroke(); ctx.restore(); }
    }
  }

  for (const component of components) {
    const duplicateGroups = boardMode ? new Map() : activeDuplicates;
    const duplicateEnabled = !boardMode && state.duplicateView.enabled && duplicateGroups.size > 0;
    if (component.bounds) {
      const p1 = worldToScreen(component.bounds.minX - 0.6, component.bounds.maxY + 0.6);
      const p2 = worldToScreen(component.bounds.maxX + 0.6, component.bounds.minY - 0.6);
      ctx.strokeStyle = boardMode ? 'rgba(96,165,250,.18)' : 'rgba(86,214,197,.28)'; ctx.lineWidth = boardMode ? 0.7 : 1;
      ctx.strokeRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
      if (showComponentLabels) {
        const labelX = (p1.x + p2.x) / 2; const labelY = Math.min(p1.y, p2.y) - 3;
        if (labelX > -120 && labelX < width + 120 && labelY > -20 && labelY < height + 20) {
          ctx.fillStyle = 'rgba(190,220,255,.88)'; ctx.font = 'bold 9px system-ui, sans-serif';
          ctx.fillText(component.name || `ID ${component.id}`, labelX, labelY); ctx.font = '9px ui-monospace, monospace';
        }
      }
    }

    for (const land of component.lands) {
      const point = worldToScreen(land.centerX, land.centerY);
      if (point.x < -15 || point.x > width + 15 || point.y < -15 || point.y > height + 15) continue;
      const mapping = byKey.get(mappingKey(component.id, land.globalId));
      const previewStatus = boardMode ? null : previewByGlobal.get(Number(land.globalId));
      const radius = Math.max(boardMode ? 0.65 : 1.1, Math.min(boardMode ? 4.5 : 8, (land.width || 0.5) * state.view.scale * 0.42));
      const duplicateGroup = duplicateGroups.get(String(land.cadName || '').trim());
      const isDuplicate = Boolean(duplicateGroup); const isSelectedDuplicate = isDuplicate && String(land.cadName || '').trim() === state.duplicateView.selectedName;
      const measurement = Number(mapping?.measurement);
      const insideHistogramRange = !histogramFilterActive || (Number.isFinite(measurement) && measurement >= histogramFilterMin && measurement <= histogramFilterMax);
      let landAlpha = histogramFilterActive ? (insideHistogramRange ? (mapping ? (isVerifiedMapping(mapping) ? 0.98 : 0.58) : 0.28) : 0.07) : (mapping ? (isVerifiedMapping(mapping) ? 0.96 : 0.55) : (boardMode ? 0.68 : 0.42));
      if (duplicateEnabled && state.duplicateView.dimOthers && !isDuplicate) landAlpha *= 0.1;
      ctx.beginPath(); ctx.arc(point.x, point.y, radius, 0, Math.PI * 2); ctx.fillStyle = measurementColor(mapping, minMeasurement, maxMeasurement); ctx.globalAlpha = landAlpha; ctx.fill(); ctx.globalAlpha = 1;
      if (histogramFilterActive && insideHistogramRange && mapping) { ctx.beginPath(); ctx.arc(point.x, point.y, Math.max(2, radius + 1), 0, Math.PI * 2); ctx.strokeStyle = 'rgba(86,214,197,.72)'; ctx.lineWidth = 0.9; ctx.stroke(); }
      if (previewStatus) { ctx.beginPath(); ctx.arc(point.x, point.y, Math.max(2.5, radius + 1.5), 0, Math.PI * 2); ctx.strokeStyle = ['conflict', 'anchor-conflict', 'out-of-range'].includes(previewStatus) ? '#ff6b75' : '#2ba7ff'; ctx.globalAlpha = 0.72; ctx.lineWidth = 1; ctx.stroke(); ctx.globalAlpha = 1; }
      if (isVerifiedMapping(mapping) && !boardMode) { ctx.beginPath(); ctx.arc(point.x, point.y, Math.max(3.5, radius + 2.7), 0, Math.PI * 2); ctx.strokeStyle = mapping?.anchorLocked ? '#66e39f' : '#9ff2c0'; ctx.lineWidth = mapping?.anchorLocked ? 2 : 1.5; ctx.stroke(); }
      else if (mapping && !boardMode) { ctx.beginPath(); ctx.arc(point.x, point.y, Math.max(2.8, radius + 1.6), 0, Math.PI * 2); ctx.strokeStyle = 'rgba(255,189,91,.48)'; ctx.lineWidth = 0.9; ctx.stroke(); }
      if (duplicateEnabled && isDuplicate) {
        ctx.beginPath(); ctx.arc(point.x, point.y, Math.max(4, radius + (isSelectedDuplicate ? 5 : 2.5)), 0, Math.PI * 2);
        ctx.strokeStyle = isSelectedDuplicate ? '#ffd166' : '#ff5bd3'; ctx.lineWidth = isSelectedDuplicate ? 2.4 : 1.35; ctx.stroke();
      }
      const selected = state.selected && String(state.selected.componentId) === String(component.id) && Number(state.selected.globalId) === Number(land.globalId);
      if (selected) { ctx.beginPath(); ctx.arc(point.x, point.y, Math.max(5, radius + 4), 0, Math.PI * 2); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.stroke(); }
      if ((showLandLabels && radius > 1.5) || (duplicateEnabled && isSelectedDuplicate)) { ctx.fillStyle = isSelectedDuplicate ? '#ffe39a' : '#d9e5f5'; ctx.fillText(land.cadName, point.x, point.y - Math.max(radius, 3) - 2); }
    }
  }
  if (!boardMode) drawCadComparisonOverlay(width, height);
  const renderDuration = performance.now() - renderStarted;
  if (renderDuration >= 8) state.diagnostics.record('render', renderDuration, { components: components.length, lands: components.reduce((sum, item) => sum + (item.lands?.length || 0), 0), boardMode });
}

function componentForLand(land) { return land?.componentId != null ? state.xmlData?.componentById.get(String(land.componentId)) || null : null; }
function mappingForLand(land) {
  if (!land || !state.mappingData) return null;
  return state.mappingData.mappings.find((mapping) => String(mapping.componentId) === String(land.componentId) && Number(mapping.globalId) === Number(land.globalId)) || null;
}
function findNearestLand(screenX, screenY) {
  const components = visibleComponents(); if (!components.length) return null;
  const scope = String(state.selectedComponentId || BOARD_VIEW);
  if (!state.viewerSpatialIndex || state.viewerSpatialIndex.source !== state.xmlData || state.viewerSpatialIndex.scope !== scope) {
    state.viewerSpatialIndex = { source: state.xmlData, scope, index: buildLandSpatialIndex(components, 2) };
  }
  const world = screenToWorld(screenX, screenY); const threshold = Math.max(0.35, 12 / state.view.scale); let best = null; let bestD2 = threshold * threshold;
  for (const item of state.viewerSpatialIndex.index.queryRadius(world.x, world.y, threshold)) {
    const dx = item.x - world.x; const dy = item.y - world.y; const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) { best = item.value; bestD2 = d2; }
  }
  return best;
}
function showTooltip(event, land) {
  if (!land) { els.tooltip.classList.add('hidden'); return; }
  const component = componentForLand(land);
  const mapping = mappingForLand(land);
  const preview = !isBoardView() ? state.preview?.lookup?.get(Number(land.globalId)) : null;
  const duplicateCount = duplicateGroupsForComponent(component).get(String(land.cadName || '').trim())?.length || 1;
  els.tooltip.innerHTML = `<strong>${escapeHtml(mapping?.alias || land.cadName)}</strong><br>Component: ${escapeHtml(component?.name || land.componentId || '—')}<br>Package: ${escapeHtml(component?.packageName || '—')}<br>X-ray: ${escapeHtml(mapping?.localIndex ?? '—')}<br>XML ID: ${escapeHtml(land.globalId)}<br>X: ${formatFloat.format(land.centerX)} · Y: ${formatFloat.format(land.centerY)}${mapping ? `<br>Measurement: ${escapeHtml(mapping.measurement ?? '—')}<br>Status: ${isVerifiedMapping(mapping) ? 'Confirmed' : 'Unverified'}` : ''}${duplicateCount > 1 ? `<br><b>ชื่อซ้ำ ${duplicateCount} ตำแหน่ง</b>` : ''}${preview ? `<br>Preview: X-ray ${escapeHtml(preview.localIndex)} · ${escapeHtml(preview.status)}` : ''}`;
  const rect = els.canvas.getBoundingClientRect(); els.tooltip.style.left = `${Math.min(rect.width - 220, event.clientX - rect.left + 13)}px`; els.tooltip.style.top = `${Math.min(rect.height - 160, event.clientY - rect.top + 13)}px`; els.tooltip.classList.remove('hidden');
}
async function directRemap(mapping, land, label = 'Edit mapping') {
  const component = currentComponent();
  if (!component || !mapping || !land || mapping.sourceRow == null) return;
  const occupied = currentMappings().find((item) => item !== mapping && item.mapped && Number(item.globalId) === Number(land.globalId));
  const changes = [];

  if (occupied) {
    if (isVerifiedMapping(occupied)) {
      const proceed = await requestAppConfirm({ title: 'ตำแหน่ง Mapping ซ้ำ', message: `ตำแหน่ง ${land.cadName} ถูกยืนยันให้ X-ray ${occupied.localIndex} อยู่แล้ว`, detail: `รายการเดิมจะถูก Unmap และเก็บใน Mapping History`, confirmText: 'Yes - ย้าย Mapping', destructive: true });
      if (!proceed) return;
    }
    changes.push({
      mapping: occupied,
      before: snapshotMapping(occupied),
      after: stateForUnmapped(occupied, { mappingMethod: isVerifiedMapping(occupied) ? 'displaced-confirmed' : 'displaced-auto-guess' }),
    });
  }

  const lockConfirmed = state.edit.enabled ? state.edit.lockConfirmed : true;
  changes.push({
    mapping,
    before: snapshotMapping(mapping),
    after: stateForLand(mapping, land, {
      manual: true,
      verified: true,
      anchorLocked: lockConfirmed,
      confidence: 100,
      mappingMethod: 'manual-direct',
      duplicateCadNameCount: duplicateCountForLand(land),
    }),
  });

  if (!applyTransaction(label, changes)) {
    if (!isVerifiedMapping(mapping)) {
      const before = snapshotMapping(mapping);
      const after = { ...before, manual: true, verified: true, anchorLocked: lockConfirmed, confidence: 100, mappingMethod: 'manual-direct' };
      applyTransaction('Confirm current mapping', [{ mapping, before, after }]);
    } else return;
  }

  state.selected = mapping;
  toast(`ยืนยัน X-ray ${mapping.localIndex} → ${land.cadName}${occupied ? ` · Unmap X-ray ${occupied.localIndex}` : ''}`);
  if (state.edit.enabled && state.edit.autoNext) advanceSelected(1);
  else { updateDetails(); updateEditPanel(); renderTable(); draw(); }
}
async function selectLand(land) {
  if (!land) return;
  const component = componentForLand(land);
  if (isBoardView() && component) {
    state.selectedComponentId = String(component.id);
    els.componentSelect.value = String(component.id);
    state.duplicateView.selectedName = '';
    refreshDuplicateControls();
  }
  if (state.edit.enabled && state.selected?.sourceRow != null) {
    await directRemap(state.selected, land);
    return;
  }
  const existing = mappingForLand(land);
  if (existing) selectMapping(existing, true);
  else if (state.edit.enabled) toast('ตำแหน่งนี้ยังไม่มี X-ray Land เลือกแถว X-ray จากตารางก่อน แล้วคลิกตำแหน่งนี้อีกครั้ง');
  else {
    selectMapping({ sourceRow: null, componentName: component?.name, packageName: component?.packageName, localIndex: land.localIndex, componentId: land.componentId, globalId: land.globalId, cadName: land.cadName, left: land.left, top: land.top, centerX: land.centerX, centerY: land.centerY, width: land.width, length: land.length, measurement: null, confidence: 0, mapped: true, manual: false, verified: false, anchorLocked: false, mappingMethod: 'xml-only', duplicateCadNameCount: duplicateCountForLand(land), raw: null }, true);
  }
}
function toggleAnchor() {
  const mapping = state.selected; if (!mapping?.mapped) return; const before = snapshotMapping(mapping);
  const locking = !mapping.anchorLocked;
  const after = { ...before, anchorLocked: locking, manual: true, verified: locking ? true : Boolean(mapping.verified), confidence: locking ? 100 : mapping.confidence, mappingMethod: locking ? 'manual-anchor' : (mapping.verified ? 'manual-direct' : 'manual-unverified') };
  applyTransaction(locking ? 'Lock anchor' : 'Unlock anchor', [{ mapping, before, after }]); toast(locking ? `ล็อก X-ray ${mapping.localIndex} เป็น Anchor แล้ว` : `ปลด Anchor X-ray ${mapping.localIndex} แล้ว`);
}
async function unmapSelected() {
  const mapping = state.selected; if (!mapping?.mapped) return; if (!(await requestAppConfirm({ title: 'ยกเลิก Mapping?', message: `X-ray Land ${mapping.localIndex} จะกลับเป็นสถานะ Unmapped`, confirmText: 'Yes - Unmap', destructive: true }))) return;
  applyTransaction('Unmap selected land', [{ mapping, before: snapshotMapping(mapping), after: stateForUnmapped(mapping) }]); toast(`ยกเลิก Mapping X-ray ${mapping.localIndex} แล้ว`);
}
async function nudgeSelected(delta) {
  const mapping = state.selected; const component = currentComponent(); if (!mapping?.mapped || !component) return; const index = findLandIndex(component, mapping.globalId); const land = component.lands[index + delta];
  if (!land) return toast('ไม่สามารถเลื่อนได้ เพราะถึงขอบเขต CAD แล้ว'); await directRemap(mapping, land, `Nudge selected ${delta > 0 ? '+1' : '-1'}`);
}
function search() {
  const query = els.searchInput.value.trim(); if (!query) return;
  const mappings = state.mappingData?.mappings || [];
  const lower = query.toLowerCase();
  const number = Number(query);
  let matches = currentMappings().filter((m) =>
    String(m.rawLandId ?? m.localIndex ?? '').trim().toLowerCase() === lower ||
    String(m.cadName || '').trim().toLowerCase() === lower ||
    String(m.alias || '').trim().toLowerCase() === lower
  );
  if (!matches.length) matches = mappings.filter((m) =>
    String(m.rawLandId ?? m.localIndex ?? '').trim().toLowerCase() === lower ||
    String(m.cadName || '').trim().toLowerCase() === lower ||
    String(m.alias || '').trim().toLowerCase() === lower
  );
  if (!matches.length && Number.isInteger(number)) matches = mappings.filter((m) => Number(m.globalId) === number);
  if (!matches.length && state.xmlData) {
    for (const component of state.xmlData.components) {
      for (const land of component.lands) {
        if (String(land.cadName).toLowerCase() === lower || Number(land.globalId) === number) {
          state.selectedComponentId = component.id; els.componentSelect.value = component.id; state.duplicateView.selectedName = '';
          refreshDuplicateControls(); fitView(); selectLand(land);
          if (duplicateCountForLand(land) > 1) setSelectedDuplicateName(String(land.cadName).trim(), { fit: true });
          toast('พบใน CAD แต่ไม่มีแถวข้อมูลที่จับคู่'); return;
        }
      }
    }
  }
  if (!matches.length) return toast(`ไม่พบ ${query}`);
  selectMapping(matches[0], true);
  const name = String(matches[0].cadName || '').trim(); const duplicateLands = duplicateGroupsForComponent().get(name) || [];
  if (duplicateLands.length > 1) { setSelectedDuplicateName(name, { fit: true }); toast(`ชื่อ ${name} ซ้ำ ${duplicateLands.length} ตำแหน่ง และแสดงครบทุกจุดบนกราฟิก`); }
  else if (matches.length > 1) toast(`พบ ${matches.length} ตำแหน่ง เลือกตำแหน่งแรก`);
}
function openTeachPanel() { if (!state.mappingData) return; els.teachOverlay.classList.remove('hidden'); renderTeachPanel(); }
function closeTeachPanel() { els.teachOverlay.classList.add('hidden'); }
function renderTeachPanel() {
  const component = currentComponent(); const mappings = currentMappings(); const anchors = mappings.filter((mapping) => mapping.anchorLocked).sort((a, b) => mappingOrder(a) - mappingOrder(b));
  els.teachComponentLabel.textContent = component ? `${component.name} · ${formatInt.format(component.lands.length)} CAD lands · ${formatInt.format(mappings.length)} X-ray rows` : 'ยังไม่มี Component';
  els.anchorCountLabel.textContent = `${formatInt.format(anchors.length)} จุด`; els.anchorList.innerHTML = '';
  if (!anchors.length) els.anchorList.innerHTML = '<p class="empty-state">ยังไม่มี Anchor — เลือก Land แล้วกด “ล็อกเป็น Anchor”</p>';
  else {
    const fragment = document.createDocumentFragment();
    for (const mapping of anchors) {
      const item = document.createElement('div'); item.className = 'anchor-item'; const left = document.createElement('div'); left.innerHTML = `<span>X-ray</span><br><strong>${escapeHtml(mapping.localIndex)}</strong>`; const middle = document.createElement('div'); middle.innerHTML = `<span>CAD / XML</span><br><strong>${escapeHtml(mapping.cadName || '—')} · ${escapeHtml(mapping.globalId ?? '—')}</strong>`;
      const button = document.createElement('button'); button.type = 'button'; button.textContent = 'ปลด'; button.addEventListener('click', () => { state.selected = mapping; toggleAnchor(); }); item.append(left, middle, button); fragment.append(item);
    }
    els.anchorList.append(fragment);
  }
  els.clearAnchorsButton.disabled = anchors.length === 0; els.fillBetweenButton.disabled = anchors.length < 2; renderPreviewSummary();
}
function readPatternOptions(overrides = {}) {
  const optionalNumber = (value) => value === '' ? null : Number(value);
  return { mappings: currentMappings(), component: currentComponent(), direction: overrides.direction || els.patternDirection.value, userShift: overrides.userShift ?? Number(els.patternShift.value || 0), startLocal: overrides.startLocal ?? optionalNumber(els.patternStart.value), endLocal: overrides.endLocal ?? optionalNumber(els.patternEnd.value), preserveAnchors: els.preserveAnchors.checked };
}
function createPatternPreview(overrides = {}) {
  const preview = createSequencePreview(readPatternOptions(overrides)); if (!preview.ok) return toast(preview.error, 4200);
  preview.lookup = new Map(preview.proposals.filter((proposal) => proposal.land).map((proposal) => [Number(proposal.land.globalId), proposal])); state.preview = preview;
  if (overrides.direction) els.patternDirection.value = overrides.direction; if (overrides.startLocal != null) els.patternStart.value = overrides.startLocal; if (overrides.endLocal != null) els.patternEnd.value = overrides.endLocal;
  renderPreviewSummary(); renderTable(); draw(); toast(`Safe Preview: ${formatInt.format(preview.counts.segments || 0)} ช่วง · ข้อเสนอ ${formatInt.format(preview.counts.highConfidence)}`);
}
function previewBetweenAnchors() { const range = getAnchorRange(currentMappings()); if (!range) return toast('ต้องมี Anchor อย่างน้อย 2 จุด'); createPatternPreview({ startLocal: range.start, endLocal: range.end }); }
function clearPreview() { state.preview = null; if (!state.edit.enabled) els.manualBanner.classList.add('hidden'); els.manualBanner.classList.remove('preview-active'); renderPreviewSummary(); renderTable(); draw(); }
function renderPreviewSummary() {
  const preview = state.preview;
  if (!preview) {
    els.previewTitle.textContent = 'ยังไม่มี Preview'; els.previewDirectionBadge.textContent = '—'; els.previewDirectionBadge.className = 'status-pill muted'; els.previewApplicable.textContent = '0'; els.previewHigh.textContent = '0'; els.previewReview.textContent = '0'; els.previewConflict.textContent = '0'; els.previewFormula.textContent = 'วาง Anchor แล้วกดสร้าง Preview'; els.previewWarning.classList.add('hidden'); els.applyPatternButton.disabled = true; els.applyHighButton.disabled = true; els.clearPreviewButton.disabled = true; return;
  }
  const counts = preview.counts; els.previewTitle.textContent = `${formatInt.format(counts.total)} จุดในช่วง ${preview.range.start}–${preview.range.end}`; els.previewDirectionBadge.textContent = preview.direction === 'mixed' ? 'Mixed' : (preview.direction === 'reverse' ? 'Reverse' : 'Forward'); els.previewDirectionBadge.className = 'status-pill ready';
  els.previewApplicable.textContent = formatInt.format(counts.applicable); els.previewHigh.textContent = formatInt.format(counts.highConfidence); els.previewReview.textContent = formatInt.format(counts.rejectedSegments || 0); els.previewConflict.textContent = formatInt.format(counts.conflicts + counts.outOfRange); els.previewFormula.innerHTML = `${escapeHtml(preview.formula)}<br>Anchor ${counts.anchors} จุด · ช่วงที่ผ่าน ${counts.segments || 0} · ช่วงที่ไม่ผ่าน ${counts.rejectedSegments || 0}`;
  const warnings = []; if (counts.rejectedSegments) warnings.push(`ข้าม ${counts.rejectedSegments} ช่วง เพราะ Anchor ไม่พิสูจน์ลำดับต่อเนื่อง`); if (counts.conflicts || counts.outOfRange) warnings.push(`มี Conflict/Out of range ${counts.conflicts + counts.outOfRange} จุด ระบบจะไม่ Apply จุดเหล่านี้`); warnings.push('ผล Pattern เป็นเพียงข้อเสนอ ยังไม่ถือว่า Confirmed');
  if (warnings.length) { els.previewWarning.textContent = warnings.join(' · '); els.previewWarning.classList.remove('hidden'); } else els.previewWarning.classList.add('hidden');
  els.applyPatternButton.disabled = counts.applicable === 0; els.applyHighButton.disabled = counts.highConfidence === 0; els.clearPreviewButton.disabled = false;
}
function applyPattern(highOnly = false) {
  const preview = state.preview; if (!preview) return; const changes = [];
  for (const proposal of preview.proposals) {
    if (!proposal.land || proposal.status !== 'suggested' || (highOnly && proposal.confidence < 95) || proposal.mapping.anchorLocked || isVerifiedMapping(proposal.mapping)) continue;
    changes.push({ mapping: proposal.mapping, before: snapshotMapping(proposal.mapping), after: stateForLand(proposal.mapping, proposal.land, { manual: false, verified: false, anchorLocked: false, confidence: 60, mappingMethod: 'pattern-suggestion', duplicateCadNameCount: duplicateCountForLand(proposal.land) }) });
  }
  if (!changes.length) return toast('ไม่มีข้อเสนอที่สามารถ Apply ได้');
  applyTransaction('Apply safe pattern suggestions', changes);
  toast(`ใช้เป็นข้อเสนอแล้ว ${formatInt.format(changes.length)} จุด · ยังไม่ Confirmed`);
}
async function clearAllAnchors() {
  const anchors = currentMappings().filter((mapping) => mapping.anchorLocked); if (!anchors.length) return; if (!(await requestAppConfirm({ title: 'ปลด Anchor ทั้งหมด?', message: `Anchor ${anchors.length} จุดจะถูกปลด แต่ Confirmed Mapping จะยังคงอยู่`, confirmText: 'Yes - ปลด Anchor' }))) return;
  const changes = anchors.map((mapping) => ({ mapping, before: snapshotMapping(mapping), after: { ...snapshotMapping(mapping), anchorLocked: false, verified: Boolean(mapping.verified), mappingMethod: mapping.verified ? 'manual-direct' : 'local-order-guess' } })); applyTransaction('Clear all anchors', changes); toast('ปลด Anchor ทั้งหมดแล้ว');
}
async function shiftCurrentMappings(delta) {
  const component = currentComponent(); if (!component) return; const start = els.patternStart.value === '' ? -Infinity : Number(els.patternStart.value); const end = els.patternEnd.value === '' ? Infinity : Number(els.patternEnd.value);
  const moving = currentMappings().filter((m) => mappingOrder(m) >= Math.min(start, end) && mappingOrder(m) <= Math.max(start, end)); const movingSet = new Set(moving);
  const occupiedOutside = new Set(currentMappings().filter((m) => (!movingSet.has(m) || m.anchorLocked) && m.mapped).map((m) => Number(m.globalId))); const changes = [];
  for (const mapping of moving) {
    if (!mapping.mapped || mapping.anchorLocked || isVerifiedMapping(mapping)) continue; const index = findLandIndex(component, mapping.globalId); const land = component.lands[index + delta]; if (!land || occupiedOutside.has(Number(land.globalId))) continue;
    changes.push({ mapping, before: snapshotMapping(mapping), after: stateForLand(mapping, land, { manual: false, verified: false, anchorLocked: false, confidence: 30, mappingMethod: `shift-suggestion-${delta > 0 ? 'plus' : 'minus'}1`, duplicateCadNameCount: duplicateCountForLand(land) }) });
  }
  if (!changes.length) return toast('ไม่มีรายการที่เลื่อนได้ หรือชนกับ Anchor/ขอบเขต'); if (!(await requestAppConfirm({ title: 'Shift Mapping?', message: `เลื่อน Candidate ${delta > 0 ? '+1' : '-1'} จำนวน ${changes.length} จุด`, detail: 'Confirmed Mapping และ Anchor จะไม่ถูกเลื่อน', confirmText: 'Yes - Shift' }))) return; applyTransaction(`Shift mappings ${delta > 0 ? '+1' : '-1'}`, changes); toast(`Shift แล้ว ${formatInt.format(changes.length)} จุด`);
}
async function unmapRange() {
  const start = els.patternStart.value === '' ? -Infinity : Number(els.patternStart.value); const end = els.patternEnd.value === '' ? Infinity : Number(els.patternEnd.value);
  const targets = currentMappings().filter((m) => mappingOrder(m) >= Math.min(start, end) && mappingOrder(m) <= Math.max(start, end) && !m.anchorLocked && m.mapped);
  if (!targets.length) return toast('ไม่มีรายการในช่วงที่สามารถ Unmap ได้'); if (!(await requestAppConfirm({ title: 'Unmap ช่วงที่เลือก?', message: `Unmap ${targets.length} จุด โดยรักษา Anchor`, confirmText: 'Yes - Unmap', destructive: true }))) return; applyTransaction('Unmap range', targets.map((mapping) => ({ mapping, before: snapshotMapping(mapping), after: stateForUnmapped(mapping) }))); toast(`Unmap แล้ว ${formatInt.format(targets.length)} จุด`);
}

function counterpartComponent(role, component) {
  const data = state.cadFiles[role]?.data;
  if (!data || !component) return null;
  const exact = data.componentById.get(String(component.id));
  if (exact) return exact;
  const sameName = data.components.filter((candidate) => String(candidate.name).trim().toLowerCase() === String(component.name).trim().toLowerCase());
  return sameName.find((candidate) => String(candidate.packageName).trim().toLowerCase() === String(component.packageName).trim().toLowerCase()) || sameName[0] || null;
}
function reportComponents(scope = els.componentReportScope.value) {
  if (!state.xmlData) return [];
  if (scope === 'all') return state.xmlData.components.filter((item) => item.lands?.length);
  if (scope === 'raw' && state.mappingData?.componentSummaries?.length) {
    const ids = [...new Set(state.mappingData.componentSummaries.filter((item) => item.componentId != null).map((item) => String(item.componentId)))];
    return ids.map((id) => state.xmlData.componentById.get(id)).filter(Boolean);
  }
  const component = currentComponent() || state.xmlData.components.find((item) => item.lands.length) || null;
  return component ? [component] : [];
}
function componentReportRows(component, nameSource) {
  const mappings = new Map();
  for (const mapping of state.mappingData?.mappings || []) {
    if (String(mapping.componentId) === String(component.id) && mapping.globalId != null) mappings.set(Number(mapping.globalId), mapping);
  }
  const originalComponent = counterpartComponent('original', component);
  const generatedComponent = counterpartComponent('generated', component);
  const originalById = new Map((originalComponent?.lands || []).map((land) => [Number(land.globalId), land]));
  const generatedById = new Map((generatedComponent?.lands || []).map((land) => [Number(land.globalId), land]));
  const rows = component.lands.map((land) => {
    const mapping = mappings.get(Number(land.globalId));
    const originalLand = originalById.get(Number(land.globalId)) || originalComponent?.lands?.[Number(land.localIndex) - 1] || null;
    const generatedLand = generatedById.get(Number(land.globalId)) || generatedComponent?.lands?.[Number(land.localIndex) - 1] || null;
    const originalCadName = originalLand?.cadName || '';
    const generatedCadName = generatedLand?.cadName || '';
    const activeRename = state.cadInspector.renames.get(cadLandKey(component.id, land.globalId));
    const cadName = nameSource === 'original' ? (originalCadName || land.cadName || '')
      : nameSource === 'generated' ? (generatedCadName || land.cadName || '')
        : (activeRename || land.cadName || '');
    const measurementNumber = Number(mapping?.measurement);
    return {
      componentName: component.name || `ID ${component.id}`,
      packageName: component.packageName || '', localIndex: land.localIndex, xrayLand: mapping?.localIndex ?? null,
      globalId: land.globalId, cadName, originalCadName, generatedCadName,
      centerX: land.centerX, centerY: land.centerY, width: land.width, length: land.length,
      measurement: mapping?.measurement == null || mapping?.measurement === '' || !Number.isFinite(measurementNumber) ? null : measurementNumber,
      confirmed: isVerifiedMapping(mapping), mappingStatus: mapping ? (isVerifiedMapping(mapping) ? 'Confirmed' : (mapping.mapped ? 'Unverified' : 'Unmapped')) : 'CAD only',
      duplicateCount: 1, zone: '',
    };
  });
  const counts = new Map();
  for (const item of rows) { const key = String(item.cadName || '').trim(); if (key) counts.set(key, (counts.get(key) || 0) + 1); }
  for (const item of rows) item.duplicateCount = counts.get(String(item.cadName || '').trim()) || 1;
  return rows;
}

function updateComponentReportPreview() {
  const components = reportComponents();
  const zones = Math.max(2, Math.min(4, Number(els.componentReportZones.value) || 3));
  const landCount = components.reduce((sum, component) => sum + component.lands.length, 0);
  const ids = new Set(components.map((component) => String(component.id)));
  const measurements = (state.mappingData?.mappings || []).filter((mapping) => ids.has(String(mapping.componentId)) && Number.isFinite(Number(mapping.measurement))).length;
  els.componentReportPartCount.textContent = formatInt.format(components.length);
  els.componentReportLandCount.textContent = formatInt.format(landCount);
  els.componentReportZoneCount.textContent = formatInt.format(components.length * zones * zones);
  els.componentReportMeasurementCount.textContent = formatInt.format(measurements);
  const rawAvailable = Boolean(state.mappingData?.componentSummaries?.some((item) => item.componentId != null));
  [...els.componentReportScope.options].find((option) => option.value === 'raw').disabled = !rawAvailable;
  if (!rawAvailable && els.componentReportScope.value === 'raw') els.componentReportScope.value = 'current';
  const originalOption = [...els.componentReportNameSource.options].find((option) => option.value === 'original');
  const generatedOption = [...els.componentReportNameSource.options].find((option) => option.value === 'generated');
  originalOption.disabled = !state.cadFiles.original;
  generatedOption.disabled = !state.cadFiles.generated;
  if (els.componentReportNameSource.selectedOptions[0]?.disabled) els.componentReportNameSource.value = 'active';
  els.generateComponentReportButton.disabled = !components.length;
  els.componentReportMessage.textContent = components.length
    ? `จะสร้าง ${formatInt.format(components.length)} Component · ${formatInt.format(landCount)} Land · ${formatInt.format(components.length * zones * zones)} ภาพขยาย` 
    : 'ไม่พบ Component สำหรับสร้างรายงาน';
}
function openComponentReport() {
  if (!state.xmlData) return toast('กรุณานำเข้า CAD ก่อน');
  els.componentReportOverlay.classList.remove('hidden');
  updateComponentReportPreview();
}
function closeComponentReport() {
  els.componentReportOverlay.classList.add('hidden');
}
function reportFileStem(value) {
  return String(value || 'component').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9ก-๙_-]+/g, '_').replace(/^_+|_+$/g, '') || 'component';
}
async function generateComponentReport() {
  let components = reportComponents();
  if (!components.length) return toast('ไม่พบ Component สำหรับสร้างรายงาน');
  if (els.componentReportScope.value === 'all' && components.length > 80) {
    toast(`CAD มี ${formatInt.format(components.length)} Components · รายงานภาพจำกัด 80 Components ต่อไฟล์เพื่อป้องกัน Excel ค้าง`, 5200);
    components = components.slice(0, 80);
  }
  const grid = Math.max(2, Math.min(4, Number(els.componentReportZones.value) || 3));
  const labels = els.componentReportLabels.value;
  const nameSource = els.componentReportNameSource.value;
  const width = Math.max(1400, Math.min(3200, Number(els.componentReportResolution.value) || 2200));
  const height = Math.round(width * 0.66);
  const heatmap = els.componentReportHeatmap.checked;
  const dialog = els.componentReportOverlay.querySelector('.component-report-dialog');
  const oldText = els.generateComponentReportButton.textContent;
  dialog?.classList.add('is-building'); els.generateComponentReportButton.disabled = true; els.generateComponentReportButton.textContent = 'กำลังสร้าง…';
  try {
    const file = activeCadFile();
    const preflight = assertAppliedRevisionExportable(file, file?.editorModel || null);
    const exportMetadata = projectExportMetadata(file, 'xlsx-component-report', validationStatusFromPreflight(preflight));
    const reportComponentsData = [];
    for (let componentIndex = 0; componentIndex < components.length; componentIndex += 1) {
      const component = components[componentIndex];
      els.componentReportMessage.textContent = `กำลังเตรียม ${component.name} (${componentIndex + 1}/${components.length})…`; await nextFrame();
      const rows = componentReportRows(component, nameSource);
      const layout = buildZones(component, rows, grid);
      const overviewCanvas = renderOverviewImage({ component, rows, bounds: layout.bounds, zones: layout.zones, width, height, heatmap });
      const overviewPng = await canvasToPngBytes(overviewCanvas);
      const zones = [];
      for (let zoneIndex = 0; zoneIndex < layout.zones.length; zoneIndex += 1) {
        const zone = layout.zones[zoneIndex];
        els.componentReportMessage.textContent = `กำลังวาด ${component.name} · Zone ${zone.label} (${zoneIndex + 1}/${layout.zones.length})…`; await nextFrame();
        const zoneCanvas = renderZoneImage({ component, zone, width, height, labels, heatmap });
        zones.push({ ...zone, imagePng: await canvasToPngBytes(zoneCanvas) });
      }
      const values = rows.map((item) => Number(item.measurement)).filter(Number.isFinite);
      const histogram = histogramModel(values, 50);
      const histogramCanvas = renderHistogramImage(component.name, histogram, Math.min(width, 1800), Math.round(Math.min(width, 1800) * 0.48));
      const imagePng = histogramCanvas ? await canvasToPngBytes(histogramCanvas) : null;
      reportComponentsData.push({
        id: component.id, name: component.name || `ID ${component.id}`, packageName: component.packageName || '', bounds: layout.bounds, rows, zones,
        overviewPng, measurementCount: values.length, histogram: { ...histogram, imagePng },
      });
    }
    els.componentReportMessage.textContent = 'กำลังประกอบไฟล์ Excel และฝังรูปภาพ…'; await nextFrame();
    const nameSourceLabel = ({ active: `${cadRoleLabel(state.activeCadRole)} / ชื่อที่กำลังแสดง`, original: 'Original CAD', generated: 'Generated CAD' })[nameSource] || 'Active CAD';
    const blob = await buildComponentReportXlsx({
      title: `${state.xmlData.board?.Name || 'Board'} · Component CAD Report`, boardName: state.xmlData.board?.Name || '', cadFileName: state.fileNames.xml || activeCadFile()?.name || '', xlsxFileName: state.fileNames.xlsx || '',
      generatedAt: exportMetadata.exportTime, zoneGrid: grid, nameSourceLabel, compatibilityMode: els.componentReportCompatibility?.checked !== false, components: reportComponentsData,
      projectMetadata: exportMetadata,
    });
    const scopeName = components.length === 1 ? components[0].name : 'raw_parts';
    downloadBlob(blob, safeDownloadName(`${reportFileStem(state.xmlData.board?.Name)}_${reportFileStem(scopeName)}_component_report_r${exportMetadata.revisionNumber}_v0.20.0.xlsx`));
    els.componentReportMessage.textContent = `สร้าง Excel สำเร็จ · ${formatInt.format(components.length)} Component · ${formatInt.format(reportComponentsData.reduce((sum, item) => sum + item.rows.length, 0))} Land`;
    toast('สร้าง Component Report Excel สำเร็จ', 4200);
  } catch (error) {
    console.error(error); els.componentReportMessage.textContent = `สร้าง Excel ไม่สำเร็จ: ${error.message}`; toast(`สร้าง Excel ไม่สำเร็จ: ${error.message}`, 5200); showGlobalError(error, { title: 'สร้าง Excel ไม่สำเร็จ', operation: 'xlsx-export' });
  } finally {
    dialog?.classList.remove('is-building'); els.generateComponentReportButton.disabled = false; els.generateComponentReportButton.textContent = oldText; updateComponentReportPreview();
  }
}

function validationStatusFromPreflight(preflight) {
  if (!preflight) return 'not-run';
  if (preflight.blockingCount) return 'blocking-errors';
  if (preflight.counts?.error) return 'errors';
  if (preflight.counts?.warning) return 'warnings';
  return 'passed';
}
function acceptedWarningCodes(metadata) {
  return (metadata?.acceptedWarnings || []).map((item) => typeof item === 'string' ? item : item?.code || item?.id || '').filter(Boolean).join('|');
}
function mappingExportTail(mapping, metadata) {
  return [
    mapping?.matchStatus || mappingStatus(mapping), mapping?.mappingState || '', mapping?.sourceRecordId || '', mapping?.targetRecordId || '',
    mapping?.matchScore ?? mapping?.confidence ?? '', mapping?.manualReason || mapping?.reason || '', mapping?.revision ?? metadata.revisionNumber,
    metadata.projectId, metadata.revisionNumber, metadata.exportTime, metadata.sourceFormat, metadata.exportFormat, metadata.validationStatus, acceptedWarningCodes(metadata),
  ];
}
function exportCsv() {
  const exportStarted = performance.now();
  try {
    if (!state.xmlData) return toast('กรุณานำเข้า CAD ก่อน');
    const file = activeCadFile();
    const preflight = assertAppliedRevisionExportable(file, file?.editorModel || null);
    const metadata = projectExportMetadata(file, 'csv-placement-mapping', validationStatusFromPreflight(preflight));
    const headers = ['raw_land_identifier','raw_order','cad_local_index','xml_global_land_id','cad_name','alias','component','package','center_x_mm','center_y_mm','left_mm','top_mm','width_mm','length_mm','measurement','confidence','verified','manual','anchor_locked','mapping_method','duplicate_cad_name_count','source_row','record_type','match_status','mapping_state','source_record_id','target_record_id','match_score','manual_reason','mapping_revision','project_id','revision_number','export_time','source_format','export_format','validation_status','accepted_warnings'];
    const lines = [headers.map(escapeCsv).join(',')];
    for (const component of state.xmlData.components.filter((item) => item.lands?.length)) {
      const mappings = (state.mappingData?.mappings || []).filter((mapping) => String(mapping.componentId) === String(component.id));
      const byGlobal = new Map();
      for (const mapping of mappings) {
        if (mapping.globalId == null) continue;
        const key = Number(mapping.globalId);
        if (!byGlobal.has(key)) byGlobal.set(key, []);
        byGlobal.get(key).push(mapping);
      }
      const included = new Set();
      for (const land of component.lands) {
        const matched = byGlobal.get(Number(land.globalId)) || [];
        const records = matched.length ? matched : [cadOnlyTableRow(component, land)];
        for (const m of records) {
          included.add(m);
          const base = [m.cadOnly ? '' : (m.rawLandId ?? m.localIndex), m.rawOrder ?? '', land.localIndex, land.globalId, m.alias || land.cadName || m.cadName || '', m.alias || '', component.name, component.packageName, land.centerX, land.centerY, land.left, land.top, land.width, land.length, m.measurement ?? '', m.confidence ?? '', m.cadOnly ? false : isVerifiedMapping(m), m.manual || false, m.anchorLocked || false, m.mappingMethod || 'cad-only', duplicateCountForLand(land), m.sourceRow ?? '', m.cadOnly ? 'cad-only' : 'mapping'];
          lines.push([...base, ...mappingExportTail(m, metadata)].map(escapeCsv).join(','));
        }
      }
      for (const m of mappings) if (!included.has(m)) {
        const base = [m.rawLandId ?? m.localIndex, m.rawOrder ?? '', '', m.globalId ?? '', m.cadName || '', m.alias || '', m.componentName || component.name, m.packageName || component.packageName, m.centerX ?? '', m.centerY ?? '', m.left ?? '', m.top ?? '', m.width ?? '', m.length ?? '', m.measurement ?? '', m.confidence ?? '', isVerifiedMapping(m), m.manual || false, m.anchorLocked || false, m.mappingMethod || 'unmapped', m.duplicateCadNameCount || 0, m.sourceRow ?? '', 'raw-only'];
        lines.push([...base, ...mappingExportTail(m, metadata)].map(escapeCsv).join(','));
      }
    }
    const filename = safeDownloadName(`${state.xmlData?.board?.Name || 'cad'}_cad_mapping_v0.20.0.csv`);
    downloadBlob(new Blob(['\ufeff', lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), filename);
    state.diagnostics.record('export-csv', performance.now() - exportStarted, { success: true, revision: metadata.revisionNumber, rows: lines.length - 1 });
    toast(`Export CSV Revision ${metadata.revisionNumber} สำเร็จ`, 4200);
  } catch (error) {
    state.diagnostics.record('export-csv', performance.now() - exportStarted, { success: false });
    console.error(error);
    toast(`Export CSV ไม่สำเร็จ [${error?.code || 'EXPORT_ERROR'}]: ${error?.message || error}`, 6200);
    showGlobalError(error, { title: 'Export CSV ไม่สำเร็จ', operation: 'csv-export' });
  }
}
function exportJson() {
  const exportStarted = performance.now();
  try {
    const file = activeCadFile();
    const preflight = assertAppliedRevisionExportable(file, file?.editorModel || null);
    const metadata = projectExportMetadata(file, 'json-model', validationStatusFromPreflight(preflight));
    const overrides = (state.mappingData?.mappings || [])
      .filter((m) => isVerifiedMapping(m) || m.alias || m.mappingMethod === 'manual-unmapped' || m.mappingHistory?.length)
      .map((m) => ({ sourceRow: m.sourceRow, sourceRecordId: m.sourceRecordId, targetRecordId: m.targetRecordId, rawOrder: m.rawOrder, rawLandId: m.rawLandId ?? m.localIndex, localIndex: m.localIndex, componentName: m.componentName, componentId: m.componentId, globalId: m.globalId, cadName: m.cadName, alias: m.alias || '', manual: Boolean(m.manual), verified: isVerifiedMapping(m), mapped: Boolean(m.mapped), anchorLocked: Boolean(m.anchorLocked), confidence: m.confidence, matchScore: m.matchScore, matchStatus: m.matchStatus, mappingState: m.mappingState, mappingMethod: m.mappingMethod, userConfirmation: m.userConfirmation, revision: m.revision, mappingHistory: m.mappingHistory || [] }));
    const cadNameOverrides = [...state.cadInspector.renames.entries()].map(([key, cadName]) => {
      const [componentId, globalId] = key.split('\u0000');
      return { componentId, globalId: Number(globalId), cadName };
    });
    const session = ensureProjectSession(file);
    const payload = {
      app: 'Universal CAD / Land Editor', version: '0.20.0', schemaVersion: session.project.schemaVersion,
      exportMetadata: metadata, files: state.fileNames, universalCadModel: session.project.currentModel,
      validation: file.lastValidation || preflight, board: state.xmlData?.board,
      schema: state.schema ? { componentCol: state.schema.componentCol, packageCol: state.schema.packageCol, landCol: state.schema.landCol, landMode: state.schema.landMode, measurementCol: state.schema.measurementCol } : null,
      componentSummaries: state.mappingData?.componentSummaries, safeMapping: true,
      cadNameRules: { maxLength: state.cadInspector.maxLength, prefix: state.cadInspector.prefix, overflowMode: state.cadInspector.overflowMode, duplicateMode: state.cadInspector.duplicateMode, duplicateCharacter: state.cadInspector.duplicateCharacter },
      cadNameOverrides, overrides,
    };
    downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), safeDownloadName(`universal-cad-editor-project-r${metadata.revisionNumber}-v0.20.0.json`));
    state.diagnostics.record('export-json', performance.now() - exportStarted, { success: true, revision: metadata.revisionNumber, overrides: overrides.length });
    toast(`Export JSON Model Revision ${metadata.revisionNumber} สำเร็จ`, 4200);
  } catch (error) {
    state.diagnostics.record('export-json', performance.now() - exportStarted, { success: false });
    console.error(error);
    toast(`Export JSON ไม่สำเร็จ [${error?.code || 'EXPORT_ERROR'}]: ${error?.message || error}`, 6200);
    showGlobalError(error, { title: 'Export JSON ไม่สำเร็จ', operation: 'json-export' });
  }
}

function trustedBackupItem(item) {
  const method = String(item?.mappingMethod || '');
  if (item?.verified === true) return true;
  if (method === 'manual-direct' || method === 'restored-confirmed') return true;
  return Boolean(item?.anchorLocked && method === 'manual-anchor');
}
async function restoreBackup(file) {
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text(), jsonBackupReviver);
    if (payload?.project) { await restoreStoredProject({ project: payload.project, workspace: payload.projectWorkspace || payload.workspace || {} }); return; }
    if (!state.xmlData) throw new Error('Backup แบบ Mapping ต้องเปิด CAD ก่อน หรือเลือก Project Backup ที่มี project model');
    let restoredCadNames = 0;
    if (payload.cadNameRules?.maxLength) state.cadInspector.maxLength = Math.max(2, Number(payload.cadNameRules.maxLength) || 5);
    if (payload.cadNameRules?.prefix) state.cadInspector.prefix = String(payload.cadNameRules.prefix);
    if (['keep-start', 'keep-end', 'regenerate'].includes(payload.cadNameRules?.overflowMode)) state.cadInspector.overflowMode = payload.cadNameRules.overflowMode;
    if (['replace-character', 'suffix', 'regenerate'].includes(payload.cadNameRules?.duplicateMode)) state.cadInspector.duplicateMode = payload.cadNameRules.duplicateMode;
    if (payload.cadNameRules?.duplicateCharacter) state.cadInspector.duplicateCharacter = [...String(payload.cadNameRules.duplicateCharacter)][0] || '_';
    if (Array.isArray(payload.cadNameOverrides)) {
      for (const item of payload.cadNameOverrides) {
        if (item.componentId == null || item.globalId == null) continue;
        const component = state.xmlData.componentById.get(String(item.componentId));
        const land = component?.lands.find((candidate) => Number(candidate.globalId) === Number(item.globalId));
        if (!land) continue;
        const key = cadLandKey(item.componentId, item.globalId);
        const value = normalizeCadName(item.cadName).toUpperCase();
        if (value && value !== normalizeCadName(land.originalCadName ?? land.cadName)) {
          state.cadInspector.renames.set(key, value);
          restoredCadNames += 1;
        }
      }
      applyCadNamesToProject({ silent: true });
    }

    let restoredConfirmed = 0;
    let restoredNotes = 0;
    let ignoredGenerated = 0;
    let skipped = 0;
    let mappingChanges = 0;
    if (state.mappingData && Array.isArray(payload.overrides)) {
      const bySourceRow = new Map(state.mappingData.mappings.map((m) => [Number(m.sourceRow), m]));
      const byKey = new Map(state.mappingData.mappings.map((m) => [`${m.componentName}\u0000${m.localIndex}`, m]));
      const changes = [];
      for (const item of payload.overrides) {
        const mapping = bySourceRow.get(Number(item.sourceRow)) || byKey.get(`${item.componentName}\u0000${item.localIndex}`);
        if (!mapping) { skipped += 1; continue; }
        const method = String(item.mappingMethod || '');
        let after = snapshotMapping(mapping);
        let changed = false;
        if (item.alias) { after.alias = String(item.alias); restoredNotes += 1; changed = true; }
        if (item.mapped === false && method === 'manual-unmapped') {
          after = { ...stateForUnmapped(mapping), alias: item.alias || '' };
          changed = true;
        } else if (trustedBackupItem(item) && item.mapped !== false && item.globalId != null) {
          const component = state.xmlData.componentById.get(String(item.componentId || mapping.componentId));
          const land = component?.lands.find((candidate) => Number(candidate.globalId) === Number(item.globalId));
          if (!land) { skipped += 1; continue; }
          after = stateForLand(mapping, land, { manual: true, verified: true, anchorLocked: Boolean(item.anchorLocked), confidence: 100, mappingMethod: item.anchorLocked ? 'manual-anchor' : 'manual-direct', duplicateCadNameCount: duplicateCountForLand(land) });
          after.alias = item.alias || '';
          restoredConfirmed += 1;
          changed = true;
        } else if (isUnsafeGeneratedMapping(item) || item.manual) ignoredGenerated += 1;
        if (changed) changes.push({ mapping, before: snapshotMapping(mapping), after });
      }
      if (changes.length) { applyTransaction('Restore safe backup JSON', changes); mappingChanges = changes.length; }
    }

    if (!restoredCadNames && !mappingChanges) throw new Error('ไม่พบข้อมูลชื่อ CAD หรือจุด Mapping ที่กู้คืนได้ใน Backup นี้');
    toast(`กู้คืนชื่อ CAD ${formatInt.format(restoredCadNames)} จุด${restoredConfirmed ? ` · Confirmed ${formatInt.format(restoredConfirmed)} จุด` : ''}${restoredNotes ? ` · หมายเหตุ ${formatInt.format(restoredNotes)}` : ''}${ignoredGenerated ? ` · ตัด Mapping ที่ระบบกระจาย ${formatInt.format(ignoredGenerated)} จุด` : ''}${skipped ? ` · ข้าม ${formatInt.format(skipped)}` : ''}`, 6500);
  } catch (error) { console.error(error); toast(`นำเข้า Backup ไม่สำเร็จ: ${error.message}`, 5200); showGlobalError(error, { title: 'นำเข้า Backup ไม่สำเร็จ', operation: 'project-backup-import', fileName: file.name }); }
  finally { els.restoreFile.value = ''; }
}

function cadEditorFile() { return activeCadFile(); }
function cadEditorComponent() {
  return state.cadEditor.model?.components.find((component) => component.uid === state.cadEditor.selectedComponentUid) || null;
}
function cadEditorLandSelectionSet() {
  if (!(state.cadEditor.selectedLandUids instanceof Set)) state.cadEditor.selectedLandUids = new Set();
  return state.cadEditor.selectedLandUids;
}
function cadEditorLand() {
  const component = cadEditorComponent();
  if (!component) return null;
  const set = cadEditorLandSelectionSet();
  let land = component.lands.find((item) => item.uid === state.cadEditor.selectedLandUid) || null;
  if (!land && set.size) land = component.lands.find((item) => set.has(item.uid)) || null;
  if (land) state.cadEditor.selectedLandUid = land.uid;
  return land;
}
function cadEditorSelectedLands() {
  const component = cadEditorComponent();
  const selected = cadEditorLandSelectionSet();
  return component ? (component.lands || []).filter((land) => selected.has(land.uid)) : [];
}
function cadEditorSelectionSet() {
  if (!(state.cadEditor.selectedComponentUids instanceof Set)) state.cadEditor.selectedComponentUids = new Set();
  return state.cadEditor.selectedComponentUids;
}
function cadEditorSelectedComponents() {
  const selected = cadEditorSelectionSet();
  return (state.cadEditor.model?.components || []).filter((component) => selected.has(component.uid));
}
function invalidateCadEditorBounds(component = null) {
  const cache = state.cadEditor.visual?.boundsCache;
  if (!(cache instanceof Map)) return;
  if (component) cache.delete(component.uid); else cache.clear();
}
function cadEditorBounds(component) {
  const visual = state.cadEditor.visual;
  if (!(visual.boundsCache instanceof Map)) visual.boundsCache = new Map();
  if (!visual.boundsCache.has(component.uid)) visual.boundsCache.set(component.uid, componentBounds(component));
  return visual.boundsCache.get(component.uid);
}
function cadEditorComponentMatches(component) {
  const visual = state.cadEditor.visual;
  const search = String(visual.search || '').trim().toLowerCase();
  if (search && ![component.id, component.name, component.packageName, component.revision].some((value) => String(value ?? '').toLowerCase().includes(search))) return false;
  if (visual.side === 'all') return true;
  const sides = new Set((component.lands || []).map((land) => normalizeSide(land.side)));
  return sides.has(visual.side);
}
function visibleCadEditorComponents() {
  return (state.cadEditor.model?.components || []).filter(cadEditorComponentMatches);
}
function setCadEditorPrimaryComponent(component) {
  state.cadEditor.selectedComponentUid = component?.uid || null;
  const selectedLands = cadEditorLandSelectionSet();
  if (!component) {
    state.cadEditor.selectedLandUid = null;
    selectedLands.clear();
    return;
  }
  for (const uid of [...selectedLands]) if (!component.lands?.some((land) => land.uid === uid)) selectedLands.delete(uid);
  if (!component.lands?.some((land) => land.uid === state.cadEditor.selectedLandUid)) state.cadEditor.selectedLandUid = component.lands?.find((land) => selectedLands.has(land.uid))?.uid || null;
}
function setCadEditorLandSelection(lands, { additive = false, toggle = false, primary = null } = {}) {
  const component = cadEditorComponent();
  if (!component) return false;
  const set = cadEditorLandSelectionSet();
  if (!additive && !toggle) set.clear();
  for (const land of lands || []) {
    if (!land || !component.lands.includes(land)) continue;
    if (toggle && set.has(land.uid)) set.delete(land.uid); else set.add(land.uid);
  }
  const nextPrimary = primary && set.has(primary.uid)
    ? primary
    : component.lands.find((land) => land.uid === state.cadEditor.selectedLandUid && set.has(land.uid)) || component.lands.find((land) => set.has(land.uid)) || null;
  state.cadEditor.selectedLandUid = nextPrimary?.uid || null;
  renderCadEditorLandForm();
  renderCadEditorVisualProperties();
  drawCadEditorCanvas();
  return true;
}
function clearCadEditorLandSelection() {
  cadEditorLandSelectionSet().clear();
  state.cadEditor.selectedLandUid = null;
}
function setCadEditorSelection(components, { additive = false, toggle = false, primary = null } = {}) {
  const set = cadEditorSelectionSet();
  if (!additive && !toggle) set.clear();
  for (const component of components || []) {
    if (!component) continue;
    if (toggle && set.has(component.uid)) set.delete(component.uid); else set.add(component.uid);
  }
  const modelComponents = state.cadEditor.model?.components || [];
  const primaryComponent = primary && set.has(primary.uid) ? primary : modelComponents.find((component) => component.uid === state.cadEditor.selectedComponentUid && set.has(component.uid)) || modelComponents.find((component) => set.has(component.uid)) || null;
  setCadEditorPrimaryComponent(primaryComponent);
  if (!primaryComponent || set.size !== 1) {
    clearCadEditorLandSelection();
    if (state.cadEditor.visual.mode === 'land') state.cadEditor.visual.mode = 'component';
  } else {
    for (const uid of [...cadEditorLandSelectionSet()]) if (!primaryComponent.lands?.some((land) => land.uid === uid)) cadEditorLandSelectionSet().delete(uid);
  }
  renderCadEditorComponentForm();
  renderCadEditorVisualProperties();
  drawCadEditorCanvas();
}
function clearCadEditorSelection() { setCadEditorSelection([]); }
function cadEditorCanvasPoint(event) {
  const rect = els.cadEditorCanvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}
function cadEditorWorldToScreen(x, y) {
  const view = state.cadEditor.visual;
  return { x: Number(x) * view.scale + view.offsetX, y: -Number(y) * view.scale + view.offsetY };
}
function cadEditorScreenToWorld(x, y) {
  const view = state.cadEditor.visual;
  return { x: (x - view.offsetX) / view.scale, y: (view.offsetY - y) / view.scale };
}
function cadEditorBoardBounds() {
  const board = state.cadEditor.model?.board || {};
  const width = Number(board.Width ?? board.width);
  const height = Number(board.Height ?? board.height);
  const minX = Number(board.MinX ?? board.minX ?? 0);
  const minY = Number(board.MinY ?? board.minY ?? 0);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const x = Number.isFinite(minX) ? minX : 0;
  const y = Number.isFinite(minY) ? minY : 0;
  return { minX: x, minY: y, maxX: x + width, maxY: y + height, width, height, centerX: x + width / 2, centerY: y + height / 2 };
}
function combinedCadEditorBounds(components = visibleCadEditorComponents()) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const component of components) {
    const bounds = cadEditorBounds(component);
    minX = Math.min(minX, bounds.minX); minY = Math.min(minY, bounds.minY);
    maxX = Math.max(maxX, bounds.maxX); maxY = Math.max(maxY, bounds.maxY);
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY, width: Math.max(.02, maxX - minX), height: Math.max(.02, maxY - minY), centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2 };
}
function fitCadEditorView(components = null) {
  const filtered = components || visibleCadEditorComponents();
  const useBoardOutline = components == null && !String(state.cadEditor.visual.search || '').trim() && state.cadEditor.visual.side === 'all';
  const bounds = (useBoardOutline ? cadEditorBoardBounds() : null) || combinedCadEditorBounds(filtered);
  const width = els.cadEditorCanvas.clientWidth || 1;
  const height = els.cadEditorCanvas.clientHeight || 1;
  if (!bounds || width < 2 || height < 2) return drawCadEditorCanvas();
  const pad = Math.max(30, Math.min(width, height) * .055);
  const scale = Math.max(.02, Math.min(600, (width - pad * 2) / bounds.width, (height - pad * 2) / bounds.height));
  const view = state.cadEditor.visual;
  view.scale = scale;
  view.offsetX = width / 2 - bounds.centerX * scale;
  view.offsetY = height / 2 + bounds.centerY * scale;
  drawCadEditorCanvas();
}
function zoomCadEditorAt(factor, screenX = els.cadEditorCanvas.clientWidth / 2, screenY = els.cadEditorCanvas.clientHeight / 2) {
  const view = state.cadEditor.visual;
  const world = cadEditorScreenToWorld(screenX, screenY);
  const scale = Math.max(.02, Math.min(1200, view.scale * factor));
  view.scale = scale;
  view.offsetX = screenX - world.x * scale;
  view.offsetY = screenY + world.y * scale;
  drawCadEditorCanvas();
}
function niceCadEditorGridStep() {
  const target = 44 / Math.max(.0001, state.cadEditor.visual.scale);
  const power = Math.pow(10, Math.floor(Math.log10(target)));
  const ratio = target / power;
  return (ratio <= 1 ? 1 : ratio <= 2 ? 2 : ratio <= 5 ? 5 : 10) * power;
}
function drawCadEditorGrid(width, height) {
  if (!state.cadEditor.visual.grid) return;
  const step = niceCadEditorGridStep();
  const topLeft = cadEditorScreenToWorld(0, 0);
  const bottomRight = cadEditorScreenToWorld(width, height);
  const minX = Math.min(topLeft.x, bottomRight.x), maxX = Math.max(topLeft.x, bottomRight.x);
  const minY = Math.min(topLeft.y, bottomRight.y), maxY = Math.max(topLeft.y, bottomRight.y);
  cadEditorCtx.save();
  cadEditorCtx.strokeStyle = 'rgba(92,126,160,.12)'; cadEditorCtx.lineWidth = 1;
  cadEditorCtx.beginPath();
  for (let x = Math.floor(minX / step) * step; x <= maxX; x += step) { const p = cadEditorWorldToScreen(x, 0); cadEditorCtx.moveTo(Math.round(p.x) + .5, 0); cadEditorCtx.lineTo(Math.round(p.x) + .5, height); }
  for (let y = Math.floor(minY / step) * step; y <= maxY; y += step) { const p = cadEditorWorldToScreen(0, y); cadEditorCtx.moveTo(0, Math.round(p.y) + .5); cadEditorCtx.lineTo(width, Math.round(p.y) + .5); }
  cadEditorCtx.stroke();
  const origin = cadEditorWorldToScreen(0, 0);
  cadEditorCtx.strokeStyle = 'rgba(107,174,206,.30)'; cadEditorCtx.beginPath();
  cadEditorCtx.moveTo(origin.x, 0); cadEditorCtx.lineTo(origin.x, height); cadEditorCtx.moveTo(0, origin.y); cadEditorCtx.lineTo(width, origin.y); cadEditorCtx.stroke();
  cadEditorCtx.restore();
}
function cadEditorLandRect(land) {
  const left = Number(land.left), top = Number(land.top), width = Math.abs(Number(land.width) || .02), length = Math.abs(Number(land.length) || .02);
  if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
  return { minX: Math.min(left, left + width), maxX: Math.max(left, left + width), minY: Math.min(top, top - length), maxY: Math.max(top, top - length) };
}
function cadEditorSnapValue(value) {
  if (!state.cadEditor.visual.snap) return Number(value) || 0;
  const step = Math.max(.000001, Number(els.cadEditorNudgeStep?.value) || .1);
  return Math.round((Number(value) || 0) / step) * step;
}
function markCadEditorChanged(message = '') {
  if (state.cadEditor.model) state.cadEditor.model.changed = true;
  els.cadStudioDirtyBadge?.classList.toggle('hidden', !state.cadEditor.model?.changed);
  if (message && els.cadEditorMessage) els.cadEditorMessage.textContent = message;
}

function cadEditorConfirmVisible() {
  return Boolean(els.cadEditorConfirmOverlay && !els.cadEditorConfirmOverlay.classList.contains('hidden'));
}
function cadEditorTaskCancelledError() {
  const error = new Error('ยกเลิกการทำงานแล้ว');
  error.name = 'AbortError';
  return error;
}
function clearCadEditorBusyWatchdog() {
  if (state.cadEditor.busyWatchdog) window.clearTimeout(state.cadEditor.busyWatchdog);
  state.cadEditor.busyWatchdog = null;
}
function updateCadEditorBusyProgress(value = null, detail = null) {
  if (els.cadEditorBusyProgress) {
    if (value == null || !Number.isFinite(Number(value))) {
      els.cadEditorBusyProgress.removeAttribute('value');
    } else {
      els.cadEditorBusyProgress.value = Math.max(0, Math.min(100, Number(value)));
    }
  }
  if (detail != null && els.cadEditorBusyDetail) els.cadEditorBusyDetail.textContent = detail;
}
function setCadEditorBusy(active, title = 'กำลังประมวลผล…', detail = 'กรุณารอสักครู่') {
  const nextActive = Boolean(active);
  state.cadEditor.busy = nextActive;
  state.cadEditor.busyStartedAt = nextActive ? Date.now() : 0;
  if (nextActive) {
    state.cadEditor.busyToken = Number(state.cadEditor.busyToken || 0) + 1;
    state.cadEditor.taskCancelRequested = false;
  } else {
    state.cadEditor.taskCancelRequested = false;
    clearCadEditorBusyWatchdog();
  }
  const shell = els.cadEditorOverlay?.querySelector('.cad-studio-shell');
  shell?.classList.toggle('cad-is-busy', nextActive);
  els.cadEditorBusyOverlay?.classList.toggle('hidden', !nextActive);
  if (els.cadEditorBusyTitle) els.cadEditorBusyTitle.textContent = title;
  if (els.cadEditorBusyDetail) els.cadEditorBusyDetail.textContent = detail;
  if (nextActive) updateCadEditorBusyProgress(null, detail);
  if (els.cadEditorApplyButton) els.cadEditorApplyButton.disabled = nextActive || !state.cadEditor.model;
  if (els.cadEditorExportXmlButton) els.cadEditorExportXmlButton.disabled = nextActive || !state.cadEditor.model;
  if (els.cadEditorBusyCancelButton) {
    els.cadEditorBusyCancelButton.disabled = !nextActive;
    els.cadEditorBusyCancelButton.textContent = 'ยกเลิกงาน';
  }
  if (els.cadEditorBusyCloseButton) els.cadEditorBusyCloseButton.disabled = !nextActive;
  updateCadEditorMenuState();
  if (nextActive) {
    clearCadEditorBusyWatchdog();
    state.cadEditor.busyWatchdog = window.setTimeout(() => {
      if (!state.cadEditor.busy) return;
      if (els.cadEditorBusyDetail) els.cadEditorBusyDetail.textContent = 'งานใช้เวลานานกว่าปกติ สามารถกดยกเลิกงานหรือปิด Editor ได้';
    }, 12000);
  }
}
function cancelCadEditorTask({ closeAfter = false } = {}) {
  if (!state.cadEditor.busy) return false;
  state.cadEditor.taskCancelRequested = true;
  state.cadEditor.pendingCloseAfterTask = Boolean(closeAfter || state.cadEditor.pendingCloseAfterTask);
  if (els.cadEditorBusyTitle) els.cadEditorBusyTitle.textContent = closeAfter ? 'กำลังยกเลิกและปิด Editor…' : 'กำลังยกเลิกงาน…';
  if (els.cadEditorBusyDetail) els.cadEditorBusyDetail.textContent = 'ระบบจะหยุดที่จุดพักถัดไป';
  if (els.cadEditorBusyCancelButton) {
    els.cadEditorBusyCancelButton.disabled = true;
    els.cadEditorBusyCancelButton.textContent = 'กำลังยกเลิก…';
  }
  return true;
}
async function runCadEditorTask(title, detail, task) {
  if (state.cadEditor.busy) {
    toast('กำลังทำงานรายการก่อนหน้า กรุณารอสักครู่', 2800);
    return false;
  }
  setCadEditorBusy(true, title, detail);
  const token = state.cadEditor.busyToken;
  const taskContext = {
    token,
    isCancelled: () => state.cadEditor.taskCancelRequested || token !== state.cadEditor.busyToken,
    throwIfCancelled() {
      if (this.isCancelled()) throw cadEditorTaskCancelledError();
    },
    async yield() {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      this.throwIfCancelled();
    },
    progress(value, nextDetail = null) {
      if (token !== state.cadEditor.busyToken) return;
      updateCadEditorBusyProgress(value, nextDetail);
    },
  };
  await nextFrame();
  try {
    taskContext.throwIfCancelled();
    return await task(taskContext);
  } catch (error) {
    if (error?.name === 'AbortError') {
      toast('ยกเลิกการทำงานแล้ว', 3000);
      return false;
    }
    console.error(error);
    toast(`${title} ไม่สำเร็จ: ${error?.message || error}`, 6500);
    return false;
  } finally {
    const closeAfter = Boolean(state.cadEditor.pendingCloseAfterTask);
    state.cadEditor.pendingCloseAfterTask = false;
    setCadEditorBusy(false);
    updateCadEditorMenuState();
    if (closeAfter && !els.cadEditorOverlay.classList.contains('hidden')) {
      window.setTimeout(() => closeCadEditor(), 0);
    }
  }
}
function cadEditorSelectedLandCount() {
  return cadEditorSelectedComponents().reduce((sum, component) => sum + (component.lands?.length || 0), 0);
}
function runCadEditorOperation(label, task, { alwaysBusy = false } = {}) {
  if (state.cadEditor.busy) {
    toast('กำลังทำงานรายการก่อนหน้า กรุณารอสักครู่', 2800);
    return false;
  }
  const componentCount = cadEditorSelectionSet().size;
  const landCount = componentCount ? cadEditorSelectedLandCount() : 0;
  const heavy = alwaysBusy || componentCount > CAD_EDITOR_LIGHT_SELECTION_LIMIT || landCount > 6000;
  if (!heavy) {
    try {
      const result = task();
      if (result && typeof result.then === 'function') return result.catch((error) => { console.error(error); toast(`${label} ไม่สำเร็จ: ${error?.message || error}`, 6000); return false; });
      return result;
    } catch (error) { console.error(error); toast(`${label} ไม่สำเร็จ: ${error?.message || error}`, 6000); return false; }
  }
  return runCadEditorTask(
    `กำลัง${label}…`,
    `${formatInt.format(componentCount)} Components · ${formatInt.format(landCount)} Lands`,
    async () => task(),
  );
}
function closeCadEditorConfirm({ animate = true } = {}) {
  const overlay = els.cadEditorConfirmOverlay;
  if (!overlay || overlay.classList.contains('hidden')) return;
  const finish = () => {
    const returnFocus = state.cadEditor.confirm?.returnFocus;
    overlay.classList.add('hidden');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.classList.remove('is-closing', 'is-confirmed', 'is-rejected', 'is-processing');
    state.cadEditor.confirm = { mode: null, pendingAction: null, returnFocus: null };
    els.cadEditorConfirmYes.disabled = false;
    els.cadEditorConfirmNo.disabled = false;
    if (returnFocus?.isConnected && typeof returnFocus.focus === 'function') requestAnimationFrame(() => returnFocus.focus());
  };
  if (!animate || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return finish();
  overlay.classList.add('is-closing');
  window.setTimeout(finish, 170);
}
function showCadEditorConfirm(mode, { pendingAction = null } = {}) {
  if (!els.cadEditorConfirmOverlay || state.cadEditor.busy) return false;
  const summary = modelSummary(state.cadEditor.model);
  const historyCount = state.cadEditor.history?.undo?.length || 0;
  state.cadEditor.confirm = { mode, pendingAction, returnFocus: document.activeElement };
  els.cadEditorConfirmDialog.dataset.mode = mode;
  els.cadEditorConfirmOverlay.classList.remove('hidden', 'is-closing', 'is-confirmed', 'is-rejected', 'is-processing');
  els.cadEditorConfirmOverlay.setAttribute('aria-hidden', 'false');
  els.cadEditorConfirmYes.disabled = false;
  els.cadEditorConfirmNo.disabled = false;
  if (mode === 'discard') {
    els.cadEditorConfirmIcon.textContent = '!';
    els.cadEditorConfirmEyebrow.textContent = 'UNSAVED CHANGES';
    els.cadEditorConfirmTitle.textContent = 'ยกเลิกการแก้ไขที่ยังไม่ได้ Apply?';
    els.cadEditorConfirmMessage.textContent = 'การแก้ไขหลัง Apply ครั้งล่าสุดจะถูกทิ้ง และหน้า Mapping จะไม่ถูกเปลี่ยน';
    els.cadEditorConfirmYes.textContent = 'Yes-ทิ้งการแก้ไข';
    els.cadEditorConfirmNo.textContent = 'No-กลับไปแก้ต่อ';
  } else {
    els.cadEditorConfirmIcon.textContent = '✓';
    els.cadEditorConfirmEyebrow.textContent = 'CONFIRM APPLY';
    els.cadEditorConfirmTitle.textContent = 'ยืนยันการ Apply CAD ที่แก้ไข?';
    els.cadEditorConfirmMessage.textContent = 'ระบบจะตรวจสอบ CAD แล้วซิงก์ข้อมูลล่าสุดไปยัง Viewer และหน้า Mapping';
    els.cadEditorConfirmYes.textContent = 'Yes - ยืนยัน';
    els.cadEditorConfirmNo.textContent = 'ยกเลิก';
  }
  const validation = validateCadEditorModel(state.cadEditor.model);
  const summaryItems = [
    `${formatInt.format(summary.components)} Components`,
    `${formatInt.format(summary.lands)} Lands`,
    `${formatInt.format(historyCount)} Change steps`,
    validation.valid ? 'Validation: Passed' : `Validation: ${formatInt.format(validation.errors.length)} Blocking Error`,
  ];
  els.cadEditorConfirmSummary.replaceChildren(...summaryItems.map((text) => {
    const item = document.createElement('span');
    item.textContent = text;
    return item;
  }));
  if (mode === 'apply' && !validation.valid) {
    els.cadEditorConfirmMessage.textContent = `ยัง Apply ไม่ได้: ${validation.errors.slice(0, 3).join(' · ')}`;
    els.cadEditorConfirmYes.disabled = true;
  }
  requestAnimationFrame(() => (els.cadEditorConfirmYes.disabled ? els.cadEditorConfirmNo : els.cadEditorConfirmYes)?.focus());
  return true;
}
function discardCadEditorChanges() {
  const file = cadEditorFile();
  if (!file) return false;
  const restored = file.appliedEditorSnapshot ? cloneCadEditorModel(file.appliedEditorSnapshot) : createCadEditorModel(file.editedText || file.text);
  restored.changed = false;
  file.editorModel = restored;
  state.cadEditor.model = restored;
  resetCadEditorHistory(state.cadEditor.model);
  state.cadEditor.selectedComponentUid = null;
  state.cadEditor.selectedComponentUids = new Set();
  state.cadEditor.selectedLandUid = null;
  state.cadEditor.selectedLandUids = new Set();
  invalidateCadEditorBounds();
  return true;
}
async function animateCadEditorDecision(kind) {
  const overlay = els.cadEditorConfirmOverlay;
  if (!overlay || overlay.classList.contains('hidden')) return;
  overlay.classList.add(kind === 'yes' ? 'is-confirmed' : 'is-rejected');
  await new Promise((resolve) => window.setTimeout(resolve, window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 150));
}
async function declineCadEditorChoice() {
  if (!cadEditorConfirmVisible()) return false;
  els.cadEditorConfirmYes.disabled = true;
  els.cadEditorConfirmNo.disabled = true;
  try {
    await animateCadEditorDecision('no');
    return true;
  } finally {
    closeCadEditorConfirm({ animate: false });
  }
}
async function confirmCadEditorChoice() {
  const mode = state.cadEditor.confirm?.mode;
  const pendingAction = state.cadEditor.confirm?.pendingAction;
  if (!mode) return false;
  els.cadEditorConfirmYes.disabled = true;
  els.cadEditorConfirmNo.disabled = true;
  await animateCadEditorDecision('yes');
  closeCadEditorConfirm({ animate: false });
  await nextFrame();

  if (mode === 'apply') {
    const applied = await runCadEditorTask(
      'กำลังยืนยันและ Apply CAD…',
      'เริ่มตรวจสอบข้อมูล CAD',
      async (taskContext) => commitCadEditorToProject({ keepEditorOpen: true, showToast: false, fitViewer: false, taskContext }),
    );
    if (!applied) return false;
    toast('ยืนยันและ Apply CAD สำเร็จ · Mapping ใช้ข้อมูลล่าสุดแล้ว', 3600);
    return true;
  }

  discardCadEditorChanges();
  const deferredAction = typeof pendingAction === 'function' ? pendingAction : state.cadEditor.pendingActionAfterClose;
  state.cadEditor.pendingActionAfterClose = null;
  finalizeCloseCadEditor();
  if (typeof deferredAction === 'function') window.setTimeout(deferredAction, 0);
  return true;
}
function requestCadEditorApply() {
  if (!state.cadEditor.model || state.cadEditor.busy) return false;
  return showCadEditorConfirm('apply');
}

function cloneCadEditorHistoryValue(value) {
  if (value == null) return value;
  if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}
function cadEditorHistorySelectionSnapshot() {
  return {
    componentUids: [...cadEditorSelectionSet()],
    primaryUid: state.cadEditor.selectedComponentUid,
    landUid: state.cadEditor.selectedLandUid,
    landUids: [...cadEditorLandSelectionSet()],
    mode: state.cadEditor.visual.mode,
  };
}
function resetCadEditorHistory(model = state.cadEditor.model) {
  state.cadEditor.history = { undo: [], redo: [], limit: 40, restoring: false, modelRef: model || null };
  updateCadEditorHistoryControls();
}
function cadEditorHistoryComponentMap() {
  return new Map((state.cadEditor.model?.components || []).map((component) => [component.uid, component]));
}
function beginCadEditorHistory(label, options = {}) {
  const model = state.cadEditor.model;
  const history = state.cadEditor.history;
  if (!model || history?.restoring) return null;
  const all = Boolean(options.all);
  const structure = Boolean(options.structure);
  const trackedUids = new Set((options.componentUids || []).map((item) => typeof item === 'string' ? item : item?.uid).filter(Boolean));
  if (all) for (const component of model.components || []) trackedUids.add(component.uid);
  const byUid = cadEditorHistoryComponentMap();
  const beforeComponents = new Map();
  for (const uid of trackedUids) beforeComponents.set(uid, byUid.has(uid) ? cloneCadEditorHistoryValue(byUid.get(uid)) : null);
  return {
    label: String(label || 'CAD edit'),
    mergeKey: options.mergeKey || '',
    structure,
    all,
    trackedUids,
    beforeComponents,
    beforeOrder: structure ? (model.components || []).map((component) => component.uid) : null,
    changedBefore: Boolean(model.changed),
    selectionBefore: cadEditorHistorySelectionSnapshot(),
    startedAt: Date.now(),
  };
}
function cadEditorHistoryComparable(order, components) {
  const rows = [...components.entries()].sort(([a], [b]) => String(a).localeCompare(String(b)));
  return JSON.stringify({ order: order || null, rows });
}
function commitCadEditorHistory(transaction, options = {}) {
  if (!transaction || !state.cadEditor.model || state.cadEditor.history?.restoring) return false;
  const model = state.cadEditor.model;
  const currentByUid = cadEditorHistoryComponentMap();
  for (const item of options.componentUids || []) {
    const uid = typeof item === 'string' ? item : item?.uid;
    if (uid) transaction.trackedUids.add(uid);
  }
  const afterOrder = transaction.structure ? (model.components || []).map((component) => component.uid) : null;
  if (transaction.structure) {
    const beforeSet = new Set(transaction.beforeOrder || []);
    const afterSet = new Set(afterOrder || []);
    for (const uid of beforeSet) if (!afterSet.has(uid)) transaction.trackedUids.add(uid);
    for (const uid of afterSet) if (!beforeSet.has(uid)) transaction.trackedUids.add(uid);
  }
  if (transaction.all) for (const component of model.components || []) transaction.trackedUids.add(component.uid);
  for (const uid of transaction.trackedUids) if (!transaction.beforeComponents.has(uid)) transaction.beforeComponents.set(uid, null);
  const afterComponents = new Map();
  for (const uid of transaction.trackedUids) afterComponents.set(uid, currentByUid.has(uid) ? cloneCadEditorHistoryValue(currentByUid.get(uid)) : null);
  const beforeComparable = cadEditorHistoryComparable(transaction.beforeOrder, transaction.beforeComponents);
  const afterComparable = cadEditorHistoryComparable(afterOrder, afterComponents);
  if (beforeComparable === afterComparable) {
    updateCadEditorHistoryControls();
    return false;
  }
  const entry = {
    label: transaction.label,
    mergeKey: transaction.mergeKey,
    trackedUids: [...transaction.trackedUids],
    beforeComponents: transaction.beforeComponents,
    afterComponents,
    beforeOrder: transaction.beforeOrder,
    afterOrder,
    changedBefore: transaction.changedBefore,
    changedAfter: Boolean(model.changed),
    selectionBefore: transaction.selectionBefore,
    selectionAfter: cadEditorHistorySelectionSnapshot(),
    timestamp: Date.now(),
  };
  const history = state.cadEditor.history;
  const previous = history.undo.at(-1);
  if (entry.mergeKey && previous?.mergeKey === entry.mergeKey && entry.timestamp - previous.timestamp < 700) {
    previous.afterComponents = entry.afterComponents;
    previous.afterOrder = entry.afterOrder;
    previous.changedAfter = entry.changedAfter;
    previous.selectionAfter = entry.selectionAfter;
    previous.timestamp = entry.timestamp;
  } else {
    history.undo.push(entry);
    if (history.undo.length > (history.limit || 40)) history.undo.shift();
  }
  history.redo = [];
  updateCadEditorHistoryControls();
  return true;
}
function restoreCadEditorHistorySelection(snapshot) {
  const model = state.cadEditor.model;
  const existing = new Set((model?.components || []).map((component) => component.uid));
  const selected = (snapshot?.componentUids || []).filter((uid) => existing.has(uid));
  state.cadEditor.selectedComponentUids = new Set(selected);
  state.cadEditor.selectedComponentUid = selected.includes(snapshot?.primaryUid) ? snapshot.primaryUid : selected[0] || null;
  const primary = (model?.components || []).find((component) => component.uid === state.cadEditor.selectedComponentUid) || null;
  const availableLandUids = new Set((primary?.lands || []).map((land) => land.uid));
  const restoredLandUids = (snapshot?.landUids || [snapshot?.landUid]).filter((uid) => uid && availableLandUids.has(uid));
  state.cadEditor.selectedLandUids = new Set(restoredLandUids);
  state.cadEditor.selectedLandUid = restoredLandUids.includes(snapshot?.landUid) ? snapshot.landUid : restoredLandUids[0] || null;
  state.cadEditor.visual.mode = snapshot?.mode === 'land' && restoredLandUids.length ? 'land' : 'component';
}
function restoreCadEditorHistoryEntry(entry, side) {
  const model = state.cadEditor.model;
  if (!model || !entry) return false;
  const snapshots = side === 'before' ? entry.beforeComponents : entry.afterComponents;
  const order = side === 'before' ? entry.beforeOrder : entry.afterOrder;
  const changed = side === 'before' ? entry.changedBefore : entry.changedAfter;
  const selection = side === 'before' ? entry.selectionBefore : entry.selectionAfter;
  const currentByUid = cadEditorHistoryComponentMap();
  for (const uid of entry.trackedUids || []) {
    const snapshot = snapshots.get(uid);
    if (snapshot == null) currentByUid.delete(uid);
    else currentByUid.set(uid, cloneCadEditorHistoryValue(snapshot));
  }
  if (Array.isArray(order)) {
    model.components = order.map((uid) => currentByUid.get(uid)).filter(Boolean);
  } else {
    const tracked = new Set(entry.trackedUids || []);
    const rebuilt = [];
    const used = new Set();
    for (const component of model.components || []) {
      if (!tracked.has(component.uid)) { rebuilt.push(component); used.add(component.uid); continue; }
      const replacement = currentByUid.get(component.uid);
      if (replacement) { rebuilt.push(replacement); used.add(replacement.uid); }
    }
    for (const uid of tracked) {
      const component = currentByUid.get(uid);
      if (component && !used.has(uid)) rebuilt.push(component);
    }
    model.components = rebuilt;
  }
  model.changed = Boolean(changed);
  restoreCadEditorHistorySelection(selection);
  invalidateCadEditorBounds();
  renderCadEditor();
  updateCadEditorHistoryControls();
  return true;
}
function undoCadEditor() {
  const history = state.cadEditor.history;
  const entry = history?.undo?.pop();
  if (!entry) return false;
  history.restoring = true;
  try { restoreCadEditorHistoryEntry(entry, 'before'); }
  finally { history.restoring = false; }
  history.redo.push(entry);
  updateCadEditorHistoryControls();
  els.cadEditorMessage.textContent = `Undo: ${entry.label}`;
  return true;
}
function redoCadEditor() {
  const history = state.cadEditor.history;
  const entry = history?.redo?.pop();
  if (!entry) return false;
  history.restoring = true;
  try { restoreCadEditorHistoryEntry(entry, 'after'); }
  finally { history.restoring = false; }
  history.undo.push(entry);
  updateCadEditorHistoryControls();
  els.cadEditorMessage.textContent = `Redo: ${entry.label}`;
  return true;
}
function updateCadEditorHistoryControls() {
  const history = state.cadEditor.history || { undo: [], redo: [] };
  const undoEntry = history.undo?.at(-1);
  const redoEntry = history.redo?.at(-1);
  if (els.cadEditorUndoButton) {
    els.cadEditorUndoButton.disabled = !undoEntry;
    els.cadEditorUndoButton.title = undoEntry ? `Undo: ${undoEntry.label} (Ctrl+Z)` : 'Undo (Ctrl+Z)';
  }
  if (els.cadEditorRedoButton) {
    els.cadEditorRedoButton.disabled = !redoEntry;
    els.cadEditorRedoButton.title = redoEntry ? `Redo: ${redoEntry.label} (Ctrl+Y)` : 'Redo (Ctrl+Y / Ctrl+Shift+Z)';
  }
  document.querySelectorAll('[data-requires-undo]').forEach((button) => { button.disabled = !undoEntry; button.title = undoEntry ? undoEntry.label : ''; });
  document.querySelectorAll('[data-requires-redo]').forEach((button) => { button.disabled = !redoEntry; button.title = redoEntry ? redoEntry.label : ''; });
  if (els.cadEditorHistoryStatus) els.cadEditorHistoryStatus.textContent = `${history.undo?.length || 0} / ${history.redo?.length || 0}`;
}

function cadEditorLandHandlePoints(rect) {
  if (!rect) return [];
  const cx = (rect.minX + rect.maxX) / 2;
  const cy = (rect.minY + rect.maxY) / 2;
  return [
    ['nw', rect.minX, rect.maxY], ['n', cx, rect.maxY], ['ne', rect.maxX, rect.maxY],
    ['e', rect.maxX, cy], ['se', rect.maxX, rect.minY], ['s', cx, rect.minY],
    ['sw', rect.minX, rect.minY], ['w', rect.minX, cy],
  ];
}
function hitCadEditorLandHandle(screenX, screenY) {
  const land = cadEditorLand();
  if (!land) return null;
  const rect = cadEditorLandRect(land);
  if (!rect) return null;
  let best = null;
  let distance = 9;
  for (const [name, x, y] of cadEditorLandHandlePoints(rect)) {
    const point = cadEditorWorldToScreen(x, y);
    const current = Math.hypot(point.x - screenX, point.y - screenY);
    if (current <= distance) { best = name; distance = current; }
  }
  return best;
}
function setCadEditorResizeCursor(handle) {
  const canvas = els.cadEditorCanvas;
  if (!canvas) return;
  canvas.classList.remove('resize-ns', 'resize-ew', 'resize-nesw', 'resize-nwse');
  if (!handle) return;
  if (handle === 'n' || handle === 's') canvas.classList.add('resize-ns');
  else if (handle === 'e' || handle === 'w') canvas.classList.add('resize-ew');
  else if (handle === 'ne' || handle === 'sw') canvas.classList.add('resize-nesw');
  else canvas.classList.add('resize-nwse');
}
function resizeCadEditorLandFromSnapshot(snapshot, handle, world) {
  const land = snapshot.land;
  const minimum = Math.max(.0001, 2 / Math.max(1, state.cadEditor.visual.scale));
  let minX = snapshot.rect.minX, maxX = snapshot.rect.maxX;
  let minY = snapshot.rect.minY, maxY = snapshot.rect.maxY;
  const x = cadEditorSnapValue(world.x);
  const y = cadEditorSnapValue(world.y);
  if (handle.includes('w')) minX = Math.min(x, maxX - minimum);
  if (handle.includes('e')) maxX = Math.max(x, minX + minimum);
  if (handle.includes('s')) minY = Math.min(y, maxY - minimum);
  if (handle.includes('n')) maxY = Math.max(y, minY + minimum);
  land.left = minX;
  land.top = maxY;
  land.width = Math.max(minimum, maxX - minX);
  land.length = Math.max(minimum, maxY - minY);
  if (Number.isFinite(Number(land.centerX))) land.centerX = (minX + maxX) / 2;
  if (Number.isFinite(Number(land.centerY))) land.centerY = (minY + maxY) / 2;
  invalidateCadEditorBounds(snapshot.component);
}
function nextCadEditorRefDes(baseName = 'U') {
  const match = String(baseName || '').trim().match(/^([A-Za-z]+)[-_]?(\d+)$/);
  const prefix = (match?.[1] || String(baseName || 'U').replace(/[^A-Za-z]/g, '') || 'U').toUpperCase();
  let highest = 0;
  const pattern = new RegExp(`^${prefix}[-_]?(\\d+)$`, 'i');
  for (const component of state.cadEditor.model?.components || []) {
    const current = String(component.name || '').match(pattern);
    if (current) highest = Math.max(highest, Number(current[1]) || 0);
  }
  return `${prefix}${highest + 1}`;
}
function cloneCadEditorComponent(source, dx, dy) {
  const copy = addComponent(state.cadEditor.model, {
    name: nextCadEditorRefDes(source.name),
    packageName: source.packageName,
    revision: source.revision,
    centerX: Number(source.centerX || cadEditorBounds(source).centerX) + dx,
    centerY: Number(source.centerY || cadEditorBounds(source).centerY) + dy,
    angle: Number(source.angle || 0),
  });
  for (const land of source.lands || []) {
    addLand(state.cadEditor.model, copy, {
      cadName: land.cadName,
      side: land.side,
      left: Number(land.left || 0) + dx,
      top: Number(land.top || 0) + dy,
      width: land.width,
      length: land.length,
    });
  }
  return copy;
}
function duplicateSelectedCadEditorComponents() {
  const selected = cadEditorSelectedComponents();
  if (!selected.length) return false;
  const historyTransaction = beginCadEditorHistory(`ทำสำเนา ${selected.length} Component`, { componentUids: selected, structure: true });
  const step = Math.max(.1, Number(els.cadEditorNudgeStep?.value) || .1);
  const offset = step * 5;
  const copies = selected.map((component) => cloneCadEditorComponent(component, offset, -offset));
  invalidateCadEditorBounds();
  markCadEditorChanged(`ทำสำเนา ${formatInt.format(copies.length)} Component แล้ว · ลากไปยังตำแหน่งใหม่ได้ทันที`);
  renderCadEditorSummary();
  setCadEditorSelection(copies, { primary: copies[0] || null });
  commitCadEditorHistory(historyTransaction, { componentUids: copies });
  return true;
}
function copyCadEditorSelection() {
  const selected = cadEditorSelectedComponents();
  if (!selected.length) return false;
  state.cadEditor.clipboard = selected.map((component) => ({
    name: component.name,
    packageName: component.packageName,
    revision: component.revision,
    centerX: Number(component.centerX), centerY: Number(component.centerY), angle: Number(component.angle || 0),
    lands: (component.lands || []).map((land) => ({ cadName: land.cadName, side: land.side, left: Number(land.left), top: Number(land.top), width: Number(land.width), length: Number(land.length) })),
  }));
  els.cadEditorMessage.textContent = `คัดลอก ${formatInt.format(selected.length)} Component แล้ว`;
  updateCadEditorMenuState();
  return true;
}
function pasteCadEditorClipboard() {
  const clipboard = state.cadEditor.clipboard || [];
  if (!clipboard.length) return false;
  const historyTransaction = beginCadEditorHistory(`วาง ${clipboard.length} Component`, { structure: true });
  const step = Math.max(.1, Number(els.cadEditorNudgeStep?.value) || .1) * 5;
  const copies = [];
  for (const source of clipboard) {
    const component = addComponent(state.cadEditor.model, {
      name: nextCadEditorRefDes(source.name), packageName: source.packageName, revision: source.revision,
      centerX: (Number.isFinite(source.centerX) ? source.centerX : 0) + step,
      centerY: (Number.isFinite(source.centerY) ? source.centerY : 0) - step,
      angle: source.angle,
    });
    for (const land of source.lands || []) addLand(state.cadEditor.model, component, { ...land, left: land.left + step, top: land.top - step });
    copies.push(component);
  }
  invalidateCadEditorBounds();
  markCadEditorChanged(`วาง ${formatInt.format(copies.length)} Component แล้ว`);
  renderCadEditorSummary();
  setCadEditorSelection(copies, { primary: copies[0] || null });
  commitCadEditorHistory(historyTransaction, { componentUids: copies });
  return true;
}
function rotateCadEditorSelection(degrees = 90) {
  const landMode = state.cadEditor.visual.mode === 'land';
  const selectedLands = landMode ? cadEditorSelectedLands() : [];
  const selected = cadEditorSelectedComponents();
  if (landMode && !selectedLands.length) return false;
  if (!landMode && !selected.length) return false;
  const affectedComponents = selectedLands.length ? [cadEditorComponent()].filter(Boolean) : selected;
  const targetLabel = selectedLands.length ? `${selectedLands.length} Land` : `${selected.length} Component`;
  const historyTransaction = beginCadEditorHistory(`หมุน ${targetLabel} ${degrees > 0 ? 'ขวา' : 'ซ้าย'} 90°`, { componentUids: affectedComponents });
  const normalized = ((Number(degrees) % 360) + 360) % 360;
  const rotatePoint = (x, y, px, py) => {
    const rad = normalized * Math.PI / 180;
    const dx = x - px, dy = y - py;
    return { x: px + dx * Math.cos(rad) - dy * Math.sin(rad), y: py + dx * Math.sin(rad) + dy * Math.cos(rad) };
  };
  const rotateLand = (item, pivotX, pivotY) => {
    const rect = cadEditorLandRect(item); if (!rect) return;
    const center = rotatePoint((rect.minX + rect.maxX) / 2, (rect.minY + rect.maxY) / 2, pivotX, pivotY);
    let width = rect.maxX - rect.minX, length = rect.maxY - rect.minY;
    if (normalized === 90 || normalized === 270) [width, length] = [length, width];
    item.left = center.x - width / 2;
    item.top = center.y + length / 2;
    item.width = width;
    item.length = length;
    if (Number.isFinite(Number(item.centerX))) item.centerX = center.x;
    if (Number.isFinite(Number(item.centerY))) item.centerY = center.y;
  };
  if (selectedLands.length) {
    for (const land of selectedLands) {
      const rect = cadEditorLandRect(land); if (!rect) continue;
      rotateLand(land, (rect.minX + rect.maxX) / 2, (rect.minY + rect.maxY) / 2);
    }
    invalidateCadEditorBounds(cadEditorComponent());
  } else {
    for (const component of selected) {
      const bounds = cadEditorBounds(component);
      const pivotX = Number.isFinite(Number(component.centerX)) ? Number(component.centerX) : bounds.centerX;
      const pivotY = Number.isFinite(Number(component.centerY)) ? Number(component.centerY) : bounds.centerY;
      for (const item of component.lands || []) rotateLand(item, pivotX, pivotY);
      component.angle = ((Number(component.angle) || 0) + Number(degrees) + 3600) % 360;
      invalidateCadEditorBounds(component);
    }
  }
  markCadEditorChanged(`หมุน ${targetLabel} ${degrees > 0 ? 'ขวา' : 'ซ้าย'} 90° แล้ว`);
  renderCadEditor();
  commitCadEditorHistory(historyTransaction, { componentUids: affectedComponents });
  return true;
}
function flipCadEditorSelectionSide() {
  const landMode = state.cadEditor.visual.mode === 'land';
  const selectedLands = landMode ? cadEditorSelectedLands() : [];
  const selected = cadEditorSelectedComponents();
  if (landMode && !selectedLands.length) return false;
  const targets = landMode ? selectedLands : selected.flatMap((component) => component.lands || []);
  if (!targets.length) return false;
  const affectedComponents = selectedLands.length ? [cadEditorComponent()].filter(Boolean) : selected;
  const historyTransaction = beginCadEditorHistory(`เปลี่ยนด้าน ${targets.length} Land`, { componentUids: affectedComponents });
  for (const item of targets) {
    const side = normalizeSide(item.side);
    item.side = side === 'bottom' ? 'Top' : 'Bottom';
  }
  markCadEditorChanged(`เปลี่ยนด้าน ${formatInt.format(targets.length)} Land แล้ว`);
  renderCadEditor();
  commitCadEditorHistory(historyTransaction, { componentUids: affectedComponents });
  return true;
}

function alignCadEditorSelection(kind) {
  const selected = cadEditorSelectedComponents();
  if (selected.length < 2) return false;
  const historyTransaction = beginCadEditorHistory(`จัดแนว ${selected.length} Component`, { componentUids: selected });
  const items = selected.map((component) => ({ component, bounds: cadEditorBounds(component) }));
  const group = combinedCadEditorBounds(selected);
  for (const item of items) {
    let dx = 0, dy = 0;
    if (kind === 'left') dx = group.minX - item.bounds.minX;
    else if (kind === 'center-x') dx = group.centerX - item.bounds.centerX;
    else if (kind === 'right') dx = group.maxX - item.bounds.maxX;
    else if (kind === 'top') dy = group.maxY - item.bounds.maxY;
    else if (kind === 'center-y') dy = group.centerY - item.bounds.centerY;
    else if (kind === 'bottom') dy = group.minY - item.bounds.minY;
    moveComponent(item.component, dx, dy);
    invalidateCadEditorBounds(item.component);
  }
  markCadEditorChanged(`จัดแนว ${formatInt.format(selected.length)} Component แล้ว`);
  renderCadEditor();
  commitCadEditorHistory(historyTransaction, { componentUids: selected });
  return true;
}
function updateCadEditorSelectionBar() {
  const bar = els.cadEditorSelectionBar;
  if (!bar || els.cadEditorOverlay.classList.contains('hidden')) return;
  let bounds = null;
  if (state.cadEditor.visual.mode === 'land' && cadEditorSelectedLands().length) bounds = combinedCadEditorLandBounds();
  else bounds = combinedCadEditorBounds(cadEditorSelectedComponents());
  if (!bounds) { bar.classList.add('hidden'); return; }
  const a = cadEditorWorldToScreen(bounds.minX, bounds.maxY);
  const b = cadEditorWorldToScreen(bounds.maxX, bounds.minY);
  const width = els.cadEditorCanvas.clientWidth || 1;
  const desiredX = (a.x + b.x) / 2;
  const desiredY = Math.min(a.y, b.y) - 42;
  bar.classList.remove('hidden');
  const barWidth = bar.offsetWidth || 210;
  const barHeight = bar.offsetHeight || 36;
  bar.style.left = `${Math.max(8, Math.min(width - barWidth - 8, desiredX - barWidth / 2))}px`;
  bar.style.top = `${Math.max(42, desiredY > 42 ? desiredY : Math.max(a.y, b.y) + 10)}px`;
}
function hideCadEditorContextMenu() { els.cadEditorContextMenu?.classList.add('hidden'); }
function openCadEditorContextMenu(event) {
  event.preventDefault();
  const point = cadEditorCanvasPoint(event);
  if (state.cadEditor.visual.mode === 'land') {
    const land = hitCadEditorLand(point.x, point.y);
    if (land && !cadEditorLandSelectionSet().has(land.uid)) setCadEditorLandSelection([land], { primary: land });
    else if (land) state.cadEditor.selectedLandUid = land.uid;
  } else {
    const hit = hitCadEditorComponent(point.x, point.y);
    if (hit && !cadEditorSelectionSet().has(hit.uid)) setCadEditorSelection([hit], { primary: hit });
  }
  renderCadEditorVisualProperties();
  const menu = els.cadEditorContextMenu;
  if (!menu || (!cadEditorSelectedComponents().length && !cadEditorLand())) return;
  menu.classList.remove('hidden');
  const w = menu.offsetWidth || 220, h = menu.offsetHeight || 260;
  menu.style.left = `${Math.max(6, Math.min((els.cadEditorCanvas.clientWidth || 1) - w - 6, point.x))}px`;
  menu.style.top = `${Math.max(6, Math.min((els.cadEditorCanvas.clientHeight || 1) - h - 6, point.y))}px`;
}
function runCadEditorActionNow(action) {
  hideCadEditorContextMenu();
  const landMode = state.cadEditor.visual.mode === 'land';
  const hasSelectedLand = cadEditorSelectedLands().length > 0;
  if (action === 'duplicate') return landMode ? (hasSelectedLand ? duplicateCadEditorLand() : false) : duplicateSelectedCadEditorComponents();
  if (action === 'rotate-left') return rotateCadEditorSelection(-90);
  if (action === 'rotate-right') return rotateCadEditorSelection(90);
  if (action === 'flip-side') return flipCadEditorSelectionSide();
  if (action === 'renumber') return renumberCadEditorComponent();
  if (action === 'fit-selection') {
    if (landMode) {
      if (!hasSelectedLand) return false;
      fitCadEditorView([cadEditorComponent()]);
    } else {
      const selected = cadEditorSelectedComponents();
      if (!selected.length) return false;
      fitCadEditorView(selected);
    }
    return true;
  }
  if (action === 'split-lands') return landMode && hasSelectedLand ? splitSelectedCadEditorLands() : false;
  if (action === 'delete') return landMode ? (hasSelectedLand ? removeCadEditorLand() : false) : removeCadEditorComponent();
  return false;
}
function runCadEditorAction(action) {
  const labels = {
    duplicate: 'ทำสำเนา',
    'rotate-left': 'หมุนซ้าย',
    'rotate-right': 'หมุนขวา',
    'flip-side': 'เปลี่ยนด้าน',
    renumber: 'เริ่มชื่อ A1',
    'fit-selection': 'Fit ที่เลือก',
    'split-lands': 'แยก Land เป็น Component ใหม่',
    delete: 'ลบที่เลือก',
  };
  return runCadEditorOperation(labels[action] || 'ประมวลผล CAD', () => runCadEditorActionNow(action));
}

function drawCadEditorLands(component, selectedComponent, width, height) {
  const view = state.cadEditor.visual;
  const selectedLand = cadEditorLand();
  const selectedLands = cadEditorLandSelectionSet();
  const selectedLandCount = selectedLands.size;
  for (const land of component.lands || []) {
    if (view.side !== 'all' && normalizeSide(land.side) !== view.side) continue;
    const rect = cadEditorLandRect(land); if (!rect) continue;
    const p1 = cadEditorWorldToScreen(rect.minX, rect.maxY), p2 = cadEditorWorldToScreen(rect.maxX, rect.minY);
    if (p2.x < -4 || p1.x > width + 4 || p2.y < -4 || p1.y > height + 4) continue;
    const w = Math.max(2, p2.x - p1.x), h = Math.max(2, p2.y - p1.y);
    const isSelected = selectedLands.has(land.uid);
    cadEditorCtx.fillStyle = isSelected ? 'rgba(255,199,86,.88)' : normalizeSide(land.side) === 'bottom' ? 'rgba(211,104,255,.58)' : 'rgba(64,220,201,.58)';
    cadEditorCtx.strokeStyle = isSelected ? '#fff2c2' : 'rgba(220,242,255,.48)';
    cadEditorCtx.lineWidth = isSelected ? 2 : 1;
    cadEditorCtx.fillRect(p1.x, p1.y, w, h); cadEditorCtx.strokeRect(p1.x, p1.y, w, h);
    if (isSelected && selectedLandCount === 1 && selectedLand?.uid === land.uid) {
      cadEditorCtx.fillStyle = '#fff4c7';
      cadEditorCtx.strokeStyle = '#5a4821';
      cadEditorCtx.lineWidth = 1;
      for (const [, hx, hy] of cadEditorLandHandlePoints(rect)) {
        const handle = cadEditorWorldToScreen(hx, hy);
        cadEditorCtx.fillRect(handle.x - 4, handle.y - 4, 8, 8);
        cadEditorCtx.strokeRect(handle.x - 4, handle.y - 4, 8, 8);
      }
    }
    if (view.labels && (isSelected || w > 22) && h > 9) {
      cadEditorCtx.fillStyle = '#f3fbff'; cadEditorCtx.font = '9px system-ui'; cadEditorCtx.textAlign = 'center'; cadEditorCtx.textBaseline = 'middle';
      cadEditorCtx.fillText(String(land.cadName || land.globalId || ''), p1.x + w / 2, p1.y + h / 2, Math.max(10, w - 3));
    }
  }
}
function drawCadEditorCanvas() {
  if (!els.cadEditorCanvas || els.cadEditorOverlay.classList.contains('hidden')) return;
  const width = els.cadEditorCanvas.clientWidth || 1, height = els.cadEditorCanvas.clientHeight || 1;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const targetW = Math.max(1, Math.round(width * dpr)), targetH = Math.max(1, Math.round(height * dpr));
  if (els.cadEditorCanvas.width !== targetW || els.cadEditorCanvas.height !== targetH) { els.cadEditorCanvas.width = targetW; els.cadEditorCanvas.height = targetH; }
  cadEditorCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cadEditorCtx.fillStyle = '#07101a'; cadEditorCtx.fillRect(0, 0, width, height);
  drawCadEditorGrid(width, height);
  const boardBounds = cadEditorBoardBounds();
  if (boardBounds) {
    const boardTopLeft = cadEditorWorldToScreen(boardBounds.minX, boardBounds.maxY);
    const boardBottomRight = cadEditorWorldToScreen(boardBounds.maxX, boardBounds.minY);
    cadEditorCtx.save();
    cadEditorCtx.fillStyle = 'rgba(19,31,41,.28)';
    cadEditorCtx.strokeStyle = 'rgba(151,184,206,.58)';
    cadEditorCtx.lineWidth = 1.4;
    cadEditorCtx.setLineDash([8, 5]);
    cadEditorCtx.fillRect(boardTopLeft.x, boardTopLeft.y, boardBottomRight.x - boardTopLeft.x, boardBottomRight.y - boardTopLeft.y);
    cadEditorCtx.strokeRect(boardTopLeft.x, boardTopLeft.y, boardBottomRight.x - boardTopLeft.x, boardBottomRight.y - boardTopLeft.y);
    cadEditorCtx.setLineDash([]);
    cadEditorCtx.fillStyle = 'rgba(185,207,224,.72)';
    cadEditorCtx.font = '9px system-ui';
    cadEditorCtx.textAlign = 'left';
    cadEditorCtx.textBaseline = 'bottom';
    cadEditorCtx.fillText(`BOARD ${formatFloat.format(boardBounds.width)} × ${formatFloat.format(boardBounds.height)} mm`, boardTopLeft.x + 7, boardTopLeft.y - 5);
    cadEditorCtx.restore();
  }
  const selected = cadEditorSelectionSet();
  const visible = visibleCadEditorComponents();
  const lightweightSelection = selected.size > CAD_EDITOR_LIGHT_SELECTION_LIMIT;
  els.cadEditorOverlay?.querySelector('.cad-studio-shell')?.classList.toggle('cad-light-selection', lightweightSelection);
  const drawAllLands = !lightweightSelection && state.cadEditor.visual.scale > 13 && visible.length < 1800;
  for (const component of visible) {
    const bounds = cadEditorBounds(component);
    const p1 = cadEditorWorldToScreen(bounds.minX, bounds.maxY), p2 = cadEditorWorldToScreen(bounds.maxX, bounds.minY);
    if (p2.x < -6 || p1.x > width + 6 || p2.y < -6 || p1.y > height + 6) continue;
    const w = Math.max(2, p2.x - p1.x), h = Math.max(2, p2.y - p1.y);
    const isSelected = selected.has(component.uid);
    const sides = new Set((component.lands || []).map((land) => normalizeSide(land.side)));
    const stroke = sides.has('top') && sides.has('bottom') ? '#79b7ff' : sides.has('bottom') ? '#d56eff' : '#55dcc9';
    cadEditorCtx.fillStyle = isSelected ? 'rgba(255,196,70,.18)' : 'rgba(34,76,105,.07)';
    cadEditorCtx.strokeStyle = isSelected ? '#ffd36e' : stroke;
    cadEditorCtx.lineWidth = isSelected ? 2.2 : Math.max(.7, Math.min(1.3, state.cadEditor.visual.scale / 25));
    cadEditorCtx.fillRect(p1.x, p1.y, w, h); cadEditorCtx.strokeRect(p1.x, p1.y, w, h);
    if (isSelected) { cadEditorCtx.fillStyle = '#ffd36e'; for (const [x,y] of [[p1.x,p1.y],[p2.x,p1.y],[p2.x,p2.y],[p1.x,p2.y]]) cadEditorCtx.fillRect(x-2.5,y-2.5,5,5); }
    if (state.cadEditor.visual.labels && (isSelected || w * h > 360) && w > 16 && h > 8) {
      cadEditorCtx.fillStyle = isSelected ? '#fff3c7' : '#cbe7f7'; cadEditorCtx.font = `${isSelected ? '600 ' : ''}10px system-ui`; cadEditorCtx.textAlign = 'center'; cadEditorCtx.textBaseline = 'middle';
      cadEditorCtx.fillText(String(component.name || component.id || ''), p1.x + w / 2, p1.y + h / 2, Math.max(12, w - 4));
    }
    if ((!lightweightSelection && isSelected) || drawAllLands || state.cadEditor.visual.mode === 'land' && component.uid === state.cadEditor.selectedComponentUid) drawCadEditorLands(component, isSelected, width, height);
  }
  const interaction = state.cadEditor.visual.interaction;
  if (interaction?.kind === 'marquee' || interaction?.kind === 'land-marquee') {
    const x = Math.min(interaction.start.x, interaction.current.x), y = Math.min(interaction.start.y, interaction.current.y);
    const w = Math.abs(interaction.current.x - interaction.start.x), h = Math.abs(interaction.current.y - interaction.start.y);
    cadEditorCtx.fillStyle = 'rgba(65,180,255,.13)'; cadEditorCtx.strokeStyle = '#64c7ff'; cadEditorCtx.lineWidth = 1.2; cadEditorCtx.setLineDash([6,4]);
    cadEditorCtx.fillRect(x,y,w,h); cadEditorCtx.strokeRect(x+.5,y+.5,w,h); cadEditorCtx.setLineDash([]);
  }
  if (els.cadEditorZoomStatus) els.cadEditorZoomStatus.textContent = `${Math.round(state.cadEditor.visual.scale * 100)}%`;
  requestAnimationFrame(updateCadEditorSelectionBar);
}
function hitCadEditorComponent(screenX, screenY) {
  const world = cadEditorScreenToWorld(screenX, screenY);
  const tolerance = Math.max(.015, 7 / state.cadEditor.visual.scale);
  let best = null, bestArea = Infinity;
  for (const component of visibleCadEditorComponents()) {
    const b = cadEditorBounds(component);
    if (world.x < b.minX - tolerance || world.x > b.maxX + tolerance || world.y < b.minY - tolerance || world.y > b.maxY + tolerance) continue;
    const area = b.width * b.height;
    if (area < bestArea) { best = component; bestArea = area; }
  }
  return best;
}
function hitCadEditorLand(screenX, screenY) {
  const component = cadEditorComponent(); if (!component) return null;
  const world = cadEditorScreenToWorld(screenX, screenY);
  const tolerance = Math.max(.005, 5 / state.cadEditor.visual.scale);
  let best = null, area = Infinity;
  for (const land of component.lands || []) {
    if (state.cadEditor.visual.side !== 'all' && normalizeSide(land.side) !== state.cadEditor.visual.side) continue;
    const r = cadEditorLandRect(land); if (!r) continue;
    if (world.x < r.minX - tolerance || world.x > r.maxX + tolerance || world.y < r.minY - tolerance || world.y > r.maxY + tolerance) continue;
    const candidateArea = (r.maxX-r.minX)*(r.maxY-r.minY);
    if (candidateArea < area) { best = land; area = candidateArea; }
  }
  return best;
}
function hitCadEditorLandTarget(screenX, screenY) {
  const world = cadEditorScreenToWorld(screenX, screenY);
  const tolerance = Math.max(.005, 5 / state.cadEditor.visual.scale);
  let best = null;
  let bestArea = Infinity;
  const components = visibleCadEditorComponents();
  const primary = cadEditorComponent();
  const ordered = primary ? [primary, ...components.filter((component) => component !== primary)] : components;
  for (const component of ordered) {
    const bounds = cadEditorBounds(component);
    if (world.x < bounds.minX - tolerance || world.x > bounds.maxX + tolerance || world.y < bounds.minY - tolerance || world.y > bounds.maxY + tolerance) continue;
    for (const land of component.lands || []) {
      if (state.cadEditor.visual.side !== 'all' && normalizeSide(land.side) !== state.cadEditor.visual.side) continue;
      const rect = cadEditorLandRect(land); if (!rect) continue;
      if (world.x < rect.minX - tolerance || world.x > rect.maxX + tolerance || world.y < rect.minY - tolerance || world.y > rect.maxY + tolerance) continue;
      const area = (rect.maxX - rect.minX) * (rect.maxY - rect.minY);
      if (area < bestArea) { best = { component, land }; bestArea = area; }
    }
    if (best && component === primary) break;
  }
  return best;
}
function cadEditorMarqueeWorldBox(start, end) {
  const a = cadEditorScreenToWorld(start.x, start.y), b = cadEditorScreenToWorld(end.x, end.y);
  return { minX: Math.min(a.x,b.x), maxX: Math.max(a.x,b.x), minY: Math.min(a.y,b.y), maxY: Math.max(a.y,b.y) };
}
function componentsInsideCadEditorMarquee(start, end) {
  const box = cadEditorMarqueeWorldBox(start, end);
  return visibleCadEditorComponents().filter((component) => { const c = cadEditorBounds(component); return c.maxX >= box.minX && c.minX <= box.maxX && c.maxY >= box.minY && c.minY <= box.maxY; });
}
function landsInsideCadEditorMarquee(component, start, end) {
  if (!component) return [];
  const box = cadEditorMarqueeWorldBox(start, end);
  return (component.lands || []).filter((land) => {
    if (state.cadEditor.visual.side !== 'all' && normalizeSide(land.side) !== state.cadEditor.visual.side) return false;
    const rect = cadEditorLandRect(land);
    return rect && rect.maxX >= box.minX && rect.minX <= box.maxX && rect.maxY >= box.minY && rect.minY <= box.maxY;
  });
}
function combinedCadEditorLandBounds(lands = cadEditorSelectedLands()) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const land of lands || []) {
    const rect = cadEditorLandRect(land); if (!rect) continue;
    minX = Math.min(minX, rect.minX); minY = Math.min(minY, rect.minY);
    maxX = Math.max(maxX, rect.maxX); maxY = Math.max(maxY, rect.maxY);
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY, centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2 };
}
function captureCadEditorComponentPositions(components) {
  return components.map((component) => ({ component, centerX: component.centerX, centerY: component.centerY, lands: (component.lands || []).map((land) => ({ land, left: land.left, top: land.top, centerX: land.centerX, centerY: land.centerY })) }));
}
function restoreCadEditorComponentPositions(snapshot) {
  for (const item of snapshot || []) {
    item.component.centerX = item.centerX; item.component.centerY = item.centerY;
    for (const land of item.lands) { land.land.left = land.left; land.land.top = land.top; if ('centerX' in land.land) land.land.centerX = land.centerX; if ('centerY' in land.land) land.land.centerY = land.centerY; }
    invalidateCadEditorBounds(item.component);
  }
}
function renderCadEditorLandForm() {
  const land = cadEditorLand();
  const controls = [els.cadEditorLandId, els.cadEditorLandName, els.cadEditorLandSide, els.cadEditorLandLeft, els.cadEditorLandTop, els.cadEditorLandWidth, els.cadEditorLandLength, els.cadEditorSaveLandButton];
  for (const control of controls) control.disabled = !land;
  els.cadEditorLandId.value = land?.globalId ?? '';
  els.cadEditorLandName.value = land?.cadName ?? '';
  const normalized = normalizeSide(land?.side); els.cadEditorLandSide.value = normalized === 'top' ? 'Top' : normalized === 'bottom' ? 'Bottom' : '';
  els.cadEditorLandLeft.value = land?.left ?? ''; els.cadEditorLandTop.value = land?.top ?? ''; els.cadEditorLandWidth.value = land?.width ?? ''; els.cadEditorLandLength.value = land?.length ?? '';
  const selectedCount = cadEditorSelectedLands().length;
  els.cadEditorDuplicateLandButton.disabled = selectedCount === 0;
  if (els.cadEditorCutLandButton) els.cadEditorCutLandButton.disabled = selectedCount !== 1;
  if (els.cadEditorMergeLandButton) els.cadEditorMergeLandButton.disabled = selectedCount < 2;
  if (els.cadEditorSplitLandButton) els.cadEditorSplitLandButton.disabled = selectedCount === 0 || selectedCount >= (cadEditorComponent()?.lands?.length || 0);
  els.cadEditorDeleteLandButton.disabled = selectedCount === 0;
}
function renderCadEditorVisualProperties() {
  const selected = cadEditorSelectedComponents();
  const primary = cadEditorComponent();
  const land = cadEditorLand();
  const selectedLands = cadEditorSelectedLands();
  const landCount = selectedLands.length;
  const count = selected.length;
  const landMode = state.cadEditor.visual.mode === 'land';
  const isLand = landMode && landCount > 0;
  const activeTargets = landMode ? isLand : count > 0;

  els.cadEditorComponentLabel.textContent = count ? `${formatInt.format(count)} Component ที่เลือก` : '0 Component ที่เลือก';
  els.cadEditorSelectionLabel.textContent = isLand
    ? (landCount === 1 ? `Land ${land.cadName || land.globalId} · ${primary?.name || primary?.id}` : `เลือก ${formatInt.format(landCount)} Lands · ${primary?.name || primary?.id}`)
    : (count ? `เลือก ${formatInt.format(count)} Component` : 'ยังไม่ได้เลือก Component');

  if (isLand) {
    els.cadEditorPropertyTitle.textContent = landCount === 1 ? (land.cadName || `Land ${land.globalId}`) : `${formatInt.format(landCount)} Lands`;
    els.cadEditorPropertySubtitle.textContent = landCount === 1
      ? `${primary?.name || primary?.id} · ${normalizeSide(land.side) === 'bottom' ? 'Bottom' : 'Top'} · ลากจุดจับเพื่อปรับขนาด`
      : `${primary?.name || primary?.id} · ลากเพื่อย้ายพร้อมกัน · Split เพื่อแยกเป็น Component ใหม่`;
  } else if (!count) {
    els.cadEditorPropertyTitle.textContent = 'ยังไม่ได้เลือก';
    els.cadEditorPropertySubtitle.textContent = 'คลิก Component บนบอร์ดหรือลากกรอบคลุม';
  } else if (count === 1) {
    els.cadEditorPropertyTitle.textContent = primary?.name || `Component ${primary?.id}`;
    els.cadEditorPropertySubtitle.textContent = `${primary?.packageName || 'No package'} · ${formatInt.format(primary?.lands?.length || 0)} Lands`;
  } else {
    els.cadEditorPropertyTitle.textContent = `${formatInt.format(count)} Components`;
    els.cadEditorPropertySubtitle.textContent = selected.slice(0, 4).map((component) => component.name || component.id).join(', ') + (count > 4 ? ` และอีก ${count - 4}` : '');
  }

  const setDisabled = (control, disabled) => { if (control) control.disabled = disabled; };
  setDisabled(els.cadEditorDeleteComponentButton, count === 0);
  setDisabled(els.cadEditorRenumberComponentButton, count === 0);
  setDisabled(els.cadEditorMoveButton, count === 0);
  setDisabled(els.cadEditorAddComponentButton, count === 0);
  setDisabled(els.cadEditorRotateLeftButton, !activeTargets);
  setDisabled(els.cadEditorRotateRightButton, !activeTargets);
  setDisabled(els.cadEditorFlipSideButton, !activeTargets);
  setDisabled(els.cadEditorDockDuplicateButton, landMode ? !isLand : count === 0);
  setDisabled(els.cadEditorDockRotateButton, !activeTargets);
  setDisabled(els.cadEditorDockFlipButton, !activeTargets);
  for (const control of [els.cadEditorAlignLeftButton, els.cadEditorAlignCenterXButton, els.cadEditorAlignRightButton, els.cadEditorAlignTopButton, els.cadEditorAlignCenterYButton, els.cadEditorAlignBottomButton]) setDisabled(control, count < 2 || isLand);
  setDisabled(els.cadEditorAddLandButton, count !== 1);
  setDisabled(els.cadEditorCutLandButton, !isLand || landCount !== 1);
  setDisabled(els.cadEditorMergeLandButton, !isLand || landCount < 2);
  setDisabled(els.cadEditorSplitLandButton, !isLand || landCount >= (primary?.lands?.length || 0));
  document.querySelectorAll('[data-cad-action="split-lands"]').forEach((button) => {
    button.disabled = !isLand || landCount >= (primary?.lands?.length || 0);
    button.classList.toggle('hidden', !landMode);
  });

  els.cadEditorComponentMode.classList.toggle('active', state.cadEditor.visual.mode === 'component');
  els.cadEditorLandMode.classList.toggle('active', state.cadEditor.visual.mode === 'land');
  els.cadEditorSelectTool.classList.toggle('active', state.cadEditor.visual.tool === 'select');
  els.cadEditorPanTool.classList.toggle('active', state.cadEditor.visual.tool === 'pan');
  els.cadEditorCanvas.classList.toggle('pan-tool', state.cadEditor.visual.tool === 'pan' || state.cadEditor.visual.spaceDown);
  els.cadEditorSelectionHint.textContent = state.cadEditor.visual.mode === 'land'
    ? 'คลิก Land · Shift/Ctrl เพิ่มการเลือก · ลากพื้นที่ว่างเพื่อคลุมหลาย Land · Split แยก Component · Delete ลบ'
    : 'คลิก Component · Shift/Ctrl เพิ่มการเลือก · ลากกรอบคลุม · ลากที่เลือกเพื่อย้าย · Ctrl+D ทำสำเนา';
  els.cadEditorLandLabel.textContent = land
    ? (landCount === 1 ? `${primary?.name || primary?.id} · ${land.cadName || land.globalId}` : `${primary?.name || primary?.id} · เลือก ${formatInt.format(landCount)} Lands`)
    : (primary ? `${primary.name || primary.id} · กด Land แล้วคลิก Pad` : 'เลือก Component ก่อน');

  let infoType = '—', infoName = '—', infoPackage = '—', infoSide = '—', infoPosition = '—', infoSize = '—';
  if (isLand) {
    const rect = landCount === 1 ? cadEditorLandRect(land) : combinedCadEditorLandBounds(selectedLands);
    infoType = landCount === 1 ? 'Land / Pin' : 'Multi Land selection';
    infoName = landCount === 1 ? (land.cadName || String(land.globalId || '—')) : `${formatInt.format(landCount)} Lands`;
    infoPackage = primary?.packageName || '—';
    const landSides = new Set(selectedLands.map((item) => normalizeSide(item.side)));
    infoSide = landSides.size > 1 ? 'Mixed' : landSides.has('bottom') ? 'Bottom' : landSides.has('top') ? 'Top' : 'Unknown';
    if (rect) {
      infoPosition = `X ${formatFloat.format(rect.minX)} · Y ${formatFloat.format(rect.maxY)} mm`;
      infoSize = `${formatFloat.format(rect.maxX - rect.minX)} × ${formatFloat.format(rect.maxY - rect.minY)} mm`;
    }
  } else if (count === 1 && primary) {
    const bounds = cadEditorBounds(primary);
    const sides = new Set((primary.lands || []).map((item) => normalizeSide(item.side)));
    infoType = 'Component';
    infoName = primary.name || String(primary.id || '—');
    infoPackage = primary.packageName || '—';
    infoSide = sides.has('top') && sides.has('bottom') ? 'Top + Bottom' : sides.has('bottom') ? 'Bottom' : 'Top';
    infoPosition = `X ${formatFloat.format(bounds.centerX)} · Y ${formatFloat.format(bounds.centerY)} mm`;
    infoSize = `${formatFloat.format(bounds.width)} × ${formatFloat.format(bounds.height)} mm · ${formatInt.format(primary.lands?.length || 0)} Lands`;
  } else if (count > 1) {
    const bounds = combinedCadEditorBounds(selected);
    infoType = 'Multi selection';
    infoName = `${formatInt.format(count)} Components`;
    infoPackage = `${new Set(selected.map((item) => item.packageName || '')).size} Packages`;
    infoSide = 'Mixed';
    infoPosition = bounds ? `Center X ${formatFloat.format(bounds.centerX)} · Y ${formatFloat.format(bounds.centerY)}` : '—';
    infoSize = bounds ? `${formatFloat.format(bounds.width)} × ${formatFloat.format(bounds.height)} mm` : '—';
  }
  if (els.cadEditorInfoType) els.cadEditorInfoType.textContent = infoType;
  if (els.cadEditorInfoName) els.cadEditorInfoName.textContent = infoName;
  if (els.cadEditorInfoPackage) els.cadEditorInfoPackage.textContent = infoPackage;
  if (els.cadEditorInfoSide) els.cadEditorInfoSide.textContent = infoSide;
  if (els.cadEditorInfoPosition) els.cadEditorInfoPosition.textContent = infoPosition;
  if (els.cadEditorInfoSize) els.cadEditorInfoSize.textContent = infoSize;

  const summary = modelSummary(state.cadEditor.model);
  if (els.cadLayerTopCount) els.cadLayerTopCount.textContent = formatInt.format(summary.top);
  if (els.cadLayerBottomCount) els.cadLayerBottomCount.textContent = formatInt.format(summary.bottom);
  document.querySelectorAll('[data-cad-side]').forEach((button) => button.classList.toggle('active', button.dataset.cadSide === state.cadEditor.visual.side));
  if (els.cadEditorSnapToggle) els.cadEditorSnapToggle.checked = state.cadEditor.visual.snap !== false;
  els.cadStudioDirtyBadge?.classList.toggle('hidden', !state.cadEditor.model?.changed);
  renderCadEditorLandForm();
  updateCadEditorMenuState();
  requestAnimationFrame(updateCadEditorSelectionBar);
}
function setCadEditorFormEnabled(enabled) {
  for (const control of [els.cadEditorComponentName, els.cadEditorPackageName, els.cadEditorRevision, els.cadEditorCenterX, els.cadEditorCenterY, els.cadEditorAngle, els.cadEditorSaveComponentButton]) control.disabled = !enabled;
}
function numberFromEditorInput(input, fallback = null) {
  const text = String(input.value ?? '').trim();
  if (!text) return fallback;
  const value = Number(text);
  return Number.isFinite(value) ? value : fallback;
}
function renderCadEditorSummary() {
  const summary = modelSummary(state.cadEditor.model);
  els.cadEditorComponentCount.textContent = formatInt.format(summary.components);
  els.cadEditorLandCount.textContent = formatInt.format(summary.lands);
  els.cadEditorTopCount.textContent = formatInt.format(summary.top);
  els.cadEditorBottomCount.textContent = formatInt.format(summary.bottom);
  els.cadEditorUnknownCount.textContent = formatInt.format(summary.unknown);
  const file = cadEditorFile();
  const rootKind = file?.archive?.packageInfo?.root?.kind || 'file';
  const packageInfo = file?.archive ? packageOutputInfo(file.archive.packageInfo, els.cadEditorExportSide.value || 'all') : null;
  const convertedOdb = file?.archive?.candidate?.format === 'odb++';
  const canExportPackage = Boolean(file?.archive && rootKind !== 'file' && file.archive.candidate?.node && !convertedOdb);
  const canExplainOdbExport = Boolean(file?.archive && rootKind !== 'file' && file.archive.candidate?.node && convertedOdb);
  els.cadEditorExportTgzButton.disabled = state.cadEditor.busy || (!canExportPackage && !canExplainOdbExport);
  els.cadEditorExportTgzButton.textContent = canExportPackage ? `Export ${packageInfo.label}` : (convertedOdb ? 'Export Archive · ODB++ ยังไม่รองรับ' : 'Export Archive');
  els.cadEditorExportTgzButton.title = convertedOdb ? 'กดเพื่อดูคำอธิบาย: ส่งออก XML ได้ แต่ยังเขียนกลับ components.Z / data.Z เป็น TGZ ไม่ได้' : (canExportPackage ? `ส่งออก ${packageInfo.label} พร้อมเก็บไฟล์ประกอบเดิม` : 'ไฟล์นี้ไม่ได้เปิดจาก Archive');
  const archiveText = file?.archive ? ` · ${rootKind.toUpperCase()} ${file.archive.name} · ${convertedOdb ? 'ODB++ → XML' : `CAD ${file.archive.candidate?.displayPath || file.name}`}` : '';
  els.cadEditorSource.textContent = file ? `${cadRoleLabel(state.activeCadRole)} · ${file.name}${archiveText}` : 'เปิด XML, ZIP หรือ TGZ เพื่อเริ่มแก้ไข';
}
function renderCadEditorComponents() {
  const model = state.cadEditor.model;
  const search = state.cadEditor.componentSearch.trim().toLowerCase();
  const matches = (model?.components || []).filter((component) => !search || [component.id, component.name, component.packageName, component.revision].some((value) => String(value ?? '').toLowerCase().includes(search)));
  const components = matches.slice(0, CAD_EDITOR_RENDER_LIMIT);
  const selected = matches.find((component) => component.uid === state.cadEditor.selectedComponentUid);
  if (selected && !components.includes(selected)) components.unshift(selected);
  const limited = matches.length > components.length;
  els.cadEditorComponentLabel.textContent = `${limited ? 'แสดง ' : ''}${formatInt.format(components.length)} / ${formatInt.format(matches.length)} ที่ตรงค้นหา · ทั้งหมด ${formatInt.format(model?.components?.length || 0)}`;
  els.cadEditorComponentList.innerHTML = '';
  for (const component of components) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `cad-editor-component-item${component.uid === state.cadEditor.selectedComponentUid ? ' active' : ''}`;
    const title = document.createElement('strong'); title.textContent = component.name || `Component ${component.id}`;
    const meta = document.createElement('span'); meta.textContent = `ID ${component.id} · ${component.packageName || 'No package'} · ${formatInt.format(component.lands.length)} lands`;
    button.append(title, meta);
    button.addEventListener('click', () => setCadEditorSelection([component], { primary: component }));
    els.cadEditorComponentList.append(button);
  }
  if (!components.length) {
    const empty = document.createElement('p'); empty.className = 'empty-state'; empty.textContent = 'ไม่พบ Component ตามคำค้น'; els.cadEditorComponentList.append(empty);
  } else if (limited) {
    const hint = document.createElement('p'); hint.className = 'empty-state cad-editor-limit-hint'; hint.textContent = `แสดงครั้งละ ${formatInt.format(CAD_EDITOR_RENDER_LIMIT)} รายการเพื่อให้ไฟล์ใหญ่ทำงานลื่น · พิมพ์ RefDes หรือ Package ในช่องค้นหา`; els.cadEditorComponentList.append(hint);
  }
}
function renderCadEditorComponentForm() {
  const component = cadEditorComponent();
  setCadEditorFormEnabled(Boolean(component) && cadEditorSelectedComponents().length === 1);
  els.cadEditorComponentId.value = component?.id ?? '';
  els.cadEditorComponentName.value = component?.name ?? '';
  els.cadEditorPackageName.value = component?.packageName ?? '';
  els.cadEditorRevision.value = component?.revision ?? '';
  els.cadEditorCenterX.value = component?.centerX ?? '';
  els.cadEditorCenterY.value = component?.centerY ?? '';
  els.cadEditorAngle.value = component?.angle ?? '';
}
function createLandEditorInput(land, property, type = 'text', step = '') {
  const input = document.createElement('input');
  input.type = type; if (step) input.step = step;
  input.value = land[property] ?? '';
  input.addEventListener('click', (event) => event.stopPropagation());
  input.addEventListener('change', () => {
    const component = cadEditorComponent();
    const historyTransaction = beginCadEditorHistory(`แก้ ${property} ของ Land ${land.cadName || land.globalId}`, { componentUids: component ? [component] : [] });
    if (type === 'number') {
      const value = String(input.value).trim() === '' ? null : Number(input.value);
      if (value != null && !Number.isFinite(value)) { input.value = land[property] ?? ''; return toast('ค่าตัวเลขไม่ถูกต้อง'); }
      land[property] = value;
    } else land[property] = input.value;
    markCadEditorChanged(`แก้ ${property} ของ Land แล้ว`);
    invalidateCadEditorBounds(component);
    renderCadEditorSummary();
    commitCadEditorHistory(historyTransaction, { componentUids: component ? [component] : [] });
  });
  return input;
}
function createLandSideSelect(land) {
  const select = document.createElement('select');
  const values = ['Top', 'Bottom'];
  const current = String(land.side || '');
  const normalized = normalizeSide(current);
  const selectedValue = normalized === 'top' ? 'Top' : normalized === 'bottom' ? 'Bottom' : current;
  if (selectedValue && !values.includes(selectedValue)) values.push(selectedValue);
  if (!selectedValue) values.push('');
  for (const value of values) { const option = document.createElement('option'); option.value = value; option.textContent = value || 'ไม่ระบุ'; select.append(option); }
  select.value = selectedValue;
  select.addEventListener('click', (event) => event.stopPropagation());
  select.addEventListener('change', () => {
    const component = cadEditorComponent();
    const historyTransaction = beginCadEditorHistory(`เปลี่ยนด้าน Land ${land.cadName || land.globalId}`, { componentUids: component ? [component] : [] });
    land.side = select.value;
    markCadEditorChanged('เปลี่ยนด้าน Land แล้ว');
    renderCadEditorSummary();
    commitCadEditorHistory(historyTransaction, { componentUids: component ? [component] : [] });
  });
  return select;
}
function filteredCadEditorLands(component) {
  const search = state.cadEditor.landSearch.trim().toLowerCase();
  const side = state.cadEditor.sideFilter;
  return (component?.lands || []).filter((land) => {
    if (side !== 'all' && normalizeSide(land.side) !== side) return false;
    return !search || [land.localIndex, land.globalId, land.cadName, land.side, land.left, land.top, land.width, land.length].some((value) => String(value ?? '').toLowerCase().includes(search));
  });
}
function renderCadEditorLands() {
  const component = cadEditorComponent();
  const matches = filteredCadEditorLands(component);
  const lands = matches.slice(0, CAD_EDITOR_RENDER_LIMIT);
  const selected = matches.find((land) => land.uid === state.cadEditor.selectedLandUid);
  if (selected && !lands.includes(selected)) lands.unshift(selected);
  const limited = matches.length > lands.length;
  els.cadEditorLandLabel.textContent = component ? `${component.name || `ID ${component.id}`} · ${limited ? 'แสดง ' : ''}${formatInt.format(lands.length)} / ${formatInt.format(matches.length)} ที่ตรงตัวกรอง · ทั้งหมด ${formatInt.format(component.lands.length)} lands` : 'เลือก Component';
  els.cadEditorLandTableBody.innerHTML = '';
  for (const land of lands) {
    const row = document.createElement('tr');
    if (cadEditorLandSelectionSet().has(land.uid)) row.classList.add('active');
    const local = document.createElement('td'); local.textContent = land.localIndex ?? component.lands.indexOf(land) + 1;
    const id = document.createElement('td'); id.append(createLandEditorInput(land, 'globalId', 'number', '1'));
    const name = document.createElement('td'); name.append(createLandEditorInput(land, 'cadName'));
    const side = document.createElement('td'); side.append(createLandSideSelect(land));
    const left = document.createElement('td'); left.append(createLandEditorInput(land, 'left', 'number', 'any'));
    const top = document.createElement('td'); top.append(createLandEditorInput(land, 'top', 'number', 'any'));
    const width = document.createElement('td'); width.append(createLandEditorInput(land, 'width', 'number', 'any'));
    const length = document.createElement('td'); length.append(createLandEditorInput(land, 'length', 'number', 'any'));
    row.append(local, id, name, side, left, top, width, length);
    row.addEventListener('click', (event) => { setCadEditorLandSelection([land], { additive: event.shiftKey, toggle: event.ctrlKey || event.metaKey, primary: land }); renderCadEditorLands(); });
    els.cadEditorLandTableBody.append(row);
  }
  if (!lands.length) {
    const row = document.createElement('tr'); const cell = document.createElement('td'); cell.colSpan = 8; cell.className = 'empty-state'; cell.textContent = component ? 'ไม่พบ Land ตามตัวกรอง' : 'เลือก Component จากรายการด้านซ้าย'; row.append(cell); els.cadEditorLandTableBody.append(row);
  } else if (limited) {
    const row = document.createElement('tr'); const cell = document.createElement('td'); cell.colSpan = 8; cell.className = 'empty-state cad-editor-limit-hint'; cell.textContent = `แสดงครั้งละ ${formatInt.format(CAD_EDITOR_RENDER_LIMIT)} Land เพื่อรองรับ BGA/LGA ขนาดใหญ่ · ค้นหาด้วยชื่อ Land หรือ XML ID`; row.append(cell); els.cadEditorLandTableBody.append(row);
  }
  const selectedCount = cadEditorSelectedLands().length;
  els.cadEditorDuplicateLandButton.disabled = selectedCount === 0;
  if (els.cadEditorCutLandButton) els.cadEditorCutLandButton.disabled = selectedCount !== 1;
  if (els.cadEditorMergeLandButton) els.cadEditorMergeLandButton.disabled = selectedCount < 2;
  if (els.cadEditorSplitLandButton) els.cadEditorSplitLandButton.disabled = selectedCount === 0 || selectedCount >= (component?.lands?.length || 0);
  els.cadEditorDeleteLandButton.disabled = selectedCount === 0;
}
function renderCadEditor() {
  renderCadEditorSummary();
  renderCadEditorComponentForm();
  renderCadEditorVisualProperties();
  updateCadEditorHistoryControls();
  updateCadEditorMenuState();
  drawCadEditorCanvas();
}
function openCadEditor() {
  const file = cadEditorFile();
  if (!file) return toast('กรุณาเปิด CAD XML, ZIP หรือ TGZ ก่อน');
  if (!file.editorModel) {
    const activeText = file.editedText || file.text;
    const source = file.renames?.size ? rewriteCadXml(activeText, file.renames) : activeText;
    file.editorModel = createCadEditorModel(source);
  }
  if (!file.appliedEditorSnapshot) {
    file.appliedEditorSnapshot = cloneCadEditorModel(file.editorModel);
    file.appliedEditorSnapshot.changed = false;
  }
  state.cadEditor.model = file.editorModel;
  if (state.cadEditor.history?.modelRef !== state.cadEditor.model) resetCadEditorHistory(state.cadEditor.model);
  else updateCadEditorHistoryControls();
  state.cadEditor.selectedComponentUid = null;
  state.cadEditor.selectedComponentUids = new Set();
  state.cadEditor.selectedLandUid = null;
  state.cadEditor.selectedLandUids = new Set();
  state.cadEditor.visual.interaction = null;
  invalidateCadEditorBounds();
  els.cadEditorComponentSearch.value = '';
  els.cadEditorLandSearch.value = '';
  els.cadEditorSideFilter.value = 'all';
  els.cadEditorVisualSearch.value = state.cadEditor.visual.search || '';
  els.cadEditorVisualSideFilter.value = state.cadEditor.visual.side || 'all';
  els.cadEditorLabelToggle.checked = state.cadEditor.visual.labels !== false;
  els.cadEditorGridToggle.checked = state.cadEditor.visual.grid !== false;
  closeCadEditorConfirm({ animate: false });
  setCadEditorBusy(false);
  els.cadEditorOverlay.classList.remove('hidden');
  document.body.classList.add('cad-editor-open');
  renderCadEditor();
  // Wait for the full-screen grid and canvas wrapper to finish stretching before fitting.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    fitCadEditorView();
    els.cadEditorCanvas.focus();
  }));
}
async function refreshMainViewAfterCadEditor(file) {
  if (!file || state.activeCadRole !== file.role) return false;
  const needsMappingRebuild = Boolean(file.mappingDirty);
  const needsRefresh = Boolean(file.viewerDirty || file.mappingDirty || state.cadEditor.viewerRefreshPending);
  if (!needsRefresh) return true;
  setLoading(true, needsMappingRebuild ? 'กำลังสร้าง Mapping ใหม่จาก CAD ที่แก้ไข…' : 'กำลังรีเฟรช Viewer และ Mapping…');
  await nextFrame();
  try {
    if (needsMappingRebuild) rebuildMappingForActiveCad();
    else syncMappingRowsFromActiveCad();
    populateComponents(BOARD_VIEW);
    updateStats();
    renderTable();
    renderTeachPanel();
    refreshDuplicateControls();
    clearDetails();
    fitView();
    renderHistogram();
    renderDetailedHistogram();
    file.mappingDirty = false;
    file.viewerDirty = false;
    state.cadEditor.viewerRefreshPending = false;
    toast(needsMappingRebuild ? 'สร้าง Mapping ใหม่จาก CAD ที่แก้ไขแล้ว' : 'Viewer และ Mapping อัปเดตแล้ว', 3600);
    return true;
  } catch (error) {
    console.error(error);
    file.mappingDirty = needsMappingRebuild;
    file.viewerDirty = true;
    state.cadEditor.viewerRefreshPending = true;
    toast(`รีเฟรชข้อมูลหลังปิด Editor ไม่สำเร็จ: ${error?.message || error}`, 6500);
    return false;
  } finally {
    setLoading(false);
  }
}
function finalizeCloseCadEditor() {
  closeCadEditorConfirm({ animate: false });
  closeCadEditorMenus();
  hideCadEditorContextMenu();
  state.cadEditor.visual.interaction = null;
  state.cadEditor.visual.spaceDown = false;
  els.cadEditorCanvas.classList.remove('panning', 'moving-selection', 'pan-tool');
  els.cadEditorOverlay.classList.add('hidden');
  document.body.classList.remove('cad-editor-open');
  setCadEditorBusy(false);
  const file = cadEditorFile();
  requestAnimationFrame(() => window.setTimeout(() => refreshMainViewAfterCadEditor(file), 0));
  return true;
}
function closeCadEditor(options = {}) {
  const pendingAction = typeof options.pendingAction === 'function' ? options.pendingAction : null;
  if (state.cadEditor.busy) {
    state.cadEditor.pendingCloseAfterTask = true;
    if (pendingAction) state.cadEditor.pendingActionAfterClose = pendingAction;
    cancelCadEditorTask({ closeAfter: true });
    toast('กำลังยกเลิกงาน แล้วจะเปิดหน้าต่างยืนยันการปิด Editor', 3600);
    return false;
  }
  if (!options.force && state.cadEditor.model?.changed) {
    showCadEditorConfirm('discard', { pendingAction });
    return false;
  }
  finalizeCloseCadEditor();
  const deferredAction = pendingAction || state.cadEditor.pendingActionAfterClose;
  state.cadEditor.pendingActionAfterClose = null;
  if (deferredAction) window.setTimeout(deferredAction, 0);
  return true;
}
function saveCadEditorComponent() {
  const component = cadEditorComponent(); if (!component || cadEditorSelectedComponents().length !== 1) return;
  const historyTransaction = beginCadEditorHistory(`แก้ข้อมูล Component ${component.name || component.id}`, { componentUids: [component] });
  const oldBounds = cadEditorBounds(component);
  const oldX = Number.isFinite(Number(component.centerX)) ? Number(component.centerX) : oldBounds.centerX;
  const oldY = Number.isFinite(Number(component.centerY)) ? Number(component.centerY) : oldBounds.centerY;
  const nextX = numberFromEditorInput(els.cadEditorCenterX, oldX);
  const nextY = numberFromEditorInput(els.cadEditorCenterY, oldY);
  component.name = els.cadEditorComponentName.value.trim();
  component.packageName = els.cadEditorPackageName.value.trim();
  component.revision = els.cadEditorRevision.value.trim();
  moveComponent(component, nextX - oldX, nextY - oldY);
  component.centerX = nextX; component.centerY = nextY;
  component.angle = numberFromEditorInput(els.cadEditorAngle, null);
  invalidateCadEditorBounds(component);
  markCadEditorChanged('บันทึกข้อมูล Component และตำแหน่งแล้ว');
  renderCadEditor();
  commitCadEditorHistory(historyTransaction, { componentUids: [component] });
  toast('บันทึกข้อมูล Component และตำแหน่งแล้ว');
}
function saveCadEditorLand() {
  const component = cadEditorComponent(); const land = cadEditorLand(); if (!component || !land) return;
  const historyTransaction = beginCadEditorHistory(`แก้ Land ${land.cadName || land.globalId}`, { componentUids: [component] });
  const id = numberFromEditorInput(els.cadEditorLandId, land.globalId);
  if (!Number.isFinite(id)) return toast('XML Land ID ไม่ถูกต้อง');
  for (const current of state.cadEditor.model.components || []) for (const item of current.lands || []) if (item !== land && Number(item.globalId) === id) return toast(`XML Land ID ${id} มีอยู่แล้ว`);
  land.globalId = id;
  land.cadName = els.cadEditorLandName.value.trim();
  land.side = els.cadEditorLandSide.value;
  land.left = numberFromEditorInput(els.cadEditorLandLeft, land.left);
  land.top = numberFromEditorInput(els.cadEditorLandTop, land.top);
  land.width = numberFromEditorInput(els.cadEditorLandWidth, land.width);
  land.length = numberFromEditorInput(els.cadEditorLandLength, land.length);
  invalidateCadEditorBounds(component);
  markCadEditorChanged('บันทึก Land แล้ว');
  renderCadEditor();
  commitCadEditorHistory(historyTransaction, { componentUids: [component] });
  toast('บันทึก Land แล้ว');
}
function addCadEditorComponent() {
  if (!cadEditorSelectedComponents().length) return toast('เลือก Component ต้นแบบบนบอร์ดก่อน แล้วกดทำสำเนา');
  try { duplicateSelectedCadEditorComponents(); }
  catch (error) { toast(error.message, 5000); }
}
function addCadEditorLand() {
  const component = cadEditorComponent();
  if (!component || cadEditorSelectedComponents().length !== 1) return toast('เลือก Component เพียง 1 ชิ้นก่อนเพิ่ม Land');
  try {
    const historyTransaction = beginCadEditorHistory(`เพิ่ม Land ใน ${component.name || component.id}`, { componentUids: [component] });
    const center = cadEditorScreenToWorld(els.cadEditorCanvas.clientWidth / 2, els.cadEditorCanvas.clientHeight / 2);
    const step = Math.max(.1, Number(els.cadEditorNudgeStep?.value) || .1);
    const land = addLand(state.cadEditor.model, component, { left: cadEditorSnapValue(center.x - step * 2), top: cadEditorSnapValue(center.y + step * 2), width: step * 4, length: step * 4 });
    state.cadEditor.selectedLandUid = land.uid;
    state.cadEditor.selectedLandUids = new Set([land.uid]);
    state.cadEditor.visual.mode = 'land';
    invalidateCadEditorBounds(component);
    markCadEditorChanged('เพิ่ม Land กลางมุมมองแล้ว · ลากเพื่อย้ายและลากจุดจับเพื่อปรับขนาด');
    renderCadEditor();
    commitCadEditorHistory(historyTransaction, { componentUids: [component] });
  } catch (error) { toast(error.message, 5000); }
}
function duplicateCadEditorLand() {
  const component = cadEditorComponent();
  const selected = cadEditorSelectedLands();
  try {
    if (!component || !selected.length) return false;
    const historyTransaction = beginCadEditorHistory(`ทำสำเนา ${selected.length} Land`, { componentUids: [component] });
    const copies = selected.map((land) => duplicateLand(state.cadEditor.model, component, land));
    setCadEditorLandSelection(copies, { primary: copies[0] || null });
    invalidateCadEditorBounds(component);
    markCadEditorChanged(`ทำสำเนา ${formatInt.format(copies.length)} Land แล้ว · ลากไปยังตำแหน่งใหม่ได้ทันที`);
    renderCadEditor();
    commitCadEditorHistory(historyTransaction, { componentUids: [component] });
    return true;
  } catch (error) { toast(error.message, 5000); return false; }
}
async function removeCadEditorLand() {
  const component = cadEditorComponent();
  const selected = cadEditorSelectedLands();
  if (!component || !selected.length) return false;
  if (selected.length >= component.lands.length) {
    toast('ไม่สามารถลบ Land ทั้งหมดด้วยคำสั่งนี้ · หากต้องการลบทั้งชิ้นให้เปลี่ยนเป็นโหมด Component');
    return false;
  }
  if (selected.length > 20 && !(await requestAppConfirm({ title: 'ลบ Land จำนวนมาก?', message: `ลบ Land ${selected.length} จุดจาก ${component.name || component.id}`, detail: 'รายการนี้ Undo ได้ก่อน Apply', confirmText: 'Yes - ลบ Land', destructive: true }))) return false;
  const historyTransaction = beginCadEditorHistory(`ลบ ${selected.length} Land`, { componentUids: [component] });
  for (const land of [...selected]) deleteLand(state.cadEditor.model, component, land);
  clearCadEditorLandSelection();
  invalidateCadEditorBounds(component);
  markCadEditorChanged(`ลบ ${formatInt.format(selected.length)} Land แล้ว`);
  renderCadEditor();
  commitCadEditorHistory(historyTransaction, { componentUids: [component] });
  return true;
}
function nextCadEditorSplitName(component) {
  const base = `${component?.name || `PART_${component?.id || ''}`}_SPLIT`;
  const names = new Set((state.cadEditor.model?.components || []).map((item) => String(item.name || '').toUpperCase()));
  let index = 1;
  let name = `${base}${index}`;
  while (names.has(name.toUpperCase())) { index += 1; name = `${base}${index}`; }
  return name;
}
function cutSelectedCadEditorLand() {
  const component = cadEditorComponent();
  const selected = cadEditorSelectedLands();
  if (!component || selected.length !== 1) { toast('เลือก Land 1 จุดเพื่อ Cut ½'); return false; }
  const historyTransaction = beginCadEditorHistory('ตัด Land ครึ่งหนึ่ง', { componentUids: [component] });
  try {
    const pieces = splitLandRectangle(state.cadEditor.model, component, selected[0], { axis: 'auto', ratio: 0.5 });
    setCadEditorLandSelection(pieces, { primary: pieces[0] });
    invalidateCadEditorBounds(component);
    markCadEditorChanged(`Cut Land เป็น ${pieces.length} ส่วนแล้ว`);
    renderCadEditor();
    commitCadEditorHistory(historyTransaction, { componentUids: [component] });
    return true;
  } catch (error) { toast(`Cut Land ไม่สำเร็จ: ${error.message}`, 5500); return false; }
}
function mergeSelectedCadEditorLands() {
  const component = cadEditorComponent();
  const selected = cadEditorSelectedLands();
  if (!component || selected.length < 2) { toast('เลือก Land ที่ติดกันอย่างน้อย 2 จุดเพื่อ Merge'); return false; }
  const historyTransaction = beginCadEditorHistory(`รวม ${selected.length} Land`, { componentUids: [component] });
  try {
    const merged = mergeLandRectangles(state.cadEditor.model, component, selected);
    setCadEditorLandSelection([merged], { primary: merged });
    invalidateCadEditorBounds(component);
    markCadEditorChanged(`Merge ${selected.length} Land แล้ว`);
    renderCadEditor();
    commitCadEditorHistory(historyTransaction, { componentUids: [component] });
    return true;
  } catch (error) { toast(`Merge Land ไม่สำเร็จ: ${error.message}`, 5500); return false; }
}

function splitSelectedCadEditorLands() {
  const component = cadEditorComponent();
  const selected = cadEditorSelectedLands();
  if (!component || !selected.length) return false;
  if (selected.length >= component.lands.length) {
    toast('ต้องเหลือ Land อย่างน้อย 1 จุดใน Component เดิม');
    return false;
  }
  const historyTransaction = beginCadEditorHistory(`แยก ${selected.length} Land เป็น Component ใหม่`, { componentUids: [component], structure: true });
  try {
    const split = splitComponentLands(state.cadEditor.model, component, new Set(selected.map((land) => land.uid)), { name: nextCadEditorSplitName(component) });
    invalidateCadEditorBounds();
    setCadEditorSelection([split], { primary: split });
    state.cadEditor.visual.mode = 'land';
    setCadEditorLandSelection(split.lands, { primary: split.lands[0] || null });
    markCadEditorChanged(`แยก ${formatInt.format(split.lands.length)} Land เป็น ${split.name} แล้ว`);
    renderCadEditor();
    commitCadEditorHistory(historyTransaction, { componentUids: [component, split] });
    toast(`แบ่ง Component สำเร็จ · ${split.name} มี ${formatInt.format(split.lands.length)} Land`);
    return true;
  } catch (error) {
    toast(`แบ่ง Component ไม่สำเร็จ: ${error.message}`, 5500);
    return false;
  }
}
async function removeCadEditorComponent() {
  const selected = cadEditorSelectedComponents(); if (!selected.length) return false;
  const lands = selected.reduce((sum, component) => sum + (component.lands?.length || 0), 0);
  if (selected.length > 10 && !(await requestAppConfirm({ title: 'ลบ Component จำนวนมาก?', message: `ลบ ${selected.length} Component และ Land ${lands} จุด`, detail: 'รายการนี้ Undo ได้ก่อน Apply', confirmText: 'Yes - ลบ Component', destructive: true }))) return false;
  const historyTransaction = beginCadEditorHistory(`ลบ ${selected.length} Component`, { componentUids: selected, structure: true });
  for (const component of [...selected]) deleteComponent(state.cadEditor.model, component);
  state.cadEditor.selectedComponentUids.clear(); state.cadEditor.selectedComponentUid = null; clearCadEditorLandSelection();
  invalidateCadEditorBounds();
  markCadEditorChanged(`ลบ ${formatInt.format(selected.length)} Component แล้ว`);
  renderCadEditor();
  commitCadEditorHistory(historyTransaction, { componentUids: selected });
  return true;
}
function renumberCadEditorComponent() {
  const selected = cadEditorSelectedComponents(); if (!selected.length) return false;
  const historyTransaction = beginCadEditorHistory(`เริ่มชื่อ A1 ใน ${selected.length} Component`, { componentUids: selected });
  let count = 0; for (const component of selected) count += renumberComponentA1(component, { mode: 'single-row' });
  markCadEditorChanged(`สร้างชื่อ Land ใหม่ ${formatInt.format(count)} จุด โดยเริ่ม A1 ใน ${formatInt.format(selected.length)} Component`); renderCadEditor();
  commitCadEditorHistory(historyTransaction, { componentUids: selected });
  return true;
}
async function renumberCadEditorAll() {
  if (!(await requestAppConfirm({ title: 'Renumber Land ทุก Component?', message: 'สร้างชื่อ A1, A2, A3… ใหม่โดยเริ่ม A1 แยกในแต่ละ Component', detail: 'การเปลี่ยนแปลงอยู่ใน Working Model และ Undo ได้ก่อน Apply', confirmText: 'Yes - Renumber' }))) return false;
  const historyTransaction = beginCadEditorHistory('เริ่มชื่อ A1 ใหม่ทุก Component', { all: true });
  const count = renumberAllComponentsA1(state.cadEditor.model, { mode: 'single-row' }); markCadEditorChanged(`สร้างชื่อใหม่ ${formatInt.format(count)} Land โดยเริ่ม A1 ทุก Component`); renderCadEditor();
  commitCadEditorHistory(historyTransaction);
  return true;
}
function moveSelectedCadEditorComponents(dx, dy, { toastMessage = true, recordHistory = true, mergeKey = '' } = {}) {
  const selected = cadEditorSelectedComponents();
  const x = Number(dx), y = Number(dy);
  if (!selected.length || !Number.isFinite(x) || !Number.isFinite(y) || (!x && !y)) return false;
  const historyTransaction = recordHistory ? beginCadEditorHistory(`ย้าย ${selected.length} Component`, { componentUids: selected, mergeKey }) : null;
  for (const component of selected) { moveComponent(component, x, y); invalidateCadEditorBounds(component); }
  markCadEditorChanged(`ย้าย ${formatInt.format(selected.length)} Component · X ${formatFloat.format(x)} · Y ${formatFloat.format(y)}`);
  renderCadEditor();
  if (recordHistory) commitCadEditorHistory(historyTransaction, { componentUids: selected });
  if (toastMessage) toast(`ย้าย ${formatInt.format(selected.length)} Component · X ${formatFloat.format(x)} · Y ${formatFloat.format(y)}`);
  return true;
}
function selectAllVisibleCadEditorComponents() {
  const visible = visibleCadEditorComponents(); setCadEditorSelection(visible, { primary: visible[0] || null });
}
function setCadEditorTool(tool) {
  state.cadEditor.visual.tool = tool === 'pan' ? 'pan' : 'select'; renderCadEditorVisualProperties();
}
function setCadEditorMode(mode) {
  state.cadEditor.visual.mode = mode === 'land' ? 'land' : 'component';
  if (state.cadEditor.visual.mode === 'land' && cadEditorSelectedComponents().length !== 1) clearCadEditorLandSelection();
  renderCadEditorVisualProperties(); drawCadEditorCanvas();
}
function cadEditorPointerDown(event) {
  if (!state.cadEditor.model || (event.button !== 0 && event.button !== 1)) return;
  event.preventDefault();
  hideCadEditorContextMenu();
  els.cadEditorCanvas.focus();
  els.cadEditorCanvas.setPointerCapture?.(event.pointerId);
  const point = cadEditorCanvasPoint(event);
  const visual = state.cadEditor.visual;
  const pan = visual.tool === 'pan' || visual.spaceDown || event.button === 1;
  if (pan) {
    visual.interaction = { kind: 'pan', pointerId: event.pointerId, start: point, last: point };
    els.cadEditorCanvas.classList.add('panning');
    return;
  }

  if (visual.mode === 'land') {
    const selectedLands = cadEditorSelectedLands();
    const handle = selectedLands.length === 1 ? hitCadEditorLandHandle(point.x, point.y) : null;
    const selectedLand = cadEditorLand();
    if (handle && selectedLand) {
      visual.interaction = {
        kind: 'resize-land', pointerId: event.pointerId, start: point, handle, moved: false,
        historyTransaction: beginCadEditorHistory(`ปรับขนาด Land ${selectedLand.cadName || selectedLand.globalId}`, { componentUids: [cadEditorComponent()].filter(Boolean) }),
        snapshot: {
          land: selectedLand,
          component: cadEditorComponent(),
          rect: cadEditorLandRect(selectedLand),
          left: selectedLand.left, top: selectedLand.top, width: selectedLand.width, length: selectedLand.length,
          centerX: selectedLand.centerX, centerY: selectedLand.centerY,
        },
      };
      setCadEditorResizeCursor(handle);
      return;
    }
    const target = hitCadEditorLandTarget(point.x, point.y);
    const toggle = event.ctrlKey || event.metaKey;
    const additive = event.shiftKey;
    if (!target) {
      visual.interaction = { kind: 'land-marquee', pointerId: event.pointerId, start: point, current: point, component: cadEditorComponent(), additive, toggle };
      drawCadEditorCanvas();
      return;
    }
    if (state.cadEditor.selectedComponentUid !== target.component.uid || cadEditorSelectionSet().size !== 1) {
      setCadEditorSelection([target.component], { primary: target.component });
      visual.mode = 'land';
    }
    const selection = cadEditorLandSelectionSet();
    const collapseOnClick = !toggle && !additive && selection.has(target.land.uid) && selection.size > 1;
    if (toggle) setCadEditorLandSelection([target.land], { toggle: true, primary: target.land });
    else if (additive) setCadEditorLandSelection([target.land], { additive: true, primary: target.land });
    else if (!selection.has(target.land.uid)) setCadEditorLandSelection([target.land], { primary: target.land });
    else state.cadEditor.selectedLandUid = target.land.uid;
    if (!cadEditorLandSelectionSet().has(target.land.uid) || toggle) return;
    const lands = cadEditorSelectedLands();
    const world = cadEditorScreenToWorld(point.x, point.y);
    visual.interaction = {
      kind: 'move-lands', pointerId: event.pointerId, start: point, startWorld: world, moved: false, collapseOnClick, hit: target.land,
      historyTransaction: beginCadEditorHistory(`ย้าย ${lands.length} Land`, { componentUids: [target.component] }),
      snapshot: lands.map((land) => ({
        land, component: target.component,
        left: land.left, top: land.top, centerX: land.centerX, centerY: land.centerY,
      })),
    };
    renderCadEditorVisualProperties();
    drawCadEditorCanvas();
    return;
  }

  const hit = hitCadEditorComponent(point.x, point.y);
  const toggle = event.ctrlKey || event.metaKey;
  const additive = event.shiftKey;
  if (hit) {
    const set = cadEditorSelectionSet();
    const collapseOnClick = !toggle && !additive && set.has(hit.uid) && set.size > 1;
    if (toggle) setCadEditorSelection([hit], { toggle: true, primary: hit });
    else if (additive) setCadEditorSelection([hit], { additive: true, primary: hit });
    else if (!set.has(hit.uid)) setCadEditorSelection([hit], { primary: hit });
    else setCadEditorPrimaryComponent(hit);
    if (!cadEditorSelectionSet().has(hit.uid) || toggle) return;
    const selected = cadEditorSelectedComponents();
    visual.interaction = {
      kind: 'move-components', pointerId: event.pointerId, start: point,
      startWorld: cadEditorScreenToWorld(point.x, point.y), moved: false, collapseOnClick, hit,
      historyTransaction: beginCadEditorHistory(`ย้าย ${selected.length} Component`, { componentUids: selected }),
      snapshot: captureCadEditorComponentPositions(selected),
    };
    els.cadEditorCanvas.classList.add('moving-selection');
    renderCadEditorVisualProperties();
    drawCadEditorCanvas();
    return;
  }
  visual.interaction = { kind: 'marquee', pointerId: event.pointerId, start: point, current: point, additive, toggle };
  drawCadEditorCanvas();
}
function cadEditorPointerMove(event) {
  const point = cadEditorCanvasPoint(event);
  const worldPoint = cadEditorScreenToWorld(point.x, point.y);
  if (els.cadEditorCursorX) els.cadEditorCursorX.textContent = formatFloat.format(worldPoint.x);
  if (els.cadEditorCursorY) els.cadEditorCursorY.textContent = formatFloat.format(worldPoint.y);

  const interaction = state.cadEditor.visual.interaction;
  if (!interaction || interaction.pointerId !== event.pointerId) {
    const handle = state.cadEditor.visual.mode === 'land' && cadEditorSelectedLands().length === 1 ? hitCadEditorLandHandle(point.x, point.y) : null;
    state.cadEditor.visual.hoverHandle = handle;
    setCadEditorResizeCursor(handle);
    return;
  }
  if (interaction.kind === 'pan') {
    state.cadEditor.visual.offsetX += point.x - interaction.last.x;
    state.cadEditor.visual.offsetY += point.y - interaction.last.y;
    interaction.last = point;
    drawCadEditorCanvas();
    return;
  }
  if (interaction.kind === 'marquee' || interaction.kind === 'land-marquee') {
    interaction.current = point;
    drawCadEditorCanvas();
    return;
  }
  const distance = Math.hypot(point.x - interaction.start.x, point.y - interaction.start.y);
  if (distance < 3 && !interaction.moved) return;
  interaction.moved = true;

  if (interaction.kind === 'move-components') {
    restoreCadEditorComponentPositions(interaction.snapshot);
    const dx = cadEditorSnapValue(worldPoint.x - interaction.startWorld.x);
    const dy = cadEditorSnapValue(worldPoint.y - interaction.startWorld.y);
    for (const item of interaction.snapshot) {
      moveComponent(item.component, dx, dy);
      invalidateCadEditorBounds(item.component);
    }
  } else if (interaction.kind === 'move-lands') {
    const dx = cadEditorSnapValue(worldPoint.x - interaction.startWorld.x);
    const dy = cadEditorSnapValue(worldPoint.y - interaction.startWorld.y);
    for (const item of interaction.snapshot) {
      item.land.left = item.left; item.land.top = item.top;
      if ('centerX' in item.land) item.land.centerX = item.centerX;
      if ('centerY' in item.land) item.land.centerY = item.centerY;
      moveLand(item.land, dx, dy);
      invalidateCadEditorBounds(item.component);
    }
  } else if (interaction.kind === 'resize-land') {
    resizeCadEditorLandFromSnapshot(interaction.snapshot, interaction.handle, worldPoint);
  }
  drawCadEditorCanvas();
}
function cadEditorPointerUp(event) {
  const visual = state.cadEditor.visual;
  const interaction = visual.interaction;
  if (!interaction || interaction.pointerId !== event.pointerId) return;
  const point = cadEditorCanvasPoint(event);
  visual.interaction = null;
  els.cadEditorCanvas.classList.remove('panning', 'moving-selection');
  setCadEditorResizeCursor(null);

  if (interaction.kind === 'marquee') {
    const moved = Math.hypot(point.x - interaction.start.x, point.y - interaction.start.y) >= 4;
    if (moved) {
      const components = componentsInsideCadEditorMarquee(interaction.start, point);
      setCadEditorSelection(components, { additive: interaction.additive, toggle: interaction.toggle, primary: components.at(-1) || null });
    } else if (!interaction.additive && !interaction.toggle) clearCadEditorSelection();
    return;
  }
  if (interaction.kind === 'land-marquee') {
    const moved = Math.hypot(point.x - interaction.start.x, point.y - interaction.start.y) >= 4;
    if (moved) {
      const lands = landsInsideCadEditorMarquee(interaction.component, interaction.start, point);
      setCadEditorLandSelection(lands, { additive: interaction.additive, toggle: interaction.toggle, primary: lands.at(-1) || null });
      els.cadEditorMessage.textContent = lands.length ? `เลือก Land จากกรอบ ${formatInt.format(lands.length)} จุด` : 'ไม่พบ Land ในกรอบที่ลาก';
    } else if (!interaction.additive && !interaction.toggle) {
      clearCadEditorLandSelection();
      renderCadEditorVisualProperties();
      drawCadEditorCanvas();
    }
    return;
  }
  if (interaction.kind === 'move-components' && !interaction.moved && interaction.collapseOnClick) {
    setCadEditorSelection([interaction.hit], { primary: interaction.hit });
    return;
  }
  if (interaction.kind === 'move-lands' && !interaction.moved && interaction.collapseOnClick) {
    setCadEditorLandSelection([interaction.hit], { primary: interaction.hit });
    return;
  }
  if (['move-components', 'move-lands', 'resize-land'].includes(interaction.kind) && interaction.moved) {
    const message = interaction.kind === 'move-components'
      ? `ย้าย ${formatInt.format(cadEditorSelectedComponents().length)} Component แล้ว`
      : interaction.kind === 'resize-land' ? 'ปรับขนาด Land แล้ว' : `ย้าย ${formatInt.format(cadEditorSelectedLands().length)} Land แล้ว`;
    markCadEditorChanged(message);
    renderCadEditorComponentForm();
    renderCadEditorVisualProperties();
    renderCadEditorSummary();
    drawCadEditorCanvas();
    const affected = interaction.kind === 'move-components'
      ? interaction.snapshot.map((item) => item.component)
      : [interaction.snapshot?.component || interaction.snapshot?.[0]?.component].filter(Boolean);
    commitCadEditorHistory(interaction.historyTransaction, { componentUids: affected });
  } else drawCadEditorCanvas();
}
function cadEditorPointerCancel(event) {
  const interaction = state.cadEditor.visual.interaction;
  if (!interaction || interaction.pointerId !== event.pointerId) return;
  if (interaction.kind === 'move-components') restoreCadEditorComponentPositions(interaction.snapshot);
  if (interaction.kind === 'move-lands') {
    for (const item of interaction.snapshot || []) {
      item.land.left = item.left; item.land.top = item.top;
      if ('centerX' in item.land) item.land.centerX = item.centerX;
      if ('centerY' in item.land) item.land.centerY = item.centerY;
      invalidateCadEditorBounds(item.component);
    }
  }
  if (interaction.kind === 'resize-land') {
    const item = interaction.snapshot;
    item.land.left = item.left; item.land.top = item.top;
    item.land.width = item.width; item.land.length = item.length;
    if ('centerX' in item.land) item.land.centerX = item.centerX;
    if ('centerY' in item.land) item.land.centerY = item.centerY;
    invalidateCadEditorBounds(item.component);
  }
  state.cadEditor.visual.interaction = null;
  els.cadEditorCanvas.classList.remove('panning', 'moving-selection');
  setCadEditorResizeCursor(null);
  renderCadEditor();
}

function nudgeCadEditorSelection(dx, dy) {
  const landMode = state.cadEditor.visual.mode === 'land';
  const lands = landMode ? cadEditorSelectedLands() : [];
  if (landMode && !lands.length) return false;
  if (lands.length) {
    const component = cadEditorComponent();
    const mergeKey = `nudge-lands:${component?.uid || ''}:${lands.map((land) => land.uid).sort().join('|')}`;
    const historyTransaction = beginCadEditorHistory(`ขยับ ${lands.length} Land`, { componentUids: component ? [component] : [], mergeKey });
    for (const land of lands) moveLand(land, dx, dy);
    invalidateCadEditorBounds(component);
    markCadEditorChanged(`ขยับ ${formatInt.format(lands.length)} Land · X ${formatFloat.format(dx)} · Y ${formatFloat.format(dy)}`);
    renderCadEditor();
    commitCadEditorHistory(historyTransaction, { componentUids: component ? [component] : [] });
    return true;
  }
  const mergeKey = `nudge-components:${[...cadEditorSelectionSet()].sort().join('|')}`;
  return moveSelectedCadEditorComponents(dx, dy, { toastMessage: false, mergeKey });
}
function handleCadEditorKeyboard(event) {
  if (els.cadEditorOverlay.classList.contains('hidden')) return false;
  if (cadEditorConfirmVisible()) {
    const key = String(event.key || '').toLowerCase();
    if (key === 'escape' || key === 'n') { event.preventDefault(); closeCadEditorConfirm(); return true; }
    if (key === 'enter' || key === 'y') { event.preventDefault(); confirmCadEditorChoice(); return true; }
    event.preventDefault();
    return true;
  }
  if (state.cadEditor.busy) { event.preventDefault(); return true; }
  if (event.key === 'Escape' && document.querySelectorAll('[data-cad-menu-panel]:not(.hidden)').length) {
    event.preventDefault();
    closeCadEditorMenus();
    return true;
  }
  if (event.key === 'Escape' && els.cadEditorContextMenu && !els.cadEditorContextMenu.classList.contains('hidden')) {
    event.preventDefault();
    hideCadEditorContextMenu();
    return true;
  }
  const tag = document.activeElement?.tagName;
  const editingField = ['INPUT', 'SELECT', 'TEXTAREA'].includes(tag);
  const key = event.key.toLowerCase();
  if (event.code === 'Space' && !editingField) {
    event.preventDefault();
    state.cadEditor.visual.spaceDown = true;
    els.cadEditorCanvas.classList.add('pan-tool');
    return true;
  }
  if (editingField) {
    if (event.key === 'Escape') { document.activeElement?.blur?.(); els.cadEditorCanvas.focus(); return true; }
    return false;
  }
  if (event.ctrlKey || event.metaKey) {
    if (key === 'z') { event.preventDefault(); runCadEditorOperation(event.shiftKey ? 'Redo' : 'Undo', event.shiftKey ? redoCadEditor : undoCadEditor); return true; }
    if (key === 'y') { event.preventDefault(); runCadEditorOperation('Redo', redoCadEditor); return true; }
    if (key === 'o') { event.preventDefault(); closeCadEditorMenus(); closeCadEditor({ pendingAction: () => els.projectFile.click() }); return true; }
    if (key === 's') { event.preventDefault(); applyCadEditorToViewer(); return true; }
    if (key === 'e') { event.preventDefault(); requestCadEditorXmlExport(); return true; }
    if (key === 'a') { event.preventDefault(); if (state.cadEditor.visual.mode === 'land' && cadEditorComponent()) setCadEditorLandSelection(filteredCadEditorLands(cadEditorComponent()), { primary: filteredCadEditorLands(cadEditorComponent())[0] || null }); else runCadEditorOperation('เลือกทั้งหมด', () => { selectAllVisibleCadEditorComponents(); return true; }, { alwaysBusy: true }); return true; }
    if (key === 'd') { event.preventDefault(); runCadEditorAction('duplicate'); return true; }
    if (key === 'x') { event.preventDefault(); if (state.cadEditor.visual.mode === 'land') runCadEditorOperation('แยก Land เป็น Component ใหม่', splitSelectedCadEditorLands); else runCadEditorOperation('Cut', () => { if (!copyCadEditorSelection()) return false; return removeCadEditorComponent(); }); return true; }
    if (key === 'c') { event.preventDefault(); if (state.cadEditor.visual.mode === 'land') toast('โหมด Land: ใช้ Ctrl+D เพื่อทำสำเนา หรือ Ctrl+X เพื่อแยกเป็น Component ใหม่'); else runCadEditorOperation('Copy', copyCadEditorSelection); return true; }
    if (key === 'v') { event.preventDefault(); if (state.cadEditor.visual.mode === 'land') toast('วาง Component ได้เมื่ออยู่โหมด Component'); else runCadEditorOperation('Paste', pasteCadEditorClipboard, { alwaysBusy: true }); return true; }
  }
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault();
    runCadEditorAction('delete');
    return true;
  }
  if (key === 'r') { event.preventDefault(); runCadEditorAction(event.shiftKey ? 'rotate-left' : 'rotate-right'); return true; }
  if (key === 'f') {
    event.preventDefault();
    runCadEditorAction('fit-selection');
    return true;
  }
  if (key === 'v') { event.preventDefault(); setCadEditorTool('select'); return true; }
  if (key === 'h') { event.preventDefault(); setCadEditorTool('pan'); return true; }
  if (key === 'l' && cadEditorSelectedComponents().length === 1) { event.preventDefault(); setCadEditorMode('land'); return true; }
  if (key === 'c') { event.preventDefault(); setCadEditorMode('component'); return true; }
  const stepBase = Math.max(.0001, Number(els.cadEditorNudgeStep.value) || .1);
  const step = event.shiftKey ? stepBase * 10 : stepBase;
  if (event.key === 'ArrowLeft') { event.preventDefault(); nudgeCadEditorSelection(-step, 0); return true; }
  if (event.key === 'ArrowRight') { event.preventDefault(); nudgeCadEditorSelection(step, 0); return true; }
  if (event.key === 'ArrowUp') { event.preventDefault(); nudgeCadEditorSelection(0, step); return true; }
  if (event.key === 'ArrowDown') { event.preventDefault(); nudgeCadEditorSelection(0, -step); return true; }
  if (event.key === 'Escape') {
    event.preventDefault();
    hideCadEditorContextMenu();
    if (state.cadEditor.visual.interaction) { state.cadEditor.visual.interaction = null; drawCadEditorCanvas(); }
    else if (cadEditorLandSelectionSet().size) { clearCadEditorLandSelection(); renderCadEditor(); }
    else if (cadEditorSelectionSet().size) clearCadEditorSelection();
    else closeCadEditor();
    return true;
  }
  return false;
}
function assertCadEditorValid(model) {
  const validation = validateCadEditorModel(model);
  if (!validation.valid) throw new Error(`${validation.errors.slice(0, 4).join(' · ')}${validation.errors.length > 4 ? ` · และอีก ${validation.errors.length - 4} รายการ` : ''}`);
  return validation;
}
async function assertCadEditorValidAsync(model, taskContext, progressBase = 0, progressSpan = 20) {
  const validation = await validateCadEditorModelAsync(model, {
    batchSize: 700,
    isCancelled: () => taskContext?.isCancelled?.() || false,
    onProgress: ({ ratio }) => taskContext?.progress?.(progressBase + ratio * progressSpan, `ตรวจสอบ CAD ${Math.round(ratio * 100)}%`),
  });
  if (!validation.valid) throw new Error(`${validation.errors.slice(0, 4).join(' · ')}${validation.errors.length > 4 ? ` · และอีก ${validation.errors.length - 4} รายการ` : ''}`);
  return validation;
}
function cadDataTopologySignature(data) {
  return (data?.components || [])
    .map((component) => `${String(component.id)}:${(component.lands || []).map((land) => Number(land.globalId)).sort((a, b) => a - b).join(',')}`)
    .sort()
    .join('|');
}
async function commitCadEditorToProject({ keepEditorOpen = true, showToast = true, fitViewer = false, taskContext = null } = {}) {
  const applyStarted = performance.now();
  const file = cadEditorFile();
  const model = state.cadEditor.model;
  if (!file || !model) return false;

  const fileName = file.name || state.fileNames.xml || 'CAD';
  const rollback = {
    file: {
      data: file.data,
      editedText: file.editedText,
      editorModel: file.editorModel,
      appliedEditorSnapshot: file.appliedEditorSnapshot,
      editedAt: file.editedAt,
      editRevision: file.editRevision,
      mappingDirty: file.mappingDirty,
      viewerDirty: file.viewerDirty,
      renames: file.renames,
      lastValidation: file.lastValidation,
    },
    state: {
      xmlData: state.xmlData,
      xmlText: state.xmlText,
      schema: state.schema,
      mappingData: state.mappingData,
      selectedComponentId: state.selectedComponentId,
      selected: state.selected,
      preview: state.preview,
      page: state.page,
      undoStack: state.undoStack,
      redoStack: state.redoStack,
      viewerRefreshPending: state.cadEditor.viewerRefreshPending,
    },
    modelChanged: model.changed,
  };

  const projectSession = ensureProjectSession(file);
  const projectCheckpoint = projectSessionCheckpoint(projectSession);
  let preparedRevision = null;
  let stage = 'validate';
  try {
    const validation = await assertCadEditorValidAsync(model, taskContext, 0, 20);
    taskContext?.throwIfCancelled?.();

    stage = 'build-viewer-model';
    const nextData = await cadEditorModelToDataAsync(model, {
      batchSize: 600,
      isCancelled: () => taskContext?.isCancelled?.() || false,
      onProgress: ({ ratio }) => taskContext?.progress?.(20 + ratio * 30, `เตรียมข้อมูล Viewer ${Math.round(ratio * 100)}%`),
    });
    taskContext?.throwIfCancelled?.();

    stage = 'serialize-xml';
    const editedText = await serializeCadEditorModelStandaloneAsync(model, {
      side: 'all',
      batchSize: 900,
      isCancelled: () => taskContext?.isCancelled?.() || false,
      onProgress: ({ ratio }) => taskContext?.progress?.(50 + ratio * 22, `สร้าง Working XML ${Math.round(ratio * 100)}%`),
    });
    taskContext?.throwIfCancelled?.();

    stage = 'snapshot';
    const snapshot = await cloneCadEditorModelAsync(model, {
      batchSize: 900,
      isCancelled: () => taskContext?.isCancelled?.() || false,
      onProgress: ({ ratio }) => taskContext?.progress?.(72 + ratio * 13, `สร้าง Applied Snapshot ${Math.round(ratio * 100)}%`),
    });
    taskContext?.throwIfCancelled?.();

    stage = 'prepare-revision';
    const editorChanges = (state.cadEditor.history?.undo || []).map((entry, index) => ({
      id: `editor-change:${index + 1}`,
      type: 'cad-editor-operation',
      label: String(entry?.label || 'CAD edit'),
      affectedComponentIds: [...(entry?.trackedUids || [])].map(String),
      timestamp: entry?.timestamp ? new Date(entry.timestamp).toISOString() : new Date().toISOString(),
    }));
    preparedRevision = prepareProjectRevision(projectSession, {
      legacyCad: nextData,
      workingXml: editedText,
      changes: editorChanges,
      validationStatus: 'pending',
      validationIssues: [],
    });
    stage = 'validation-center';
    const validationCenter = validateUniversalCad(preparedRevision.model, {
      unsupportedRecords: file.archive?.candidate?.adapterInfo?.unsupportedRecords || [],
    });
    if (validationCenter.blockingCount) {
      const first = validationCenter.issues.filter((item) => item.level === 'blocking-error').slice(0, 4).map((item) => `${item.code}: ${item.message}`).join(' · ');
      throw new CadTransactionError(`Validation Center พบ Blocking Error ${validationCenter.blockingCount} รายการ · ${first}`, { stage: 'validation-center', fileName, code: 'APPLY_BLOCKING_VALIDATION', context: { blockingCount: validationCenter.blockingCount } });
    }
    const validationStatus = validationCenter.counts.error ? 'errors' : (validationCenter.counts.warning ? 'warnings' : 'passed');
    preparedRevision.model.validationIssues = validationCenter.issues;
    preparedRevision.revision.model.validationIssues = validationCenter.issues;
    preparedRevision.revision.validationStatus = validationStatus;
    preparedRevision.changeSet.validationStatus = validationStatus;
    const nextRevision = preparedRevision.revisionNumber;

    stage = 'prepare-mapping';
    taskContext?.progress?.(86, 'เตรียม Mapping จาก Revision ใหม่');
    await taskContext?.yield?.();
    const preparedMapping = prepareMappingForCadData(nextData, {
      previousMappingData: state.mappingData,
      revision: nextRevision,
    });
    taskContext?.throwIfCancelled?.();

    stage = 'commit-project-revision';
    commitPreparedProjectRevision(projectSession, preparedRevision);

    stage = 'commit-compatibility-views';
    const topologyChanged = cadDataTopologySignature(file.data) !== cadDataTopologySignature(nextData);
    snapshot.changed = false;
    model.changed = false;

    // Publish all legacy compatibility views only after every preparation step succeeds.
    file.data = nextData;
    file.editedText = editedText;
    file.editorModel = model;
    file.appliedEditorSnapshot = snapshot;
    file.editedAt = new Date().toISOString();
    file.editRevision = nextRevision;
    file.mappingDirty = false;
    file.viewerDirty = true;
    file.renames = new Map();
    file.lastValidation = validationCenter;
    state.cadInspector.renames = file.renames;

    if (state.activeCadRole === file.role) {
      state.xmlData = nextData;
      state.xmlText = editedText;
      state.schema = preparedMapping.schema;
      state.mappingData = preparedMapping.mappingData;
      state.selectedComponentId = BOARD_VIEW;
      state.selected = null;
      state.preview = null;
      state.page = 1;
      state.undoStack = [];
      state.redoStack = [];
      if (state.xlsxData && state.schema) populateSchemaControls();
      normalizeMappings();
      state.cadEditor.viewerRefreshPending = true;
    }

    resetCadEditorHistory(model);
    state.cadCompare.result = null;
    updateCadCompareControls();
    els.cadStudioDirtyBadge?.classList.add('hidden');
    taskContext?.progress?.(100, 'Apply และ Mapping Commit สำเร็จ');
    els.cadEditorMessage.textContent = `Apply Revision ${nextRevision} แล้ว · ${formatInt.format(nextData.components.length)} Components / ${formatInt.format(nextData.totalLands)} Lands · Validation ${validationStatus} (${validationCenter.counts.warning} Warning / ${validationCenter.counts.error} Error) · Viewer, Mapping และ Export ใช้ Revision เดียวกัน`;
    state.diagnostics.record('apply', performance.now() - applyStarted, { success: true, revision: nextRevision, components: nextData.components.length, lands: nextData.totalLands });
    scheduleProjectAutosave(file);
    if (showToast) toast(`Apply สำเร็จ · Revision ${nextRevision}${topologyChanged ? ' · โครงสร้าง CAD เปลี่ยน' : ''}`, 4800);
    return true;
  } catch (error) {
    state.diagnostics.record('apply', performance.now() - applyStarted, { success: false, stage });
    restoreProjectSessionCheckpoint(projectSession, projectCheckpoint);
    file.data = rollback.file.data;
    file.editedText = rollback.file.editedText;
    file.editorModel = rollback.file.editorModel;
    file.appliedEditorSnapshot = rollback.file.appliedEditorSnapshot;
    file.editedAt = rollback.file.editedAt;
    file.editRevision = rollback.file.editRevision;
    file.mappingDirty = rollback.file.mappingDirty;
    file.viewerDirty = rollback.file.viewerDirty;
    file.renames = rollback.file.renames;
    file.lastValidation = rollback.file.lastValidation;
    state.xmlData = rollback.state.xmlData;
    state.xmlText = rollback.state.xmlText;
    state.schema = rollback.state.schema;
    state.mappingData = rollback.state.mappingData;
    state.selectedComponentId = rollback.state.selectedComponentId;
    state.selected = rollback.state.selected;
    state.preview = rollback.state.preview;
    state.page = rollback.state.page;
    state.undoStack = rollback.state.undoStack;
    state.redoStack = rollback.state.redoStack;
    state.cadEditor.viewerRefreshPending = rollback.state.viewerRefreshPending;
    model.changed = rollback.modelChanged;
    if (error?.name === 'AbortError') {
      error.code ||= 'CAD-APPLY-CANCELLED';
      error.stage ||= stage;
      error.fileName ||= fileName;
      throw error;
    }
    throw new CadTransactionError(`Apply rollback แล้ว · ขั้นตอน ${stage} · ไฟล์ ${fileName} · ${error?.message || error}`, {
      stage, fileName, code: 'CAD-APPLY-ROLLBACK', cause: error, technicalDetail: error?.stack || '',
      context: { originalCode: error?.code || '', revision: projectRevision(file) },
    });
  }
}

function applyCadEditorToViewer() {
  return requestCadEditorApply();
}
function assertAppliedRevisionExportable(file, model = null) {
  if (!file) throw new ExportError('ไม่มี Project สำหรับ Export', { stage: 'export-preflight', code: 'EXPORT_NO_PROJECT' });
  if (model?.changed) throw new ExportError('Working Model มีการแก้ไขที่ยังไม่ได้ Apply กรุณา Apply ก่อน Export เพื่อให้ Revision ตรงกัน', { stage: 'export-preflight', fileName: file.name, code: 'EXPORT_UNAPPLIED_CHANGES' });
  const session = ensureProjectSession(file);
  const preflight = exportPreflight(session.project.currentModel, { unsupportedRecords: file.archive?.candidate?.adapterInfo?.unsupportedRecords || [] });
  file.lastValidation = preflight;
  if (!preflight.exportAllowed) {
    const detail = preflight.blockingErrors.slice(0, 4).map((item) => `${item.code}: ${item.message}`).join(' · ');
    throw new ExportError(`Export ถูกบล็อกโดย Validation ${preflight.blockingCount} รายการ · ${detail}`, { stage: 'export-preflight', fileName: file.name, code: 'EXPORT_BLOCKING_VALIDATION', context: { blockingCount: preflight.blockingCount } });
  }
  return preflight;
}
function addXmlExportMetadata(xmlText, metadata) {
  const accepted = (metadata.acceptedWarnings || []).map((item) => typeof item === 'string' ? item : item.code || item.id || '').filter(Boolean).join('|');
  const safe = (value) => String(value ?? '').replace(/--/g, '—');
  const comment = `<!-- UniversalCAD Export projectId=${safe(metadata.projectId)} revision=${safe(metadata.revisionNumber)} exportTime=${safe(metadata.exportTime)} sourceFormat=${safe(metadata.sourceFormat)} exportFormat=${safe(metadata.exportFormat)} validationStatus=${safe(metadata.validationStatus)} acceptedWarnings=${safe(accepted)} -->`;
  return String(xmlText).replace(/^(<\?xml[^>]*>)/i, `$1\n${comment}`);
}

function cadExportStem(file, side) {
  const base = String(file?.name || 'cad.xml').split('/').pop().replace(/\.(?:xml|cpo|cad|dat|txt)$/i, '');
  return `${base}_${side === 'all' ? 'top_bottom' : side}`;
}
async function exportCadEditorXml(taskContext = null) {
  const file = cadEditorFile();
  const model = state.cadEditor.model;
  if (!file || !model) return false;
  const side = els.cadEditorExportSide.value;
  const preflight = assertAppliedRevisionExportable(file, model);
  await assertCadEditorValidAsync(model, taskContext, 0, 25);
  const output = await serializeCadEditorModelStandaloneAsync(model, {
    side,
    batchSize: 900,
    isCancelled: () => taskContext?.isCancelled?.() || false,
    onProgress: ({ ratio }) => taskContext?.progress?.(25 + ratio * 70, `สร้าง XML ${Math.round(ratio * 100)}%`),
  });
  taskContext?.throwIfCancelled?.();
  const metadata = projectExportMetadata(file, 'inspection-xml', preflight.counts.error ? 'errors' : (preflight.counts.warning ? 'warnings' : 'passed'));
  const exportedOutput = addXmlExportMetadata(output, metadata);
  downloadBlob(new Blob([exportedOutput], { type: 'application/xml;charset=utf-8' }), `${cadExportStem(file, side)}.xml`);
  const summary = modelSummary(model);
  const omitted = side === 'all' ? 0 : summary.unknown;
  taskContext?.progress?.(100, 'Export XML สำเร็จ');
  els.cadEditorMessage.textContent = `Export XML ${side === 'all' ? 'Top + Bottom' : side.toUpperCase()} สำเร็จ${omitted ? ` · Land ไม่ระบุด้าน ${omitted} จุดไม่ถูกรวม` : ''}`;
  return true;
}
function requestCadEditorXmlExport() {
  return runCadEditorTask('กำลัง Export XML…', 'ตรวจสอบข้อมูลก่อนสร้างไฟล์', (taskContext) => exportCadEditorXml(taskContext));
}
async function exportCadEditorTgz(taskContext = null) {
  const file = cadEditorFile(); const model = state.cadEditor.model;
  const archive = file?.archive;
  if (!archive?.packageInfo || archive.packageInfo.root.kind === 'file' || !model) { toast('ไฟล์นี้ไม่ได้เปิดมาจาก ZIP / TGZ / TAR'); return false; }
  if (!archive.candidate?.node || archive.candidate?.format === 'odb++') { toast('ODB++ ถูกแปลงเป็น XML แล้ว จึงส่งออกเป็น XML ได้ แต่ยังไม่รองรับการเขียนย้อนกลับเป็น ODB++ TGZ', 7000); return false; }
  const side = els.cadEditorExportSide.value;
  const outputInfo = packageOutputInfo(archive.packageInfo, side);
  const originalText = els.cadEditorExportTgzButton.textContent;
  try {
    els.cadEditorExportTgzButton.disabled = true;
    els.cadEditorExportTgzButton.textContent = `กำลังสร้าง ${outputInfo.label}…`;
    const preflight = assertAppliedRevisionExportable(file, model);
    await assertCadEditorValidAsync(model, taskContext, 0, 25);
    taskContext?.progress?.(35, `กำลังสร้าง ${outputInfo.label}`);
    await taskContext?.yield?.();
    const rawOutput = serializeCadEditorModel(file.text, model, { side });
    const metadata = projectExportMetadata(file, `archive-${outputInfo.label.toLowerCase()}`, preflight.counts.error ? 'errors' : (preflight.counts.warning ? 'warnings' : 'passed'));
    const output = addXmlExportMetadata(rawOutput, metadata);
    taskContext?.throwIfCancelled?.();
    taskContext?.progress?.(65, 'กำลังประกอบ Archive กลับ');
    const bytes = await rebuildCadPackage(archive.packageInfo, archive.candidate, output);
    taskContext?.throwIfCancelled?.();
    downloadBlob(new Blob([bytes], { type: outputInfo.mime }), outputInfo.filename);
    taskContext?.progress?.(100, `Export ${outputInfo.label} สำเร็จ`);
    els.cadEditorMessage.textContent = `Export ${outputInfo.label} สำเร็จ · แทนที่ CAD ที่ ${archive.candidate.displayPath} และเก็บไฟล์ประกอบ/Archive ซ้อนเดิมไว้`;
    return true;
  } finally {
    els.cadEditorExportTgzButton.textContent = originalText || 'Export Archive';
    renderCadEditorSummary();
  }
}
function requestCadEditorArchiveExport() {
  const file = cadEditorFile();
  if (file?.archive?.candidate?.format === 'odb++') return exportCadEditorTgz();
  return runCadEditorTask('กำลัง Export Archive…', 'ตรวจสอบและประกอบไฟล์กลับ', (taskContext) => exportCadEditorTgz(taskContext));
}

function closeCadEditorMenus() {
  document.querySelectorAll('[data-cad-menu-panel]').forEach((panel) => {
    panel.classList.add('hidden');
    panel.style.removeProperty('left');
    panel.style.removeProperty('right');
    panel.style.removeProperty('max-width');
  });
  document.querySelectorAll('[data-cad-menu]').forEach((button) => button.setAttribute('aria-expanded', 'false'));
}
function positionCadEditorMenu(panel, trigger) {
  if (!panel || !trigger) return;
  panel.style.removeProperty('left');
  panel.style.removeProperty('right');
  panel.style.removeProperty('max-width');

  // On compact layouts CSS makes the menu a fixed full-width sheet.
  if (window.matchMedia?.('(max-width: 860px)').matches) return;

  const root = trigger.closest('.cad-menu-root');
  if (!root) return;
  const viewportPadding = 8;
  const rootRect = root.getBoundingClientRect();
  const maxWidth = Math.max(180, window.innerWidth - viewportPadding * 2);
  panel.style.maxWidth = `${maxWidth}px`;
  const panelWidth = Math.min(panel.getBoundingClientRect().width || 250, maxWidth);

  let offsetLeft = 0;
  const preferredRight = rootRect.left + panelWidth;
  if (preferredRight > window.innerWidth - viewportPadding) {
    offsetLeft = window.innerWidth - viewportPadding - panelWidth - rootRect.left;
  }
  if (rootRect.left + offsetLeft < viewportPadding) {
    offsetLeft = viewportPadding - rootRect.left;
  }
  panel.style.left = `${Math.round(offsetLeft)}px`;
  panel.style.right = 'auto';
}
function repositionOpenCadEditorMenu() {
  const panel = document.querySelector('[data-cad-menu-panel]:not(.hidden)');
  if (!panel) return;
  const menu = panel.dataset.cadMenuPanel;
  const trigger = document.querySelector(`[data-cad-menu="${menu}"]`);
  positionCadEditorMenu(panel, trigger);
}
function toggleCadEditorMenu(menu, trigger) {
  const panel = document.querySelector(`[data-cad-menu-panel="${menu}"]`);
  if (!panel) return;
  const shouldOpen = panel.classList.contains('hidden');
  closeCadEditorMenus();
  if (shouldOpen) {
    updateCadEditorMenuState();
    panel.classList.remove('hidden');
    positionCadEditorMenu(panel, trigger);
    trigger?.setAttribute('aria-expanded', 'true');
  }
}
function setCadEditorViewSide(side) {
  state.cadEditor.visual.side = ['top', 'bottom', 'unknown'].includes(side) ? side : 'all';
  if (els.cadEditorVisualSideFilter) els.cadEditorVisualSideFilter.value = state.cadEditor.visual.side;
  renderCadEditorVisualProperties();
  drawCadEditorCanvas();
}
function updateCadEditorMenuState() {
  const visual = state.cadEditor.visual;
  const selectedCount = cadEditorSelectedComponents().length;
  const selectedLandCount = cadEditorSelectedLands().length;
  const hasLand = selectedLandCount > 0;
  const activeTarget = visual.mode === 'land' ? hasLand : selectedCount > 0;
  const checks = {
    grid: visual.grid !== false,
    labels: visual.labels !== false,
    snap: visual.snap !== false,
    'side-all': visual.side === 'all',
    'side-top': visual.side === 'top',
    'side-bottom': visual.side === 'bottom',
    'select-tool': visual.tool === 'select',
    'pan-tool': visual.tool === 'pan',
    'component-mode': visual.mode === 'component',
    'land-mode': visual.mode === 'land',
  };
  document.querySelectorAll('[data-cad-check]').forEach((button) => button.classList.toggle('checked', Boolean(checks[button.dataset.cadCheck])));
  const setCommandDisabled = (command, disabled) => document.querySelectorAll(`[data-cad-command="${command}"]`).forEach((button) => { button.disabled = Boolean(disabled); });
  setCommandDisabled('export-xml', !state.cadEditor.model);
  setCommandDisabled('export-archive', !state.cadEditor.model || Boolean(els.cadEditorExportTgzButton?.disabled));
  setCommandDisabled('cut', visual.mode === 'land' ? selectedLandCount === 0 || selectedLandCount >= (cadEditorComponent()?.lands?.length || 0) : selectedCount === 0);
  setCommandDisabled('copy', visual.mode === 'land' || selectedCount === 0);
  setCommandDisabled('paste', visual.mode === 'land' || !(state.cadEditor.clipboard || []).length);
  setCommandDisabled('duplicate', !activeTarget);
  setCommandDisabled('delete', !activeTarget);
  setCommandDisabled('fit-selection', selectedCount === 0 && !hasLand);
  setCommandDisabled('land-mode', selectedCount !== 1);
  setCommandDisabled('rotate-left', !activeTarget);
  setCommandDisabled('rotate-right', !activeTarget);
  setCommandDisabled('flip-side', !activeTarget);
  setCommandDisabled('renumber-selected', selectedCount === 0);
  updateCadEditorHistoryControls();
}
async function toggleCadEditorFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await (els.cadEditorOverlay.requestFullscreen?.() || els.cadEditorOverlay.webkitRequestFullscreen?.());
  } catch (error) { toast(`เปิดเต็มหน้าจอไม่สำเร็จ: ${error.message}`, 5000); }
}
function validateCadEditorFromMenu() {
  if (!state.cadEditor.model) return false;
  const validation = validateCadEditorModel(state.cadEditor.model);
  if (validation.valid) {
    const summary = modelSummary(state.cadEditor.model);
    toast(`CAD ถูกต้อง · ${formatInt.format(summary.components)} Components · ${formatInt.format(summary.lands)} Lands${validation.warnings?.length ? ` · คำเตือน ${validation.warnings.length}` : ''}`, 5500);
  } else toast(`พบข้อผิดพลาด ${validation.errors.length} รายการ: ${validation.errors.slice(0, 3).join(' · ')}`, 7000);
  return validation.valid;
}
function runCadEditorCommand(command) {
  closeCadEditorMenus();
  switch (command) {
    case 'open': closeCadEditor({ pendingAction: () => els.projectFile.click() }); return true;
    case 'export-xml': requestCadEditorXmlExport(); return true;
    case 'export-archive': requestCadEditorArchiveExport(); return true;
    case 'close': closeCadEditor(); return true;
    case 'undo': return runCadEditorOperation('Undo', undoCadEditor);
    case 'redo': return runCadEditorOperation('Redo', redoCadEditor);
    case 'cut': return state.cadEditor.visual.mode === 'land' ? runCadEditorOperation('แยก Land เป็น Component ใหม่', splitSelectedCadEditorLands) : runCadEditorOperation('Cut', () => { if (!copyCadEditorSelection()) return false; return removeCadEditorComponent(); });
    case 'copy': if (state.cadEditor.visual.mode === 'land') { toast('โหมด Land: ใช้ Duplicate หรือ Split'); return false; } return runCadEditorOperation('Copy', copyCadEditorSelection);
    case 'paste': if (state.cadEditor.visual.mode === 'land') { toast('เปลี่ยนเป็นโหมด Component ก่อนวาง'); return false; } return runCadEditorOperation('Paste', pasteCadEditorClipboard, { alwaysBusy: true });
    case 'duplicate': return runCadEditorAction('duplicate');
    case 'delete': return runCadEditorAction('delete');
    case 'select-all': if (state.cadEditor.visual.mode === 'land' && cadEditorComponent()) { const lands = filteredCadEditorLands(cadEditorComponent()); setCadEditorLandSelection(lands, { primary: lands[0] || null }); } else runCadEditorOperation('เลือกทั้งหมด', () => { selectAllVisibleCadEditorComponents(); return true; }, { alwaysBusy: true }); return true;
    case 'clear-selection': if (state.cadEditor.visual.mode === 'land') { clearCadEditorLandSelection(); renderCadEditor(); } else clearCadEditorSelection(); return true;
    case 'fit-board': fitCadEditorView(); return true;
    case 'fit-selection': return runCadEditorAction('fit-selection');
    case 'zoom-in': zoomCadEditorAt(1.28); return true;
    case 'zoom-out': zoomCadEditorAt(1 / 1.28); return true;
    case 'toggle-grid': visualToggle('grid'); return true;
    case 'toggle-labels': visualToggle('labels'); return true;
    case 'toggle-snap': visualToggle('snap'); return true;
    case 'side-all': setCadEditorViewSide('all'); return true;
    case 'side-top': setCadEditorViewSide('top'); return true;
    case 'side-bottom': setCadEditorViewSide('bottom'); return true;
    case 'fullscreen': toggleCadEditorFullscreen(); return true;
    case 'select-tool': setCadEditorTool('select'); return true;
    case 'pan-tool': setCadEditorTool('pan'); return true;
    case 'component-mode': setCadEditorMode('component'); return true;
    case 'land-mode':
      if (cadEditorSelectedComponents().length !== 1) { toast('เลือก Component เพียง 1 ชิ้นก่อนเข้าโหมด Land'); return false; }
      setCadEditorMode('land'); return true;
    case 'rotate-left': return runCadEditorAction('rotate-left');
    case 'rotate-right': return runCadEditorAction('rotate-right');
    case 'flip-side': return runCadEditorAction('flip-side');
    case 'renumber-selected': return runCadEditorAction('renumber');
    case 'renumber-all': return runCadEditorOperation('เริ่มชื่อ A1 ทุก Component', renumberCadEditorAll, { alwaysBusy: true });
    case 'validate': return validateCadEditorFromMenu();
    default: return false;
  }
}
function visualToggle(property) {
  state.cadEditor.visual[property] = !state.cadEditor.visual[property];
  if (property === 'grid' && els.cadEditorGridToggle) els.cadEditorGridToggle.checked = state.cadEditor.visual.grid;
  if (property === 'labels' && els.cadEditorLabelToggle) els.cadEditorLabelToggle.checked = state.cadEditor.visual.labels;
  if (property === 'snap' && els.cadEditorSnapToggle) els.cadEditorSnapToggle.checked = state.cadEditor.visual.snap;
  updateCadEditorMenuState();
  drawCadEditorCanvas();
}

function resizeCanvas() { draw(); drawCadEditorCanvas(); renderHistogram(); if (!els.histogramOverlay.classList.contains('hidden')) renderDetailedHistogram(); }

els.projectFile.addEventListener('change', (event) => processFile(event.target.files[0], 'auto'));
els.originalCadButton.addEventListener('click', () => els.originalCadFile.click());
els.originalCadFile.addEventListener('change', (event) => processFile(event.target.files[0], 'original'));
els.generatedCadButton.addEventListener('click', () => els.generatedCadFile.click());
els.generatedCadFile.addEventListener('change', (event) => processFile(event.target.files[0], 'generated'));
els.archiveCadButton.addEventListener('click', () => els.archiveCadFile.click());
els.archiveCadFile.addEventListener('change', (event) => processFile(event.target.files[0], 'original'));
els.dropZone.addEventListener('dragover', (event) => { event.preventDefault(); els.dropZone.classList.add('drag'); });
els.dropZone.addEventListener('dragleave', () => els.dropZone.classList.remove('drag'));
els.dropZone.addEventListener('drop', (event) => { event.preventDefault(); els.dropZone.classList.remove('drag'); processFile(event.dataTransfer.files[0], 'auto'); });
els.restoreButton.addEventListener('click', () => els.restoreFile.click());
els.restoreFile.addEventListener('change', (event) => restoreBackup(event.target.files[0]));
els.projectBackupButton.addEventListener('click', exportFullProjectBackup);
els.recoveryButton.addEventListener('click', async () => {
  const record = state.recoveryRecord || (await refreshRecoveryNotice())[0]; if (!record) return;
  const accepted = await requestAppConfirm({ title: 'กู้คืน Autosave?', message: `${record.name} · Revision ${record.revision}`, detail: 'Workspace ปัจจุบันที่ยังไม่ Commit จะไม่ถูกรวมในการกู้คืน', confirmText: 'Yes - กู้คืน' });
  if (accepted) await restoreStoredProject(await loadProjectRecord(record.id));
});
els.storageManagerButton.addEventListener('click', () => openStorageManager().catch((error) => showGlobalError(error, { title: 'เปิด Project Storage ไม่สำเร็จ', operation: 'storage-open' })));
els.storageCloseButton.addEventListener('click', closeStorageManager);
els.storageCloseFooterButton.addEventListener('click', closeStorageManager);
els.storageOverlay.addEventListener('click', (event) => { if (event.target === els.storageOverlay) closeStorageManager(); });
els.storageProjectList.addEventListener('click', handleStorageAction);
els.storageRefreshButton.addEventListener('click', () => renderStorageManager().catch((error) => showGlobalError(error, { title: 'รีเฟรช Project Storage ไม่สำเร็จ', operation: 'storage-refresh' })));
els.storageClearTempButton.addEventListener('click', async () => {
  const accepted = await requestAppConfirm({ title: 'ล้าง Temporary Cache?', message: 'Project Autosave และ Immutable Source จะไม่ถูกลบ', confirmText: 'Yes - ล้าง Cache' });
  if (!accepted) return;
  try { await clearTemporaryCache(); await renderStorageManager(); toast('ล้าง Temporary Cache แล้ว'); }
  catch (error) { showGlobalError(error, { title: 'ล้าง Temporary Cache ไม่สำเร็จ', operation: 'storage-clear-temporary' }); }
});
els.resetButton.addEventListener('click', resetProject); els.remapButton.addEventListener('click', runMapping);
els.cadEditorButton.addEventListener('click', openCadEditor);
els.detailPanelButton.addEventListener('click', toggleDetailsDrawer);
els.detailPanelCloseButton.addEventListener('click', closeDetailsDrawer);
els.detailPanelBackdrop?.addEventListener('click', closeDetailsDrawer);
document.addEventListener?.('keydown', (event) => { if (event.key === 'Escape' && document.querySelector('.right-panel')?.classList.contains('open')) closeDetailsDrawer(); });
els.cadInspectorButton.addEventListener('click', openCadInspector);
els.cadCompareButton.addEventListener('click', openCadCompare);
els.closeCadCompareButton.addEventListener('click', closeCadCompare);
els.cadCompareOverlay.addEventListener('click', (event) => { if (event.target === els.cadCompareOverlay) closeCadCompare(); });
els.rebuildCadCompareButton.addEventListener('click', () => { state.cadCompare.page = 1; rebuildCadComparison({ showToast: true }); });
els.cadCompareTolerance.addEventListener('change', () => { state.cadCompare.page = 1; rebuildCadComparison(); });
els.cadCompareFilter.addEventListener('change', () => { state.cadCompare.filter = els.cadCompareFilter.value; state.cadCompare.page = 1; renderCadCompare(); });
els.cadCompareSearch.addEventListener('input', () => { state.cadCompare.search = els.cadCompareSearch.value; state.cadCompare.page = 1; renderCadCompare(); });
els.useOriginalCadButton.addEventListener('click', () => { activateCad('original'); closeCadCompare(); });
els.useGeneratedCadButton.addEventListener('click', () => { activateCad('generated'); closeCadCompare(); });
els.fitCadCompareButton.addEventListener('click', () => { fitCadCompareRow(); closeCadCompare(); });
els.exportCadCompareButton.addEventListener('click', exportCadComparison);
els.cadComparePrevPage.addEventListener('click', () => { state.cadCompare.page -= 1; renderCadCompare(); });
els.cadCompareNextPage.addEventListener('click', () => { state.cadCompare.page += 1; renderCadCompare(); });
els.closeCadInspectorButton.addEventListener('click', closeCadInspector);
els.cadInspectorOverlay.addEventListener('click', (event) => { if (event.target === els.cadInspectorOverlay) closeCadInspector(); });
els.cadInspectorScope.addEventListener('change', () => { state.cadInspector.page = 1; refreshCadInspector(); });
els.cadMaxLength.addEventListener('change', () => { state.cadInspector.page = 1; refreshCadInspector(); });
els.cadOverflowMode.addEventListener('change', () => { state.cadInspector.page = 1; refreshCadInspector(); });
els.cadDuplicateMode.addEventListener('change', () => { state.cadInspector.page = 1; refreshCadInspector(); });
els.cadDuplicateCharacter.addEventListener('change', () => { state.cadInspector.page = 1; refreshCadInspector(); });
els.cadNamePrefix.addEventListener('change', refreshCadInspector);
els.cadIssueFilter.addEventListener('change', () => { state.cadInspector.page = 1; refreshCadInspector(); });
els.cadInspectorSearch.addEventListener('input', () => { state.cadInspector.page = 1; refreshCadInspector(); });
els.cadAutoFixButton.addEventListener('click', () => { refreshCadInspector(); generateCadNames(false); });
els.cadRenameAllButton.addEventListener('click', () => { refreshCadInspector(); generateCadNames(true); });
els.cadResetNamesButton.addEventListener('click', resetCadNames);
els.cadExportReportButton.addEventListener('click', exportCadAuditReport);
els.cadApplyNamesButton.addEventListener('click', () => applyCadNamesToProject());
els.cadExportXmlButton.addEventListener('click', exportCorrectedCadXml);
els.cadInspectorPrevPage.addEventListener('click', () => { state.cadInspector.page -= 1; renderCadInspectorTable(); });
els.cadInspectorNextPage.addEventListener('click', () => { state.cadInspector.page += 1; renderCadInspectorTable(); });
els.closeCadEditorButton.addEventListener('click', () => closeCadEditor());
els.cadEditorOverlay.addEventListener('click', (event) => { if (event.target === els.cadEditorOverlay) closeCadEditor(); });
els.cadStudioOpenButton?.addEventListener('click', () => closeCadEditor({ pendingAction: () => els.projectFile.click() }));
els.appConfirmCancel?.addEventListener('click', () => closeAppConfirm(false));
els.appConfirmAccept?.addEventListener('click', () => closeAppConfirm(true));
els.appConfirmOverlay?.addEventListener('click', (event) => { if (event.target === els.appConfirmOverlay) closeAppConfirm(false); });
els.cadEditorConfirmNo?.addEventListener('click', declineCadEditorChoice);
els.cadEditorConfirmYes?.addEventListener('click', confirmCadEditorChoice);
els.cadEditorBusyCancelButton?.addEventListener('click', () => cancelCadEditorTask());
els.cadEditorBusyCloseButton?.addEventListener('click', () => cancelCadEditorTask({ closeAfter: true }));
els.cadEditorConfirmOverlay?.addEventListener('click', (event) => { if (event.target === els.cadEditorConfirmOverlay) closeCadEditorConfirm(); });
els.cadEditorUndoButton?.addEventListener('click', () => runCadEditorOperation('Undo', undoCadEditor));
els.cadEditorRedoButton?.addEventListener('click', () => runCadEditorOperation('Redo', redoCadEditor));
els.cadEditorRotateLeftButton?.addEventListener('click', () => runCadEditorAction('rotate-left'));
els.cadEditorRotateRightButton?.addEventListener('click', () => runCadEditorAction('rotate-right'));
els.cadEditorFlipSideButton?.addEventListener('click', () => runCadEditorAction('flip-side'));
els.cadEditorDockDuplicateButton?.addEventListener('click', () => runCadEditorAction('duplicate'));
els.cadEditorDockRotateButton?.addEventListener('click', () => runCadEditorAction('rotate-right'));
els.cadEditorDockFlipButton?.addEventListener('click', () => runCadEditorAction('flip-side'));
els.cadEditorAlignLeftButton?.addEventListener('click', () => runCadEditorOperation('จัดชิดซ้าย', () => alignCadEditorSelection('left')));
els.cadEditorAlignCenterXButton?.addEventListener('click', () => runCadEditorOperation('จัดกึ่งกลางแนวตั้ง', () => alignCadEditorSelection('center-x')));
els.cadEditorAlignRightButton?.addEventListener('click', () => runCadEditorOperation('จัดชิดขวา', () => alignCadEditorSelection('right')));
els.cadEditorAlignTopButton?.addEventListener('click', () => runCadEditorOperation('จัดชิดบน', () => alignCadEditorSelection('top')));
els.cadEditorAlignCenterYButton?.addEventListener('click', () => runCadEditorOperation('จัดกึ่งกลางแนวนอน', () => alignCadEditorSelection('center-y')));
els.cadEditorAlignBottomButton?.addEventListener('click', () => runCadEditorOperation('จัดชิดล่าง', () => alignCadEditorSelection('bottom')));
els.cadEditorSelectionBar?.addEventListener('click', (event) => { const button = event.target.closest('[data-cad-action]'); if (button) runCadEditorAction(button.dataset.cadAction); });
els.cadEditorContextMenu?.addEventListener('click', (event) => { const button = event.target.closest('[data-cad-action]'); if (button) runCadEditorAction(button.dataset.cadAction); });
document.querySelectorAll('[data-cad-dock]').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('[data-cad-dock]').forEach((item) => item.classList.toggle('active', item === button));
  document.querySelectorAll('[data-cad-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.cadPanel === button.dataset.cadDock));
}));
document.querySelectorAll('[data-cad-side]').forEach((button) => button.addEventListener('click', () => {
  state.cadEditor.visual.side = button.dataset.cadSide || 'all';
  els.cadEditorVisualSideFilter.value = state.cadEditor.visual.side;
  renderCadEditorVisualProperties(); drawCadEditorCanvas();
}));
document.querySelectorAll('[data-cad-menu]').forEach((button) => button.addEventListener('click', (event) => {
  event.stopPropagation();
  toggleCadEditorMenu(button.dataset.cadMenu, button);
}));
document.querySelectorAll('[data-cad-command]').forEach((button) => button.addEventListener('click', (event) => {
  event.stopPropagation();
  if (!button.disabled) runCadEditorCommand(button.dataset.cadCommand);
}));
document.addEventListener?.('pointerdown', (event) => {
  if (!event.target.closest?.('.cad-menu-root')) closeCadEditorMenus();
});
document.addEventListener?.('fullscreenchange', updateCadEditorMenuState);
els.cadNavigatorFitSearchButton?.addEventListener('click', () => fitCadEditorView());
els.cadNavigatorClearSearchButton?.addEventListener('click', () => { els.cadEditorVisualSearch.value = ''; state.cadEditor.visual.search = ''; drawCadEditorCanvas(); });
els.cadEditorComponentSearch.addEventListener('input', () => { state.cadEditor.componentSearch = els.cadEditorComponentSearch.value; renderCadEditorComponents(); });
els.cadEditorLandSearch.addEventListener('input', () => { state.cadEditor.landSearch = els.cadEditorLandSearch.value; renderCadEditorLands(); });
els.cadEditorSideFilter.addEventListener('change', () => { state.cadEditor.sideFilter = els.cadEditorSideFilter.value; renderCadEditorLands(); });
els.cadEditorExportSide.addEventListener('change', renderCadEditorSummary);
els.cadEditorAddComponentButton.addEventListener('click', () => runCadEditorAction('duplicate'));
els.cadEditorDeleteComponentButton.addEventListener('click', () => runCadEditorAction('delete'));
els.cadEditorSaveComponentButton.addEventListener('click', saveCadEditorComponent);
els.cadEditorAddLandButton.addEventListener('click', addCadEditorLand);
els.cadEditorDuplicateLandButton.addEventListener('click', duplicateCadEditorLand);
els.cadEditorCutLandButton?.addEventListener('click', () => runCadEditorOperation('ตัด Land ครึ่งหนึ่ง', cutSelectedCadEditorLand));
els.cadEditorMergeLandButton?.addEventListener('click', () => runCadEditorOperation('รวม Land', mergeSelectedCadEditorLands));
els.cadEditorSplitLandButton?.addEventListener('click', () => runCadEditorOperation('แยก Land เป็น Component ใหม่', splitSelectedCadEditorLands));
els.cadEditorDeleteLandButton.addEventListener('click', removeCadEditorLand);
els.cadEditorRenumberComponentButton.addEventListener('click', () => runCadEditorAction('renumber'));
els.cadEditorRenumberAllButton.addEventListener('click', () => runCadEditorOperation('เริ่มชื่อ A1 ทุก Component', renumberCadEditorAll, { alwaysBusy: true }));
els.cadEditorApplyButton.addEventListener('click', applyCadEditorToViewer);
els.cadEditorExportXmlButton.addEventListener('click', requestCadEditorXmlExport);
els.cadEditorExportTgzButton.addEventListener('click', requestCadEditorArchiveExport);
els.cadEditorSelectTool.addEventListener('click', () => setCadEditorTool('select'));
els.cadEditorPanTool.addEventListener('click', () => setCadEditorTool('pan'));
els.cadEditorComponentMode.addEventListener('click', () => setCadEditorMode('component'));
els.cadEditorLandMode.addEventListener('click', () => {
  if (cadEditorSelectedComponents().length !== 1) return toast('เลือก Component เพียง 1 ชิ้นก่อนเข้าโหมด Land');
  setCadEditorMode('land');
});
els.cadEditorVisualSearch.addEventListener('input', () => { state.cadEditor.visual.search = els.cadEditorVisualSearch.value; drawCadEditorCanvas(); });
els.cadEditorVisualSearch.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); fitCadEditorView(); } });
els.cadEditorVisualSideFilter.addEventListener('change', () => { state.cadEditor.visual.side = els.cadEditorVisualSideFilter.value; renderCadEditorVisualProperties(); drawCadEditorCanvas(); });
els.cadEditorFitButton.addEventListener('click', () => fitCadEditorView());
els.cadEditorZoomInButton.addEventListener('click', () => zoomCadEditorAt(1.28));
els.cadEditorZoomOutButton.addEventListener('click', () => zoomCadEditorAt(1 / 1.28));
els.cadEditorLabelToggle.addEventListener('change', () => { state.cadEditor.visual.labels = els.cadEditorLabelToggle.checked; updateCadEditorMenuState(); drawCadEditorCanvas(); });
els.cadEditorGridToggle.addEventListener('change', () => { state.cadEditor.visual.grid = els.cadEditorGridToggle.checked; updateCadEditorMenuState(); drawCadEditorCanvas(); });
els.cadEditorSnapToggle?.addEventListener('change', () => { state.cadEditor.visual.snap = els.cadEditorSnapToggle.checked; renderCadEditorVisualProperties(); });
els.cadEditorSelectAllButton.addEventListener('click', () => { if (state.cadEditor.visual.mode === 'land' && cadEditorComponent()) { const lands = filteredCadEditorLands(cadEditorComponent()); setCadEditorLandSelection(lands, { primary: lands[0] || null }); } else selectAllVisibleCadEditorComponents(); });
els.cadEditorClearSelectionButton.addEventListener('click', () => { if (state.cadEditor.visual.mode === 'land') { clearCadEditorLandSelection(); renderCadEditor(); } else clearCadEditorSelection(); });
els.cadEditorMoveButton.addEventListener('click', () => {
  const dx = Number(els.cadEditorMoveDx.value), dy = Number(els.cadEditorMoveDy.value);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return toast('ระยะย้าย X/Y ไม่ถูกต้อง');
  if (moveSelectedCadEditorComponents(dx, dy)) { els.cadEditorMoveDx.value = '0'; els.cadEditorMoveDy.value = '0'; }
});
els.cadEditorSaveLandButton.addEventListener('click', saveCadEditorLand);
els.cadEditorCanvas.addEventListener('wheel', (event) => { event.preventDefault(); const point = cadEditorCanvasPoint(event); zoomCadEditorAt(event.deltaY < 0 ? 1.16 : 1 / 1.16, point.x, point.y); }, { passive: false });
els.cadEditorCanvas.addEventListener('pointerdown', cadEditorPointerDown);
els.cadEditorCanvas.addEventListener('pointermove', cadEditorPointerMove);
els.cadEditorCanvas.addEventListener('pointerup', cadEditorPointerUp);
els.cadEditorCanvas.addEventListener('pointercancel', cadEditorPointerCancel);
els.cadEditorCanvas.addEventListener('contextmenu', openCadEditorContextMenu);
document.addEventListener?.('pointerdown', (event) => { if (!event.target.closest?.('#cadEditorContextMenu')) hideCadEditorContextMenu(); });
els.cadEditorCanvas.addEventListener('dblclick', () => { const selected = cadEditorSelectedComponents(); if (selected.length) fitCadEditorView(selected); });
els.activeCadSelect.addEventListener('change', () => { if (els.activeCadSelect.value) activateCad(els.activeCadSelect.value); });
els.componentSelect.addEventListener('change', () => { state.selectedComponentId = els.componentSelect.value; state.selected = null; state.preview = null; state.page = 1; state.duplicateView.selectedName = ''; resetHistogramState(); clearDetails(); refreshDuplicateControls(); updateStats(); renderTable(); renderTeachPanel(); fitView(); renderHistogram(); renderDetailedHistogram(); });
els.cadCompareOverlayToggle.addEventListener('change', () => { state.cadCompare.overlayEnabled = els.cadCompareOverlayToggle.checked; draw(); });
els.histogramBins.addEventListener('change', renderHistogram);
els.expandHistogramButton.addEventListener('click', openDetailedHistogram);
els.measurementHistogram.addEventListener('click', openDetailedHistogram);
els.closeHistogramButton.addEventListener('click', closeDetailedHistogram);
els.histogramOverlay.addEventListener('click', (event) => { if (event.target === els.histogramOverlay) closeDetailedHistogram(); });
els.detailedHistogramBins.addEventListener('change', () => { state.histogram.selectedBin = null; renderDetailedHistogram(); });
els.histogramYMode.addEventListener('change', renderDetailedHistogram);
els.applyHistogramRangeButton.addEventListener('click', applyHistogramRangeFromInputs);
els.resetHistogramRangeButton.addEventListener('click', resetHistogramRange);
els.zoomHistogramBinButton.addEventListener('click', zoomToSelectedHistogramBin);
els.exportHistogramButton.addEventListener('click', exportHistogramCsv);
els.histogramCadFilter.addEventListener('change', () => { state.histogram.filterEnabled = els.histogramCadFilter.checked; draw(); });
els.detailedHistogramCanvas.addEventListener('pointerdown', (event) => {
  const point = detailedHistogramPoint(event); const layout = state.histogram.layout;
  if (!layout || point.x < layout.margin.left || point.x > layout.margin.left + layout.chartW || point.y < layout.margin.top || point.y > layout.margin.top + layout.chartH) return;
  els.detailedHistogramCanvas.setPointerCapture(event.pointerId); state.histogram.drag = { startX: point.x, currentX: point.x, pointerId: event.pointerId };
});
els.detailedHistogramCanvas.addEventListener('pointermove', (event) => {
  const point = detailedHistogramPoint(event);
  if (state.histogram.drag) { state.histogram.drag.currentX = point.x; renderDetailedHistogram(); return; }
  const binIndex = histogramBinAtPoint(point);
  if (binIndex !== state.histogram.hoveredBin) { state.histogram.hoveredBin = binIndex; renderDetailedHistogram(); }
  showDetailedHistogramTooltip(event, binIndex);
});
els.detailedHistogramCanvas.addEventListener('pointerup', (event) => {
  const drag = state.histogram.drag; if (!drag) return;
  const point = detailedHistogramPoint(event); state.histogram.drag = null; els.histogramSelectionLabel.classList.add('hidden');
  if (Math.abs(point.x - drag.startX) < 5) {
    const binIndex = histogramBinAtPoint(point); state.histogram.selectedBin = binIndex; renderDetailedHistogram(); showDetailedHistogramTooltip(event, binIndex); return;
  }
  const layout = state.histogram.layout; if (!layout) return;
  const low = histogramValueAtX(Math.min(drag.startX, point.x), layout); const high = histogramValueAtX(Math.max(drag.startX, point.x), layout); setHistogramRange(low, high);
});
els.detailedHistogramCanvas.addEventListener('pointercancel', () => { state.histogram.drag = null; els.histogramSelectionLabel.classList.add('hidden'); renderDetailedHistogram(); });
els.detailedHistogramCanvas.addEventListener('pointerleave', () => { if (!state.histogram.drag) { state.histogram.hoveredBin = null; els.histogramTooltip.classList.add('hidden'); renderDetailedHistogram(); } });
els.detailedHistogramCanvas.addEventListener('wheel', (event) => {
  event.preventDefault(); const layout = state.histogram.layout; if (!layout?.values?.length) return;
  const point = detailedHistogramPoint(event); const ratio = Math.max(0, Math.min(1, (point.x - layout.margin.left) / layout.chartW));
  const fullSpan = layout.fullMax - layout.fullMin || 1; const currentSpan = layout.rangeMax - layout.rangeMin || fullSpan;
  let newSpan = currentSpan * (event.deltaY < 0 ? 0.72 : 1.38); newSpan = Math.max(fullSpan / 100000, Math.min(fullSpan, newSpan));
  if (newSpan >= fullSpan * 0.999999) { resetHistogramRange(); return; }
  const centerValue = layout.rangeMin + ratio * currentSpan; let min = centerValue - ratio * newSpan; let max = min + newSpan;
  if (min < layout.fullMin) { max += layout.fullMin - min; min = layout.fullMin; } if (max > layout.fullMax) { min -= max - layout.fullMax; max = layout.fullMax; }
  setHistogramRange(min, max);
}, { passive: false });
els.heatmapToggle.addEventListener('change', draw); els.labelToggle.addEventListener('change', draw);
els.duplicateToggle.addEventListener('change', () => { state.duplicateView.enabled = els.duplicateToggle.checked; els.duplicateOnlyToggle.disabled = !state.duplicateView.enabled || duplicateGroupsForComponent().size === 0; draw(); });
els.duplicateOnlyToggle.addEventListener('change', () => { state.duplicateView.dimOthers = els.duplicateOnlyToggle.checked; draw(); });
els.duplicateNameSelect.addEventListener('change', () => setSelectedDuplicateName(els.duplicateNameSelect.value, { fit: Boolean(els.duplicateNameSelect.value) }));
els.fitDuplicateButton.addEventListener('click', fitDuplicateGroup);
els.clearDuplicateButton.addEventListener('click', () => setSelectedDuplicateName(''));
els.fitButton.addEventListener('click', fitView); els.zoomInButton.addEventListener('click', () => zoomAt(1.3)); els.zoomOutButton.addEventListener('click', () => zoomAt(1 / 1.3));
els.searchButton.addEventListener('click', search); els.searchInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') search(); });
els.tableFilter.addEventListener('change', () => { state.filter = els.tableFilter.value; state.page = 1; renderTable(); }); els.prevPage.addEventListener('click', () => { state.page -= 1; renderTable(); }); els.nextPage.addEventListener('click', () => { state.page += 1; renderTable(); });
els.exportCsvButton.addEventListener('click', exportCsv); els.exportExcelButton.addEventListener('click', openComponentReport); els.exportJsonButton.addEventListener('click', exportJson);

els.closeComponentReportButton.addEventListener('click', closeComponentReport);
els.cancelComponentReportButton.addEventListener('click', closeComponentReport);
els.componentReportOverlay.addEventListener('click', (event) => { if (event.target === els.componentReportOverlay) closeComponentReport(); });
for (const control of [els.componentReportScope, els.componentReportZones, els.componentReportLabels, els.componentReportNameSource, els.componentReportResolution, els.componentReportHeatmap]) control.addEventListener('change', updateComponentReportPreview);
els.generateComponentReportButton.addEventListener('click', generateComponentReport);
els.manualButton.addEventListener('click', () => setEditMode(!state.edit.enabled));
els.exitEditButton.addEventListener('click', () => setEditMode(false));
els.editPrevButton.addEventListener('click', () => advanceSelected(-1));
els.editNextButton.addEventListener('click', () => advanceSelected(1));
els.editAutoNext.addEventListener('change', () => { state.edit.autoNext = els.editAutoNext.checked; updateEditPanel(); });
els.editLockConfirmed.addEventListener('change', () => { state.edit.lockConfirmed = els.editLockConfirmed.checked; updateEditPanel(); });
els.teachButton.addEventListener('click', openTeachPanel); els.undoButton.addEventListener('click', undo); els.redoButton.addEventListener('click', redo); els.anchorButton.addEventListener('click', toggleAnchor); els.unmapButton.addEventListener('click', unmapSelected); els.nudgePrevButton.addEventListener('click', () => nudgeSelected(-1)); els.nudgeNextButton.addEventListener('click', () => nudgeSelected(1));
els.saveAliasButton.addEventListener('click', () => { if (!state.selected) return; const before = snapshotMapping(state.selected); const after = { ...before, alias: els.aliasInput.value.trim() }; applyTransaction('Edit note', [{ mapping: state.selected, before, after }]); toast('บันทึกหมายเหตุแล้ว'); });
els.copyRawButton.addEventListener('click', async () => { await navigator.clipboard.writeText(els.rawData.textContent); toast('คัดลอกข้อมูลต้นทางแล้ว'); });
els.closeTeachButton.addEventListener('click', closeTeachPanel); els.teachOverlay.addEventListener('click', (event) => { if (event.target === els.teachOverlay) closeTeachPanel(); }); els.clearAnchorsButton.addEventListener('click', clearAllAnchors); els.previewPatternButton.addEventListener('click', () => createPatternPreview()); els.fillBetweenButton.addEventListener('click', previewBetweenAnchors); els.clearPreviewButton.addEventListener('click', clearPreview); els.applyPatternButton.addEventListener('click', () => applyPattern(false)); els.applyHighButton.addEventListener('click', () => applyPattern(true));
els.previewForwardButton.addEventListener('click', () => { els.patternStart.value = ''; els.patternEnd.value = ''; createPatternPreview({ direction: 'forward' }); });
els.previewReverseButton.addEventListener('click', () => { els.patternStart.value = ''; els.patternEnd.value = ''; createPatternPreview({ direction: 'reverse' }); });
els.shiftAllPrevButton.addEventListener('click', () => shiftCurrentMappings(-1)); els.shiftAllNextButton.addEventListener('click', () => shiftCurrentMappings(1)); els.unmapRangeButton.addEventListener('click', unmapRange);
els.canvas.addEventListener('wheel', (event) => { event.preventDefault(); const point = getCanvasPoint(event); zoomAt(event.deltaY < 0 ? 1.16 : 1 / 1.16, point.x, point.y); }, { passive: false });
els.canvas.addEventListener('pointerdown', (event) => { els.canvas.setPointerCapture(event.pointerId); state.dragging = true; state.lastPointer = getCanvasPoint(event); state.dragStart = { ...state.lastPointer }; });
els.canvas.addEventListener('pointermove', (event) => { const point = getCanvasPoint(event); if (state.dragging && state.lastPointer) { state.view.offsetX += point.x - state.lastPointer.x; state.view.offsetY += point.y - state.lastPointer.y; state.lastPointer = point; draw(); els.tooltip.classList.add('hidden'); return; } state.hoveredLand = findNearestLand(point.x, point.y); showTooltip(event, state.hoveredLand); });
els.canvas.addEventListener('pointerup', (event) => { const point = getCanvasPoint(event); const moved = state.dragStart ? Math.hypot(point.x - state.dragStart.x, point.y - state.dragStart.y) : 0; state.dragging = false; state.lastPointer = null; state.dragStart = null; if (moved < 4) selectLand(findNearestLand(point.x, point.y)); });
els.canvas.addEventListener('pointercancel', () => { state.dragging = false; state.lastPointer = null; state.dragStart = null; }); els.canvas.addEventListener('pointerleave', () => els.tooltip.classList.add('hidden'));
els.globalErrorClose?.addEventListener('click', closeGlobalError);
els.globalErrorCopy?.addEventListener('click', copyCurrentDiagnostic);
els.globalErrorDownload?.addEventListener('click', downloadCurrentDiagnostic);
els.globalErrorOverlay?.addEventListener('click', (event) => { if (event.target === els.globalErrorOverlay) closeGlobalError(); });
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !els.globalErrorOverlay?.classList.contains('hidden')) {
    event.preventDefault(); event.stopImmediatePropagation(); closeGlobalError();
  }
}, true);
window.addEventListener('error', (event) => {
  if (!event.error) return;
  console.error('Global error', event.error);
  showGlobalError(event.error, { title: 'เกิดข้อผิดพลาดที่ไม่คาดคิด', operation: 'global-error' });
});
window.addEventListener('unhandledrejection', (event) => {
  const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason || 'Unhandled promise rejection'));
  console.error('Unhandled rejection', error);
  showGlobalError(error, { title: 'งานเบื้องหลังล้มเหลว', operation: 'unhandled-promise' });
});
window.addEventListener('keydown', (event) => { if (event.key === 'Escape' && appConfirmPending) { event.preventDefault(); closeAppConfirm(false); return; } if (handleCadEditorKeyboard(event)) return; const tag = document.activeElement?.tagName; if (['INPUT', 'SELECT', 'TEXTAREA'].includes(tag)) return; if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); } if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); } if (state.edit.enabled && event.key === 'ArrowLeft') { event.preventDefault(); advanceSelected(-1); } if (state.edit.enabled && event.key === 'ArrowRight') { event.preventDefault(); advanceSelected(1); } if (event.key === 'Escape') { setEditMode(false); closeTeachPanel(); closeDetailedHistogram(); closeCadInspector(); closeComponentReport(); closeStorageManager(); } });
window.addEventListener('keyup', (event) => { if (event.code === 'Space') { state.cadEditor.visual.spaceDown = false; if (state.cadEditor.visual.tool !== 'pan') els.cadEditorCanvas.classList.remove('pan-tool'); } });
window.addEventListener('resize', repositionOpenCadEditorMenu, { passive: true });
window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); state.installPrompt = event; els.installButton.classList.remove('hidden'); });
els.installButton.addEventListener('click', async () => { if (!state.installPrompt) return; state.installPrompt.prompt(); await state.installPrompt.userChoice; state.installPrompt = null; els.installButton.classList.add('hidden'); });
let reloadingForServiceWorkerUpdate = false;
function showServiceWorkerUpdate(registration) {
  state.serviceWorkerRegistration = registration;
  els.appUpdateButton.classList.toggle('hidden', !registration?.waiting);
}
els.appUpdateButton.addEventListener('click', () => {
  const waiting = state.serviceWorkerRegistration?.waiting;
  if (!waiting) return;
  els.appUpdateButton.disabled = true;
  waiting.postMessage({ type: 'SKIP_WAITING' });
});
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadingForServiceWorkerUpdate) return;
    reloadingForServiceWorkerUpdate = true;
    location.reload();
  });
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'SW_ACTIVATED') { els.appUpdateButton.classList.add('hidden'); els.appUpdateButton.disabled = false; }
  });
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
      state.serviceWorkerRegistration = registration;
      if (registration.waiting && navigator.serviceWorker.controller) showServiceWorkerUpdate(registration);
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) showServiceWorkerUpdate(registration);
        });
      });
      await registration.update();
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') registration.update().catch((error) => console.warn('Service Worker update check failed', error)); });
    } catch (error) {
      console.warn('Service Worker registration failed', error);
    }
  });
}
const resizeObserver = new ResizeObserver(resizeCanvas);
resizeObserver.observe(els.canvas);
resizeObserver.observe(els.measurementHistogram);
resizeObserver.observe(els.detailedHistogramCanvas);
resizeObserver.observe(els.cadEditorCanvas);
loadBuildInformation();
resetProject();
refreshRecoveryNotice().catch((error) => console.warn('Recovery initialization failed', error));

export {
  state,
  resetCadEditorHistory,
  beginCadEditorHistory,
  commitCadEditorHistory,
  undoCadEditor,
  redoCadEditor,
  runCadEditorCommand,
  commitCadEditorToProject,
  syncMappingRowsFromActiveCad,
  applyCadNamesToProject,
  syncCadNamesToEditorModel,
};
