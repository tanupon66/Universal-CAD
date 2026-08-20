function xmlEscape(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function formatVtxNumber(value, options = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  const precision = Math.max(0, Math.min(9, Number(options.precision ?? 3)));
  const minDecimals = Math.max(0, Math.min(precision, Number(options.minDecimals ?? 1)));
  const rounded = Math.abs(number) < 0.5 * 10 ** (-precision) ? 0 : number;
  let text = rounded.toFixed(precision);
  if (precision > minDecimals && text.includes('.')) {
    const [whole, fraction = ''] = text.split('.');
    const trimmed = fraction.replace(/0+$/g, '');
    const kept = trimmed.padEnd(Math.min(minDecimals, precision), '0');
    text = kept ? `${whole}.${kept}` : whole;
  }
  return text === '-0.0' || text === '-0' ? (minDecimals ? `0.${'0'.repeat(minDecimals)}` : '0') : text;
}

function geometryNumber(value) {
  return formatVtxNumber(value, { precision: 3, minDecimals: 1 });
}

function angleNumber(value) {
  return formatVtxNumber(value ?? 0, { precision: 5, minDecimals: 1 });
}

function machineSide(value) {
  const text = String(value ?? '').trim().toLowerCase();
  return text === '1' || text === 'bottom' || text === 'bot' || text === 'b' ? '1' : '0';
}

function timestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function keepBySide(land, side) {
  if (side === 'all') return true;
  return side === 'bottom' ? machineSide(land?.side) === '1' : machineSide(land?.side) === '0';
}

function componentLandBounds(component, side = 'all') {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const land of component?.lands || []) {
    if (!keepBySide(land, side)) continue;
    const left = Number(land.left), top = Number(land.top), width = Number(land.width), length = Number(land.length);
    if (![left, top, width, length].every(Number.isFinite)) continue;
    minX = Math.min(minX, left);
    maxX = Math.max(maxX, left + width);
    minY = Math.min(minY, top - length);
    maxY = Math.max(maxY, top);
  }
  if (!Number.isFinite(minX)) return { width: 0.1, length: 0.1 };
  return { width: Math.max(0.001, maxX - minX), length: Math.max(0.001, maxY - minY) };
}

function packageDefinitions(components, side) {
  const byName = new Map();
  for (const component of components) {
    const name = String(component.packageName || '').trim() || `PACKAGE_${component.id}`;
    if (!byName.has(name)) byName.set(name, componentLandBounds(component, side));
  }
  return byName;
}

function rectangleFeatureLines(width, length, indent) {
  const w = geometryNumber(width);
  const l = geometryNumber(length);
  const zero = '0.0';
  const negL = geometryNumber(-Number(length));
  return [
    `${indent}<Feature Command="OB" X1="${zero}" Y1="${negL}" X2="" Y2="" Type="I" Clockwise=""/>`,
    `${indent}<Feature Command="OS" X1="${zero}" Y1="${zero}" X2="" Y2="" Type="" Clockwise=""/>`,
    `${indent}<Feature Command="OS" X1="${w}" Y1="${zero}" X2="" Y2="" Type="" Clockwise=""/>`,
    `${indent}<Feature Command="OS" X1="${w}" Y1="${negL}" X2="" Y2="" Type="" Clockwise=""/>`,
    `${indent}<Feature Command="OE" X1="${zero}" Y1="${negL}" X2="" Y2="" Type="" Clockwise=""/>`,
  ];
}

export function isVtxEpmXml(xmlText = '') {
  return /<DataList\b/i.test(String(xmlText)) && /<ComponentInformationCollectionXml\b/i.test(String(xmlText)) && /<ComponentNumberCollectionXml\b/i.test(String(xmlText));
}

