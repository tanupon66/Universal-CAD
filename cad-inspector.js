export function cadLandKey(componentId, globalId) {
  return `${String(componentId ?? '')}\u0000${String(globalId ?? '')}`;
}

export function normalizeCadName(value) {
  return String(value ?? '').trim();
}

function comparisonKey(value) {
  return normalizeCadName(value).toUpperCase();
}

function nameLength(value) {
  return [...normalizeCadName(value)].length;
}

function selectedComponents(xmlData, componentIds = null) {
  if (!xmlData?.components) return [];
  if (!componentIds) return xmlData.components;
  const allowed = componentIds instanceof Set ? componentIds : new Set(componentIds.map(String));
  return xmlData.components.filter((component) => allowed.has(String(component.id)));
}

export function buildCadNameAudit(xmlData, renames = new Map(), options = {}) {
  const maxLength = Math.max(1, Number(options.maxLength) || 5);
  const components = selectedComponents(xmlData, options.componentIds ?? null);
  const items = [];
  let duplicateGroups = 0;

  for (const component of components) {
    const componentItems = (component.lands || []).map((land) => {
      const key = cadLandKey(component.id, land.globalId);
      const originalName = normalizeCadName(land.originalCadName ?? land.cadName);
      const proposedName = normalizeCadName(renames.has(key) ? renames.get(key) : originalName);
      return {
        key,
        componentId: String(component.id),
        componentName: component.name || `ID ${component.id}`,
        packageName: component.packageName || '',
        globalId: land.globalId,
        localIndex: land.localIndex,
        centerX: land.centerX,
        centerY: land.centerY,
        originalName,
        proposedName,
        changed: proposedName !== originalName,
      };
    });

    const counts = new Map();
    for (const item of componentItems) {
      const key = comparisonKey(item.proposedName);
      if (!key) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    duplicateGroups += [...counts.values()].filter((count) => count > 1).length;

    for (const item of componentItems) {
      const normalized = comparisonKey(item.proposedName);
      const issues = [];
      if (!item.proposedName) issues.push('blank');
      if (nameLength(item.proposedName) > maxLength) issues.push('too-long');
      if (normalized && (counts.get(normalized) || 0) > 1) issues.push('duplicate');
      item.length = nameLength(item.proposedName);
      item.issues = issues;
      item.valid = issues.length === 0;
      items.push(item);
    }
  }

  const summary = {
    components: components.length,
    total: items.length,
    valid: items.filter((item) => item.valid).length,
    unresolved: items.filter((item) => !item.valid).length,
    duplicateGroups,
    duplicateLands: items.filter((item) => item.issues.includes('duplicate')).length,
    tooLong: items.filter((item) => item.issues.includes('too-long')).length,
    blank: items.filter((item) => item.issues.includes('blank')).length,
    changed: items.filter((item) => item.changed).length,
    maxLength,
  };

  return { items, summary };
}

function sanitizePrefix(prefix, maxLength) {
  const cleaned = String(prefix ?? 'L').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const fallback = 'L';
  const value = cleaned || fallback;
  return value.slice(0, Math.max(0, maxLength - 1));
}

export function truncateCadName(value, maxLength = 5, overflowMode = 'keep-start') {
  const chars = [...normalizeCadName(value)];
  const limit = Math.max(1, Number(maxLength) || 5);
  if (chars.length <= limit) return chars.join('');
  if (overflowMode === 'keep-end') return chars.slice(-limit).join('');
  if (overflowMode === 'regenerate') return '';
  return chars.slice(0, limit).join('');
}

function generateName(reserved, counterRef, prefix, maxLength) {
  const safePrefix = sanitizePrefix(prefix, maxLength);
  const width = maxLength - safePrefix.length;
  if (width < 1) throw new Error('Prefix ต้องสั้นกว่าความยาวชื่อสูงสุดอย่างน้อย 1 ตัวอักษร');
  const capacity = (36 ** width) - 1;
  while (counterRef.value <= capacity) {
    const suffix = counterRef.value.toString(36).toUpperCase().padStart(width, '0');
    counterRef.value += 1;
    const candidate = `${safePrefix}${suffix}`;
    if (!reserved.has(comparisonKey(candidate))) {
      reserved.add(comparisonKey(candidate));
      return candidate;
    }
  }
  throw new Error(`สร้างชื่อไม่พอภายใต้ข้อจำกัด ${maxLength} ตัวอักษร กรุณาลด Prefix หรือเพิ่มความยาว`);
}

function generateA1Name(reserved, counterRef, maxLength) {
  while (counterRef.value < 1000000000) {
    const candidate = `A${counterRef.value}`;
    counterRef.value += 1;
    if (nameLength(candidate) > maxLength) {
      throw new Error(`ชื่อแบบ A1 เกินข้อจำกัด ${maxLength} ตัวอักษร กรุณาเพิ่มความยาวชื่อสูงสุด`);
    }
    if (!reserved.has(comparisonKey(candidate))) {
      reserved.add(comparisonKey(candidate));
      return candidate;
    }
  }
  throw new Error('ไม่สามารถสร้างชื่อ Land แบบ A1 ได้');
}

function firstReplacementCharacter(value) {
  return [...String(value ?? '_')][0] || '_';
}

function numericSuffixCandidate(baseName, sequence, maxLength, overflowMode) {
  const suffix = String(sequence);
  const limit = Math.max(1, Number(maxLength) || 5);
  if ([...suffix].length >= limit) return [...suffix].slice(-limit).join('');
  const room = limit - [...suffix].length;
  const base = [...normalizeCadName(baseName)];
  const body = overflowMode === 'keep-end' ? base.slice(-room) : base.slice(0, room);
  return `${body.join('')}${suffix}`;
}

function replacementCandidate(baseName, character, sequence, maxLength, overflowMode) {
  const chars = [...normalizeCadName(baseName)];
  const token = firstReplacementCharacter(character);
  let index = -1;
  for (let i = chars.length - 1; i >= 0; i -= 1) {
    if (chars[i] === token) { index = i; break; }
  }
  if (index < 0) return numericSuffixCandidate(baseName, sequence, maxLength, overflowMode);

  const replacement = [...String(sequence)];
  const limit = Math.max(1, Number(maxLength) || 5);
  if (replacement.length >= limit) return replacement.slice(-limit).join('');
  const available = limit - replacement.length;
  const left = chars.slice(0, index);
  const right = chars.slice(index + 1);
  let leftKeep;
  let rightKeep;
  if (overflowMode === 'keep-end') {
    rightKeep = Math.min(right.length, available);
    leftKeep = available - rightKeep;
    const keptLeft = leftKeep ? left.slice(-leftKeep) : [];
    const keptRight = rightKeep ? right.slice(-rightKeep) : [];
    return `${keptLeft.join('')}${replacement.join('')}${keptRight.join('')}`;
  }
  leftKeep = Math.min(left.length, available);
  rightKeep = available - leftKeep;
  return `${left.slice(0, leftKeep).join('')}${replacement.join('')}${right.slice(0, rightKeep).join('')}`;
}

function makeUniqueCandidate(baseName, reserved, counters, options, a1Counter) {
  const key = comparisonKey(baseName) || '__BLANK__';
  if (options.duplicateMode === 'regenerate' || !baseName) {
    return generateA1Name(reserved, a1Counter, options.maxLength);
  }

  let sequence = counters.get(key) || 1;
  while (sequence < 1000000000) {
    const candidate = options.duplicateMode === 'replace-character'
      ? replacementCandidate(baseName, options.duplicateCharacter, sequence, options.maxLength, options.overflowMode)
      : numericSuffixCandidate(baseName, sequence, options.maxLength, options.overflowMode);
    sequence += 1;
    counters.set(key, sequence);
    if (!candidate) continue;
    const normalized = comparisonKey(candidate);
    if (!reserved.has(normalized)) {
      reserved.add(normalized);
      return candidate;
    }
  }
  throw new Error(`ไม่สามารถแก้ชื่อซ้ำของ ${baseName || '(ว่าง)'} ภายใต้ข้อจำกัด ${options.maxLength} ตัวอักษรได้`);
}

export function generateCadRenames(xmlData, existingRenames = new Map(), options = {}) {
  const maxLength = Math.max(2, Number(options.maxLength) || 5);
  const prefix = options.prefix ?? 'A';
  const namingMode = options.namingMode || 'a1';
  const renameAll = Boolean(options.renameAll);
  const overflowMode = ['keep-start', 'keep-end', 'regenerate'].includes(options.overflowMode)
    ? options.overflowMode : 'keep-start';
  const duplicateMode = ['replace-character', 'suffix', 'regenerate'].includes(options.duplicateMode)
    ? options.duplicateMode : 'replace-character';
  const duplicateCharacter = firstReplacementCharacter(options.duplicateCharacter ?? '_');
  const components = selectedComponents(xmlData, options.componentIds ?? null);
  const result = new Map(existingRenames);
  let generated = 0;

  for (const component of components) {
    const lands = [...(component.lands || [])].sort((a, b) => (Number(a.globalId) || 0) - (Number(b.globalId) || 0));
    const current = lands.map((land) => {
      const key = cadLandKey(component.id, land.globalId);
      const original = normalizeCadName(land.originalCadName ?? land.cadName);
      const name = normalizeCadName(result.has(key) ? result.get(key) : original);
      return { land, key, original, name };
    });

    if (renameAll) {
      const reserved = new Set();
      const counterRef = { value: 1 };
      for (const item of current) {
        const newName = namingMode === 'a1'
          ? generateA1Name(reserved, counterRef, maxLength)
          : generateName(reserved, counterRef, prefix, maxLength);
        result.set(item.key, newName);
        generated += 1;
      }
      continue;
    }

    const counts = new Map();
    for (const item of current) {
      const key = comparisonKey(item.name);
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    }

    const duplicateSeen = new Map();
    const renameFlags = current.map((item) => {
      const key = comparisonKey(item.name);
      const occurrence = key ? (duplicateSeen.get(key) || 0) : 0;
      if (key) duplicateSeen.set(key, occurrence + 1);
      const duplicateAfterFirst = key && (counts.get(key) || 0) > 1 && occurrence > 0;
      return !item.name || nameLength(item.name) > maxLength || duplicateAfterFirst;
    });

    // Preserve every already-valid first occurrence before transforming problematic names.
    const reserved = new Set();
    current.forEach((item, index) => {
      if (!renameFlags[index] && item.name) reserved.add(comparisonKey(item.name));
    });

    const duplicateCounters = new Map();
    const a1Counter = { value: 1 };
    current.forEach((item, index) => {
      if (!renameFlags[index]) {
        if (item.name === item.original) result.delete(item.key);
        return;
      }

      let candidate = item.name;
      if (!candidate) {
        candidate = generateA1Name(reserved, a1Counter, maxLength);
      } else if (nameLength(candidate) > maxLength) {
        candidate = truncateCadName(candidate, maxLength, overflowMode);
        if (!candidate) candidate = generateA1Name(reserved, a1Counter, maxLength);
      }

      if (reserved.has(comparisonKey(candidate))) {
        candidate = makeUniqueCandidate(candidate, reserved, duplicateCounters, {
          maxLength, overflowMode, duplicateMode, duplicateCharacter,
        }, a1Counter);
      } else {
        reserved.add(comparisonKey(candidate));
      }

      if (candidate === item.original) result.delete(item.key);
      else result.set(item.key, candidate);
      generated += 1;
    });
  }

  return { renames: result, generated };
}

function escapeXmlAttribute(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function readAttribute(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`\\b${escaped}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
  return match ? match[2] : '';
}

export function rewriteCadXml(xmlText, renames = new Map()) {
  if (!xmlText || !renames?.size) return xmlText;
  return xmlText.replace(/<LandNumber\b([^>]*)>/g, (full, attributes) => {
    const componentId = readAttribute(attributes, 'Component');
    const globalId = readAttribute(attributes, 'LandId');
    const key = cadLandKey(componentId, globalId);
    if (!renames.has(key)) return full;
    const newName = escapeXmlAttribute(normalizeCadName(renames.get(key)));
    if (/\bName\s*=\s*(["']).*?\1/i.test(attributes)) {
      const updated = attributes.replace(/\bName\s*=\s*(["']).*?\1/i, `Name="${newName}"`);
      return `<LandNumber${updated}>`;
    }
    return `<LandNumber${attributes} Name="${newName}">`;
  });
}

export function cadAuditToCsv(audit) {
  const escapeCsv = (value) => {
    const text = value == null ? '' : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const issueText = (issues) => issues.map((issue) => ({
    'duplicate': 'duplicate',
    'too-long': 'too_long',
    'blank': 'blank',
  }[issue] || issue)).join('|');
  const rows = [['component','package','local_index','xml_global_id','original_name','final_name','length','issues','changed','center_x_mm','center_y_mm']];
  for (const item of audit.items) rows.push([
    item.componentName, item.packageName, item.localIndex, item.globalId, item.originalName, item.proposedName,
    item.length, issueText(item.issues), item.changed, item.centerX, item.centerY,
  ]);
  return rows.map((row) => row.map(escapeCsv).join(',')).join('\r\n');
}
