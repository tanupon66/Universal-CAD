import { csvCell, protectSpreadsheetText } from './export-safety.js';
import { buildTableWorkbookXlsx } from './xlsx-report.js';

export const BOM_FIELDS = Object.freeze([
  { key: 'location', label: 'Location' },
  { key: 'partNumber', label: 'Part Number' },
  { key: 'description', label: 'Description' },
  { key: 'package', label: 'Package' },
  { key: 'quantity', label: 'Quantity' },
  { key: 'side', label: 'Side' },
  { key: 'rotation', label: 'Rotation' },
  { key: 'x', label: 'X' },
  { key: 'y', label: 'Y' },
  { key: 'revision', label: 'Revision' },
]);

function labelFor(key) { return BOM_FIELDS.find((item) => item.key === key)?.label || key; }
function packageMap(model) { return new Map((model?.packages || []).map((item) => [String(item.id), item])); }
function normalizeRef(value) { return String(value ?? '').trim().toUpperCase(); }
function looksLikeReference(value) {
  const text = String(value ?? '').trim();
  return /[A-Za-z]/.test(text) && /\d/.test(text) && /^[A-Za-z0-9_.+\-/#]+$/.test(text);
}
function sourceRowRefs(row) {
  if (Array.isArray(row?.references)) return row.references.map(String).map((item) => item.trim()).filter(looksLikeReference);
  const location = String(row?.location ?? row?.reference ?? row?.refDes ?? row?.references ?? '').trim();
  return location.split(/[\s,;]+/).map((item) => item.trim()).filter(looksLikeReference);
}

/** Keep source BOM metadata, but only for references that still exist in the
 * current Working Revision. This prevents deleted/Non-Pop parts from returning
 * when BOM CSV/XLSX is exported. */
export function filterBomRowsToModel(model, rows) {
  const source = Array.isArray(rows) ? rows : [];
  const activeRefs = new Set((model?.components || []).map((component) => normalizeRef(component.reference || component.id)).filter(Boolean));
  if (!activeRefs.size) return source.map((row) => ({ ...row }));
  const output = [];
  for (const row of source) {
    const refs = sourceRowRefs(row);
    if (!refs.length) { output.push({ ...row }); continue; }
    const kept = refs.filter((ref) => activeRefs.has(normalizeRef(ref)));
    if (!kept.length) continue;
    const next = { ...row };
    if (Array.isArray(next.references)) next.references = kept;
    if ('location' in next) next.location = kept.join(', ');
    if ('reference' in next) next.reference = kept.length === 1 ? kept[0] : kept.join(', ');
    if ('refDes' in next) next.refDes = kept.length === 1 ? kept[0] : kept.join(', ');
    if (refs.length !== kept.length) {
      if ('quantity' in next) next.quantity = kept.length;
      if ('qty' in next) next.qty = kept.length;
    }
    output.push(next);
  }
  return output;
}

export function buildBomRows(model, options = {}) {
  const packages = packageMap(model);
  const sourceBom = Array.isArray(options.bom) && options.bom.length ? options.bom : (model?.bom || []);
  if (sourceBom.length && options.preferSourceBom !== false) {
    const synchronizedBom = options.syncToWorkingModel === false ? sourceBom : filterBomRowsToModel(model, sourceBom);
    return synchronizedBom.map((row, index) => ({
      location: String(row.location ?? row.reference ?? row.refDes ?? row.references ?? ''),
      partNumber: String(row.partNumber ?? row.mpn ?? row.pn ?? ''),
      description: String(row.description ?? row.desc ?? ''),
      package: String(row.package ?? row.footprint ?? ''),
      quantity: Number(row.quantity ?? row.qty ?? 1) || 1,
      side: String(row.side ?? ''), rotation: Number.isFinite(Number(row.rotation)) ? Number(row.rotation) : '',
      x: Number.isFinite(Number(row.x)) ? Number(row.x) : '', y: Number.isFinite(Number(row.y)) ? Number(row.y) : '',
      revision: String(row.revision ?? ''), sourceIndex: index,
    }));
  }
  const rows = (model?.components || []).map((component, index) => ({
    location: String(component.reference || component.id || ''),
    partNumber: String(component.partNumber || ''),
    description: String(component.metadata?.description || ''),
    package: String(packages.get(String(component.packageId))?.name || component.packageId || ''),
    quantity: 1,
    side: String(component.side || ''),
    rotation: Number.isFinite(Number(component.rotation)) ? Number(component.rotation) : '',
    x: Number.isFinite(Number(component.position?.x)) ? Number(component.position.x) : '',
    y: Number.isFinite(Number(component.position?.y)) ? Number(component.position.y) : '',
    revision: String(component.revision || ''), sourceIndex: index,
  }));
  if (options.aggregate === false) return rows;
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.partNumber}\u0000${row.package}\u0000${row.description}`;
    if (!groups.has(key)) groups.set(key, { ...row, location: [], quantity: 0 });
    const group = groups.get(key); group.location.push(row.location); group.quantity += 1;
  }
  return [...groups.values()].map((row) => ({ ...row, location: row.location.join(', ') }));
}

export function normalizeBomLayout(layout = {}) {
  const valid = new Set(BOM_FIELDS.map((f) => f.key));
  const order = (layout.order || BOM_FIELDS.map((f) => f.key)).filter((key, index, arr) => valid.has(key) && arr.indexOf(key) === index);
  for (const field of BOM_FIELDS) if (!order.includes(field.key)) order.push(field.key);
  return { order, orientation: layout.orientation === 'rows' ? 'rows' : 'columns', includeHeader: layout.includeHeader !== false };
}

export function moveBomField(layout, key, targetIndex) {
  const normalized = normalizeBomLayout(layout); const order = normalized.order.filter((item) => item !== key);
  const index = Math.max(0, Math.min(order.length, Number(targetIndex) || 0)); order.splice(index, 0, key); return { ...normalized, order };
}

export function bomTable(rows, layout = {}) {
  const cfg = normalizeBomLayout(layout); const safe = (v) => protectSpreadsheetText(v);
  if (cfg.orientation === 'rows') {
    const output = cfg.order.map((key) => [labelFor(key), ...rows.map((row) => safe(row[key]))]);
    return output;
  }
  const body = rows.map((row) => cfg.order.map((key) => safe(row[key])));
  return cfg.includeHeader ? [cfg.order.map(labelFor), ...body] : body;
}

export function buildBomCsv(rows, layout = {}) {
  return `${bomTable(rows, layout).map((row) => row.map((value) => csvCell(value)).join(',')).join('\r\n')}\r\n`;
}

export async function buildBomXlsx(rows, layout = {}, options = {}) {
  const table = bomTable(rows, layout);
  const cfg = normalizeBomLayout(layout);
  const columnCount = Math.max(1, ...table.map((row) => row.length));
  return buildTableWorkbookXlsx({
    title: options.title || 'BOM Export', generatedAt: options.generatedAt,
    sheets: [{ name: options.sheetName || 'BOM', rows: table, columns: Array(columnCount).fill(20), freeze: cfg.orientation === 'columns' ? { rows: cfg.includeHeader ? 1 : 0, columns: 0 } : { rows: 0, columns: 1 } }],
  });
}

export function bomLayoutColumnLetter(layout, key) {
  const index = normalizeBomLayout(layout).order.indexOf(key); if (index < 0) return '';
  let n = index + 1, out = ''; while (n > 0) { const r = (n - 1) % 26; out = String.fromCharCode(65 + r) + out; n = Math.floor((n - 1) / 26); }
  return out;
}
