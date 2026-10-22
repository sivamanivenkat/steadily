/**
 * File access for CSV import and export, kept apart from the screens so tests can stand in for
 * the native pickers. Nothing here logs or uploads file contents (D-011).
 */
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

/** Largest file the import reads. 10,000 rows of a bank export is well under this. */
export const MAX_CSV_BYTES = 10 * 1024 * 1024;

export class CsvFileTooLargeError extends Error {
  constructor() {
    super('The file is too large');
    this.name = 'CsvFileTooLargeError';
  }
}

/**
 * Lets the user pick a CSV file and returns its text, or null if they cancelled. The picker's
 * copy in the app cache is deleted before this returns, so the original file is never kept.
 */
export async function pickCsvText(): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['text/csv', 'text/comma-separated-values', 'text/plain', 'application/vnd.ms-excel'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset) return null;
  const file = new File(asset.uri);
  try {
    if ((asset.size ?? file.size ?? 0) > MAX_CSV_BYTES) throw new CsvFileTooLargeError();
    return await file.text();
  } finally {
    try {
      if (file.exists) file.delete();
    } catch {
      // Already gone, or not ours to delete (a provider URI); nothing was copied then.
    }
  }
}

const exportDir = () => new Directory(Paths.cache, 'exports');

/** Deletes earlier export files left in the app cache. */
export function clearExportFiles(): void {
  try {
    const dir = exportDir();
    if (dir.exists) dir.delete();
  } catch {
    // Nothing to clear.
  }
}

/**
 * Writes the export to the app cache and opens the share sheet. The cache copy is removed the
 * next time the export screen opens (the receiving app may still be reading it now).
 */
export async function shareCsv(fileName: string, text: string): Promise<void> {
  clearExportFiles();
  const dir = exportDir();
  dir.create({ intermediates: true, idempotent: true });
  const file = new File(dir, fileName);
  file.create({ overwrite: true });
  await file.write(text);
  await Sharing.shareAsync(file.uri, {
    mimeType: 'text/csv',
    UTI: 'public.comma-separated-values-text',
    dialogTitle: 'Export transactions',
  });
}

export async function canShareFiles(): Promise<boolean> {
  try {
    return await Sharing.isAvailableAsync();
  } catch {
    return false;
  }
}
