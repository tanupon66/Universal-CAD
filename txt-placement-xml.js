const TYPE_RULES = [
  { prefixes: ['TP'], type: 'TESTPOINT', pads: 1, library: 'AUTO_TESTPOINT_1PAD' },
  { prefixes: ['RN'], type: 'RESISTOR', pads: 4, library: 'AUTO_RESISTOR_NETWORK_4PAD' },
  { prefixes: ['FB'], type: 'INDUCTOR', pads: 2, library: 'AUTO_FERRITE_2PAD' },
  { prefixes: ['RT', 'RV'], type: 'RESISTOR', pads: 2, library: 'AUTO_RESISTOR_2PAD' },
  { prefixes: ['CR', 'ZD'], type: 'DIODE', pads: 2, library: 'AUTO_DIODE_2PAD' },
  { prefixes: ['LED', 'DS'], type: 'DIODE', pads: 2, library: 'AUTO_DIODE_2PAD' },
  { prefixes: ['BT'], type: 'OTHER', pads: 2, library: 'AUTO_BATTERY_2PAD' },
  { prefixes: ['CN', 'J', 'P', 'JP'], type: 'CONNECTOR', pads: 4, library: 'AUTO_CONNECTOR_4PAD' },
  { prefixes: ['SW', 'S'], type: 'OTHER', pads: 2, library: 'AUTO_SWITCH_2PAD' },
  { prefixes: ['K'], type: 'RELAY', pads: 4, library: 'AUTO_RELAY_4PAD' },
  { prefixes: ['F'], type: 'FUSE', pads: 2, library: 'AUTO_FUSE_2PAD' },
  { prefixes: ['Y', 'X'], type: 'CRYSTAL', pads: 2, library: 'AUTO_CRYSTAL_2PAD' },
  { prefixes: ['Q', 'T'], type: 'TRANSISTOR', pads: 3, library: 'AUTO_TRANSISTOR_3PAD' },
  { prefixes: ['U', 'IC'], type: 'OTHER', pads: 4, library: 'AUTO_IC_4PAD' },
  { prefixes: ['L'], type: 'INDUCTOR', pads: 2, library: 'AUTO_INDUCTOR_2PAD' },
  { prefixes: ['C'], type: 'CAPACITOR', pads: 2, library: 'AUTO_CAPACITOR_2PAD' },
  { prefixes: ['R'], type: 'RESISTOR', pads: 2, library: 'AUTO_RESISTOR_2PAD' },
];

function escapeXml(value = '') {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function number(value, precision = 3) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  const rounded = Math.abs(n) < 0.5 * 10 ** (-precision) ? 0 : n;
  let text = rounded.toFixed(precision);
  if (text.includes('.')) text = text.replace(/0+$/, '').replace(/\.$/, '');
  return text === '-0' ? '0' : text || '0';
}

function angle(value) {
  const n = Number(value);
  return Number.isFinite(n) ? number(n, 5) : '0';
}

function splitDelimitedLine(line, delimiter) {
  const result = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { result.push(cell.trim()); cell = ''; }
    else cell += ch;
  }
  result.push(cell.trim());
  return result;
}

export function detectPlacementDelimiter(text = '') {
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim()).slice(0, 20);
  const candidates = ['\t', ',', ';', '|'];
  const score = (d) => {
    const counts = lines.map((line) => splitDelimitedLine(line, d).length);
    const multi = counts.filter((count) => count > 1).length;
    const average = counts.reduce((a, b) => a + b, 0) / Math.max(1, counts.length);
    return multi * 100 + average;
  };
  return candidates.sort((a, b) => score(b) - score(a))[0] || '\t';
}

export function parsePlacementText(text = '', options = {}) {
  const source = String(text || '').replace(/^\uFEFF/, '');
  const delimiter = options.delimiter || detectPlacementDelimiter(source);
  const rows = source.split(/\r?\n/).filter((line) => line.trim()).map((line) => splitDelimitedLine(line, delimiter));
  if (!rows.length) throw new Error('The TXT file is empty.');
  const columnCount = Math.max(...rows.map((row) => row.length));
  for (const row of rows) while (row.length < columnCount) row.push('');
  const first = rows[0].map((value) => String(value || '').trim().toLowerCase());
  const headerScore = first.filter((value) => /location|designator|refdes|reference|variation|rotation|angle|posx|center.?x|mid.?x|x.?location|posy|center.?y|mid.?y|y.?location/.test(value)).length;
  const hasHeader = headerScore >= 2;
  const startRow = Number.isInteger(options.startRow) ? options.startRow : (hasHeader ? 1 : 0);
  return { rows, delimiter, columnCount, rowCount: Math.max(0, rows.length - startRow), hasHeader, headers: hasHeader ? rows[0].map((value) => String(value || '').trim()) : [], startRow };
}

