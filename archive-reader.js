function asBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new TypeError('Unsupported archive input');
}

function readString(bytes, offset, length) {
  const slice = bytes.slice(offset, offset + length);
  const zero = slice.indexOf(0);
  return new TextDecoder('utf-8').decode(zero >= 0 ? slice.slice(0, zero) : slice).trim();
}

function readOctal(bytes, offset, length) {
  const text = readString(bytes, offset, length).replace(/\0/g, '').trim();
  return text ? Number.parseInt(text, 8) || 0 : 0;
}

function isZeroBlock(bytes, offset) {
  for (let i = offset; i < Math.min(offset + 512, bytes.length); i += 1) if (bytes[i] !== 0) return false;
  return true;
}

function parsePax(bytes) {
  const text = new TextDecoder('utf-8').decode(bytes);
  const values = {};
  let cursor = 0;
  while (cursor < text.length) {
    const space = text.indexOf(' ', cursor);
    if (space < 0) break;
    const length = Number(text.slice(cursor, space));
    if (!Number.isFinite(length) || length <= 0) break;
    const record = text.slice(space + 1, cursor + length - 1);
    const equals = record.indexOf('=');
    if (equals > 0) values[record.slice(0, equals)] = record.slice(equals + 1);
    cursor += length;
  }
  return values;
}

export function parseTar(input) {
  const bytes = asBytes(input);
  const entries = [];
  let cursor = 0;
  let longName = '';
  let pax = {};
  while (cursor + 512 <= bytes.length) {
    if (isZeroBlock(bytes, cursor)) break;
    const name = readString(bytes, cursor, 100);
    const mode = readOctal(bytes, cursor + 100, 8);
    const size = readOctal(bytes, cursor + 124, 12);
    const mtime = readOctal(bytes, cursor + 136, 12);
    const type = String.fromCharCode(bytes[cursor + 156] || 48);
    const prefix = readString(bytes, cursor + 345, 155);
    const headerPath = prefix ? `${prefix}/${name}` : name;
    const dataStart = cursor + 512;
    const dataEnd = Math.min(bytes.length, dataStart + size);
    const data = bytes.slice(dataStart, dataEnd);
    cursor = dataStart + Math.ceil(size / 512) * 512;

    if (type === 'L') {
      longName = new TextDecoder('utf-8').decode(data).replace(/\0+$/, '');
      continue;
    }
    if (type === 'x' || type === 'g') {
      pax = { ...pax, ...parsePax(data) };
      continue;
    }
    const path = pax.path || longName || headerPath;
    const isDirectory = type === '5' || path.endsWith('/');
    entries.push({ path, name: path, bytes: data, size, mode, mtime, type, isDirectory });
    longName = '';
    pax = {};
  }
  return entries;
}

