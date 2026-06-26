const EDITABLE_FIELDS = [
  'componentId', 'globalId', 'cadName', 'left', 'top', 'centerX', 'centerY',
  'width', 'length', 'mapped', 'manual', 'verified', 'confidence', 'anchorLocked',
  'mappingMethod', 'duplicateCadNameCount', 'alias',
];

export function snapshotMapping(mapping) {
  const snapshot = {};
  for (const key of EDITABLE_FIELDS) snapshot[key] = mapping[key] ?? null;
  return snapshot;
}

export function restoreMapping(mapping, snapshot) {
  for (const key of EDITABLE_FIELDS) mapping[key] = snapshot[key];
  return mapping;
}

export function stateForLand(mapping, land, options = {}) {
  const anchorLocked = options.anchorLocked ?? Boolean(mapping.anchorLocked);
  return {
    ...snapshotMapping(mapping),
    componentId: land.componentId,
    globalId: land.globalId,
    cadName: land.cadName,
    left: land.left,
    top: land.top,
    centerX: land.centerX,
    centerY: land.centerY,
    width: land.width,
    length: land.length,
    mapped: true,
    manual: options.manual ?? true,
    verified: options.verified ?? Boolean(anchorLocked),
    confidence: options.confidence ?? (anchorLocked ? 100 : 0),
    anchorLocked,
    mappingMethod: options.mappingMethod || (anchorLocked ? 'manual-direct' : 'manual-unverified'),
    duplicateCadNameCount: options.duplicateCadNameCount ?? mapping.duplicateCadNameCount ?? 1,
  };
}

export function stateForUnmapped(mapping, options = {}) {
  return {
    ...snapshotMapping(mapping),
    globalId: null,
    cadName: '',
    left: null,
    top: null,
    centerX: null,
    centerY: null,
    width: null,
    length: null,
    mapped: false,
    manual: options.manual ?? true,
    verified: false,
    confidence: 0,
    anchorLocked: false,
    mappingMethod: options.mappingMethod || 'manual-unmapped',
    duplicateCadNameCount: 0,
  };
}


function sequenceIndex(mapping) {
  const value = Number(mapping?.rawOrder ?? mapping?.sourceRow ?? mapping?.localIndex);
  return Number.isFinite(value) ? value : null;
}

function rawLabel(mapping) {
  return String(mapping?.rawLandId ?? mapping?.localIndex ?? sequenceIndex(mapping) ?? '—');
}

function landIndexByGlobalId(component) {
  const map = new Map();
  component.lands.forEach((land, index) => map.set(Number(land.globalId), index));
  return map;
}

function normalizeRange(mappings, startLocal, endLocal) {
  const locals = mappings.map(sequenceIndex).filter(Number.isFinite);
  const minimum = locals.length ? Math.min(...locals) : 1;
  const maximum = locals.length ? Math.max(...locals) : 1;
  const hasStart = startLocal !== null && startLocal !== undefined && startLocal !== '' && Number.isFinite(Number(startLocal));
  const hasEnd = endLocal !== null && endLocal !== undefined && endLocal !== '' && Number.isFinite(Number(endLocal));
  let start = hasStart ? Number(startLocal) : minimum;
  let end = hasEnd ? Number(endLocal) : maximum;
  if (start > end) [start, end] = [end, start];
  return { start: Math.max(minimum, start), end: Math.min(maximum, end), minimum, maximum };
}

function directionName(step) { return step > 0 ? 'forward' : 'reverse'; }

/**
 * Safe pattern preview.
 *
 * It never extrapolates before the first anchor or after the last anchor. A segment
 * is valid only when two adjacent anchors prove an exact +1 or -1 CAD sequence:
 * abs(CAD index difference) === X-ray local-index difference.
 */
