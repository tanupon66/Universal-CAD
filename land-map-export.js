import { buildSequentialLandLabels, detectLandGrid } from './land-grid-mapper.js';

function xmlEscape(value = '') {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function safeLabel(value, fallback = '—') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function mappingLabelMap(component, mappings = []) {
  const map = new Map();
  for (const mapping of mappings || []) {
    if (String(mapping?.componentId ?? '') !== String(component?.id ?? '')) continue;
    if (mapping?.globalId == null || mapping?.mapped === false) continue;
    const label = mapping.rawLandId ?? mapping.localIndex ?? mapping.rawOrder;
    if (label != null && label !== '') map.set(Number(mapping.globalId), label);
  }
  return map;
}

export function createLandMapModel(component, mappings = [], options = {}) {
  if (!component) throw new TypeError('กรุณาเลือก Component สำหรับ Land Map');
  const grid = detectLandGrid(component, options.grid || {});
  if (grid.collisions.length) throw new RangeError(`ตรวจพบ Land ซ้อนกันใน Grid ${grid.collisions.length} ตำแหน่ง`);
  const mappedLabels = mappingLabelMap(component, mappings);
  const sequenceLabels = buildSequentialLandLabels(grid, {
    order: options.sequenceOrder || 'row-major',
    reverseRows: Boolean(options.sequenceReverseRows),
    reverseColumns: Boolean(options.sequenceReverseColumns),
    descending: options.sequenceDescending !== false,
    start: options.sequenceStart,
  });
  const numberingMode = options.numberingMode || 'mapping';
  const cells = [];
  for (let row = 0; row < grid.rowCount; row += 1) {
    for (let column = 0; column < grid.columnCount; column += 1) {
      const land = grid.matrix[row][column];
      if (!land) continue;
      const mapped = mappedLabels.get(Number(land.globalId));
      const sequence = sequenceLabels.get(land);
      const xrayLabel = numberingMode === 'sequence' ? sequence : (mapped ?? sequence);
      cells.push({ row, column, land, xrayLabel, cadName: safeLabel(land.cadName, String(land.globalId ?? '—')), mapped: mapped != null });
    }
  }
  return {
    component,
    grid,
    cells,
    titlePrefix: String(options.titlePrefix || 'Sample Location'),
    componentName: safeLabel(component.name, `ID ${component.id}`),
    packageName: safeLabel(component.packageName, 'Package not specified'),
    boardName: safeLabel(options.boardName, ''),
    numberingMode,
    mappingCount: cells.filter((cell) => cell.mapped).length,
    generatedCount: cells.filter((cell) => !cell.mapped).length,
    metadata: options.metadata || {},
  };
}

function layoutFor(model, width, height) {
  const marginX = width * 0.075;
  const titleY = height * 0.035;
  const subtitleY = height * 0.095;
  const frameX = width * 0.17;
  const frameY = height * 0.19;
  const frameW = width * 0.66;
  const frameH = height * 0.72;
  const padX = frameW * 0.055;
  const padY = frameH * 0.07;
  const availableW = frameW - padX * 2;
  const availableH = frameH - padY * 2;
  const colPitch = availableW / Math.max(1, model.grid.columnCount);
  const rowPitch = availableH / Math.max(1, model.grid.rowCount);
  const cellW = Math.min(colPitch * 0.62, rowPitch * 1.05);
  const cellH = Math.min(rowPitch * 0.62, cellW * 0.65);
  return { width, height, marginX, titleY, subtitleY, frameX, frameY, frameW, frameH, padX, padY, availableW, availableH, colPitch, rowPitch, cellW, cellH };
}

export function buildLandMapSvg(model, options = {}) {
  const width = Number(options.width) || 1600;
  const height = Number(options.height) || 900;
  const layout = layoutFor(model, width, height);
  const font = 'Arial, Noto Sans Thai, sans-serif';
  const shapes = [];
  shapes.push(`<rect width="${width}" height="${height}" fill="#ffffff"/>`);
  shapes.push(`<text x="${width / 2}" y="${layout.titleY + 38}" text-anchor="middle" font-family="${font}" font-size="34" font-weight="700" fill="#111111"><tspan>${xmlEscape(model.titlePrefix)} </tspan><tspan fill="#ff0000">${xmlEscape(model.componentName)}</tspan></text>`);
  shapes.push(`<text x="${width / 2}" y="${layout.subtitleY + 38}" text-anchor="middle" font-family="${font}" font-size="31" fill="#111111">${xmlEscape(model.packageName)}</text>`);
  shapes.push(`<rect x="${layout.frameX}" y="${layout.frameY}" width="${layout.frameW}" height="${layout.frameH}" fill="none" stroke="#555555" stroke-width="1.5"/>`);
  for (const cell of model.cells) {
    const centerX = layout.frameX + layout.padX + (cell.column + 0.5) * layout.colPitch;
    const centerY = layout.frameY + layout.padY + (cell.row + 0.5) * layout.rowPitch;
    const x = centerX - layout.cellW / 2;
    const y = centerY - layout.cellH / 2;
    const topH = layout.cellH * 0.48;
    const fontSize = Math.max(9, Math.min(16, layout.cellH * 0.18));
    shapes.push(`<rect x="${x}" y="${y}" width="${layout.cellW}" height="${topH}" fill="#f4ddcf" stroke="#454545" stroke-width="1"/>`);
    shapes.push(`<rect x="${x}" y="${y + topH}" width="${layout.cellW}" height="${layout.cellH - topH}" fill="#c7eaf7" stroke="#454545" stroke-width="1"/>`);
    shapes.push(`<text x="${centerX}" y="${y + topH * 0.66}" text-anchor="middle" font-family="${font}" font-size="${fontSize}" font-weight="700" fill="#111111">${xmlEscape(`LAND ${cell.xrayLabel}`)}</text>`);
    shapes.push(`<text x="${centerX}" y="${y + topH + (layout.cellH - topH) * 0.67}" text-anchor="middle" font-family="${font}" font-size="${fontSize}" font-weight="700" fill="#111111">${xmlEscape(cell.cadName)}</text>`);
  }
  shapes.push(`<metadata>${xmlEscape(JSON.stringify({ ...model.metadata, componentId: model.component.id, componentName: model.componentName, packageName: model.packageName, boardName: model.boardName, rows: model.grid.rowCount, columns: model.grid.columnCount, numberingMode: model.numberingMode, mappingCount: model.mappingCount, generatedCount: model.generatedCount }))}</metadata>`);
  return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${shapes.join('')}</svg>`;
}

export function buildLandMapPresentation(PptxGenJSClass, model, options = {}) {
  if (typeof PptxGenJSClass !== 'function') throw new Error('ไม่พบ PptxGenJS สำหรับสร้าง PowerPoint');
  const pptx = new PptxGenJSClass();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'Universal CAD Studio';
  pptx.company = 'Universal CAD Studio';
  pptx.subject = `Land Map ${model.componentName}`;
  pptx.title = `${model.titlePrefix} ${model.componentName}`;
  pptx.lang = 'th-TH';
  const slide = pptx.addSlide();
  slide.background = { color: 'FFFFFF' };
  const pageW = 13.333;
  const pageH = 7.5;
  const layout = layoutFor(model, pageW, pageH);
  slide.addText([
    { text: `${model.titlePrefix} `, options: { color: '111111', bold: true } },
    { text: model.componentName, options: { color: 'FF0000', bold: true } },
  ], { x: 0.7, y: 0.18, w: 11.93, h: 0.42, fontFace: 'Arial', fontSize: 20, align: 'center', margin: 0, breakLine: false, fit: 'shrink' });
  slide.addText(model.packageName, { x: 0.7, y: 0.62, w: 11.93, h: 0.35, fontFace: 'Arial', fontSize: 17, align: 'center', margin: 0, fit: 'shrink' });
  slide.addShape(pptx.ShapeType.rect, { x: layout.frameX, y: layout.frameY, w: layout.frameW, h: layout.frameH, fill: { color: 'FFFFFF', transparency: 100 }, line: { color: '555555', width: 1 } });
  for (const cell of model.cells) {
    const centerX = layout.frameX + layout.padX + (cell.column + 0.5) * layout.colPitch;
    const centerY = layout.frameY + layout.padY + (cell.row + 0.5) * layout.rowPitch;
    const x = centerX - layout.cellW / 2;
    const y = centerY - layout.cellH / 2;
    const topH = layout.cellH * 0.48;
    const fontSize = Math.max(5.5, Math.min(9, layout.cellH * 9.5));
    slide.addShape(pptx.ShapeType.rect, { x, y, w: layout.cellW, h: topH, fill: { color: 'F4DDCF' }, line: { color: '454545', width: 0.55 } });
    slide.addShape(pptx.ShapeType.rect, { x, y: y + topH, w: layout.cellW, h: layout.cellH - topH, fill: { color: 'C7EAF7' }, line: { color: '454545', width: 0.55 } });
    slide.addText(`LAND ${cell.xrayLabel}`, { x, y: y + topH * 0.06, w: layout.cellW, h: topH * 0.82, fontFace: 'Arial', fontSize, bold: true, align: 'center', valign: 'mid', margin: 0, fit: 'shrink' });
    slide.addText(cell.cadName, { x, y: y + topH, w: layout.cellW, h: layout.cellH - topH, fontFace: 'Arial', fontSize, bold: true, align: 'center', valign: 'mid', margin: 0, fit: 'shrink' });
  }
  slide.addNotes(`Project ID: ${model.metadata?.projectId || '—'}\nRevision: ${model.metadata?.revisionNumber ?? '—'}\nExport time: ${model.metadata?.exportTime || new Date().toISOString()}\nSource format: ${model.metadata?.sourceFormat || '—'}\nExport format: ${model.metadata?.exportFormat || 'pptx-land-map'}\nValidation: ${model.metadata?.validationStatus || '—'}\nAccepted warnings: ${(model.metadata?.acceptedWarnings || []).map((item) => typeof item === 'string' ? item : item?.code || item?.id || '').filter(Boolean).join(', ') || '—'}\nBoard: ${model.boardName || '—'}\nComponent: ${model.componentName}\nPackage: ${model.packageName}\nGrid: ${model.grid.rowCount} x ${model.grid.columnCount}\nNumbering: ${model.numberingMode}\nMapped labels: ${model.mappingCount}\nGenerated fallback labels: ${model.generatedCount}`);
  if (options.creator) pptx.creator = String(options.creator);
  return pptx;
}

export async function createLandMapPptxBlob(model, options = {}) {
  const PptxGenJSClass = options.PptxGenJSClass || globalThis.PptxGenJS;
  const pptx = buildLandMapPresentation(PptxGenJSClass, model, options);
  return pptx.write({ outputType: 'blob', compression: true });
}
