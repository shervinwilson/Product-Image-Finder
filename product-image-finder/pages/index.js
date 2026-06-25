// pages/index.js
import { useState, useCallback, useRef, useEffect } from "react";
import { parseCsv, rowsToCsv, downloadCsv } from "../lib/csv";

const SAMPLE_CSV = `Product Name,Brand
iPhone 16 Pro Max,Apple
Galaxy S25 Ultra,Samsung
WH-1000XM5 Headphones,Sony
Instant Pot Duo,Instant Pot`;

const FILENAME_PATTERNS = [
  { label: "{productName}", value: "{productName}" },
  { label: "{brand}-{productName}", value: "{brand}-{productName}" },
  { label: "{productName}-{index}", value: "{productName}-{index}" },
  { label: "{brand}_{productName}_{index}", value: "{brand}_{productName}_{index}" },
];

function buildFilename(pattern, productName, brand, index) {
  return (pattern || "{productName}")
    .replace("{productName}", productName || "image")
    .replace("{brand}", brand || "unknown")
    .replace("{index}", index + 1)
    .replace(/[^a-zA-Z0-9\-_().]/g, "_")
    + ".jpg";
}

async function downloadImage(url, filename) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename || "image.jpg";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  } catch {
    window.open(url, "_blank");
  }
}

