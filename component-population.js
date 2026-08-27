const NON_POP_TEXT_PATTERNS = [
  /\bNON\s*[-_/ ]?\s*POP(?:ULATED|ULATION)?\b/i,
  /\bDNP\b/i,
  /\bDNI\b/i,
  /\bDO\s+NOT\s+(?:POPULATE|INSTALL|FIT|MOUNT)\b/i,
  /\bNOT\s+(?:POPULATED|INSTALLED|FITTED|MOUNTED)\b/i,
  /\bUNPOPULATED\b/i,
  /\bNO\s+FIT\b/i,
];

const EXPLICIT_FALSE_KEYS = /(?:^|_)(?:POPULATED|PLACED|MOUNTED|FITTED|INSTALLED)(?:$|_)/i;
const EXPLICIT_NONPOP_KEYS = /(?:NON.?POP|DNP|DNI|DO.?NOT.?POPULATE)/i;
const VARIATION_KEYS = /(?:VARIATION|VARIANT|POPULATION|ASSEMBLY.?STATUS|MOUNT.?STATUS|PLACEMENT.?STATUS)/i;
const FALSE_VALUES = new Set(['0', 'FALSE', 'NO', 'N', 'OFF', 'UNPOPULATED', 'NOT POPULATED', 'NOT FITTED']);
const TRUE_VALUES = new Set(['1', 'TRUE', 'YES', 'Y', 'ON']);

function normalizedEntries(metadata) {
  if (!metadata || typeof metadata !== 'object') return [];
  return Object.entries(metadata)
    .map(([key, value]) => [String(key || '').trim(), value])
    .filter(([key, value]) => key && value != null && String(value).trim() !== '');
}

export function compactPopulationMetadata(metadata = {}) {
  const output = {};
  for (const [key, value] of normalizedEntries(metadata)) {
    const normalizedKey = key.toUpperCase().replace(/[\s-]+/g, '_');
    if (
      ['COMPCLASS','COMPPARTNUMBER','COMPHEIGHT','COMPDEVICELABEL','COMPINSERTIONCODE'].includes(normalizedKey.replace(/_/g, ''))
      || VARIATION_KEYS.test(normalizedKey)
      || EXPLICIT_NONPOP_KEYS.test(normalizedKey)
      || EXPLICIT_FALSE_KEYS.test(normalizedKey)
    ) output[key] = String(value).trim();
  }
  return output;
}

export function populationInfo(component = {}) {
  if (component.nonPop === true) return { nonPop: true, field: 'nonPop', value: true, reason: 'explicit flag' };

  const directEntries = [
    ['variation', component.variation],
    ['variant', component.variant],
    ['populationStatus', component.populationStatus],
    ['assemblyStatus', component.assemblyStatus],
  ].filter(([, value]) => value != null && String(value).trim() !== '');
  const metadataEntries = normalizedEntries(component.sourceMetadata || component.metadata || {});
  const entries = [...directEntries, ...metadataEntries];

  for (const [key, rawValue] of entries) {
    const text = String(rawValue ?? '').trim();
    const keyText = String(key || '').trim();
    if (!text) continue;
    if (NON_POP_TEXT_PATTERNS.some((pattern) => pattern.test(text))) {
      return { nonPop: true, field: keyText, value: text, reason: 'non-population marker' };
    }
    const upper = text.toUpperCase();
    if (EXPLICIT_NONPOP_KEYS.test(keyText) && (TRUE_VALUES.has(upper) || NON_POP_TEXT_PATTERNS.some((pattern) => pattern.test(`${keyText} ${text}`)))) {
      return { nonPop: true, field: keyText, value: text, reason: 'explicit non-pop field' };
    }
    if (EXPLICIT_FALSE_KEYS.test(keyText) && FALSE_VALUES.has(upper)) {
      return { nonPop: true, field: keyText, value: text, reason: 'explicit population=false field' };
    }
  }
  return { nonPop: false, field: '', value: '', reason: '' };
}

export function isNonPopComponent(component) {
  return populationInfo(component).nonPop;
}

export function findNonPopComponents(components = []) {
  return (components || []).filter((component) => isNonPopComponent(component));
}

export function inferPopulationFields(metadata = {}) {
  const entries = normalizedEntries(metadata);
  const variationEntry = entries.find(([key]) => /VARIATION|VARIANT/i.test(key));
  const populationEntry = entries.find(([key]) => /POPULATION|ASSEMBLY.?STATUS|MOUNT.?STATUS|PLACEMENT.?STATUS/i.test(key));
  const probe = { variation: variationEntry?.[1] || '', populationStatus: populationEntry?.[1] || '', sourceMetadata: metadata };
  const info = populationInfo(probe);
  return {
    variation: variationEntry ? String(variationEntry[1]).trim() : '',
    populationStatus: populationEntry ? String(populationEntry[1]).trim() : '',
    nonPop: info.nonPop,
    nonPopReason: info.nonPop ? `${info.field}: ${info.value}` : '',
  };
}
