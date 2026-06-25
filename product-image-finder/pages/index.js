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
    .replace(/[^a-zA-Z0-9\-_().]/g, "_") + ".jpg";
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
    } catch {}
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

// ─── Preloader ───────────────────────────────────────────────
function Preloader({ done }) {
  const [hide, setHide] = useState(false);
  useEffect(() => {
    if (done) setTimeout(() => setHide(true), 700);
  }, [done]);
  if (hide) return null;
  return (
    <div style={{ ...pre.overlay, opacity: done ? 0 : 1, pointerEvents: done ? "none" : "all", transition: "opacity 0.7s ease" }}>
      <div style={pre.inner}>
        <div style={pre.logoMark}>
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <rect width="48" height="48" rx="14" fill="url(#pg)" />
            <path d="M14 24 L24 14 L34 24 L24 34 Z" fill="white" opacity="0.9" />
            <path d="M24 18 L30 24 L24 30 L18 24 Z" fill="url(#pg2)" />
            <defs>
              <linearGradient id="pg" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
                <stop stopColor="#6366f1" />
                <stop offset="1" stopColor="#8b5cf6" />
              </linearGradient>
              <linearGradient id="pg2" x1="18" y1="18" x2="30" y2="30" gradientUnits="userSpaceOnUse">
                <stop stopColor="#6366f1" />
                <stop offset="1" stopColor="#a78bfa" />
              </linearGradient>
            </defs>
          </svg>
        </div>
        <p style={pre.label}>Product Image Finder</p>
        <div style={pre.barTrack}>
          <div style={pre.barFill} />
        </div>
        <p style={pre.sub}>Loading workspace…</p>
      </div>
    </div>
  );
}

