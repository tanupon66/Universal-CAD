import { validateGeometry } from './geometry.js';

export const VALIDATION_LEVELS = Object.freeze(['info', 'warning', 'error', 'blocking-error']);
function issue(code, level, message, context = {}, overridable = false) {
  return { id: `${code}:${Object.values(context).join(':')}`, code, level, message, context, overridable, overridden: false, overrideReason: '', createdAt: new Date().toISOString() };
}
function normalized(value) { return String(value ?? '').trim().toUpperCase(); }
function finite(value) { return Number.isFinite(Number(value)); }
function duplicateGroups(items, keyFn, scopeFn) {
  const groups = new Map();
  for (const item of items || []) {
    const key = normalized(keyFn(item)); if (!key) continue;
    const scope = String(scopeFn(item) || 'global'); const composite = `${scope}\u0000${key}`;
    if (!groups.has(composite)) groups.set(composite, []); groups.get(composite).push(item);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}
function pointOutsideBoard(component, board) {
  const x = Number(component.position?.x), y = Number(component.position?.y), width = Number(board?.width), height = Number(board?.height);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return false;
  const originX = Number(board?.metadata?.MinX ?? board?.metadata?.minX ?? 0) || 0;
  const originY = Number(board?.metadata?.MinY ?? board?.metadata?.minY ?? 0) || 0;
  return x < originX || y < originY || x > originX + width || y > originY + height;
}
export function validateUniversalCad(model, options = {}) {
  const issues = [];
  const components = model?.components || []; const packages = model?.packages || []; const lands = model?.lands || [];
  const packageById = new Map(packages.map((item) => [String(item.id), item]));
  const componentById = new Map(components.map((item) => [String(item.id), item]));
  for (const group of duplicateGroups(components, (item) => item.reference, (item) => item.boardId || 'board:main')) {
    issues.push(issue('DUPLICATE_REFERENCE', 'blocking-error', `Reference ${group[0].reference} ซ้ำภายใน Board เดียวกัน`, { boardId: group[0].boardId || 'board:main', componentIds: group.map((item) => item.id).join(',') }, false));
  }
  for (const group of duplicateGroups(lands, (item) => item.name, (item) => item.componentId)) {
    issues.push(issue('DUPLICATE_LAND_NAME_COMPONENT', 'error', `Land name ${group[0].name} ซ้ำภายใน Component`, { componentId: group[0].componentId, landIds: group.map((item) => item.id).join(',') }, true));
  }
  for (const pkg of packages) {
    const template = (pkg.templateLandIds || []).map((id) => lands.find((land) => String(land.id) === String(id))).filter(Boolean);
    for (const group of duplicateGroups(template, (item) => item.name, () => pkg.id)) issues.push(issue('DUPLICATE_LAND_NAME_PACKAGE', 'error', `Land name ${group[0].name} ซ้ำใน Package ${pkg.name || pkg.id}`, { packageId: pkg.id, landIds: group.map((item) => item.id).join(',') }, true));
    if (!(pkg.templateLandIds || []).length) issues.push(issue('EMPTY_PACKAGE', 'warning', `Package ${pkg.name || pkg.id} ไม่มี Template Land`, { packageId: pkg.id }, true));
    if (!pkg.pin1 && options.requirePolarity) issues.push(issue('MISSING_POLARITY', 'warning', `Package ${pkg.name || pkg.id} ยังไม่ได้กำหนด Pin 1/Polarity`, { packageId: pkg.id }, true));
  }
  for (const component of components) {
    if (!String(component.reference || '').trim()) issues.push(issue('BROKEN_REFERENCE', 'blocking-error', `Component ${component.id} ไม่มี Reference`, { componentId: component.id }, false));
    if (!component.packageId || !packageById.has(String(component.packageId))) issues.push(issue('MISSING_PACKAGE', 'blocking-error', `Component ${component.reference || component.id} ไม่มี Package ที่ถูกต้อง`, { componentId: component.id, packageId: component.packageId || '' }, false));
    if (pointOutsideBoard(component, model.boardDefinition)) issues.push(issue('COMPONENT_OUTSIDE_BOARD', 'error', `Component ${component.reference || component.id} อยู่นอก Board`, { componentId: component.id, x: component.position?.x, y: component.position?.y }, true));
  }
  for (const land of lands) {
    const geometry = validateGeometry(land.geometry || {});
    if (!geometry.valid) {
      const zero = geometry.issues.some((item) => item.code === 'INVALID_RECTANGLE' && /มากกว่า 0|ขนาด/.test(item.message)) || geometry.area === 0;
      issues.push(issue(zero ? 'ZERO_SIZE_LAND' : 'INVALID_GEOMETRY', 'blocking-error', `${land.name || land.id}: ${geometry.issues.map((item) => item.message).join('; ')}`, { landId: land.id, componentId: land.componentId }, false));
    }
    if (!componentById.has(String(land.componentId))) issues.push(issue('BROKEN_LAND_COMPONENT', 'blocking-error', `Land ${land.id} อ้าง Component ที่ไม่มี`, { landId: land.id, componentId: land.componentId }, false));
    if (!packageById.has(String(land.packageId))) issues.push(issue('BROKEN_LAND_PACKAGE', 'blocking-error', `Land ${land.id} อ้าง Package ที่ไม่มี`, { landId: land.id, packageId: land.packageId }, false));
  }
  for (const group of duplicateGroups(components, (item) => `${Number(item.position?.x).toFixed(6)}:${Number(item.position?.y).toFixed(6)}:${normalized(item.side)}`, (item) => item.boardId || 'board:main')) {
    if (group.every((item) => finite(item.position?.x) && finite(item.position?.y))) issues.push(issue('DUPLICATE_PLACEMENT', 'warning', `พบ Component ${group.length} ตัววางตำแหน่งเดียวกัน`, { componentIds: group.map((item) => item.id).join(',') }, true));
  }
  const bomRows = options.bom || model.bom || [];
  if (bomRows.length) {
    const cadRefs = new Map(components.map((item) => [normalized(item.reference), item]));
    const bomRefs = new Map();
    for (const row of bomRows) for (const ref of Array.isArray(row.references) ? row.references : String(row.reference || row.refDes || '').split(/[\s,;]+/)) if (normalized(ref)) bomRefs.set(normalized(ref), row);
    for (const [ref, component] of cadRefs) if (!bomRefs.has(ref)) issues.push(issue('CAD_MISSING_IN_BOM', 'warning', `${component.reference} มีใน CAD แต่ไม่มีใน BOM`, { componentId: component.id, reference: component.reference }, true));
    for (const [ref, row] of bomRefs) if (!cadRefs.has(ref)) issues.push(issue('BOM_MISSING_IN_CAD', 'warning', `${ref} มีใน BOM แต่ไม่มีใน CAD`, { reference: ref }, true));
    for (const [ref, row] of bomRefs) {
      const component = cadRefs.get(ref); if (!component) continue;
      const bomPart = String(row.partNumber || row.mpn || ''); const cadPart = String(component.partNumber || '');
      if (bomPart && cadPart && normalized(bomPart) !== normalized(cadPart)) issues.push(issue('PART_NUMBER_CONFLICT', 'error', `${ref}: Part Number ใน CAD และ BOM ไม่ตรงกัน`, { reference: ref, cadPart, bomPart }, true));
      const bomPackage = String(row.package || row.footprint || ''); const cadPackage = packageById.get(String(component.packageId))?.name || '';
      if (bomPackage && cadPackage && normalized(bomPackage) !== normalized(cadPackage)) issues.push(issue('PACKAGE_CONFLICT', 'warning', `${ref}: Package ใน CAD และ BOM ไม่ตรงกัน`, { reference: ref, cadPackage, bomPackage }, true));
      if (row.side && component.side && normalized(row.side) !== normalized(component.side)) issues.push(issue('SIDE_CONFLICT', 'warning', `${ref}: Side ไม่ตรงกัน`, { reference: ref, cadSide: component.side, bomSide: row.side }, true));
      if (finite(row.rotation) && finite(component.rotation) && Math.abs((((Number(row.rotation) - Number(component.rotation)) % 360) + 540) % 360 - 180) > Number(options.rotationTolerance ?? 0.1)) issues.push(issue('ROTATION_CONFLICT', 'warning', `${ref}: Rotation ไม่ตรงกัน`, { reference: ref, cadRotation: component.rotation, bomRotation: row.rotation }, true));
    }
  }
  if (options.expectedUnits && normalized(options.expectedUnits) !== normalized(model?.units)) issues.push(issue('UNIT_CONFLICT', 'blocking-error', `Unit ของ Project (${model?.units}) ไม่ตรงกับข้อมูล (${options.expectedUnits})`, { projectUnits: model?.units, expectedUnits: options.expectedUnits }, false));
  for (const record of options.unsupportedRecords || []) issues.push(issue('UNSUPPORTED_SOURCE_RECORD', 'warning', `ไม่สามารถนำเข้า Source record: ${record.reason || record.type || 'unknown'}`, { type: record.type || '', reason: record.reason || '' }, true));
  const counts = Object.fromEntries(VALIDATION_LEVELS.map((level) => [level, issues.filter((item) => item.level === level).length]));
  const blocking = issues.filter((item) => item.level === 'blocking-error' && !item.overridden);
  return { issues, counts, valid: blocking.length === 0 && counts.error === 0, exportAllowed: blocking.length === 0, blockingCount: blocking.length, validatedAt: new Date().toISOString(), revision: Number(model?.revision || 0) };
}
export function overrideValidationIssue(validation, issueId, reason, options = {}) {
  const target = validation?.issues?.find((item) => item.id === issueId); if (!target) throw new Error(`ไม่พบ Validation issue ${issueId}`);
  if (!target.overridable && !options.allowBlockingOverride) throw new Error(`Issue ${target.code} ไม่อนุญาตให้ Override`);
  const text = String(reason || '').trim(); if (!text) throw new Error('ต้องระบุเหตุผลในการ Override');
  target.overridden = true; target.overrideReason = text; target.overriddenAt = new Date().toISOString(); target.overriddenBy = String(options.user || 'local-user');
  validation.blockingCount = validation.issues.filter((item) => item.level === 'blocking-error' && !item.overridden).length;
  validation.exportAllowed = validation.blockingCount === 0;
  return target;
}
export function exportPreflight(model, options = {}) {
  const validation = validateUniversalCad(model, options);
  return { ...validation, blockingErrors: validation.issues.filter((item) => item.level === 'blocking-error' && !item.overridden), warnings: validation.issues.filter((item) => item.level === 'warning' && !item.overridden) };
}
