import { cloneCadValue, normalizeRotation } from './universal-cad-model.js';
import { GeometryError, TransactionError, ValidationError } from './cad-errors.js';
import { mergeRectangles, rectangleDifference, splitRectangle } from './geometry.js';

function nowIso() { return new Date().toISOString(); }
function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new ValidationError(`${label} ต้องเป็นตัวเลขที่ถูกต้อง`, { stage: 'validate-transaction', context: { value } });
  return number;
}
function nonEmpty(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new ValidationError(`${label} ห้ามว่าง`, { stage: 'validate-transaction' });
  return text;
}
function entityIndex(items, id, label) {
  const index = (items || []).findIndex((item) => String(item.id) === String(id));
  if (index < 0) throw new TransactionError(`ไม่พบ ${label} ${String(id)}`, { stage: 'resolve-entity', context: { id } });
  return index;
}
function replaceAt(items, index, value) {
  const next = items.slice(); next[index] = value; return next;
}
function removeAt(items, index) {
  const next = items.slice(); next.splice(index, 1); return next;
}
function uniqueId(items, preferred) {
  const used = new Set((items || []).map((item) => String(item.id)));
  let candidate = String(preferred || `id:${Date.now().toString(36)}`);
  let suffix = 2;
  while (used.has(candidate)) candidate = `${preferred || 'id'}:${suffix++}`;
  return candidate;
}
function landGeometry(land) {
  const geometry = land?.geometry || {};
  const width = finite(geometry.width, 'Land width');
  const height = finite(geometry.height, 'Land height');
  if (width <= 0 || height <= 0) throw new GeometryError('Land ต้องมีขนาดมากกว่า 0', { stage: 'validate-geometry', context: { landId: land?.id, width, height } });
  return { ...geometry, width, height, rotation: normalizeRotation(geometry.rotation) };
}

export function validateTransactionModel(model) {
  if (!model || typeof model !== 'object') throw new ValidationError('Universal CAD Model ไม่พร้อม', { stage: 'validate-model' });
  const ids = new Set();
  for (const collection of ['components', 'packages', 'lands', 'panelInstances']) {
    for (const item of model[collection] || []) {
      const id = nonEmpty(item?.id, `${collection}.id`);
      if (ids.has(id)) throw new ValidationError(`Entity ID ซ้ำ: ${id}`, { stage: 'validate-model', context: { collection, id } });
      ids.add(id);
    }
  }
  const componentIds = new Set((model.components || []).map((item) => String(item.id)));
  const packageIds = new Set((model.packages || []).map((item) => String(item.id)));
  for (const component of model.components || []) {
    if (component.packageId && !packageIds.has(String(component.packageId))) throw new ValidationError(`Component ${component.reference || component.id} อ้าง Package ที่ไม่มี`, { stage: 'validate-model' });
  }
  for (const land of model.lands || []) {
    if (!componentIds.has(String(land.componentId))) throw new ValidationError(`Land ${land.id} อ้าง Component ที่ไม่มี`, { stage: 'validate-model' });
    if (!packageIds.has(String(land.packageId))) throw new ValidationError(`Land ${land.id} อ้าง Package ที่ไม่มี`, { stage: 'validate-model' });
    landGeometry(land);
  }
  return true;
}

function result(model, inverse, change) { return { model, inverse, change: { timestamp: nowIso(), ...change } }; }

function landScopeSnapshot(model, componentId) {
  const componentIndex = entityIndex(model.components, componentId, 'Component');
  return {
    componentId: String(componentId),
    component: cloneCadValue(model.components[componentIndex]),
    lands: (model.lands || []).filter((land) => String(land.componentId) === String(componentId)).map(cloneCadValue),
  };
}
function restoreLandScope(model, snapshot) {
  const componentIndex = entityIndex(model.components, snapshot.componentId, 'Component');
  const otherLands = (model.lands || []).filter((land) => String(land.componentId) !== String(snapshot.componentId));
  return { ...model, components: replaceAt(model.components, componentIndex, cloneCadValue(snapshot.component)), lands: [...otherLands, ...snapshot.lands.map(cloneCadValue)] };
}

