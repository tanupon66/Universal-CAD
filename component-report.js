function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

export function componentBounds(component) {
  if (component?.bounds && [component.bounds.minX, component.bounds.maxX, component.bounds.minY, component.bounds.maxY].every(Number.isFinite)) return { ...component.bounds };
  const xs = (component?.lands || []).map((land) => Number(land.centerX)).filter(Number.isFinite);
  const ys = (component?.lands || []).map((land) => Number(land.centerY)).filter(Number.isFinite);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

export function buildZones(component, rows, grid = 3) {
  const bounds = componentBounds(component);
  const width = Math.max(1e-9, bounds.maxX - bounds.minX);
  const height = Math.max(1e-9, bounds.maxY - bounds.minY);
  const zones = [];
  for (let row = 0; row < grid; row += 1) {
    for (let col = 0; col < grid; col += 1) {
      const minX = bounds.minX + (col / grid) * width;
      const maxX = bounds.minX + ((col + 1) / grid) * width;
      const maxY = bounds.maxY - (row / grid) * height;
      const minY = bounds.maxY - ((row + 1) / grid) * height;
      zones.push({ label: `${String.fromCharCode(65 + row)}${col + 1}`, row, col, bounds: { minX, maxX, minY, maxY }, rows: [] });
    }
  }
  for (const item of rows) {
    const x = Number(item.centerX); const y = Number(item.centerY);
    const col = clamp(Math.floor(((x - bounds.minX) / width) * grid), 0, grid - 1);
    const row = clamp(Math.floor(((bounds.maxY - y) / height) * grid), 0, grid - 1);
    const zone = zones[row * grid + col];
    item.zone = zone.label;
    zone.rows.push(item);
  }
  return { bounds, zones };
}

function canvas(width, height) {
  const el = document.createElement('canvas');
  el.width = Math.max(1, Math.round(width)); el.height = Math.max(1, Math.round(height));
  return el;
}

function heatColor(value, min, max) {
  if (!Number.isFinite(Number(value))) return '#8ba2b8';
  const ratio = max > min ? clamp((Number(value) - min) / (max - min), 0, 1) : 0.5;
  return `hsl(${210 - ratio * 190} 76% 53%)`;
}

function drawingTransform(bounds, width, height, header = 92, footer = 48) {
  const margin = 70;
  const spanX = Math.max(1e-9, bounds.maxX - bounds.minX);
  const spanY = Math.max(1e-9, bounds.maxY - bounds.minY);
  const usableW = width - margin * 2;
  const usableH = height - header - footer - margin;
  const scale = Math.min(usableW / spanX, usableH / spanY);
  const plotW = spanX * scale; const plotH = spanY * scale;
  const left = (width - plotW) / 2; const top = header + (usableH - plotH) / 2;
  return {
    scale, left, top, plotW, plotH,
    point(x, y) { return { x: left + (x - bounds.minX) * scale, y: top + (bounds.maxY - y) * scale }; },
  };
}

function drawHeader(ctx, width, title, subtitle) {
  ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, width, 78);
  ctx.fillStyle = '#ffffff'; ctx.font = '700 30px Arial, sans-serif'; ctx.textBaseline = 'middle'; ctx.fillText(title, 32, 31);
  ctx.fillStyle = '#b8c7dc'; ctx.font = '15px Arial, sans-serif'; ctx.fillText(subtitle, 32, 59);
}

function drawAxis(ctx, transform, bounds) {
  ctx.save();
  ctx.strokeStyle = '#64748b'; ctx.lineWidth = 2; ctx.strokeRect(transform.left, transform.top, transform.plotW, transform.plotH);
  ctx.font = '12px Arial, sans-serif'; ctx.fillStyle = '#475569'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let i = 0; i <= 5; i += 1) {
    const x = transform.left + (i / 5) * transform.plotW;
    const value = bounds.minX + (i / 5) * (bounds.maxX - bounds.minX);
    ctx.beginPath(); ctx.moveTo(x, transform.top + transform.plotH); ctx.lineTo(x, transform.top + transform.plotH + 8); ctx.stroke(); ctx.fillText(value.toFixed(3), x, transform.top + transform.plotH + 11);
  }
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let i = 0; i <= 5; i += 1) {
    const y = transform.top + (i / 5) * transform.plotH;
    const value = bounds.maxY - (i / 5) * (bounds.maxY - bounds.minY);
    ctx.beginPath(); ctx.moveTo(transform.left - 8, y); ctx.lineTo(transform.left, y); ctx.stroke(); ctx.fillText(value.toFixed(3), transform.left - 11, y);
  }
  ctx.restore();
}

