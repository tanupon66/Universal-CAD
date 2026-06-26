function norm(value) {
  return String(value ?? '').trim();
}

function upper(value) {
  return norm(value).toUpperCase();
}

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function distance(a, b) {
  const ax = finite(a?.centerX); const ay = finite(a?.centerY);
  const bx = finite(b?.centerX); const by = finite(b?.centerY);
  if (ax == null || ay == null || bx == null || by == null) return null;
  return Math.hypot(ax - bx, ay - by);
}

function componentDistance(a, b) {
  const ax = finite(a?.centerX); const ay = finite(a?.centerY);
  const bx = finite(b?.centerX); const by = finite(b?.centerY);
  if (ax == null || ay == null || bx == null || by == null) return Infinity;
  return Math.hypot(ax - bx, ay - by);
}

function sameDimensions(a, b, tolerance = 0.001) {
  const pairs = [['width', 'width'], ['length', 'length']];
  return pairs.every(([ka, kb]) => {
    const av = finite(a?.[ka]); const bv = finite(b?.[kb]);
    return av == null || bv == null || Math.abs(av - bv) <= tolerance;
  });
}

function chooseComponent(original, candidates, used) {
  const available = candidates.filter((candidate) => !used.has(String(candidate.id)));
  const id = available.find((candidate) => String(candidate.id) === String(original.id) && (upper(candidate.name) === upper(original.name) || (upper(candidate.packageName) === upper(original.packageName) && candidate.lands?.length === original.lands?.length)));
  if (id) return { component: id, method: 'component-id' };

  const exact = available.filter((candidate) => upper(candidate.name) === upper(original.name) && upper(candidate.packageName) === upper(original.packageName));
  if (exact.length === 1) return { component: exact[0], method: 'name-package' };
  if (exact.length > 1) return { component: exact.sort((a, b) => componentDistance(original, a) - componentDistance(original, b))[0], method: 'name-package-position' };

  const byName = available.filter((candidate) => upper(candidate.name) === upper(original.name));
  if (byName.length === 1) return { component: byName[0], method: 'component-name' };
  if (byName.length > 1) return { component: byName.sort((a, b) => componentDistance(original, a) - componentDistance(original, b))[0], method: 'component-name-position' };

  const byPackageCount = available.filter((candidate) => upper(candidate.packageName) === upper(original.packageName) && candidate.lands?.length === original.lands?.length);
  if (byPackageCount.length === 1) return { component: byPackageCount[0], method: 'package-count' };
  if (byPackageCount.length > 1) return { component: byPackageCount.sort((a, b) => componentDistance(original, a) - componentDistance(original, b))[0], method: 'package-count-position' };

  return { component: null, method: 'unmatched-component' };
}

function matchLand(originalLand, generatedLands, usedGenerated, tolerance) {
  const byId = generatedLands.find((land) => !usedGenerated.has(land) && originalLand.globalId != null && Number(land.globalId) === Number(originalLand.globalId));
  if (byId) {
    const idDistance = distance(originalLand, byId);
    if (idDistance == null || idDistance <= Math.max(0.5, tolerance * 5)) return { land: byId, method: 'global-id', distance: idDistance };
  }

  let best = null;
  let bestDistance = Infinity;
  for (const candidate of generatedLands) {
    if (usedGenerated.has(candidate)) continue;
    const d = distance(originalLand, candidate);
    if (d == null || d > tolerance) continue;
    const dimensionPenalty = sameDimensions(originalLand, candidate) ? 0 : tolerance * 0.3;
    const score = d + dimensionPenalty;
    if (score < bestDistance) { best = candidate; bestDistance = score; }
  }
  return best ? { land: best, method: 'coordinate', distance: distance(originalLand, best) } : { land: null, method: 'unmatched-land', distance: null };
}

function originalLandName(land) { return norm(land?.originalCadName ?? land?.cadName); }

function rowStatus(originalLand, generatedLand, d, moveTolerance) {
  if (!generatedLand) return 'missing-generated';
  const renamed = originalLandName(originalLand) !== norm(generatedLand.cadName);
  const moved = d != null && d > moveTolerance;
  if (renamed && moved) return 'renamed-moved';
  if (renamed) return 'renamed';
  if (moved) return 'moved';
  return 'unchanged';
}

