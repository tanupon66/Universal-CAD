const SENSITIVE_KEYS = /(?:sourceText|xmlText|bytes|rawData|archiveBytes|fileContent|payload)/i;

function safeContext(value, depth = 0) {
  if (depth > 4) return '[depth-limit]';
  if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) {
    if (typeof value === 'string' && value.length > 1000) return `${value.slice(0, 1000)}…[truncated]`;
    return value;
  }
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) return `[binary:${value.byteLength}]`;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => safeContext(item, depth + 1));
  if (typeof value === 'object') {
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      if (SENSITIVE_KEYS.test(key)) output[key] = '[redacted]';
      else output[key] = safeContext(item, depth + 1);
    }
    return output;
  }
  return String(value);
}

export function createDiagnosticReport(error, context = {}) {
  const typed = error?.toDiagnostic?.({ includeStack: true }) || {
    errorType: error?.name || 'Error', code: error?.code || 'UNEXPECTED_ERROR', stage: error?.stage || context.stage || 'unknown',
    fileName: error?.fileName || context.fileName || '', message: error?.message || String(error),
    technicalDetail: error?.technicalDetail || '', remediation: error?.remediation || 'ตรวจรายละเอียดแล้วลองใหม่', stack: error?.stack || '',
    context: error?.context || {},
  };
  return {
    reportVersion: 1,
    createdAt: new Date().toISOString(),
    appVersion: context.appVersion || '0.20.0',
    schemaVersion: context.schemaVersion ?? 2,
    projectId: context.projectId || '',
    revision: Number(context.revision || 0),
    operation: context.operation || typed.stage || 'unknown',
    online: typeof navigator === 'undefined' ? null : navigator.onLine,
    userAgent: typeof navigator === 'undefined' ? 'node' : navigator.userAgent,
    location: typeof location === 'undefined' ? '' : `${location.origin}${location.pathname}`,
    error: safeContext(typed),
    metrics: safeContext(context.metrics || {}),
    note: 'Diagnostic report intentionally excludes imported CAD source text and binary payloads.',
  };
}

export function diagnosticText(report) {
  return JSON.stringify(report, null, 2);
}