export function renderOverviewImage({ component, rows, bounds, zones, width = 2200, height = 1450, heatmap = true }) {
  const el = canvas(width, height); const ctx = el.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height);
  drawHeader(ctx, width, `${component.name} · Component Overview`, `${component.packageName || 'Unknown package'} · ${rows.length.toLocaleString()} lands · ${zones.length} zones`);
  const transform = drawingTransform(bounds, width, height);
  drawAxis(ctx, transform, bounds);
  const measurements = rows.map((item) => Number(item.measurement)).filter(Number.isFinite);
  const min = measurements.length ? Math.min(...measurements) : 0; const max = measurements.length ? Math.max(...measurements) : 1;
  const approximatePitch = Math.sqrt((transform.plotW * transform.plotH) / Math.max(1, rows.length));
  const radius = clamp(approximatePitch * 0.20, 1.5, 7);
  for (const item of rows) {
    const point = transform.point(Number(item.centerX), Number(item.centerY));
    ctx.beginPath(); ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = heatmap ? heatColor(item.measurement, min, max) : '#3984c6'; ctx.fill();
    if (item.confirmed) { ctx.strokeStyle = '#0f9d58'; ctx.lineWidth = 1.5; ctx.stroke(); }
    if (item.duplicateCount > 1) { ctx.beginPath(); ctx.arc(point.x, point.y, radius + 2.5, 0, Math.PI * 2); ctx.strokeStyle = '#e11d48'; ctx.lineWidth = 1.2; ctx.stroke(); }
  }
  const grid = Math.round(Math.sqrt(zones.length));
  ctx.save(); ctx.strokeStyle = 'rgba(15,118,110,.70)'; ctx.lineWidth = 2; ctx.setLineDash([10, 7]);
  for (let i = 1; i < grid; i += 1) {
    const x = transform.left + (i / grid) * transform.plotW; ctx.beginPath(); ctx.moveTo(x, transform.top); ctx.lineTo(x, transform.top + transform.plotH); ctx.stroke();
    const y = transform.top + (i / grid) * transform.plotH; ctx.beginPath(); ctx.moveTo(transform.left, y); ctx.lineTo(transform.left + transform.plotW, y); ctx.stroke();
  }
  ctx.setLineDash([]); ctx.font = '700 28px Arial, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  for (const zone of zones) {
    const x = transform.left + (zone.col / grid) * transform.plotW + 12;
    const y = transform.top + (zone.row / grid) * transform.plotH + 10;
    ctx.fillStyle = 'rgba(255,255,255,.88)'; ctx.fillRect(x - 6, y - 5, 64, 39); ctx.fillStyle = '#0f766e'; ctx.fillText(zone.label, x, y);
  }
  ctx.restore();
  ctx.fillStyle = '#64748b'; ctx.font = '14px Arial, sans-serif'; ctx.textAlign = 'left'; ctx.fillText('วงสีเขียว = Confirmed · วงสีแดง = ชื่อ CAD ซ้ำ · สีจุด = Measurement ต่ำไปสูง', 30, height - 18);
  return el;
}

