import { parseInspectionXml } from './parsers.js';
import { mergeRectangles, splitRectangle } from './geometry.js';

function cloneLand(land) {
  return {
    uid: `${String(land.componentId ?? '')}\u0000${String(land.globalId ?? '')}`,
    originalComponentId: String(land.componentId ?? ''),
    originalGlobalId: land.globalId,
    globalId: land.globalId,
    componentId: String(land.componentId ?? ''),
    cadName: String(land.cadName ?? ''),
    side: String(land.side ?? ''),
    left: land.left,
    top: land.top,
    width: land.width,
    length: land.length,
    localIndex: land.localIndex,
    isNew: false,
  };
}

export function createCadEditorModel(xmlTextOrParsed) {
  const sourceText = typeof xmlTextOrParsed === 'string' ? xmlTextOrParsed : '';
  const parsed = typeof xmlTextOrParsed === 'string' ? parseInspectionXml(xmlTextOrParsed) : xmlTextOrParsed;
  if (!parsed?.components) throw new TypeError('createCadEditorModel ต้องได้รับ XML text หรือ parsed CAD model');
  const components = parsed.components.map((component) => ({
    uid: `component:${component.id}`,
    originalId: component.inferred ? null : String(component.id),
    id: String(component.id),
    name: String(component.name || ''),
    packageName: String(component.packageName || ''),
    revision: String(component.revision || ''),
    centerX: component.centerX,
    centerY: component.centerY,
    angle: component.angle,
    isNew: Boolean(component.inferred),
    lands: (component.lands || []).map((land) => component.inferred ? { ...cloneLand(land), isNew: true, originalComponentId: null, originalGlobalId: null } : cloneLand(land)),
  }));
  return {
    board: { ...parsed.board },
    components,
    sourceText,
    sourceSize: sourceText.length || Number(parsed.sourceSize || 0),
    changed: false,
  };
}

export function cloneCadEditorModel(model) {
  if (!model) return null;
  return {
    board: { ...(model.board || {}) },
    components: (model.components || []).map((component) => ({
      ...component,
      lands: (component.lands || []).map((land) => ({ ...land })),
    })),
    sourceText: String(model.sourceText || ''),
    sourceSize: Number(model.sourceSize || String(model.sourceText || '').length || 0),
    changed: Boolean(model.changed),
  };
}

function cancelledError() {
  const error = new Error('ยกเลิกการทำงานแล้ว');
  error.name = 'AbortError';
  return error;
}

function shouldCheckpoint(processed, options = {}, force = false) {
  if (force) return true;
  const batchSize = Math.max(50, Number(options.batchSize) || 500);
  return processed > 0 && processed % batchSize === 0;
}
async function asyncCheckpoint(processed, total, stage, options = {}) {
  if (options.isCancelled?.()) throw cancelledError();
  options.onProgress?.({ processed, total, stage, ratio: total ? Math.min(1, processed / total) : 1 });
  const yieldControl = options.yieldControl || (() => new Promise((resolve) => setTimeout(resolve, 0)));
  await yieldControl();
  if (options.isCancelled?.()) throw cancelledError();
}

export async function cloneCadEditorModelAsync(model, options = {}) {
  if (!model) return null;
  const sourceComponents = model.components || [];
  const total = sourceComponents.reduce((sum, component) => sum + 1 + (component.lands?.length || 0), 0);
  let processed = 0;
  const components = [];
  for (const component of sourceComponents) {
    const copy = { ...component, lands: [] };
    for (const land of component.lands || []) {
      copy.lands.push({ ...land });
      processed += 1;
      if (shouldCheckpoint(processed, options)) await asyncCheckpoint(processed, total, 'snapshot', options);
    }
    components.push(copy);
    processed += 1;
    if (shouldCheckpoint(processed, options)) await asyncCheckpoint(processed, total, 'snapshot', options);
  }
  await asyncCheckpoint(total, total, 'snapshot', options);
  return {
    board: { ...(model.board || {}) },
    components,
    sourceText: String(model.sourceText || ''),
    sourceSize: Number(model.sourceSize || String(model.sourceText || '').length || 0),
    changed: Boolean(model.changed),
  };
}

