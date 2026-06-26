import { ZipArchive } from './zip-reader.js';
import { assertSafeXml } from './import-adapters.js';

function decodeXml(value = '') {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function attrs(text = '') {
  const result = {};
  const re = /([:\w.-]+)\s*=\s*(["'])([\s\S]*?)\2/g;
  let match;
  while ((match = re.exec(text))) result[match[1]] = decodeXml(match[3]);
  return result;
}

function numberOrNull(value) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function colFromRef(ref = '') {
  const letters = (ref.match(/[A-Z]+/i) || [''])[0].toUpperCase();
  let value = 0;
  for (const char of letters) value = value * 26 + char.charCodeAt(0) - 64;
  return Math.max(0, value - 1);
}

export function columnName(index) {
  let n = index + 1;
  let result = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

function normalizePath(path) {
  const parts = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  const strings = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let si;
  while ((si = siRe.exec(xml))) {
    let text = '';
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let t;
    while ((t = tRe.exec(si[1]))) text += decodeXml(t[1]);
    strings.push(text);
  }
  return strings;
}

function parseSheetXml(xml, sharedStrings) {
  const rows = [];
  let maxCol = 0;
  const sheetStart = xml.indexOf('<sheetData');
  const dataStart = sheetStart >= 0 ? xml.indexOf('>', sheetStart) + 1 : 0;
  const dataEnd = sheetStart >= 0 ? xml.indexOf('</sheetData>', dataStart) : xml.length;
  let cursor = dataStart;

  while (cursor >= 0 && cursor < dataEnd) {
    const rowStart = xml.indexOf('<row', cursor);
    if (rowStart < 0 || rowStart >= dataEnd) break;
    const rowOpenEnd = xml.indexOf('>', rowStart);
    const rowEnd = xml.indexOf('</row>', rowOpenEnd);
    if (rowOpenEnd < 0 || rowEnd < 0) break;
    const row = [];
    let cellCursor = rowOpenEnd + 1;

    while (cellCursor < rowEnd) {
      const cellStart = xml.indexOf('<c', cellCursor);
      if (cellStart < 0 || cellStart >= rowEnd) break;
      const afterC = xml.charCodeAt(cellStart + 2);
      if (afterC !== 32 && afterC !== 9 && afterC !== 13 && afterC !== 10 && afterC !== 62) {
        cellCursor = cellStart + 2;
        continue;
      }
      const cellOpenEnd = xml.indexOf('>', cellStart);
      const cellEnd = xml.indexOf('</c>', cellOpenEnd);
      if (cellOpenEnd < 0 || cellEnd < 0 || cellEnd > rowEnd) break;
      const openTag = xml.slice(cellStart + 2, cellOpenEnd);
      const refMatch = openTag.match(/\br=["']([^"']+)["']/);
      const typeMatch = openTag.match(/\bt=["']([^"']+)["']/);
      const index = colFromRef(refMatch?.[1] || 'A1');
      maxCol = Math.max(maxCol, index);
      const type = typeMatch?.[1] || '';
      const valueStart = xml.indexOf('<v>', cellOpenEnd);
      let raw = null;
      if (valueStart >= 0 && valueStart < cellEnd) {
        const valueEnd = xml.indexOf('</v>', valueStart + 3);
        if (valueEnd >= 0 && valueEnd <= cellEnd) raw = xml.slice(valueStart + 3, valueEnd);
      }
      let value = null;
      if (type === 's' && raw != null) value = sharedStrings[Number(raw)] ?? '';
      else if (type === 'inlineStr') {
        const tStart = xml.indexOf('<t', cellOpenEnd);
        if (tStart >= 0 && tStart < cellEnd) {
          const tOpenEnd = xml.indexOf('>', tStart);
          const tEnd = xml.indexOf('</t>', tOpenEnd);
          if (tEnd >= 0 && tEnd <= cellEnd) value = decodeXml(xml.slice(tOpenEnd + 1, tEnd));
        }
      } else if ((type === 'str' || type === 'e') && raw != null) value = decodeXml(raw);
      else if (type === 'b' && raw != null) value = raw === '1';
      else if (raw != null) {
        const decoded = decodeXml(raw);
        const n = Number(decoded);
        value = decoded !== '' && Number.isFinite(n) ? n : decoded;
      }
      row[index] = value;
      cellCursor = cellEnd + 4;
    }
    rows.push(row);
    cursor = rowEnd + 6;
  }

  for (const row of rows) row.length = maxCol + 1;
  return rows;
}

export async function parseXlsx(arrayBuffer) {
  const zip = new ZipArchive(arrayBuffer);
  const workbookXml = await zip.read('xl/workbook.xml', 'text');
  const relsXml = await zip.read('xl/_rels/workbook.xml.rels', 'text');
  const sharedEntry = zip.find((entry) => /(^|\/)sharedStrings\.xml$/i.test(entry.name));
  const sharedStrings = sharedEntry ? parseSharedStrings(await zip.read(sharedEntry.name, 'text')) : [];

  const relationTargets = new Map();
  const relRe = /<Relationship\b([^>]*)\/?\s*>/g;
  let rel;
  while ((rel = relRe.exec(relsXml))) {
    const a = attrs(rel[1]);
    if (a.Id && a.Target) relationTargets.set(a.Id, a.Target);
  }

  const sheets = [];
  const sheetRe = /<sheet\b([^>]*)\/?\s*>/g;
  let sheet;
  while ((sheet = sheetRe.exec(workbookXml))) {
    const a = attrs(sheet[1]);
    const relId = a['r:id'];
    const target = relationTargets.get(relId) || `worksheets/sheet${sheets.length + 1}.xml`;
    const path = normalizePath(target.startsWith('/') ? target.slice(1) : `xl/${target}`);
    const xml = await zip.read(path, 'text');
    sheets.push({ name: a.name || `Sheet${sheets.length + 1}`, rows: parseSheetXml(xml, sharedStrings) });
  }

  if (!sheets.length) {
    const fallback = zip.find((entry) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(entry.name));
    if (!fallback) throw new Error('ไม่พบ Worksheet ในไฟล์ XLSX');
    sheets.push({ name: 'Sheet1', rows: parseSheetXml(await zip.read(fallback.name, 'text'), sharedStrings) });
  }

  return { sheets, activeSheet: sheets[0] };
}

export function parseInspectionXml(xmlText) {
  xmlText = assertSafeXml(xmlText, { fileName: 'CAD XML' });
  const boardTag = xmlText.match(/<(?:[A-Za-z_][\w.-]*:)?BoardInformation\b([^>]*)\/?\s*>/i);
  const board = boardTag ? attrs(boardTag[1]) : {};
  board.Width = numberOrNull(board.Width);
  board.Height = numberOrNull(board.Height);
  board.Thickness = numberOrNull(board.Thickness);

  const components = [];
  const componentById = new Map();
  const componentRe = /<(?:[A-Za-z_][\w.-]*:)?ComponentInformation\b([^>]*)>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?ComponentInformation>/gi;
  let componentMatch;
  while ((componentMatch = componentRe.exec(xmlText))) {
    const a = attrs(componentMatch[1]);
    const body = componentMatch[2];
    const itemTag = body.match(/<(?:[A-Za-z_][\w.-]*:)?ComponentInformationItem\b([^>]*)>/i);
    const posTag = body.match(/<(?:[A-Za-z_][\w.-]*:)?PositionAngle\b([^>]*)\/?\s*>/i);
    const item = itemTag ? attrs(itemTag[1]) : {};
    const pos = posTag ? attrs(posTag[1]) : {};
    const component = {
      id: String(a.Id ?? ''),
      name: a.Name || '',
      packageName: item.ComponentNumberId || '',
      revision: item.ComponentNumberRevision || '',
      centerX: numberOrNull(pos.CenterPosX),
      centerY: numberOrNull(pos.CenterPosY),
      angle: numberOrNull(pos.Angle),
      lands: [],
    };
    components.push(component);
    componentById.set(component.id, component);
  }

  const landRe = /<(?:[A-Za-z_][\w.-]*:)?LandNumber\b([^>]*)>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?LandNumber>/gi;
  let landMatch;
  let totalLands = 0;
  while ((landMatch = landRe.exec(xmlText))) {
    const a = attrs(landMatch[1]);
    const landTag = landMatch[2].match(/<(?:[A-Za-z_][\w.-]*:)?Land\b([^>]*)>/i);
    if (!landTag) continue;
    const g = attrs(landTag[1]);
    const left = numberOrNull(g.Left);
    const top = numberOrNull(g.Top);
    const width = numberOrNull(g.Width);
    const length = numberOrNull(g.Length);
    const land = {
      globalId: numberOrNull(a.LandId),
      componentId: String(a.Component ?? ''),
      cadName: a.Name || '',
      side: a.Side || '',
      left,
      top,
      width,
      length,
      centerX: left != null && width != null ? left + width / 2 : left,
      centerY: top != null && length != null ? top - length / 2 : top,
      localIndex: null,
    };
    let component = componentById.get(land.componentId);
    if (!component && land.componentId) {
      component = {
        id: land.componentId,
        name: `Component ${land.componentId}`,
        packageName: '',
        revision: '',
        centerX: null,
        centerY: null,
        angle: null,
        lands: [],
        inferred: true,
      };
      components.push(component);
      componentById.set(component.id, component);
    }
    if (component) component.lands.push(land);
    totalLands += 1;
  }

  for (const component of components) {
    component.lands.sort((a, b) => (a.globalId ?? 0) - (b.globalId ?? 0));
    component.lands.forEach((land, index) => { land.localIndex = index + 1; });
    if (component.lands.length) {
      const xs = component.lands.map((land) => land.centerX).filter(Number.isFinite);
      const ys = component.lands.map((land) => land.centerY).filter(Number.isFinite);
      component.bounds = {
        minX: Math.min(...xs), maxX: Math.max(...xs),
        minY: Math.min(...ys), maxY: Math.max(...ys),
      };
      const minId = component.lands[0].globalId;
      const contiguous = component.lands.every((land, index) => land.globalId === minId + index);
      component.contiguousGlobalIds = contiguous;
      component.offset = contiguous ? minId - 1 : null;
    }
  }

  return {
    board,
    components,
    componentById,
    totalLands,
    sourceSize: xmlText.length,
  };
}

function valuesAt(rows, col, limit = 4000) {
  const result = [];
  for (let i = 1; i < rows.length && result.length < limit; i += 1) {
    const value = rows[i]?.[col];
    if (value !== null && value !== undefined && value !== '') result.push(value);
  }
  return result;
}

function majorityValue(values) {
  const counts = new Map();
  for (const value of values) counts.set(String(value), (counts.get(String(value)) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0] || ['', 0];
}

export function autoDetectSchema(rows, xmlData, options = {}) {
  const maxCols = Math.max(0, ...rows.map((row) => row.length));
  const normalizeMatch = (value) => String(value ?? '').trim().toLocaleUpperCase();
  const allCadData = [xmlData, options.alternateCadData].filter(Boolean);
  const components = allCadData.flatMap((data) => data.components || []);
  const componentNames = new Set(components.map((component) => normalizeMatch(component.name)).filter(Boolean));
  const packageNames = new Set(components.map((component) => normalizeMatch(component.packageName)).filter(Boolean));
  const cadNames = new Set();
  const globalIds = new Set();
  let maximumLocalIndex = 0;
  for (const component of components) {
    maximumLocalIndex = Math.max(maximumLocalIndex, component.lands?.length || 0);
    for (const land of component.lands || []) {
      const name = normalizeMatch(land.cadName);
      if (name) cadNames.add(name);
      if (land.globalId != null) globalIds.add(String(land.globalId));
    }
  }
  const descriptors = [];

  for (let col = 0; col < maxCols; col += 1) {
    const values = valuesAt(rows, col);
    const [majority, majorityCount] = majorityValue(values);
    const numeric = values.filter((value) => Number.isFinite(Number(value)));
    const integers = numeric.filter((value) => Number.isInteger(Number(value)) && Number(value) > 0);
    const unique = new Set(values.map((value) => String(value).trim()));
    const componentHits = values.filter((value) => componentNames.has(normalizeMatch(value))).length;
    const packageHits = values.filter((value) => packageNames.has(normalizeMatch(value))).length;
    const cadNameHits = values.filter((value) => cadNames.has(normalizeMatch(value))).length;
    const globalIdHits = values.filter((value) => globalIds.has(String(value).trim())).length;
    const localIndexHits = values.filter((value) => {
      const n = Number(value);
      return Number.isInteger(n) && n > 0 && n <= maximumLocalIndex;
    }).length;
    let sequentialHits = 0;
    for (let i = 0; i < Math.min(values.length, 1500); i += 1) {
      if (Number(values[i]) === i + 1) sequentialHits += 1;
    }
    const headerText = normalizeMatch(rows[0]?.[col]);
    const headerIdentifierBonus = /LAND|PAD|BALL|PIN|POINT|LOCATION|NAME|ID|NUMBER/.test(headerText) ? 1 : 0;
    descriptors.push({
      col,
      header: rows[0]?.[col] ?? '',
      sample: values[0] ?? '',
      values,
      majority,
      majorityRatio: values.length ? majorityCount / values.length : 0,
      numericRatio: values.length ? numeric.length / values.length : 0,
      integerRatio: values.length ? integers.length / values.length : 0,
      uniqueCount: unique.size,
      componentHits,
      packageHits,
      cadNameHits,
      cadNameRatio: values.length ? cadNameHits / values.length : 0,
      globalIdHits,
      globalIdRatio: values.length ? globalIdHits / values.length : 0,
      localIndexHits,
      localIndexRatio: values.length ? localIndexHits / values.length : 0,
      sequentialRatio: values.length ? sequentialHits / Math.min(values.length, 1500) : 0,
      headerIdentifierBonus,
    });
  }

  const best = (key) => [...descriptors].sort((a, b) => b[key] - a[key])[0]?.col ?? 0;
  const componentCol = best('componentHits');
  const packageCol = best('packageHits');
  const featureCol = descriptors.find((d) => String(d.majority).toLowerCase() === 'land' && d.majorityRatio > 0.7)?.col ?? null;

  // Re-score identifiers within the component named on each raw-data row. Global
  // board-wide sets cause false positives for constants such as 14 or 67 because
  // another component may legitimately contain those CAD names or XML IDs.
  const componentsByNameForDetection = new Map();
  for (const component of components) {
    const key = normalizeMatch(component.name);
    if (!componentsByNameForDetection.has(key)) componentsByNameForDetection.set(key, []);
    componentsByNameForDetection.get(key).push(component);
  }
  const contextCache = new Map();
  const contextForRow = (row) => {
    const componentName = normalizeMatch(row?.[componentCol]);
    const packageName = normalizeMatch(row?.[packageCol]);
    const cacheKey = `${componentName}\u0000${packageName}`;
    if (contextCache.has(cacheKey)) return contextCache.get(cacheKey);
    let candidates = componentsByNameForDetection.get(componentName) || [];
    if (packageName) {
      const exact = candidates.filter((component) => normalizeMatch(component.packageName) === packageName);
      if (exact.length) candidates = exact;
    }
    const names = new Set();
    const ids = new Set();
    let maxLocal = 0;
    for (const component of candidates) {
      maxLocal = Math.max(maxLocal, component.lands?.length || 0);
      for (const land of component.lands || []) {
        const name = normalizeMatch(land.cadName);
        if (name) names.add(name);
        if (land.globalId != null) ids.add(String(land.globalId));
      }
    }
    const context = { names, ids, maxLocal };
    contextCache.set(cacheKey, context);
    return context;
  };
  const sampledRows = rows.slice(1, 4001);
  for (const descriptor of descriptors) {
    let cadNameHits = 0;
    let globalIdHits = 0;
    let localIndexHits = 0;
    let valueCount = 0;
    for (const row of sampledRows) {
      const value = row?.[descriptor.col];
      if (value === null || value === undefined || value === '') continue;
      valueCount += 1;
      const context = contextForRow(row);
      if (context.names.has(normalizeMatch(value))) cadNameHits += 1;
      if (context.ids.has(String(value).trim())) globalIdHits += 1;
      const n = Number(value);
      if (Number.isInteger(n) && n > 0 && n <= context.maxLocal) localIndexHits += 1;
    }
    descriptor.cadNameHits = cadNameHits;
    descriptor.cadNameRatio = valueCount ? cadNameHits / valueCount : 0;
    descriptor.globalIdHits = globalIdHits;
    descriptor.globalIdRatio = valueCount ? globalIdHits / valueCount : 0;
    descriptor.localIndexHits = localIndexHits;
    descriptor.localIndexRatio = valueCount ? localIndexHits / valueCount : 0;
  }

  const landCandidates = descriptors
    .filter((d) => d.col !== componentCol && d.col !== packageCol && d.col !== featureCol && (d.uniqueCount > 10 || d.cadNameRatio >= 0.5 || d.sequentialRatio >= 0.8 || (d.globalIdRatio >= 0.8 && d.uniqueCount / Math.max(1, d.values.length) >= 0.8)))
    .map((d) => ({
      ...d,
      score:
        d.cadNameRatio * 24 +
        d.globalIdRatio * 12 +
        d.sequentialRatio * 6 +
        d.localIndexRatio * 2 +
        d.headerIdentifierBonus * 0.8 +
        (featureCol != null ? Math.max(0, 1.8 - Math.abs(d.col - featureCol) * 0.45) : 0) +
        Math.min(1.5, d.uniqueCount / Math.max(100, rows.length * 0.2)),
    }))
    .filter((d) => d.score > 0.5)
    .sort((a, b) => b.score - a.score || b.cadNameHits - a.cadNameHits || b.globalIdHits - a.globalIdHits || a.col - b.col);
  const landCol = landCandidates[0]?.col ?? 0;

  let measurementCol = null;
  const pixelDescriptor = descriptors.find((d) => String(d.majority).toLowerCase() === 'pixel' && d.majorityRatio > 0.7);
  if (pixelDescriptor && pixelDescriptor.col + 1 < maxCols) measurementCol = pixelDescriptor.col + 1;
  if (measurementCol == null) {
    measurementCol = descriptors
      .filter((d) => d.col !== landCol && d.col !== componentCol && d.col !== packageCol && d.numericRatio > 0.9 && d.uniqueCount > 10 && d.uniqueCount < Math.max(20, rows.length * 0.75))
      .sort((a, b) => b.uniqueCount - a.uniqueCount)[0]?.col ?? null;
  }

  const selectedLandDescriptor = landCandidates[0] || descriptors.find((d) => d.col === landCol) || null;
  let landMode = 'auto';
  if (selectedLandDescriptor) {
    if (selectedLandDescriptor.cadNameRatio >= 0.2 || selectedLandDescriptor.cadNameHits > selectedLandDescriptor.globalIdHits) landMode = 'cad-name';
    else if (selectedLandDescriptor.sequentialRatio >= 0.8) landMode = 'local-index';
    else if (selectedLandDescriptor.globalIdRatio >= 0.5) landMode = 'global-id';
  }

  return {
    componentCol,
    packageCol,
    featureCol,
    landCol,
    landMode,
    measurementCol,
    descriptors,
    alternates: { land: landCandidates.slice(1, 6).map((d) => d.col) },
    landDetection: landCandidates.slice(0, 6).map((d) => ({
      col: d.col,
      score: d.score,
      cadNameHits: d.cadNameHits,
      globalIdHits: d.globalIdHits,
      sequentialRatio: d.sequentialRatio,
    })),
  };
}

function confidenceFor({ exactComponent, exactPackage, countMatch, contiguous }) {
  let score = 0;
  if (exactComponent) score += 55;
  if (exactPackage) score += 25;
  if (countMatch) score += 15;
  if (contiguous) score += 5;
  return Math.min(100, score);
}

function normalizeIdentifier(value) {
  return String(value ?? '').trim().toLocaleUpperCase();
}

function componentsByNormalizedName(xmlData) {
  const map = new Map();
  for (const component of xmlData?.components || []) {
    const key = normalizeIdentifier(component.name);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(component);
  }
  return map;
}

function resolveComponentFromMap(map, componentName, packageName) {
  const candidates = map.get(normalizeIdentifier(componentName)) || [];
  if (!candidates.length) return null;
  const normalizedPackage = normalizeIdentifier(packageName);
  if (normalizedPackage) {
    const exactPackage = candidates.find((component) => normalizeIdentifier(component.packageName) === normalizedPackage);
    if (exactPackage) return exactPackage;
  }
  return candidates[0] || null;
}

function buildLandLookups(component) {
  const byName = new Map();
  const byGlobalId = new Map();
  for (const land of component?.lands || []) {
    const name = normalizeIdentifier(land.cadName);
    if (name) {
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(land);
    }
    if (land.globalId != null) byGlobalId.set(String(land.globalId), land);
  }
  return { byName, byGlobalId };
}

function mapAlternateLandToActive(alternateLand, activeComponent, activeLookups, coordinateTolerance = 0.08) {
  if (!alternateLand || !activeComponent) return null;
  const byId = alternateLand.globalId != null ? activeLookups.byGlobalId.get(String(alternateLand.globalId)) : null;
  if (byId) return byId;
  if (!Number.isFinite(alternateLand.centerX) || !Number.isFinite(alternateLand.centerY)) return null;
  let best = null;
  let bestDistance = Infinity;
  for (const candidate of activeComponent.lands || []) {
    if (!Number.isFinite(candidate.centerX) || !Number.isFinite(candidate.centerY)) continue;
    const distance = Math.hypot(candidate.centerX - alternateLand.centerX, candidate.centerY - alternateLand.centerY);
    if (distance < bestDistance) { best = candidate; bestDistance = distance; }
  }
  return bestDistance <= coordinateTolerance ? best : null;
}

export function buildMappings(xmlData, xlsxData, schema, options = {}) {
  const rows = xlsxData.activeSheet.rows;
  const dataRows = rows.slice(1);
  const activeComponentsByName = componentsByNormalizedName(xmlData);
  const alternateCadData = options.alternateCadData || null;
  const alternateComponentsByName = componentsByNormalizedName(alternateCadData);

  const resolveActiveComponent = (componentName, packageName) => resolveComponentFromMap(activeComponentsByName, componentName, packageName);
  const resolveAlternateComponent = (componentName, packageName) => resolveComponentFromMap(alternateComponentsByName, componentName, packageName);

  // Group by the parts that really exist in the raw data. The viewer uses these
  // groups instead of exposing every component found in the CAD XML.
  const rawGroups = new Map();
  for (const row of dataRows) {
    if (!row || row.every((value) => value == null || value === '')) continue;
    const componentName = String(row?.[schema.componentCol] ?? '').trim();
    const packageName = String(row?.[schema.packageCol] ?? '').trim();
    const key = `${normalizeIdentifier(componentName)}\u0000${normalizeIdentifier(packageName)}`;
    const group = rawGroups.get(key) || { key, componentName, packageName, count: 0 };
    group.count += 1;
    rawGroups.set(key, group);
  }

  const cadNameCounts = new Map();
  for (const component of xmlData.components || []) {
    for (const land of component.lands || []) {
      const key = `${component.id}\u0000${normalizeIdentifier(land.cadName)}`;
      cadNameCounts.set(key, (cadNameCounts.get(key) || 0) + 1);
    }
  }

  const lookupCache = new Map();
  const alternateLookupCache = new Map();
  const getLookups = (component) => {
    if (!component) return { byName: new Map(), byGlobalId: new Map() };
    if (!lookupCache.has(component.id)) lookupCache.set(component.id, buildLandLookups(component));
    return lookupCache.get(component.id);
  };
  const getAlternateLookups = (component) => {
    if (!component) return { byName: new Map(), byGlobalId: new Map() };
    if (!alternateLookupCache.has(component.id)) alternateLookupCache.set(component.id, buildLandLookups(component));
    return alternateLookupCache.get(component.id);
  };

  const mappings = [];
  for (let i = 0; i < dataRows.length; i += 1) {
    const row = dataRows[i];
    if (!row || row.every((value) => value == null || value === '')) continue;
    const componentName = String(row[schema.componentCol] ?? '').trim();
    const packageName = String(row[schema.packageCol] ?? '').trim();
    const rawLandValue = row[schema.landCol];
    const rawLandId = String(rawLandValue ?? '').trim();
    const normalizedRawLandId = normalizeIdentifier(rawLandId);
    const numericIdentifier = rawLandId !== '' && Number.isFinite(Number(rawLandId)) ? Number(rawLandId) : null;
    const rawKey = `${normalizeIdentifier(componentName)}\u0000${normalizeIdentifier(packageName)}`;
    const component = resolveActiveComponent(componentName, packageName);
    const alternateComponent = resolveAlternateComponent(componentName, packageName);
    const activeLookups = getLookups(component);
    const alternateLookups = getAlternateLookups(alternateComponent);
    let land = null;
    let mappingMethod = 'unmapped';
    let verified = false;
    let confidence = 0;
    let ambiguityCount = 0;

    const landMode = schema.landMode || 'auto';
    const tryDirectName = () => {
      if (land || ambiguityCount || !normalizedRawLandId) return;
      const directNameMatches = activeLookups.byName.get(normalizedRawLandId) || [];
      if (directNameMatches.length === 1) {
        land = directNameMatches[0]; mappingMethod = 'exact-cad-name'; verified = true; confidence = 100;
      } else if (directNameMatches.length > 1) {
        ambiguityCount = directNameMatches.length; mappingMethod = 'ambiguous-cad-name';
      }
    };
    const tryAlternateName = () => {
      if (land || !alternateComponent || !normalizedRawLandId) return;
      const alternateNameMatches = alternateLookups.byName.get(normalizedRawLandId) || [];
      if (alternateNameMatches.length === 1) {
        const bridged = mapAlternateLandToActive(alternateNameMatches[0], component, activeLookups, options.coordinateTolerance || 0.08);
        if (bridged) { land = bridged; ambiguityCount = 0; mappingMethod = 'exact-other-cad-name'; verified = true; confidence = 98; }
      } else if (alternateNameMatches.length > 1) {
        ambiguityCount = alternateNameMatches.length; mappingMethod = 'ambiguous-other-cad-name';
      }
    };
    const tryGlobalId = () => {
      if (land || numericIdentifier == null || !Number.isInteger(numericIdentifier)) return;
      const byGlobal = activeLookups.byGlobalId.get(String(numericIdentifier));
      if (byGlobal) { land = byGlobal; ambiguityCount = 0; mappingMethod = 'xml-global-id'; verified = true; confidence = 100; }
    };
    const tryLocalIndex = () => {
      if (land || !component || numericIdentifier == null || !Number.isInteger(numericIdentifier)) return;
      if (numericIdentifier > 0 && numericIdentifier <= component.lands.length) {
        land = component.lands[numericIdentifier - 1]; ambiguityCount = 0; mappingMethod = 'local-order-guess'; verified = false; confidence = 30;
      }
    };

    if (landMode === 'local-index') {
      tryLocalIndex();
      if (!land && numericIdentifier == null) { tryDirectName(); tryAlternateName(); }
    } else if (landMode === 'global-id') {
      tryGlobalId(); tryDirectName(); tryAlternateName(); tryLocalIndex();
    } else if (landMode === 'cad-name') {
      tryDirectName(); tryAlternateName(); tryGlobalId(); tryLocalIndex();
    } else {
      tryDirectName(); tryAlternateName(); tryGlobalId(); tryLocalIndex();
    }

    const countMatch = component ? rawGroups.get(rawKey)?.count === component.lands.length : false;
    const exactPackage = Boolean(component && packageName && normalizeIdentifier(component.packageName) === normalizeIdentifier(packageName));
    const baseConfidence = confidenceFor({ exactComponent: Boolean(component), exactPackage, countMatch, contiguous: Boolean(component?.contiguousGlobalIds) });
    if (land && !verified) confidence = Math.min(confidence || 30, baseConfidence || 30);

    mappings.push({
      sourceRow: i + 2,
      rawOrder: i + 1,
      rawPartKey: rawKey,
      componentName,
      packageName,
      rawLandId,
      localIndex: rawLandValue ?? rawLandId,
      componentId: component?.id ?? null,
      globalId: land?.globalId ?? null,
      cadName: land?.cadName ?? '',
      left: land?.left ?? null,
      top: land?.top ?? null,
      centerX: land?.centerX ?? null,
      centerY: land?.centerY ?? null,
      width: land?.width ?? null,
      length: land?.length ?? null,
      measurement: schema.measurementCol == null ? null : row[schema.measurementCol],
      confidence,
      mapped: Boolean(land),
      manual: false,
      verified,
      anchorLocked: false,
      mappingMethod,
      ambiguityCount,
      duplicateCadNameCount: land ? (cadNameCounts.get(`${component.id}\u0000${normalizeIdentifier(land.cadName)}`) || 1) : 0,
      raw: row,
    });
  }

  const componentSummaries = [];
  for (const group of rawGroups.values()) {
    const component = resolveActiveComponent(group.componentName, group.packageName);
    componentSummaries.push({
      rawPartKey: group.key,
      componentName: group.componentName,
      xrayCount: group.count,
      xmlCount: component?.lands.length ?? 0,
      componentId: component?.id ?? null,
      packageName: group.packageName || component?.packageName || '',
      cadPackageName: component?.packageName ?? '',
      contiguous: component?.contiguousGlobalIds ?? false,
      offset: component?.offset ?? null,
      countMatch: Boolean(component && component.lands.length === group.count),
      matched: Boolean(component),
    });
  }
  componentSummaries.sort((a, b) => a.componentName.localeCompare(b.componentName, undefined, { numeric: true }) || a.packageName.localeCompare(b.packageName));

  return {
    mappings,
    componentSummaries,
    stats: {
      total: mappings.length,
      mapped: mappings.filter((m) => m.mapped).length,
      verified: mappings.filter((m) => m.verified).length,
      unverified: mappings.filter((m) => m.mapped && !m.verified).length,
      unmapped: mappings.filter((m) => !m.mapped).length,
      ambiguous: mappings.filter((m) => m.ambiguityCount > 1).length,
      exactCadName: mappings.filter((m) => m.mappingMethod === 'exact-cad-name').length,
      exactOtherCadName: mappings.filter((m) => m.mappingMethod === 'exact-other-cad-name').length,
      xmlGlobalId: mappings.filter((m) => m.mappingMethod === 'xml-global-id').length,
      localOrderGuess: mappings.filter((m) => m.mappingMethod === 'local-order-guess').length,
      duplicateCadNames: mappings.filter((m) => m.duplicateCadNameCount > 1).length,
      rawParts: componentSummaries.length,
      matchedRawParts: componentSummaries.filter((summary) => summary.matched).length,
    },
  };
}


export function buildCadOnlyMappings(xmlData, options = {}) {
  const revision = Number(options.revision || 0);
  const mappings = [];
  const componentSummaries = [];
  let rawOrder = 0;
  for (const component of xmlData?.components || []) {
    componentSummaries.push({
      rawPartKey: `cad\u0000${String(component.id)}`,
      componentName: String(component.name || component.id || ''),
      xrayCount: 0,
      xmlCount: component.lands?.length || 0,
      componentId: component.id ?? null,
      packageName: component.packageName || '',
      cadPackageName: component.packageName || '',
      contiguous: Boolean(component.contiguousGlobalIds),
      offset: component.offset ?? null,
      countMatch: false,
      matched: true,
      sourceType: 'cad',
      revision,
    });
    for (const land of component.lands || []) {
      rawOrder += 1;
      mappings.push({
        sourceRow: null,
        rawOrder,
        rawPartKey: `cad\u0000${String(component.id)}`,
        sourceRecordId: `cad:${String(component.id)}:${String(land.globalId ?? land.localIndex)}`,
        targetRecordId: null,
        componentName: String(component.name || component.id || ''),
        packageName: String(component.packageName || ''),
        rawLandId: String(land.cadName || land.globalId || land.localIndex || ''),
        localIndex: land.localIndex,
        componentId: component.id ?? null,
        globalId: land.globalId ?? null,
        cadName: land.cadName || '',
        left: land.left ?? null,
        top: land.top ?? null,
        centerX: land.centerX ?? null,
        centerY: land.centerY ?? null,
        width: land.width ?? null,
        length: land.length ?? null,
        measurement: null,
        confidence: 100,
        mapped: true,
        manual: false,
        verified: false,
        anchorLocked: false,
        mappingMethod: 'cad-source',
        matchStatus: 'source-only',
        ambiguityCount: 0,
        duplicateCadNameCount: 0,
        cadOnly: true,
        revision,
        raw: null,
      });
    }
  }
  componentSummaries.sort((a, b) => a.componentName.localeCompare(b.componentName, undefined, { numeric: true }));
  return {
    mappings,
    componentSummaries,
    sourceType: 'cad',
    revision,
    stats: {
      total: mappings.length,
      mapped: mappings.length,
      verified: 0,
      unverified: mappings.length,
      unmapped: 0,
      ambiguous: 0,
      exactCadName: 0,
      exactOtherCadName: 0,
      xmlGlobalId: 0,
      localOrderGuess: 0,
      duplicateCadNames: 0,
      rawParts: componentSummaries.length,
      matchedRawParts: componentSummaries.length,
    },
  };
}

export async function extractProjectFiles(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xml')) return { xmlText: await file.text(), xlsxBuffer: null, names: { xml: file.name } };
  if (name.endsWith('.xlsx')) return { xmlText: null, xlsxBuffer: await file.arrayBuffer(), names: { xlsx: file.name } };
  if (!name.endsWith('.zip')) throw new Error('รองรับ ZIP, XML และ XLSX เท่านั้น');

  const zip = new ZipArchive(await file.arrayBuffer());
  const xmlEntry = zip.find((entry) => !entry.isDirectory && /\.xml$/i.test(entry.name) && !/^xl\//i.test(entry.name));
  const xlsxEntry = zip.find((entry) => !entry.isDirectory && /\.xlsx$/i.test(entry.name));
  if (!xmlEntry && !xlsxEntry) throw new Error('ไม่พบไฟล์ XML หรือ XLSX ภายใน ZIP');
  return {
    xmlText: xmlEntry ? await zip.read(xmlEntry.name, 'text') : null,
    xlsxBuffer: xlsxEntry ? await zip.read(xlsxEntry.name, 'arraybuffer') : null,
    names: { xml: xmlEntry?.name || '', xlsx: xlsxEntry?.name || '' },
  };
}
