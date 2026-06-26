export class PerformanceDiagnostics {
  constructor(limit = 100) { this.limit = Math.max(10, Number(limit) || 100); this.entries = []; }
  record(operation, durationMs, metrics = {}) { const entry = { operation: String(operation), durationMs: Math.max(0, Number(durationMs) || 0), timestamp: new Date().toISOString(), metrics: { ...metrics } }; this.entries.push(entry); if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit); return entry; }
  start(operation, metrics = {}) { const started = performance.now(); return (extra = {}) => this.record(operation, performance.now() - started, { ...metrics, ...extra }); }
  snapshot() { return this.entries.map((entry) => ({ ...entry, metrics: { ...entry.metrics } })); }
  clear() { this.entries.length = 0; }
}