export function renderZoneImage({ component, zone, width = 2200, height = 1450, labels = 'both', heatmap = true }) {
  const el = canvas(width, height); const ctx = el.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height);
  drawHeader(ctx, width, `${component.name} · Zone ${zone.label}`, `${zone.rows.length.toLocaleString()} lands · X ${zone.bounds.minX.toFixed(4)}–${zone.bounds.maxX.toFixed(4)} · Y ${zone.bounds.minY.toFixed(4)}–${zone.bounds.maxY.toFixed(4)}`);
  const padX = Math.max(0.0005, (zone.bounds.maxX - zone.bounds.minX) * 0.04);
  const padY = Math.max(0.0005, (zone.bounds.maxY - zone.bounds.minY) * 0.04);
  const bounds = { minX: zone.bounds.minX - padX, maxX: zone.bounds.maxX + padX, minY: zone.bounds.minY - padY, maxY: zone.bounds.maxY + padY };
  const transform = drawingTransform(bounds, width, height, 92, 58);
  drawAxis(ctx, transform, zone.bounds);
  const measurements = zone.rows.map((item) => Number(item.measurement)).filter(Number.isFinite);
  const min = measurements.length ? Math.min(...measurements) : 0; const max = measurements.length ? Math.max(...measurements) : 1;
  const approximatePitch = Math.sqrt((transform.plotW * transform.plotH) / Math.max(1, zone.rows.length));
  const radius = clamp(approximatePitch * 0.16, 3, 14);
  const fontSize = clamp(approximatePitch * 0.18, 8, 19);
  ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.font = `600 ${fontSize}px Arial, sans-serif`;
  for (const item of zone.rows) {
    const point = transform.point(Number(item.centerX), Number(item.centerY));
    ctx.beginPath(); ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = heatmap ? heatColor(item.measurement, min, max) : '#3984c6'; ctx.fill();
    if (item.confirmed) { ctx.strokeStyle = '#0f9d58'; ctx.lineWidth = 2; ctx.stroke(); }
    if (item.duplicateCount > 1) { ctx.beginPath(); ctx.arc(point.x, point.y, radius + 3, 0, Math.PI * 2); ctx.strokeStyle = '#e11d48'; ctx.lineWidth = 1.5; ctx.stroke(); }
    let label = '';
    if (labels === 'cad') label = item.cadName || '';
    else if (labels === 'xray') label = item.xrayLand == null ? '' : String(item.xrayLand);
    else if (labels === 'both') label = `${item.cadName || '—'}${item.xrayLand == null ? '' : `\n#${item.xrayLand}`}`;
    if (label && approximatePitch >= 18) {
      const lines = label.split('\n');
      ctx.fillStyle = '#0f172a';
      lines.forEach((line, index) => ctx.fillText(line, point.x, point.y + radius + 3 + index * (fontSize + 1)));
    }
  }
  ctx.fillStyle = '#64748b'; ctx.font = '14px Arial, sans-serif'; ctx.textAlign = 'left'; ctx.fillText('ชื่อ/หมายเลขอยู่ใต้ Land · ดูรายละเอียดครบทุกจุดในตารางด้านล่างของชีต', 30, height - 18);
  return el;
}

export function histogramModel(values, requestedBins = 50) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return { bins: [], stats: { count: 0, min: null, average: null, median: null, max: null } };
  const min = sorted[0]; const max = sorted[sorted.length - 1]; const binsCount = max === min ? 1 : Math.max(5, Math.min(200, requestedBins));
  const width = (max - min) / binsCount || 1;
  const bins = Array.from({ length: binsCount }, (_, index) => ({ index, low: min + index * width, high: index === binsCount - 1 ? max : min + (index + 1) * width, count: 0 }));
  for (const value of sorted) bins[Math.min(bins.length - 1, Math.floor((value - min) / width))].count += 1;
  let cumulative = 0;
  for (const bin of bins) { cumulative += bin.count; bin.cumulative = cumulative; bin.percent = (bin.count / sorted.length) * 100; bin.cumulativePercent = (cumulative / sorted.length) * 100; }
  const average = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const middle = Math.floor(sorted.length / 2); const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return { bins, stats: { count: sorted.length, min, average, median, max } };
}

export function renderHistogramImage(componentName, model, width = 1600, height = 760) {
  if (!model.bins.length) return null;
  const el = canvas(width, height); const ctx = el.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height);
  drawHeader(ctx, width, `${componentName} · Measurement Histogram`, `${model.stats.count.toLocaleString()} values · Min ${model.stats.min} · Average ${model.stats.average.toFixed(3)} · Max ${model.stats.max}`);
  const margin = { left: 90, right: 45, top: 115, bottom: 90 };
  const chartW = width - margin.left - margin.right; const chartH = height - margin.top - margin.bottom;
  const peak = Math.max(1, ...model.bins.map((bin) => bin.count)); const slot = chartW / model.bins.length;
  ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(margin.left, margin.top); ctx.lineTo(margin.left, margin.top + chartH); ctx.lineTo(margin.left + chartW, margin.top + chartH); ctx.stroke();
  model.bins.forEach((bin, index) => {
    const h = (bin.count / peak) * chartH; const x = margin.left + index * slot + 1; const y = margin.top + chartH - h;
    ctx.fillStyle = '#0f766e'; ctx.fillRect(x, y, Math.max(1, slot - 2), h);
  });
  ctx.fillStyle = '#475569'; ctx.font = '14px Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let i = 0; i <= 5; i += 1) { const ratio = i / 5; const x = margin.left + ratio * chartW; const value = model.stats.min + ratio * (model.stats.max - model.stats.min); ctx.fillText(value.toFixed(2), x, margin.top + chartH + 14); }
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let i = 0; i <= 5; i += 1) { const ratio = i / 5; const y = margin.top + chartH - ratio * chartH; ctx.fillText(Math.round(ratio * peak).toLocaleString(), margin.left - 14, y); }
  return el;
}

export async function canvasToPngBytes(el) {
  const blob = await new Promise((resolve, reject) => el.toBlob((value) => value ? resolve(value) : reject(new Error('ไม่สามารถสร้างภาพ PNG ได้')), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}