function scoreColumn(values, pattern, numeric = false) {
  const sample = values.slice(0, 80);
  if (!sample.length) return 0;
  if (numeric) return sample.filter((v) => v !== '' && Number.isFinite(Number(String(v).replace(',', '.')))).length / sample.length;
  return sample.filter((v) => pattern.test(String(v).trim().toLowerCase())).length;
}

export function detectPlacementColumns(parsed) {
  const rows = parsed?.rows || [];
  const start = parsed?.hasHeader ? 1 : 0;
  const header = parsed?.hasHeader ? rows[0].map((v) => String(v || '').trim().toLowerCase()) : [];
  const columns = Array.from({ length: parsed?.columnCount || 0 }, (_, index) => index);
  const values = (index) => rows.slice(start, start + 80).map((row) => row[index] ?? '');
  const pickHeader = (patterns) => {
    const index = header.findIndex((value) => patterns.some((pattern) => pattern.test(value)));
    return index >= 0 ? index : null;
  };
  const location = pickHeader([/^(location|designator|refdes|reference|ref)$/i, /component.?name/i]);
  const variation = pickHeader([/variation|rotation|angle|theta|orient/i]);
  const x = pickHeader([/^(x|posx|center.?x|mid.?x|location.?x|x.?location)/i]);
  const y = pickHeader([/^(y|posy|center.?y|mid.?y|location.?y|y.?location)/i]);
  const candidates = {
    location: location ?? columns.find((i) => scoreColumn(values(i), /^[a-z]{1,4}[-_ ]?\d+[a-z]?$/i) > 0.35) ?? 0,
    variation: variation ?? columns.find((i) => scoreColumn(values(i), /./, true) > 0.7 && i !== (x ?? -1) && i !== (y ?? -1)) ?? Math.min(1, Math.max(0, (location ?? 0) + 1)),
    x: x ?? columns.find((i) => scoreColumn(values(i), /./, true) > 0.7 && i !== (location ?? -1)) ?? 2,
    y: y ?? columns.find((i) => scoreColumn(values(i), /./, true) > 0.7 && i !== (location ?? -1) && i !== (x ?? -1)) ?? 3,
  };
  return candidates;
}

function prefixOf(location) {
  const match = String(location || '').trim().toUpperCase().match(/^[A-Z]+/);
  return match ? match[0] : '';
}

export function libraryForLocation(location) {
  const prefix = prefixOf(location);
  for (const rule of TYPE_RULES) if (rule.prefixes.some((item) => prefix === item || prefix.startsWith(item))) return { ...rule, prefix };
  return { type: 'OTHER', pads: 2, library: 'AUTO_DEFAULT_2PAD', prefix };
}

function machineSide(value) {
  const text = String(value ?? '').trim().toLowerCase();
  return text === '1' || text === 'bottom' || text === 'bot' || text === 'b' ? '1' : '0';
}

function unitScale(unit) {
  const normalized = String(unit || 'mm').toLowerCase();
  if (normalized === 'inch' || normalized === 'in') return 25.4;
  if (normalized === 'mil' || normalized === 'mils') return 0.0254;
  return 1;
}

function padCenters(pads, pitch) {
  if (pads === 1) return [[0, 0]];
  if (pads === 2) return [[-pitch / 2, 0], [pitch / 2, 0]];
  if (pads === 3) return [[-pitch / 2, -pitch / 2], [pitch / 2, -pitch / 2], [0, pitch / 2]];
  const half = pitch / 2;
  return [[-half, -half], [half, -half], [half, half], [-half, half]].slice(0, pads);
}

function rotatePoint(x, y, degrees) {
  const radians = Number(degrees || 0) * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: x * cos - y * sin, y: x * sin + y * cos };
}

function featureLines(width, length) {
  const w = number(width), l = number(length), y = number(-length);
  return [
    '<Feature Command="OB" X1="0.0" Y1="' + y + '" X2="" Y2="" Type="I" Clockwise=""/>',
    '<Feature Command="OS" X1="0.0" Y1="0.0" X2="" Y2="" Type="" Clockwise=""/>',
    '<Feature Command="OS" X1="' + w + '" Y1="0.0" X2="" Y2="" Type="" Clockwise=""/>',
    '<Feature Command="OS" X1="' + w + '" Y1="' + y + '" X2="" Y2="" Type="" Clockwise=""/>',
    '<Feature Command="OE" X1="0.0" Y1="' + y + '" X2="" Y2="" Type="" Clockwise=""/>',
  ];
}

