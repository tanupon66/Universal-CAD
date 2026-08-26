import { cloneCadValue } from './universal-cad-model.js';

const text = (value) => String(value ?? '').trim();
const upper = (value) => text(value).toUpperCase();
const finite = (value) => Number.isFinite(Number(value));
const numberOrNull = (value) => finite(value) ? Number(value) : null;

function decodeXml(value = '') {
  return String(value).replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
function attrs(value = '') {
  const output = {}; const re = /([:\w.-]+)\s*=\s*(["'])([\s\S]*?)\2/g; let match;
  while ((match = re.exec(String(value || '')))) output[match[1]] = decodeXml(match[3]);
  return output;
}
function elementRecords(source, localName) {
  const re = new RegExp(`<(?:[A-Za-z_][\\w.-]*:)?${localName}\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/(?:[A-Za-z_][\\w.-]*:)?${localName}>)`, 'gi');
  const rows = []; let match;
  while ((match = re.exec(String(source || '')))) rows.push({ attributes: attrs(match[1]), body: match[2] || '' });
  return rows;
}
function pick(object, keys, fallback = '') { for (const key of keys) if (object?.[key] != null && object[key] !== '') return object[key]; return fallback; }

export function normalizeLayerSide(value = '') {
  const token = upper(value);
  if (/BOTTOM|BOT|BACK/.test(token)) return 'bottom';
  if (/TOP|FRONT/.test(token)) return 'top';
  if (/INNER|INTERNAL|MID/.test(token)) return 'inner';
  return 'unknown';
}

export function normalizeLayerType(value = '') {
  const token = upper(value);
  if (/COPPER|CONDUCTOR|SIGNAL|PLANE/.test(token)) return 'copper';
  if (/MASK/.test(token)) return 'solder-mask';
  if (/PASTE/.test(token)) return 'paste';
  if (/SILK|LEGEND/.test(token)) return 'silkscreen';
  if (/DRILL|HOLE/.test(token)) return 'drill';
  if (/PROFILE|OUTLINE|ROUTE/.test(token)) return 'profile';
  if (/KEEP.?OUT/.test(token)) return 'keepout';
  if (/COMP/.test(token)) return 'component';
  return token ? token.toLowerCase().replace(/\s+/g, '-') : 'other';
}

export function normalizePcbFoundation(input = {}) {
  const layers = (input.layers || []).map((item, index) => ({
    id: text(item.id || item.name || `layer:${index + 1}`),
    name: text(item.name || item.id || `Layer ${index + 1}`),
    side: normalizeLayerSide(item.side || item.context || item.name),
    type: normalizeLayerType(item.type || item.function || item.name),
    order: Number.isFinite(Number(item.order)) ? Number(item.order) : index,
    source: text(item.source || input.sourceFormat || ''),
    metadata: cloneCadValue(item.metadata || {}),
  }));
  const layerIds = new Set(layers.map((item) => item.id));
  const nets = (input.nets || []).map((item, index) => ({
    id: text(item.id || item.name || `net:${index + 1}`),
    name: text(item.name || item.id || `Net ${index + 1}`),
    className: text(item.className || item.class || ''),
    connections: (item.connections || []).map((connection) => ({
      componentRef: text(connection.componentRef || connection.reference || connection.refDes || ''),
      pin: text(connection.pin || connection.pinName || connection.pad || ''),
      landId: text(connection.landId || ''),
      layerId: text(connection.layerId || ''),
    })),
    metadata: cloneCadValue(item.metadata || {}),
  }));
  const vias = (input.vias || []).map((item, index) => ({
    id: text(item.id || `via:${index + 1}`), netId: text(item.netId || item.net || ''), layerId: text(item.layerId || ''),
    x: numberOrNull(item.x), y: numberOrNull(item.y), diameter: numberOrNull(item.diameter || item.size), drill: numberOrNull(item.drill || item.hole),
    metadata: cloneCadValue(item.metadata || {}),
  }));
  const traces = (input.traces || []).map((item, index) => ({
    id: text(item.id || `trace:${index + 1}`), netId: text(item.netId || item.net || ''), layerId: text(item.layerId || ''), width: numberOrNull(item.width),
    points: (item.points || []).filter((point) => finite(point?.x) && finite(point?.y)).map((point) => ({ x: Number(point.x), y: Number(point.y) })),
    metadata: cloneCadValue(item.metadata || {}),
  }));
  const holes = (input.holes || []).map((item, index) => ({
    id: text(item.id || `hole:${index + 1}`), x: numberOrNull(item.x), y: numberOrNull(item.y), diameter: numberOrNull(item.diameter || item.drill),
    plated: item.plated == null ? null : Boolean(item.plated), layerId: text(item.layerId || ''), metadata: cloneCadValue(item.metadata || {}),
  }));
  return {
    sourceFormat: text(input.sourceFormat || ''), layers, nets, vias, traces, holes,
    coverage: { ...(input.coverage || {}), layers: layers.length, nets: nets.length, vias: vias.length, traces: traces.length, holes: holes.length },
    warnings: [...new Set((input.warnings || []).map(text).filter(Boolean))],
    metadata: cloneCadValue(input.metadata || {}),
    layerIds,
  };
}

export function mergeFoundationIntoModel(model, input = {}) {
  if (!model) throw new TypeError('A Universal CAD model is required.');
  const normalized = normalizePcbFoundation(input);
  model.layers = cloneCadValue(normalized.layers);
  model.nets = cloneCadValue(normalized.nets);
  model.vias = cloneCadValue(normalized.vias);
  model.traces = cloneCadValue(normalized.traces);
  if (normalized.holes.length) model.holes = cloneCadValue(normalized.holes);
  else model.holes ||= [];
  model.metadata = { ...(model.metadata || {}), pcbFoundation: { sourceFormat: normalized.sourceFormat, coverage: cloneCadValue(normalized.coverage), warnings: cloneCadValue(normalized.warnings), metadata: cloneCadValue(normalized.metadata) } };
  return model;
}

export function extractIpc2581Foundation(xmlText = '') {
  const source = String(xmlText || '');
  const layers = elementRecords(source, 'Layer').map((record, index) => {
    const a = record.attributes;
    return { id: pick(a, ['id','Id','name','Name'], `layer:${index + 1}`), name: pick(a, ['name','Name','id','Id'], `Layer ${index + 1}`), side: pick(a, ['side','Side','context','Context'], ''), type: pick(a, ['function','Function','type','Type','layerFunction'], ''), order: pick(a, ['sequence','Sequence','order','Order'], index), source: 'ipc-2581', metadata: a };
  });
  const nets = elementRecords(source, 'Net').map((record, index) => {
    const a = record.attributes;
    const refs = [...elementRecords(record.body, 'PinRef'), ...elementRecords(record.body, 'PinReference'), ...elementRecords(record.body, 'Connection')];
    return {
      id: pick(a, ['id','Id','name','Name'], `net:${index + 1}`), name: pick(a, ['name','Name','id','Id'], `Net ${index + 1}`), className: pick(a, ['class','Class','netClass'], ''),
      connections: refs.map((ref) => ({ componentRef: pick(ref.attributes, ['componentRef','ComponentRef','refDes','RefDes','component','Component'], ''), pin: pick(ref.attributes, ['pin','Pin','pinRef','PinRef','name','Name'], ''), landId: pick(ref.attributes, ['landId','LandId'], ''), layerId: pick(ref.attributes, ['layerRef','LayerRef'], '') })),
      metadata: a,
    };
  });
  const vias = elementRecords(source, 'Via').map((record, index) => { const a = record.attributes; return { id: pick(a,['id','Id'],`via:${index + 1}`), netId: pick(a,['net','Net','netRef','NetRef'],''), layerId: pick(a,['layerRef','LayerRef','layer','Layer'],''), x: pick(a,['x','X','posX'],null), y: pick(a,['y','Y','posY'],null), diameter: pick(a,['diameter','Diameter','size'],null), drill: pick(a,['drill','Drill','holeDiameter'],null), metadata:a }; });
  const holes = [...elementRecords(source, 'Hole'), ...elementRecords(source, 'Drill')].map((record, index) => { const a = record.attributes; return { id: pick(a,['id','Id'],`hole:${index + 1}`), x: pick(a,['x','X','posX'],null), y: pick(a,['y','Y','posY'],null), diameter: pick(a,['diameter','Diameter','drill','Drill'],null), plated: /^(?:1|true|yes|plated)$/i.test(pick(a,['plated','Plated'],'')), layerId: pick(a,['layerRef','LayerRef'],''), metadata:a }; });
  const traces = [...elementRecords(source, 'Trace'), ...elementRecords(source, 'Line')].slice(0, 100000).map((record, index) => { const a=record.attributes; const x1=pick(a,['x1','X1'],null), y1=pick(a,['y1','Y1'],null), x2=pick(a,['x2','X2'],null), y2=pick(a,['y2','Y2'],null); const points=[]; if(finite(x1)&&finite(y1))points.push({x:Number(x1),y:Number(y1)}); if(finite(x2)&&finite(y2))points.push({x:Number(x2),y:Number(y2)}); return { id:pick(a,['id','Id'],`trace:${index+1}`), netId:pick(a,['net','Net','netRef','NetRef'],''), layerId:pick(a,['layerRef','LayerRef','layer','Layer'],''), width:pick(a,['width','Width'],null), points, metadata:a }; }).filter((item)=>item.points.length>=2 || item.netId || item.layerId);
  return normalizePcbFoundation({ sourceFormat: 'ipc-2581', layers, nets, vias, traces, holes, metadata: { parser: 'ipc-2581-foundation-v1' } });
}

export function extractOdbFoundation(files = []) {
  const normalizedPaths = (files || []).map((file) => String(file.path || '').replace(/\\/g, '/'));
  const layerNames = [];
  for (const path of normalizedPaths) {
    const match = path.match(/(?:^|\/)layers\/([^/]+)/i);
    if (match && !layerNames.some((value) => value.toLowerCase() === match[1].toLowerCase())) layerNames.push(match[1]);
  }
  const layers = layerNames.map((name, index) => ({ id: `odb-layer:${name}`, name, side: normalizeLayerSide(name), type: normalizeLayerType(name), order: index, source: 'odb++' }));
  const nets = [];
  const seen = new Set();
  for (const file of files || []) {
    if (!/(?:^|\/)eda\/data(?:\.z)?$/i.test(String(file.path || ''))) continue;
    const source = new TextDecoder().decode(file.bytes || new Uint8Array());
    for (const raw of source.split(/\r?\n/)) {
      const line = raw.trim();
      const match = line.match(/^NET\s+(\S+)(?:\s+(.+?))?(?:\s*;.*)?$/i);
      if (!match) continue;
      const id = text(match[1]); const name = text(match[2] || match[1]).replace(/^['"]|['"]$/g, '');
      const key = `${id}\u0000${name}`; if (seen.has(key)) continue; seen.add(key);
      nets.push({ id: `odb-net:${id}`, name, metadata: { sourceRecord: line.slice(0, 240) } });
      if (nets.length >= 250000) break;
    }
  }
  return normalizePcbFoundation({ sourceFormat: 'odb++', layers, nets, metadata: { parser: 'odb-foundation-v1', sourceFiles: normalizedPaths } });
}

export function validatePcbFoundation(model = {}) {
  const issues = [];
  const layerIds = new Set((model.layers || []).map((item) => text(item.id)).filter(Boolean));
  const componentRefs = new Set((model.components || []).map((item) => upper(item.reference)).filter(Boolean));
  const netIds = new Set();
  for (const net of model.nets || []) {
    const id = text(net.id || net.name);
    if (!id) issues.push({ level: 'error', code: 'NET_ID_EMPTY', message: 'A net has no identifier.' });
    else if (netIds.has(id)) issues.push({ level: 'warning', code: 'NET_ID_DUPLICATE', message: `Duplicate net identifier ${id}.`, netId: id });
    else netIds.add(id);
    for (const connection of net.connections || []) {
      if (connection.componentRef && !componentRefs.has(upper(connection.componentRef))) issues.push({ level: 'warning', code: 'NET_COMPONENT_UNKNOWN', message: `${net.name || id} references unknown component ${connection.componentRef}.`, netId: id, componentRef: connection.componentRef });
      if (connection.layerId && layerIds.size && !layerIds.has(text(connection.layerId))) issues.push({ level: 'warning', code: 'NET_LAYER_UNKNOWN', message: `${net.name || id} references unknown layer ${connection.layerId}.`, netId: id, layerId: connection.layerId });
    }
  }
  for (const item of [...(model.vias || []), ...(model.traces || [])]) if (item.layerId && layerIds.size && !layerIds.has(text(item.layerId))) issues.push({ level: 'warning', code: 'PCB_OBJECT_LAYER_UNKNOWN', message: `${item.id} references unknown layer ${item.layerId}.`, objectId: item.id, layerId: item.layerId });
  return { issues, counts: { layers: model.layers?.length || 0, nets: model.nets?.length || 0, vias: model.vias?.length || 0, traces: model.traces?.length || 0, holes: model.holes?.length || 0 }, valid: !issues.some((item) => item.level === 'error') };
}

export function buildLayerSummary(model = {}) {
  const counts = new Map();
  const touch = (layerId, kind) => { if (!layerId) return; if (!counts.has(layerId)) counts.set(layerId, { lands:0,vias:0,traces:0,holes:0 }); counts.get(layerId)[kind] += 1; };
  for (const land of model.lands || []) touch(land.layerId, 'lands');
  for (const via of model.vias || []) touch(via.layerId, 'vias');
  for (const trace of model.traces || []) touch(trace.layerId, 'traces');
  for (const hole of model.holes || []) touch(hole.layerId, 'holes');
  return (model.layers || []).map((layer) => ({ ...cloneCadValue(layer), counts: counts.get(text(layer.id)) || { lands:0,vias:0,traces:0,holes:0 } })).sort((a,b)=>Number(a.order||0)-Number(b.order||0));
}

export function buildNetSummary(model = {}) {
  const viaCounts = new Map(); const traceCounts = new Map();
  for (const via of model.vias || []) { const key=text(via.netId); if(key)viaCounts.set(key,(viaCounts.get(key)||0)+1); }
  for (const trace of model.traces || []) { const key=text(trace.netId); if(key)traceCounts.set(key,(traceCounts.get(key)||0)+1); }
  return (model.nets || []).map((net) => ({ ...cloneCadValue(net), connectionCount: net.connections?.length || 0, viaCount: viaCounts.get(text(net.id)) || viaCounts.get(text(net.name)) || 0, traceCount: traceCounts.get(text(net.id)) || traceCounts.get(text(net.name)) || 0 })).sort((a,b)=>String(a.name).localeCompare(String(b.name), undefined, { numeric:true }));
}

export function buildCrossProbeIndex(model = {}) {
  const rows = [];
  for (const component of model.components || []) rows.push({ type:'component', key:upper(component.reference), label:text(component.reference), componentId:text(component.id), packageId:text(component.packageId) });
  const componentById = new Map((model.components || []).map((component)=>[text(component.id),component]));
  for (const land of model.lands || []) { const component=componentById.get(text(land.componentId)); rows.push({ type:'land', key:upper(`${component?.reference || ''} ${land.name || ''}`), label:`${component?.reference || land.componentId} / ${land.name || land.id}`, componentId:text(land.componentId), landId:text(land.id), netId:text(land.netId), layerId:text(land.layerId) }); }
  for (const net of model.nets || []) rows.push({ type:'net', key:upper(net.name || net.id), label:text(net.name || net.id), netId:text(net.id), connections:cloneCadValue(net.connections || []) });
  for (const layer of model.layers || []) rows.push({ type:'layer', key:upper(layer.name || layer.id), label:text(layer.name || layer.id), layerId:text(layer.id) });
  return rows;
}

export function queryCrossProbe(model = {}, query = '', { limit = 80 } = {}) {
  const needle = upper(query); if (!needle) return [];
  return buildCrossProbeIndex(model).filter((row)=>row.key.includes(needle) || upper(row.label).includes(needle)).slice(0, Math.max(1, Number(limit)||80));
}
