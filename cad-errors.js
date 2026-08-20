const DEFAULT_REMEDIATION = Object.freeze({
  IMPORT_ERROR: 'Check the file type and Diagnostic Report details.',
  PARSE_ERROR: 'Check the file structure and encoding.',
  ARCHIVE_ERROR: 'Check that the archive is not corrupted and contains a supported primary file.',
  VALIDATION_ERROR: 'Resolve the reported validation issues before continuing.',
  GEOMETRY_ERROR: 'Check geometry dimensions, points, and polygons.',
  TRANSACTION_ERROR: 'Undo the latest edit and inspect the related data.',
  MAPPING_ERROR: 'Check the source and target records, then resolve conflicting mappings.',
  EXPORT_ERROR: 'Resolve blocking errors and retry the export.',
  STORAGE_ERROR: 'Check browser storage availability and site permissions.',
  WORKER_ERROR: 'Cancel the operation and retry with a smaller file.',
  MIGRATION_ERROR: 'Keep the existing backup and verify the schema version.',
});

export class CadAppError extends Error {
  constructor(message, options = {}) {
    super(String(message || 'An error occurred'));
    this.name = new.target.name;
    this.code = String(options.code || 'CAD_ERROR');
    this.stage = String(options.stage || 'unknown');
    this.fileName = options.fileName ? String(options.fileName) : '';
    this.technicalDetail = options.technicalDetail ? String(options.technicalDetail) : '';
    this.remediation = String(options.remediation || DEFAULT_REMEDIATION[this.code] || 'Review the Diagnostic Report and retry.');
    this.context = options.context && typeof options.context === 'object' ? { ...options.context } : {};
    this.cause = options.cause;
  }

  toDiagnostic({ includeStack = false } = {}) {
    return {
      errorType: this.name,
      code: this.code,
      stage: this.stage,
      fileName: this.fileName,
      message: this.message,
      technicalDetail: this.technicalDetail,
      remediation: this.remediation,
      context: this.context,
      ...(includeStack ? { stack: this.stack || '' } : {}),
    };
  }
}

function typedError(name, code) {
  return class extends CadAppError {
    constructor(message, options = {}) {
      super(message, { ...options, code: options.code || code });
      this.name = name;
    }
  };
}

export const ImportError = typedError('ImportError', 'IMPORT_ERROR');
export const ParseError = typedError('ParseError', 'PARSE_ERROR');
export const ArchiveError = typedError('ArchiveError', 'ARCHIVE_ERROR');
export const ValidationError = typedError('ValidationError', 'VALIDATION_ERROR');
export const GeometryError = typedError('GeometryError', 'GEOMETRY_ERROR');
export const TransactionError = typedError('TransactionError', 'TRANSACTION_ERROR');
export const MappingError = typedError('MappingError', 'MAPPING_ERROR');
export const ExportError = typedError('ExportError', 'EXPORT_ERROR');
export const StorageError = typedError('StorageError', 'STORAGE_ERROR');
export const WorkerError = typedError('WorkerError', 'WORKER_ERROR');
export const MigrationError = typedError('MigrationError', 'MIGRATION_ERROR');

export function asCadError(error, ErrorType = CadAppError, options = {}) {
  if (error instanceof CadAppError) return error;
  return new ErrorType(error?.message || String(error), { ...options, cause: error, technicalDetail: options.technicalDetail || error?.stack || '' });
}
