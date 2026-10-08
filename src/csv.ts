/** Minimal RFC-4180 CSV/TSV reader and writer. */
export function parseCsv(text: string, delim = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cur = "", q = false;
  const t = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
    } else if (c === '"' && cur === "") q = true;
    else if (c === delim) { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.some((x) => x !== "") || row.length > 1) rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur);
  if (row.some((x) => x !== "") || row.length > 1) rows.push(row);
  return rows;
}

export function csvCell(v: string | number | undefined | null, delim = ","): string {
  const s = v === undefined || v === null ? "" : String(v);
  return s.includes(delim) || /["\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export const toCsv = (rows: (string | number | undefined | null)[][], delim = ","): string => rows.map((r) => r.map((c) => csvCell(c, delim)).join(delim)).join("\n") + "\n";
