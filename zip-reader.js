const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

function asUint8Array(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  throw new TypeError('Unsupported ZIP input');
}

function decodeFilename(bytes, utf8 = true) {
  try {
    return new TextDecoder(utf8 ? 'utf-8' : 'windows-1252').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('เบราว์เซอร์นี้ไม่รองรับ DecompressionStream กรุณาใช้ Chrome หรือ Edge รุ่นใหม่');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export class ZipArchive {
  constructor(input) {
    this.bytes = asUint8Array(input);
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    this.entries = this.#readCentralDirectory();
  }

  #u16(offset) {
    return this.view.getUint16(offset, true);
  }

  #u32(offset) {
    return this.view.getUint32(offset, true);
  }

  #findEocd() {
    const minimum = Math.max(0, this.bytes.length - 0xffff - 22);
    for (let offset = this.bytes.length - 22; offset >= minimum; offset -= 1) {
      if (this.#u32(offset) === SIG_EOCD) return offset;
    }
    throw new Error('ไม่พบ End of Central Directory: ไฟล์อาจไม่ใช่ ZIP หรือเสียหาย');
  }

  #readCentralDirectory() {
    const eocd = this.#findEocd();
    const totalEntries = this.#u16(eocd + 10);
    const directoryOffset = this.#u32(eocd + 16);
    const entries = new Map();
    let cursor = directoryOffset;

    for (let i = 0; i < totalEntries; i += 1) {
      if (this.#u32(cursor) !== SIG_CENTRAL) {
        throw new Error(`โครงสร้าง ZIP ผิดปกติที่รายการ ${i + 1}`);
      }
      const flags = this.#u16(cursor + 8);
      const method = this.#u16(cursor + 10);
      const compressedSize = this.#u32(cursor + 20);
      const uncompressedSize = this.#u32(cursor + 24);
      const nameLength = this.#u16(cursor + 28);
      const extraLength = this.#u16(cursor + 30);
      const commentLength = this.#u16(cursor + 32);
      const localOffset = this.#u32(cursor + 42);
      const nameBytes = this.bytes.slice(cursor + 46, cursor + 46 + nameLength);
      const name = decodeFilename(nameBytes, Boolean(flags & 0x0800));
      entries.set(name, {
        name,
        flags,
        method,
        compressedSize,
        uncompressedSize,
        localOffset,
        isDirectory: name.endsWith('/'),
      });
      cursor += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
  }

  list() {
    return [...this.entries.values()];
  }

  find(predicate) {
    return this.list().find(predicate) || null;
  }

  async read(name, output = 'uint8array') {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`ไม่พบไฟล์ ${name} ใน ZIP`);
    if (entry.isDirectory) return new Uint8Array();
    if (entry.flags & 0x0001) throw new Error(`ไฟล์ ${name} ถูกเข้ารหัสและยังไม่รองรับ`);

    const offset = entry.localOffset;
    if (this.#u32(offset) !== SIG_LOCAL) throw new Error(`Local header ของ ${name} ไม่ถูกต้อง`);
    const nameLength = this.#u16(offset + 26);
    const extraLength = this.#u16(offset + 28);
    const dataOffset = offset + 30 + nameLength + extraLength;
    const compressed = this.bytes.slice(dataOffset, dataOffset + entry.compressedSize);

    let data;
    if (entry.method === 0) data = compressed;
    else if (entry.method === 8) data = await inflateRaw(compressed);
    else throw new Error(`ZIP compression method ${entry.method} ยังไม่รองรับ (${name})`);

    if (output === 'text') return new TextDecoder('utf-8').decode(data);
    if (output === 'arraybuffer') return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    return data;
  }
}

export async function readZipFile(file) {
  return new ZipArchive(await file.arrayBuffer());
}

function crc32Table() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    table[i] = value >>> 0;
  }
  return table;
}

const CRC32_TABLE = crc32Table();

export function crc32(input) {
  const bytes = asUint8Array(input);
  let crc = 0xffffffff;
  for (const value of bytes) crc = CRC32_TABLE[(crc ^ value) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pushU16(target, value) {
  target.push(value & 0xff, (value >>> 8) & 0xff);
}

function pushU32(target, value) {
  target.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((Math.floor(date.getSeconds() / 2)) & 0x1f);
  const dosDate = (((year - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0x0f) << 5) | (date.getDate() & 0x1f);
  return { dosDate, dosTime };
}

function concatChunks(chunks, totalLength) {
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}

export function createZip(entries) {
  const localChunks = [];
  const centralChunks = [];
  let localOffset = 0;
  let localLength = 0;
  let centralLength = 0;
  const now = dosDateTime(new Date());
  const encoder = new TextEncoder();

  for (const input of entries) {
    const name = String(input.name || input.path || 'file').replace(/\\/g, '/').replace(/^\/+/, '');
    const isDirectory = Boolean(input.isDirectory || name.endsWith('/'));
    const normalizedName = isDirectory && !name.endsWith('/') ? `${name}/` : name;
    const nameBytes = encoder.encode(normalizedName);
    const data = isDirectory ? new Uint8Array() : asUint8Array(input.bytes || new Uint8Array());
    const checksum = crc32(data);
    const flags = 0x0800;

    const local = [];
    pushU32(local, SIG_LOCAL);
    pushU16(local, 20);
    pushU16(local, flags);
    pushU16(local, 0);
    pushU16(local, now.dosTime);
    pushU16(local, now.dosDate);
    pushU32(local, checksum);
    pushU32(local, data.length);
    pushU32(local, data.length);
    pushU16(local, nameBytes.length);
    pushU16(local, 0);
    const localHeader = new Uint8Array(local);
    localChunks.push(localHeader, nameBytes, data);
    localLength += localHeader.length + nameBytes.length + data.length;

    const central = [];
    pushU32(central, SIG_CENTRAL);
    pushU16(central, 20);
    pushU16(central, 20);
    pushU16(central, flags);
    pushU16(central, 0);
    pushU16(central, now.dosTime);
    pushU16(central, now.dosDate);
    pushU32(central, checksum);
    pushU32(central, data.length);
    pushU32(central, data.length);
    pushU16(central, nameBytes.length);
    pushU16(central, 0);
    pushU16(central, 0);
    pushU16(central, 0);
    pushU16(central, 0);
    pushU32(central, isDirectory ? 0x10 : 0);
    pushU32(central, localOffset);
    const centralHeader = new Uint8Array(central);
    centralChunks.push(centralHeader, nameBytes);
    centralLength += centralHeader.length + nameBytes.length;
    localOffset += localHeader.length + nameBytes.length + data.length;
  }

  const eocd = [];
  pushU32(eocd, SIG_EOCD);
  pushU16(eocd, 0);
  pushU16(eocd, 0);
  pushU16(eocd, entries.length);
  pushU16(eocd, entries.length);
  pushU32(eocd, centralLength);
  pushU32(eocd, localLength);
  pushU16(eocd, 0);
  const eocdBytes = new Uint8Array(eocd);
  return concatChunks([...localChunks, ...centralChunks, eocdBytes], localLength + centralLength + eocdBytes.length);
}
