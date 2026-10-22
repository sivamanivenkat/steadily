/** A parsed CSV file: rows of cells, blank lines dropped. */
export type CsvTable = string[][];

const CANDIDATE_DELIMITERS = [',', ';', '\t'] as const;

/**
 * Parses CSV text (RFC 4180, leniently): quoted fields with `""` escapes, commas and line breaks
 * inside quotes, CRLF / LF / CR line endings, a leading byte-order mark and an unterminated quote
 * at the end of the file. Rows whose cells are all empty are dropped. Cells are not trimmed.
 *
 * The delimiter is detected from the first line (comma, semicolon or tab) unless given.
 */
export function parseCsv(text: string, delimiter?: string): CsvTable {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const sep = delimiter ?? detectDelimiter(input);

  const rows: CsvTable = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  /** The current field started with a quote, so a closing quote is expected. */
  let quoted = false;

  const endField = () => {
    row.push(field);
    field = '';
    quoted = false;
  };
  const endRow = () => {
    endField();
    if (row.some((cell) => cell.trim() !== '')) rows.push(row);
    row = [];
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field.trim() === '' && !quoted) {
      // Opening quote (spaces before it are dropped).
      field = '';
      inQuotes = true;
      quoted = true;
    } else if (ch === sep) {
      endField();
    } else if (ch === '\r') {
      if (input[i + 1] === '\n') i++;
      endRow();
    } else if (ch === '\n') {
      endRow();
    } else {
      // Text after a closing quote, or a stray quote mid-field, is kept as is.
      field += ch;
    }
  }
  if (field !== '' || row.length > 0 || quoted) endRow();
  return rows;
}

/** Most frequent candidate delimiter on the first line, outside quotes. Comma on ties. */
function detectDelimiter(text: string): string {
  const counts = new Map<string, number>(CANDIDATE_DELIMITERS.map((d) => [d, 0]));
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === '\n' || ch === '\r')) {
      // Skip blank leading lines.
      if ([...counts.values()].some((n) => n > 0)) break;
    } else if (!inQuotes && counts.has(ch)) counts.set(ch, counts.get(ch)! + 1);
  }
  let best = ',';
  for (const d of CANDIDATE_DELIMITERS) {
    if (counts.get(d)! > counts.get(best)!) best = d;
  }
  return best;
}

/** Characters that make spreadsheet apps treat a cell as a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * One CSV cell: quoted when it contains a delimiter, quote or line break. Text that a spreadsheet
 * would run as a formula is prefixed with an apostrophe (CSV injection). Numbers are written by
 * the caller as plain strings and pass `numeric` to skip the formula guard.
 */
export function csvCell(value: string, numeric = false): string {
  const safe = !numeric && FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Joins rows of encoded cells (see `csvCell`) into CSV text with CRLF line endings (RFC 4180). */
export function joinCsvRows(rows: readonly (readonly string[])[]): string {
  return rows.map((cells) => cells.join(',')).join('\r\n') + '\r\n';
}