const handlers = {
  'rename-component'(model, command) {
    const index = entityIndex(model.components, command.componentId, 'Component');
    const before = model.components[index];
    const reference = nonEmpty(command.reference, 'Reference');
    const next = { ...before, reference };
    return result({ ...model, components: replaceAt(model.components, index, next) }, { type: 'rename-component', componentId: before.id, reference: before.reference }, { type: command.type, entityId: before.id, before: before.reference, after: reference });
  },
  'move-component'(model, command) {
    const index = entityIndex(model.components, command.componentId, 'Component');
    const before = model.components[index];
    const x = command.absolute ? finite(command.x, 'X') : finite(before.position?.x || 0, 'Current X') + finite(command.dx || 0, 'dX');
    const y = command.absolute ? finite(command.y, 'Y') : finite(before.position?.y || 0, 'Current Y') + finite(command.dy || 0, 'dY');
    const next = { ...before, position: { x, y } };
    return result({ ...model, components: replaceAt(model.components, index, next) }, { type: 'move-component', componentId: before.id, absolute: true, x: before.position?.x || 0, y: before.position?.y || 0 }, { type: command.type, entityId: before.id, before: before.position, after: next.position });
  },
  'rotate-component'(model, command) {
    const index = entityIndex(model.components, command.componentId, 'Component');
    const before = model.components[index];
    const rotation = normalizeRotation(command.absolute ? command.rotation : Number(before.rotation || 0) + finite(command.delta || 0, 'Rotation delta'));
    return result({ ...model, components: replaceAt(model.components, index, { ...before, rotation }) }, { type: 'rotate-component', componentId: before.id, absolute: true, rotation: before.rotation || 0 }, { type: command.type, entityId: before.id, before: before.rotation || 0, after: rotation });
  },
  'change-side'(model, command) {
    const index = entityIndex(model.components, command.componentId, 'Component');
    const before = model.components[index];
    const side = nonEmpty(command.side, 'Side').toLowerCase();
    if (!['top', 'bottom', 'unknown'].includes(side)) throw new ValidationError(`Side ไม่ถูกต้อง: ${side}`, { stage: 'validate-transaction' });
    return result({ ...model, components: replaceAt(model.components, index, { ...before, side }) }, { type: 'change-side', componentId: before.id, side: before.side || 'unknown' }, { type: command.type, entityId: before.id, before: before.side, after: side });
  },
  'change-package'(model, command) {
    const index = entityIndex(model.components, command.componentId, 'Component');
    entityIndex(model.packages, command.packageId, 'Package');
    const before = model.components[index];
    const packageId = String(command.packageId);
    let lands = model.lands;
    if (command.updateLands !== false) lands = lands.map((land) => String(land.componentId) === String(before.id) ? { ...land, packageId } : land);
    return result({ ...model, components: replaceAt(model.components, index, { ...before, packageId }), lands }, { type: 'change-package', componentId: before.id, packageId: before.packageId, updateLands: command.updateLands }, { type: command.type, entityId: before.id, before: before.packageId, after: packageId });
  },
  'add-land'(model, command) {
    const componentIndex = entityIndex(model.components, command.componentId, 'Component');
    const component = model.components[componentIndex];
    const packageId = String(command.packageId || component.packageId);
    entityIndex(model.packages, packageId, 'Package');
    const id = uniqueId(model.lands, command.land?.id || `land:${component.id}:new`);
    const land = {
      id, componentId: String(component.id), packageId,
      globalId: command.land?.globalId ?? null,
      localIndex: command.land?.localIndex ?? (component.landIds?.length || 0) + 1,
      name: String(command.land?.name || ''), pinId: command.land?.pinId || null,
      side: String(command.land?.side || component.side || 'unknown'),
      geometry: { type: 'rectangle', left: 0, top: 0, width: 1, height: 1, rotation: 0, points: [], holes: [], ...(cloneCadValue(command.land?.geometry) || {}) },
      center: cloneCadValue(command.land?.center || { x: 0.5, y: -0.5 }), metadata: cloneCadValue(command.land?.metadata || {}),
    };
    land.geometry = landGeometry(land);
    const nextComponent = { ...component, landIds: [...(component.landIds || []), id] };
    return result({ ...model, lands: [...(model.lands || []), land], components: replaceAt(model.components, componentIndex, nextComponent) }, { type: 'delete-land', landId: id }, { type: command.type, entityId: id, after: cloneCadValue(land) });
  },
  'delete-land'(model, command) {
    const index = entityIndex(model.lands, command.landId, 'Land');
    const land = model.lands[index];
    const componentIndex = entityIndex(model.components, land.componentId, 'Component');
    const component = model.components[componentIndex];
    const nextComponent = { ...component, landIds: (component.landIds || []).filter((id) => String(id) !== String(land.id)) };
    return result({ ...model, lands: removeAt(model.lands, index), components: replaceAt(model.components, componentIndex, nextComponent) }, { type: 'restore-land', land: cloneCadValue(land), componentIndex, landIndex: index }, { type: command.type, entityId: land.id, before: cloneCadValue(land) });
  },
  'restore-land'(model, command) {
    const land = cloneCadValue(command.land);
    const componentIndex = entityIndex(model.components, land.componentId, 'Component');
    const component = model.components[componentIndex];
    const lands = model.lands.slice(); lands.splice(Math.min(Number(command.landIndex) || 0, lands.length), 0, land);
    const landIds = (component.landIds || []).slice(); landIds.splice(Math.min(Number(command.componentLandIndex) || landIds.length, landIds.length), 0, land.id);
    return result({ ...model, lands, components: replaceAt(model.components, componentIndex, { ...component, landIds }) }, { type: 'delete-land', landId: land.id }, { type: command.type, entityId: land.id });
  },
  'restore-land-scope'(model, command) {
    const current = landScopeSnapshot(model, command.snapshot.componentId);
    return result(restoreLandScope(model, command.snapshot), { type: 'restore-land-scope', snapshot: current }, { type: command.type, entityId: command.snapshot.componentId });
  },
  'split-land'(model, command) {
    const index = entityIndex(model.lands, command.landId, 'Land'); const before = model.lands[index];
    const snapshot = landScopeSnapshot(model, before.componentId);
    const pieces = splitRectangle(before.geometry, { axis: command.axis || 'auto', ratio: command.ratio ?? 0.5 });
    const secondId = uniqueId(model.lands, command.newLandId || `${before.id}:split`);
    const first = { ...before, geometry: pieces[0] };
    const second = { ...cloneCadValue(before), id: secondId, name: String(command.newName || `${before.name || 'LAND'}_B`), globalId: null, localIndex: Number(before.localIndex || 0) + 1, geometry: pieces[1] };
    const lands = replaceAt(model.lands, index, first); lands.splice(index + 1, 0, second);
    const componentIndex = entityIndex(model.components, before.componentId, 'Component'); const component = model.components[componentIndex];
    const landIds = [...(component.landIds || [])]; const idIndex = landIds.findIndex((id) => String(id) === String(before.id)); landIds.splice(idIndex + 1, 0, secondId);
    return result({ ...model, lands, components: replaceAt(model.components, componentIndex, { ...component, landIds }) }, { type: 'restore-land-scope', snapshot }, { type: command.type, entityId: before.id, createdIds: [secondId] });
  },
  'merge-lands'(model, command) {
    const ids = [...new Set(command.landIds || [])].map(String);
    if (ids.length < 2) throw new GeometryError('Merge ต้องเลือกอย่างน้อย 2 Land', { stage: 'merge-lands' });
    const selected = ids.map((id) => model.lands[entityIndex(model.lands, id, 'Land')]);
    const componentIds = new Set(selected.map((land) => String(land.componentId))); const packageIds = new Set(selected.map((land) => String(land.packageId))); const sides = new Set(selected.map((land) => String(land.side || '')));
    if (componentIds.size !== 1 || packageIds.size !== 1 || sides.size !== 1) throw new GeometryError('Merge ต้องเป็น Land ใน Component, Package และ Side เดียวกัน', { stage: 'merge-lands' });
    const componentId = selected[0].componentId; const snapshot = landScopeSnapshot(model, componentId); const mergedGeometry = mergeRectangles(selected.map((land) => land.geometry));
    const primary = { ...selected[0], geometry: mergedGeometry, name: String(command.name || selected[0].name || '') };
    const selectedIds = new Set(ids); const lands = model.lands.filter((land) => !selectedIds.has(String(land.id)) || String(land.id) === String(primary.id)).map((land) => String(land.id) === String(primary.id) ? primary : land);
    const componentIndex = entityIndex(model.components, componentId, 'Component'); const component = model.components[componentIndex];
    const landIds = (component.landIds || []).filter((id) => !selectedIds.has(String(id)) || String(id) === String(primary.id));
    return result({ ...model, lands, components: replaceAt(model.components, componentIndex, { ...component, landIds }) }, { type: 'restore-land-scope', snapshot }, { type: command.type, entityId: primary.id, removedIds: ids.filter((id) => id !== String(primary.id)) });
  },
  'boolean-difference-land'(model, command) {
    const index = entityIndex(model.lands, command.landId, 'Land'); const before = model.lands[index]; const snapshot = landScopeSnapshot(model, before.componentId);
    const pieces = rectangleDifference(before.geometry, command.cutter);
    const componentIndex = entityIndex(model.components, before.componentId, 'Component'); const component = model.components[componentIndex];
    let lands = model.lands.slice(); const createdIds = [];
    if (!pieces.length) {
      lands.splice(index, 1);
    } else {
      lands[index] = { ...before, geometry: pieces[0] };
      for (let i = 1; i < pieces.length; i += 1) { const id = uniqueId([...lands, ...createdIds.map((created) => ({ id: created }))], `${before.id}:difference:${i + 1}`); createdIds.push(id); lands.splice(index + i, 0, { ...cloneCadValue(before), id, globalId: null, name: `${before.name || 'LAND'}_${i + 1}`, geometry: pieces[i] }); }
    }
    const currentComponentLands = lands.filter((land) => String(land.componentId) === String(before.componentId));
    const components = replaceAt(model.components, componentIndex, { ...component, landIds: currentComponentLands.map((land) => land.id) });
    return result({ ...model, lands, components }, { type: 'restore-land-scope', snapshot }, { type: command.type, entityId: before.id, createdIds });
  },
  'set-package-origin'(model, command) {
    const index = entityIndex(model.packages, command.packageId, 'Package'); const before = model.packages[index]; const origin = { x: finite(command.x, 'Origin X'), y: finite(command.y, 'Origin Y') };
    return result({ ...model, packages: replaceAt(model.packages, index, { ...before, origin }) }, { type: 'set-package-origin', packageId: before.id, x: before.origin?.x || 0, y: before.origin?.y || 0 }, { type: command.type, entityId: before.id, before: before.origin, after: origin });
  },
  'set-package-pin1'(model, command) {
    const index = entityIndex(model.packages, command.packageId, 'Package'); const before = model.packages[index]; const pin1 = command.landId == null ? null : String(command.landId);
    if (pin1 != null && !(model.lands || []).some((land) => String(land.id) === pin1 && String(land.packageId) === String(before.id))) throw new ValidationError('Pin 1 ต้องอ้าง Land ใน Package เดียวกัน', { stage: 'set-package-pin1' });
    return result({ ...model, packages: replaceAt(model.packages, index, { ...before, pin1 }) }, { type: 'set-package-pin1', packageId: before.id, landId: before.pin1 }, { type: command.type, entityId: before.id, before: before.pin1, after: pin1 });
  },
  'set-package-polarity'(model, command) {
    const index = entityIndex(model.packages, command.packageId, 'Package'); const before = model.packages[index]; const polarity = command.polarity == null ? null : String(command.polarity);
    return result({ ...model, packages: replaceAt(model.packages, index, { ...before, polarity }) }, { type: 'set-package-polarity', packageId: before.id, polarity: before.polarity }, { type: command.type, entityId: before.id, before: before.polarity, after: polarity });
  },
  'renumber-pins'(model, command) {
    const componentIndex = entityIndex(model.components, command.componentId, 'Component'); const component = model.components[componentIndex]; const snapshot = landScopeSnapshot(model, component.id);
    let counter = Number(command.start || 1); const prefix = String(command.prefix || '');
    const lands = model.lands.map((land) => String(land.componentId) === String(component.id) ? { ...land, name: `${prefix}${counter++}` } : land);
    return result({ ...model, lands }, { type: 'restore-land-scope', snapshot }, { type: command.type, entityId: component.id, count: counter - Number(command.start || 1) });
  },
  'move-land'(model, command) {
    const index = entityIndex(model.lands, command.landId, 'Land');
    const before = model.lands[index]; const geometry = landGeometry(before);
    const dx = finite(command.dx || 0, 'dX'); const dy = finite(command.dy || 0, 'dY');
    const next = { ...before, geometry: { ...geometry, left: finite(geometry.left || 0, 'Left') + dx, top: finite(geometry.top || 0, 'Top') + dy }, center: { x: finite(before.center?.x || 0, 'Center X') + dx, y: finite(before.center?.y || 0, 'Center Y') + dy } };
    return result({ ...model, lands: replaceAt(model.lands, index, next) }, { type: 'move-land', landId: before.id, dx: -dx, dy: -dy }, { type: command.type, entityId: before.id, before: before.center, after: next.center });
  },
  'resize-land'(model, command) {
    const index = entityIndex(model.lands, command.landId, 'Land'); const before = model.lands[index]; const geometry = landGeometry(before);
    const width = finite(command.width, 'Width'); const height = finite(command.height, 'Height');
    if (width <= 0 || height <= 0) throw new GeometryError('Land width/height ต้องมากกว่า 0', { stage: 'resize-land' });
    const next = { ...before, geometry: { ...geometry, width, height } };
    return result({ ...model, lands: replaceAt(model.lands, index, next) }, { type: 'resize-land', landId: before.id, width: geometry.width, height: geometry.height }, { type: command.type, entityId: before.id, before: { width: geometry.width, height: geometry.height }, after: { width, height } });
  },
  'rotate-land'(model, command) {
    const index = entityIndex(model.lands, command.landId, 'Land'); const before = model.lands[index]; const geometry = landGeometry(before);
    const rotation = normalizeRotation(command.absolute ? command.rotation : geometry.rotation + finite(command.delta || 0, 'Rotation delta'));
    return result({ ...model, lands: replaceAt(model.lands, index, { ...before, geometry: { ...geometry, rotation } }) }, { type: 'rotate-land', landId: before.id, absolute: true, rotation: geometry.rotation }, { type: command.type, entityId: before.id, before: geometry.rotation, after: rotation });
  },
  'clone-package'(model, command) {
    const index = entityIndex(model.packages, command.packageId, 'Package'); const source = model.packages[index];
    const id = uniqueId(model.packages, command.newPackageId || `${source.id}:clone`);
    const clone = { ...cloneCadValue(source), id, name: String(command.name || `${source.name} Copy`), usageCount: 0 };
    return result({ ...model, packages: [...model.packages, clone] }, { type: 'delete-package', packageId: id }, { type: command.type, entityId: id, sourceId: source.id });
  },
  'delete-package'(model, command) {
    const index = entityIndex(model.packages, command.packageId, 'Package');
    if ((model.components || []).some((item) => String(item.packageId) === String(command.packageId))) throw new ValidationError('ลบ Package ที่ยังถูกใช้งานไม่ได้', { stage: 'delete-package' });
    const item = model.packages[index]; return result({ ...model, packages: removeAt(model.packages, index) }, { type: 'restore-package', package: cloneCadValue(item), index }, { type: command.type, entityId: item.id });
  },
  'restore-package'(model, command) {
    const packages = model.packages.slice(); packages.splice(Math.min(Number(command.index) || 0, packages.length), 0, cloneCadValue(command.package));
    return result({ ...model, packages }, { type: 'delete-package', packageId: command.package.id }, { type: command.type, entityId: command.package.id });
  },
  'split-component-new-package'(model, command) {
    const componentIndex = entityIndex(model.components, command.componentId, 'Component'); const component = model.components[componentIndex];
    const sourcePackageIndex = entityIndex(model.packages, component.packageId, 'Package'); const sourcePackage = model.packages[sourcePackageIndex];
    const newPackageId = uniqueId(model.packages, command.newPackageId || `${sourcePackage.id}:${component.reference}`);
    const newPackage = { ...cloneCadValue(sourcePackage), id: newPackageId, name: String(command.name || `${sourcePackage.name}-${component.reference}`), usageCount: 1 };
    const components = replaceAt(model.components, componentIndex, { ...component, packageId: newPackageId });
    const lands = model.lands.map((land) => String(land.componentId) === String(component.id) ? { ...land, packageId: newPackageId } : land);
    return result({ ...model, packages: [...model.packages, newPackage], components, lands }, { type: 'restore-component-package-and-delete', componentId: component.id, packageId: component.packageId, deletePackageId: newPackageId }, { type: command.type, entityId: component.id, before: component.packageId, after: newPackageId });
  },
  'restore-component-package-and-delete'(model, command) {
    const componentIndex = entityIndex(model.components, command.componentId, 'Component'); const component = model.components[componentIndex];
    const deleteIndex = entityIndex(model.packages, command.deletePackageId, 'Package');
    const components = replaceAt(model.components, componentIndex, { ...component, packageId: String(command.packageId) });
    const lands = model.lands.map((land) => String(land.componentId) === String(component.id) ? { ...land, packageId: String(command.packageId) } : land);
    return result({ ...model, components, lands, packages: removeAt(model.packages, deleteIndex) }, { type: 'split-component-new-package', componentId: component.id, newPackageId: command.deletePackageId }, { type: command.type, entityId: component.id });
  },
  'change-board-profile'(model, command) {
    const before = cloneCadValue(model.boardDefinition?.profile || null); const profile = cloneCadValue(command.profile || null);
    return result({ ...model, boardDefinition: { ...(model.boardDefinition || {}), profile } }, { type: 'change-board-profile', profile: before }, { type: command.type, entityId: model.boardDefinition?.id || 'board:main', before, after: profile });
  },
  'add-panel-instance'(model, command) {
    const id = uniqueId(model.panelInstances, command.instance?.id || 'panel-instance:new');
    const instance = { id, boardId: String(command.instance?.boardId || model.boardDefinition?.id || 'board:main'), transformation: { x: 0, y: 0, rotation: 0, mirror: false, ...(cloneCadValue(command.instance?.transformation) || {}) }, metadata: cloneCadValue(command.instance?.metadata || {}) };
    instance.transformation.rotation = normalizeRotation(instance.transformation.rotation);
    return result({ ...model, panelInstances: [...(model.panelInstances || []), instance] }, { type: 'delete-panel-instance', instanceId: id }, { type: command.type, entityId: id, after: cloneCadValue(instance) });
  },
  'delete-panel-instance'(model, command) {
    const index = entityIndex(model.panelInstances, command.instanceId, 'Panel Instance'); const item = model.panelInstances[index];
    return result({ ...model, panelInstances: removeAt(model.panelInstances, index) }, { type: 'restore-panel-instance', instance: cloneCadValue(item), index }, { type: command.type, entityId: item.id, before: cloneCadValue(item) });
  },
  'restore-panel-instance'(model, command) {
    const items = model.panelInstances.slice(); items.splice(Math.min(Number(command.index) || 0, items.length), 0, cloneCadValue(command.instance));
    return result({ ...model, panelInstances: items }, { type: 'delete-panel-instance', instanceId: command.instance.id }, { type: command.type, entityId: command.instance.id });
  },
};

