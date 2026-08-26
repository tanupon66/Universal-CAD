const finite = (v) => Number.isFinite(Number(v));
const EPS = 1e-9;
const point = (p) => ({ x: Number(p?.x), y: Number(p?.y) });

export function polygonSignedArea(points = []) {
  const p = points.map(point).filter((v) => finite(v.x) && finite(v.y));
  if (p.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < p.length; i += 1) { const a = p[i], b = p[(i + 1) % p.length]; area += a.x * b.y - b.x * a.y; }
  return area / 2;
}
export const polygonArea = (points = []) => Math.abs(polygonSignedArea(points));
export const polygonOrientation = (points = []) => polygonSignedArea(points) < 0 ? 'clockwise' : 'counter-clockwise';

export function normalizePolygon(points = [], options = {}) {
  const tolerance = Number(options.tolerance || 1e-7);
  const out = [];
  for (const raw of points || []) {
    const p = point(raw); if (!finite(p.x) || !finite(p.y)) continue;
    const last = out[out.length - 1]; if (last && Math.hypot(last.x - p.x, last.y - p.y) <= tolerance) continue;
    out.push(p);
  }
  if (out.length > 1 && Math.hypot(out[0].x - out.at(-1).x, out[0].y - out.at(-1).y) <= tolerance) out.pop();
  if (options.orientation) {
    const current = polygonOrientation(out);
    if (current !== options.orientation) out.reverse();
  }
  return out;
}

function cross(a,b,c) { return (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x); }
function segmentsIntersect(a,b,c,d) {
  const ab1=cross(a,b,c), ab2=cross(a,b,d), cd1=cross(c,d,a), cd2=cross(c,d,b);
  return ((ab1 > EPS && ab2 < -EPS) || (ab1 < -EPS && ab2 > EPS)) && ((cd1 > EPS && cd2 < -EPS) || (cd1 < -EPS && cd2 > EPS));
}
export function polygonSelfIntersections(points = []) {
  const p = normalizePolygon(points); const hits=[]; const n=p.length;
  for(let i=0;i<n;i++) for(let j=i+1;j<n;j++) {
    if (j===i || j===(i+1)%n || i===(j+1)%n) continue;
    if (i===0 && j===n-1) continue;
    if (segmentsIntersect(p[i],p[(i+1)%n],p[j],p[(j+1)%n])) hits.push({segmentA:i,segmentB:j});
  }
  return hits;
}

export function validatePolygon2(points = [], options = {}) {
  const normalized = normalizePolygon(points, options); const issues=[];
  if (normalized.length < 3) issues.push({code:'POLYGON_TOO_FEW_POINTS',level:'blocking',message:'Polygon needs at least three unique points.'});
  if (polygonArea(normalized) <= Number(options.minArea || EPS)) issues.push({code:'POLYGON_ZERO_AREA',level:'blocking',message:'Polygon area is zero or below tolerance.'});
  const self = polygonSelfIntersections(normalized); if (self.length) issues.push({code:'POLYGON_SELF_INTERSECTION',level:'blocking',message:`Polygon has ${self.length} self-intersection(s).`,context:{intersections:self}});
  return { valid: !issues.some((i)=>i.level==='blocking'), points: normalized, area: polygonArea(normalized), orientation: normalized.length>=3?polygonOrientation(normalized):null, issues };
}

export function polygonBounds(points = []) {
  const p=normalizePolygon(points); if(!p.length)return null; const xs=p.map(v=>v.x),ys=p.map(v=>v.y); return {minX:Math.min(...xs),minY:Math.min(...ys),maxX:Math.max(...xs),maxY:Math.max(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)};
}

export function snapPoints(points = [], grid = 0.001) {
  const step=Math.abs(Number(grid))||0.001; return normalizePolygon(points).map((p)=>({x:Math.round(p.x/step)*step,y:Math.round(p.y/step)*step}));
}

export function alignPoints(points = [], mode = 'center-x') {
  const p=normalizePolygon(points); if(!p.length)return []; const b=polygonBounds(p); const cx=(b.minX+b.maxX)/2,cy=(b.minY+b.maxY)/2;
  return p.map((v)=> mode==='center-x'?{x:cx,y:v.y}:mode==='center-y'?{x:v.x,y:cy}:mode==='min-x'?{x:b.minX,y:v.y}:mode==='min-y'?{x:v.x,y:b.minY}:mode==='max-x'?{x:b.maxX,y:v.y}:mode==='max-y'?{x:v.x,y:b.maxY}:{...v});
}

export function offsetRectangleGeometry(geometry = {}, offset = 0) {
  const d=Number(offset)||0; const left=Number(geometry.left),top=Number(geometry.top),width=Number(geometry.width),height=Number(geometry.height);
  if (![left,top,width,height].every(finite)) throw new TypeError('Rectangle geometry must contain finite left/top/width/height values.');
  const next={...geometry,left:left-d,top:top+d,width:width+d*2,height:height+d*2};
  if(next.width<=0||next.height<=0)throw new RangeError('Offset collapses the rectangle.'); return next;
}
