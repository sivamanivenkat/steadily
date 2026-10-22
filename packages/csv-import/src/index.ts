/**
 * CSV import and export, on the device only (D-011). Pure functions: the app reads the file,
 * hands the text here, keeps only the extracted `ImportRow`s and drops the text.
 */
export { csvCell, joinCsvRows, parseCsv, type CsvTable } from './csv';
export {
  classifyRows,
  duplicateWindow,
  similarMerchant,
  DUPLICATE_DAYS_AFTER,
  DUPLICATE_DAYS_BEFORE,
  type ExistingTransaction,
  type RowStatus,
} from './dedupe';
export {
  buildExportCsv,
  categoryName,
  EXPORT_HEADER,
  formatAmount,
  type ExportTransaction,
} from './export';
export { FORMATS, WELLS_FARGO, type CsvFormat, type FormatId } from './formats';
export {
  columnLabels,
  dataRows,
  detectFormat,
  guessMapping,
  isCompleteMapping,
  readRows,
  MAX_DESCRIPTION_LENGTH,
  MAX_IMPORT_ROWS,
  type ColumnMapping,
  type ImportPlan,
  type ImportRow,
  type ReadResult,
} from './read';
export { rowIdFor } from './rowId';
export { localDayKey, parseAmount, parseDate, type CalendarDate } from './values';
