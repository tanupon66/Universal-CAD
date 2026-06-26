import { StorageError } from './cad-errors.js';
import { cloneCadValue, UNIVERSAL_CAD_SCHEMA_VERSION } from './universal-cad-model.js';

const DB_NAME = 'universal-cad-studio';
const DB_VERSION = 1;
const PROJECT_STORE = 'projects';
const TEMP_STORE = 'temporary';

function requestPromise(request) { return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
function transactionPromise(transaction) { return new Promise((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted')); }); }
export async function openProjectDatabase() {
  if (!globalThis.indexedDB) throw new StorageError('Browser นี้ไม่รองรับ IndexedDB', { stage: 'storage-open', code: 'STORAGE_INDEXEDDB_UNAVAILABLE' });
  try {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PROJECT_STORE)) { const store = db.createObjectStore(PROJECT_STORE, { keyPath: 'id' }); store.createIndex('updatedAt', 'updatedAt'); }
      if (!db.objectStoreNames.contains(TEMP_STORE)) db.createObjectStore(TEMP_STORE, { keyPath: 'id' });
    };
    return await requestPromise(request);
  } catch (error) { throw new StorageError(`เปิด IndexedDB ไม่สำเร็จ: ${error.message}`, { stage: 'storage-open', code: 'STORAGE_OPEN_FAILED', cause: error }); }
}

export function createProjectStorageRecord(session, workspace = {}) {
  if (!session?.project) throw new StorageError('Project session ไม่พร้อมสำหรับ Autosave', { stage: 'autosave-prepare', code: 'STORAGE_NO_PROJECT' });
  const project = cloneCadValue(session.project);
  const revision = Number(project.appliedRevision || 0);
  return {
    id: String(project.projectId), name: String(project.name || 'CAD Project'), schemaVersion: Number(project.schemaVersion || UNIVERSAL_CAD_SCHEMA_VERSION),
    revision, createdAt: project.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
    recovery: { complete: Boolean(project.recovery?.complete), revision: Number(project.recovery?.revision ?? revision), savedAt: new Date().toISOString() },
    project, workspace: cloneCadValue(workspace),
  };
}
export function validateProjectStorageRecord(record) {
  if (!record?.id || !record?.project) return { valid: false, reason: 'missing-project' };
  if (Number(record.schemaVersion) > UNIVERSAL_CAD_SCHEMA_VERSION) return { valid: false, reason: 'newer-schema' };
  if (!record.recovery?.complete) return { valid: false, reason: 'incomplete-recovery-marker' };
  if (Number(record.recovery.revision) !== Number(record.project.appliedRevision)) return { valid: false, reason: 'revision-mismatch' };
  return { valid: true, reason: '' };
}
export async function saveProjectRecord(record) {
  const validity = validateProjectStorageRecord(record);
  if (!validity.valid) throw new StorageError(`ไม่บันทึก Autosave ที่ไม่สมบูรณ์: ${validity.reason}`, { stage: 'autosave-validate', code: 'STORAGE_INCOMPLETE_REVISION' });
  const db = await openProjectDatabase();
  try { const transaction = db.transaction(PROJECT_STORE, 'readwrite'); transaction.objectStore(PROJECT_STORE).put(record); await transactionPromise(transaction); return record; }
  catch (error) { throw new StorageError(`Autosave ไม่สำเร็จ: ${error.message}`, { stage: 'autosave-write', code: 'STORAGE_WRITE_FAILED', cause: error }); }
  finally { db.close(); }
}
export async function listProjectRecords() { const db = await openProjectDatabase(); try { const records = await requestPromise(db.transaction(PROJECT_STORE, 'readonly').objectStore(PROJECT_STORE).getAll()); return records.filter((record) => validateProjectStorageRecord(record).valid).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))); } finally { db.close(); } }
export async function loadProjectRecord(id) { const db = await openProjectDatabase(); try { const record = await requestPromise(db.transaction(PROJECT_STORE, 'readonly').objectStore(PROJECT_STORE).get(String(id))); if (!record) return null; const validity = validateProjectStorageRecord(record); if (!validity.valid) throw new StorageError(`Recovery record ใช้ไม่ได้: ${validity.reason}`, { stage: 'recovery-validate', code: 'STORAGE_INVALID_RECOVERY' }); return record; } finally { db.close(); } }
export async function deleteProjectRecord(id) { const db = await openProjectDatabase(); try { const transaction = db.transaction(PROJECT_STORE, 'readwrite'); transaction.objectStore(PROJECT_STORE).delete(String(id)); await transactionPromise(transaction); } finally { db.close(); } }
export async function duplicateProjectRecord(id) { const source = await loadProjectRecord(id); if (!source) throw new StorageError('ไม่พบ Project ที่ต้องการ Duplicate', { stage: 'project-duplicate', code: 'STORAGE_PROJECT_NOT_FOUND' }); const copy = cloneCadValue(source); const suffix = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`; copy.id = `${source.id}:copy:${suffix}`; copy.name = `${source.name} Copy`; copy.project.projectId = copy.id; copy.project.name = copy.name; copy.createdAt = new Date().toISOString(); copy.updatedAt = copy.createdAt; copy.project.createdAt = copy.createdAt; copy.project.updatedAt = copy.createdAt; await saveProjectRecord(copy); return copy; }
export async function clearTemporaryCache() { const db = await openProjectDatabase(); try { const transaction = db.transaction(TEMP_STORE, 'readwrite'); transaction.objectStore(TEMP_STORE).clear(); await transactionPromise(transaction); } finally { db.close(); } }
export async function storageUsage() { if (!navigator.storage?.estimate) return { usage: null, quota: null, percent: null }; const result = await navigator.storage.estimate(); return { usage: Number(result.usage || 0), quota: Number(result.quota || 0), percent: result.quota ? Number(result.usage || 0) / Number(result.quota) * 100 : null }; }

export function createAutosaveController(save, delay = 1200, onError = (error) => console.error('Autosave failed', error)) {
  let timer = null; let pending = null; let inFlight = Promise.resolve();
  const flush = async () => { if (!pending) return null; const value = pending; pending = null; clearTimeout(timer); timer = null; inFlight = inFlight.then(() => save(value)); return inFlight; };
  return {
    schedule(value) { pending = value; clearTimeout(timer); timer = setTimeout(() => { flush().catch((error) => onError(error)); }, Math.max(100, delay)); },
    flush, cancel() { clearTimeout(timer); timer = null; pending = null; }, hasPending() { return Boolean(pending); },
  };
}
