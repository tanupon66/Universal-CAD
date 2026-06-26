const DEFAULT_REMEDIATION = Object.freeze({
  IMPORT_ERROR: 'ตรวจสอบชนิดไฟล์และรายละเอียดใน Diagnostic Report',
  PARSE_ERROR: 'ตรวจสอบโครงสร้างและ Encoding ของไฟล์',
  ARCHIVE_ERROR: 'ตรวจสอบว่า Archive ไม่เสียหายและมีไฟล์หลักที่รองรับ',
  VALIDATION_ERROR: 'แก้รายการ Validation ที่ระบุก่อนดำเนินการต่อ',
  GEOMETRY_ERROR: 'ตรวจสอบขนาด จุด และ Polygon ของ Geometry',
  TRANSACTION_ERROR: 'ยกเลิกการแก้ไขล่าสุด แล้วตรวจข้อมูลที่เกี่ยวข้อง',
  MAPPING_ERROR: 'ตรวจ Source/Target และยืนยัน Mapping ที่ขัดแย้ง',
  EXPORT_ERROR: 'แก้ Blocking Error และลอง Export อีกครั้ง',
  STORAGE_ERROR: 'ตรวจพื้นที่จัดเก็บ Browser และสิทธิ์ของเว็บไซต์',
  WORKER_ERROR: 'ลองยกเลิกงานและเริ่มใหม่ด้วยไฟล์ที่เล็กลง',
  MIGRATION_ERROR: 'เก็บ Backup เดิมไว้และตรวจ Schema Version',
});

export class CadAppError extends Error {
  constructor(message, options = {}) {
    super(String(message || 'เกิดข้อผิดพลาด'));
    this.name = new.target.name;
    this.code = String(options.code || 'CAD_ERROR');
    this.stage = String(options.stage || 'unknown');
    this.fileName = options.fileName ? String(options.fileName) : '';
    this.technicalDetail = options.technicalDetail ? String(options.technicalDetail) : '';
    this.remediation = String(options.remediation || DEFAULT_REMEDIATION[this.code] || 'ดู Diagnostic Report แล้วลองใหม่');
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
