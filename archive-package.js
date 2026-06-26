import { ZipArchive, createZip } from './zip-reader.js';
import { bytesFromText, createTar, gzip, gunzip, parseTar, scoreCadXml, textFromBytes } from './archive-reader.js';
import { convertOdbPackageToInspectionXml } from './odb-parser.js';
import { isUnixCompress, unlzw } from './unix-compress.js';
import { detectCadFormat, validateArchivePath } from './format-detector.js';
import { adaptCadText } from './import-adapters.js';
import { ArchiveError } from './cad-errors.js';

const MAX_DEPTH = 5;
const MAX_SCAN_BYTES = 120 * 1024 * 1024;
const MAX_UNKNOWN_SCAN_BYTES = 24 * 1024 * 1024;
const MAX_ARCHIVE_FILES = 20000;
const MAX_EXPANDED_BYTES = 512 * 1024 * 1024;
const MAX_COMPRESSION_RATIO = 250;

function asBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new TypeError('Unsupported package input');
}

function lowerName(name = '') { return String(name).toLowerCase(); }
function isZipName(name) { return /\.zip$/i.test(name); }
function isTgzName(name) { return /\.(?:tgz|tar\.gz|gz)$/i.test(name); }
function isTarName(name) { return /\.tar$/i.test(name); }
function isXmlName(name) { return /\.(?:xml|cad|cpo|job|dat|txt)$/i.test(name); }
function isArchiveName(name) { return isZipName(name) || isTgzName(name) || isTarName(name); }
function isOdbRelevantName(name) {
  const value = String(name || '').replace(/\\/g, '/').toLowerCase();
  return /(?:^|\/)steps\/[^/]+\/layers\/comp_\+_(?:top|bot)\/components(?:[23])?(?:\.z)?$/.test(value)
    || /(?:^|\/)steps\/[^/]+\/eda\/data(?:\.z)?$/.test(value)
    || /(?:^|\/)matrix\/matrix(?:\.z)?$/.test(value)
    || /(?:^|\/)steps\/[^/]+\/profile(?:\.z)?$/.test(value);
}

function hasZipMagic(bytes) { return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && [0x03, 0x05, 0x07].includes(bytes[2]); }
function hasGzipMagic(bytes) { return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b; }
function hasTarMagic(bytes) {
  if (bytes.length < 512) return false;
  const magic = new TextDecoder('ascii').decode(bytes.slice(257, 263));
  return magic.startsWith('ustar');
}
function looksLikeXml(bytes) {
  const sample = textFromBytes(bytes.slice(0, Math.min(bytes.length, 4096))).replace(/^\uFEFF/, '').trimStart();
  return sample.startsWith('<?xml') || sample.startsWith('<');
}

function joinPath(parent, name) { return parent ? `${parent} → ${name}` : name; }

