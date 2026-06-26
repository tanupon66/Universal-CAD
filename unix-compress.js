function asBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new TypeError('Unsupported .Z input');
}

class ByteWriter {
  constructor(blockSize = 1024 * 1024) {
    this.blockSize = blockSize;
    this.blocks = [];
    this.block = new Uint8Array(blockSize);
    this.offset = 0;
    this.length = 0;
  }

  writeByte(value) {
    if (this.offset >= this.block.length) {
      this.blocks.push(this.block);
      this.block = new Uint8Array(this.blockSize);
      this.offset = 0;
    }
    this.block[this.offset++] = value & 0xff;
    this.length += 1;
  }

  finish() {
    const output = new Uint8Array(this.length);
    let target = 0;
    for (const block of this.blocks) {
      output.set(block, target);
      target += block.length;
    }
    output.set(this.block.subarray(0, this.offset), target);
    return output;
  }
}

function alignCodeBlock(posBits, width) {
  const groupBits = width << 3;
  return (posBits - 1) + (groupBits - ((posBits - 1 + groupBits) % groupBits));
}

/**
 * Decompress classic Unix compress (.Z) data in memory.
 * The stream format is LZW with little-endian bit packing, adaptive code width,
 * optional block-mode CLEAR codes, and width-change alignment to n_bits bytes.
 */
export function unlzw(input) {
  const bytes = asBytes(input);
  if (bytes.length < 4 || bytes[0] !== 0x1f || bytes[1] !== 0x9d) {
    throw new Error('ไฟล์ไม่ใช่ Unix compress (.Z): ไม่พบ magic 1F 9D');
  }

  const flags = bytes[2];
  const maxBits = flags & 0x1f;
  const blockMode = Boolean(flags & 0x80);
  const reserved = flags & 0x60;
  if (reserved) throw new Error(`ไฟล์ .Z ใช้ flag ที่ยังไม่รองรับ: 0x${reserved.toString(16)}`);
  if (maxBits < 9 || maxBits > 16) throw new Error(`ไฟล์ .Z ใช้ code width ${maxBits} บิต ซึ่งไม่รองรับ`);

  const maxMaxCode = 1 << maxBits;
  const prefix = new Uint32Array(maxMaxCode);
  const suffix = new Uint8Array(maxMaxCode);
  const stack = new Uint8Array(maxMaxCode + 1);
  for (let i = 0; i < 256; i += 1) suffix[i] = i;

  let nBits = 9;
  let maxCode = (1 << nBits) - 1;
  let freeEnt = blockMode ? 257 : 256;
  let oldCode = -1;
  let finChar = 0;

  // posBits is relative to segmentStartByte, mirroring gzip/unlzw's input
  // buffer. Width changes and CLEAR records realign then start a new segment.
  let segmentStartByte = 3;
  let posBits = 0; // code groups begin after the 3-byte .Z header
  const writer = new ByteWriter();

  const canRead = () => ((segmentStartByte << 3) + posBits + nBits) <= (bytes.length << 3);
  const readCode = () => {
    const absoluteBit = (segmentStartByte << 3) + posBits;
    const bytePos = absoluteBit >>> 3;
    const shift = absoluteBit & 7;
    const value = (bytes[bytePos] || 0)
      | ((bytes[bytePos + 1] || 0) << 8)
      | ((bytes[bytePos + 2] || 0) << 16)
      | ((bytes[bytePos + 3] || 0) << 24);
    const code = (value >>> shift) & ((1 << nBits) - 1);
    posBits += nBits;
    return code;
  };

  while (true) {
    if (freeEnt > maxCode) {
      posBits = alignCodeBlock(posBits, nBits);
      segmentStartByte += posBits >>> 3;
      posBits = 0;
      nBits += 1;
      maxCode = nBits === maxBits ? maxMaxCode : (1 << nBits) - 1;
    }

    if (!canRead()) break;
    let code = readCode();

    if (oldCode === -1) {
      if (code >= 256) throw new Error('ข้อมูล .Z เสียหาย: รหัสแรกไม่ใช่ literal');
      finChar = code;
      oldCode = code;
      writer.writeByte(code);
      continue;
    }

    if (blockMode && code === 256) {
      prefix.fill(0, 0, 256);
      freeEnt = 256; // FIRST - 1; next normal entry becomes 256
      posBits = alignCodeBlock(posBits, nBits);
      segmentStartByte += posBits >>> 3;
      posBits = 0;
      nBits = 9;
      maxCode = (1 << nBits) - 1;
      continue;
    }

    const inCode = code;
    let stackPos = stack.length;
    if (code >= freeEnt) {
      if (code > freeEnt) throw new Error(`ข้อมูล .Z เสียหาย: code ${code} มากกว่า free entry ${freeEnt}`);
      stack[--stackPos] = finChar;
      code = oldCode;
    }

    let guard = 0;
    while (code >= 256) {
      if (code >= maxMaxCode || guard++ > maxMaxCode) throw new Error('ข้อมูล .Z เสียหาย: dictionary chain ผิดปกติ');
      stack[--stackPos] = suffix[code];
      code = prefix[code];
    }
    finChar = suffix[code];
    stack[--stackPos] = finChar;
    while (stackPos < stack.length) writer.writeByte(stack[stackPos++]);

    if (freeEnt < maxMaxCode) {
      prefix[freeEnt] = oldCode;
      suffix[freeEnt] = finChar;
      freeEnt += 1;
    }
    oldCode = inCode;
  }

  return writer.finish();
}

export function isUnixCompress(input) {
  const bytes = asBytes(input);
  return bytes.length >= 3 && bytes[0] === 0x1f && bytes[1] === 0x9d;
}
