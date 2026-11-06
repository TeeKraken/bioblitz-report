/**
 * A small CSV reader (RFC 4180, plus the things real files do): quoted fields,
 * doubled quotes inside quotes, commas and line breaks inside quoted fields,
 * Windows (CRLF), Unix (LF) or old Mac (CR) line endings, and a leading byte
 * order mark. It never throws on messy input; a quote that is never closed
 * runs to the end of the file, the way spreadsheet apps read it.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const n = text.length;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      // A quote only opens a quoted section at the start of a field; elsewhere
      // it's kept as a plain character (what Excel and Sheets do).
      if (field === "") inQuotes = true;
      else field += ch;
      i++;
    } else if (ch === ",") {
      endField();
      i++;
    } else if (ch === "\r") {
      endRow();
      i += text[i + 1] === "\n" ? 2 : 1;
    } else if (ch === "\n") {
      endRow();
      i++;
    } else {
      field += ch;
      i++;
    }
  }
  // Last row, unless the file ended with a line break.
  if (field !== "" || row.length > 0 || inQuotes) endRow();

  // Drop rows that are completely empty (blank lines).
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

export interface Table {
  /** Header names as written in the file, trimmed. */
  headers: string[];
  /** One object per data row, keyed by lower-cased header name. Missing cells are "". */
  records: Record<string, string>[];
}

/** Turns parsed rows into records keyed by (lower-case, trimmed) header name. */
export function toTable(rows: string[][]): Table {
  if (rows.length === 0) return { headers: [], records: [] };
  const headers = rows[0].map((h) => h.trim());
  const keys = headers.map((h) => h.toLowerCase());
  const records = rows.slice(1).map((r) => {
    const rec: Record<string, string> = {};
    keys.forEach((k, idx) => {
      // If a header is repeated, keep the first non-empty value.
      const v = (r[idx] ?? "").trim();
      if (!(k in rec) || (rec[k] === "" && v !== "")) rec[k] = v;
    });
    return rec;
  });
  return { headers, records };
}
