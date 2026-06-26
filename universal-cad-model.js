import { normalizeRotation } from './coordinate-transform.js';
export { normalizeRotation } from './coordinate-transform.js';
export const UNIVERSAL_CAD_SCHEMA_VERSION = 2;
export const DEFAULT_UNITS = 'mm';

function randomId(prefix = 'id') {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `${prefix}:${uuid}`;
  return `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
}


export function cloneCadValue(value) {
  if (value == null || typeof value !== 'object') return value;
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return value.slice(0);
  if (ArrayBuffer.isView(value)) return new value.constructor(value);
  if (value instanceof Date) return new Date(value.getTime());
  if (value instanceof Map) return new Map([...value].map(([key, item]) => [cloneCadValue(key), cloneCadValue(item)]));
  if (value instanceof Set) return new Set([...value].map(cloneCadValue));
  if (Array.isArray(value)) return value.map(cloneCadValue);
  const output = {};
  for (const [key, item] of Object.entries(value)) output[key] = cloneCadValue(item);
  return output;
}

export function immutableSourceRecord({ name = 'source', format = 'unknown', mimeType = '', text = null, bytes = null, metadata = {} } = {}) {
  const sourceBytes = bytes == null ? null : bytes instanceof Uint8Array ? new Uint8Array(bytes) : new Uint8Array(bytes);
  const record = {
    id: randomId('source'),
    name: String(name || 'source'),
    format: String(format || 'unknown'),
    mimeType: String(mimeType || ''),
    importedAt: new Date().toISOString(),
    size: sourceBytes?.byteLength ?? (text == null ? 0 : new TextEncoder().encode(String(text)).byteLength),
    text: text == null ? null : String(text),
    bytes: sourceBytes,
    metadata: Object.freeze({ ...metadata }),
    immutable: true,
  };
  return Object.freeze(record);
}

function packageIdFor(name, revision = '') {
  return `package:${String(name || 'UNASSIGNED').trim() || 'UNASSIGNED'}:${String(revision || '').trim()}`;
}

function rectGeometry(land) {
  const left = Number(land?.left);
  const top = Number(land?.top);
  const width = Number(land?.width);
  const height = Number(land?.length);
  return {
    type: 'rectangle',
    left: Number.isFinite(left) ? left : null,
    top: Number.isFinite(top) ? top : null,
    width: Number.isFinite(width) ? width : null,
    height: Number.isFinite(height) ? height : null,
    rotation: normalizeRotation(land?.rotation || 0),
    points: [],
    holes: [],
  };
}

export function normalizeLegacyCad(legacyCad, options = {}) {
  const revision = Number(options.revision || 0);
  const projectId = String(options.projectId || randomId('project'));
  const components = [];
  const lands = [];
  const packagesById = new Map();
  const packageUsage = new Map();

  for (const sourceComponent of legacyCad?.components || []) {
    const componentId = String(sourceComponent.id ?? randomId('component'));
    const packageId = packageIdFor(sourceComponent.packageName, sourceComponent.revision);
    if (!packagesById.has(packageId)) {
      packagesById.set(packageId, {
        id: packageId,
        name: String(sourceComponent.packageName || ''),
        revision: String(sourceComponent.revision || ''),
        origin: { x: 0, y: 0 },
        pin1: null,
        polarity: null,
        templateLandIds: [],
        sourceComponentId: componentId,
        metadata: {},
      });
    }
    packageUsage.set(packageId, (packageUsage.get(packageId) || 0) + 1);
    const componentLandIds = [];
    for (const sourceLand of sourceComponent.lands || []) {
      const landId = `land:${componentId}:${String(sourceLand.globalId ?? sourceLand.localIndex ?? componentLandIds.length + 1)}`;
      componentLandIds.push(landId);
      lands.push({
        id: landId,
        componentId,
        packageId,
        globalId: sourceLand.globalId ?? null,
        localIndex: sourceLand.localIndex ?? componentLandIds.length,
        name: String(sourceLand.cadName || ''),
        pinId: null,
        side: String(sourceLand.side || ''),
        geometry: rectGeometry(sourceLand),
        center: {
          x: Number.isFinite(Number(sourceLand.centerX)) ? Number(sourceLand.centerX) : null,
          y: Number.isFinite(Number(sourceLand.centerY)) ? Number(sourceLand.centerY) : null,
        },
        metadata: {},
      });
      const packageRecord = packagesById.get(packageId);
      if (packageRecord.sourceComponentId === componentId) packageRecord.templateLandIds.push(landId);
    }
    components.push({
      id: componentId,
      reference: String(sourceComponent.name || componentId),
      packageId,
      partNumber: '',
      revision: String(sourceComponent.revision || ''),
      position: {
        x: Number.isFinite(Number(sourceComponent.centerX)) ? Number(sourceComponent.centerX) : null,
        y: Number.isFinite(Number(sourceComponent.centerY)) ? Number(sourceComponent.centerY) : null,
      },
      rotation: normalizeRotation(sourceComponent.angle),
      side: String(sourceComponent.side || ''),
      landIds: componentLandIds,
      boardId: 'board:main',
      panelInstanceId: null,
      metadata: sourceComponent.inferred ? { inferred: true } : {},
    });
  }

  const packages = [...packagesById.values()].map((item) => ({ ...item, usageCount: packageUsage.get(item.id) || 0 }));
  const board = legacyCad?.board || {};
  return {
    schemaVersion: UNIVERSAL_CAD_SCHEMA_VERSION,
    projectId,
    revision,
    sourceFormat: String(options.sourceFormat || 'inspection-xml'),
    units: String(options.units || DEFAULT_UNITS),
    coordinateSystem: {
      units: String(options.units || DEFAULT_UNITS),
      origin: { x: Number(board.MinX ?? board.minX ?? 0) || 0, y: Number(board.MinY ?? board.minY ?? 0) || 0 },
      xDirection: 'right',
      yDirection: 'up',
      rotationConvention: 'counter-clockwise',
    },
    transformations: [],
    boardDefinition: {
      id: 'board:main',
      name: String(board.Name || board.name || 'Board'),
      width: Number.isFinite(Number(board.Width ?? board.width)) ? Number(board.Width ?? board.width) : null,
      height: Number.isFinite(Number(board.Height ?? board.height)) ? Number(board.Height ?? board.height) : null,
      thickness: Number.isFinite(Number(board.Thickness ?? board.thickness)) ? Number(board.Thickness ?? board.thickness) : null,
      profile: null,
      metadata: cloneCadValue(board),
    },
    panelDefinition: null,
    panelInstances: [],
    layers: [],
    components,
    packages,
    lands,
    pins: [],
    nets: [],
    holes: [],
    fiducials: [],
    bom: [],
    metadata: { importedComponentCount: components.length, importedLandCount: lands.length },
    validationIssues: [],
  };
}

export function universalCadToLegacy(model) {
  const landsByComponent = new Map();
  for (const land of model?.lands || []) {
    if (!landsByComponent.has(String(land.componentId))) landsByComponent.set(String(land.componentId), []);
    const geometry = land.geometry || {};
    const left = Number.isFinite(Number(geometry.left)) ? Number(geometry.left) : null;
    const top = Number.isFinite(Number(geometry.top)) ? Number(geometry.top) : null;
    const width = Number.isFinite(Number(geometry.width)) ? Number(geometry.width) : null;
    const length = Number.isFinite(Number(geometry.height)) ? Number(geometry.height) : null;
    landsByComponent.get(String(land.componentId)).push({
      globalId: land.globalId ?? null,
      componentId: String(land.componentId),
      cadName: String(land.name || ''),
      side: String(land.side || ''),
      left, top, width, length,
      centerX: Number.isFinite(Number(land.center?.x)) ? Number(land.center.x) : (left != null && width != null ? left + width / 2 : left),
      centerY: Number.isFinite(Number(land.center?.y)) ? Number(land.center.y) : (top != null && length != null ? top - length / 2 : top),
      localIndex: land.localIndex ?? null,
    });
  }
  const packageById = new Map((model?.packages || []).map((item) => [String(item.id), item]));
  const components = (model?.components || []).map((component) => {
    const componentLands = landsByComponent.get(String(component.id)) || [];
    componentLands.sort((a, b) => Number(a.localIndex || 0) - Number(b.localIndex || 0));
    componentLands.forEach((land, index) => { land.localIndex = index + 1; });
    const packageRecord = packageById.get(String(component.packageId));
    return {
      id: String(component.id),
      name: String(component.reference || component.id),
      packageName: String(packageRecord?.name || ''),
      revision: String(component.revision || packageRecord?.revision || ''),
      centerX: component.position?.x ?? null,
      centerY: component.position?.y ?? null,
      angle: normalizeRotation(component.rotation),
      lands: componentLands,
    };
  });
  const componentById = new Map(components.map((component) => [String(component.id), component]));
  return {
    board: cloneCadValue(model?.boardDefinition?.metadata || {
      Name: model?.boardDefinition?.name,
      Width: model?.boardDefinition?.width,
      Height: model?.boardDefinition?.height,
      Thickness: model?.boardDefinition?.thickness,
    }),
    components,
    componentById,
    totalLands: components.reduce((sum, item) => sum + item.lands.length, 0),
    sourceSize: Number(model?.metadata?.sourceSize || 0),
  };
}

export function createUniversalProject({ name = 'Untitled CAD Project', sourceFiles = [], parsedModel = null, projectId = null } = {}) {
  const id = String(projectId || parsedModel?.projectId || randomId('project'));
  const initialModel = parsedModel ? cloneCadValue({ ...parsedModel, projectId: id, revision: 0 }) : normalizeLegacyCad(null, { projectId: id });
  const createdAt = new Date().toISOString();
  return {
    schemaVersion: UNIVERSAL_CAD_SCHEMA_VERSION,
    projectId: id,
    name: String(name || 'Untitled CAD Project'),
    createdAt,
    updatedAt: createdAt,
    sourceFiles: [...sourceFiles],
    parsedSourceModel: cloneCadValue(initialModel),
    workingModel: cloneCadValue(initialModel),
    appliedRevision: 0,
    currentModel: cloneCadValue(initialModel),
    revisions: [{ number: 0, createdAt, model: cloneCadValue(initialModel), changeSetId: null, validationStatus: 'not-run' }],
    changeSets: [],
    exportSnapshots: [],
    acceptedWarnings: [],
    recovery: { complete: true, revision: 0 },
    metadata: {},
  };
}

export function migrateProject(input) {
  if (!input) throw new Error('ไม่มีข้อมูล Project สำหรับ Migration');
  if (Number(input.schemaVersion) === UNIVERSAL_CAD_SCHEMA_VERSION && input.currentModel) return cloneCadValue(input);
  if (input.xmlData || input.components || input.board) {
    const legacyCad = input.xmlData || input;
    const model = normalizeLegacyCad(legacyCad, { projectId: input.projectId, revision: Number(input.revision || 0), sourceFormat: input.sourceFormat });
    return createUniversalProject({ name: input.name || 'Migrated CAD Project', parsedModel: model, projectId: model.projectId });
  }
  throw new Error(`ไม่รองรับ Project schema ${String(input.schemaVersion ?? 'unknown')}`);
}

export function createExportSnapshot(project, { exportFormat, sourceFormat = null, validationStatus = 'not-run', acceptedWarnings = [], payload = null } = {}) {
  const snapshot = {
    id: randomId('export'),
    projectId: project.projectId,
    revisionNumber: Number(project.appliedRevision || 0),
    exportTime: new Date().toISOString(),
    sourceFormat: String(sourceFormat || project.currentModel?.sourceFormat || 'unknown'),
    exportFormat: String(exportFormat || 'unknown'),
    validationStatus: String(validationStatus || 'not-run'),
    acceptedWarnings: cloneCadValue(acceptedWarnings),
    model: cloneCadValue(project.currentModel),
    payload: payload == null ? null : cloneCadValue(payload),
  };
  project.exportSnapshots.push(snapshot);
  return snapshot;
}
