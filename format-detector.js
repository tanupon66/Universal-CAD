import { textFromBytes } from './archive-reader.js';

const XML_SAMPLE_LIMIT = 1024 * 1024;
function asBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  return new Uint8Array();
}
function lower(value) { return String(value || '').toLowerCase(); }
function extensionOf(name) {
  const value = String(name || '').split(/[\\/]/).pop() || '';
  if (/\.tar\.gz$/i.test(value)) return '.tar.gz';
  const dot = value.lastIndexOf('.');
  return dot >= 0 ? value.slice(dot).toLowerCase() : '';
}
export function detectEncoding(bytes) {
  const data = asBytes(bytes);
  if (data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) return 'utf-8-bom';
  if (data.length >= 2 && data[0] === 0xff && data[1] === 0xfe) return 'utf-16le';
  if (data.length >= 2 && data[0] === 0xfe && data[1] === 0xff) return 'utf-16be';
  const sample = data.slice(0, Math.min(512, data.length)); let even = 0, odd = 0;
  for (let i = 0; i < sample.length; i += 1) if (sample[i] === 0) i % 2 ? odd++ : even++;
  const pairs = Math.max(1, Math.floor(sample.length / 2));
  if (odd / pairs > 0.25 && even / pairs < 0.08) return 'utf-16le';
  if (even / pairs > 0.25 && odd / pairs < 0.08) return 'utf-16be';
  return 'utf-8';
}
export function xmlRootInfo(text) {
  const source = String(text || '').replace(/^\uFEFF/, '').trimStart();
  const declaration = source.match(/^<\?xml\s+([^?]+)\?>/i)?.[1] || '';
  const root = source.match(/<(?!\?|!)([A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)\b([^>]*)>/);
  if (!root) return { rootName: '', prefix: '', namespace: '', declaration };
  const attrs = root[3] || ''; const prefix = (root[1] || '').replace(':', '');
  const namespace = attrs.match(new RegExp(`\\bxmlns${prefix ? `:${prefix}` : ''}=["']([^"']+)["']`, 'i'))?.[1]
    || attrs.match(/\bxmlns(?::[\w.-]+)?=["']([^"']+)["']/i)?.[1] || '';
  return { rootName: root[2], prefix, namespace, declaration };
}
function magicType(bytes) {
  const data = asBytes(bytes);
  if (data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b && [0x03, 0x05, 0x07].includes(data[2])) return 'zip';
  if (data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b) return 'gzip';
  if (data.length >= 3 && data[0] === 0x1f && data[1] === 0x9d) return 'unix-compress';
  if (data.length >= 263) {
    const magic = new TextDecoder('ascii').decode(data.slice(257, 263));
    if (magic.startsWith('ustar')) return 'tar';
  }
  return '';
}
function looksGerber(text) {
  const source = String(text || '').slice(0, 20000);
  return /%FS(?:L|T)A?X\dY\d\*%/i.test(source) || /%MO(?:MM|IN)\*%/i.test(source) || /G0?[1236]\*/.test(source) && /M02\*/.test(source);
}
function looksExcellon(text) {
  const source = String(text || '').slice(0, 20000);
  return /(?:^|\r?\n)M48(?:\r?\n|$)/i.test(source) || /(?:^|\r?\n)T\d+C[\d.]+/i.test(source) && /(?:^|\r?\n)[XY][+-]?\d+/i.test(source);
}
function looksDelimited(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean).slice(0, 8);
  if (lines.length < 2) return null;
  const delimiters = [',', '\t', ';', '|'];
  for (const delimiter of delimiters) {
    const counts = lines.map((line) => line.split(delimiter).length);
    if (counts[0] >= 2 && counts.every((count) => Math.abs(count - counts[0]) <= 1)) return delimiter;
  }
  return null;
}
function classifyDelimited(text) {
  const first = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0].toLowerCase();
  const xy = /\b(ref(?:des)?|reference|designator|component)\b/.test(first) && /\b(x|posx|centerx|x_coord|x coordinate)\b/.test(first) && /\b(y|posy|centery|y_coord|y coordinate)\b/.test(first);
  const bom = /\b(part(?: number)?|pn|mpn|description|qty|quantity)\b/.test(first) && /\b(ref(?:des)?|reference|designator)\b/.test(first);
  if (xy && bom) return 'cad-xy-bom-delimited';
  if (xy) return 'cad-xy-delimited';
  if (bom) return 'bom-delimited';
  return 'delimited-text';
}
export function validateArchivePath(path) {
  const original = String(path || '').replace(/\\/g, '/');
  if (!original || original.includes('\u0000')) return { safe: false, normalized: '', reason: 'ชื่อไฟล์ว่างหรือมี NUL' };
  if (/^[A-Za-z]:\//.test(original) || original.startsWith('/')) return { safe: false, normalized: '', reason: 'Absolute path ไม่อนุญาต' };
  const parts = [];
  for (const part of original.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') return { safe: false, normalized: '', reason: 'ตรวจพบ path traversal (..)' };
    parts.push(part);
  }
  if (!parts.length) return { safe: false, normalized: '', reason: 'Path ไม่มีชื่อไฟล์' };
  return { safe: true, normalized: parts.join('/'), reason: '' };
}
export function sanitizeFilename(name, fallback = 'export') {
  const base = String(name || fallback).split(/[\\/]/).pop().replace(/[\u0000-\u001f<>:"|?*]/g, '_').replace(/^\.+/, '').trim();
  return (base || fallback).slice(0, 180);
}
export function detectCadFormat({ name = '', mimeType = '', bytes = null, text = null, archiveEntries = null } = {}) {
  const data = asBytes(bytes); const extension = extensionOf(name); const mime = lower(mimeType); const magic = magicType(data);
  let sourceText = text == null && data.length ? textFromBytes(data.slice(0, Math.min(data.length, XML_SAMPLE_LIMIT))) : String(text || '');
  sourceText = sourceText.replace(/^\uFEFF/, '');
  const root = xmlRootInfo(sourceText); const evidence = []; let format = 'unknown'; let confidence = 0;
  if (magic === 'zip') { format = extension === '.xlsx' || mime.includes('spreadsheetml') ? 'xlsx' : 'zip'; confidence = 0.98; evidence.push(`magic:${magic}`); }
  else if (magic === 'gzip') { format = ['.tgz', '.tar.gz'].includes(extension) ? 'tgz' : 'gzip'; confidence = 0.98; evidence.push(`magic:${magic}`); }
  else if (magic === 'tar') { format = 'tar'; confidence = 0.99; evidence.push('magic:tar'); }
  else if (magic === 'unix-compress') { format = 'unix-compress'; confidence = 0.98; evidence.push('magic:unix-compress'); }
  if (root.rootName) {
    const rootLower = root.rootName.toLowerCase(); const ns = lower(root.namespace);
    if (rootLower === 'ipc-2581' || rootLower === 'ipc2581' || ns.includes('ipc-2581') || ns.includes('ipc2581')) { format = 'ipc-2581'; confidence = 0.99; evidence.push(`xml-root:${root.rootName}`, `namespace:${root.namespace || 'none'}`); }
    else if (/boardinformation|inspection|project/i.test(root.rootName) && /<(?:[\w.-]+:)?(?:BoardInformation|ComponentInformation|LandNumber)\b/i.test(sourceText)) { format = 'inspection-xml'; confidence = 0.98; evidence.push(`xml-root:${root.rootName}`, 'inspection-elements'); }
    else { format = 'xml'; confidence = Math.max(confidence, 0.7); evidence.push(`xml-root:${root.rootName}`); }
  } else if (looksGerber(sourceText)) { format = 'gerber'; confidence = 0.93; evidence.push('gerber-commands'); }
  else if (looksExcellon(sourceText)) { format = 'excellon'; confidence = 0.93; evidence.push('excellon-commands'); }
  else {
    const delimiter = looksDelimited(sourceText);
    if (delimiter) { format = classifyDelimited(sourceText); confidence = 0.82; evidence.push(`delimiter:${delimiter === '\t' ? 'tab' : delimiter}`); }
  }
  if (Array.isArray(archiveEntries) && archiveEntries.length) {
    const normalized = archiveEntries.map((entry) => String(entry.path || entry.name || '').replace(/\\/g, '/').toLowerCase());
    const odb = normalized.some((path) => /(?:^|\/)steps\/[^/]+\/(?:eda\/data|layers\/comp_\+_(?:top|bot)\/components[23]?)(?:\.z)?$/.test(path));
    if (odb) { format = 'odb++'; confidence = 0.99; evidence.push('archive-structure:odb++'); }
    if (format === 'zip' && normalized.includes('[content_types].xml') && normalized.some((path) => /^xl\/workbook\.xml$/.test(path))) { format = 'xlsx'; confidence = 0.99; evidence.push('archive-structure:xlsx'); }
  }
  if (extension && !evidence.some((item) => item.startsWith('extension:'))) evidence.push(`extension:${extension}`);
  if (mime) evidence.push(`mime:${mime}`);
  return {
    format, confidence, evidence, extension, mimeType: mimeType || '', magic,
    encoding: detectEncoding(data), rootElement: root.rootName, namespace: root.namespace,
    supported: ['inspection-xml', 'ipc-2581', 'odb++', 'zip', 'tgz', 'tar', 'gzip', 'unix-compress', 'xlsx', 'cad-xy-delimited', 'cad-xy-bom-delimited', 'bom-delimited', 'gerber', 'excellon'].includes(format),
  };
}
