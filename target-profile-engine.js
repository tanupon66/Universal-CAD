import { cloneCadValue } from './universal-cad-model.js';

const normalize = (v) => String(v ?? '').trim();
const finite = (v) => Number.isFinite(Number(v));

export const TARGET_PROFILE_SCHEMA_VERSION = 1;

export const DEFAULT_TARGET_PROFILE = Object.freeze({
  id: 'generic-manufacturing-target',
  name: 'Generic Manufacturing Target',
  schemaVersion: TARGET_PROFILE_SCHEMA_VERSION,
  output: { format: 'inspection-xml', extension: '.xml', encoding: 'utf-8', lineEnding: 'CRLF' },
  numeric: { coordinatePrecision: 3, anglePrecision: 3, sizePrecision: 3, stripTrailingZeros: true },
  required: { board: true, components: true, packages: false, lands: true, nets: false, layers: false, holes: false },
  rules: { requireSequentialIds: true, allowEmptyPackage: false, maxReferenceLength: 64, maxLandNameLength: 64 },
});

export function normalizeTargetProfile(input = {}) {
  const profile = cloneCadValue({ ...DEFAULT_TARGET_PROFILE, ...input });
  profile.output = { ...DEFAULT_TARGET_PROFILE.output, ...(input.output || {}) };
  profile.numeric = { ...DEFAULT_TARGET_PROFILE.numeric, ...(input.numeric || {}) };
  profile.required = { ...DEFAULT_TARGET_PROFILE.required, ...(input.required || {}) };
  profile.rules = { ...DEFAULT_TARGET_PROFILE.rules, ...(input.rules || {}) };
  profile.schemaVersion = TARGET_PROFILE_SCHEMA_VERSION;
  profile.id = normalize(profile.id) || DEFAULT_TARGET_PROFILE.id;
  profile.name = normalize(profile.name) || profile.id;
  for (const key of ['coordinatePrecision','anglePrecision','sizePrecision']) {
    profile.numeric[key] = Math.max(0, Math.min(9, Math.trunc(Number(profile.numeric[key]) || 0)));
  }
  return profile;
}

export function validateModelAgainstTargetProfile(model, inputProfile = {}) {
  const profile = normalizeTargetProfile(inputProfile);
  const issues = [];
  const counts = {
    components: model?.components?.length || 0,
    packages: model?.packages?.length || 0,
    lands: model?.lands?.length || 0,
    nets: model?.nets?.length || 0,
    layers: model?.layers?.length || 0,
    holes: model?.holes?.length || 0,
  };
  if (profile.required.board && !model?.boardDefinition) issues.push({ level: 'blocking', code: 'TARGET_BOARD_REQUIRED', message: 'Target profile requires a board definition.' });
  for (const key of ['components','packages','lands','nets','layers','holes']) {
    if (profile.required[key] && !counts[key]) issues.push({ level: 'blocking', code: `TARGET_${key.toUpperCase()}_REQUIRED`, message: `Target profile requires ${key}.` });
  }
  const packageIds = new Set((model?.packages || []).map((p) => String(p.id)));
  for (const component of model?.components || []) {
    const ref = normalize(component.reference);
    if (!ref) issues.push({ level: 'blocking', code: 'TARGET_EMPTY_REFERENCE', message: 'A component reference is empty.', context: { componentId: component.id } });
    if (ref.length > profile.rules.maxReferenceLength) issues.push({ level: 'error', code: 'TARGET_REFERENCE_TOO_LONG', message: `${ref} exceeds the target reference length.`, context: { componentId: component.id } });
    if (!profile.rules.allowEmptyPackage && (!component.packageId || !packageIds.has(String(component.packageId)))) issues.push({ level: 'error', code: 'TARGET_PACKAGE_MISSING', message: `${ref || component.id} has no valid package.`, context: { componentId: component.id } });
    if (!finite(component.position?.x) || !finite(component.position?.y)) issues.push({ level: 'blocking', code: 'TARGET_COMPONENT_COORDINATE_INVALID', message: `${ref || component.id} has invalid coordinates.`, context: { componentId: component.id } });
  }
  for (const land of model?.lands || []) {
    const name = normalize(land.name);
    if (name.length > profile.rules.maxLandNameLength) issues.push({ level: 'error', code: 'TARGET_LAND_NAME_TOO_LONG', message: `${name} exceeds the target land-name length.`, context: { landId: land.id } });
    const g = land.geometry || {};
    if (![g.left, g.top, g.width, g.height].every(finite)) issues.push({ level: 'blocking', code: 'TARGET_LAND_GEOMETRY_INVALID', message: `Land ${name || land.id} has invalid rectangle geometry.`, context: { landId: land.id } });
  }
  return {
    profile,
    counts,
    compatible: !issues.some((i) => i.level === 'blocking'),
    issues,
    summary: { blocking: issues.filter((i) => i.level === 'blocking').length, errors: issues.filter((i) => i.level === 'error').length, warnings: issues.filter((i) => i.level === 'warning').length },
  };
}

export function formatTargetNumber(value, kind, inputProfile = {}) {
  const profile = normalizeTargetProfile(inputProfile);
  const precision = kind === 'angle' ? profile.numeric.anglePrecision : kind === 'size' ? profile.numeric.sizePrecision : profile.numeric.coordinatePrecision;
  if (!finite(value)) return '';
  const fixed = Number(value).toFixed(precision);
  return profile.numeric.stripTrailingZeros ? fixed.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1') : fixed;
}

export function exportTargetProfile(profile) {
  return JSON.stringify(normalizeTargetProfile(profile), null, 2);
}