export function createSequencePreview({ mappings, component, direction = 'auto', userShift = 0, startLocal = null, endLocal = null, preserveAnchors = true }) {
  if (!component || !Array.isArray(component.lands) || !component.lands.length) return { ok: false, error: 'Component นี้ไม่มีข้อมูล Land' };
  if (Number(userShift || 0) !== 0) return { ok: false, error: 'Safe Pattern ไม่อนุญาต Shift เพราะจะทำให้ Anchor ไม่ตรง กรุณาแก้ด้วย Edit Mode' };

  const componentMappings = mappings
    .filter((m) => Number.isFinite(sequenceIndex(m)))
    .sort((a, b) => sequenceIndex(a) - sequenceIndex(b));
  if (!componentMappings.length) return { ok: false, error: 'ไม่พบรายการ X-ray Land ใน Component นี้' };

  const indexByGlobal = landIndexByGlobalId(component);
  const anchors = componentMappings
    .filter((mapping) => mapping.anchorLocked && mapping.mapped && indexByGlobal.has(Number(mapping.globalId)))
    .map((mapping) => ({ mapping, localIndex: sequenceIndex(mapping), rawLabel: rawLabel(mapping), cadIndex: indexByGlobal.get(Number(mapping.globalId)) }))
    .sort((a, b) => a.localIndex - b.localIndex);
  if (anchors.length < 2) return { ok: false, error: 'Safe Pattern ต้องใช้ Anchor ที่ยืนยันแล้วอย่างน้อย 2 จุด' };

  const range = normalizeRange(componentMappings, startLocal, endLocal);
  const segments = [];
  const rejectedSegments = [];
  for (let i = 0; i < anchors.length - 1; i += 1) {
    const a = anchors[i];
    const b = anchors[i + 1];
    const localDelta = b.localIndex - a.localIndex;
    const cadDelta = b.cadIndex - a.cadIndex;
    if (localDelta <= 0 || Math.abs(cadDelta) !== localDelta) {
      rejectedSegments.push({ a, b, reason: `ช่วงลำดับ ${a.localIndex}–${b.localIndex} (${a.rawLabel} → ${b.rawLabel}) ไม่ใช่ลำดับ CAD ต่อเนื่อง` });
      continue;
    }
    const step = Math.sign(cadDelta);
    const segmentDirection = directionName(step);
    if (direction !== 'auto' && direction !== segmentDirection) {
      rejectedSegments.push({ a, b, reason: `ช่วง ${a.rawLabel} → ${b.rawLabel} เป็น ${segmentDirection} ไม่ตรงกับค่าที่เลือก` });
      continue;
    }
    segments.push({ a, b, step, direction: segmentDirection });
  }
  if (!segments.length) return { ok: false, error: 'Anchor ยังไม่พิสูจน์ลำดับต่อเนื่อง ไม่มีช่วงที่ปลอดภัยให้เติมอัตโนมัติ' };

  const mappingByLocal = new Map(componentMappings.map((mapping) => [sequenceIndex(mapping), mapping]));
  const verifiedTargetOwners = new Map();
  for (const mapping of componentMappings) {
    if ((mapping.verified || mapping.anchorLocked) && mapping.mapped && indexByGlobal.has(Number(mapping.globalId))) {
      verifiedTargetOwners.set(indexByGlobal.get(Number(mapping.globalId)), mapping);
    }
  }

  const proposalByLocal = new Map();
  let conflicts = 0;
  for (const segment of segments) {
    const low = Math.max(segment.a.localIndex, range.start);
    const high = Math.min(segment.b.localIndex, range.end);
    for (let localIndex = low; localIndex <= high; localIndex += 1) {
      const mapping = mappingByLocal.get(localIndex);
      if (!mapping) continue;
      const targetIndex = segment.a.cadIndex + segment.step * (localIndex - segment.a.localIndex);
      const land = component.lands[targetIndex] || null;
      const isAnchor = Boolean(mapping.anchorLocked && mapping.mapped);
      let status = isAnchor ? 'anchor' : 'suggested';
      let reason = isAnchor ? 'Anchor ที่ผู้ใช้ยืนยัน' : 'อยู่ระหว่าง Anchor สองจุดและลำดับตรงกันแบบพอดี';

      const verifiedOwner = verifiedTargetOwners.get(targetIndex);
      if (verifiedOwner && verifiedOwner !== mapping) {
        status = 'conflict';
        reason = `ชนกับจุดยืนยัน ${rawLabel(verifiedOwner)}`;
        conflicts += 1;
      }

      const existing = proposalByLocal.get(localIndex);
      if (existing && existing.targetIndex !== targetIndex) {
        existing.status = 'conflict';
        existing.reason = 'Anchor หลายช่วงเสนอคนละตำแหน่ง';
        conflicts += 1;
        continue;
      }
      proposalByLocal.set(localIndex, {
        mapping,
        localIndex,
        targetIndex,
        land,
        status,
        confidence: isAnchor ? 100 : status === 'suggested' ? 96 : 0,
        reason,
      });
    }
  }

  const proposals = [...proposalByLocal.values()].sort((a, b) => a.localIndex - b.localIndex);
  const directions = new Set(segments.map((segment) => segment.direction));
  const resolvedDirection = directions.size === 1 ? [...directions][0] : 'mixed';
  const highConfidence = proposals.filter((p) => p.status === 'suggested' && p.confidence >= 95).length;
  const applicable = proposals.filter((p) => p.land && ['suggested', 'anchor'].includes(p.status)).length;
  const formula = `Safe segment fill: เติมเฉพาะ ${segments.length} ช่วงระหว่าง Anchor ที่ลำดับ CAD ต่อเนื่องตรงกัน 100% และไม่ขยายออกนอก Anchor`;

  return {
    ok: true,
    anchors,
    segments,
    rejectedSegments,
    fit: { maxResidual: 0, segments: segments.length },
    direction: resolvedDirection,
    shift: 0,
    range,
    formula,
    proposals,
    counts: {
      total: proposals.length,
      anchors: anchors.length,
      highConfidence,
      review: 0,
      conflicts,
      outOfRange: 0,
      applicable,
      segments: segments.length,
      rejectedSegments: rejectedSegments.length,
    },
  };
}

export function findLandIndex(component, globalId) {
  return component.lands.findIndex((land) => Number(land.globalId) === Number(globalId));
}

export function getAnchorRange(mappings) {
  const locals = mappings
    .filter((m) => m.anchorLocked && Number.isFinite(sequenceIndex(m)))
    .map(sequenceIndex)
    .sort((a, b) => a - b);
  return locals.length < 2 ? null : { start: locals[0], end: locals[locals.length - 1] };
}
