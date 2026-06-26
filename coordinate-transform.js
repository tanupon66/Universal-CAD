const UNIT_TO_MM = Object.freeze({ mm: 1, inch: 25.4, in: 25.4, mil: 0.0254 });
export function normalizeRotation(value) { const n = Number(value); return Number.isFinite(n) ? ((n % 360) + 360) % 360 : 0; }
export function convertUnit(value, from = 'mm', to = 'mm') {
  const n = Number(value); const fromScale = UNIT_TO_MM[String(from).toLowerCase()]; const toScale = UNIT_TO_MM[String(to).toLowerCase()];
  if (!Number.isFinite(n) || !fromScale || !toScale) throw new TypeError(`Unsupported unit conversion ${from} → ${to}`);
  return n * fromScale / toScale;
}
export function identityMatrix() { return [1, 0, 0, 1, 0, 0]; }
export function multiplyMatrix(a, b) {
  return [
    a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
export function translationMatrix(x = 0, y = 0) { return [1, 0, 0, 1, Number(x) || 0, Number(y) || 0]; }
export function rotationMatrix(degrees = 0) { const r = normalizeRotation(degrees) * Math.PI / 180; const c = Math.cos(r), s = Math.sin(r); return [c, s, -s, c, 0, 0]; }
export function scaleMatrix(x = 1, y = x) { return [Number(x), 0, 0, Number(y), 0, 0]; }
export function mirrorMatrix(axis = 'x') { return axis === 'y' ? scaleMatrix(-1, 1) : scaleMatrix(1, -1); }
export function applyMatrix(matrix, point) { return { x: matrix[0] * Number(point.x) + matrix[2] * Number(point.y) + matrix[4], y: matrix[1] * Number(point.x) + matrix[3] * Number(point.y) + matrix[5] }; }
export function invertMatrix(m) {
  const determinant = m[0] * m[3] - m[1] * m[2]; if (Math.abs(determinant) < 1e-14) throw new RangeError('Transformation matrix is not invertible');
  const inv = 1 / determinant;
  return [m[3] * inv, -m[1] * inv, -m[2] * inv, m[0] * inv, (m[2] * m[5] - m[3] * m[4]) * inv, (m[1] * m[4] - m[0] * m[5]) * inv];
}
export function composeTransform({ origin = { x: 0, y: 0 }, position = { x: 0, y: 0 }, rotation = 0, mirror = false, mirrorAxis = 'y', unit = 'mm', outputUnit = 'mm' } = {}) {
  const unitScale = convertUnit(1, unit, outputUnit);
  let matrix = translationMatrix(-Number(origin.x || 0), -Number(origin.y || 0));
  if (mirror) matrix = multiplyMatrix(mirrorMatrix(mirrorAxis), matrix);
  matrix = multiplyMatrix(rotationMatrix(rotation), matrix);
  matrix = multiplyMatrix(scaleMatrix(unitScale), matrix);
  return multiplyMatrix(translationMatrix(convertUnit(position.x || 0, unit, outputUnit), convertUnit(position.y || 0, unit, outputUnit)), matrix);
}
export function bottomSideTransform({ boardWidth = 0, origin = { x: 0, y: 0 }, axis = 'y' } = {}) {
  if (axis === 'y') return multiplyMatrix(translationMatrix(Number(boardWidth) + 2 * Number(origin.x || 0), 0), mirrorMatrix('y'));
  return multiplyMatrix(translationMatrix(0, 2 * Number(origin.y || 0)), mirrorMatrix('x'));
}
export function panelInstanceMatrix(instance = {}, coordinateSystem = {}) {
  const origin = coordinateSystem.origin || { x: 0, y: 0 };
  return composeTransform({ origin, position: instance.position || { x: instance.x || 0, y: instance.y || 0 }, rotation: instance.rotation || 0, mirror: Boolean(instance.mirror), mirrorAxis: instance.mirrorAxis || 'y', unit: coordinateSystem.units || 'mm', outputUnit: coordinateSystem.units || 'mm' });
}
