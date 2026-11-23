// One safe way to write a CSV cell. A cell that starts with = + - @ (or a tab or return) would run as a formula when the file is
// opened in a spreadsheet, so it gets a leading quote. Cells with commas, quotes or line breaks are wrapped in quotes.
export const csvCell = (v) => {
  let t = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

// rows: array of arrays. Lines end with \r\n, which every spreadsheet and payroll import reads.
export const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
