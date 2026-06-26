import { textFromBytes } from './archive-reader.js';
import { isUnixCompress, unlzw } from './unix-compress.js';

function normalizePath(value = '') {
  return String(value).replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

function isRelevantOdbPath(path) {
  const value = normalizePath(path).toLowerCase();
  return /(?:^|\/)steps\/[^/]+\/layers\/comp_\+_(?:top|bot)\/components(?:[23])?(?:\.z)?$/.test(value)
    || /(?:^|\/)steps\/[^/]+\/eda\/data(?:\.z)?$/.test(value)
    || /(?:^|\/)matrix\/matrix(?:\.z)?$/.test(value)
    || /(?:^|\/)steps\/[^/]+\/profile(?:\.z)?$/.test(value);
}

function entryBytes(entry) {
  if (entry?.bytes instanceof Uint8Array) return entry.bytes;
  if (entry?.child?.kind === 'file' && entry.child.bytes instanceof Uint8Array) return entry.child.bytes;
  return null;
}

/** Collect only ODB++ files required for component conversion. Unix .Z streams are
 * decompressed here so archive extraction and ODB parsing remain separate. */
export async function collectOdbFiles(root) {
  const files = [];
  const seen = new Set();

  const addFile = async (path, bytes) => {
    const normalized = normalizePath(path);
    if (!normalized || !bytes || !isRelevantOdbPath(normalized)) return;
    const key = `${normalized.toLowerCase()}\u0000${bytes.length}`;
    if (seen.has(key)) return;
    seen.add(key);

    let decoded = bytes;
    let unixCompressed = false;
    if (isUnixCompress(bytes)) {
      decoded = unlzw(bytes);
      unixCompressed = true;
      // Give the browser a chance to repaint progress text between large files.
      await Promise.resolve();
    }
    files.push({
      path: normalized,
      name: normalized.split('/').pop() || normalized,
      bytes: decoded,
      originalBytes: bytes,
      unixCompressed,
    });
  };

  const walk = async (node, parent = '') => {
    if (!node) return;
    if (node.kind === 'file') {
      const path = normalizePath(parent || node.name || 'file');
      await addFile(path, node.bytes);
      return;
    }
    for (const entry of node.entries || []) {
      if (entry.isDirectory) continue;
      const rawPath = normalizePath(entry.path || entry.name || 'file');
      const path = parent && !rawPath.includes('/') ? normalizePath(`${parent}/${rawPath}`) : rawPath;
      const bytes = entryBytes(entry);
      if (bytes) await addFile(path, bytes);
      if (entry.child && entry.child.kind !== 'file') await walk(entry.child, path);
    }
  };

  await walk(root, '');
  return files;
}

function splitRecord(line) {
  const out = [];
  let token = '';
  let quote = '';
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quote) {
      if (char === quote) quote = '';
      else token += char;
    } else if (char === '"' || char === "'") quote = char;
    else if (/\s/.test(char)) {
      if (token) { out.push(token); token = ''; }
    } else token += char;
  }
  if (token) out.push(token);
  return out;
}