export function exportVtxInspectionXml(model, options = {}) {
  const side = options.side || 'all';
  const now = options.date instanceof Date ? options.date : new Date();
  const sourceComponents = model?.components || [];
  const components = sourceComponents.filter((component) => (component.lands || []).some((land) => keepBySide(land, side)));
  const componentIdMap = new Map();
  components.forEach((component, index) => componentIdMap.set(component, String(index + 1)));
  const packages = packageDefinitions(components, side);
  const board = model?.board || {};
  const boardName = String(board.Name ?? board.name ?? '').trim();
  const boardSide = side === 'bottom' ? '1' : '0';
  const lines = [];
  const push = (line = '') => lines.push(line);
  push('<?xml version="1.0" encoding="utf-8"?>');
  push('<DataList FormatVersion="">');
  push('\t<InspectionProjectXml>');
  push(`\t\t<InspectionProject CreationDateTime="${timestamp(now)}" UpdateDateTime="${timestamp(now)}" ODBFolderPath="">`);
  push(`\t\t\t<BoardInformation Name="${xmlEscape(boardName)}" Side="${boardSide}" Width="${geometryNumber(board.Width ?? board.width ?? 0)}" Height="${geometryNumber(board.Height ?? board.height ?? 0)}" Thickness="${geometryNumber(board.Thickness ?? board.thickness ?? 0)}" MaskThickness="" ReferencePositionX="" ReferencePositionY="">`);
  push('\t\t\t\t<ComponentBlockUnitSummaryList>');
  push('\t\t\t\t</ComponentBlockUnitSummaryList>');
  push('\t\t\t</BoardInformation>');
  push('\t\t</InspectionProject>');
  push('\t</InspectionProjectXml>');
  push('\t<InspectionRegionCollectionSetXml>');
  push('\t\t<InspectionRegionCollectionSet>');
  push('\t\t\t<ItemList>');
  push('\t\t\t\t<InspectionRegionCollection InspectionRegionType="Fiducial">');
  push('\t\t\t\t\t<ItemList>');
  push('\t\t\t\t\t</ItemList>');
  push('\t\t\t\t</InspectionRegionCollection>');
  push('\t\t\t</ItemList>');
  push('\t\t</InspectionRegionCollectionSet>');
  push('\t</InspectionRegionCollectionSetXml>');
  push('\t<ComponentInformationCollectionXml>');
  push('\t\t<ComponentInformationCollection>');
  push('\t\t\t<Dictionary>');
  for (const component of components) {
    const id = componentIdMap.get(component);
    const packageName = String(component.packageName || '').trim() || `PACKAGE_${id}`;
    push(`\t\t\t\t<ComponentInformation Id="${id}" Name="${xmlEscape(component.name || '')}">`);
    push('\t\t\t\t\t<ItemList>');
    push(`\t\t\t\t\t\t<ComponentInformationItem ComponentNumberId="${xmlEscape(packageName)}" ComponentNumberRevision="${xmlEscape(component.revision || '')}">`);
    push(`\t\t\t\t\t\t\t<PositionAngle CenterPosX="${geometryNumber(component.centerX ?? 0)}" CenterPosY="${geometryNumber(component.centerY ?? 0)}" Angle="${angleNumber(component.angle ?? 0)}"/>`);
    push('\t\t\t\t\t\t\t<DestinationList>');
    push(`\t\t\t\t\t\t\t\t<Destination Name="${xmlEscape(packageName)}"/>`);
    push('\t\t\t\t\t\t\t</DestinationList>');
    push('\t\t\t\t\t\t</ComponentInformationItem>');
    push('\t\t\t\t\t</ItemList>');
    push('\t\t\t\t</ComponentInformation>');
  }
  push('\t\t\t</Dictionary>');
  push('\t\t</ComponentInformationCollection>');
  push('\t</ComponentInformationCollectionXml>');
  push('\t<ComponentNumberCollectionXml>');
  push('\t\t<ComponentNumberCollection FormatVersion="">');
  for (const [packageName, bounds] of packages) {
    push(`\t\t\t<ComponentNumber ComponentNumberId="${xmlEscape(packageName)}" ComponentType="OTHER">`);
    push(`\t\t\t\t<ComponentWindow Width="${geometryNumber(bounds.width)}" Length="${geometryNumber(bounds.length)}" Height="2.0">`);
    push('\t\t\t\t\t<ElectrodeGroupList>');
    push('\t\t\t\t\t\t<ElectrodeGroupInComponentNumber PinGroupId="" ElectrodeType="" ToePosRatio="" KneePosRatio="" Width="" Length="" Height="">');
    push('\t\t\t\t\t\t\t<ElectrodeWindowList>');
    push('\t\t\t\t\t\t\t\t<ElectrodeWindowInComponentNumber PinId="" Left="" Top="" Angle="">');
    push('\t\t\t\t\t\t\t\t</ElectrodeWindowInComponentNumber>');
    push('\t\t\t\t\t\t\t</ElectrodeWindowList>');
    push('\t\t\t\t\t\t</ElectrodeGroupInComponentNumber>');
    push('\t\t\t\t\t</ElectrodeGroupList>');
    push('\t\t\t\t</ComponentWindow>');
    push('\t\t\t</ComponentNumber>');
  }
  push('\t\t</ComponentNumberCollection>');
  push('\t\t<LandNumberCollection>');
  let landId = 1;
  for (const component of components) {
    const componentId = componentIdMap.get(component);
    for (const land of component.lands || []) {
      if (!keepBySide(land, side)) continue;
      const width = Number(land.width);
      const length = Number(land.length);
      push(`\t\t\t<LandNumber LandId="${landId}" Component="${componentId}" Name="${xmlEscape(land.cadName || '')}" Side="${machineSide(land.side)}">`);
      push(`\t\t\t\t<Land Left="${geometryNumber(land.left)}" Top="${geometryNumber(land.top)}" Width="${geometryNumber(width)}" Length="${geometryNumber(length)}">`);
      push('\t\t\t\t\t<FeatureList>');
      for (const feature of rectangleFeatureLines(width, length, '\t\t\t\t\t\t')) push(feature);
      push('\t\t\t\t\t</FeatureList>');
      push('\t\t\t\t</Land>');
      push('\t\t\t</LandNumber>');
      landId += 1;
    }
  }
  push('\t\t</LandNumberCollection>');
  push('\t</ComponentNumberCollectionXml>');
  push('</DataList>');
  return `${lines.join('\r\n')}\r\n`;
}

export const __test = { machineSide, geometryNumber, angleNumber, rectangleFeatureLines, componentLandBounds };
