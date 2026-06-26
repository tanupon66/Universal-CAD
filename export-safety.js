const FORMULA_PREFIX = /^[=+\-@*\t\r]/;
const LEADING_ZERO_INTEGER = /^0\d+$/;

export function protectSpreadsheetText(value, { preserveLeadingZero = true } = {}) {
  if (value == null) return '';
  if (typeof value !== 'string') return value;
  const text = value;
  if (FORMULA_PREFIX.test(text) || (preserveLeadingZero && LEADING_ZERO_INTEGER.test(text))) return `'${text}`;
  return text;
}

export function csvCell(value, options = {}) {
  const protectedValue = protectSpreadsheetText(value, options);
  const text = protectedValue == null ? '' : String(protectedValue);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function sanitizeSheetName(value, fallback = 'Sheet') {
  const cleaned = String(value || fallback).replace(/[\\/?*[\]:]/g, ' ').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 31);
  return cleaned || fallback;
}

export function safeDownloadName(value, fallback = 'export') {
  const basename = String(value || fallback).replace(/\\/g, '/').split('/').pop() || fallback;
  const cleaned = basename
    .replace(/[:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\.\.+/g, '.')
    .replace(/^\.+/, '')
    .trim();
  return cleaned || fallback;
}