async function parseFileNode(name, bytes, displayPath, depth, diagnostics) {
  const data = asBytes(bytes);
  if (depth > MAX_DEPTH) {
    diagnostics.push(`ข้าม archive ซ้อนเกิน ${MAX_DEPTH} ชั้น: ${displayPath}`);
    return { root: { kind: 'file', name, bytes: data }, candidates: [] };
  }

  if (hasZipMagic(data) || isZipName(name)) return parseZipNode(name, data, displayPath, depth, diagnostics);
  // Classic Unix compress (.Z) is common in ODB++ and older CAD exports. At the
  // package root we can safely unwrap it and continue through the normal XML/TAR
  // detection path. Nested .Z entries remain owned by the ODB parser so archive
  // rebuild never writes uncompressed bytes back under a .Z filename.
  if (depth === 0 && (isUnixCompress(data) || /\.z$/i.test(name))) {
    try {
      const unpacked = unlzw(data);
      const innerName = String(name || 'cad.Z').replace(/\.z$/i, '') || 'cad.xml';
      diagnostics.push(`แตก Unix compress (.Z) สำเร็จ: ${displayPath}`);
      return parseFileNode(innerName, unpacked, `${displayPath} → ${innerName}`, depth + 1, diagnostics);
    } catch (error) {
      diagnostics.push(`แตก Unix compress (.Z) ไม่สำเร็จ ${displayPath}: ${error.message}`);
    }
  }
  if (hasGzipMagic(data) || isTgzName(name)) {
    try {
      const unpacked = await gunzip(data);
      if (hasTarMagic(unpacked)) return parseTarNode(name, unpacked, displayPath, depth, diagnostics, true);
      if (looksLikeXml(unpacked)) {
        const innerName = String(name || 'cad.gz').replace(/\.(?:tgz|tar\.gz|gz)$/i, '') || 'cad.xml';
        return parseFileNode(innerName, unpacked, `${displayPath} → ${innerName}`, depth + 1, diagnostics);
      }
    } catch (error) {
      diagnostics.push(`แตก GZIP ไม่สำเร็จ ${displayPath}: ${error.message}`);
    }
  }
  if (hasTarMagic(data) || isTarName(name)) return parseTarNode(name, data, displayPath, depth, diagnostics, false);

  const fileNode = { kind: 'file', name, bytes: data };
  if (data.length > MAX_SCAN_BYTES) return { root: fileNode, candidates: [] };
  let text = '';
  try { text = textFromBytes(data); } catch { text = ''; }
  const detection = detectCadFormat({ name, bytes: data, text });
  let score = scoreCadXml(text) + (isXmlName(name) ? 1 : 0);
  if (detection.format === 'inspection-xml' || detection.format === 'ipc-2581') {
    try {
      const adapted = adaptCadText(text, { fileName: displayPath, detection });
      diagnostics.push(...(adapted.warnings || []).map((warning) => `${displayPath}: ${warning}`));
      if (adapted.unsupportedRecords?.length) diagnostics.push(`${displayPath}: ไม่ได้นำเข้า ${adapted.unsupportedRecords.length} record (ดู Diagnostic Report)`);
      score = Math.max(score, detection.format === 'ipc-2581' ? 900 : 100);
      return { root: fileNode, candidates: [{ node: fileNode, text: adapted.xmlText, originalText: text, score, displayPath, format: adapted.sourceFormat, converted: adapted.sourceFormat !== 'inspection-xml', adapterInfo: adapted, detection }] };
    } catch (error) {
      diagnostics.push(`อ่าน ${displayPath} ไม่สำเร็จ: ${error.message}`);
      return { root: fileNode, candidates: [] };
    }
  }
  return { root: fileNode, candidates: score > 1 ? [{ node: fileNode, text, score, displayPath, format: 'inspection-xml', detection }] : [] };
}