async function transformStream(bytes, format, mode) {
  const StreamType = mode === 'compress' ? globalThis.CompressionStream : globalThis.DecompressionStream;
  if (!StreamType) throw new Error(`เบราว์เซอร์นี้ไม่รองรับ ${mode === 'compress' ? 'CompressionStream' : 'DecompressionStream'} กรุณาใช้ Chrome หรือ Edge รุ่นใหม่`);
  const stream = new Blob([bytes]).stream().pipeThrough(new StreamType(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gunzip(input) {
  return transformStream(asBytes(input), 'gzip', 'decompress');
}

export async function gzip(input) {
  return transformStream(asBytes(input), 'gzip', 'compress');
}

function writeAscii(target, offset, length, value) {
  const bytes = new TextEncoder().encode(String(value));
  target.set(bytes.slice(0, length), offset);
}

function writeOctal(target, offset, length, value) {
  const text = Math.max(0, Number(value) || 0).toString(8).padStart(length - 1, '0').slice(-(length - 1));
  writeAscii(target, offset, length - 1, text);
  target[offset + length - 1] = 0;
}

function splitTarPath(path) {
  const normalized = String(path || 'file').replace(/^\/+/, '').replace(/\\/g, '/');
  const encoded = new TextEncoder().encode(normalized);
  if (encoded.length <= 100) return { name: normalized, prefix: '' };
  const slashIndexes = [...normalized.matchAll(/\//g)].map((match) => match.index);
  for (let i = slashIndexes.length - 1; i >= 0; i -= 1) {
    const prefix = normalized.slice(0, slashIndexes[i]);
    const name = normalized.slice(slashIndexes[i] + 1);
    if (new TextEncoder().encode(name).length <= 100 && new TextEncoder().encode(prefix).length <= 155) return { name, prefix };
  }
  throw new Error(`ชื่อไฟล์ใน TGZ ยาวเกินมาตรฐาน TAR: ${normalized}`);
}

function tarHeader(entry) {
  const header = new Uint8Array(512);
  const { name, prefix } = splitTarPath(entry.headerPath || entry.path);
  const data = asBytes(entry.bytes || new Uint8Array());
  writeAscii(header, 0, 100, name);
  writeOctal(header, 100, 8, entry.mode || (entry.isDirectory ? 0o755 : 0o644));
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, entry.isDirectory ? 0 : data.length);
  writeOctal(header, 136, 12, entry.mtime || Math.floor(Date.now() / 1000));
  for (let i = 148; i < 156; i += 1) header[i] = 32;
  header[156] = String(entry.type || (entry.isDirectory ? '5' : '0')).charCodeAt(0);
  writeAscii(header, 257, 6, 'ustar');
  header[262] = 0;
  writeAscii(header, 263, 2, '00');
  writeAscii(header, 265, 32, 'cad-editor');
  writeAscii(header, 297, 32, 'cad-editor');
  writeAscii(header, 345, 155, prefix);
  let checksum = 0;
  for (const value of header) checksum += value;
  const checksumText = checksum.toString(8).padStart(6, '0').slice(-6);
  writeAscii(header, 148, 6, checksumText);
  header[154] = 0;
  header[155] = 32;
  return header;
}

export function createTar(entries) {
  const chunks = [];
  let total = 1024;
  const pushEntry = (entry, data) => {
    const padding = (512 - (data.length % 512)) % 512;
    chunks.push(tarHeader({ ...entry, bytes: data }), data, new Uint8Array(padding));
    total += 512 + data.length + padding;
  };
  for (const input of entries) {
    const entry = { ...input, path: input.path || input.name };
    const data = entry.isDirectory ? new Uint8Array() : asBytes(entry.bytes || new Uint8Array());
    let headerPath = entry.path;
    try { splitTarPath(headerPath); }
    catch {
      const longData = new Uint8Array([...new TextEncoder().encode(String(entry.path)), 0]);
      pushEntry({ path: '././@LongLink', type: 'L', mode: 0o644, mtime: entry.mtime }, longData);
      const basename = String(entry.path).replace(/\\/g, '/').split('/').pop() || 'file';
      headerPath = new TextDecoder().decode(new TextEncoder().encode(basename).slice(0, 100));
    }
    pushEntry({ ...entry, headerPath }, data);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}

export async function readTgzFile(file) {
  const lower = String(file?.name || '').toLowerCase();
  const raw = new Uint8Array(await file.arrayBuffer());
  const tar = lower.endsWith('.tar') ? raw : await gunzip(raw);
  return parseTar(tar);
}

export async function buildTgz(entries) {
  return gzip(createTar(entries));
}

export function textFromBytes(bytes) {
  const data = asBytes(bytes);
  if (!data.length) return '';
  if (data.length >= 2 && data[0] === 0xff && data[1] === 0xfe) return new TextDecoder('utf-16le').decode(data.slice(2));
  if (data.length >= 2 && data[0] === 0xfe && data[1] === 0xff) return new TextDecoder('utf-16be').decode(data.slice(2));
  if (data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) return new TextDecoder('utf-8').decode(data.slice(3));
  const sample = data.slice(0, Math.min(data.length, 512));
  let evenNulls = 0;
  let oddNulls = 0;
  for (let i = 0; i < sample.length; i += 1) {
    if (sample[i] === 0) { if (i % 2) oddNulls += 1; else evenNulls += 1; }
  }
  const pairs = Math.max(1, Math.floor(sample.length / 2));
  if (oddNulls / pairs > 0.25 && evenNulls / pairs < 0.08) return new TextDecoder('utf-16le').decode(data);
  if (evenNulls / pairs > 0.25 && oddNulls / pairs < 0.08) return new TextDecoder('utf-16be').decode(data);
  let text = new TextDecoder('utf-8').decode(data);
  const declaration = text.slice(0, 300).match(/<\?xml[^>]*encoding=["']([^"']+)["']/i)?.[1];
  if (declaration && !/^utf-?8$/i.test(declaration)) {
    try { text = new TextDecoder(declaration).decode(data); } catch { /* keep UTF-8 fallback */ }
  }
  return text.replace(/^\uFEFF/, '');
}

export function bytesFromText(text) {
  return new TextEncoder().encode(String(text ?? ''));
}

export function scoreCadXml(text) {
  const source = String(text || '');
  let score = 0;
  if (/<(?:[A-Za-z_][\w.-]*:)?BoardInformation\b/i.test(source)) score += 4;
  if (/<(?:[A-Za-z_][\w.-]*:)?ComponentInformation\b/i.test(source)) score += 5;
  if (/<(?:[A-Za-z_][\w.-]*:)?LandNumber\b/i.test(source)) score += 6;
  if (/<(?:[A-Za-z_][\w.-]*:)?Land\b/i.test(source)) score += 2;
  return score;
}

export function findCadXmlEntries(entries) {
  return entries
    .filter((entry) => !entry.isDirectory && Number(entry.bytes?.length || 0) <= 120 * 1024 * 1024)
    .map((entry) => {
      let text = '';
      try { text = textFromBytes(entry.bytes); } catch { text = ''; }
      const extensionBonus = /\.xml$/i.test(entry.path || entry.name || '') ? 1 : 0;
      return { ...entry, text, score: scoreCadXml(text) + extensionBonus };
    })
    .filter((entry) => entry.score > 1)
    .sort((a, b) => b.score - a.score || String(a.path).localeCompare(String(b.path)));
}
