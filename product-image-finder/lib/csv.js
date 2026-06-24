// lib/csv.js
// Minimal CSV parser — handles the common case (no embedded commas/quotes
// inside fields). Good enough for a "Product Name, Brand" style upload.

export function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  const headers = lines[0].split(",").map((h) => h.trim());
  const nameIdx = headers.findIndex((h) => /product\s*name/i.test(h));
  const brandIdx = headers.findIndex((h) => /brand/i.test(h));

  return lines
    .slice(1)
    .map((line, i) => {
      const cells = line.split(",").map((c) => c.trim());
      return {
        rowNumber: i + 1,
        productName: cells[nameIdx >= 0 ? nameIdx : 0] || "",
        brand: brandIdx >= 0 ? cells[brandIdx] || "" : "",
      };
    })
    .filter((r) => r.productName);
}

export function toCsvValue(v) {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function rowsToCsv(rows) {
  const headers = ["Product Name", "Brand", "Matched Title", "Image URL", "Source"];
  const lines = [headers.join(",")];
  rows.forEach((r) => {
    const best = r.results?.[0];
    lines.push(
      [
        r.productName,
        r.brand || "",
        best?.title || "",
        best?.imageUrl || "",
        best?.source || "",
      ]
        .map(toCsvValue)
        .join(",")
    );
  });
  return lines.join("\n");
}

export function downloadCsv(content, filename) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
