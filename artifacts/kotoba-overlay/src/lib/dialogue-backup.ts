export type DialogueLine = { sourceText: string; translatedText: string; timestamp: number };
export type BackupFormat = 'json' | 'csv' | 'txt';
export const MAX_ARCHIVE_LINES = 500;
export const MAX_ARCHIVE_BYTES = 1024 * 1024;
const COLUMNS = ['timestamp', 'sourceText', 'translatedText'];

function validateLines(value: unknown): DialogueLine[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ARCHIVE_LINES) {
    throw new Error('Choose a backup containing 1–500 dialogue lines. Split larger archives into smaller files.');
  }
  return value.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new Error('Invalid dialogue entry.');
    const line = item as Record<string, unknown>;
    if (typeof line.sourceText !== 'string' || !line.sourceText.trim() || line.sourceText.length > 4000 ||
        typeof line.translatedText !== 'string' || !line.translatedText.trim() || line.translatedText.length > 4000 ||
        typeof line.timestamp !== 'number' || !Number.isSafeInteger(line.timestamp) ||
        line.timestamp < 0 || line.timestamp > 8640000000000000) {
      throw new Error('Every dialogue entry needs Japanese text, translated text (at most 4,000 characters each), and a valid timestamp.');
    }
    return { sourceText: line.sourceText, translatedText: line.translatedText, timestamp: line.timestamp };
  });
}

// Prefix spreadsheet formulas, including leading whitespace, with an apostrophe.
// A second apostrophe escapes literal apostrophes so our importer is lossless.
function safeCell(value: string): string {
  const safe = /^(?:'|\s*[=+\-@])/u.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

function restoreCell(value: string): string {
  return /^'(?:'|\s*[=+\-@])/u.test(value) ? value.slice(1) : value;
}

export function serializeDialogue(lines: DialogueLine[], format: BackupFormat): string {
  const validated = validateLines(lines);
  if (format === 'json') {
    return JSON.stringify({ format: 'mhfzz-dialogue', version: 1, lines: validated }, null, 2);
  }
  if (format === 'csv') {
    // Explicit marker makes formula-escaping reversible only for our own files.
    return '\uFEFFmhfzz-dialogue-csv-v1\r\n' + COLUMNS.join(',') + '\r\n' +
      validated.map((line) => [String(line.timestamp), safeCell(line.sourceText), safeCell(line.translatedText)].join(',')).join('\r\n');
  }
  return validated.map((line) =>
    `[${new Date(line.timestamp).toISOString()}]\nJapanese: ${line.sourceText}\nEnglish: ${line.translatedText}`,
  ).join('\n\n');
}

function readCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else cell += c;
    } else if (c === ',' || c === '\n' || c === '\r') {
      row.push(cell); cell = ''; closed = false;
      if (c !== ',') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        rows.push(row); row = [];
      }
    } else if (c === '"' && cell === '' && !closed) quoted = true;
    else {
      if (closed || c === '"') throw new Error('Malformed CSV quoting.');
      cell += c;
    }
    if (rows.length > MAX_ARCHIVE_LINES + 2) throw new Error('CSV exceeds 500 dialogue lines.');
  }
  if (quoted) throw new Error('CSV has an unterminated quoted field.');
  if (cell !== '' || row.length > 0 || closed) { row.push(cell); rows.push(row); }
  return rows;
}

export function parseDialogueFile(text: string, filename: string): DialogueLine[] {
  if (new TextEncoder().encode(text).byteLength > MAX_ARCHIVE_BYTES) throw new Error('Backups must be at most 1 MiB.');
  text = text.replace(/^\uFEFF/, '');
  if (/\.json$/i.test(filename)) {
    let data: unknown;
    try { data = JSON.parse(text); } catch { throw new Error('The JSON backup could not be read. Choose an unmodified export.'); }
    const archive = data as { format?: unknown; version?: unknown; lines?: unknown } | null;
    if (!archive || archive.format !== 'mhfzz-dialogue' || archive.version !== 1) {
      throw new Error('Unsupported backup format/version. Use a JSON or CSV export from this app.');
    }
    return validateLines(archive.lines);
  }
  if (/\.csv$/i.test(filename)) {
    const rows = readCsv(text);
    const ownFormat = rows[0]?.length === 1 && rows[0][0] === 'mhfzz-dialogue-csv-v1';
    if (ownFormat) rows.shift();
    if (rows.shift()?.join(',') !== COLUMNS.join(',')) throw new Error('CSV header must be timestamp,sourceText,translatedText.');
    return validateLines(rows.map((row) => {
      if (row.length !== 3 || !/^\d+$/.test(row[0])) throw new Error('Invalid CSV dialogue row.');
      return {
        timestamp: Number(row[0]),
        sourceText: ownFormat ? restoreCell(row[1]) : row[1],
        translatedText: ownFormat ? restoreCell(row[2]) : row[2],
      };
    }));
  }
  throw new Error('Import JSON or CSV backups. Plain text exports are for reading only.');
}

export function mergeDialogue(existing: DialogueLine[], incoming: DialogueLine[]): DialogueLine[] {
  const unique = new Map<string, DialogueLine>();
  for (const line of [...existing, ...incoming]) {
    unique.set(JSON.stringify([line.timestamp, line.sourceText, line.translatedText]), line);
  }
  if (unique.size === 0) return [];
  return validateLines([...unique.values()]).sort((a, b) => b.timestamp - a.timestamp);
}

export function downloadDialogue(lines: DialogueLine[], format: BackupFormat): void {
  const text = serializeDialogue(lines, format);
  const type = format === 'json' ? 'application/json' : format === 'csv' ? 'text/csv' : 'text/plain';
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `mhfzz-dialogue-${new Date().toISOString().replaceAll(':', '-')}.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // WebView downloads need time to acquire the Blob before its URL is revoked.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