export function cadEditorModelToData(model) {
  const board = { ...(model?.board || {}) };
  const components = [];
  const componentById = new Map();
  let totalLands = 0;
  for (const source of model?.components || []) {
    const lands = (source.lands || []).map((land, index) => {
      const left = Number.isFinite(Number(land.left)) ? Number(land.left) : null;
      const top = Number.isFinite(Number(land.top)) ? Number(land.top) : null;
      const width = Number.isFinite(Number(land.width)) ? Number(land.width) : null;
      const length = Number.isFinite(Number(land.length)) ? Number(land.length) : null;
      return {
        globalId: Number.isFinite(Number(land.globalId)) ? Number(land.globalId) : null,
        componentId: String(source.id ?? ''),
        cadName: String(land.cadName ?? ''),
        side: String(land.side ?? ''),
        left, top, width, length,
        centerX: left != null && width != null ? left + width / 2 : left,
        centerY: top != null && length != null ? top - length / 2 : top,
        localIndex: index + 1,
      };
    });
    lands.sort((a, b) => (a.globalId ?? 0) - (b.globalId ?? 0));
    lands.forEach((land, index) => { land.localIndex = index + 1; });
    const component = {
      id: String(source.id ?? ''),
      name: String(source.name ?? ''),
      packageName: String(source.packageName ?? ''),
      revision: String(source.revision ?? ''),
      centerX: Number.isFinite(Number(source.centerX)) ? Number(source.centerX) : null,
      centerY: Number.isFinite(Number(source.centerY)) ? Number(source.centerY) : null,
      angle: Number.isFinite(Number(source.angle)) ? Number(source.angle) : null,
      lands,
    };
    if (lands.length) {
      const xs = lands.map((land) => land.centerX).filter(Number.isFinite);
      const ys = lands.map((land) => land.centerY).filter(Number.isFinite);
      if (xs.length && ys.length) component.bounds = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
      const minId = lands[0].globalId;
      const contiguous = Number.isFinite(minId) && lands.every((land, index) => land.globalId === minId + index);
      component.contiguousGlobalIds = contiguous;
      component.offset = contiguous ? minId - 1 : null;
    }
    components.push(component);
    componentById.set(component.id, component);
    totalLands += lands.length;
  }
  return { board, components, componentById, totalLands, sourceSize: Number(model?.sourceSize || 0) };
}


export async function cadEditorModelToDataAsync(model, options = {}) {
  const board = { ...(model?.board || {}) };
  const sourceComponents = model?.components || [];
  const total = sourceComponents.reduce((sum, component) => sum + 1 + (component.lands?.length || 0), 0);
  const components = [];
  const componentById = new Map();
  let totalLands = 0;
  let processed = 0;

  for (const source of sourceComponents) {
    const lands = [];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let index = 0; index < (source.lands || []).length; index += 1) {
      const land = source.lands[index];
      const left = Number.isFinite(Number(land.left)) ? Number(land.left) : null;
      const top = Number.isFinite(Number(land.top)) ? Number(land.top) : null;
      const width = Number.isFinite(Number(land.width)) ? Number(land.width) : null;
      const length = Number.isFinite(Number(land.length)) ? Number(land.length) : null;
      const centerX = left != null && width != null ? left + width / 2 : left;
      const centerY = top != null && length != null ? top - length / 2 : top;
      if (Number.isFinite(centerX) && Number.isFinite(centerY)) {
        minX = Math.min(minX, centerX); maxX = Math.max(maxX, centerX);
        minY = Math.min(minY, centerY); maxY = Math.max(maxY, centerY);
      }
      lands.push({
        globalId: Number.isFinite(Number(land.globalId)) ? Number(land.globalId) : null,
        componentId: String(source.id ?? ''),
        cadName: String(land.cadName ?? ''),
        side: String(land.side ?? ''),
        left, top, width, length, centerX, centerY,
        localIndex: index + 1,
      });
      processed += 1;
      if (shouldCheckpoint(processed, options)) await asyncCheckpoint(processed, total, 'convert', options);
    }
    lands.sort((a, b) => (a.globalId ?? 0) - (b.globalId ?? 0));
    lands.forEach((land, index) => { land.localIndex = index + 1; });
    const component = {
      id: String(source.id ?? ''),
      name: String(source.name ?? ''),
      packageName: String(source.packageName ?? ''),
      revision: String(source.revision ?? ''),
      centerX: Number.isFinite(Number(source.centerX)) ? Number(source.centerX) : null,
      centerY: Number.isFinite(Number(source.centerY)) ? Number(source.centerY) : null,
      angle: Number.isFinite(Number(source.angle)) ? Number(source.angle) : null,
      lands,
    };
    if (lands.length) {
      if (Number.isFinite(minX)) component.bounds = { minX, maxX, minY, maxY };
      const minId = lands[0].globalId;
      const contiguous = Number.isFinite(minId) && lands.every((land, index) => land.globalId === minId + index);
      component.contiguousGlobalIds = contiguous;
      component.offset = contiguous ? minId - 1 : null;
    }
    components.push(component);
    componentById.set(component.id, component);
    totalLands += lands.length;
    processed += 1;
    if (shouldCheckpoint(processed, options)) await asyncCheckpoint(processed, total, 'convert', options);
  }
  await asyncCheckpoint(total, total, 'convert', options);
  return { board, components, componentById, totalLands, sourceSize: Number(model?.sourceSize || 0) };
}