function parseVariation(value) {
  const text = String(value ?? '').trim();
  if (!text) return { angle: 0, variant: '' };
  const n = Number(text.replace(',', '.'));
  if (Number.isFinite(n)) return { angle: n, variant: '' };
  return { angle: 0, variant: text };
}

function xmlTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return date.getFullYear() + '/' + pad(date.getMonth() + 1) + '/' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
}

export function buildPlacementInspectionXml(parsed, options = {}) {
  const rows = parsed?.rows || [];
  const startRow = Number.isInteger(options.startRow) ? options.startRow : (parsed?.startRow || 0);
  const locationColumn = Number(options.locationColumn);
  const variationColumn = Number(options.variationColumn);
  const xColumn = Number(options.xColumn);
  const yColumn = Number(options.yColumn);
  if (![locationColumn, variationColumn, xColumn, yColumn].every(Number.isInteger)) throw new Error('Location, Variation, X, and Y columns must be selected.');
  const scale = unitScale(options.unit || 'mm');
  const padWidth = Math.max(0.05, Number(options.padWidth) || 0.8);
  const padLength = Math.max(0.05, Number(options.padLength) || 0.8);
  const pitch = Math.max(Math.max(padWidth, padLength), Number(options.padPitch) || 1.2);
  const side = machineSide(options.side);
  const components = [];
  const warnings = [];
  const libraryCounts = new Map();
  const seen = new Map();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let rowIndex = startRow; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const location = String(row[locationColumn] ?? '').trim();
    if (!location) continue;
    const x = Number(String(row[xColumn] ?? '').trim().replace(',', '.'));
    const y = Number(String(row[yColumn] ?? '').trim().replace(',', '.'));
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      warnings.push('Row ' + (rowIndex + 1) + ': invalid X/Y; skipped ' + location + '.');
      continue;
    }
    const variation = parseVariation(row[variationColumn]);
    const library = libraryForLocation(location);
    // Placement TXT is the source of truth for Variation. Library remains only
    // the geometry/fallback definition when the TXT row has no explicit Variation.
    const duplicateCount = (seen.get(location) || 0) + 1;
    seen.set(location, duplicateCount);
    const component = { id: String(components.length + 1), name: location, centerX: x * scale, centerY: y * scale, angle: variation.angle, variant: variation.variant, variation: variation.variant, library, side };
    components.push(component);
    libraryCounts.set(library.library, (libraryCounts.get(library.library) || 0) + 1);
    minX = Math.min(minX, component.centerX); maxX = Math.max(maxX, component.centerX);
    minY = Math.min(minY, component.centerY); maxY = Math.max(maxY, component.centerY);
    if (duplicateCount > 1) warnings.push('Duplicate Location "' + location + '" at row ' + (rowIndex + 1) + '; both records were retained.');
  }
  if (!components.length) throw new Error('No valid placement rows were found. Check the selected columns and first data row.');
  const margin = Math.max(1, Number(options.boardMargin) || 5);
  const boardWidth = Math.max(10, maxX - minX + margin * 2);
  const boardHeight = Math.max(10, maxY - minY + margin * 2);
  const boardOriginX = minX - margin;
  const boardOriginY = minY - margin;
  const now = options.date instanceof Date ? options.date : new Date();
  const lines = [];
  const push = (line = '') => lines.push(line);
  push('<?xml version="1.0" encoding="utf-8"?>');
  push('<DataList FormatVersion="">');
  push('  <InspectionProjectXml>');
  push('    <InspectionProject CreationDateTime="' + xmlTimestamp(now) + '" UpdateDateTime="' + xmlTimestamp(now) + '" ODBFolderPath="">');
  push('      <BoardInformation Name="' + escapeXml(options.boardName || 'TXT_PLACEMENT_BOARD') + '" Side="' + side + '" Width="' + number(boardWidth) + '" Height="' + number(boardHeight) + '" Thickness="' + number(Number(options.boardThickness) || 1.6) + '" MaskThickness="" ReferencePositionX="' + number(boardOriginX) + '" ReferencePositionY="' + number(boardOriginY) + '">');
  push('        <ComponentBlockUnitSummaryList>');
  push('        </ComponentBlockUnitSummaryList>');
  push('      </BoardInformation>');
  push('    </InspectionProject>');
  push('  </InspectionProjectXml>');
  push('  <InspectionRegionCollectionSetXml>');
  push('    <InspectionRegionCollectionSet><ItemList><InspectionRegionCollection InspectionRegionType="Fiducial"><ItemList></ItemList></InspectionRegionCollection></ItemList></InspectionRegionCollectionSet>');
  push('  </InspectionRegionCollectionSetXml>');
  push('  <ComponentInformationCollectionXml>');
  push('    <ComponentInformationCollection><Dictionary>');
  for (const component of components) {
    push('      <ComponentInformation Id="' + component.id + '" Name="' + escapeXml(component.name) + '">');
    push('        <ItemList>');
    const variationValue = String(component.variant || component.variation || '').trim();
    const componentNumberId = variationValue || component.library.library;
    const variationAttr = variationValue ? ' UCADVariation="' + escapeXml(variationValue) + '"' : '';
    push('          <ComponentInformationItem ComponentNumberId="' + escapeXml(componentNumberId) + '" ComponentNumberRevision=""' + variationAttr + '>');
    push('            <PositionAngle CenterPosX="' + number(component.centerX) + '" CenterPosY="' + number(component.centerY) + '" Angle="' + angle(component.angle) + '"/>');
    push('            <DestinationList>');
    push('              <Destination Name="' + escapeXml(componentNumberId) + '"/>');
    push('            </DestinationList>');
    push('          </ComponentInformationItem>');
    push('        </ItemList>');
    push('      </ComponentInformation>');
  }
  push('    </Dictionary></ComponentInformationCollection>');
  push('  </ComponentInformationCollectionXml>');
  push('  <ComponentNumberCollectionXml>');
  push('    <ComponentNumberCollection FormatVersion="">');
  const uniqueLibraries = new Map();
  for (const component of components) {
    const componentNumberId = String(component.variant || component.variation || '').trim() || component.library.library;
    if (!uniqueLibraries.has(componentNumberId)) uniqueLibraries.set(componentNumberId, component.library);
  }
  for (const [libraryName, library] of uniqueLibraries) {
    const bodyWidth = library.pads === 1 ? padWidth : pitch + padWidth;
    const bodyLength = library.pads <= 2 ? padLength : pitch + padLength;
    push('      <ComponentNumber ComponentNumberId="' + escapeXml(libraryName) + '" ComponentType="' + library.type + '">');
    push('        <ComponentWindow Width="' + number(bodyWidth) + '" Length="' + number(bodyLength) + '" Height="2.0">');
    push('          <ElectrodeGroupList><ElectrodeGroupInComponentNumber PinGroupId="" ElectrodeType="" ToePosRatio="" KneePosRatio="" Width="" Length="" Height="">');
    push('            <ElectrodeWindowList><ElectrodeWindowInComponentNumber PinId="" Left="" Top="" Angle=""></ElectrodeWindowInComponentNumber></ElectrodeWindowList>');
    push('          </ElectrodeGroupInComponentNumber></ElectrodeGroupList>');
    push('        </ComponentWindow>');
    push('      </ComponentNumber>');
  }
  push('    </ComponentNumberCollection>');
  push('    <LandNumberCollection>');
  let landId = 1;
  for (const component of components) {
    const centers = padCenters(component.library.pads, pitch);
    for (let index = 0; index < centers.length; index += 1) {
      const rotated = rotatePoint(centers[index][0], centers[index][1], component.angle);
      const cx = component.centerX + rotated.x;
      const cy = component.centerY + rotated.y;
      const left = cx - padWidth / 2;
      const top = cy + padLength / 2;
      push('      <LandNumber LandId="' + landId + '" Component="' + component.id + '" Name="' + (index + 1) + '" Side="' + component.side + '">');
      push('        <Land Left="' + number(left) + '" Top="' + number(top) + '" Width="' + number(padWidth) + '" Length="' + number(padLength) + '">');
      push('          <FeatureList>');
      for (const feature of featureLines(padWidth, padLength)) push('            ' + feature);
      push('          </FeatureList>');
      push('        </Land>');
      push('      </LandNumber>');
      landId += 1;
    }
  }
  push('    </LandNumberCollection>');
  push('  </ComponentNumberCollectionXml>');
  push('</DataList>');
  return {
    xml: lines.join('\r\n') + '\r\n',
    summary: {
      components: components.length,
      lands: components.reduce((sum, item) => sum + item.library.pads, 0),
      libraries: [...libraryCounts.entries()].map(([name, count]) => ({ name, count })),
      warnings,
      board: { width: boardWidth, height: boardHeight, originX: boardOriginX, originY: boardOriginY },
    },
  };
}

export const __test = { TYPE_RULES, splitDelimitedLine, libraryForLocation, padCenters, parseVariation, featureLines };
