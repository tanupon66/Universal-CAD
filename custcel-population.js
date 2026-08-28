import { cloneCadValue } from './universal-cad-model.js';

function normalizeRef(value) { return String(value ?? '').trim().toUpperCase(); }
function looksLikeReference(value) {
  const text = String(value ?? '').trim();
  return /[A-Za-z]/.test(text) && /\d/.test(text) && /^[A-Za-z0-9_.+\-/#]+$/.test(text);
}

function explicitNonPopLine(line) {
  const match = String(line || '').match(/^\s*([^\s*]+)\s+(NONPOP|NON-POP|DNP|DNI)(?:\s|$)/i);
  if (!match || !looksLikeReference(match[1])) return null;
  return { reference: match[1], status: match[2].toUpperCase() };
}

function sourceBoardName(lines) {
  for (const line of lines.slice(0, 12)) {
    const match = line.match(/CATENA\s*\/\/\s*([^*]+?)(?:\s*\*|$)/i);
    if (match?.[1]) return match[1].trim();
  }
  return '';
}

/** Parse a customer Custcel population file without treating generic NONE/blank
 * fields as Non-Pop. Only explicit population statuses are allowed to delete CAD. */
export function parseCustcelText(text, options = {}) {
  const source = String(text ?? '').replace(/^\uFEFF/, '');
  const lines = source.split(/\r?\n/);
  const nonPopByRef = new Map();
  let dataRowCount = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const first = line.trim().split(/\s+/, 1)[0] || '';
    if (looksLikeReference(first)) dataRowCount += 1;
    const record = explicitNonPopLine(line);
    if (!record) continue;
    const key = normalizeRef(record.reference);
    if (!nonPopByRef.has(key)) nonPopByRef.set(key, { ...record, reference: record.reference.trim(), line: index + 1 });
  }
  const nonPopRecords = [...nonPopByRef.values()];
  const fileName = String(options.fileName || '');
  const hasCustcelName = /custcel/i.test(fileName);
  const hasCatenaHeader = /CATENA\s*\/\//i.test(lines.slice(0, 12).join('\n'));
  const recognized = nonPopRecords.length > 0 && (hasCustcelName || hasCatenaHeader || nonPopRecords.length >= 3);
  return {
    recognized,
    format: recognized ? 'custcel-population' : 'unknown',
    fileName,
    sourceBoard: sourceBoardName(lines),
    lineCount: lines.length,
    dataRowCount,
    nonPopCount: nonPopRecords.length,
    nonPopRefs: nonPopRecords.map((item) => item.reference),
    nonPopRecords,
    warnings: recognized ? [] : ['The text does not contain a recognizable Custcel population list.'],
  };
}

function rowReferences(row) {
  if (Array.isArray(row?.references)) return row.references.map(String).map((item) => item.trim()).filter(Boolean);
  const value = row?.location ?? row?.reference ?? row?.refDes ?? '';
  return String(value).split(/[\s,;]+/).map((item) => item.trim()).filter(looksLikeReference);
}

function removeBomReferences(rows, removingRefs) {
  if (!Array.isArray(rows) || !rows.length || !removingRefs.size) return cloneCadValue(rows || []);
  const output = [];
  for (const source of rows) {
    const refs = rowReferences(source);
    if (!refs.length) { output.push(cloneCadValue(source)); continue; }
    const kept = refs.filter((ref) => !removingRefs.has(normalizeRef(ref)));
    if (!kept.length) continue;
    const row = cloneCadValue(source);
    if (Array.isArray(row.references)) row.references = kept;
    if ('location' in row) row.location = kept.join(', ');
    if ('reference' in row) row.reference = kept.length === 1 ? kept[0] : kept.join(', ');
    if ('refDes' in row) row.refDes = kept.length === 1 ? kept[0] : kept.join(', ');
    if (refs.length !== kept.length && ('quantity' in row || 'qty' in row)) {
      if ('quantity' in row) row.quantity = kept.length;
      if ('qty' in row) row.qty = kept.length;
    }
    output.push(row);
  }
  return output;
}

/** Apply Custcel to a cloned Working Revision. The immutable imported source is
 * never changed. Components, their lands, package templates, net connections,
 * and embedded BOM rows are kept internally consistent. */
export function applyCustcelPopulation(model, parsed, options = {}) {
  const next = cloneCadValue(model);
  const requested = new Set((parsed?.nonPopRefs || []).map(normalizeRef).filter(Boolean));
  const components = Array.isArray(next?.components) ? next.components : [];
  const removing = components.filter((component) => requested.has(normalizeRef(component.reference || component.id)));
  const removedComponentIds = new Set(removing.map((component) => String(component.id)));
  const removedReferences = new Set(removing.map((component) => normalizeRef(component.reference || component.id)));
  const removedLandIds = new Set((next?.lands || []).filter((land) => removedComponentIds.has(String(land.componentId))).map((land) => String(land.id)));

  next.components = components.filter((component) => !removedComponentIds.has(String(component.id)));
  next.lands = (next?.lands || []).filter((land) => !removedComponentIds.has(String(land.componentId)));

  const landIdSet = new Set(next.lands.map((land) => String(land.id)));
  for (const component of next.components) component.landIds = (component.landIds || []).filter((id) => landIdSet.has(String(id)));

  const componentsByPackage = new Map();
  for (const component of next.components) {
    const key = String(component.packageId || '');
    if (!componentsByPackage.has(key)) componentsByPackage.set(key, []);
    componentsByPackage.get(key).push(component);
  }
  next.packages = (next?.packages || []).filter((pkg) => componentsByPackage.has(String(pkg.id))).map((pkg) => {
    const item = cloneCadValue(pkg);
    const users = componentsByPackage.get(String(pkg.id)) || [];
    const source = users.find((component) => String(component.id) === String(item.sourceComponentId)) || users[0];
    item.usageCount = users.length;
    item.sourceComponentId = source ? String(source.id) : null;
    item.templateLandIds = source ? (source.landIds || []).filter((id) => landIdSet.has(String(id))) : [];
    return item;
  });

  next.nets = (next?.nets || []).map((net) => ({
    ...net,
    connections: (net.connections || []).filter((connection) => {
      if (connection.componentRef && removedReferences.has(normalizeRef(connection.componentRef))) return false;
      if (connection.landId && removedLandIds.has(String(connection.landId))) return false;
      return true;
    }),
  }));
  next.bom = removeBomReferences(next?.bom || [], removedReferences);

  const existingMetadata = next.metadata && typeof next.metadata === 'object' ? next.metadata : {};
  next.metadata = {
    ...existingMetadata,
    populationSource: {
      ...(existingMetadata.populationSource || {}),
      type: 'custcel',
      fileName: String(options.fileName || parsed?.fileName || ''),
      sourceBoard: String(parsed?.sourceBoard || ''),
      appliedAt: new Date().toISOString(),
      nonPopCount: requested.size,
      removedComponentCount: removing.length,
      removedLandCount: removedLandIds.size,
    },
  };

  const matched = new Set(removing.map((component) => normalizeRef(component.reference || component.id)));
  const unmatchedRefs = (parsed?.nonPopRefs || []).filter((ref) => !matched.has(normalizeRef(ref)));
  return {
    model: next,
    requestedCount: requested.size,
    removedComponents: removing.map((component) => ({ id: String(component.id), reference: String(component.reference || component.id) })),
    removedComponentCount: removing.length,
    removedLandCount: removedLandIds.size,
    unmatchedRefs,
  };
}

export { normalizeRef as normalizeCustcelReference };
