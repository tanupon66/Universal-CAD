import { applyMatrix, normalizeRotation } from './coordinate-transform.js';

const OPERATIONS = new Set(['rotate-left', 'rotate-right', 'rotate-180', 'mirror-left-right', 'mirror-top-bottom']);

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function landRect(land) {
  const left = finite(land?.left);
  const top = finite(land?.top);
  const width = Math.abs(finite(land?.width) ?? NaN);
  const height = Math.abs(finite(land?.length) ?? NaN);
  if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  return { minX: left, maxX: left + width, minY: top - height, maxY: top, width, height };
}

function componentExtent(model) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const component of model?.components || []) {
    for (const land of component.lands || []) {
      const rect = landRect(land);
      if (!rect) continue;
      minX = Math.min(minX, rect.minX); minY = Math.min(minY, rect.minY);
      maxX = Math.max(maxX, rect.maxX); maxY = Math.max(maxY, rect.maxY);
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

export function boardTransformBounds(model) {
  const board = model?.board || {};
  const width = finite(board.Width ?? board.width);
  const height = finite(board.Height ?? board.height);
  const minX = finite(board.MinX ?? board.minX) ?? 0;
  const minY = finite(board.MinY ?? board.minY) ?? 0;
  if (width != null && height != null && width > 0 && height > 0) {
    return { minX, minY, maxX: minX + width, maxY: minY + height, width, height, source: 'board' };
  }
  const extent = componentExtent(model);
  if (!extent || extent.width <= 0 || extent.height <= 0) throw new RangeError('ไม่พบขนาด Board หรือขอบเขต Land ที่ใช้กลับทิศทางได้');
  return { ...extent, source: 'lands' };
}

export function boardOrientationTransform(bounds, operation) {
  if (!OPERATIONS.has(operation)) throw new TypeError(`Unsupported board transform: ${operation}`);
  const { minX, minY, width, height } = bounds;
  let matrix;
  let outputWidth = width;
  let outputHeight = height;
  let angleTransform;

  if (operation === 'rotate-right') {
    // Screen-clockwise while preserving the lower-left board origin.
    matrix = [0, -1, 1, 0, minX - minY, minY + width + minX];
    outputWidth = height; outputHeight = width;
    angleTransform = (angle) => normalizeRotation(angle + 90);
  } else if (operation === 'rotate-left') {
    matrix = [0, 1, -1, 0, minX + height + minY, minY - minX];
    outputWidth = height; outputHeight = width;
    angleTransform = (angle) => normalizeRotation(angle - 90);
  } else if (operation === 'rotate-180') {
    matrix = [-1, 0, 0, -1, 2 * minX + width, 2 * minY + height];
    angleTransform = (angle) => normalizeRotation(angle + 180);
  } else if (operation === 'mirror-left-right') {
    matrix = [-1, 0, 0, 1, 2 * minX + width, 0];
    angleTransform = (angle) => normalizeRotation(180 - angle);
  } else {
    matrix = [1, 0, 0, -1, 0, 2 * minY + height];
    angleTransform = (angle) => normalizeRotation(-angle);
  }

  return {
    operation,
    matrix,
    inputBounds: { ...bounds },
    outputBounds: { minX, minY, maxX: minX + outputWidth, maxY: minY + outputHeight, width: outputWidth, height: outputHeight },
    angleTransform,
  };
}

function transformLand(land, matrix) {
  const rect = landRect(land);
  if (!rect) throw new RangeError(`Land ${land?.cadName || land?.globalId || ''} มี Geometry ไม่สมบูรณ์`);
  const points = [
    applyMatrix(matrix, { x: rect.minX, y: rect.minY }),
    applyMatrix(matrix, { x: rect.maxX, y: rect.minY }),
    applyMatrix(matrix, { x: rect.maxX, y: rect.maxY }),
    applyMatrix(matrix, { x: rect.minX, y: rect.maxY }),
  ];
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  land.left = minX;
  land.top = maxY;
  land.width = maxX - minX;
  land.length = maxY - minY;
  if (Object.prototype.hasOwnProperty.call(land, 'centerX')) land.centerX = (minX + maxX) / 2;
  if (Object.prototype.hasOwnProperty.call(land, 'centerY')) land.centerY = (minY + maxY) / 2;
}

function updateBoardSize(board, outputBounds) {
  if (!board) return;
  if ('width' in board && !('Width' in board)) board.width = outputBounds.width;
  else board.Width = outputBounds.width;
  if ('height' in board && !('Height' in board)) board.height = outputBounds.height;
  else board.Height = outputBounds.height;
  if ('MinX' in board) board.MinX = outputBounds.minX;
  if ('minX' in board) board.minX = outputBounds.minX;
  if ('MinY' in board) board.MinY = outputBounds.minY;
  if ('minY' in board) board.minY = outputBounds.minY;
}

export function transformCadEditorBoard(model, operation) {
  if (!model?.components) throw new TypeError('transformCadEditorBoard ต้องได้รับ CAD Editor model');
  const bounds = boardTransformBounds(model);
  const transform = boardOrientationTransform(bounds, operation);
  for (const component of model.components) {
    for (const land of component.lands || []) if (!landRect(land)) throw new RangeError(`Land ${land?.cadName || land?.globalId || ''} มี Geometry ไม่สมบูรณ์`);
  }
  let landCount = 0;
  for (const component of model.components) {
    for (const land of component.lands || []) { transformLand(land, transform.matrix); landCount += 1; }
    const centerX = finite(component.centerX);
    const centerY = finite(component.centerY);
    if (centerX != null && centerY != null) {
      const point = applyMatrix(transform.matrix, { x: centerX, y: centerY });
      component.centerX = point.x;
      component.centerY = point.y;
    }
    component.angle = transform.angleTransform(finite(component.angle) ?? 0);
  }
  updateBoardSize(model.board, transform.outputBounds);
  model.changed = true;
  return { ...transform, componentCount: model.components.length, landCount };
}

export const BOARD_TRANSFORM_OPERATIONS = Object.freeze([...OPERATIONS]);