export function componentBounds(component) {
  const lands = component?.lands || [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const land of lands) {
    const left = Number(land.left);
    const top = Number(land.top);
    const width = Math.abs(Number(land.width) || 0);
    const length = Math.abs(Number(land.length) || 0);
    if (!Number.isFinite(left) || !Number.isFinite(top)) continue;
    minX = Math.min(minX, left, left + width);
    maxX = Math.max(maxX, left, left + width);
    minY = Math.min(minY, top, top - length);
    maxY = Math.max(maxY, top, top - length);
  }
  if (!Number.isFinite(minX)) {
    const x = Number.isFinite(Number(component?.centerX)) ? Number(component.centerX) : 0;
    const y = Number.isFinite(Number(component?.centerY)) ? Number(component.centerY) : 0;
    minX = x - 0.5; maxX = x + 0.5; minY = y - 0.5; maxY = y + 0.5;
  }
  const width = Math.max(0.02, maxX - minX);
  const height = Math.max(0.02, maxY - minY);
  return { minX, minY, maxX, maxY, width, height, centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2 };
}

export function moveLand(land, dx = 0, dy = 0) {
  if (!land) return false;
  const x = Number(dx) || 0;
  const y = Number(dy) || 0;
  if (!x && !y) return false;
  if (Number.isFinite(Number(land.left))) land.left = Number(land.left) + x;
  if (Number.isFinite(Number(land.top))) land.top = Number(land.top) + y;
  if (Number.isFinite(Number(land.centerX))) land.centerX = Number(land.centerX) + x;
  if (Number.isFinite(Number(land.centerY))) land.centerY = Number(land.centerY) + y;
  return true;
}

export function moveComponent(component, dx = 0, dy = 0) {
  if (!component) return false;
  const x = Number(dx) || 0;
  const y = Number(dy) || 0;
  if (!x && !y) return false;
  if (Number.isFinite(Number(component.centerX))) component.centerX = Number(component.centerX) + x;
  else component.centerX = componentBounds(component).centerX + x;
  if (Number.isFinite(Number(component.centerY))) component.centerY = Number(component.centerY) + y;
  else component.centerY = componentBounds(component).centerY + y;
  for (const land of component.lands || []) moveLand(land, x, y);
  return true;
}

