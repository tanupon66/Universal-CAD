import { ParseError, ValidationError } from './cad-errors.js';
import { detectCadFormat } from './format-detector.js';

function decodeXml(value = '') { return String(value).replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); }
function attrs(text = '') { const output = {}; const re = /([:\w.-]+)\s*=\s*(["'])([\s\S]*?)\2/g; let m; while ((m = re.exec(text))) output[m[1]] = decodeXml(m[3]); return output; }
function pick(object, keys, fallback = '') { for (const key of keys) if (object[key] != null && object[key] !== '') return object[key]; return fallback; }
function number(value, fallback = 0) { const normalized = String(value ?? '').trim().replace(',', '.'); const parsed = Number(normalized); return Number.isFinite(parsed) ? parsed : fallback; }
function xmlEscape(value) { return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;'); }
export function assertWellFormedXml(text, options = {}) {
  const source = String(text || '').replace(/^\uFEFF/, '');
  if (!source.trim().startsWith('<')) throw new ParseError('ข้อมูลไม่ใช่ XML', { stage: 'xml-structure', fileName: options.fileName, code: 'XML_NO_ROOT' });
  if (typeof DOMParser !== 'undefined') {
    const document = new DOMParser().parseFromString(source, 'application/xml');
    const parserError = document.querySelector('parsererror');
    if (parserError) throw new ParseError(`XML ไม่สมบูรณ์: ${parserError.textContent?.trim().slice(0, 240) || 'parse error'}`, { stage: 'xml-structure', fileName: options.fileName, code: 'XML_MALFORMED' });
    return source;
  }
  const cleaned = source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '');
  const tokenRe = /<\s*(\/?)\s*([A-Za-z_][\w.:-]*)(?:\s[^<>]*?)?(\/?)\s*>/g;
  const stack = []; let match; let rootCount = 0;
  while ((match = tokenRe.exec(cleaned))) {
    const closing = Boolean(match[1]); const name = match[2]; const selfClosing = Boolean(match[3]);
    if (closing) {
      const expected = stack.pop();
      if (expected !== name) throw new ParseError(`XML tag ไม่ตรงกัน: คาด </${expected || 'none'}> แต่พบ </${name}>`, { stage: 'xml-structure', fileName: options.fileName, code: 'XML_MISMATCHED_TAG' });
    } else if (!selfClosing) {
      if (!stack.length) rootCount += 1;
      stack.push(name);
    } else if (!stack.length) rootCount += 1;
  }
  if (stack.length) throw new ParseError(`XML ปิด tag ไม่ครบ: ${stack.slice(-5).join(' > ')}`, { stage: 'xml-structure', fileName: options.fileName, code: 'XML_UNCLOSED_TAG' });
  if (rootCount !== 1) throw new ParseError(`XML ต้องมี Root element เดียว แต่ตรวจพบ ${rootCount}`, { stage: 'xml-structure', fileName: options.fileName, code: 'XML_ROOT_COUNT' });
  return source;
}
export function assertSafeXml(text, options = {}) {
  const source = String(text || '');
  if (/<!DOCTYPE\b/i.test(source) || /<!ENTITY\b/i.test(source)) throw new ParseError('XML ที่มี DOCTYPE/ENTITY ไม่ได้รับอนุญาตเพื่อป้องกัน Entity Expansion', { stage: 'xml-security', fileName: options.fileName, code: 'XML_ENTITY_DECLARATION' });
  if (/<script\b|javascript\s*:|on(?:load|error|click)\s*=/i.test(source)) throw new ParseError('ตรวจพบ Script หรือ Event Handler ใน XML Metadata', { stage: 'xml-security', fileName: options.fileName, code: 'XML_ACTIVE_CONTENT' });
  return assertWellFormedXml(source.replace(/^\uFEFF/, ''), options);
}
function elementRecords(text, localName) {
  const re = new RegExp(`<(?:[A-Za-z_][\\w.-]*:)?${localName}\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/(?:[A-Za-z_][\\w.-]*:)?${localName}>)`, 'gi');
  const rows = []; let match; while ((match = re.exec(text))) rows.push({ attributes: attrs(match[1]), body: match[2] || '' }); return rows;
}
function xformFromBody(body, direct = {}) {
  const location = elementRecords(body, 'Location')[0]?.attributes || elementRecords(body, 'Center')[0]?.attributes || {};
  const xform = elementRecords(body, 'Xform')[0]?.attributes || elementRecords(body, 'Transform')[0]?.attributes || {};
  return {
    x: number(pick(direct, ['x', 'X', 'posX', 'PosX'], pick(location, ['x', 'X'], 0))),
    y: number(pick(direct, ['y', 'Y', 'posY', 'PosY'], pick(location, ['y', 'Y'], 0))),
    rotation: number(pick(direct, ['rotation', 'Rotation', 'rot'], pick(xform, ['rotation', 'Rotation', 'rot'], 0))),
    side: String(pick(direct, ['side', 'Side', 'layerRef'], pick(xform, ['side', 'Side', 'mirror'], 'Top'))),
  };
}
export function convertIpc2581ToInspectionXml(xmlText, options = {}) {
  const source = assertSafeXml(xmlText, options); const warnings = []; const unsupportedRecords = [];
  const packageMap = new Map();
  for (const record of [...elementRecords(source, 'Package'), ...elementRecords(source, 'PackageDefinition')]) {
    const name = String(pick(record.attributes, ['name', 'Name', 'id', 'Id', 'packageRef', 'PackageRef'], '')).trim(); if (!name || packageMap.has(name)) continue;
    const pins = [];
    for (const pin of [...elementRecords(record.body, 'Pin'), ...elementRecords(record.body, 'Land'), ...elementRecords(record.body, 'Pad')]) {
      const a = pin.attributes; const pos = xformFromBody(pin.body, a);
      const width = Math.abs(number(pick(a, ['width', 'Width', 'sizeX', 'diameter'], 0.5), 0.5));
      const height = Math.abs(number(pick(a, ['height', 'Height', 'sizeY', 'diameter'], width), width));
      pins.push({ name: String(pick(a, ['name', 'Name', 'number', 'Number', 'id', 'Id'], pins.length + 1)), x: pos.x, y: pos.y, width: width || 0.5, height: height || width || 0.5, side: pos.side });
    }
    packageMap.set(name, { name, pins });
  }
  const componentRecords = [...elementRecords(source, 'Component'), ...elementRecords(source, 'ComponentInstance')];
  const components = []; let nextId = 1;
  for (const record of componentRecords) {
    const a = record.attributes;
    const ref = String(pick(a, ['refDes', 'RefDes', 'refdes', 'reference', 'Reference', 'name', 'Name'], '')).trim();
    const packageName = String(pick(a, ['packageRef', 'PackageRef', 'package', 'Package', 'packageName'], '')).trim();
    if (!ref || !packageName) { unsupportedRecords.push({ type: 'Component', reason: 'missing refDes or packageRef', attributes: a }); continue; }
    const transform = xformFromBody(record.body, a);
    components.push({ id: String(nextId++), ref, packageName, revision: String(pick(a, ['revision', 'Revision'], '')), ...transform });
  }
  if (!components.length) throw new ParseError('IPC-2581 นี้ไม่มี Component Placement ที่ Adapter อ่านได้', { stage: 'ipc-2581-components', fileName: options.fileName, context: { rootDetected: true } });
  let landId = 1; const componentXml = []; const landXml = [];
  for (const component of components) {
    componentXml.push(`<ComponentInformation Id="${xmlEscape(component.id)}" Name="${xmlEscape(component.ref)}"><ComponentInformationItem ComponentNumberId="${xmlEscape(component.packageName)}" ComponentNumberRevision="${xmlEscape(component.revision)}"/><PositionAngle CenterPosX="${component.x}" CenterPosY="${component.y}" Angle="${component.rotation}"/></ComponentInformation>`);
    const pkg = packageMap.get(component.packageName);
    if (!pkg?.pins?.length) { warnings.push(`Package ${component.packageName} ของ ${component.ref} ไม่มี Pin geometry ที่อ่านได้`); continue; }
    for (const pin of pkg.pins) {
      const left = component.x + pin.x - pin.width / 2; const top = component.y + pin.y + pin.height / 2;
      landXml.push(`<LandNumber LandId="${landId++}" Component="${xmlEscape(component.id)}" Name="${xmlEscape(pin.name)}" Side="${/bottom|bot|mirror|true/i.test(component.side) ? 'Bottom' : 'Top'}"><Land Left="${left}" Top="${top}" Width="${pin.width}" Length="${pin.height}"/></LandNumber>`);
    }
  }
  const boardRecord = elementRecords(source, 'Profile')[0] || elementRecords(source, 'Board')[0]; const boardAttrs = boardRecord?.attributes || {};
  const boardName = String(pick(boardAttrs, ['name', 'Name'], options.fileName || 'IPC-2581 Board'));
  const inspectionXml = `<?xml version="1.0" encoding="UTF-8"?>\n<Inspection SourceFormat="IPC-2581" Adapter="UniversalCAD">\n<BoardInformation Name="${xmlEscape(boardName)}" Width="${number(pick(boardAttrs, ['width', 'Width'], 0))}" Height="${number(pick(boardAttrs, ['height', 'Height'], 0))}" Thickness="${number(pick(boardAttrs, ['thickness', 'Thickness'], 0))}"/>\n<Components>${componentXml.join('')}</Components>\n<Lands>${landXml.join('')}</Lands>\n</Inspection>`;
  return { xmlText: inspectionXml, warnings, unsupportedRecords, components: components.length, packages: packageMap.size, lands: landId - 1, sourceFormat: 'ipc-2581', partial: warnings.length > 0 || unsupportedRecords.length > 0 };
}
export function adaptCadText(xmlText, options = {}) {
  const source = assertSafeXml(xmlText, options); const detection = options.detection || detectCadFormat({ name: options.fileName, mimeType: options.mimeType, text: source });
  if (detection.format === 'inspection-xml') return { xmlText: source, warnings: [], unsupportedRecords: [], sourceFormat: 'inspection-xml', partial: false, detection };
  if (detection.format === 'ipc-2581') return { ...convertIpc2581ToInspectionXml(source, options), detection };
  throw new ValidationError(`XML root ${detection.rootElement || 'unknown'} ยังไม่มี Import Adapter`, { stage: 'format-adapter', fileName: options.fileName, context: detection, code: 'UNSUPPORTED_XML_FORMAT' });
}
