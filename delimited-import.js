import { ParseError } from './cad-errors.js';
import { detectCadFormat } from './format-detector.js';

function bytes(value) { return value instanceof Uint8Array ? value : new Uint8Array(value || 0); }
export function decodeTextBytes(value, encoding = 'utf-8') {
  const data = bytes(value);
  if (encoding === 'utf-16be') {
    const swapped = new Uint8Array(Math.max(0, data.length - 2));
    for (let i = 2; i + 1 < data.length; i += 2) { swapped[i - 2] = data[i + 1]; swapped[i - 1] = data[i]; }
    return new TextDecoder('utf-16le').decode(swapped);
  }
  const offset = encoding === 'utf-8-bom' ? 3 : encoding === 'utf-16le' ? 2 : 0;
  return new TextDecoder(encoding === 'utf-16le' ? 'utf-16le' : 'utf-8', { fatal: false }).decode(data.slice(offset));
}

export function detectDelimiter(text) {
  const sample = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim()).slice(0, 12);
  if (!sample.length) return ',';
  const candidates = [',', '\t', ';', '|'];
  const score = (delimiter) => {
    const counts = sample.map((line) => {
      let count = 1; let quoted = false;
      for (let i = 0; i < line.length; i += 1) {
        if (line[i] === '"') quoted = !quoted;
        else if (!quoted && line[i] === delimiter) count += 1;
      }
      return count;
    });
    const average = counts.reduce((sum, item) => sum + item, 0) / counts.length;
    const variance = counts.reduce((sum, item) => sum + Math.abs(item - average), 0);
    return average < 2 ? -Infinity : average * 10 - variance;
  };
  return candidates.sort((a, b) => score(b) - score(a))[0];
}

export function parseDelimitedText(text, options = {}) {
  const source = String(text || '').replace(/^\uFEFF/, '');
  const delimiter = options.delimiter || detectDelimiter(source);
  const rows = []; let row = []; let cell = ''; let quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === delimiter) { row.push(cell); cell = ''; }
    else if (char === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += char;
  }
  if (quoted) throw new ParseError('CSV/TXT มี quoted field ที่ปิดไม่สมบูรณ์', { stage: 'delimited-parse', fileName: options.fileName, code: 'DELIMITED_UNCLOSED_QUOTE' });
  if (cell.length || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  while (rows.length && rows[rows.length - 1].every((value) => !String(value).trim())) rows.pop();
  if (rows.length < 2) throw new ParseError('CSV/TXT ต้องมี Header และข้อมูลอย่างน้อยหนึ่งแถว', { stage: 'delimited-parse', fileName: options.fileName, code: 'DELIMITED_NO_DATA' });
  const width = Math.max(...rows.map((item) => item.length));
  for (const item of rows) while (item.length < width) item.push('');
  const detection = options.detection || detectCadFormat({ name: options.fileName, text: source });
  const headers = rows[0].map((value) => String(value || '').trim());
  const lowerHeaders = headers.map((value) => value.toLowerCase());
  const unitHeader = lowerHeaders.find((value) => /(?:^|[_ (])(mm|inch|in|mil)(?:$|[_ )])/.test(value)) || '';
  const unit = /mil/.test(unitHeader) ? 'mil' : /inch|\bin\b/.test(unitHeader) ? 'inch' : 'mm';
  return {
    sheets: [{ name: options.sheetName || 'Imported Data', rows }], activeSheet: { name: options.sheetName || 'Imported Data', rows },
    format: detection.format, detection, delimiter, encoding: options.encoding || 'utf-8', unit,
    rowCount: rows.length - 1, columnCount: width, headers,
    warnings: detection.format === 'delimited-text' ? ['ไม่สามารถระบุว่าเป็น CAD XY หรือ BOM จาก Header ได้ โปรดเลือกคอลัมน์ Mapping เอง'] : [],
  };
}

export function parseNumericCoordinate(value, { decimalSeparator = 'auto' } = {}) {
  let text = String(value ?? '').trim();
  if (!text) return null;
  if (decimalSeparator === ',' || (decimalSeparator === 'auto' && text.includes(',') && !text.includes('.'))) text = text.replace(',', '.');
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}