export function normalizeSide(value) {
  const text = String(value ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (['top', 't', 'front', 'component', 'component-side', '1'].includes(text) || text.includes('top') || text.includes('front') || text.includes('component-side')) return 'top';
  if (['bottom', 'bot', 'b', 'back', 'solder', 'solder-side', '2'].includes(text) || text.includes('bottom') || text.includes('back') || text.includes('solder')) return 'bottom';
  return 'unknown';
}

function excelLetters(index) {
  let n = Math.max(1, Number(index) || 1);
  let result = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

export function a1SequenceName(index, options = {}) {
  const mode = options.mode || 'single-row';
  const columns = Math.max(1, Number(options.columns) || 999999);
  const position = Math.max(0, Number(index) || 0);
  if (mode === 'grid') {
    const row = Math.floor(position / columns) + 1;
    const column = (position % columns) + 1;
    return `${excelLetters(row)}${column}`;
  }
  return `A${position + 1}`;
}

function coordinateOrder(lands) {
  const valid = lands.every((land) => Number.isFinite(land.centerY ?? (Number(land.top) - Number(land.length || 0) / 2)) && Number.isFinite(land.centerX ?? (Number(land.left) + Number(land.width || 0) / 2)));
  if (!valid) return [...lands];
  return [...lands].sort((a, b) => {
    const ay = Number(a.centerY ?? (Number(a.top) - Number(a.length || 0) / 2));
    const by = Number(b.centerY ?? (Number(b.top) - Number(b.length || 0) / 2));
    const ax = Number(a.centerX ?? (Number(a.left) + Number(a.width || 0) / 2));
    const bx = Number(b.centerX ?? (Number(b.left) + Number(b.width || 0) / 2));
    return by - ay || ax - bx || Number(a.globalId || 0) - Number(b.globalId || 0);
  });
}

export function renumberComponentA1(component, options = {}) {
  if (!component) return 0;
  const order = options.order === 'position' ? coordinateOrder(component.lands) : [...component.lands];
  order.forEach((land, index) => { land.cadName = a1SequenceName(index, options); });
  return order.length;
}

export function renumberAllComponentsA1(model, options = {}) {
  let count = 0;
  for (const component of model?.components || []) count += renumberComponentA1(component, options);
  if (count) model.changed = true;
  return count;
}

function numericMax(values, fallback = 0) {
  const numbers = values.map(Number).filter(Number.isFinite);
  return numbers.length ? Math.max(...numbers) : fallback;
}

export function nextComponentId(model) {
  return String(numericMax((model?.components || []).map((component) => component.id), 0) + 1);
}

export function nextGlobalLandId(model) {
  const ids = [];
  for (const component of model?.components || []) for (const land of component.lands || []) ids.push(land.globalId);
  return numericMax(ids, 0) + 1;
}

export function addComponent(model, values = {}) {
  const id = String(values.id || nextComponentId(model));
  if ((model.components || []).some((component) => String(component.id) === id)) throw new Error(`Component ID ${id} มีอยู่แล้ว`);
  const component = {
    uid: `new-component:${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`}`,
    originalId: null,
    id,
    name: String(values.name || `NEW_${id}`),
    packageName: String(values.packageName || 'GENERIC'),
    revision: String(values.revision || ''),
    centerX: Number.isFinite(Number(values.centerX)) ? Number(values.centerX) : 0,
    centerY: Number.isFinite(Number(values.centerY)) ? Number(values.centerY) : 0,
    angle: Number.isFinite(Number(values.angle)) ? Number(values.angle) : 0,
    isNew: true,
    lands: [],
  };
  model.components.push(component);
  model.changed = true;
  return component;
}

export function addLand(model, component, values = {}) {
  if (!component) throw new Error('กรุณาเลือก Component');
  const globalId = values.globalId == null || values.globalId === '' ? nextGlobalLandId(model) : Number(values.globalId);
  if (!Number.isFinite(globalId)) throw new Error('XML Land ID ต้องเป็นตัวเลข');
  for (const current of model.components || []) {
    if ((current.lands || []).some((land) => Number(land.globalId) === globalId)) throw new Error(`XML Land ID ${globalId} มีอยู่แล้ว`);
  }
  const last = component.lands.at(-1);
  const index = component.lands.length;
  const land = {
    uid: `new-land:${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`}`,
    originalComponentId: null,
    originalGlobalId: null,
    globalId,
    componentId: String(component.id),
    cadName: String(values.cadName || a1SequenceName(index)),
    side: String(values.side || last?.side || 'Top'),
    left: Number.isFinite(Number(values.left)) ? Number(values.left) : Number(last?.left || 0),
    top: Number.isFinite(Number(values.top)) ? Number(values.top) : Number(last?.top || 0),
    width: Number.isFinite(Number(values.width)) ? Number(values.width) : Number(last?.width || 0.5),
    length: Number.isFinite(Number(values.length)) ? Number(values.length) : Number(last?.length || 0.5),
    localIndex: index + 1,
    isNew: true,
  };
  component.lands.push(land);
  model.changed = true;
  return land;
}

export function duplicateLand(model, component, land) {
  if (!land) throw new Error('กรุณาเลือก Land ที่ต้องการทำสำเนา');
  return addLand(model, component, {
    ...land,
    globalId: nextGlobalLandId(model),
    cadName: a1SequenceName(component.lands.length),
    left: Number(land.left || 0) + Number(land.width || 0),
  });
}

export function deleteLand(model, component, land) {
  const index = component?.lands?.indexOf(land) ?? -1;
  if (index < 0) return false;
  component.lands.splice(index, 1);
  component.lands.forEach((item, itemIndex) => { item.localIndex = itemIndex + 1; });
  model.changed = true;
  return true;
}

export function splitLandRectangle(model, component, land, options = {}) {
  if (!model || !component || !land) throw new Error('กรุณาเลือก Land ที่ต้องการตัด');
  const [first, second] = splitRectangle({ left: land.left, top: land.top, width: land.width, height: land.length, rotation: land.rotation || 0 }, options);
  land.left = first.left; land.top = first.top; land.width = first.width; land.length = first.height;
  const created = addLand(model, component, {
    cadName: options.newName || `${land.cadName || land.localIndex}_B`, side: land.side,
    left: second.left, top: second.top, width: second.width, length: second.height,
  });
  component.lands.forEach((item, index) => { item.localIndex = index + 1; });
  model.changed = true;
  return [land, created];
}

export function mergeLandRectangles(model, component, lands) {
  const selected = [...(lands || [])];
  if (!model || !component || selected.length < 2) throw new Error('กรุณาเลือก Land อย่างน้อย 2 จุด');
  const sides = new Set(selected.map((land) => String(land.side || '').toLowerCase()));
  if (sides.size > 1) throw new Error('Merge Land ต่างด้านไม่ได้');
  const merged = mergeRectangles(selected.map((land) => ({ left: land.left, top: land.top, width: land.width, height: land.length, rotation: land.rotation || 0 })));
  const primary = selected[0];
  primary.left = merged.left; primary.top = merged.top; primary.width = merged.width; primary.length = merged.height;
  const removing = new Set(selected.slice(1));
  component.lands = component.lands.filter((land) => !removing.has(land));
  component.lands.forEach((item, index) => { item.localIndex = index + 1; });
  model.changed = true;
  return primary;
}

export function deleteComponent(model, component) {
  const index = model?.components?.indexOf(component) ?? -1;
  if (index < 0) return false;
  model.components.splice(index, 1);
  model.changed = true;
  return true;
}

function refreshComponentLandIndexes(component) {
  (component?.lands || []).forEach((land, index) => {
    land.componentId = String(component.id);
    land.localIndex = index + 1;
  });
}

export function splitComponentLands(model, component, landUids, values = {}) {
  if (!model || !component) throw new Error('กรุณาเลือก Component ที่ต้องการแบ่ง');
  const selected = landUids instanceof Set ? landUids : new Set(landUids || []);
  const lands = component.lands || [];
  const moved = lands.filter((land) => selected.has(land.uid));
  if (!moved.length) throw new Error('กรุณาลากคลุมหรือเลือก Land ที่ต้องการแยก');
  if (moved.length >= lands.length) throw new Error('ต้องเหลือ Land อย่างน้อย 1 จุดใน Component เดิม');

  const bounds = componentBounds({ lands: moved });
  const newComponent = addComponent(model, {
    name: values.name || `${component.name || `PART_${component.id}`}_SPLIT`,
    packageName: values.packageName ?? component.packageName,
    revision: values.revision ?? component.revision,
    centerX: Number.isFinite(Number(values.centerX)) ? Number(values.centerX) : bounds.centerX,
    centerY: Number.isFinite(Number(values.centerY)) ? Number(values.centerY) : bounds.centerY,
    angle: Number.isFinite(Number(values.angle)) ? Number(values.angle) : Number(component.angle || 0),
  });

  component.lands = lands.filter((land) => !selected.has(land.uid));
  newComponent.lands = moved;
  refreshComponentLandIndexes(component);
  refreshComponentLandIndexes(newComponent);

  const originalBounds = componentBounds(component);
  if (Number.isFinite(originalBounds.centerX)) component.centerX = originalBounds.centerX;
  if (Number.isFinite(originalBounds.centerY)) component.centerY = originalBounds.centerY;
  model.changed = true;
  return newComponent;
}


export function validateCadEditorModel(model) {
  const errors = [];
  const warnings = [];
  const componentIds = new Set();
  const globalIds = new Set();
  for (const component of model?.components || []) {
    const componentId = String(component.id ?? '').trim();
    if (!componentId) errors.push('พบ Component ที่ไม่มี ID');
    else if (componentIds.has(componentId)) errors.push(`Component ID ซ้ำ: ${componentId}`);
    else componentIds.add(componentId);
    const names = new Map();
    for (const land of component.lands || []) {
      const id = Number(land.globalId);
      if (!Number.isFinite(id)) errors.push(`${component.name || componentId}: Land มี XML ID ไม่ถูกต้อง`);
      else if (globalIds.has(id)) errors.push(`XML Land ID ซ้ำ: ${id}`);
      else globalIds.add(id);
      const name = String(land.cadName ?? '').trim();
      if (!name) errors.push(`${component.name || componentId}: พบ Land ที่ไม่มีชื่อ`);
      else {
        const key = name.toUpperCase();
        names.set(key, (names.get(key) || 0) + 1);
      }
      for (const field of ['left', 'top', 'width', 'length']) {
        if (land[field] != null && land[field] !== '' && !Number.isFinite(Number(land[field]))) errors.push(`${component.name || componentId}/${name || id}: ${field} ไม่ใช่ตัวเลข`);
      }
      if (normalizeSide(land.side) === 'unknown') warnings.push(`${component.name || componentId}/${name || id}: ไม่ระบุ Top/Bottom`);
    }
    for (const [name, count] of names) if (count > 1) errors.push(`${component.name || componentId}: ชื่อ Land ${name} ซ้ำ ${count} จุด`);
  }
  return { valid: errors.length === 0, errors, warnings };
}

export async function validateCadEditorModelAsync(model, options = {}) {
  const errors = [];
  const warnings = [];
  const componentIds = new Set();
  const globalIds = new Set();
  const sourceComponents = model?.components || [];
  const total = sourceComponents.reduce((sum, component) => sum + 1 + (component.lands?.length || 0), 0);
  let processed = 0;
  for (const component of sourceComponents) {
    const componentId = String(component.id ?? '').trim();
    if (!componentId) errors.push('พบ Component ที่ไม่มี ID');
    else if (componentIds.has(componentId)) errors.push(`Component ID ซ้ำ: ${componentId}`);
    else componentIds.add(componentId);
    const names = new Map();
    for (const land of component.lands || []) {
      const id = Number(land.globalId);
      if (!Number.isFinite(id)) errors.push(`${component.name || componentId}: Land มี XML ID ไม่ถูกต้อง`);
      else if (globalIds.has(id)) errors.push(`XML Land ID ซ้ำ: ${id}`);
      else globalIds.add(id);
      const name = String(land.cadName ?? '').trim();
      if (!name) errors.push(`${component.name || componentId}: พบ Land ที่ไม่มีชื่อ`);
      else {
        const key = name.toUpperCase();
        names.set(key, (names.get(key) || 0) + 1);
      }
      for (const field of ['left', 'top', 'width', 'length']) {
        if (land[field] != null && land[field] !== '' && !Number.isFinite(Number(land[field]))) errors.push(`${component.name || componentId}/${name || id}: ${field} ไม่ใช่ตัวเลข`);
      }
      if (normalizeSide(land.side) === 'unknown') warnings.push(`${component.name || componentId}/${name || id}: ไม่ระบุ Top/Bottom`);
      processed += 1;
      if (shouldCheckpoint(processed, options)) await asyncCheckpoint(processed, total, 'validate', options);
    }
    for (const [name, count] of names) if (count > 1) errors.push(`${component.name || componentId}: ชื่อ Land ${name} ซ้ำ ${count} จุด`);
    processed += 1;
    if (shouldCheckpoint(processed, options)) await asyncCheckpoint(processed, total, 'validate', options);
  }
  await asyncCheckpoint(total, total, 'validate', options);
  return { valid: errors.length === 0, errors, warnings };
}


function findByTag(parent, tagName) {
  return [...parent.getElementsByTagName(tagName)];
}

function setNumberAttribute(node, name, value) {
  if (value == null || value === '' || !Number.isFinite(Number(value))) node.removeAttribute(name);
  else node.setAttribute(name, String(Number(value)));
}

function updateComponentNode(node, component) {
  node.setAttribute('Id', String(component.id));
  node.setAttribute('Name', String(component.name || ''));
  let item = node.getElementsByTagName('ComponentInformationItem')[0];
  if (!item) { item = node.ownerDocument.createElement('ComponentInformationItem'); node.appendChild(item); }
  item.setAttribute('ComponentNumberId', String(component.packageName || ''));
  item.setAttribute('ComponentNumberRevision', String(component.revision || ''));
  let position = node.getElementsByTagName('PositionAngle')[0];
  if (!position) { position = node.ownerDocument.createElement('PositionAngle'); node.appendChild(position); }
  setNumberAttribute(position, 'CenterPosX', component.centerX);
  setNumberAttribute(position, 'CenterPosY', component.centerY);
  setNumberAttribute(position, 'Angle', component.angle);
}

function updateLandNode(node, land, componentId) {
  node.setAttribute('LandId', String(land.globalId));
  node.setAttribute('Component', String(componentId));
  node.setAttribute('Name', String(land.cadName || ''));
  node.setAttribute('Side', String(land.side || ''));
  let geometry = node.getElementsByTagName('Land')[0];
  if (!geometry) { geometry = node.ownerDocument.createElement('Land'); node.appendChild(geometry); }
  setNumberAttribute(geometry, 'Left', land.left);
  setNumberAttribute(geometry, 'Top', land.top);
  setNumberAttribute(geometry, 'Width', land.width);
  setNumberAttribute(geometry, 'Length', land.length);
}

function parserError(doc) {
  return doc.getElementsByTagName('parsererror')[0]?.textContent || '';
}

function xmlAttribute(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function numericAttribute(value) {
  if (value == null || value === '') return '';
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : '';
}

export function serializeCadEditorModelStandalone(model, options = {}) {
  const side = options.side || 'all';
  const keepLand = (land) => side === 'all' || normalizeSide(land.side) === side;
  const components = (model?.components || []).filter((component) => (component.lands || []).some(keepLand));
  const chunks = ['<?xml version="1.0" encoding="UTF-8"?>\n<InspectionData>\n'];
  const board = model?.board || {};
  chunks.push(`  <BoardInformation Name="${xmlAttribute(board.Name || board.name || '')}" Width="${xmlAttribute(numericAttribute(board.Width))}" Height="${xmlAttribute(numericAttribute(board.Height))}" Thickness="${xmlAttribute(numericAttribute(board.Thickness))}"/>\n`);
  chunks.push('  <Components>\n');
  for (const component of components) {
    chunks.push(`    <ComponentInformation Id="${xmlAttribute(component.id)}" Name="${xmlAttribute(component.name)}">\n`);
    chunks.push(`      <ComponentInformationItem ComponentNumberId="${xmlAttribute(component.packageName)}" ComponentNumberRevision="${xmlAttribute(component.revision)}"/>\n`);
    chunks.push(`      <PositionAngle CenterPosX="${xmlAttribute(numericAttribute(component.centerX))}" CenterPosY="${xmlAttribute(numericAttribute(component.centerY))}" Angle="${xmlAttribute(numericAttribute(component.angle))}"/>\n`);
    chunks.push('    </ComponentInformation>\n');
  }
  chunks.push('  </Components>\n  <Lands>\n');
  for (const component of components) {
    for (const land of component.lands || []) {
      if (!keepLand(land)) continue;
      chunks.push(`    <LandNumber LandId="${xmlAttribute(numericAttribute(land.globalId))}" Component="${xmlAttribute(component.id)}" Name="${xmlAttribute(land.cadName)}" Side="${xmlAttribute(land.side)}"><Land Left="${xmlAttribute(numericAttribute(land.left))}" Top="${xmlAttribute(numericAttribute(land.top))}" Width="${xmlAttribute(numericAttribute(land.width))}" Length="${xmlAttribute(numericAttribute(land.length))}"/></LandNumber>\n`);
    }
  }
  chunks.push('  </Lands>\n</InspectionData>\n');
  return chunks.join('');
}

export async function serializeCadEditorModelStandaloneAsync(model, options = {}) {
  const side = options.side || 'all';
  const keepLand = (land) => side === 'all' || normalizeSide(land.side) === side;
  const sourceComponents = model?.components || [];
  const total = sourceComponents.reduce((sum, component) => sum + 1 + (component.lands?.length || 0), 0);
  let processed = 0;
  const components = [];
  for (const component of sourceComponents) {
    if ((component.lands || []).some(keepLand)) components.push(component);
    processed += 1;
    if (shouldCheckpoint(processed, options)) await asyncCheckpoint(processed, total, 'serialize', options);
  }
  const chunks = ['<?xml version="1.0" encoding="UTF-8"?>\n<InspectionData>\n'];
  const board = model?.board || {};
  chunks.push(`  <BoardInformation Name="${xmlAttribute(board.Name || board.name || '')}" Width="${xmlAttribute(numericAttribute(board.Width))}" Height="${xmlAttribute(numericAttribute(board.Height))}" Thickness="${xmlAttribute(numericAttribute(board.Thickness))}"/>\n`);
  chunks.push('  <Components>\n');
  for (const component of components) {
    chunks.push(`    <ComponentInformation Id="${xmlAttribute(component.id)}" Name="${xmlAttribute(component.name)}">\n`);
    chunks.push(`      <ComponentInformationItem ComponentNumberId="${xmlAttribute(component.packageName)}" ComponentNumberRevision="${xmlAttribute(component.revision)}"/>\n`);
    chunks.push(`      <PositionAngle CenterPosX="${xmlAttribute(numericAttribute(component.centerX))}" CenterPosY="${xmlAttribute(numericAttribute(component.centerY))}" Angle="${xmlAttribute(numericAttribute(component.angle))}"/>\n`);
    chunks.push('    </ComponentInformation>\n');
  }
  chunks.push('  </Components>\n  <Lands>\n');
  for (const component of components) {
    for (const land of component.lands || []) {
      if (keepLand(land)) chunks.push(`    <LandNumber LandId="${xmlAttribute(numericAttribute(land.globalId))}" Component="${xmlAttribute(component.id)}" Name="${xmlAttribute(land.cadName)}" Side="${xmlAttribute(land.side)}"><Land Left="${xmlAttribute(numericAttribute(land.left))}" Top="${xmlAttribute(numericAttribute(land.top))}" Width="${xmlAttribute(numericAttribute(land.width))}" Length="${xmlAttribute(numericAttribute(land.length))}"/></LandNumber>\n`);
      processed += 1;
      if (shouldCheckpoint(processed, options)) await asyncCheckpoint(processed, total, 'serialize', options);
    }
  }
  chunks.push('  </Lands>\n</InspectionData>\n');
  await asyncCheckpoint(total, total, 'serialize', options);
  return chunks.join('');
}


export function serializeCadEditorModel(xmlText, model, options = {}) {
  if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') throw new Error('เบราว์เซอร์นี้ไม่รองรับ XML Editor');
  const side = options.side || 'all';
  const parser = new DOMParser();
  const doc = parser.parseFromString(String(xmlText || ''), 'application/xml');
  const error = parserError(doc);
  if (error) throw new Error(`XML ต้นฉบับไม่สมบูรณ์: ${error.slice(0, 180)}`);

  const componentNodes = findByTag(doc, 'ComponentInformation');
  const landNodes = findByTag(doc, 'LandNumber');
  const componentParent = componentNodes[0]?.parentNode || doc.documentElement;
  const landParent = landNodes[0]?.parentNode || doc.documentElement;
  const componentTemplate = componentNodes[0]?.cloneNode(true) || null;
  const landTemplate = landNodes[0]?.cloneNode(true) || null;

  const modelComponentsByOriginal = new Map((model.components || []).filter((component) => !component.isNew).map((component) => [String(component.originalId), component]));
  for (const node of componentNodes) {
    const originalId = String(node.getAttribute('Id') || '');
    const component = modelComponentsByOriginal.get(originalId);
    if (!component) node.parentNode?.removeChild(node);
    else updateComponentNode(node, component);
  }

  const existingLandByOriginal = new Map();
  for (const component of model.components || []) {
    for (const land of component.lands || []) {
      if (!land.isNew) existingLandByOriginal.set(`${land.originalComponentId}\u0000${land.originalGlobalId}`, { component, land });
    }
  }
  const keptCounts = new Map();
  const keepLand = (land) => side === 'all' || normalizeSide(land.side) === side;
  for (const node of landNodes) {
    const key = `${node.getAttribute('Component') || ''}\u0000${node.getAttribute('LandId') || ''}`;
    const found = existingLandByOriginal.get(key);
    if (!found || !keepLand(found.land)) { node.parentNode?.removeChild(node); continue; }
    updateLandNode(node, found.land, found.component.id);
    keptCounts.set(String(found.component.id), (keptCounts.get(String(found.component.id)) || 0) + 1);
  }

  for (const component of model.components || []) {
    if (component.isNew) {
      const node = componentTemplate ? componentTemplate.cloneNode(true) : doc.createElement('ComponentInformation');
      updateComponentNode(node, component);
      componentParent.appendChild(node);
    }
    for (const land of component.lands || []) {
      if (!land.isNew || !keepLand(land)) continue;
      const node = landTemplate ? landTemplate.cloneNode(true) : doc.createElement('LandNumber');
      updateLandNode(node, land, component.id);
      landParent.appendChild(node);
      keptCounts.set(String(component.id), (keptCounts.get(String(component.id)) || 0) + 1);
    }
  }

  if (side !== 'all') {
    for (const node of findByTag(doc, 'ComponentInformation')) {
      if (!keptCounts.get(String(node.getAttribute('Id') || ''))) node.parentNode?.removeChild(node);
    }
  }

  let output = new XMLSerializer().serializeToString(doc);
  const declaration = String(xmlText || '').match(/^\s*(<\?xml[^>]*\?>)/i)?.[1];
  if (declaration && !/^\s*<\?xml/i.test(output)) output = `${declaration}\n${output}`;
  return output;
}

export function modelSummary(model) {
  let lands = 0, top = 0, bottom = 0, unknown = 0;
  for (const component of model?.components || []) {
    for (const land of component.lands || []) {
      lands += 1;
      const side = normalizeSide(land.side);
      if (side === 'top') top += 1;
      else if (side === 'bottom') bottom += 1;
      else unknown += 1;
    }
  }
  return { components: model?.components?.length || 0, lands, top, bottom, unknown };
}
