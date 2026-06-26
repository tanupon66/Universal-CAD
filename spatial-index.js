function key(x, y) { return `${x}:${y}`; }
export class PointSpatialIndex {
  constructor(cellSize = 2) { this.cellSize = Math.max(1e-9, Number(cellSize) || 2); this.cells = new Map(); this.size = 0; }
  cell(value) { return Math.floor(Number(value) / this.cellSize); }
  insert(x, y, value) { if (!Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) return false; const k = key(this.cell(x), this.cell(y)); if (!this.cells.has(k)) this.cells.set(k, []); this.cells.get(k).push({ x: Number(x), y: Number(y), value }); this.size += 1; return true; }
  queryRadius(x, y, radius) { const output = []; const r = Math.max(0, Number(radius) || 0); const minX = this.cell(Number(x) - r), maxX = this.cell(Number(x) + r), minY = this.cell(Number(y) - r), maxY = this.cell(Number(y) + r); const r2 = r * r; for (let cy = minY; cy <= maxY; cy += 1) for (let cx = minX; cx <= maxX; cx += 1) for (const item of this.cells.get(key(cx, cy)) || []) { const dx = item.x - x, dy = item.y - y; if (dx * dx + dy * dy <= r2) output.push(item); } return output; }
  clear() { this.cells.clear(); this.size = 0; }
}
export function buildLandSpatialIndex(components, cellSize = 2) { const index = new PointSpatialIndex(cellSize); for (const component of components || []) for (const land of component.lands || []) index.insert(land.centerX, land.centerY, land); return index; }