export function executeCadCommand(model, command, { validate = true } = {}) {
  const handler = handlers[String(command?.type || '')];
  if (!handler) throw new TransactionError(`ไม่รองรับ Transaction: ${String(command?.type || '')}`, { stage: 'dispatch-transaction' });
  try {
    const outcome = handler(model, command);
    outcome.model = { ...outcome.model, revision: Number(model.revision || 0) };
    if (validate) validateTransactionModel(outcome.model);
    return outcome;
  } catch (error) {
    if (error instanceof TransactionError || error instanceof ValidationError || error instanceof GeometryError) throw error;
    throw new TransactionError(`Transaction ${command.type} ล้มเหลว: ${error?.message || error}`, { stage: command.type, cause: error, technicalDetail: error?.stack || '' });
  }
}

export class CadTransactionEngine {
  constructor(model, options = {}) {
    validateTransactionModel(model);
    this.model = model;
    this.undoStack = [];
    this.redoStack = [];
    this.limit = Math.max(1, Number(options.historyLimit || 100));
    this.onChange = typeof options.onChange === 'function' ? options.onChange : null;
  }
  execute(command) {
    const outcome = executeCadCommand(this.model, command);
    this.model = outcome.model;
    this.undoStack.push({ command: cloneCadValue(command), inverse: cloneCadValue(outcome.inverse), change: cloneCadValue(outcome.change) });
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
    this.onChange?.({ action: 'execute', command, change: outcome.change, model: this.model });
    return outcome.change;
  }
  undo() {
    const entry = this.undoStack.pop(); if (!entry) return false;
    const outcome = executeCadCommand(this.model, entry.inverse);
    this.model = outcome.model; this.redoStack.push(entry);
    this.onChange?.({ action: 'undo', command: entry.inverse, change: outcome.change, model: this.model });
    return true;
  }
  redo() {
    const entry = this.redoStack.pop(); if (!entry) return false;
    const outcome = executeCadCommand(this.model, entry.command);
    this.model = outcome.model; entry.inverse = cloneCadValue(outcome.inverse); this.undoStack.push(entry);
    this.onChange?.({ action: 'redo', command: entry.command, change: outcome.change, model: this.model });
    return true;
  }
  changeSet() { return this.undoStack.map((item) => cloneCadValue(item.change)); }
}
