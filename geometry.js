import { GeometryError } from './cad-errors.js';
import { cloneCadValue, normalizeRotation } from './universal-cad-model.js';

export const GEOMETRY_EPSILON = 1e-9;
function finite(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new GeometryError(`${name} เป็น NaN หรือ Infinity`, { stage: 'geometry-validation', context: { value } });
  return number;
}
function samePoint(a, b, epsilon = GEOMETRY_EPSILON) { return Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon; }
function orientation(a, b, c) {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(value) <= GEOMETRY_EPSILON) return 0;
  return value > 0 ? 1 : 2;
}
function onSegment(a, b, c) { return b.x <= Math.max(a.x, c.x) + GEOMETRY_EPSILON && b.x + GEOMETRY_EPSILON >= Math.min(a.x, c.x) && b.y <= Math.max(a.y, c.y) + GEOMETRY_EPSILON && b.y + GEOMETRY_EPSILON >= Math.min(a.y, c.y); }
export function segmentsIntersect(a, b, c, d) {
  const o1 = orientation(a, b, c), o2 = orientation(a, b, d), o3 = orientation(c, d, a), o4 = orientation(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(a, c, b)) return true;
  if (o2 === 0 && onSegment(a, d, b)) return true;
  if (o3 === 0 && onSegment(c, a, d)) return true;
  return o4 === 0 && onSegment(c, b, d);
}
export function normalizePoint(point) { return { x: finite(point?.x, 'Point X'), y: finite(point?.y, 'Point Y') }; }
export function closePolygon(points) {
  const normalized = (points || []).map(normalizePoint);
  if (normalized.length && !samePoint(normalized[0], normalized.at(-1))) normalized.push({ ...normalized[0] });
  return normalized;
}
export function polygonSignedArea(points) {
  const closed = closePolygon(points); let area = 0;
  for (let index = 0; index < closed.length - 1; index += 1) area += closed[index].x * closed[index + 1].y - closed[index + 1].x * closed[index].y;
  return area / 2;
}
export function polygonOrientation(points) { return polygonSignedArea(points) < 0 ? 'clockwise' : 'counter-clockwise'; }
export function pointInPolygon(point, points) {
  const p = normalizePoint(point); const polygon = closePolygon(points); let inside = false;
  for (let i = 0, j = polygon.length - 2; i < polygon.length - 1; j = i++) {
    const a = polygon[i], b = polygon[j];
    const intersects = ((a.y > p.y) !== (b.y > p.y)) && (p.x < ((b.x - a.x) * (p.y - a.y)) / ((b.y - a.y) || GEOMETRY_EPSILON) + a.x);
    if (intersects) inside = !inside;
  }
  return inside;
}
export function validatePolygon(points, { holes = [], requireClosed = true } = {}) {
  const input = (points || []).map(normalizePoint);
  const issues = [];
  if (input.length < 4) issues.push({ code: 'POLYGON_TOO_FEW_POINTS', message: 'Polygon ต้องมีอย่างน้อย 3 จุดและจุดปิด' });
  if (input.length && requireClosed && !samePoint(input[0], input.at(-1))) issues.push({ code: 'POLYGON_NOT_CLOSED', message: 'Polygon ปิดไม่สมบูรณ์' });
  const closed = closePolygon(input);
  for (let i = 0; i < closed.length - 1; i += 1) {
    if (samePoint(closed[i], closed[i + 1])) issues.push({ code: 'ZERO_LENGTH_SEGMENT', message: `Segment ${i + 1} มีความยาวศูนย์` });
  }
  if (Math.abs(polygonSignedArea(closed)) <= GEOMETRY_EPSILON) issues.push({ code: 'ZERO_AREA', message: 'Polygon มีพื้นที่เป็นศูนย์' });
  for (let i = 0; i < closed.length - 1; i += 1) {
    for (let j = i + 1; j < closed.length - 1; j += 1) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === closed.length - 2)) continue;
      if (segmentsIntersect(closed[i], closed[i + 1], closed[j], closed[j + 1])) issues.push({ code: 'SELF_INTERSECTION', message: `Segment ${i + 1} ตัดกับ Segment ${j + 1}` });
    }
  }
  for (const [holeIndex, hole] of holes.entries()) {
    const holeIssues = validatePolygon(hole, { holes: [], requireClosed });
    issues.push(...holeIssues.map((issue) => ({ ...issue, code: `HOLE_${issue.code}`, message: `Hole ${holeIndex + 1}: ${issue.message}` })));
    const first = closePolygon(hole)[0];
    if (first && !pointInPolygon(first, closed)) issues.push({ code: 'HOLE_OUTSIDE_SHAPE', message: `Hole ${holeIndex + 1} อยู่นอก Shape` });
  }
  return { valid: issues.length === 0, issues, area: Math.abs(polygonSignedArea(closed)), orientation: polygonOrientation(closed), points: closed };
}
export function rectangleGeometry(input = {}) {
  const left = finite(input.left, 'Rectangle left'); const top = finite(input.top, 'Rectangle top');
  const width = finite(input.width, 'Rectangle width'); const height = finite(input.height ?? input.length, 'Rectangle height');
  if (width <= GEOMETRY_EPSILON || height <= GEOMETRY_EPSILON) throw new GeometryError('Rectangle ต้องมีขนาดมากกว่า 0', { stage: 'geometry-validation', context: { width, height } });
  return { type: 'rectangle', left, top, width, height, rotation: normalizeRotation(input.rotation || 0), points: [], holes: [] };
}
export function rectangleToPolygon(rectangle) {
  const rect = rectangleGeometry(rectangle); const bottom = rect.top - rect.height; const right = rect.left + rect.width;
  return closePolygon([{ x: rect.left, y: rect.top }, { x: right, y: rect.top }, { x: right, y: bottom }, { x: rect.left, y: bottom }]);
}
export function validateGeometry(geometry) {
  if (geometry?.type === 'polygon') return validatePolygon(geometry.points, { holes: geometry.holes || [] });
  try { const rect = rectangleGeometry(geometry); return { valid: true, issues: [], area: rect.width * rect.height, orientation: 'clockwise', geometry: rect }; }
  catch (error) { return { valid: false, issues: [{ code: 'INVALID_RECTANGLE', message: error.message }], area: 0, orientation: null }; }
}
export function splitRectangle(rectangle, { axis = 'auto', ratio = 0.5 } = {}) {
  const rect = rectangleGeometry(rectangle); const splitRatio = finite(ratio, 'Split ratio');
  if (splitRatio <= GEOMETRY_EPSILON || splitRatio >= 1 - GEOMETRY_EPSILON) throw new GeometryError('Split ratio ต้องอยู่ระหว่าง 0 และ 1', { stage: 'split-land' });
  const resolvedAxis = axis === 'auto' ? (rect.width >= rect.height ? 'x' : 'y') : axis;
  if (resolvedAxis === 'x') {
    const firstWidth = rect.width * splitRatio;
    return [{ ...rect, width: firstWidth }, { ...rect, left: rect.left + firstWidth, width: rect.width - firstWidth }];
  }
  if (resolvedAxis === 'y') {
    const firstHeight = rect.height * splitRatio;
    return [{ ...rect, height: firstHeight }, { ...rect, top: rect.top - firstHeight, height: rect.height - firstHeight }];
  }
  throw new GeometryError(`ไม่รองรับ Split axis ${resolvedAxis}`, { stage: 'split-land' });
}
function rectEdges(rectangle) { const r = rectangleGeometry(rectangle); return { ...r, right: r.left + r.width, bottom: r.top - r.height }; }
export function rectangleIntersection(a, b) {
  const ra = rectEdges(a), rb = rectEdges(b); const left = Math.max(ra.left, rb.left), right = Math.min(ra.right, rb.right), top = Math.min(ra.top, rb.top), bottom = Math.max(ra.bottom, rb.bottom);
  if (right - left <= GEOMETRY_EPSILON || top - bottom <= GEOMETRY_EPSILON) return null;
  return rectangleGeometry({ left, top, width: right - left, height: top - bottom });
}
export function rectangleDifference(subject, cutter) {
  const source = rectEdges(subject); const intersection = rectangleIntersection(source, cutter);
  if (!intersection) return [rectangleGeometry(source)];
  const cut = rectEdges(intersection); const pieces = [];
  if (source.top - cut.top > GEOMETRY_EPSILON) pieces.push(rectangleGeometry({ left: source.left, top: source.top, width: source.width, height: source.top - cut.top }));
  if (cut.bottom - source.bottom > GEOMETRY_EPSILON) pieces.push(rectangleGeometry({ left: source.left, top: cut.bottom, width: source.width, height: cut.bottom - source.bottom }));
  if (cut.left - source.left > GEOMETRY_EPSILON) pieces.push(rectangleGeometry({ left: source.left, top: cut.top, width: cut.left - source.left, height: cut.height }));
  if (source.right - cut.right > GEOMETRY_EPSILON) pieces.push(rectangleGeometry({ left: cut.right, top: cut.top, width: source.right - cut.right, height: cut.height }));
  return pieces;
}
export function rectangleUnionArea(rectangles) {
  const rects = rectangles.map(rectEdges); const xs = [...new Set(rects.flatMap((r) => [r.left, r.right]))].sort((a, b) => a - b); let area = 0;
  for (let i = 0; i < xs.length - 1; i += 1) {
    const x1 = xs[i], x2 = xs[i + 1]; if (x2 - x1 <= GEOMETRY_EPSILON) continue;
    const intervals = rects.filter((r) => r.left < x2 - GEOMETRY_EPSILON && r.right > x1 + GEOMETRY_EPSILON).map((r) => [r.bottom, r.top]).sort((a, b) => a[0] - b[0]);
    let covered = 0, start = null, end = null;
    for (const [low, high] of intervals) { if (start == null) { start = low; end = high; } else if (low <= end + GEOMETRY_EPSILON) end = Math.max(end, high); else { covered += end - start; start = low; end = high; } }
    if (start != null) covered += end - start; area += (x2 - x1) * covered;
  }
  return area;
}
export function mergeRectangles(rectangles) {
  if (!Array.isArray(rectangles) || rectangles.length < 2) throw new GeometryError('Merge ต้องเลือกอย่างน้อย 2 Land', { stage: 'merge-lands' });
  const rects = rectangles.map(rectEdges);
  if (rects.some((rect) => Math.abs(rect.rotation) > GEOMETRY_EPSILON)) throw new GeometryError('Merge รองรับ Rectangle ที่ไม่หมุนเท่านั้นในเวอร์ชันนี้', { stage: 'merge-lands' });
  const left = Math.min(...rects.map((r) => r.left)), right = Math.max(...rects.map((r) => r.right)), top = Math.max(...rects.map((r) => r.top)), bottom = Math.min(...rects.map((r) => r.bottom));
  const bounding = rectangleGeometry({ left, top, width: right - left, height: top - bottom });
  if (Math.abs(rectangleUnionArea(rects) - bounding.width * bounding.height) > GEOMETRY_EPSILON * Math.max(1, bounding.width * bounding.height)) throw new GeometryError('Land ที่เลือกมีช่องว่างหรือผล Union ไม่เป็น Rectangle เดียว', { stage: 'merge-lands' });
  return bounding;
}
export function cloneGeometry(geometry) { return cloneCadValue(geometry); }
