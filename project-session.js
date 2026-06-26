import {
  cloneCadValue,
  createExportSnapshot,
  createUniversalProject,
  immutableSourceRecord,
  migrateProject,
  normalizeLegacyCad,
  universalCadToLegacy,
} from './universal-cad-model.js';

export function createProjectSession({ name, fileName, sourceFormat = 'inspection-xml', mimeType = 'application/xml', sourceText = '', sourceBytes = null, legacyCad } = {}) {
  const source = immutableSourceRecord({ name: fileName || name || 'cad.xml', format: sourceFormat, mimeType, text: sourceText || null, bytes: sourceBytes });
  const parsedModel = normalizeLegacyCad(legacyCad, { sourceFormat });
  parsedModel.metadata.sourceSize = source.size;
  const project = createUniversalProject({ name: name || fileName || 'CAD Project', sourceFiles: [source], parsedModel });
  return { project, originalSource: source };
}

export function prepareProjectRevision(session, { legacyCad, workingXml = '', changes = [], validationStatus = 'passed', validationIssues = [] } = {}) {
  if (!session?.project) throw new Error('Project session ไม่พร้อม');
  const project = session.project;
  const revisionNumber = Number(project.appliedRevision || 0) + 1;
  const model = normalizeLegacyCad(legacyCad, {
    projectId: project.projectId,
    revision: revisionNumber,
    sourceFormat: project.currentModel?.sourceFormat || project.sourceFiles?.[0]?.format,
    units: project.currentModel?.units,
  });
  model.validationIssues = cloneCadValue(validationIssues);
  model.metadata = { ...model.metadata, workingXml, sourceSize: project.sourceFiles?.[0]?.size || 0 };
  const changeSet = {
    id: `changeset:${project.projectId}:${revisionNumber}`,
    projectId: project.projectId,
    revisionNumber,
    createdAt: new Date().toISOString(),
    changes: cloneCadValue(changes),
    validationStatus,
  };
  const revision = {
    number: revisionNumber,
    createdAt: new Date().toISOString(),
    model: cloneCadValue(model),
    changeSetId: changeSet.id,
    validationStatus,
  };
  return { revisionNumber, model, changeSet, revision };
}

export function projectSessionCheckpoint(session) {
  const project = session?.project;
  if (!project) return null;
  return {
    appliedRevision: project.appliedRevision,
    currentModel: project.currentModel,
    workingModel: project.workingModel,
    revisionsLength: project.revisions.length,
    changeSetsLength: project.changeSets.length,
    updatedAt: project.updatedAt,
    recovery: cloneCadValue(project.recovery),
  };
}

export function commitPreparedProjectRevision(session, prepared) {
  if (!session?.project || !prepared?.revision) throw new Error('Prepared revision ไม่ครบ');
  const project = session.project;
  project.workingModel = cloneCadValue(prepared.model);
  project.currentModel = cloneCadValue(prepared.model);
  project.appliedRevision = prepared.revisionNumber;
  project.revisions.push(cloneCadValue(prepared.revision));
  project.changeSets.push(cloneCadValue(prepared.changeSet));
  project.updatedAt = new Date().toISOString();
  project.recovery = { complete: true, revision: prepared.revisionNumber };
  return project.currentModel;
}

export function restoreProjectSessionCheckpoint(session, checkpoint) {
  if (!session?.project || !checkpoint) return false;
  const project = session.project;
  project.appliedRevision = checkpoint.appliedRevision;
  project.currentModel = checkpoint.currentModel;
  project.workingModel = checkpoint.workingModel;
  project.revisions.length = checkpoint.revisionsLength;
  project.changeSets.length = checkpoint.changeSetsLength;
  project.updatedAt = checkpoint.updatedAt;
  project.recovery = checkpoint.recovery;
  return true;
}

export function currentProjectLegacyCad(session) {
  return session?.project?.currentModel ? universalCadToLegacy(session.project.currentModel) : null;
}

export function createProjectExportSnapshot(session, options) {
  if (!session?.project) throw new Error('Project session ไม่พร้อม');
  return createExportSnapshot(session.project, options);
}

export function exportProjectBackup(session) {
  if (!session?.project) throw new Error('Project session ไม่พร้อม');
  const serializable = cloneCadValue(session.project);
  for (const source of serializable.sourceFiles || []) {
    if (source.bytes instanceof Uint8Array) source.bytes = Array.from(source.bytes);
  }
  return JSON.stringify({ app: 'Universal CAD Studio', backupSchemaVersion: 2, project: serializable }, null, 2);
}

export function importProjectBackup(text) {
  const payload = typeof text === 'string' ? JSON.parse(text) : text;
  const project = migrateProject(payload?.project || payload);
  for (const source of project.sourceFiles || []) {
    if (Array.isArray(source.bytes)) source.bytes = new Uint8Array(source.bytes);
  }
  return { project, originalSource: project.sourceFiles?.[0] || null };
}
