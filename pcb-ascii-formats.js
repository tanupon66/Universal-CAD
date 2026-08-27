import { ParseError, ValidationError } from './cad-errors.js';
import { compactPopulationMetadata, inferPopulationFields } from './component-population.js';

const MM_PER_INCH = 25.4;
const DEFAULT_LAND_MM = 0.5;

function finite(value, fallback = null) {
  const number = Number(String(value ?? '').trim().replace(',', '.'));
  return Number.isFinite(number) ? number : fallback;
}
function xmlEscape(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function quote(value) {
  return `"${String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
function normalizeSide(value) { return /bottom|bot|yes|true|mirror/i.test(String(value || '')) ? 'Bottom' : 'Top'; }
function normalizeRotation(value) {
  const n = finite(value, 0) || 0;
  return ((n % 360) + 360) % 360;
}
function rotatePoint(x, y, degrees) {
  const rad = normalizeRotation(degrees) * Math.PI / 180;
  const c = Math.cos(rad); const s = Math.sin(rad);
  return { x: x * c - y * s, y: x * s + y * c };
}
function inverseRotatePoint(x, y, degrees) { return rotatePoint(x, y, -normalizeRotation(degrees)); }
function uniqueName(base, used) {
  let name = String(base || 'ITEM').replace(/[\r\n]/g, ' ').trim() || 'ITEM';
  if (!used.has(name)) { used.add(name); return name; }
  let index = 2;
  while (used.has(`${name}_${index}`)) index += 1;
  name = `${name}_${index}`; used.add(name); return name;
}
function tokenizeWhitespace(line = '') {
  const out = []; let token = ''; let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') { quoted = !quoted; continue; }
    if (!quoted && /\s/.test(ch)) { if (token) { out.push(token); token = ''; } continue; }
    token += ch;
  }
  if (token) out.push(token);
  return out;
}
function splitBang(line = '') {
  const out = []; let token = ''; let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { token += '"'; i += 1; continue; }
      quoted = !quoted; continue;
    }
    if (ch === '!' && !quoted) { out.push(token); token = ''; continue; }
    token += ch;
  }
  out.push(token);
  if (out[out.length - 1] === '') out.pop();
  return out;
}
function sectionText(source, name) {
  const match = String(source || '').match(new RegExp(`\\$${name}\\s*\\r?\\n([\\s\\S]*?)\\$END${name}`, 'i'));
  return match?.[1] || '';
}
function lineList(text) { return String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean); }
function sourceUnitFromGencad(header) {
  const line = lineList(header).find((item) => /^UNITS\b/i.test(item)) || '';
  const tokens = tokenizeWhitespace(line).map((item) => item.toUpperCase());
  if (tokens.includes('INCH') || tokens.includes('INCHES')) return { name: 'inch', toMm: MM_PER_INCH, warning: '' };
  if (tokens.includes('MM') || tokens.includes('MILLIMETERS') || tokens.includes('MILLIMETRES')) return { name: 'mm', toMm: 1, warning: '' };
  if (tokens[1] === 'USER' && finite(tokens[2], null) === 1000) return { name: 'user-1000', toMm: MM_PER_INCH / 1000, warning: 'CAD ASCII USER 1000 units were interpreted as 0.001 inch using the common exchange convention.' };
  return { name: 'unknown', toMm: MM_PER_INCH / 1000, warning: `Unknown CAD ASCII unit '${line || 'missing'}'; using 0.001 inch as the fallback.` };
}
function boardBoundsFromLines(lines, scale) {
  const points = [];
  for (const line of lines) {
    const t = tokenizeWhitespace(line);
    if (!['LINE', 'ARC', 'CIRCLE'].includes(String(t[0] || '').toUpperCase())) continue;
    for (let i = 1; i + 1 < t.length; i += 2) {
      const x = finite(t[i], null); const y = finite(t[i + 1], null);
      if (x != null && y != null) points.push({ x: x * scale, y: y * scale });
    }
  }
  if (!points.length) return null;
  const xs = points.map((p) => p.x); const ys = points.map((p) => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}
function componentMetadataAttributes(component = {}) {
  const metadata = compactPopulationMetadata(component.sourceMetadata || component.metadata || {});
  const attributes = [
    `ComponentNumberId="${xmlEscape(component.packageName)}"`,
    `ComponentNumberRevision="${xmlEscape(component.revision || '')}"`,
  ];
  if (component.variation) attributes.push(`UCADVariation="${xmlEscape(component.variation)}"`);
  if (component.populationStatus) attributes.push(`UCADPopulationStatus="${xmlEscape(component.populationStatus)}"`);
  if (component.nonPop) attributes.push('UCADNonPop="true"');
  if (Object.keys(metadata).length) attributes.push(`UCADSourceMetadata="${xmlEscape(JSON.stringify(metadata))}"`);
  return attributes.join(' ');
}
function makeInspectionXml({ boardName, boardWidth, boardHeight, boardThickness = 0, components, lands, sourceFormat }) {
  const componentXml = components.map((component) => `    <ComponentInformation Id="${xmlEscape(component.id)}" Name="${xmlEscape(component.ref)}"><ComponentInformationItem ${componentMetadataAttributes(component)}/><PositionAngle CenterPosX="${component.x}" CenterPosY="${component.y}" Angle="${component.rotation}"/></ComponentInformation>`).join('\n');
  const landXml = lands.map((land) => `    <LandNumber LandId="${xmlEscape(land.id)}" Component="${xmlEscape(land.componentId)}" Name="${xmlEscape(land.name)}" Side="${xmlEscape(land.side)}"><Land Left="${land.left}" Top="${land.top}" Width="${land.width}" Length="${land.height}"/></LandNumber>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<InspectionData SourceFormat="${xmlEscape(sourceFormat)}">\n  <BoardInformation Name="${xmlEscape(boardName)}" Width="${Math.max(0, boardWidth || 0)}" Height="${Math.max(0, boardHeight || 0)}" Thickness="${Math.max(0, boardThickness || 0)}"/>\n  <Components>\n${componentXml}\n  </Components>\n  <Lands>\n${landXml}\n  </Lands>\n</InspectionData>\n`;
}

export function looksLikeGenCad(text) {
  const sample = String(text || '').replace(/^\uFEFF/, '').slice(0, 120000);
  return /(?:^|\n)\s*\$HEADER\s*(?:\r?\n)+\s*GENCAD\s+1\.[0-9]+/i.test(sample) || /(?:^|\n)\s*\$COMPONENTS\b/i.test(sample) && /(?:^|\n)\s*\$SHAPES\b/i.test(sample);
}
export function looksLikeFabmasterExtract(text) {
  const lines = lineList(String(text || '').slice(0, 250000));
  const aRows = lines.filter((line) => /^A!/i.test(line));
  const hasData = lines.some((line) => /^S!/i.test(line));
  return hasData && aRows.some((line) => /(?:^|!)REF_?DES(?:!|$)|(?:^|!)SYM_?NAME(?:!|$)|(?:^|!)PAD_?NAME(?:!|$)/i.test(line));
}
export function looksLikeFabmasterLegacy(text) {
  const sample = String(text || '').replace(/^\uFEFF/, '').slice(0, 120000);
  return /(?:^|\n)\s*:BOARDINFO\b/i.test(sample) && /(?:^|\n)\s*:PARTLIST\b/i.test(sample)
    || /(?:^|\n)\s*:FABMASTER\b/i.test(sample);
}

export function convertGenCadToInspectionXml(text, options = {}) {
  const source = String(text || '').replace(/^\uFEFF/, '');
  if (!looksLikeGenCad(source)) throw new ParseError('The file is not a recognized CAD ASCII 1.x file.', { stage: 'gencad-detect', fileName: options.fileName, code: 'GENCAD_SIGNATURE_MISSING' });
  const warnings = []; const unsupportedRecords = [];
  const header = sectionText(source, 'HEADER'); const unit = sourceUnitFromGencad(header); if (unit.warning) warnings.push(unit.warning);
  const headerLines = lineList(header); const drawing = headerLines.find((line) => /^DRAWING\b/i.test(line));
  const boardName = tokenizeWhitespace(drawing || '').slice(1).join(' ') || options.fileName || 'CAD ASCII Board';
  const boardLines = lineList(sectionText(source, 'BOARD')); const boardBounds = boardBoundsFromLines(boardLines, unit.toMm);
  const thicknessLine = boardLines.find((line) => /^THICKNESS\b/i.test(line)); const thickness = (finite(tokenizeWhitespace(thicknessLine || '')[1], 0) || 0) * unit.toMm;

  const pads = new Map(); let activePad = null;
  for (const line of lineList(sectionText(source, 'PADS'))) {
    const t = tokenizeWhitespace(line); const keyword = String(t[0] || '').toUpperCase();
    if (keyword === 'PAD') { activePad = t[1] || ''; if (activePad && !pads.has(activePad)) pads.set(activePad, { width: DEFAULT_LAND_MM, height: DEFAULT_LAND_MM }); }
    else if (keyword === 'RECTANGLE' && activePad) {
      const width = Math.abs(finite(t[3], 0) || 0) * unit.toMm; const height = Math.abs(finite(t[4], 0) || 0) * unit.toMm;
      if (width > 0 && height > 0) pads.set(activePad, { width, height });
    } else if (keyword === 'CIRCLE' && activePad) {
      const diameter = Math.abs(finite(t[3], finite(t[1], 0)) || 0) * unit.toMm;
      if (diameter > 0) pads.set(activePad, { width: diameter, height: diameter });
    }
  }
  const padstacks = new Map(); let activeStack = null;
  for (const line of lineList(sectionText(source, 'PADSTACKS'))) {
    const t = tokenizeWhitespace(line); const keyword = String(t[0] || '').toUpperCase();
    if (keyword === 'PADSTACK') activeStack = t[1] || '';
    else if (keyword === 'PAD' && activeStack && !padstacks.has(activeStack)) padstacks.set(activeStack, t[1] || '');
  }
  const shapes = new Map(); let activeShape = null;
  for (const line of lineList(sectionText(source, 'SHAPES'))) {
    const t = tokenizeWhitespace(line); const keyword = String(t[0] || '').toUpperCase();
    if (keyword === 'SHAPE') { activeShape = t[1] || ''; if (activeShape && !shapes.has(activeShape)) shapes.set(activeShape, []); }
    else if (keyword === 'PIN' && activeShape) {
      const pinName = t[1] || String(shapes.get(activeShape).length + 1); const stack = t[2] || '';
      const x = (finite(t[3], 0) || 0) * unit.toMm; const y = (finite(t[4], 0) || 0) * unit.toMm;
      const rotation = finite(t[6], 0) || 0; const mirror = String(t[7] || '');
      const padName = padstacks.get(stack); const size = pads.get(padName) || { width: DEFAULT_LAND_MM, height: DEFAULT_LAND_MM };
      if (!padName) warnings.push(`Shape ${activeShape} pin ${pinName}: padstack ${stack} was not found; using ${DEFAULT_LAND_MM} mm.`);
      shapes.get(activeShape).push({ name: pinName, stack, x, y, rotation, mirror, width: size.width, height: size.height });
    }
  }

  const devices = new Map(); let activeDevice = null;
  for (const line of lineList(sectionText(source, 'DEVICES'))) {
    const t = tokenizeWhitespace(line); const keyword = String(t[0] || '').toUpperCase();
    if (keyword === 'DEVICE') { activeDevice = t[1] || ''; if (activeDevice && !devices.has(activeDevice)) devices.set(activeDevice, { part: '', packageName: '' }); }
    else if (activeDevice && keyword === 'PART') devices.get(activeDevice).part = t.slice(1).join(' ');
    else if (activeDevice && keyword === 'PACKAGE') devices.get(activeDevice).packageName = t.slice(1).join(' ');
  }

  const components = []; const componentLines = lineList(sectionText(source, 'COMPONENTS')); let current = null;
  const flush = () => { if (current?.ref) components.push(current); current = null; };
  for (const line of componentLines) {
    const t = tokenizeWhitespace(line); const keyword = String(t[0] || '').toUpperCase();
    if (keyword === 'COMPONENT') { flush(); current = { ref: t[1] || '', packageName: '', shape: '', x: 0, y: 0, rotation: 0, side: 'Top', mirror: '', flip: '' }; }
    else if (!current) continue;
    else if (keyword === 'DEVICE') current.packageName = t.slice(1).join(' ') || current.packageName;
    else if (keyword === 'PLACE') { current.x = (finite(t[1], 0) || 0) * unit.toMm; current.y = (finite(t[2], 0) || 0) * unit.toMm; }
    else if (keyword === 'LAYER') current.side = normalizeSide(t[1]);
    else if (keyword === 'ROTATION') current.rotation = normalizeRotation(t[1]);
    else if (keyword === 'SHAPE') { current.shape = t[1] || ''; current.mirror = String(t[2] || ''); current.flip = String(t[3] || ''); }
  }
  flush();
  if (!components.length) throw new ParseError('CAD ASCII contains no readable $COMPONENTS records.', { stage: 'gencad-components', fileName: options.fileName, code: 'GENCAD_COMPONENTS_EMPTY' });

  const outputComponents = []; const lands = []; let landId = 1; let componentId = 1;
  for (const component of components) {
    const id = String(componentId++); const pins = shapes.get(component.shape) || [];
    const device = devices.get(component.packageName);
    const resolvedPackage = device?.part || device?.packageName || component.packageName || component.shape || 'UNASSIGNED';
    outputComponents.push({ id, ref: component.ref, packageName: resolvedPackage, revision: '', x: component.x, y: component.y, rotation: component.rotation });
    if (!pins.length) { warnings.push(`${component.ref}: shape '${component.shape || 'missing'}' has no pin geometry.`); continue; }
    for (const pin of pins) {
      let localX = pin.x; let localY = pin.y;
      const mirrorText = `${component.mirror} ${pin.mirror}`.toUpperCase();
      if (/MIRRORX/.test(mirrorText)) localY = -localY;
      if (/MIRRORY/.test(mirrorText)) localX = -localX;
      const rotated = rotatePoint(localX, localY, component.rotation);
      const centerX = component.x + rotated.x; const centerY = component.y + rotated.y;
      const totalRotation = normalizeRotation(component.rotation + pin.rotation);
      let width = pin.width; let height = pin.height;
      if (Math.abs(totalRotation % 180 - 90) < 1e-6) [width, height] = [height, width];
      else if (Math.abs(totalRotation % 90) > 1e-6) warnings.push(`${component.ref}.${pin.name}: land rotation ${totalRotation}° is represented as an axis-aligned rectangle in the Working Model.`);
      lands.push({ id: landId++, componentId: id, name: pin.name, side: component.side, left: centerX - width / 2, top: centerY + height / 2, width, height });
    }
  }
  if (!lands.length) throw new ParseError('CAD ASCII contains no readable pin/land geometry.', { stage: 'gencad-pins', fileName: options.fileName, code: 'GENCAD_LANDS_EMPTY' });
  if (sectionText(source, 'SIGNALS').trim()) unsupportedRecords.push({ type: 'SIGNALS', reason: 'The normalized placement model does not currently store the full electrical netlist.' });
  if (sectionText(source, 'ROUTES').trim()) unsupportedRecords.push({ type: 'ROUTES', reason: 'The normalized placement model does not currently store copper routes.' });
  const landXs = lands.flatMap((land) => [land.left, land.left + land.width]); const landYs = lands.flatMap((land) => [land.top - land.height, land.top]);
  const minX = boardBounds?.minX ?? Math.min(...landXs); const maxX = boardBounds?.maxX ?? Math.max(...landXs); const minY = boardBounds?.minY ?? Math.min(...landYs); const maxY = boardBounds?.maxY ?? Math.max(...landYs);
  const xmlText = makeInspectionXml({ boardName, boardWidth: maxX - minX, boardHeight: maxY - minY, boardThickness: thickness, components: outputComponents, lands, sourceFormat: 'CAD ASCII 1.4' });
  return { xmlText, warnings: [...new Set(warnings)], unsupportedRecords, components: outputComponents.length, packages: new Set(outputComponents.map((c) => c.packageName)).size, lands: lands.length, sourceFormat: 'gencad-1.4', partial: warnings.length > 0 || unsupportedRecords.length > 0, unit: unit.name };
}

function normalizedHeader(fields) { return fields.map((field) => String(field || '').trim().toUpperCase().replace(/_/g, '')); }
function rowObject(headers, fields) {
  const out = {}; headers.forEach((header, index) => { if (header) out[header] = fields[index + 1] ?? ''; }); return out;
}
function unitFromFabmasterSections(sections) {
  for (const section of sections) for (const field of section.meta || []) {
    const value = String(field || '').trim().toUpperCase();
    if (value === 'MILLIMETERS' || value === 'MILLIMETRES' || value === 'MM') return { name: 'mm', toMm: 1 };
    if (value === 'MILS' || value === 'MIL') return { name: 'mils', toMm: MM_PER_INCH / 1000 };
    if (value === 'INCHES' || value === 'INCH') return { name: 'inch', toMm: MM_PER_INCH };
    if (value === 'MICRONS' || value === 'MICROMETERS') return { name: 'microns', toMm: 0.001 };
  }
  return { name: 'mils-default', toMm: MM_PER_INCH / 1000 };
}
function parseFabSections(source) {
  const lines = lineList(source); const sections = []; let current = null;
  for (const line of lines) {
    const fields = splitBang(line); const type = String(fields[0] || '').trim().toUpperCase();
    if (type === 'A') { current = { headers: normalizedHeader(fields.slice(1)), rawHeaders: fields.slice(1), meta: [], rows: [] }; sections.push(current); }
    else if (type === 'J' && current) current.meta = fields.slice(1);
    else if (type === 'S' && current) current.rows.push(rowObject(current.headers, fields));
  }
  return sections;
}

function unitFromFabmasterMeta(meta = []) {
  for (const field of meta) {
    const value = String(field || '').trim().toUpperCase();
    if (value === 'MILLIMETERS' || value === 'MILLIMETRES' || value === 'MM') return { name: 'mm', toMm: 1 };
    if (value === 'MILS' || value === 'MIL') return { name: 'mils', toMm: MM_PER_INCH / 1000 };
    if (value === 'INCHES' || value === 'INCH') return { name: 'inch', toMm: MM_PER_INCH };
    if (value === 'MICRONS' || value === 'MICROMETERS') return { name: 'microns', toMm: 0.001 };
  }
  return null;
}

function fabmasterSectionKind(headers = []) {
  const h0 = headers[0] || '';
  if (h0 === 'PADNAME') return 'pads';
  if (h0 === 'REFDES' && (headers.includes('COMPCLASS') || headers.includes('SYMX') || headers.includes('COMPDEVICE') || headers.includes('COMPPACKAGE'))) return 'components';
  if (h0 === 'SYMNAME' && headers.includes('PINNUMBER') && headers.includes('PINX') && headers.includes('PINY')) return 'pins';
  if (h0 === 'NETNAME') return 'nets';
  if (h0 === 'CLASS' && headers.includes('GRAPHICDATANAME')) return 'traces';
  return 'other';
}

function finalizeFabmasterStreamingState(state, options = {}) {
  const { componentMap, pinRows, padSizes } = state;
  const unit = state.unit || { name: 'mils-default', toMm: MM_PER_INCH / 1000 };
  const warnings = [...state.warnings];
  const unsupportedRecords = [...state.unsupportedRecords];
  if (!state.unit) warnings.push('Manufacturing ASCII does not specify a recognized unit; using MILS as the fallback.');
  if (!componentMap.size) throw new ParseError('Manufacturing ASCII contains no readable component placements.', { stage: 'fabmaster-components', fileName: options.fileName, code: 'FABMASTER_COMPONENTS_EMPTY' });

  const components = []; const componentIdByRef = new Map(); let componentId = 1;
  for (const component of componentMap.values()) {
    const id = String(componentId++); componentIdByRef.set(component.ref, id);
    components.push({ id, ref: component.ref, packageName: component.packageName, x: component.x, y: component.y, rotation: component.rotation, revision: '', sourceMetadata: component.sourceMetadata || {}, variation: component.variation || '', populationStatus: component.populationStatus || '', nonPop: Boolean(component.nonPop) });
  }

  const lands = []; let landId = 1;
  const missingPadstacks = new Map();
  let minLandX = Infinity; let maxLandX = -Infinity; let minLandY = Infinity; let maxLandY = -Infinity;
  for (const row of pinRows) {
    const ref = String(row.ref || '').trim(); const componentIdValue = componentIdByRef.get(ref); if (!componentIdValue) continue;
    if (row.x == null || row.y == null) continue;
    const stack = String(row.stack || '').trim(); const size = padSizes.get(stack) || { width: DEFAULT_LAND_MM, height: DEFAULT_LAND_MM };
    if (stack && !padSizes.has(stack)) {
      const current = missingPadstacks.get(stack) || { count: 0, example: `${ref}.${row.pinName || landId}` };
      current.count += 1; missingPadstacks.set(stack, current);
    }
    const centerX = row.x; const centerY = row.y;
    const comp = componentMap.get(ref); const side = comp?.side || normalizeSide(row.mirror || 'NO');
    const left = centerX - size.width / 2; const top = centerY + size.height / 2;
    const land = { id: landId++, componentId: componentIdValue, name: String(row.pinNumber || row.pinName || landId - 1), side, left, top, width: size.width, height: size.height };
    lands.push(land);
    minLandX = Math.min(minLandX, left); maxLandX = Math.max(maxLandX, left + size.width);
    minLandY = Math.min(minLandY, top - size.height); maxLandY = Math.max(maxLandY, top);
  }
  if (!lands.length) throw new ParseError('Manufacturing ASCII contains no readable pin/land placements.', { stage: 'fabmaster-pins', fileName: options.fileName, code: 'FABMASTER_LANDS_EMPTY' });
  if (missingPadstacks.size) {
    const examples = [...missingPadstacks.entries()].slice(0, 8).map(([name, info]) => `${name} (${info.count} pins; example ${info.example})`).join(', ');
    const missingPins = [...missingPadstacks.values()].reduce((sum, info) => sum + info.count, 0);
    warnings.push(`Missing ${missingPadstacks.size} padstack name(s) for ${missingPins} pins; using ${DEFAULT_LAND_MM} mm fallback. Examples: ${examples}`);
  }

  const bounds = state.outlineBounds || state.bounds;
  if (state.outlineBounds) warnings.push('Using BOARD GEOMETRY / OUTLINE for board bounds instead of drawing extents to prevent panel graphics from inflating the board view.');
  const minX = bounds?.minX ?? minLandX; const maxX = bounds?.maxX ?? maxLandX;
  const minY = bounds?.minY ?? minLandY; const maxY = bounds?.maxY ?? maxLandY;
  const boardName = options.fileName || 'Manufacturing ASCII Board';
  const xmlText = makeInspectionXml({ boardName, boardWidth: maxX - minX, boardHeight: maxY - minY, components, lands, sourceFormat: 'Manufacturing ASCII' });
  if (state.ignoredRows > 0) warnings.push(`Large-file streaming parser skipped ${state.ignoredRows} records not required by the component/land Working Model without loading them into memory.`);
  return {
    xmlText,
    warnings: [...new Set(warnings)],
    unsupportedRecords,
    components: components.length,
    packages: new Set(components.map((c) => c.packageName)).size,
    lands: lands.length,
    sourceFormat: 'fabmaster-ascii',
    partial: warnings.length > 0 || unsupportedRecords.length > 0,
    unit: unit.name,
    streaming: true,
    scannedLines: state.scannedLines,
  };
}

/**
 * Memory-bounded manufacturing ASCII A!/J!/S! reader for very large .cad/.fab files.
 * It consumes the decompressed ReadableStream chunk-by-chunk and only retains
 * Component, Pad and Pin records required by the Universal CAD Working Model.
 * Multi-million trace/graphic/net rows are counted/flagged but never materialized.
 */
export async function convertFabmasterStreamToInspectionXml(readable, options = {}) {
  if (!readable?.getReader) throw new TypeError('Large manufacturing ASCII import requires a ReadableStream');
  const state = {
    componentMap: new Map(), pinRows: [], padSizes: new Map(), bounds: null, outlineBounds: null, unit: null,
    warnings: [], unsupportedRecords: [], unsupportedKinds: new Set(), ignoredRows: 0, scannedLines: 0,
  };
  let headers = []; let sectionKind = 'other'; let sawSignature = false;
  const decoder = new TextDecoder(options.encoding || 'utf-8');
  const reader = readable.getReader();
  let pending = ''; let processedBytes = 0; let lastProgressBytes = 0;
  const totalBytes = Number(options.totalBytes || 0);

  const processLine = (rawLine) => {
    const line = String(rawLine || '').replace(/\r$/, '').trim();
    if (!line || line === '\u001a') return;
    state.scannedLines += 1;
    const type = `${line[0] || ''}${line[1] || ''}`.toUpperCase();
    if (type === 'A!') {
      const fields = splitBang(line); headers = normalizedHeader(fields.slice(1)); sectionKind = fabmasterSectionKind(headers);
      if (sectionKind === 'components' || sectionKind === 'pins' || sectionKind === 'pads') sawSignature = true;
      if (sectionKind === 'nets' && !state.unsupportedKinds.has('NETS')) {
        state.unsupportedKinds.add('NETS'); state.unsupportedRecords.push({ type: 'NETS', reason: 'The normalized placement model does not currently store the full electrical netlist.' });
      }
      if (sectionKind === 'traces' && !state.unsupportedKinds.has('TRACES')) {
        state.unsupportedKinds.add('TRACES'); state.unsupportedRecords.push({ type: 'TRACES', reason: 'The normalized placement model does not currently store traces or zones.' });
      }
      return;
    }
    if (type === 'J!') {
      const fields = splitBang(line).slice(1);
      const detectedUnit = unitFromFabmasterMeta(fields); if (detectedUnit) state.unit = detectedUnit;
      const unit = state.unit || { name: 'mils-default', toMm: MM_PER_INCH / 1000 };
      if (fields.length >= 6) {
        const maybe = fields.slice(2, 6).map((value) => finite(value, null));
        if (maybe.every((value) => value != null)) {
          const [minX, minY, maxX, maxY] = maybe.map((value) => value * unit.toMm);
          if (maxX > minX && maxY > minY) state.bounds = { minX, minY, maxX, maxY };
        }
      }
      return;
    }
    if (type !== 'S!') return;
    if (sectionKind === 'traces') {
      // This manufacturing ASCII family often stores the actual PCB profile in the huge graphic section.
      // Parse only BOARD GEOMETRY / OUTLINE rows; skip the millions of copper and
      // drawing rows without tokenizing them.
      if (/^S!BOARD GEOMETRY!OUTLINE!/i.test(line)) {
        const fields = splitBang(line); const row = rowObject(headers, fields);
        const unit = state.unit || { name: 'mils-default', toMm: MM_PER_INCH / 1000 };
        const graphicType = String(row.GRAPHICDATANAME || '').toUpperCase();
        const pairCount = graphicType === 'ARC' ? 3 : graphicType === 'LINE' ? 2 : 0;
        for (let pair = 0; pair < pairCount; pair += 1) {
          const x = finite(row[`GRAPHICDATA${pair * 2 + 1}`], null); const y = finite(row[`GRAPHICDATA${pair * 2 + 2}`], null);
          if (x == null || y == null) continue;
          const px = x * unit.toMm; const py = y * unit.toMm;
          if (!state.outlineBounds) state.outlineBounds = { minX: px, maxX: px, minY: py, maxY: py };
          else {
            state.outlineBounds.minX = Math.min(state.outlineBounds.minX, px); state.outlineBounds.maxX = Math.max(state.outlineBounds.maxX, px);
            state.outlineBounds.minY = Math.min(state.outlineBounds.minY, py); state.outlineBounds.maxY = Math.max(state.outlineBounds.maxY, py);
          }
        }
      } else state.ignoredRows += 1;
      return;
    }
    if (!['components', 'pads', 'pins'].includes(sectionKind)) { state.ignoredRows += 1; return; }
    const fields = splitBang(line); const row = rowObject(headers, fields);
    const unit = state.unit || { name: 'mils-default', toMm: MM_PER_INCH / 1000 };
    if (sectionKind === 'components') {
      const ref = String(row.REFDES || '').trim(); if (!ref) return;
      const x = finite(row.SYMX, null); const y = finite(row.SYMY, null);
      if ((x != null && y != null) || !state.componentMap.has(ref)) {
        const sourceMetadata = compactPopulationMetadata(row);
        const population = inferPopulationFields(sourceMetadata);
        state.componentMap.set(ref, {
          ref,
          packageName: String(row.SYMNAME || row.COMPPACKAGE || row.COMPPARTNUMBER || row.COMPDEVICETYPE || 'UNASSIGNED').trim() || 'UNASSIGNED',
          x: (x ?? 0) * unit.toMm, y: (y ?? 0) * unit.toMm,
          rotation: normalizeRotation(row.SYMROTATE || 0), side: normalizeSide(row.SYMMIRROR || row.SIDE || 'NO'),
          sourceMetadata, variation: population.variation, populationStatus: population.populationStatus, nonPop: population.nonPop,
        });
      }
      if (String(row.PINNUMBER || '').trim() && finite(row.PINX, null) != null && finite(row.PINY, null) != null) {
        state.pinRows.push({ ref, pinName: row.PINNAME, pinNumber: row.PINNUMBER, x: finite(row.PINX, 0) * unit.toMm, y: finite(row.PINY, 0) * unit.toMm, stack: row.PADSTACKNAME || row.PADNAME, mirror: row.SYMMIRROR });
      }
      return;
    }
    if (sectionKind === 'pads') {
      const name = String(row.PADNAME || '').trim(); if (!name || state.padSizes.has(name)) return;
      const width = Math.abs(finite(row.PADWIDTH, 0) || 0) * unit.toMm; const height = Math.abs(finite(row.PADHGHT, 0) || 0) * unit.toMm;
      if (width > 0 && height > 0 && String(row.LAYER || '').toUpperCase() !== '~DRILL') state.padSizes.set(name, { width, height });
      return;
    }
    const ref = String(row.REFDES || '').trim(); const x = finite(row.PINX, null); const y = finite(row.PINY, null);
    if (!ref || x == null || y == null) return;
    state.pinRows.push({ ref, pinName: row.PINNAME, pinNumber: row.PINNUMBER, x: x * unit.toMm, y: y * unit.toMm, stack: row.PADSTACKNAME || row.PADNAME, mirror: row.SYMMIRROR });
  };

  try {
    while (true) {
      if (options.signal?.aborted) throw new ParseError('Manufacturing-ASCII import was cancelled.', { stage: 'fabmaster-stream', fileName: options.fileName, code: 'IMPORT_ABORTED' });
      const { done, value } = await reader.read(); if (done) break;
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
      processedBytes += bytes.byteLength;
      const text = pending + decoder.decode(bytes, { stream: true });
      const lines = text.split('\n'); pending = lines.pop() || '';
      for (const line of lines) processLine(line);
      if (options.onProgress && (processedBytes - lastProgressBytes >= 4 * 1024 * 1024 || (totalBytes && processedBytes >= totalBytes))) {
        lastProgressBytes = processedBytes;
        options.onProgress({ processedBytes, totalBytes, lines: state.scannedLines, components: state.componentMap.size, pins: state.pinRows.length });
      }
    }
    pending += decoder.decode(); if (pending) processLine(pending);
  } finally {
    try { if (options.signal?.aborted) await reader.cancel(); } catch { /* abort cleanup is best-effort */ }
    reader.releaseLock();
  }
  if (!sawSignature) throw new ParseError('The file is not a recognized A!/J!/S! manufacturing-ASCII file.', { stage: 'fabmaster-detect', fileName: options.fileName, code: 'FABMASTER_SIGNATURE_MISSING' });
  return finalizeFabmasterStreamingState(state, options);
}

export function convertFabmasterExtractToInspectionXml(text, options = {}) {
  const source = String(text || '').replace(/^\uFEFF/, '');
  if (!looksLikeFabmasterExtract(source)) throw new ParseError('The file is not a recognized A!/J!/S! manufacturing-ASCII file.', { stage: 'fabmaster-detect', fileName: options.fileName, code: 'FABMASTER_SIGNATURE_MISSING' });
  const sections = parseFabSections(source); const unit = unitFromFabmasterSections(sections); const warnings = []; const unsupportedRecords = [];
  if (unit.name === 'mils-default') warnings.push('Manufacturing ASCII does not specify a recognized unit; using MILS as the fallback.');
  const componentMap = new Map(); const pinRows = []; const padSizes = new Map(); let bounds = null;
  for (const section of sections) {
    const h = section.headers; const h0 = h[0] || '';
    if (section.meta?.length >= 6) {
      const maybe = section.meta.slice(2, 6).map((value) => finite(value, null));
      if (maybe.every((value) => value != null)) {
        const [minX, minY, maxX, maxY] = maybe.map((value) => value * unit.toMm);
        if (maxX > minX && maxY > minY) bounds = { minX, minY, maxX, maxY };
      }
    }
    if (h0 === 'PADNAME') {
      for (const row of section.rows) {
        const name = String(row.PADNAME || '').trim(); if (!name || padSizes.has(name)) continue;
        const width = Math.abs(finite(row.PADWIDTH, 0) || 0) * unit.toMm; const height = Math.abs(finite(row.PADHGHT, 0) || 0) * unit.toMm;
        if (width > 0 && height > 0 && String(row.LAYER || '').toUpperCase() !== '~DRILL') padSizes.set(name, { width, height });
      }
    }
    const isRefdesSection = h0 === 'REFDES' && (h.includes('COMPCLASS') || h.includes('SYMX') || h.includes('COMPDEVICE') || h.includes('COMPPACKAGE'));
    if (isRefdesSection) {
      for (const row of section.rows) {
        const ref = String(row.REFDES || '').trim(); if (!ref) continue;
        const x = finite(row.SYMX, null); const y = finite(row.SYMY, null);
        if ((x != null && y != null) || !componentMap.has(ref)) {
          const sourceMetadata = compactPopulationMetadata(row);
          const population = inferPopulationFields(sourceMetadata);
          componentMap.set(ref, {
            ref,
            packageName: String(row.SYMNAME || row.COMPPACKAGE || row.COMPPARTNUMBER || row.COMPDEVICETYPE || 'UNASSIGNED').trim() || 'UNASSIGNED',
            x: (x ?? 0) * unit.toMm, y: (y ?? 0) * unit.toMm,
            rotation: normalizeRotation(row.SYMROTATE || 0), side: normalizeSide(row.SYMMIRROR || row.SIDE || 'NO'),
            sourceMetadata, variation: population.variation, populationStatus: population.populationStatus, nonPop: population.nonPop,
          });
        }
        if (String(row.PINNUMBER || '').trim() && finite(row.PINX, null) != null && finite(row.PINY, null) != null) pinRows.push(row);
      }
    }
    const isPins = h0 === 'SYMNAME' && h.includes('PINNUMBER') && h.includes('PINX') && h.includes('PINY');
    if (isPins) pinRows.push(...section.rows);
    if (h0 === 'NETNAME') unsupportedRecords.push({ type: 'NETS', reason: 'The normalized placement model does not currently store the full electrical netlist.' });
    if (h0 === 'CLASS' && h.includes('GRAPHICDATANAME')) unsupportedRecords.push({ type: 'TRACES', reason: 'The normalized placement model does not currently store traces or zones.' });
  }
  if (!componentMap.size) throw new ParseError('Manufacturing ASCII contains no readable component placements.', { stage: 'fabmaster-components', fileName: options.fileName, code: 'FABMASTER_COMPONENTS_EMPTY' });
  const components = []; const componentIdByRef = new Map(); let componentId = 1;
  for (const component of componentMap.values()) { const id = String(componentId++); componentIdByRef.set(component.ref, id); components.push({ id, ref: component.ref, packageName: component.packageName, x: component.x, y: component.y, rotation: component.rotation, revision: '', sourceMetadata: component.sourceMetadata || {}, variation: component.variation || '', populationStatus: component.populationStatus || '', nonPop: Boolean(component.nonPop) }); }
  const lands = []; let landId = 1;
  for (const row of pinRows) {
    const ref = String(row.REFDES || row.SYMNAME || '').trim(); const componentIdValue = componentIdByRef.get(ref); if (!componentIdValue) continue;
    const x = finite(row.PINX, null); const y = finite(row.PINY, null); if (x == null || y == null) continue;
    const stack = String(row.PADSTACKNAME || row.PADNAME || '').trim(); const size = padSizes.get(stack) || { width: DEFAULT_LAND_MM, height: DEFAULT_LAND_MM };
    if (stack && !padSizes.has(stack)) warnings.push(`${ref}.${row.PINNUMBER || row.PINNAME || landId}: padstack ${stack} was not found; using ${DEFAULT_LAND_MM} mm.`);
    const centerX = x * unit.toMm; const centerY = y * unit.toMm;
    const comp = componentMap.get(ref); const side = comp?.side || normalizeSide(row.SYMMIRROR || 'NO');
    lands.push({ id: landId++, componentId: componentIdValue, name: String(row.PINNUMBER || row.PINNAME || landId - 1), side, left: centerX - size.width / 2, top: centerY + size.height / 2, width: size.width, height: size.height });
  }
  if (!lands.length) throw new ParseError('Manufacturing ASCII contains no readable pin/land placements.', { stage: 'fabmaster-pins', fileName: options.fileName, code: 'FABMASTER_LANDS_EMPTY' });
  const landXs = lands.flatMap((land) => [land.left, land.left + land.width]); const landYs = lands.flatMap((land) => [land.top - land.height, land.top]);
  const minX = bounds?.minX ?? Math.min(...landXs); const maxX = bounds?.maxX ?? Math.max(...landXs); const minY = bounds?.minY ?? Math.min(...landYs); const maxY = bounds?.maxY ?? Math.max(...landYs);
  const boardName = options.fileName || 'Manufacturing ASCII Board';
  const xmlText = makeInspectionXml({ boardName, boardWidth: maxX - minX, boardHeight: maxY - minY, components, lands, sourceFormat: 'Manufacturing ASCII' });
  return { xmlText, warnings: [...new Set(warnings)], unsupportedRecords, components: components.length, packages: new Set(components.map((c) => c.packageName)).size, lands: lands.length, sourceFormat: 'fabmaster-ascii', partial: warnings.length > 0 || unsupportedRecords.length > 0, unit: unit.name };
}

function keepBySide(land, side) { return side === 'all' || String(land?.side || '').toLowerCase() === side; }
function modelBounds(model, side = 'all') {
  const lands = (model?.components || []).flatMap((component) => (component.lands || []).filter((land) => keepBySide(land, side)));
  if (!lands.length) return { minX: 0, minY: 0, maxX: Number(model?.board?.Width || model?.board?.width || 0), maxY: Number(model?.board?.Height || model?.board?.height || 0) };
  return {
    minX: Math.min(...lands.map((land) => Number(land.left || 0))),
    minY: Math.min(...lands.map((land) => Number(land.top || 0) - Number(land.length || 0))),
    maxX: Math.max(...lands.map((land) => Number(land.left || 0) + Number(land.width || 0))),
    maxY: Math.max(...lands.map((land) => Number(land.top || 0))),
  };
}
function mmToIn(value) { return Number(value || 0) / MM_PER_INCH; }
function fmt(value) { const n = Number(value || 0); return Number.isFinite(n) ? n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '') || '0' : '0'; }
function orthogonalRotation(angle) { const n = normalizeRotation(angle); return Math.abs(n % 90) < 1e-6; }

export function exportGenCad14(model, options = {}) {
  if (!model?.components?.length) throw new ValidationError('There are no components to export as CAD ASCII.', { stage: 'gencad-export', code: 'GENCAD_EXPORT_EMPTY' });
  const side = options.side || 'all'; const warnings = [];
  const components = (model.components || []).map((component) => ({ ...component, lands: (component.lands || []).filter((land) => keepBySide(land, side)) })).filter((component) => component.lands.length);
  if (!components.length) throw new ValidationError(`There are no lands in the ${side} scope.`, { stage: 'gencad-export', code: 'GENCAD_EXPORT_SIDE_EMPTY' });
  const padDefs = new Map(); let padCounter = 1;
  const shapeRecords = []; const componentRecords = []; const deviceRecords = []; const usedShapes = new Set();
  const padNameFor = (widthMm, heightMm) => {
    const key = `${Number(widthMm).toFixed(6)}x${Number(heightMm).toFixed(6)}`;
    if (!padDefs.has(key)) padDefs.set(key, { name: `UCAD_PAD_${padCounter++}`, width: widthMm, height: heightMm });
    return padDefs.get(key).name;
  };
  for (const component of components) {
    const shapeName = uniqueName(`UCAD_${component.packageName || component.name || component.id}`, usedShapes);
    const rotation = normalizeRotation(component.angle || 0); if (!orthogonalRotation(rotation)) warnings.push(`${component.name}: rotation ${rotation}° — CAD ASCII export preserves placement but the working model has axis-aligned land geometry`);
    const shape = [`SHAPE ${quote(shapeName)}`];
    for (const land of component.lands) {
      const cx = Number(land.left || 0) + Number(land.width || 0) / 2; const cy = Number(land.top || 0) - Number(land.length || 0) / 2;
      const local = inverseRotatePoint(cx - Number(component.centerX || 0), cy - Number(component.centerY || 0), rotation);
      let localWidth = Number(land.width || DEFAULT_LAND_MM); let localHeight = Number(land.length || DEFAULT_LAND_MM);
      if (Math.abs(rotation % 180 - 90) < 1e-6) [localWidth, localHeight] = [localHeight, localWidth];
      const padName = padNameFor(localWidth, localHeight);
      shape.push(`PIN ${quote(land.cadName || land.globalId || 'none')} ${padName} ${fmt(mmToIn(local.x))} ${fmt(mmToIn(local.y))} TOP 0 0`);
    }
    shape.push('INSERT SMD'); shapeRecords.push(shape.join('\n'));
    const layer = normalizeSide(component.lands[0]?.side) === 'Bottom' ? 'BOTTOM' : 'TOP';
    componentRecords.push([`COMPONENT ${quote(component.name || component.id)}`, `DEVICE ${quote(`DEV_${shapeName}`)}`, `PLACE ${fmt(mmToIn(component.centerX))} ${fmt(mmToIn(component.centerY))}`, `LAYER ${layer}`, `ROTATION ${fmt(rotation)}`, `SHAPE ${quote(shapeName)} 0 0`].join('\n'));
    deviceRecords.push([`DEVICE ${quote(`DEV_${shapeName}`)}`, `PART ${quote(component.packageName || shapeName)}`, `PACKAGE ${quote(shapeName)}`].join('\n'));
  }
  const board = model?.board || {}; const width = Number(board.Width ?? board.width ?? 0); const height = Number(board.Height ?? board.height ?? 0); const bounds = modelBounds(model, side);
  const boardWidth = width > 0 ? width : bounds.maxX - Math.min(0, bounds.minX); const boardHeight = height > 0 ? height : bounds.maxY - Math.min(0, bounds.minY);
  const meta = options.metadata || {};
  const lines = [
    '$HEADER', 'GENCAD 1.4', `USER ${quote(`Universal CAD Studio ${meta.appVersion || ''}`.trim())}`, `DRAWING ${quote(options.fileName || board.Name || board.name || 'UniversalCAD')}`, `REVISION ${quote(`Revision ${meta.revisionNumber ?? ''} ${meta.exportTime || ''}`.trim())}`, 'UNITS INCH', 'ORIGIN 0 0', 'INTERTRACK 0', `$ENDHEADER`, '',
    '$BOARD', `THICKNESS ${fmt(mmToIn(Number(board.Thickness ?? board.thickness ?? 0)))}`, `LINE 0 0 ${fmt(mmToIn(boardWidth))} 0`, `LINE ${fmt(mmToIn(boardWidth))} 0 ${fmt(mmToIn(boardWidth))} ${fmt(mmToIn(boardHeight))}`, `LINE ${fmt(mmToIn(boardWidth))} ${fmt(mmToIn(boardHeight))} 0 ${fmt(mmToIn(boardHeight))}`, `LINE 0 ${fmt(mmToIn(boardHeight))} 0 0`, '$ENDBOARD', '', '$PADS',
  ];
  for (const pad of padDefs.values()) lines.push(`PAD ${pad.name} RECTANGULAR -1`, `RECTANGLE ${fmt(-mmToIn(pad.width) / 2)} ${fmt(-mmToIn(pad.height) / 2)} ${fmt(mmToIn(pad.width))} ${fmt(mmToIn(pad.height))}`);
  lines.push('$ENDPADS', '', '$PADSTACKS');
  for (const pad of padDefs.values()) lines.push(`PADSTACK ${pad.name} 0`, `PAD ${pad.name} TOP 0 0`, `PAD ${pad.name} BOTTOM 0 0`);
  lines.push('$ENDPADSTACKS', '', '$ARTWORKS', '$ENDARTWORKS', '', '$SHAPES', ...shapeRecords, '$ENDSHAPES', '', '$COMPONENTS', ...componentRecords, '$ENDCOMPONENTS', '', '$DEVICES', ...deviceRecords, '$ENDDEVICES', '', '$SIGNALS', '$ENDSIGNALS', '', '$TRACKS', '$ENDTRACKS', '', '$LAYERS', 'LAYER TOP SIGNAL', 'LAYER BOTTOM SIGNAL', '$ENDLAYERS', '', '$ROUTES', '$ENDROUTES', '', '$MECH', '$ENDMECH', '', '$TESTPINS', '$ENDTESTPINS', '', '$POWERPINS', '$ENDPOWERPINS', '');
  warnings.push('The CAD ASCII writer exports board, component, and rectangular-land data. Electrical nets, routes, vias, and arbitrary polygon pads are emitted only when the Working Model contains the required data.');
  return { text: lines.join('\n'), warnings: [...new Set(warnings)], partial: true, format: 'gencad-1.4', extension: '.cad', mime: 'text/plain;charset=us-ascii' };
}

function bangField(value) { const text = String(value ?? ''); return /[!"\r\n]/.test(text) ? `"${text.replace(/"/g, '""').replace(/[\r\n]+/g, ' ')}"` : text; }
function bangRow(type, values) { return `${type}!${values.map(bangField).join('!')}!`; }
export function exportFabmasterAscii(model, options = {}) {
  if (!model?.components?.length) throw new ValidationError('There are no components to export as manufacturing ASCII.', { stage: 'fabmaster-export', code: 'FABMASTER_EXPORT_EMPTY' });
  const side = options.side || 'all'; const components = (model.components || []).map((component) => ({ ...component, lands: (component.lands || []).filter((land) => keepBySide(land, side)) })).filter((component) => component.lands.length);
  if (!components.length) throw new ValidationError(`There are no lands in the ${side} scope.`, { stage: 'fabmaster-export', code: 'FABMASTER_EXPORT_SIDE_EMPTY' });
  const board = model?.board || {}; const bounds = modelBounds(model, side); const width = Number(board.Width ?? board.width ?? (bounds.maxX - bounds.minX) ?? 0); const height = Number(board.Height ?? board.height ?? (bounds.maxY - bounds.minY) ?? 0);
  const meta = options.metadata || {}; const jMeta = [options.fileName || board.Name || board.name || 'UniversalCAD', meta.exportTime || new Date().toISOString(), '0', '0', fmt(width), fmt(height), '1', 'MILLIMETERS', `UCAD-${meta.appVersion || ''}`];
  const lines = [];
  const refHeaders = ['REFDES','COMP_CLASS','COMP_PART_NUMBER','COMP_HEIGHT','COMP_DEVICE_LABEL','COMP_INSERTION_CODE','SYM_TYPE','SYM_NAME','SYM_MIRROR','SYM_ROTATE','SYM_X','SYM_Y','COMP_VALUE','COMP_TOL','COMP_VOLTAGE'];
  lines.push(bangRow('A', refHeaders), bangRow('J', jMeta));
  for (const component of components) lines.push(bangRow('S', [component.name || component.id, 'PACKAGE', component.packageName || '', '', component.packageName || '', '', 'PACKAGE', component.packageName || component.name || '', normalizeSide(component.lands[0]?.side) === 'Bottom' ? 'YES' : 'NO', fmt(normalizeRotation(component.angle || 0)), fmt(component.centerX), fmt(component.centerY), '', '', '']));
  const padHeaders = ['PAD_NAME','REC_NUMBER','LAYER','FIX_FLAG','VIA_FLAG','PAD_SHAPE1','PAD_WIDTH','PAD_HGHT','PAD_XOFF','PAD_YOFF','PAD_FLASH','PAD_SHAPE_NAME'];
  lines.push('', bangRow('A', padHeaders), bangRow('J', jMeta));
  let padIndex = 1; const padByLand = new Map();
  for (const component of components) for (const land of component.lands) {
    const name = `UCAD_PAD_${padIndex++}`; padByLand.set(land, name);
    lines.push(bangRow('S', [name, '1', normalizeSide(land.side) === 'Bottom' ? 'BOTTOM' : 'TOP', '', '', 'RECTANGLE', fmt(land.width || DEFAULT_LAND_MM), fmt(land.length || DEFAULT_LAND_MM), '0', '0', '', '']));
  }
  const pinHeaders = ['SYM_NAME','SYM_MIRROR','PIN_NAME','PIN_NUMBER','PIN_X','PIN_Y','PAD_STACK_NAME','REFDES','PIN_ROTATION','TEST_POINT'];
  lines.push('', bangRow('A', pinHeaders), bangRow('J', jMeta));
  for (const component of components) for (const land of component.lands) {
    const cx = Number(land.left || 0) + Number(land.width || 0) / 2; const cy = Number(land.top || 0) - Number(land.length || 0) / 2;
    const pinName = land.cadName || land.globalId || 'none';
    lines.push(bangRow('S', [component.packageName || component.name || '', normalizeSide(land.side) === 'Bottom' ? 'YES' : 'NO', pinName, pinName, fmt(cx), fmt(cy), padByLand.get(land), component.name || component.id, '0', 'NO']));
  }
  const graphicHeaders = ['GRAPHIC_DATA_NAME','GRAPHIC_DATA_NUMBER','RECORD_TAG','GRAPHIC_DATA_1','GRAPHIC_DATA_2','GRAPHIC_DATA_3','GRAPHIC_DATA_4','GRAPHIC_DATA_5','GRAPHIC_DATA_6','GRAPHIC_DATA_7','GRAPHIC_DATA_8','GRAPHIC_DATA_9','SUBCLASS','SYM_NAME','REFDES'];
  lines.push('', bangRow('A', graphicHeaders), bangRow('J', jMeta));
  const segments = [[0,0,width,0],[width,0,width,height],[width,height,0,height],[0,height,0,0]];
  segments.forEach((segment, index) => lines.push(bangRow('S', ['LINE', String(index + 1), `BOARD ${index + 1}`, ...segment.map(fmt), '0', '', '', '', '', 'OUTLINE', '', ''])));
  lines.push('');
  return { text: lines.join('\n'), warnings: ['The manufacturing-ASCII writer exports component placement, rectangular lands/padstacks, and board outline data. Nets, traces, and vias are emitted only when represented in the Working Model.'], partial: true, format: 'fabmaster-ascii', extension: '.fab', mime: 'text/plain;charset=us-ascii' };
}

export const __test = { splitBang, tokenizeWhitespace, sourceUnitFromGencad, parseFabSections, rotatePoint, inverseRotatePoint };