const pre = {
  overlay: { position: "fixed", inset: 0, background: "#0f0f14", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" },
  inner: { display: "flex", flexDirection: "column", alignItems: "center", gap: 16 },
  logoMark: { animation: "spin 2s linear infinite" },
  label: { color: "#fff", fontSize: 18, fontWeight: 700, margin: 0, letterSpacing: "-0.02em", fontFamily: "system-ui" },
  barTrack: { width: 160, height: 3, background: "#1e1e2e", borderRadius: 99, overflow: "hidden" },
  barFill: { height: "100%", width: "100%", background: "linear-gradient(90deg,#6366f1,#a78bfa)", borderRadius: 99, animation: "slide 1.4s ease-in-out infinite" },
  sub: { color: "#555", fontSize: 12, margin: 0, fontFamily: "system-ui" },
};

export default function Home() {
  const [ready, setReady] = useState(false);

  // Single search
  const [singleName, setSingleName] = useState("");
  const [singleBrand, setSingleBrand] = useState("");
  const [singleLoading, setSingleLoading] = useState(false);
  const [singleError, setSingleError] = useState(null);
  const [singleResults, setSingleResults] = useState(null);
  const [selectedSingle, setSelectedSingle] = useState([]);

  // Modal
  const [preview, setPreview] = useState(null);

  // Filename
  const [filenamePattern, setFilenamePattern] = useState("{productName}");

  // Batch
  const [batchRows, setBatchRows] = useState([]);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState(0);
  const [selectedRows, setSelectedRows] = useState([]);
  const [pickedImage, setPickedImage] = useState({});
  const [zipLoading, setZipLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("single"); // "single" | "bulk"
  const [toast, setToast] = useState(null);

  const fileInputRef = useRef(null);
  const cancelRef = useRef(false);

  useEffect(() => {
    setTimeout(() => setReady(true), 1800);
    try {
      const saved = localStorage.getItem(SESSION_KEY);
      if (saved) {
        const { batchRows: rows, batchProgress: prog } = JSON.parse(saved);
        if (rows?.length) { setBatchRows(rows); setBatchProgress(prog || 0); }
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (batchRows.length > 0) {
      try { localStorage.setItem(SESSION_KEY, JSON.stringify({ batchRows, batchProgress })); } catch {}
    }
  }, [batchRows, batchProgress]);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const clearSession = () => {
    localStorage.removeItem(SESSION_KEY);
    setBatchRows([]); setSelectedRows([]); setPickedImage({}); setBatchProgress(0);
  };

  const runSingleSearch = useCallback(async (e) => {
    e.preventDefault();
    if (!singleName.trim()) return;
    setSingleLoading(true); setSingleError(null); setSingleResults(null);
    try {
      const results = await fetchImagesFor(singleName.trim(), singleBrand.trim());
      setSingleResults(results); setSelectedSingle([]);
    } catch (err) { setSingleError(err.message); }
    finally { setSingleLoading(false); }
  }, [singleName, singleBrand]);

  const handleFile = useCallback((file) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const parsed = parseCsv(ev.target.result);
      setBatchRows(parsed.map((p) => ({ ...p, status: "pending", results: null, error: null })));
      setSelectedRows([]); setPickedImage({});
    };
    reader.readAsText(file);
  }, []);

  const loadSample = useCallback(() => {
    const parsed = parseCsv(SAMPLE_CSV);
    setBatchRows(parsed.map((p) => ({ ...p, status: "pending", results: null, error: null })));
    setSelectedRows([]); setPickedImage({});
  }, []);

  const runBatch = useCallback(async () => {
    if (!batchRows.length) return;
    setBatchRunning(true); cancelRef.current = false; setBatchProgress(0);
    for (let i = 0; i < batchRows.length; i++) {
      if (cancelRef.current) break;
      if (batchRows[i].status === "done") { setBatchProgress(Math.round(((i + 1) / batchRows.length) * 100)); continue; }
      setBatchRows((prev) => prev.map((r, idx) => idx === i ? { ...r, status: "loading" } : r));
      try {
        const results = await fetchImagesFor(batchRows[i].productName, batchRows[i].brand);
        setBatchRows((prev) => prev.map((r, idx) => idx === i ? { ...r, status: results.length ? "done" : "not_found", results } : r));
      } catch (err) {
        setBatchRows((prev) => prev.map((r, idx) => idx === i ? { ...r, status: "error", error: err.message } : r));
      }
      setBatchProgress(Math.round(((i + 1) / batchRows.length) * 100));
      if (i < batchRows.length - 1) await new Promise((r) => setTimeout(r, 600));
    }
    setBatchRunning(false);
  }, [batchRows]);

  const retryFailed = useCallback(async () => {
    const failed = batchRows.map((r, i) => ({ r, i })).filter(({ r }) => r.status === "error" || r.status === "not_found").map(({ i }) => i);
    if (!failed.length) return;
    setBatchRunning(true); cancelRef.current = false;
    for (const i of failed) {
      if (cancelRef.current) break;
      setBatchRows((prev) => prev.map((r, idx) => idx === i ? { ...r, status: "loading" } : r));
      try {
        const results = await fetchImagesFor(batchRows[i].productName, batchRows[i].brand);
        setBatchRows((prev) => prev.map((r, idx) => idx === i ? { ...r, status: results.length ? "done" : "not_found", results } : r));
      } catch (err) {
        setBatchRows((prev) => prev.map((r, idx) => idx === i ? { ...r, status: "error", error: err.message } : r));
      }
      await new Promise((r) => setTimeout(r, 600));
    }
    setBatchRunning(false);
  }, [batchRows]);

  const stopBatch = useCallback(() => { cancelRef.current = true; setBatchRunning(false); }, []);
  const exportResults = useCallback(() => { downloadCsv(rowsToCsv(batchRows), "product-images-results.csv"); }, [batchRows]);

  const rowsWithImages = batchRows.map((r, i) => ({ ...r, idx: i })).filter((r) => r.results?.[0]?.thumbnailUrl);
  const allSelected = rowsWithImages.length > 0 && rowsWithImages.every((r) => selectedRows.includes(r.idx));
  const toggleSelectAll = () => setSelectedRows(allSelected ? [] : rowsWithImages.map((r) => r.idx));
  const toggleRow = (idx) => setSelectedRows((prev) => prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]);
  const getPickedResult = (row, idx) => row.results?.[pickedImage[idx] ?? 0] || row.results?.[0];

  const downloadSelected = async () => {
    const rows = batchRows.map((r, i) => ({ ...r, idx: i })).filter((r) => selectedRows.includes(r.idx));
    for (const row of rows) {
      const result = getPickedResult(row, row.idx);
      if (!result?.thumbnailUrl) continue;
      await downloadImage(result.thumbnailUrl, buildFilename(filenamePattern, row.productName, row.brand, row.idx));
      await new Promise((r) => setTimeout(r, 200));
    }
  };

  const downloadSelectedZip = async () => {
    setZipLoading(true);
    const items = batchRows.map((r, i) => ({ ...r, idx: i })).filter((r) => selectedRows.includes(r.idx))
      .map((row) => { const result = getPickedResult(row, row.idx); return result?.thumbnailUrl ? { url: result.thumbnailUrl, filename: buildFilename(filenamePattern, row.productName, row.brand, row.idx) } : null; })
      .filter(Boolean);
    await downloadAsZip(items);
    setZipLoading(false);
  };

  const failedCount = batchRows.filter((r) => r.status === "error" || r.status === "not_found").length;

  return (
    <>
      <style>{CSS}</style>
      <Preloader done={ready} />

      {/* Toast */}
      {toast && <div className="toast">{toast}</div>}

      {/* Preview Modal */}
      {preview && (
        <div className="modal-overlay" onClick={() => setPreview(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setPreview(null)}>✕</button>
            <div className="modal-img-wrap">
              <img src={preview.url} alt={preview.title} className="modal-img" />
            </div>
            <p className="modal-title">{preview.title}</p>
            <div className="modal-actions">
              <a href={preview.link} target="_blank" rel="noreferrer" className="btn-ghost-sm">Open source ↗</a>
              <button className="btn-primary-sm" onClick={() => { downloadImage(preview.url, `${preview.title || "image"}.jpg`); }}>⬇ Download</button>
              <button className="btn-ghost-sm" onClick={() => { navigator.clipboard.writeText(preview.url); showToast("URL copied!"); }}>📋 Copy URL</button>
            </div>
          </div>
        </div>
      )}

      <div className="page">
        {/* Header */}
        <header className="header">
          <div className="header-left">
            <div className="logo-mark">
              <svg width="36" height="36" viewBox="0 0 48 48" fill="none">
                <rect width="48" height="48" rx="14" fill="url(#hg)" />
                <path d="M14 24 L24 14 L34 24 L24 34 Z" fill="white" opacity="0.9" />
                <path d="M24 18 L30 24 L24 30 L18 24 Z" fill="url(#hg2)" />
                <defs>
                  <linearGradient id="hg" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#6366f1" /><stop offset="1" stopColor="#8b5cf6" />
                  </linearGradient>
                  <linearGradient id="hg2" x1="18" y1="18" x2="30" y2="30" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#4f46e5" /><stop offset="1" stopColor="#c4b5fd" />
                  </linearGradient>
                </defs>
              </svg>
            </div>
            <div>
              <h1 className="site-title">Product Image Finder</h1>
              <p className="site-sub">E-commerce image sourcing, simplified</p>
            </div>
          </div>
          <div className="header-badge">Powered by SerpAPI</div>
        </header>

        {/* Tabs */}
        <div className="tab-bar">
          <button className={`tab ${activeTab === "single" ? "tab-active" : ""}`} onClick={() => setActiveTab("single")}>
            <span className="tab-icon">🔍</span> Single Search
          </button>
          <button className={`tab ${activeTab === "bulk" ? "tab-active" : ""}`} onClick={() => setActiveTab("bulk")}>
            <span className="tab-icon">📦</span> Bulk CSV
          </button>
        </div>

        {/* Filename Pattern Card */}
        <div className="card pattern-card">
          <div className="card-label">⚙️ Filename Pattern</div>
          <div className="pattern-row">
            {FILENAME_PATTERNS.map((p) => (
              <button key={p.value} className={`chip ${filenamePattern === p.value ? "chip-active" : ""}`} onClick={() => setFilenamePattern(p.value)}>
                {p.label}
              </button>
            ))}
            <input className="pattern-input" value={filenamePattern} onChange={(e) => setFilenamePattern(e.target.value)} placeholder="Custom…" />
          </div>
          <div className="pattern-preview">
            Preview → <code>{buildFilename(filenamePattern, "iPhone-16-Pro", "Apple", 0)}</code>
          </div>
        </div>

        {/* ── SINGLE SEARCH TAB ── */}
        {activeTab === "single" && (
          <div className="card">
            <div className="card-label">Search one product</div>
            <form onSubmit={runSingleSearch} className="search-form">
              <div className="input-wrap">
                <span className="input-icon">🛍️</span>
                <input className="field" type="text" placeholder="Product name  (e.g. iPhone 16 Pro Max)" value={singleName} onChange={(e) => setSingleName(e.target.value)} />
              </div>
              <div className="input-wrap" style={{ maxWidth: 220 }}>
                <span className="input-icon">🏷️</span>
                <input className="field" type="text" placeholder="Brand (optional)" value={singleBrand} onChange={(e) => setSingleBrand(e.target.value)} />
              </div>
              <button type="submit" className="btn-primary" disabled={singleLoading || !singleName.trim()}>
                {singleLoading ? <span className="spinner" /> : "Search"}
              </button>
            </form>

            {singleError && <div className="error-box">{singleError}</div>}

            {singleResults && (
              <>
                {singleResults.length > 0 && (
                  <div className="results-toolbar">
                    <label className="check-label">
                      <input type="checkbox" checked={selectedSingle.length === singleResults.length}
                        onChange={() => setSelectedSingle(selectedSingle.length === singleResults.length ? [] : singleResults.map((_, i) => i))} />
                      <span>Select All</span>
                      {selectedSingle.length > 0 && <span className="count-badge">{selectedSingle.length}</span>}
                    </label>
                    {selectedSingle.length > 0 && (
                      <div className="toolbar-actions">
                        <button className="btn-action" onClick={() => selectedSingle.forEach((i, n) => setTimeout(() => downloadImage(singleResults[i].thumbnailUrl, buildFilename(filenamePattern, singleName, singleBrand, i)), n * 200))}>
                          ⬇ Download
                        </button>
                        <button className="btn-action btn-purple" onClick={async () => { setZipLoading(true); await downloadAsZip(selectedSingle.map((i) => ({ url: singleResults[i].thumbnailUrl, filename: buildFilename(filenamePattern, singleName, singleBrand, i) }))); setZipLoading(false); }}>
                          {zipLoading ? "Zipping…" : "📦 ZIP"}
                        </button>
                      </div>
                    )}
                    <span className="result-count">{singleResults.length} images found</span>
                  </div>
                )}
                <div className="image-grid">
                  {singleResults.length === 0 && <p className="muted">No images found.</p>}
                  {singleResults.map((r, i) => (
                    <div key={i} className={`img-card ${selectedSingle.includes(i) ? "img-card-selected" : ""}`}>
                      <div className="img-thumb-wrap">
                        <input type="checkbox" className="img-check" checked={selectedSingle.includes(i)}
                          onChange={() => setSelectedSingle((prev) => prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i])} />
                        <img src={r.thumbnailUrl} alt={r.title} className="img-thumb" loading="lazy"
                          onClick={() => setPreview({ url: r.thumbnailUrl, title: r.title, link: r.link })} />
                        <div className="img-hover-overlay" onClick={() => setPreview({ url: r.thumbnailUrl, title: r.title, link: r.link })}>
                          <span>🔍 Preview</span>
                        </div>
                      </div>
                      <div className="img-meta">
                        <span className="img-title">{r.title}</span>
                        <span className="img-source">{r.source}</span>
                      </div>
                      <div className="img-actions">
                        <button className="img-btn" onClick={() => downloadImage(r.thumbnailUrl, buildFilename(filenamePattern, singleName, singleBrand, i))} title="Download">⬇</button>
                        <button className="img-btn" onClick={() => { navigator.clipboard.writeText(r.thumbnailUrl); showToast("URL copied!"); }} title="Copy URL">📋</button>
                        <a href={r.link} target="_blank" rel="noreferrer" className="img-btn" title="Open source">↗</a>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── BULK CSV TAB ── */}
        {activeTab === "bulk" && (
          <div className="card">
            <div className="card-label">Bulk upload</div>
            <p className="muted" style={{ marginBottom: 16 }}>Columns: <code>Product Name</code> (required), <code>Brand</code> (optional)</p>

            <div className="upload-row">
              <button className="btn-upload" onClick={() => fileInputRef.current?.click()} disabled={batchRunning}>
                <span>📁</span> Choose CSV file
              </button>
              <button className="btn-ghost-md" onClick={loadSample} disabled={batchRunning}>Load sample</button>
              {batchRows.length > 0 && <button className="btn-ghost-md danger" onClick={clearSession} disabled={batchRunning}>Clear session</button>}
              <input ref={fileInputRef} type="file" accept=".csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            </div>

            {batchRows.length > 0 && (
              <>
                <div className="batch-toolbar">
                  {!batchRunning ? (
                    <button className="btn-primary" onClick={runBatch}>Find images · {batchRows.length} products</button>
                  ) : (
                    <button className="btn-stop" onClick={stopBatch}>■ Stop</button>
                  )}
                  {failedCount > 0 && !batchRunning && (
                    <button className="btn-retry" onClick={retryFailed}>🔄 Retry failed ({failedCount})</button>
                  )}
                  <button className="btn-ghost-md" onClick={exportResults} disabled={batchRunning || !batchRows.some((r) => r.results)}>Export CSV</button>
                  {selectedRows.length > 0 && (
                    <>
                      <button className="btn-action" onClick={downloadSelected}>⬇ Download ({selectedRows.length})</button>
                      <button className="btn-action btn-purple" onClick={downloadSelectedZip} disabled={zipLoading}>{zipLoading ? "Zipping…" : "📦 ZIP"}</button>
                    </>
                  )}
                  <span className="progress-label">{batchProgress}%</span>
                </div>

                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${batchProgress}%` }} />
                </div>

                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th><input type="checkbox" checked={allSelected} onChange={toggleSelectAll} disabled={rowsWithImages.length === 0} /></th>
                        <th>Product</th>
                        <th>Brand</th>
                        <th>Image</th>
                        <th>Pick Result</th>
                        <th>Matched Title</th>
                        <th>Actions</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {batchRows.map((row, i) => {
                        const pickedIdx = pickedImage[i] ?? 0;
                        const activeResult = row.results?.[pickedIdx] || row.results?.[0];
                        return (
                          <tr key={i} className={selectedRows.includes(i) ? "row-selected" : ""}>
                            <td>
                              {activeResult?.thumbnailUrl && <input type="checkbox" checked={selectedRows.includes(i)} onChange={() => toggleRow(i)} />}
                            </td>
                            <td className="td-product">{row.productName}</td>
                            <td className="td-brand">{row.brand || "—"}</td>
                            <td>
                              {activeResult?.thumbnailUrl ? (
                                <img src={activeResult.thumbnailUrl} alt="" className="table-thumb"
                                  onClick={() => setPreview({ url: activeResult.thumbnailUrl, title: activeResult.title, link: activeResult.link })} />
                              ) : "—"}
                            </td>
                            <td>
                              {row.results?.length > 1 ? (
                                <select className="pick-select" value={pickedIdx} onChange={(e) => setPickedImage((prev) => ({ ...prev, [i]: Number(e.target.value) }))}>
                                  {row.results.map((r, n) => <option key={n} value={n}>#{n + 1} {r.source}</option>)}
                                </select>
                              ) : "—"}
                            </td>
                            <td className="td-title">{activeResult?.title || "—"}</td>
                            <td>
                              {activeResult?.thumbnailUrl && (
                                <div className="td-actions">
                                  <button className="img-btn" onClick={() => downloadImage(activeResult.thumbnailUrl, buildFilename(filenamePattern, row.productName, row.brand, i))} title="Download">⬇</button>
                                  <button className="img-btn" onClick={() => { navigator.clipboard.writeText(activeResult.thumbnailUrl); showToast("URL copied!"); }} title="Copy URL">📋</button>
                                </div>
                              )}
                            </td>
                            <td><StatusBadge status={row.status} error={row.error} /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {/* Watermark */}
        <footer className="watermark">
          <span>Crafted by </span>
          <a href="http://shervinwilson.framer.website/" target="_blank" rel="noreferrer" className="watermark-link">
            Shervin Wilson
          </a>
        </footer>
      </div>
    </>
  );
}

function StatusBadge({ status, error }) {
  const map = {
    pending:   { label: "Pending",    color: "#94a3b8", bg: "#f1f5f9" },
    loading:   { label: "Searching…", color: "#6366f1", bg: "#eef2ff" },
    done:      { label: "Found",      color: "#10b981", bg: "#ecfdf5" },
    not_found: { label: "Not found",  color: "#f59e0b", bg: "#fffbeb" },
    error:     { label: "Error",      color: "#ef4444", bg: "#fef2f2" },
  };
  const cfg = map[status] || map.pending;
  return (
    <span title={error || ""} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 99, color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.color}22` }}>
      {status === "loading" && <span className="spinner-xs" />}
      {cfg.label}
    </span>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: 'Inter', -apple-system, sans-serif;
  background: #f8f7ff;
  color: #1a1523;
  min-height: 100vh;
}

@keyframes spin { to { transform: rotate(360deg); } }
@keyframes slide { 0%{transform:translateX(-100%)} 60%{transform:translateX(0)} 100%{transform:translateX(100%)} }
@keyframes fadeUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }

.page {
  max-width: 1040px;
  margin: 0 auto;
  padding: 32px 20px 80px;
  animation: fadeUp 0.5s ease both;
}

/* Header */
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 28px;
}
.header-left { display: flex; align-items: center; gap: 14px; }
.logo-mark { flex-shrink: 0; }
.site-title { font-size: 20px; font-weight: 700; letter-spacing: -0.03em; color: #1a1523; line-height: 1.2; }
.site-sub { font-size: 12px; color: #8b7fa8; margin-top: 2px; }
.header-badge {
  font-size: 11px; font-weight: 600; padding: 5px 12px;
  background: #f0eeff; color: #6366f1; border-radius: 99px;
  border: 1px solid #d4d0f8; letter-spacing: 0.02em;
}

/* Tabs */
.tab-bar {
  display: flex; gap: 4px; margin-bottom: 20px;
  background: #ece9f8; border-radius: 12px; padding: 4px; width: fit-content;
}
.tab {
  display: flex; align-items: center; gap: 7px; padding: 9px 20px;
  font-size: 13px; font-weight: 600; border: none; border-radius: 9px;
  cursor: pointer; background: transparent; color: #7c6fa0;
  transition: all 0.2s; letter-spacing: -0.01em;
}
.tab:hover { color: #4f46e5; }
.tab-active { background: #fff; color: #4f46e5; box-shadow: 0 1px 4px rgba(99,102,241,0.15); }
.tab-icon { font-size: 14px; }

/* Card */
.card {
  background: #fff;
  border: 1px solid #ede9fb;
  border-radius: 16px;
  padding: 24px;
  margin-bottom: 16px;
  box-shadow: 0 2px 12px rgba(99,102,241,0.06);
  animation: fadeUp 0.4s ease both;
}
.card-label {
  font-size: 11px; font-weight: 700; letter-spacing: 0.08em;
  text-transform: uppercase; color: #9b8ec4; margin-bottom: 16px;
}
.pattern-card { padding: 18px 24px; }
.pattern-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.chip {
  padding: 6px 14px; border-radius: 8px; font-size: 12px; font-weight: 600;
  border: 1px solid #e5e0f5; background: #faf9ff; color: #7c6fa0; cursor: pointer;
  transition: all 0.15s;
}
.chip:hover { border-color: #a5b4fc; color: #4f46e5; }
.chip-active { background: #eef2ff; color: #4f46e5; border-color: #a5b4fc; }
.pattern-input {
  flex: 1; min-width: 160px; padding: 6px 12px; font-size: 12px;
  border: 1px solid #e5e0f5; border-radius: 8px; outline: none; color: #1a1523;
  font-family: inherit;
}
.pattern-input:focus { border-color: #a5b4fc; box-shadow: 0 0 0 3px #eef2ff; }
.pattern-preview {
  margin-top: 10px; font-size: 12px; color: #9b8ec4;
}
.pattern-preview code {
  background: #f4f3ff; padding: 2px 8px; border-radius: 6px; color: #4f46e5; font-size: 12px;
}

/* Search form */
.search-form { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 4px; }
.input-wrap {
  flex: 1; min-width: 200px; display: flex; align-items: center; gap: 8px;
  border: 1.5px solid #ede9fb; border-radius: 10px; padding: 0 14px;
  background: #faf9ff; transition: all 0.2s;
}
.input-wrap:focus-within { border-color: #a5b4fc; box-shadow: 0 0 0 3px #eef2ff; background: #fff; }
.input-icon { font-size: 15px; flex-shrink: 0; }
.field {
  flex: 1; border: none; outline: none; background: transparent;
  font-size: 14px; color: #1a1523; padding: 11px 0; font-family: inherit;
}
.field::placeholder { color: #c4b8df; }

/* Buttons */
.btn-primary {
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #fff; border: none; border-radius: 10px;
  padding: 12px 24px; font-size: 14px; font-weight: 600;
  cursor: pointer; transition: all 0.2s; font-family: inherit;
  display: flex; align-items: center; gap: 8px; letter-spacing: -0.01em;
  box-shadow: 0 4px 12px rgba(99,102,241,0.3);
}
.btn-primary:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(99,102,241,0.4); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
.btn-stop {
  background: #fff; color: #ef4444; border: 1.5px solid #fca5a5;
  border-radius: 10px; padding: 11px 20px; font-size: 14px; font-weight: 600;
  cursor: pointer; font-family: inherit;
}
.btn-retry {
  background: #fffbeb; color: #f59e0b; border: 1.5px solid #fde68a;
  border-radius: 10px; padding: 11px 16px; font-size: 13px; font-weight: 600;
  cursor: pointer; font-family: inherit;
}
.btn-upload {
  display: flex; align-items: center; gap: 8px;
  background: #fff; color: #4f46e5; border: 1.5px solid #c7d2fe;
  border-radius: 10px; padding: 11px 18px; font-size: 14px; font-weight: 600;
  cursor: pointer; font-family: inherit; transition: all 0.2s;
}
.btn-upload:hover { background: #eef2ff; }
.btn-ghost-md {
  background: transparent; color: #7c6fa0; border: none;
  font-size: 13px; font-weight: 600; cursor: pointer; padding: 11px 8px;
  font-family: inherit; transition: color 0.15s;
}
.btn-ghost-md:hover { color: #4f46e5; }
.btn-ghost-md.danger:hover { color: #ef4444; }
.btn-action {
  background: #eef2ff; color: #4f46e5; border: 1px solid #c7d2fe;
  border-radius: 8px; padding: 8px 14px; font-size: 13px; font-weight: 600;
  cursor: pointer; font-family: inherit; transition: all 0.15s;
}
.btn-action:hover { background: #e0e7ff; }
.btn-purple { background: #f5f3ff; color: #7c3aed; border-color: #ddd6fe; }
.btn-purple:hover { background: #ede9fe; }

/* Results toolbar */
.results-toolbar {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  margin-top: 20px; margin-bottom: 12px;
  padding: 10px 14px; background: #faf9ff; border-radius: 10px; border: 1px solid #ede9fb;
}
.check-label {
  display: flex; align-items: center; gap: 7px;
  font-size: 13px; font-weight: 600; cursor: pointer; color: #1a1523; user-select: none;
}
.count-badge {
  background: #6366f1; color: #fff; font-size: 11px; font-weight: 700;
  padding: 1px 7px; border-radius: 99px; min-width: 22px; text-align: center;
}
.toolbar-actions { display: flex; gap: 8px; }
.result-count { margin-left: auto; font-size: 12px; color: #9b8ec4; font-weight: 500; }

/* Image grid */
.image-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 14px;
}
.img-card {
  border: 1.5px solid #ede9fb; border-radius: 12px;
  overflow: hidden; display: flex; flex-direction: column;
  background: #fff; transition: all 0.2s; cursor: default;
}
.img-card:hover { box-shadow: 0 4px 16px rgba(99,102,241,0.12); transform: translateY(-2px); border-color: #c7d2fe; }
.img-card-selected { border-color: #6366f1; box-shadow: 0 0 0 3px #eef2ff; }
.img-thumb-wrap { position: relative; overflow: hidden; }
.img-check {
  position: absolute; top: 8px; left: 8px;
  width: 16px; height: 16px; z-index: 2; cursor: pointer;
  accent-color: #6366f1;
}
.img-thumb {
  width: 100%; height: 130px; object-fit: contain;
  background: #f8f7ff; cursor: zoom-in; display: block;
  transition: transform 0.2s;
}
.img-card:hover .img-thumb { transform: scale(1.03); }
.img-hover-overlay {
  position: absolute; inset: 0; background: rgba(99,102,241,0.6);
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 13px; font-weight: 600; opacity: 0;
  transition: opacity 0.2s; cursor: zoom-in;
}
.img-card:hover .img-hover-overlay { opacity: 1; }
.img-meta { padding: 8px 10px 4px; flex: 1; }
.img-title {
  display: block; font-size: 11.5px; font-weight: 600; color: #1a1523;
  line-height: 1.4; overflow: hidden; display: -webkit-box;
  -webkit-line-clamp: 2; -webkit-box-orient: vertical; margin-bottom: 3px;
}
.img-source { display: block; font-size: 10.5px; color: #9b8ec4; }
.img-actions {
  display: flex; gap: 4px; padding: 6px 8px 8px;
}
.img-btn {
  flex: 1; background: #f4f3ff; color: #6366f1; border: 1px solid #e0e7ff;
  border-radius: 7px; padding: 5px 0; font-size: 12px; cursor: pointer;
  text-align: center; text-decoration: none; display: flex; align-items: center;
  justify-content: center; transition: all 0.15s; font-family: inherit;
}
.img-btn:hover { background: #e0e7ff; }

/* Batch toolbar */
.batch-toolbar { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-bottom: 14px; }
.progress-label { font-size: 12px; color: #9b8ec4; font-weight: 600; margin-left: auto; }
.upload-row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-bottom: 20px; }

/* Progress bar */
.progress-track { height: 5px; background: #f0eeff; border-radius: 99px; overflow: hidden; margin-bottom: 18px; }
.progress-fill { height: 100%; background: linear-gradient(90deg, #6366f1, #a78bfa); border-radius: 99px; transition: width 0.4s ease; }

/* Table */
.table-wrap { overflow-x: auto; border-radius: 12px; border: 1px solid #ede9fb; }
.data-table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 720px; }
.data-table thead tr { background: #f8f7ff; }
.data-table th {
  text-align: left; padding: 11px 14px; font-size: 10.5px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.06em; color: #9b8ec4;
  border-bottom: 1px solid #ede9fb;
}
.data-table td { padding: 10px 14px; border-bottom: 1px solid #f5f3ff; vertical-align: middle; }
.data-table tr:last-child td { border-bottom: none; }
.data-table tbody tr:hover td { background: #faf9ff; }
.row-selected td { background: #f0eeff !important; }
.td-product { font-weight: 600; color: #1a1523; }
.td-brand { color: #7c6fa0; }
.td-title { color: #4b4568; max-width: 220px; font-size: 12px; }
.table-thumb { width: 44px; height: 44px; object-fit: contain; border-radius: 8px; border: 1px solid #ede9fb; cursor: zoom-in; background: #f8f7ff; }
.pick-select { font-size: 12px; padding: 4px 8px; border-radius: 7px; border: 1px solid #e5e0f5; background: #fff; cursor: pointer; max-width: 140px; color: #1a1523; font-family: inherit; }
.td-actions { display: flex; gap: 6px; }

/* Modal */
.modal-overlay {
  position: fixed; inset: 0; background: rgba(15,14,22,0.7);
  z-index: 1000; display: flex; align-items: center; justify-content: center;
  backdrop-filter: blur(6px);
}
.modal-box {
  background: #fff; border-radius: 20px; padding: 28px;
  max-width: 500px; width: 92%; position: relative;
  box-shadow: 0 24px 60px rgba(0,0,0,0.25); animation: fadeUp 0.25s ease;
}
.modal-close {
  position: absolute; top: 14px; right: 16px;
  background: #f4f3ff; border: none; width: 32px; height: 32px; border-radius: 99px;
  font-size: 14px; cursor: pointer; color: #7c6fa0; display: flex; align-items: center; justify-content: center;
}
.modal-close:hover { background: #e0e7ff; color: #4f46e5; }
.modal-img-wrap { background: #f8f7ff; border-radius: 12px; padding: 16px; margin-bottom: 14px; display: flex; align-items: center; justify-content: center; }
.modal-img { max-width: 100%; max-height: 300px; object-fit: contain; border-radius: 8px; }
.modal-title { font-size: 12.5px; color: #7c6fa0; margin-bottom: 16px; line-height: 1.5; text-align: center; }
.modal-actions { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
.btn-primary-sm {
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #fff; border: none; border-radius: 9px; padding: 9px 16px;
  font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit;
}
.btn-ghost-sm {
  background: #f4f3ff; color: #4f46e5; border: 1px solid #e0e7ff;
  border-radius: 9px; padding: 9px 16px; font-size: 13px; font-weight: 600;
  cursor: pointer; text-decoration: none; font-family: inherit; display: inline-block;
}

/* Spinner */
.spinner {
  width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.4);
  border-top-color: #fff; border-radius: 50%; animation: spin 0.7s linear infinite; display: inline-block;
}
.spinner-xs {
  width: 8px; height: 8px; border: 1.5px solid currentColor; border-top-color: transparent;
  border-radius: 50%; animation: spin 0.7s linear infinite; display: inline-block; opacity: 0.7;
}

/* Error */
.error-box {
  margin-top: 12px; padding: 12px 16px; background: #fef2f2; border: 1px solid #fca5a5;
  border-radius: 10px; color: #ef4444; font-size: 13px; font-weight: 500;
}

/* Toast */
.toast {
  position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%);
  background: #1a1523; color: #fff; padding: 10px 22px; border-radius: 99px;
  font-size: 13px; font-weight: 600; z-index: 2000;
  box-shadow: 0 8px 24px rgba(0,0,0,0.2); animation: fadeUp 0.25s ease;
}

/* Watermark */
.watermark {
  text-align: center; margin-top: 40px;
  font-size: 12px; color: #c4b8df; font-weight: 500;
}
.watermark-link {
  color: #7c6fa0; text-decoration: none; font-weight: 700;
  border-bottom: 1.5px solid #c4b8df; padding-bottom: 1px;
  transition: color 0.15s;
}
.watermark-link:hover { color: #6366f1; border-color: #6366f1; }

.muted { color: #9b8ec4; font-size: 13px; }
code { background: #f4f3ff; padding: 2px 6px; border-radius: 5px; color: #4f46e5; font-size: 12px; }

@media (max-width: 600px) {
  .header { flex-direction: column; align-items: flex-start; gap: 12px; }
  .image-grid { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); }
  .search-form { flex-direction: column; }
}
`;