async function parseZipNode(name, bytes, displayPath, depth, diagnostics) {
  const archive = new ZipArchive(bytes);
  const entries = archive.list();
  if (entries.length > MAX_ARCHIVE_FILES) throw new ArchiveError(`ZIP มีไฟล์ ${entries.length} รายการ เกินขีดจำกัด ${MAX_ARCHIVE_FILES}`, { stage: 'archive-preflight', fileName: displayPath, code: 'ARCHIVE_FILE_COUNT_LIMIT' });
  let expandedTotal = 0;
  for (const meta of entries) {
    const pathCheck = validateArchivePath(meta.name);
    if (!pathCheck.safe) throw new ArchiveError(`Path ไม่ปลอดภัยใน ZIP: ${meta.name} (${pathCheck.reason})`, { stage: 'archive-preflight', fileName: displayPath, code: 'ARCHIVE_PATH_TRAVERSAL' });
    expandedTotal += Number(meta.uncompressedSize || 0);
    const compressed = Math.max(1, Number(meta.compressedSize || 0));
    if (Number(meta.uncompressedSize || 0) / compressed > MAX_COMPRESSION_RATIO && Number(meta.uncompressedSize || 0) > 1024 * 1024) throw new ArchiveError(`ตรวจพบ Compression ratio ผิดปกติที่ ${meta.name}`, { stage: 'archive-preflight', fileName: displayPath, code: 'ARCHIVE_BOMB_RATIO' });
  }
  if (expandedTotal > MAX_EXPANDED_BYTES) throw new ArchiveError(`ขนาดแตก ZIP รวม ${expandedTotal} bytes เกินขีดจำกัด`, { stage: 'archive-preflight', fileName: displayPath, code: 'ARCHIVE_EXPANDED_SIZE_LIMIT' });
  const node = { kind: 'zip', name, archive, entries: [], sourceBytes: bytes };
  const candidates = [];

  for (const meta of entries) {
    const entry = { ...meta, path: meta.name, child: null };
    node.entries.push(entry);
    if (meta.isDirectory) continue;
    const likelyArchive = isArchiveName(meta.name);
    const likelyText = isXmlName(meta.name);
    const likelyOdb = isOdbRelevantName(meta.name);
    const limit = likelyArchive || likelyText || likelyOdb ? MAX_SCAN_BYTES : MAX_UNKNOWN_SCAN_BYTES;
    if (Number(meta.uncompressedSize || 0) > limit) continue;
    let entryBytes;
    try { entryBytes = await archive.read(meta.name, 'uint8array'); }
    catch (error) { diagnostics.push(`อ่าน ${joinPath(displayPath, meta.name)} ไม่สำเร็จ: ${error.message}`); continue; }
    const shouldInspect = likelyArchive || likelyText || likelyOdb || hasZipMagic(entryBytes) || hasGzipMagic(entryBytes) || hasTarMagic(entryBytes) || looksLikeXml(entryBytes);
    if (!shouldInspect) continue;
    const parsed = await parseFileNode(meta.name, entryBytes, joinPath(displayPath, meta.name), depth + 1, diagnostics);
    entry.child = parsed.root;
    candidates.push(...parsed.candidates);
  }
  return { root: node, candidates };
}

async function parseTarNode(name, tarBytes, displayPath, depth, diagnostics, gzipped) {
  const entries = parseTar(tarBytes);
  if (entries.length > MAX_ARCHIVE_FILES) throw new ArchiveError(`TAR มีไฟล์ ${entries.length} รายการ เกินขีดจำกัด ${MAX_ARCHIVE_FILES}`, { stage: 'archive-preflight', fileName: displayPath, code: 'ARCHIVE_FILE_COUNT_LIMIT' });
  let expandedTotal = 0;
  for (const entry of entries) {
    const pathCheck = validateArchivePath(entry.path || entry.name);
    if (!pathCheck.safe) throw new ArchiveError(`Path ไม่ปลอดภัยใน TAR: ${entry.path || entry.name} (${pathCheck.reason})`, { stage: 'archive-preflight', fileName: displayPath, code: 'ARCHIVE_PATH_TRAVERSAL' });
    expandedTotal += Number(entry.bytes?.length || entry.size || 0);
  }
  if (expandedTotal > MAX_EXPANDED_BYTES) throw new ArchiveError(`ขนาดแตก TAR รวม ${expandedTotal} bytes เกินขีดจำกัด`, { stage: 'archive-preflight', fileName: displayPath, code: 'ARCHIVE_EXPANDED_SIZE_LIMIT' });
  const node = { kind: gzipped ? 'tgz' : 'tar', name, entries: [], sourceBytes: tarBytes };
  const candidates = [];
  for (const original of entries) {
    const entry = { ...original, child: null };
    node.entries.push(entry);
    if (entry.isDirectory) continue;
    const entryName = entry.path || entry.name;
    const likelyArchive = isArchiveName(entryName);
    const likelyText = isXmlName(entryName);
    const likelyOdb = isOdbRelevantName(entryName);
    const limit = likelyArchive || likelyText || likelyOdb ? MAX_SCAN_BYTES : MAX_UNKNOWN_SCAN_BYTES;
    if (Number(entry.bytes?.length || 0) > limit) continue;
    const shouldInspect = likelyArchive || likelyText || likelyOdb || hasZipMagic(entry.bytes) || hasGzipMagic(entry.bytes) || hasTarMagic(entry.bytes) || looksLikeXml(entry.bytes);
    if (!shouldInspect) continue;
    const parsed = await parseFileNode(entryName, entry.bytes, joinPath(displayPath, entryName), depth + 1, diagnostics);
    entry.child = parsed.root;
    candidates.push(...parsed.candidates);
  }
  return { root: node, candidates };
}

