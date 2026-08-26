import { applyMatrix, composeTransform, identityMatrix, invertMatrix, multiplyMatrix, normalizeRotation } from './coordinate-transform.js';
import { cloneCadValue } from './universal-cad-model.js';

export const COORDINATE_SYSTEM_SCHEMA_VERSION = 1;

export function createCoordinateSystem(input = {}) {
  return {
    id: String(input.id || 'board'),
    name: String(input.name || input.id || 'Board Coordinate'),
    units: String(input.units || 'mm'),
    origin: { x: Number(input.origin?.x || 0), y: Number(input.origin?.y || 0) },
    rotation: normalizeRotation(input.rotation || 0),
    mirror: Boolean(input.mirror),
    mirrorAxis: input.mirrorAxis === 'x' ? 'x' : 'y',
    parentId: input.parentId == null ? null : String(input.parentId),
    metadata: cloneCadValue(input.metadata || {}),
    schemaVersion: COORDINATE_SYSTEM_SCHEMA_VERSION,
  };
}

export function coordinateSystemLocalMatrix(system = {}) {
  const item = createCoordinateSystem(system);
  return composeTransform({ origin: { x:0, y:0 }, position: item.origin, rotation: item.rotation, mirror: item.mirror, mirrorAxis: item.mirrorAxis, unit: item.units, outputUnit: item.units });
}

export function buildCoordinateSystemManager(systems = []) {
  const normalized = systems.length ? systems.map(createCoordinateSystem) : [createCoordinateSystem()];
  const byId = new Map(normalized.map((item)=>[item.id,item]));
  function toRootMatrix(id, seen = new Set()) {
    if (!id) return identityMatrix();
    if (seen.has(id)) throw new Error(`Coordinate-system cycle detected at ${id}.`);
    const item = byId.get(id); if (!item) throw new Error(`Unknown coordinate system ${id}.`);
    seen.add(id);
    const local = coordinateSystemLocalMatrix(item);
    return item.parentId ? multiplyMatrix(toRootMatrix(item.parentId, seen), local) : local;
  }
  function transform(fromId, toId) { const fromRoot=toRootMatrix(fromId); const toRoot=toRootMatrix(toId); return multiplyMatrix(invertMatrix(toRoot), fromRoot); }
  return {
    systems: normalized,
    get(id){return byId.get(String(id))||null;},
    matrix(fromId,toId){return transform(String(fromId),String(toId));},
    point(point,fromId,toId){return applyMatrix(transform(String(fromId),String(toId)), point);},
    chain(id){ const output=[]; let current=byId.get(String(id)); const seen=new Set(); while(current){if(seen.has(current.id))throw new Error(`Coordinate-system cycle detected at ${current.id}.`); seen.add(current.id); output.push(current); current=current.parentId?byId.get(current.parentId):null;} return output; },
  };
}

export function normalizeRotationConvention(angle, { zeroDirection = 'east', direction = 'counter-clockwise' } = {}) {
  const zeroOffsets = { east:0, north:90, west:180, south:270 };
  const offset = zeroOffsets[String(zeroDirection).toLowerCase()] ?? 0;
  const signed = String(direction).toLowerCase().startsWith('clock') ? -Number(angle || 0) : Number(angle || 0);
  return normalizeRotation(offset + signed);
}
