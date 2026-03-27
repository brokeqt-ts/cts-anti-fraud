/**
 * Downloads a CSV file in the browser.
 * Prepends UTF-8 BOM so Excel opens it correctly without encoding issues.
 */
export function downloadCsv(
  filename: string,
  headers: string[],
  rows: (string | number | null | undefined)[][],
): void {
  const esc = (v: string | number | null | undefined): string => {
    const s = v == null ? '' : String(v);
    return `"${s.replace(/"/g, '""')}"`;
  };
  const lines = [
    headers.map(esc).join(','),
    ...rows.map((r) => r.map(esc).join(',')),
  ];
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Builds a multi-section CSV string — useful when exporting several tables
 * into one file (e.g. analytics page).
 * Each section is preceded by a blank row and a bold-style title row.
 */
export function buildMultiSectionCsv(
  sections: Array<{
    title: string;
    headers: string[];
    rows: (string | number | null | undefined)[][];
  }>,
): string {
  const esc = (v: string | number | null | undefined): string => {
    const s = v == null ? '' : String(v);
    return `"${s.replace(/"/g, '""')}"`;
  };

  const lines: string[] = [];
  for (const section of sections) {
    if (lines.length > 0) lines.push('');
    lines.push(esc(section.title));
    lines.push(section.headers.map(esc).join(','));
    for (const row of section.rows) {
      lines.push(row.map(esc).join(','));
    }
  }
  return lines.join('\r\n');
}

export function downloadMultiSectionCsv(
  filename: string,
  sections: Parameters<typeof buildMultiSectionCsv>[0],
): void {
  const content = buildMultiSectionCsv(sections);
  const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