function forEachLine(text, start, callback) {
  let cursor = Math.max(0, start || 0);
  const source = String(text || '');
  while (cursor <= source.length) {
    let end = source.indexOf('\n', cursor);
    if (end < 0) end = source.length;
    let line = source.slice(cursor, end);
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (callback(line) === false) break;
    if (end >= source.length) break;
    cursor = end + 1;
  }
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseOutlineSize(tokens) {
  const type = String(tokens[0] || '').toUpperCase();
  if (type === 'RC' && tokens.length >= 5) {
    return { width: Math.abs(Number(tokens[3])) || null, length: Math.abs(Number(tokens[4])) || null };
  }
  if (type === 'CR' && tokens.length >= 4) {
    const diameter = Math.abs(Number(tokens[3]) * 2);
    return { width: diameter || null, length: diameter || null };
  }
  if (type === 'SQ' && tokens.length >= 4) {
    const side = Math.abs(Number(tokens[3]) * 2);
    return { width: side || null, length: side || null };
  }
  return null;
}

function parseEdaData(text) {
  const source = String(text || '');
  const packageHeader = source.search(/^#\s*PKG\s+\d+\s*$/m);
  const packageRecord = source.search(/^PKG\s+/m);
  const start = packageHeader >= 0 ? packageHeader : Math.max(0, packageRecord);
  const packages = [];
  let pendingIndex = null;
  let currentPackage = null;
  let currentPin = null;

  forEachLine(source, start, (raw) => {
    const line = raw.trim();
    if (!line) return;
    if (line.startsWith('#')) {
      const match = line.match(/^#\s*PKG\s+(\d+)/i);
      if (match) pendingIndex = Number(match[1]);
      return;
    }
    if (line.startsWith('@') || line.startsWith('&')) return;
    const body = line.split(';', 1)[0].trim();
    const tokens = splitRecord(body);
    const record = String(tokens[0] || '').toUpperCase();
    if (record === 'PKG') {
      const index = Number.isInteger(pendingIndex) ? pendingIndex : packages.length;
      currentPackage = { index, name: tokens[1] || `PKG_${index}`, pins: [] };
      packages[index] = currentPackage;
      currentPin = null;
      pendingIndex = null;
    } else if (record === 'PIN' && currentPackage) {
      currentPin = {
        name: tokens[1] || String(currentPackage.pins.length + 1),
        x: numberOrNull(tokens[3]),
        y: numberOrNull(tokens[4]),
        width: null,
        length: null,
      };
      currentPackage.pins.push(currentPin);
    } else if (currentPin && ['RC', 'CR', 'SQ'].includes(record)) {
      const size = parseOutlineSize(tokens);
      if (size && !(currentPin.width > 0 && currentPin.length > 0)) {
        currentPin.width = size.width;
        currentPin.length = size.length;
      }
    }
  });
  return packages;
}

function parseProfile(text) {
  const profile = { units: 'INCH', minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  const add = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    profile.minX = Math.min(profile.minX, x);
    profile.maxX = Math.max(profile.maxX, x);
    profile.minY = Math.min(profile.minY, y);
    profile.maxY = Math.max(profile.maxY, y);
  };
  forEachLine(text, 0, (raw) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const tokens = splitRecord(line);
    const record = String(tokens[0] || '').toUpperCase();
    if (record === 'U' && tokens[1]) profile.units = String(tokens[1]).toUpperCase();
    else if (record === 'UNITS' && tokens[1]) profile.units = String(tokens[tokens.length - 1]).toUpperCase();
    else if (record === 'OB' || record === 'OS') add(numberOrNull(tokens[1]), numberOrNull(tokens[2]));
    else if (record === 'OC') {
      add(numberOrNull(tokens[1]), numberOrNull(tokens[2]));
      add(numberOrNull(tokens[3]), numberOrNull(tokens[4]));
    }
  });
  if (!Number.isFinite(profile.minX)) return { units: profile.units, bounds: null };
  return { units: profile.units, bounds: profile };
}

function parseComponentFile(text, side, packages, sourcePath, defaultUnits = 'INCH') {
  const components = [];
  let current = null;
  let units = defaultUnits || 'INCH';
  forEachLine(text, 0, (raw) => {
    const line = raw.trim();
    if (!line) return;
    if (/^UNITS\s*=/.test(line.toUpperCase())) {
      units = line.split('=', 2)[1]?.trim().toUpperCase() || units;
      return;
    }
    if (/^U\s+(INCH|MM)\b/i.test(line)) {
      units = splitRecord(line)[1]?.toUpperCase() || units;
      return;
    }
    if (line.startsWith('#') || line.startsWith('@') || line.startsWith('&')) return;
    const body = line.split(';', 1)[0].trim();
    const tokens = splitRecord(body);
    const record = String(tokens[0] || '').toUpperCase();
    if (record === 'CMP' && tokens.length >= 7) {
      const pkgRef = Number(tokens[1]);
      const pkg = Number.isInteger(pkgRef) ? packages[pkgRef] : null;
      current = {
        pkgRef,
        x: numberOrNull(tokens[2]) ?? 0,
        y: numberOrNull(tokens[3]) ?? 0,
        rotation: numberOrNull(tokens[4]) ?? 0,
        mirror: tokens[5] || 'N',
        name: tokens[6] || `COMP_${components.length + 1}`,
        partName: tokens[7] && tokens[7] !== '???' ? tokens[7] : '',
        packageName: pkg?.name || '',
        properties: {},
        side,
        units,
        sourcePath,
        lands: [],
      };
      components.push(current);
    } else if (record === 'PRP' && current && tokens.length >= 3) {
      const key = String(tokens[1] || '').toUpperCase();
      const value = tokens.slice(2).join(' ').trim();
      current.properties[key] = value;
      if (key === 'PART_NAME' && value) current.partName = value;
    } else if (record === 'TOP' && current && tokens.length >= 4) {
      const pinNum = Number(tokens[1]);
      const packagePin = Number.isInteger(pinNum) ? packages[current.pkgRef]?.pins?.[pinNum] : null;
      current.lands.push({
        pinNum,
        x: numberOrNull(tokens[2]) ?? current.x,
        y: numberOrNull(tokens[3]) ?? current.y,
        rotation: numberOrNull(tokens[4]) ?? 0,
        mirror: tokens[5] || 'N',
        name: packagePin?.name || tokens[8] || `A${current.lands.length + 1}`,
        width: packagePin?.width ?? null,
        length: packagePin?.length ?? null,
      });
    }
  });
  return components;
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function estimatePadSize(component) {
  const defaults = component.units === 'MM' ? 0.5 : 0.02;
  // Full pairwise distance is too expensive for large BGAs. Adjacent pins in
  // source order are enough to obtain a safe visual fallback.
  const distances = [];
  const lands = component.lands || [];
  const limit = Math.min(lands.length - 1, 256);
  for (let i = 0; i < limit; i += 1) {
    const dx = lands[i].x - lands[i + 1].x;
    const dy = lands[i].y - lands[i + 1].y;
    const distance = Math.hypot(dx, dy);
    if (distance > 0) distances.push(distance);
  }
  const pitch = median(distances);
  return pitch ? Math.max(defaults * 0.35, pitch * 0.36) : defaults;
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function stepPrefix(path) {
  return normalizePath(path).toLowerCase().match(/(?:^|\/)(steps\/[^/]+)\//)?.[1] || '';
}

function withoutZ(path) { return normalizePath(path).toLowerCase().replace(/\.z$/i, ''); }

function chooseEdaFile(files, componentPath) {
  const step = stepPrefix(componentPath);
  return files.find((file) => withoutZ(file.path).endsWith(`${step}/eda/data`))
    || files.find((file) => /(?:^|\/)steps\/[^/]+\/eda\/data$/i.test(withoutZ(file.path)));
}

function chooseProfileFile(files, componentPath) {
  const step = stepPrefix(componentPath);
  return files.find((file) => withoutZ(file.path).endsWith(`${step}/profile`))
    || files.find((file) => /(?:^|\/)steps\/[^/]+\/profile$/i.test(withoutZ(file.path)));
}

function unitFactor(units) { return String(units || '').toUpperCase().startsWith('MM') ? 1 : 25.4; }
function fmt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  const fixed = Math.abs(n) < 1e-10 ? 0 : Number(n.toFixed(6));
  return String(fixed);
}

export async function convertOdbPackageToInspectionXml(root) {
  const files = await collectOdbFiles(root);
  const componentFiles = files.filter((file) => /(?:^|\/)steps\/[^/]+\/layers\/comp_\+_(top|bot)\/components(?:[23])?$/i.test(withoutZ(file.path)));
  if (!componentFiles.length) return null;

  const selectedByLayer = new Map();
  for (const file of componentFiles) {
    const path = withoutZ(file.path);
    const key = path.replace(/components(?:[23])?$/i, '').toLowerCase();
    const rank = /\/components$/i.test(path) ? 0 : /components2$/i.test(path) ? 1 : 2;
    const current = selectedByLayer.get(key);
    if (!current || rank < current.rank) selectedByLayer.set(key, { file, rank });
  }

  const allComponents = [];
  const warnings = [];
  const edaCache = new Map();
  const profileCache = new Map();
  let decompressedCount = files.filter((file) => file.unixCompressed).length;

  for (const { file } of selectedByLayer.values()) {
    const path = normalizePath(file.path);
    const sideMatch = withoutZ(path).match(/comp_\+_(top|bot)\/components/i);
    const side = sideMatch?.[1]?.toLowerCase() === 'bot' ? 'Bottom' : 'Top';
    const edaFile = chooseEdaFile(files, path);
    const profileFile = chooseProfileFile(files, path);

    let profile = { units: 'INCH', bounds: null };
    if (profileFile) {
      if (!profileCache.has(profileFile.path)) profileCache.set(profileFile.path, parseProfile(textFromBytes(profileFile.bytes)));
      profile = profileCache.get(profileFile.path);
    }

    let packages = [];
    if (edaFile) {
      try {
        if (!edaCache.has(edaFile.path)) edaCache.set(edaFile.path, parseEdaData(textFromBytes(edaFile.bytes)));
        packages = edaCache.get(edaFile.path);
      } catch (error) { warnings.push(`อ่าน EDA package ไม่สำเร็จ: ${error.message}`); }
    } else warnings.push(`ไม่พบ eda/data สำหรับ ${path}`);

    try {
      allComponents.push(...parseComponentFile(textFromBytes(file.bytes), side, packages, path, profile.units));
    } catch (error) { warnings.push(`อ่าน ${path} ไม่สำเร็จ: ${error.message}`); }
  }

  if (!allComponents.length) return null;

  let nextComponentId = 1;
  let nextLandId = 1;
  const componentXml = [];
  const landXml = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let totalLands = 0;

  for (const component of allComponents) {
    const componentId = String(nextComponentId++);
    const factor = unitFactor(component.units);
    const padFallback = estimatePadSize(component);
    const centerX = component.x * factor;
    const centerY = component.y * factor;
    componentXml.push(
      `  <ComponentInformation Id="${componentId}" Name="${escapeXml(component.name)}" Side="${component.side}" PartName="${escapeXml(component.partName || '')}">\n`
      + `    <ComponentInformationItem ComponentNumberId="${escapeXml(component.packageName || component.partName || 'UNKNOWN')}" ComponentNumberRevision="" />\n`
      + `    <PositionAngle CenterPosX="${fmt(centerX)}" CenterPosY="${fmt(centerY)}" Angle="${fmt(component.rotation)}" />\n`
      + '  </ComponentInformation>',
    );

    component.lands.forEach((land, index) => {
      const widthSource = Number.isFinite(land.width) && land.width > 0 ? land.width : padFallback;
      const lengthSource = Number.isFinite(land.length) && land.length > 0 ? land.length : padFallback;
      const width = widthSource * factor;
      const length = lengthSource * factor;
      const x = land.x * factor;
      const y = land.y * factor;
      const left = x - width / 2;
      const top = y + length / 2;
      const name = String(land.name || `A${index + 1}`);
      minX = Math.min(minX, left);
      maxX = Math.max(maxX, left + width);
      minY = Math.min(minY, top - length);
      maxY = Math.max(maxY, top);
      landXml.push(
        `  <LandNumber LandId="${nextLandId++}" Component="${componentId}" Name="${escapeXml(name)}" Side="${component.side}">`
        + `<Land Left="${fmt(left)}" Top="${fmt(top)}" Width="${fmt(width)}" Length="${fmt(length)}" />`
        + '</LandNumber>',
      );
      totalLands += 1;
    });
  }

  // Prefer the actual board profile for board metadata, while rendering still
  // uses component/land bounds so sparse or shifted jobs remain visible.
  const profileFile = chooseProfileFile(files, selectedByLayer.values().next().value?.file?.path || '');
  if (profileFile) {
    const profile = profileCache.get(profileFile.path) || parseProfile(textFromBytes(profileFile.bytes));
    if (profile.bounds) {
      const factor = unitFactor(profile.units);
      minX = profile.bounds.minX * factor;
      maxX = profile.bounds.maxX * factor;
      minY = profile.bounds.minY * factor;
      maxY = profile.bounds.maxY * factor;
    }
  }
  if (!Number.isFinite(minX)) minX = maxX = minY = maxY = 0;

  const width = Math.max(0, maxX - minX);
  const height = Math.max(0, maxY - minY);
  const xmlText = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<InspectionData SourceFormat="ODB++" SourceUnits="INCH">',
    `  <BoardInformation Width="${fmt(width)}" Height="${fmt(height)}" Thickness="0" Units="MM" MinX="${fmt(minX)}" MinY="${fmt(minY)}" />`,
    ...componentXml,
    ...landXml,
    '</InspectionData>',
  ].join('\n');

  if (decompressedCount) warnings.unshift(`คลาย Unix .Z สำเร็จ ${decompressedCount} ไฟล์`);
  const packageCount = [...edaCache.values()].reduce((sum, packages) => sum + packages.filter(Boolean).length, 0);
  warnings.push(`อ่าน EDA ${packageCount} packages และแปลงพิกัดเป็นมิลลิเมตร`);

  return {
    xmlText,
    format: 'odb++',
    components: allComponents.length,
    lands: totalLands,
    sourceFiles: [
      ...[...selectedByLayer.values()].map((entry) => normalizePath(entry.file.path)),
      ...[...edaCache.keys()],
      ...[...profileCache.keys()],
    ],
    warnings,
    units: 'MM',
    unixCompressedFiles: decompressedCount,
    packages: packageCount,
  };
}