export async function readCadPackageFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const diagnostics = [];
  const parsed = await parseFileNode(file.name || 'package', bytes, file.name || 'package', 0, diagnostics);
  const candidates = [...parsed.candidates];
  try {
    const odb = await convertOdbPackageToInspectionXml(parsed.root);
    if (odb) {
      candidates.push({
        node: null,
        text: odb.xmlText,
        score: 1000 + odb.components + Math.min(odb.lands, 1000) / 1000,
        displayPath: `ODB++ → XML (${odb.sourceFiles.join(', ')})`,
        format: 'odb++',
        converted: true,
        odbInfo: odb,
      });
      diagnostics.push(`ตรวจพบ ODB++ ${odb.components} Components / ${odb.lands} Lands`);
      diagnostics.push(...odb.warnings.slice(0, 5));
    }
  } catch (error) {
    diagnostics.push(`แปลง ODB++ ไม่สำเร็จ: ${error.message}`);
  }
  candidates.sort((a, b) => b.score - a.score || a.displayPath.localeCompare(b.displayPath));
  return { name: file.name || 'package', root: parsed.root, candidates, diagnostics };
}

async function buildNode(node, replacementNode, replacementBytes) {
  if (node.kind === 'file') return node === replacementNode ? replacementBytes : node.bytes;
  if (node.kind === 'zip') {
    const entries = [];
    for (const entry of node.entries) {
      let bytes = new Uint8Array();
      if (!entry.isDirectory) bytes = entry.child ? await buildNode(entry.child, replacementNode, replacementBytes) : await node.archive.read(entry.name, 'uint8array');
      entries.push({ name: entry.name, isDirectory: entry.isDirectory, bytes });
    }
    return createZip(entries);
  }
  if (node.kind === 'tar' || node.kind === 'tgz') {
    const entries = [];
    for (const entry of node.entries) {
      const bytes = entry.isDirectory ? new Uint8Array() : (entry.child ? await buildNode(entry.child, replacementNode, replacementBytes) : entry.bytes);
      entries.push({ ...entry, bytes, size: bytes.length });
    }
    const tar = createTar(entries);
    return node.kind === 'tgz' ? gzip(tar) : tar;
  }
  throw new Error(`Archive kind ${node.kind} ยังไม่รองรับ`);
}

export async function rebuildCadPackage(packageInfo, candidate, xmlText) {
  if (!packageInfo?.root || !candidate?.node) throw new Error('ข้อมูล archive ไม่ครบ');
  return buildNode(packageInfo.root, candidate.node, bytesFromText(xmlText));
}

export function packageOutputInfo(packageInfo, side = 'all') {
  const rootKind = packageInfo?.root?.kind || 'file';
  const original = String(packageInfo?.name || 'cad');
  const suffix = side === 'all' ? 'top_bottom' : side;
  if (rootKind === 'zip') return { extension: '.zip', mime: 'application/zip', filename: `${original.replace(/\.zip$/i, '')}_${suffix}.zip`, label: 'ZIP' };
  if (rootKind === 'tgz') return { extension: '.tgz', mime: 'application/gzip', filename: `${original.replace(/\.(?:tgz|tar\.gz|gz)$/i, '')}_${suffix}.tgz`, label: 'TGZ' };
  if (rootKind === 'tar') return { extension: '.tar', mime: 'application/x-tar', filename: `${original.replace(/\.tar$/i, '')}_${suffix}.tar`, label: 'TAR' };
  return { extension: '.xml', mime: 'application/xml', filename: `${original.replace(/\.[^.]+$/i, '')}_${suffix}.xml`, label: 'XML' };
}