async function downloadAsZip(items) {
  // Dynamic import JSZip from CDN
  const script = document.createElement("script");
  script.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
  document.head.appendChild(script);
  await new Promise((res) => (script.onload = res));

  const zip = new window.JSZip();
  const folder = zip.folder("product-images");

  for (const item of items) {
    try {
      const res = await fetch(item.url);
      const blob = await res.blob();
      folder.file(item.filename, blob);
    } catch {
      // skip failed images
    }
  }

  const content = await zip.generateAsync({ type: "blob" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(content);
  a.download = "product-images.zip";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

async function fetchImagesFor(productName, brand) {
  const res = await fetch("/api/search-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productName, brand }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Search failed");
  return data.results || [];
}

const SESSION_KEY = "pif_session";

export default function Home() {
  // Single search
  const [singleName, setSingleName] = useState("");
  const [singleBrand, setSingleBrand] = useState("");
  const [singleLoading, setSingleLoading] = useState(false);
  const [singleError, setSingleError] = useState(null);
  const [singleResults, setSingleResults] = useState(null);
  const [selectedSingle, setSelectedSingle] = useState([]);

  // Preview modal
  const [preview, setPreview] = useState(null); // { url, title, link }

  // Filename pattern
  const [filenamePattern, setFilenamePattern] = useState("{productName}");

  // Batch
  const [batchRows, setBatchRows] = useState([]);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState(0);
  const [selectedRows, setSelectedRows] = useState([]);
  const [pickedImage, setPickedImage] = useState({}); // idx -> result index
  const [zipLoading, setZipLoading] = useState(false);
  const fileInputRef = useRef(null);
  const cancelRef = useRef(false);

  // Restore session on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SESSION_KEY);
      if (saved) {
        const { batchRows: rows, batchProgress: prog } = JSON.parse(saved);
        if (rows?.length) {
          setBatchRows(rows);
          setBatchProgress(prog || 0);
        }
      }
    } catch {}
  }, []);

  // Save session whenever batchRows change
  useEffect(() => {
    if (batchRows.length > 0) {
      try {
        localStorage.setItem(SESSION_KEY, JSON.stringify({ batchRows, batchProgress }));
      } catch {}
    }
  }, [batchRows, batchProgress]);

  const clearSession = () => {
    localStorage.removeItem(SESSION_KEY);
    setBatchRows([]);
    setSelectedRows([]);
    setPickedImage({});
    setBatchProgress(0);
  };

  const runSingleSearch = useCallback(async (e) => {
    e.preventDefault();
    if (!singleName.trim()) return;
    setSingleLoading(true);
    setSingleError(null);
    setSingleResults(null);
    try {
      const results = await fetchImagesFor(singleName.trim(), singleBrand.trim());
      setSingleResults(results);
      setSelectedSingle([]);
    } catch (err) {
      setSingleError(err.message);
    } finally {
      setSingleLoading(false);
    }
  }, [singleName, singleBrand]);

  const handleFile = useCallback((file) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const parsed = parseCsv(ev.target.result);
      setBatchRows(parsed.map((p) => ({ ...p, status: "pending", results: null, error: null })));
      setSelectedRows([]);
      setPickedImage({});
    };
    reader.readAsText(file);
  }, []);

  const loadSample = useCallback(() => {
    const parsed = parseCsv(SAMPLE_CSV);
    setBatchRows(parsed.map((p) => ({ ...p, status: "pending", results: null, error: null })));
    setSelectedRows([]);
    setPickedImage({});
  }, []);

  const runBatch = useCallback(async () => {
    if (batchRows.length === 0) return;
    setBatchRunning(true);
    cancelRef.current = false;
    setBatchProgress(0);

    for (let i = 0; i < batchRows.length; i++) {
      if (cancelRef.current) break;
      if (batchRows[i].status === "done") {
        setBatchProgress(Math.round(((i + 1) / batchRows.length) * 100));
        continue;
      }

      setBatchRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, status: "loading" } : r)));

      try {
        const results = await fetchImagesFor(batchRows[i].productName, batchRows[i].brand);
        setBatchRows((prev) =>
          prev.map((r, idx) =>
            idx === i ? { ...r, status: results.length ? "done" : "not_found", results } : r
          )
        );
      } catch (err) {
        setBatchRows((prev) =>
          prev.map((r, idx) => (idx === i ? { ...r, status: "error", error: err.message } : r))
        );
      }

      setBatchProgress(Math.round(((i + 1) / batchRows.length) * 100));
      if (i < batchRows.length - 1) await new Promise((r) => setTimeout(r, 600));
    }
    setBatchRunning(false);
  }, [batchRows]);

  const retryFailed = useCallback(async () => {
    const failedIndices = batchRows
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => r.status === "error" || r.status === "not_found")
      .map(({ i }) => i);
    if (!failedIndices.length) return;

    setBatchRunning(true);
    cancelRef.current = false;

    for (const i of failedIndices) {
      if (cancelRef.current) break;
      setBatchRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, status: "loading" } : r)));
      try {
        const results = await fetchImagesFor(batchRows[i].productName, batchRows[i].brand);
        setBatchRows((prev) =>
          prev.map((r, idx) =>
            idx === i ? { ...r, status: results.length ? "done" : "not_found", results } : r
          )
        );
      } catch (err) {
        setBatchRows((prev) =>
          prev.map((r, idx) => (idx === i ? { ...r, status: "error", error: err.message } : r))
        );
      }
      await new Promise((r) => setTimeout(r, 600));
    }
    setBatchRunning(false);
  }, [batchRows]);

  const stopBatch = useCallback(() => {
    cancelRef.current = true;
    setBatchRunning(false);
  }, []);

  const exportResults = useCallback(() => {
    downloadCsv(rowsToCsv(batchRows), "product-images-results.csv");
  }, [batchRows]);

  // Batch selection helpers
  const rowsWithImages = batchRows.map((r, i) => ({ ...r, idx: i })).filter((r) => r.results?.[0]?.thumbnailUrl);
  const allSelected = rowsWithImages.length > 0 && rowsWithImages.every((r) => selectedRows.includes(r.idx));

  const toggleSelectAll = () => {
    setSelectedRows(allSelected ? [] : rowsWithImages.map((r) => r.idx));
  };
  const toggleRow = (idx) => {
    setSelectedRows((prev) => prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]);
  };

  const getPickedResult = (row, idx) => {
    const pick = pickedImage[idx] ?? 0;
    return row.results?.[pick] || row.results?.[0];
  };

  const downloadSelected = async () => {
    const toDownload = batchRows
      .map((r, i) => ({ ...r, idx: i }))
      .filter((r) => selectedRows.includes(r.idx));
    for (const row of toDownload) {
      const result = getPickedResult(row, row.idx);
      if (!result?.thumbnailUrl) continue;
      const filename = buildFilename(filenamePattern, row.productName, row.brand, row.idx);
      await downloadImage(result.thumbnailUrl, filename);
      await new Promise((r) => setTimeout(r, 200));
    }
  };

  const downloadSelectedZip = async () => {
    setZipLoading(true);
    const items = batchRows
      .map((r, i) => ({ ...r, idx: i }))
      .filter((r) => selectedRows.includes(r.idx))
      .map((row) => {
        const result = getPickedResult(row, row.idx);
        return result?.thumbnailUrl
          ? { url: result.thumbnailUrl, filename: buildFilename(filenamePattern, row.productName, row.brand, row.idx) }
          : null;
      })
      .filter(Boolean);
    await downloadAsZip(items);
    setZipLoading(false);
  };

  const failedCount = batchRows.filter((r) => r.status === "error" || r.status === "not_found").length;

  return (
    <div style={styles.page}>
      <style>{globalCss}</style>

      {/* Preview Modal */}
      {preview && (
        <div style={styles.modalOverlay} onClick={() => setPreview(null)}>
          <div style={styles.modalBox} onClick={(e) => e.stopPropagation()}>
            <button style={styles.modalClose} onClick={() => setPreview(null)}>✕</button>
            <img src={preview.url} alt={preview.title} style={styles.modalImg} />
            <p style={styles.modalTitle}>{preview.title}</p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
              <a href={preview.link} target="_blank" rel="noreferrer" style={styles.modalLinkBtn}>
                Open source ↗
              </a>
              <button style={styles.modalDownloadBtn} onClick={() => downloadImage(preview.url, `${preview.title || "image"}.jpg`)}>
                ⬇ Download
              </button>
              <button style={styles.modalCopyBtn} onClick={() => { navigator.clipboard.writeText(preview.url); }}>
                📋 Copy URL
              </button>
            </div>
          </div>
        </div>
      )}

      <header style={styles.header}>
        <h1 style={styles.h1}>🛍️ Product Image Finder</h1>
        <p style={styles.subtitle}>
          Find, preview, select and download product images for your e-commerce catalog. Search one product or bulk upload a CSV.
        </p>
      </header>

      {/* Filename Pattern */}
      <section style={styles.card}>
        <h2 style={styles.h2}>⚙️ Download filename pattern</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {FILENAME_PATTERNS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => setFilenamePattern(p.value)}
              style={filenamePattern === p.value ? styles.patternBtnActive : styles.patternBtn}
            >
              {p.label}
            </button>
          ))}
          <input
            type="text"
            value={filenamePattern}
            onChange={(e) => setFilenamePattern(e.target.value)}
            style={{ ...styles.input, maxWidth: 260, fontSize: 13 }}
            placeholder="Custom pattern…"
          />
        </div>
        <p style={{ ...styles.mutedText, marginTop: 6, marginBottom: 0 }}>
          Preview: <code style={{ background: "#f3f4f6", padding: "1px 6px", borderRadius: 4 }}>{buildFilename(filenamePattern, "iPhone-16-Pro", "Apple", 0)}</code>
        </p>
      </section>

      {/* Single search */}
      <section style={styles.card}>
        <h2 style={styles.h2}>🔍 Search one product</h2>
        <form onSubmit={runSingleSearch} style={styles.singleForm}>
          <input
            type="text"
            placeholder="Product name (e.g. iPhone 16 Pro Max)"
            value={singleName}
            onChange={(e) => setSingleName(e.target.value)}
            style={styles.input}
          />
          <input
            type="text"
            placeholder="Brand (optional)"
            value={singleBrand}
            onChange={(e) => setSingleBrand(e.target.value)}
            style={{ ...styles.input, maxWidth: 180 }}
          />
          <button type="submit" disabled={singleLoading || !singleName.trim()} style={styles.btnPrimary}>
            {singleLoading ? "Searching…" : "Search"}
          </button>
        </form>

        {singleError && <p style={styles.errorText}>{singleError}</p>}

        {singleResults && (
          <>
            {singleResults.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16, marginBottom: 4, flexWrap: "wrap" }}>
                <label style={styles.selectAllLabel}>
                  <input
                    type="checkbox"
                    checked={selectedSingle.length === singleResults.length}
                    onChange={() =>
                      setSelectedSingle(
                        selectedSingle.length === singleResults.length ? [] : singleResults.map((_, i) => i)
                      )
                    }
                  />
                  Select All
                </label>
                {selectedSingle.length > 0 && (
                  <>
                    <button
                      type="button"
                      style={styles.btnDownloadSelected}
                      onClick={() =>
                        selectedSingle.forEach((i, n) =>
                          setTimeout(() =>
                            downloadImage(
                              singleResults[i].thumbnailUrl,
                              buildFilename(filenamePattern, singleName, singleBrand, i)
                            ), n * 200)
                        )
                      }
                    >
                      ⬇ Download ({selectedSingle.length})
                    </button>
                    <button
                      type="button"
                      style={styles.btnZip}
                      onClick={async () => {
                        setZipLoading(true);
                        await downloadAsZip(
                          selectedSingle.map((i) => ({
                            url: singleResults[i].thumbnailUrl,
                            filename: buildFilename(filenamePattern, singleName, singleBrand, i),
                          }))
                        );
                        setZipLoading(false);
                      }}
                    >
                      {zipLoading ? "Zipping…" : "📦 Download ZIP"}
                    </button>
                  </>
                )}
              </div>
            )}
            <div style={styles.imageGrid}>
              {singleResults.length === 0 && <p style={styles.mutedText}>No images found.</p>}
              {singleResults.map((r, i) => (
                <div
                  key={i}
                  style={{
                    ...styles.imageCard,
                    outline: selectedSingle.includes(i) ? "2px solid #2f5fd6" : "none",
                  }}
                >
                  <div style={{ position: "relative" }}>
                    <input
                      type="checkbox"
                      checked={selectedSingle.includes(i)}
                      onChange={() =>
                        setSelectedSingle((prev) =>
                          prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]
                        )
                      }
                      style={styles.imageCheckbox}
                    />
                    <img
                      src={r.thumbnailUrl}
                      alt={r.title}
                      style={{ ...styles.imageThumb, cursor: "zoom-in" }}
                      loading="lazy"
                      onClick={() => setPreview({ url: r.thumbnailUrl, title: r.title, link: r.link })}
                    />
                  </div>
                  <span style={styles.imageCardTitle}>{r.title}</span>
                  <span style={styles.imageCardSource}>{r.source}</span>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button
                      type="button"
                      style={{ ...styles.btnDownload, flex: 1 }}
                      onClick={() => downloadImage(r.thumbnailUrl, buildFilename(filenamePattern, singleName, singleBrand, i))}
                    >
                      ⬇
                    </button>
                    <button
                      type="button"
                      style={styles.btnCopy}
                      title="Copy image URL"
                      onClick={() => navigator.clipboard.writeText(r.thumbnailUrl)}
                    >
                      📋
                    </button>
                    <a href={r.link} target="_blank" rel="noreferrer" style={styles.btnLink} title="Open source">
                      ↗
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {/* Batch / CSV upload */}
      <section style={styles.card}>
        <h2 style={styles.h2}>📦 Bulk upload (CSV)</h2>
        <p style={styles.mutedText}>
          Columns: <code>Product Name</code> (required), <code>Brand</code> (optional)
        </p>

        <div style={styles.row}>
          <button type="button" style={styles.btnSecondary} onClick={() => fileInputRef.current?.click()} disabled={batchRunning}>
            Choose CSV file
          </button>
          <button type="button" style={styles.btnGhost} onClick={loadSample} disabled={batchRunning}>
            Load sample data
          </button>
          {batchRows.length > 0 && (
            <button type="button" style={{ ...styles.btnGhost, color: "#c4432f" }} onClick={clearSession} disabled={batchRunning}>
              Clear session
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
        </div>

        {batchRows.length > 0 && (
          <>
            <div style={styles.row}>
              {!batchRunning ? (
                <button type="button" style={styles.btnPrimary} onClick={runBatch}>
                  Find images for {batchRows.length} products
                </button>
              ) : (
                <button type="button" style={styles.btnSecondary} onClick={stopBatch}>
                  Stop
                </button>
              )}
              {failedCount > 0 && !batchRunning && (
                <button type="button" style={styles.btnRetry} onClick={retryFailed}>
                  🔄 Retry failed ({failedCount})
                </button>
              )}
              <button type="button" style={styles.btnGhost} onClick={exportResults} disabled={batchRunning || !batchRows.some((r) => r.results)}>
                Export CSV
              </button>
              {selectedRows.length > 0 && (
                <>
                  <button type="button" style={styles.btnDownloadSelected} onClick={downloadSelected}>
                    ⬇ Download ({selectedRows.length})
                  </button>
                  <button type="button" style={styles.btnZip} onClick={downloadSelectedZip} disabled={zipLoading}>
                    {zipLoading ? "Zipping…" : "📦 ZIP"}
                  </button>
                </>
              )}
              <span style={styles.mutedText}>{batchProgress}% complete</span>
            </div>

            <div style={styles.progressBar}>
              <div style={{ ...styles.progressFill, width: `${batchProgress}%` }} />
            </div>

            <div style={styles.tableWrap}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={{ ...styles.th, width: 36 }}>
                      <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} disabled={rowsWithImages.length === 0} title="Select all" />
                    </th>
                    <th style={styles.th}>Product name</th>
                    <th style={styles.th}>Brand</th>
                    <th style={styles.th}>Image</th>
                    <th style={styles.th}>Pick</th>
                    <th style={styles.th}>Matched title</th>
                    <th style={styles.th}>Actions</th>
                    <th style={styles.th}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {batchRows.map((row, i) => {
                    const pickedIdx = pickedImage[i] ?? 0;
                    const activeResult = row.results?.[pickedIdx] || row.results?.[0];
                    return (
                      <tr key={i} style={selectedRows.includes(i) ? { background: "#f0f4ff" } : {}}>
                        <td style={{ ...styles.td, textAlign: "center" }}>
                          {activeResult?.thumbnailUrl ? (
                            <input type="checkbox" checked={selectedRows.includes(i)} onChange={() => toggleRow(i)} />
                          ) : null}
                        </td>
                        <td style={styles.td}>{row.productName}</td>
                        <td style={styles.td}>{row.brand || "—"}</td>
                        <td style={styles.td}>
                          {activeResult?.thumbnailUrl ? (
                            <img
                              src={activeResult.thumbnailUrl}
                              alt=""
                              style={{ width: 44, height: 44, objectFit: "contain", cursor: "zoom-in", borderRadius: 4 }}
                              onClick={() => setPreview({ url: activeResult.thumbnailUrl, title: activeResult.title, link: activeResult.link })}
                            />
                          ) : "—"}
                        </td>
                        <td style={styles.td}>
                          {row.results?.length > 1 ? (
                            <select
                              value={pickedIdx}
                              onChange={(e) => setPickedImage((prev) => ({ ...prev, [i]: Number(e.target.value) }))}
                              style={styles.pickSelect}
                            >
                              {row.results.map((r, n) => (
                                <option key={n} value={n}>#{n + 1} {r.source}</option>
                              ))}
                            </select>
                          ) : "—"}
                        </td>
                        <td style={{ ...styles.td, maxWidth: 200, fontSize: 12 }}>
                          {activeResult?.title || "—"}
                        </td>
                        <td style={styles.td}>
                          {activeResult?.thumbnailUrl ? (
                            <div style={{ display: "flex", gap: 4 }}>
                              <button
                                type="button"
                                style={styles.btnDownloadSmall}
                                title="Download"
                                onClick={() => downloadImage(activeResult.thumbnailUrl, buildFilename(filenamePattern, row.productName, row.brand, i))}
                              >
                                ⬇
                              </button>
                              <button
                                type="button"
                                style={styles.btnCopySmall}
                                title="Copy URL"
                                onClick={() => navigator.clipboard.writeText(activeResult.thumbnailUrl)}
                              >
                                📋
                              </button>
                            </div>
                          ) : null}
                        </td>
                        <td style={styles.td}>
                          <StatusBadge status={row.status} error={row.error} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <footer style={styles.footer}>
        Image results come from Google Images via SerpAPI. Images link back to their original source.
      </footer>
    </div>
  );
}

function StatusBadge({ status, error }) {
  const map = {
    pending: { label: "Pending", color: "#6b7280", bg: "#f3f4f6" },
    loading: { label: "Searching…", color: "#1d4ed8", bg: "#eff6ff" },
    done: { label: "Found", color: "#15803d", bg: "#f0fdf4" },
    not_found: { label: "Not found", color: "#b45309", bg: "#fffbeb" },
    error: { label: "Error", color: "#b91c1c", bg: "#fef2f2" },
  };
  const cfg = map[status] || map.pending;
  return (
    <span title={error || ""} style={{ display: "inline-block", fontSize: 12, fontWeight: 600, padding: "2px 8px", borderRadius: 999, color: cfg.color, background: cfg.bg }}>
      {cfg.label}
    </span>
  );
}

const styles = {
  page: { maxWidth: 960, margin: "0 auto", padding: "32px 20px 60px", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", color: "#1a1d23" },
  header: { marginBottom: 24 },
  h1: { fontSize: 24, fontWeight: 700, margin: "0 0 6px" },
  subtitle: { fontSize: 14, color: "#5b6270", margin: 0, lineHeight: 1.5, maxWidth: 600 },
  card: { background: "#fff", border: "1px solid #e4e6eb", borderRadius: 12, padding: 24, marginBottom: 20 },
  h2: { fontSize: 15, fontWeight: 700, margin: "0 0 14px" },
  singleForm: { display: "flex", gap: 10, flexWrap: "wrap" },
  input: { flex: 1, minWidth: 200, padding: "10px 12px", fontSize: 14, border: "1px solid #d1d5db", borderRadius: 8, outline: "none" },
  row: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14 },
  selectAllLabel: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, cursor: "pointer", color: "#1a1d23" },
  btnPrimary: { background: "#2f5fd6", color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontSize: 14, fontWeight: 600, cursor: "pointer" },
  btnSecondary: { background: "#fff", color: "#1a1d23", border: "1px solid #d1d5db", borderRadius: 8, padding: "10px 16px", fontSize: 14, fontWeight: 600, cursor: "pointer" },
  btnGhost: { background: "transparent", color: "#2f5fd6", border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer", padding: "10px 4px" },
  btnRetry: { background: "#fff7ed", color: "#b45309", border: "1px solid #fed7aa", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" },
  btnDownloadSelected: { background: "#2f5fd6", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" },
  btnZip: { background: "#7c3aed", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" },
  patternBtn: { background: "#f3f4f6", color: "#374151", border: "1px solid #e5e7eb", borderRadius: 6, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" },
  patternBtnActive: { background: "#eff6ff", color: "#2f5fd6", border: "1px solid #bfdbfe", borderRadius: 6, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" },
  errorText: { color: "#c4432f", fontSize: 13, marginTop: 10 },
  mutedText: { color: "#5b6270", fontSize: 13, margin: "4px 0 14px" },
  imageGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12, marginTop: 16 },
  imageCard: { border: "1px solid #e4e6eb", borderRadius: 8, padding: 8, color: "#1a1d23", display: "flex", flexDirection: "column", gap: 4, background: "#fff", transition: "box-shadow 0.15s" },
  imageCheckbox: { position: "absolute", top: 6, left: 6, width: 16, height: 16, cursor: "pointer", zIndex: 2, accentColor: "#2f5fd6" },
  imageThumb: { width: "100%", height: 100, objectFit: "contain", background: "#f7f8fa", borderRadius: 6 },
  imageCardTitle: { fontSize: 11.5, fontWeight: 600, lineHeight: 1.3, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" },
  imageCardSource: { fontSize: 10.5, color: "#5b6270" },
  btnDownload: { background: "#f0f4ff", color: "#2f5fd6", border: "1px solid #c7d4f8", borderRadius: 6, padding: "5px 0", fontSize: 12, fontWeight: 600, cursor: "pointer" },
  btnCopy: { background: "#f3f4f6", color: "#374151", border: "1px solid #e5e7eb", borderRadius: 6, padding: "5px 8px", fontSize: 12, cursor: "pointer" },
  btnLink: { background: "#f3f4f6", color: "#374151", border: "1px solid #e5e7eb", borderRadius: 6, padding: "5px 8px", fontSize: 12, cursor: "pointer", textDecoration: "none", display: "flex", alignItems: "center" },
  progressBar: { height: 6, background: "#f1f2f5", borderRadius: 999, overflow: "hidden", marginBottom: 16 },
  progressFill: { height: "100%", background: "#2f5fd6", transition: "width 0.3s ease" },
  tableWrap: { overflowX: "auto", border: "1px solid #e4e6eb", borderRadius: 8 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 700 },
  th: { textAlign: "left", padding: "10px 12px", background: "#f7f8fa", borderBottom: "1px solid #e4e6eb", fontSize: 11, textTransform: "uppercase", color: "#5b6270", fontWeight: 600 },
  td: { padding: "8px 12px", borderBottom: "1px solid #f1f2f5", verticalAlign: "middle" },
  btnDownloadSmall: { background: "#f0f4ff", color: "#2f5fd6", border: "1px solid #c7d4f8", borderRadius: 4, padding: "3px 8px", fontSize: 12, fontWeight: 600, cursor: "pointer" },
  btnCopySmall: { background: "#f3f4f6", color: "#374151", border: "1px solid #e5e7eb", borderRadius: 4, padding: "3px 8px", fontSize: 12, cursor: "pointer" },
  pickSelect: { fontSize: 12, padding: "3px 6px", borderRadius: 6, border: "1px solid #d1d5db", background: "#fff", cursor: "pointer", maxWidth: 130 },
  footer: { fontSize: 12, color: "#9aa0aa", textAlign: "center", marginTop: 8 },
  // Modal
  modalOverlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" },
  modalBox: { background: "#fff", borderRadius: 14, padding: 24, maxWidth: 480, width: "90%", position: "relative", textAlign: "center" },
  modalClose: { position: "absolute", top: 12, right: 14, background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#6b7280" },
  modalImg: { maxWidth: "100%", maxHeight: 320, objectFit: "contain", borderRadius: 8, marginBottom: 12, background: "#f7f8fa" },
  modalTitle: { fontSize: 13, color: "#374151", marginBottom: 14 },
  modalLinkBtn: { background: "#f3f4f6", color: "#1a1d23", border: "1px solid #e5e7eb", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, textDecoration: "none" },
  modalDownloadBtn: { background: "#2f5fd6", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" },
  modalCopyBtn: { background: "#f3f4f6", color: "#374151", border: "1px solid #e5e7eb", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" },
};

const globalCss = `
  body { margin: 0; background: #f7f8fa; }
  input:focus { border-color: #2f5fd6 !important; }
  table { table-layout: auto; }
  tr:hover td { background: #fafbff; }
`;