export function buildCadComparison(originalData, generatedData, options = {}) {
  const coordinateTolerance = Math.max(0.0001, Number(options.coordinateTolerance) || 0.08);
  const moveTolerance = Math.max(0, Number(options.moveTolerance) || 0.001);
  const originalComponents = originalData?.components || [];
  const generatedComponents = generatedData?.components || [];
  const usedGeneratedComponents = new Set();
  const componentPairs = [];
  const rows = [];

  for (const originalComponent of originalComponents) {
    const chosen = chooseComponent(originalComponent, generatedComponents, usedGeneratedComponents);
    const generatedComponent = chosen.component;
    if (generatedComponent) usedGeneratedComponents.add(String(generatedComponent.id));
    const pair = {
      originalComponentId: String(originalComponent.id),
      originalComponentName: originalComponent.name || '',
      generatedComponentId: generatedComponent ? String(generatedComponent.id) : null,
      generatedComponentName: generatedComponent?.name || '',
      originalPackage: originalComponent.packageName || '',
      generatedPackage: generatedComponent?.packageName || '',
      method: chosen.method,
      originalLandCount: originalComponent.lands?.length || 0,
      generatedLandCount: generatedComponent?.lands?.length || 0,
    };
    componentPairs.push(pair);

    if (!generatedComponent) {
      for (const originalLand of originalComponent.lands || []) {
        rows.push({
          originalComponentId: String(originalComponent.id), originalComponentName: originalComponent.name || '', originalPackage: originalComponent.packageName || '',
          generatedComponentId: null, generatedComponentName: '', generatedPackage: '',
          originalGlobalId: originalLand.globalId, generatedGlobalId: null,
          originalLocalIndex: originalLand.localIndex, generatedLocalIndex: null,
          originalName: originalLandName(originalLand), generatedName: '',
          originalX: originalLand.centerX, originalY: originalLand.centerY, generatedX: null, generatedY: null,
          distance: null, componentMethod: chosen.method, landMethod: 'unmatched-component', status: 'missing-generated',
        });
      }
      continue;
    }

    const usedGeneratedLands = new Set();
    for (const originalLand of originalComponent.lands || []) {
      const match = matchLand(originalLand, generatedComponent.lands || [], usedGeneratedLands, coordinateTolerance);
      if (match.land) usedGeneratedLands.add(match.land);
      const status = rowStatus(originalLand, match.land, match.distance, moveTolerance);
      rows.push({
        originalComponentId: String(originalComponent.id), originalComponentName: originalComponent.name || '', originalPackage: originalComponent.packageName || '',
        generatedComponentId: String(generatedComponent.id), generatedComponentName: generatedComponent.name || '', generatedPackage: generatedComponent.packageName || '',
        originalGlobalId: originalLand.globalId, generatedGlobalId: match.land?.globalId ?? null,
        originalLocalIndex: originalLand.localIndex, generatedLocalIndex: match.land?.localIndex ?? null,
        originalName: originalLandName(originalLand), generatedName: match.land?.cadName || '',
        originalX: originalLand.centerX, originalY: originalLand.centerY, generatedX: match.land?.centerX ?? null, generatedY: match.land?.centerY ?? null,
        distance: match.distance, componentMethod: chosen.method, landMethod: match.method, status,
      });
    }

    for (const generatedLand of generatedComponent.lands || []) {
      if (usedGeneratedLands.has(generatedLand)) continue;
      rows.push({
        originalComponentId: String(originalComponent.id), originalComponentName: originalComponent.name || '', originalPackage: originalComponent.packageName || '',
        generatedComponentId: String(generatedComponent.id), generatedComponentName: generatedComponent.name || '', generatedPackage: generatedComponent.packageName || '',
        originalGlobalId: null, generatedGlobalId: generatedLand.globalId,
        originalLocalIndex: null, generatedLocalIndex: generatedLand.localIndex,
        originalName: '', generatedName: generatedLand.cadName || '',
        originalX: null, originalY: null, generatedX: generatedLand.centerX, generatedY: generatedLand.centerY,
        distance: null, componentMethod: chosen.method, landMethod: 'extra-generated', status: 'extra-generated',
      });
    }
  }

  for (const generatedComponent of generatedComponents) {
    if (usedGeneratedComponents.has(String(generatedComponent.id))) continue;
    componentPairs.push({
      originalComponentId: null, originalComponentName: '', generatedComponentId: String(generatedComponent.id), generatedComponentName: generatedComponent.name || '',
      originalPackage: '', generatedPackage: generatedComponent.packageName || '', method: 'extra-generated-component', originalLandCount: 0, generatedLandCount: generatedComponent.lands?.length || 0,
    });
    for (const generatedLand of generatedComponent.lands || []) {
      rows.push({
        originalComponentId: null, originalComponentName: '', originalPackage: '',
        generatedComponentId: String(generatedComponent.id), generatedComponentName: generatedComponent.name || '', generatedPackage: generatedComponent.packageName || '',
        originalGlobalId: null, generatedGlobalId: generatedLand.globalId,
        originalLocalIndex: null, generatedLocalIndex: generatedLand.localIndex,
        originalName: '', generatedName: generatedLand.cadName || '',
        originalX: null, originalY: null, generatedX: generatedLand.centerX, generatedY: generatedLand.centerY,
        distance: null, componentMethod: 'extra-generated-component', landMethod: 'extra-generated', status: 'extra-generated',
      });
    }
  }

  const count = (status) => rows.filter((row) => row.status === status).length;
  const summary = {
    originalComponents: originalComponents.length,
    generatedComponents: generatedComponents.length,
    matchedComponents: componentPairs.filter((pair) => pair.originalComponentId != null && pair.generatedComponentId != null).length,
    unmatchedOriginalComponents: componentPairs.filter((pair) => pair.originalComponentId != null && pair.generatedComponentId == null).length,
    extraGeneratedComponents: componentPairs.filter((pair) => pair.originalComponentId == null && pair.generatedComponentId != null).length,
    totalRows: rows.length,
    matchedLands: rows.filter((row) => !['missing-generated', 'extra-generated'].includes(row.status)).length,
    unchanged: count('unchanged'), renamed: count('renamed'), moved: count('moved'), renamedMoved: count('renamed-moved'),
    missingGenerated: count('missing-generated'), extraGenerated: count('extra-generated'),
    coordinateTolerance, moveTolerance,
  };

  const byOriginalComponentId = new Map();
  const byGeneratedComponentId = new Map();
  for (const row of rows) {
    if (row.originalComponentId != null) {
      if (!byOriginalComponentId.has(row.originalComponentId)) byOriginalComponentId.set(row.originalComponentId, []);
      byOriginalComponentId.get(row.originalComponentId).push(row);
    }
    if (row.generatedComponentId != null) {
      if (!byGeneratedComponentId.has(row.generatedComponentId)) byGeneratedComponentId.set(row.generatedComponentId, []);
      byGeneratedComponentId.get(row.generatedComponentId).push(row);
    }
  }
  return { rows, componentPairs, summary, byOriginalComponentId, byGeneratedComponentId };
}

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function cadComparisonToCsv(comparison) {
  const rows = [[
    'status','original_component','generated_component','original_package','generated_package','original_local','generated_local',
    'original_xml_id','generated_xml_id','original_name','generated_name','original_x_mm','original_y_mm','generated_x_mm','generated_y_mm','distance_mm','component_match','land_match',
  ]];
  for (const row of comparison?.rows || []) rows.push([
    row.status, row.originalComponentName, row.generatedComponentName, row.originalPackage, row.generatedPackage,
    row.originalLocalIndex, row.generatedLocalIndex, row.originalGlobalId, row.generatedGlobalId,
    row.originalName, row.generatedName, row.originalX, row.originalY, row.generatedX, row.generatedY,
    row.distance, row.componentMethod, row.landMethod,
  ]);
  return rows.map((row) => row.map(csvEscape).join(',')).join('\r\n');
}
