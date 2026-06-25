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
    a.href = blobUrl; a.download = filename || "image.jpg";
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(blobUrl);
  } catch { window.open(url, "_blank"); }
}

async function downloadAsZip(items) {
  const script = document.createElement("script");
  script.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
  document.head.appendChild(script);
  await new Promise((res) => (script.onload = res));
  const zip = new window.JSZip();
  const folder = zip.folder("product-images");
  for (const item of items) {
    try { const res = await fetch(item.url); const blob = await res.blob(); folder.file(item.filename, blob); } catch {}
  }
  const content = await zip.generateAsync({ type: "blob" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(content); a.download = "product-images.zip";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

async function fetchImagesFor(productName, brand) {
  const res = await fetch("/api/search-image", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productName, brand }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Search failed");
  return data.results || [];
}

const SESSION_KEY = "pif_session";

// ── SVG Icon System ──────────────────────────────────────────
const IC = {
  Search: (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  Download: (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
  Copy: (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>,
  Link: (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>,
  Upload: (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>,
  Package: (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 002 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>,
  Refresh: (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>,
  Trash: (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>,
  File: (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>,
  ZoomIn: (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>,
  Stop: (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>,
  Grid: (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>,
  List: (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>,
  Settings: (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>,
  X: (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  Tag: (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>,
  ShoppingBag: (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>,
};

// ── Preloader ────────────────────────────────────────────────
function Preloader({ done }) {
  const [hide, setHide] = useState(false);
  useEffect(() => { if (done) setTimeout(() => setHide(true), 800); }, [done]);
  if (hide) return null;
  return (
    <div className="preloader" style={{ opacity: done ? 0 : 1, pointerEvents: done ? "none" : "all" }}>
      <div className="preloader-content">
        <div className="preloader-logo">
          <IC.ShoppingBag width="28" height="28" className="preloader-icon" />
        </div>
        <span className="preloader-title">Product Image Finder</span>
        <div className="preloader-bar-track">
          <div className="preloader-bar-fill" />
        </div>
        <span className="preloader-hint">Initialising workspace</span>
      </div>
    </div>
  );
}

// ── Status Badge ─────────────────────────────────────────────
function StatusBadge({ status, error }) {
  const map = {
    pending:   { label: "Pending",    cls: "badge-pending" },
    loading:   { label: "Searching",  cls: "badge-loading" },
    done:      { label: "Found",      cls: "badge-done" },
    not_found: { label: "Not found",  cls: "badge-warn" },
    error:     { label: "Error",      cls: "badge-error" },
  };
  const cfg = map[status] || map.pending;
  return (
    <span className={`badge ${cfg.cls}`} title={error || ""}>
      {status === "loading" && <span className="spinner-xs" />}
      {cfg.label}
    </span>
  );
}

// ── Main App ─────────────────────────────────────────────────
export default function Home() {
  const [ready, setReady] = useState(false);
  const [activeTab, setActiveTab] = useState("single");
  const [toast, setToast] = useState(null);
  const [preview, setPreview] = useState(null);

  // Single search
  const [singleName, setSingleName] = useState("");
  const [singleBrand, setSingleBrand] = useState("");
  const [singleLoading, setSingleLoading] = useState(false);
  const [singleError, setSingleError] = useState(null);
  const [singleResults, setSingleResults] = useState(null);
  const [selectedSingle, setSelectedSingle] = useState([]);

  // Filename pattern
  const [filenamePattern, setFilenamePattern] = useState("{productName}");
  const [showSettings, setShowSettings] = useState(false);

  // Batch
  const [batchRows, setBatchRows] = useState([]);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState(0);
  const [selectedRows, setSelectedRows] = useState([]);
  const [pickedImage, setPickedImage] = useState({});
  const [zipLoading, setZipLoading] = useState(false);

  const fileInputRef = useRef(null);
  const cancelRef = useRef(false);

  useEffect(() => {
    setTimeout(() => setReady(true), 2000);
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

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2400); };

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
  const exportCsv = useCallback(() => { downloadCsv(rowsToCsv(batchRows), "product-images.csv"); }, [batchRows]);

  const rowsWithImages = batchRows.map((r, i) => ({ ...r, idx: i })).filter((r) => r.results?.[0]?.thumbnailUrl);
  const allSelected = rowsWithImages.length > 0 && rowsWithImages.every((r) => selectedRows.includes(r.idx));
  const toggleSelectAll = () => setSelectedRows(allSelected ? [] : rowsWithImages.map((r) => r.idx));
  const toggleRow = (idx) => setSelectedRows((prev) => prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]);
  const getPickedResult = (row, idx) => row.results?.[pickedImage[idx] ?? 0] || row.results?.[0];
  const failedCount = batchRows.filter((r) => r.status === "error" || r.status === "not_found").length;

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

  return (
    <>
      <style>{CSS}</style>
      <Preloader done={ready} />

      {toast && <div className="toast">{toast}</div>}

      {/* Preview Modal */}
      {preview && (
        <div className="modal-overlay" onClick={() => setPreview(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setPreview(null)}>
              <IC.X width="14" height="14" />
            </button>
            <div className="modal-img-wrap">
              <img src={preview.url} alt={preview.title} className="modal-img" />
            </div>
            <p className="modal-title">{preview.title}</p>
            <div className="modal-actions">
              <a href={preview.link} target="_blank" rel="noreferrer" className="modal-btn modal-btn-ghost">
                <IC.Link width="13" height="13" /> Open source
              </a>
              <button className="modal-btn modal-btn-primary" onClick={() => downloadImage(preview.url, `${preview.title || "image"}.jpg`)}>
                <IC.Download width="13" height="13" /> Download
              </button>
              <button className="modal-btn modal-btn-ghost" onClick={() => { navigator.clipboard.writeText(preview.url); showToast("URL copied to clipboard"); }}>
                <IC.Copy width="13" height="13" /> Copy URL
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="page">

        {/* ── Header ── */}
        <header className="header">
          <div className="header-left">
            <div className="header-icon">
              <IC.ShoppingBag width="18" height="18" />
            </div>
            <div>
              <h1 className="site-title">Product Image Finder</h1>
              <p className="site-sub">E-commerce image sourcing</p>
            </div>
          </div>
          <div className="header-right">
            <button className="icon-btn" title="Settings" onClick={() => setShowSettings((v) => !v)}>
              <IC.Settings width="15" height="15" />
            </button>
            <div className="header-badge">SerpAPI</div>
          </div>
        </header>

        {/* ── Settings Panel ── */}
        {showSettings && (
          <div className="settings-panel">
            <div className="settings-row">
              <span className="settings-label">
                <IC.Tag width="13" height="13" /> Filename pattern
              </span>
              <div className="chip-group">
                {FILENAME_PATTERNS.map((p) => (
                  <button key={p.value} className={`chip ${filenamePattern === p.value ? "chip-active" : ""}`} onClick={() => setFilenamePattern(p.value)}>
                    {p.label}
                  </button>
                ))}
                <input className="chip-input" value={filenamePattern} onChange={(e) => setFilenamePattern(e.target.value)} placeholder="Custom pattern…" />
              </div>
            </div>
            <div className="settings-preview">
              Preview — <code>{buildFilename(filenamePattern, "iPhone-16-Pro", "Apple", 0)}</code>
            </div>
          </div>
        )}

        {/* ── Tabs ── */}
        <div className="tab-bar">
          <button className={`tab ${activeTab === "single" ? "tab-active" : ""}`} onClick={() => setActiveTab("single")}>
            <IC.Search width="14" height="14" />
            Single Search
          </button>
          <button className={`tab ${activeTab === "bulk" ? "tab-active" : ""}`} onClick={() => setActiveTab("bulk")}>
            <IC.List width="14" height="14" />
            Bulk CSV
          </button>
        </div>

        {/* ══ SINGLE SEARCH ══ */}
        {activeTab === "single" && (
          <div className="card">
            <form onSubmit={runSingleSearch} className="search-form">
              <div className="input-wrap">
                <IC.ShoppingBag className="input-icon" width="15" height="15" />
                <input className="field" type="text" placeholder="Product name — e.g. iPhone 16 Pro Max" value={singleName} onChange={(e) => setSingleName(e.target.value)} />
              </div>
              <div className="input-wrap input-wrap-sm">
                <IC.Tag className="input-icon" width="14" height="14" />
                <input className="field" type="text" placeholder="Brand (optional)" value={singleBrand} onChange={(e) => setSingleBrand(e.target.value)} />
              </div>
              <button type="submit" className="btn-primary" disabled={singleLoading || !singleName.trim()}>
                {singleLoading ? <span className="spinner" /> : <IC.Search width="14" height="14" />}
                {singleLoading ? "Searching" : "Search"}
              </button>
            </form>

            {singleError && <div className="error-box">{singleError}</div>}

            {singleResults && (
              <>
                {singleResults.length > 0 && (
                  <div className="results-toolbar">
                    <label className="check-label">
                      <input type="checkbox"
                        checked={selectedSingle.length === singleResults.length}
                        onChange={() => setSelectedSingle(selectedSingle.length === singleResults.length ? [] : singleResults.map((_, i) => i))}
                      />
                      Select all
                      {selectedSingle.length > 0 && <span className="count-badge">{selectedSingle.length}</span>}
                    </label>
                    {selectedSingle.length > 0 && (
                      <div className="toolbar-actions">
                        <button className="btn-sm" onClick={() => selectedSingle.forEach((i, n) => setTimeout(() => downloadImage(singleResults[i].thumbnailUrl, buildFilename(filenamePattern, singleName, singleBrand, i)), n * 200))}>
                          <IC.Download width="13" height="13" /> Download
                        </button>
                        <button className="btn-sm btn-outline" onClick={async () => { setZipLoading(true); await downloadAsZip(selectedSingle.map((i) => ({ url: singleResults[i].thumbnailUrl, filename: buildFilename(filenamePattern, singleName, singleBrand, i) }))); setZipLoading(false); }}>
                          <IC.Package width="13" height="13" /> {zipLoading ? "Zipping…" : "ZIP"}
                        </button>
                      </div>
                    )}
                    <span className="result-count">{singleResults.length} results</span>
                  </div>
                )}

                <div className="image-grid">
                  {singleResults.length === 0 && (
                    <div className="empty-state">
                      <IC.Search width="32" height="32" />
                      <p>No images found for this product.</p>
                    </div>
                  )}
                  {singleResults.map((r, i) => (
                    <div key={i} className={`img-card ${selectedSingle.includes(i) ? "img-card-selected" : ""}`}>
                      <div className="img-thumb-wrap">
                        <input type="checkbox" className="img-check"
                          checked={selectedSingle.includes(i)}
                          onChange={() => setSelectedSingle((prev) => prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i])}
                        />
                        <img src={r.thumbnailUrl} alt={r.title} className="img-thumb" loading="lazy"
                          onClick={() => setPreview({ url: r.thumbnailUrl, title: r.title, link: r.link })}
                        />
                        <div className="img-hover-overlay" onClick={() => setPreview({ url: r.thumbnailUrl, title: r.title, link: r.link })}>
                          <IC.ZoomIn width="14" height="14" /> Preview
                        </div>
                      </div>
                      <div className="img-meta">
                        <span className="img-title">{r.title}</span>
                        <span className="img-source">{r.source}</span>
                      </div>
                      <div className="img-actions">
                        <button className="img-btn" onClick={() => downloadImage(r.thumbnailUrl, buildFilename(filenamePattern, singleName, singleBrand, i))} title="Download">
                          <IC.Download width="13" height="13" />
                        </button>
                        <button className="img-btn" onClick={() => { navigator.clipboard.writeText(r.thumbnailUrl); showToast("URL copied"); }} title="Copy URL">
                          <IC.Copy width="13" height="13" />
                        </button>
                        <a href={r.link} target="_blank" rel="noreferrer" className="img-btn" title="Open source">
                          <IC.Link width="13" height="13" />
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* ══ BULK CSV ══ */}
        {activeTab === "bulk" && (
          <div className="card">
            <p className="muted" style={{ marginBottom: 18 }}>
              CSV columns — <code>Product Name</code> (required) · <code>Brand</code> (optional)
            </p>

            <div className="upload-row">
              <button className="btn-upload" onClick={() => fileInputRef.current?.click()} disabled={batchRunning}>
                <IC.Upload width="14" height="14" /> Choose CSV
              </button>
              <button className="btn-ghost-md" onClick={loadSample} disabled={batchRunning}>
                <IC.File width="13" height="13" /> Load sample
              </button>
              {batchRows.length > 0 && (
                <button className="btn-ghost-md btn-danger" onClick={clearSession} disabled={batchRunning}>
                  <IC.Trash width="13" height="13" /> Clear session
                </button>
              )}
              <input ref={fileInputRef} type="file" accept=".csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            </div>

            {batchRows.length > 0 && (
              <>
                <div className="batch-toolbar">
                  {!batchRunning ? (
                    <button className="btn-primary" onClick={runBatch}>
                      <IC.Search width="14" height="14" />
                      Find images · {batchRows.length} products
                    </button>
                  ) : (
                    <button className="btn-stop" onClick={stopBatch}>
                      <IC.Stop width="13" height="13" /> Stop
                    </button>
                  )}
                  {failedCount > 0 && !batchRunning && (
                    <button className="btn-retry" onClick={retryFailed}>
                      <IC.Refresh width="13" height="13" /> Retry failed ({failedCount})
                    </button>
                  )}
                  <button className="btn-ghost-md" onClick={exportCsv} disabled={batchRunning || !batchRows.some((r) => r.results)}>
                    <IC.File width="13" height="13" /> Export CSV
                  </button>
                  {selectedRows.length > 0 && (
                    <>
                      <button className="btn-sm" onClick={downloadSelected}>
                        <IC.Download width="13" height="13" /> Download ({selectedRows.length})
                      </button>
                      <button className="btn-sm btn-outline" onClick={downloadSelectedZip} disabled={zipLoading}>
                        <IC.Package width="13" height="13" /> {zipLoading ? "Zipping…" : "ZIP"}
                      </button>
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
                        <th style={{ width: 40 }}>
                          <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} disabled={rowsWithImages.length === 0} />
                        </th>
                        <th>Product</th>
                        <th>Brand</th>
                        <th>Image</th>
                        <th>Pick</th>
                        <th>Matched title</th>
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
                            <td style={{ textAlign: "center" }}>
                              {activeResult?.thumbnailUrl && (
                                <input type="checkbox" checked={selectedRows.includes(i)} onChange={() => toggleRow(i)} />
                              )}
                            </td>
                            <td className="td-product">{row.productName}</td>
                            <td className="td-muted">{row.brand || "—"}</td>
                            <td>
                              {activeResult?.thumbnailUrl ? (
                                <img src={activeResult.thumbnailUrl} alt="" className="table-thumb"
                                  onClick={() => setPreview({ url: activeResult.thumbnailUrl, title: activeResult.title, link: activeResult.link })} />
                              ) : "—"}
                            </td>
                            <td>
                              {row.results?.length > 1 ? (
                                <select className="pick-select" value={pickedIdx} onChange={(e) => setPickedImage((prev) => ({ ...prev, [i]: Number(e.target.value) }))}>
                                  {row.results.map((r, n) => <option key={n} value={n}>#{n + 1} — {r.source}</option>)}
                                </select>
                              ) : "—"}
                            </td>
                            <td className="td-title">{activeResult?.title || "—"}</td>
                            <td>
                              {activeResult?.thumbnailUrl && (
                                <div className="td-actions">
                                  <button className="img-btn" title="Download" onClick={() => downloadImage(activeResult.thumbnailUrl, buildFilename(filenamePattern, row.productName, row.brand, i))}>
                                    <IC.Download width="13" height="13" />
                                  </button>
                                  <button className="img-btn" title="Copy URL" onClick={() => { navigator.clipboard.writeText(activeResult.thumbnailUrl); showToast("URL copied"); }}>
                                    <IC.Copy width="13" height="13" />
                                  </button>
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

        {/* ── Watermark ── */}
        <footer className="watermark">
          Created by{" "}
          <a href="http://shervinwilson.framer.website/" target="_blank" rel="noreferrer" className="watermark-link">
            Shervin Wilson
          </a>
        </footer>
      </div>
    </>
  );
}

// ── CSS ──────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  background: #080808;
  color: #e0e0e0;
  min-height: 100vh;
  -webkit-font-smoothing: antialiased;
}

/* ── Animations ── */
@keyframes spin      { to { transform: rotate(360deg); } }
@keyframes barSlide  { 0%{transform:translateX(-100%)} 50%{transform:translateX(0)} 100%{transform:translateX(110%)} }
@keyframes fadeUp    { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
@keyframes fadeIn    { from { opacity:0; } to { opacity:1; } }
@keyframes toastIn   { from { opacity:0; transform:translateX(-50%) translateY(8px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }
@keyframes pulse     { 0%,100%{opacity:1} 50%{opacity:0.3} }

/* ── Preloader ── */
.preloader {
  position: fixed; inset: 0;
  background: #080808;
  z-index: 9999;
  display: flex; align-items: center; justify-content: center;
  transition: opacity 0.8s cubic-bezier(0.4,0,0.2,1);
}
.preloader-content {
  display: flex; flex-direction: column; align-items: center; gap: 18px;
}
.preloader-logo {
  width: 56px; height: 56px;
  border: 1px solid #1e1e1e;
  border-radius: 16px;
  display: flex; align-items: center; justify-content: center;
  background: #0f0f0f;
  animation: pulse 2s ease-in-out infinite;
}
.preloader-icon { color: #fff; }
.preloader-title {
  font-size: 15px; font-weight: 600; color: #e0e0e0;
  letter-spacing: -0.02em;
}
.preloader-bar-track {
  width: 120px; height: 1px; background: #1a1a1a; border-radius: 99px; overflow: hidden;
}
.preloader-bar-fill {
  height: 100%; width: 60%;
  background: #fff;
  border-radius: 99px;
  animation: barSlide 1.6s ease-in-out infinite;
}
.preloader-hint {
  font-size: 11px; color: #333; letter-spacing: 0.04em;
}

/* ── Page ── */
.page {
  max-width: 1020px; margin: 0 auto;
  padding: 36px 24px 80px;
  animation: fadeUp 0.4s ease both;
}

/* ── Header ── */
.header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 24px;
  padding-bottom: 24px;
  border-bottom: 1px solid #111;
}
.header-left { display: flex; align-items: center; gap: 14px; }
.header-icon {
  width: 38px; height: 38px;
  background: #111; border: 1px solid #1e1e1e; border-radius: 10px;
  display: flex; align-items: center; justify-content: center; color: #fff;
  flex-shrink: 0;
}
.site-title { font-size: 16px; font-weight: 700; color: #fff; letter-spacing: -0.03em; line-height: 1.2; }
.site-sub { font-size: 11.5px; color: #383838; margin-top: 2px; }
.header-right { display: flex; align-items: center; gap: 10px; }
.header-badge {
  font-size: 10px; font-weight: 700; padding: 4px 10px;
  background: #111; color: #444; border: 1px solid #1e1e1e;
  border-radius: 6px; letter-spacing: 0.06em; text-transform: uppercase;
}
.icon-btn {
  width: 32px; height: 32px; background: #111; border: 1px solid #1e1e1e;
  border-radius: 8px; display: flex; align-items: center; justify-content: center;
  color: #555; cursor: pointer; transition: all 0.15s;
}
.icon-btn:hover { border-color: #2a2a2a; color: #ccc; }

/* ── Settings panel ── */
.settings-panel {
  background: #0c0c0c; border: 1px solid #161616; border-radius: 12px;
  padding: 18px 20px; margin-bottom: 16px;
  animation: fadeIn 0.2s ease;
}
.settings-row { display: flex; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
.settings-label {
  display: flex; align-items: center; gap: 7px;
  font-size: 11px; font-weight: 700; color: #444;
  text-transform: uppercase; letter-spacing: 0.07em;
  white-space: nowrap; padding-top: 7px;
}
.chip-group { display: flex; gap: 6px; flex-wrap: wrap; flex: 1; }
.chip {
  padding: 5px 12px; border-radius: 6px; font-size: 12px; font-weight: 600;
  border: 1px solid #1e1e1e; background: #111; color: #555; cursor: pointer;
  transition: all 0.15s; font-family: inherit;
}
.chip:hover { border-color: #2a2a2a; color: #aaa; }
.chip-active { background: #fff; color: #000; border-color: #fff; }
.chip-input {
  flex: 1; min-width: 140px; padding: 5px 10px; font-size: 12px;
  border: 1px solid #1e1e1e; border-radius: 6px; outline: none;
  background: #111; color: #ccc; font-family: inherit;
}
.chip-input:focus { border-color: #333; }
.settings-preview {
  margin-top: 12px; font-size: 12px; color: #333;
}

/* ── Tabs ── */
.tab-bar {
  display: flex; gap: 2px; margin-bottom: 16px;
  background: #0c0c0c; border: 1px solid #161616;
  border-radius: 10px; padding: 4px; width: fit-content;
}
.tab {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 18px; font-size: 13px; font-weight: 600;
  border: none; border-radius: 7px; cursor: pointer;
  background: transparent; color: #333;
  transition: all 0.18s; font-family: inherit; letter-spacing: -0.01em;
}
.tab:hover { color: #888; }
.tab-active { background: #161616; color: #e0e0e0; border: 1px solid #1e1e1e; }

/* ── Card ── */
.card {
  background: #0c0c0c; border: 1px solid #161616;
  border-radius: 14px; padding: 24px;
  animation: fadeUp 0.3s ease both;
}

/* ── Search form ── */
.search-form { display: flex; gap: 10px; flex-wrap: wrap; }
.input-wrap {
  flex: 1; min-width: 220px;
  display: flex; align-items: center; gap: 10px;
  border: 1px solid #161616; border-radius: 10px;
  padding: 0 14px; background: #0f0f0f; transition: all 0.18s;
}
.input-wrap:focus-within { border-color: #2a2a2a; background: #111; }
.input-wrap-sm { max-width: 210px; }
.input-icon { color: #2e2e2e; flex-shrink: 0; display: flex; }
.field {
  flex: 1; border: none; outline: none; background: transparent;
  font-size: 13.5px; color: #ccc; padding: 12px 0;
  font-family: inherit; letter-spacing: -0.01em;
}
.field::placeholder { color: #282828; }

/* ── Buttons ── */
.btn-primary {
  display: flex; align-items: center; gap: 8px;
  background: #fff; color: #000; border: none; border-radius: 10px;
  padding: 12px 22px; font-size: 13px; font-weight: 700;
  cursor: pointer; transition: all 0.18s; font-family: inherit;
  letter-spacing: -0.01em; white-space: nowrap;
}
.btn-primary:hover:not(:disabled) { background: #e8e8e8; }
.btn-primary:disabled { opacity: 0.25; cursor: not-allowed; }
.btn-stop {
  display: flex; align-items: center; gap: 8px;
  background: #0f0f0f; color: #888; border: 1px solid #1e1e1e;
  border-radius: 10px; padding: 11px 18px; font-size: 13px; font-weight: 600;
  cursor: pointer; font-family: inherit;
}
.btn-stop:hover { border-color: #2a2a2a; color: #ccc; }
.btn-retry {
  display: flex; align-items: center; gap: 7px;
  background: transparent; color: #555; border: 1px solid #1e1e1e;
  border-radius: 10px; padding: 10px 16px; font-size: 12px; font-weight: 600;
  cursor: pointer; font-family: inherit; transition: all 0.15s;
}
.btn-retry:hover { border-color: #2a2a2a; color: #888; }
.btn-upload {
  display: flex; align-items: center; gap: 8px;
  background: #fff; color: #000; border: none;
  border-radius: 10px; padding: 11px 18px; font-size: 13px; font-weight: 700;
  cursor: pointer; font-family: inherit; transition: all 0.15s;
}
.btn-upload:hover:not(:disabled) { background: #e8e8e8; }
.btn-upload:disabled { opacity: 0.3; cursor: not-allowed; }
.btn-ghost-md {
  display: flex; align-items: center; gap: 7px;
  background: transparent; color: #383838; border: none;
  font-size: 12.5px; font-weight: 600; cursor: pointer;
  padding: 11px 8px; font-family: inherit; transition: color 0.15s;
}
.btn-ghost-md:hover { color: #777; }
.btn-ghost-md.btn-danger:hover { color: #555; }
.btn-sm {
  display: inline-flex; align-items: center; gap: 6px;
  background: #fff; color: #000; border: none; border-radius: 8px;
  padding: 8px 14px; font-size: 12px; font-weight: 700;
  cursor: pointer; font-family: inherit; transition: all 0.15s; white-space: nowrap;
}
.btn-sm:hover { background: #e8e8e8; }
.btn-outline {
  background: transparent; color: #888;
  border: 1px solid #1e1e1e;
}
.btn-outline:hover { background: #111; color: #ccc; border-color: #2a2a2a; }

/* ── Results toolbar ── */
.results-toolbar {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  margin: 20px 0 16px;
  padding: 10px 14px;
  background: #0a0a0a; border: 1px solid #141414; border-radius: 9px;
}
.check-label {
  display: flex; align-items: center; gap: 8px;
  font-size: 12.5px; font-weight: 600; cursor: pointer;
  color: #888; user-select: none;
}
.count-badge {
  background: #fff; color: #000; font-size: 10px; font-weight: 800;
  padding: 1px 7px; border-radius: 99px; min-width: 20px; text-align: center;
}
.toolbar-actions { display: flex; gap: 7px; }
.result-count { margin-left: auto; font-size: 11.5px; color: #2e2e2e; font-weight: 500; }

/* ── Image grid ── */
.image-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 10px; margin-top: 4px;
}
.img-card {
  border: 1px solid #141414; border-radius: 10px; overflow: hidden;
  display: flex; flex-direction: column; background: #0a0a0a;
  transition: border-color 0.18s, box-shadow 0.18s;
}
.img-card:hover { border-color: #222; box-shadow: 0 4px 24px rgba(0,0,0,0.5); }
.img-card-selected { border-color: #333 !important; }
.img-thumb-wrap { position: relative; overflow: hidden; }
.img-check {
  position: absolute; top: 8px; left: 8px; width: 15px; height: 15px;
  z-index: 2; cursor: pointer; accent-color: #fff;
}
.img-thumb {
  width: 100%; height: 126px; object-fit: contain;
  background: #0d0d0d; cursor: zoom-in; display: block;
  transition: transform 0.22s;
}
.img-card:hover .img-thumb { transform: scale(1.04); }
.img-hover-overlay {
  position: absolute; inset: 0;
  background: rgba(0,0,0,0.75);
  display: flex; align-items: center; justify-content: center;
  gap: 7px; color: #fff; font-size: 11.5px; font-weight: 600;
  opacity: 0; transition: opacity 0.18s; cursor: zoom-in;
}
.img-card:hover .img-hover-overlay { opacity: 1; }
.img-meta { padding: 9px 10px 4px; flex: 1; }
.img-title {
  display: block; font-size: 11px; font-weight: 600; color: #888;
  line-height: 1.4; overflow: hidden; display: -webkit-box;
  -webkit-line-clamp: 2; -webkit-box-orient: vertical; margin-bottom: 3px;
}
.img-source { display: block; font-size: 10px; color: #2e2e2e; }
.img-actions { display: flex; gap: 3px; padding: 5px 7px 8px; }
.img-btn {
  flex: 1; background: #111; color: #444;
  border: 1px solid #181818; border-radius: 6px;
  padding: 7px 0; font-size: 12px; cursor: pointer;
  text-align: center; text-decoration: none;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.15s; font-family: inherit;
}
.img-btn:hover { background: #1a1a1a; color: #ccc; border-color: #222; }

/* ── Empty state ── */
.empty-state {
  display: flex; flex-direction: column; align-items: center;
  gap: 12px; padding: 48px 24px; color: #222; text-align: center;
}
.empty-state p { font-size: 13px; color: #2a2a2a; }

/* ── Batch toolbar ── */
.batch-toolbar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 14px; }
.upload-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 20px; }
.progress-label { font-size: 11.5px; color: #2e2e2e; font-weight: 600; margin-left: auto; font-variant-numeric: tabular-nums; }

/* ── Progress ── */
.progress-track { height: 1px; background: #141414; border-radius: 99px; overflow: hidden; margin-bottom: 16px; }
.progress-fill { height: 100%; background: #fff; border-radius: 99px; transition: width 0.35s ease; }

/* ── Table ── */
.table-wrap { overflow-x: auto; border-radius: 10px; border: 1px solid #141414; }
.data-table { width: 100%; border-collapse: collapse; font-size: 12.5px; min-width: 740px; }
.data-table thead tr { background: #090909; }
.data-table th {
  text-align: left; padding: 10px 14px;
  font-size: 10px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.08em;
  color: #2a2a2a; border-bottom: 1px solid #141414;
}
.data-table td { padding: 10px 14px; border-bottom: 1px solid #0f0f0f; vertical-align: middle; color: #999; }
.data-table tr:last-child td { border-bottom: none; }
.data-table tbody tr:hover td { background: #0a0a0a; }
.row-selected td { background: #0e0e0e !important; }
.td-product { font-weight: 600; color: #ccc; }
.td-muted { color: #333; }
.td-title { color: #444; max-width: 220px; }
.table-thumb {
  width: 40px; height: 40px; object-fit: contain;
  border-radius: 6px; border: 1px solid #1a1a1a;
  cursor: zoom-in; background: #0d0d0d;
}
.pick-select {
  font-size: 11.5px; padding: 4px 8px; border-radius: 6px;
  border: 1px solid #1e1e1e; background: #0f0f0f;
  cursor: pointer; max-width: 150px; color: #777; font-family: inherit; outline: none;
}
.td-actions { display: flex; gap: 5px; }

/* ── Modal ── */
.modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.92); z-index: 1000;
  display: flex; align-items: center; justify-content: center;
  backdrop-filter: blur(12px); animation: fadeIn 0.2s ease;
}
.modal-box {
  background: #0c0c0c; border: 1px solid #1e1e1e; border-radius: 16px;
  padding: 28px; max-width: 480px; width: 92%; position: relative;
  box-shadow: 0 40px 100px rgba(0,0,0,0.9); animation: fadeUp 0.22s ease;
}
.modal-close {
  position: absolute; top: 14px; right: 14px;
  background: #141414; border: 1px solid #1e1e1e;
  width: 28px; height: 28px; border-radius: 99px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; color: #555; transition: all 0.15s;
}
.modal-close:hover { background: #1a1a1a; color: #ccc; }
.modal-img-wrap {
  background: #0a0a0a; border: 1px solid #141414; border-radius: 10px;
  padding: 20px; margin-bottom: 14px;
  display: flex; align-items: center; justify-content: center;
}
.modal-img { max-width: 100%; max-height: 280px; object-fit: contain; border-radius: 6px; }
.modal-title { font-size: 11.5px; color: #444; margin-bottom: 18px; line-height: 1.6; text-align: center; }
.modal-actions { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
.modal-btn {
  display: inline-flex; align-items: center; gap: 7px;
  border-radius: 8px; padding: 9px 16px; font-size: 12px; font-weight: 600;
  cursor: pointer; font-family: inherit; transition: all 0.15s; text-decoration: none;
}
.modal-btn-primary { background: #fff; color: #000; border: none; }
.modal-btn-primary:hover { background: #e8e8e8; }
.modal-btn-ghost { background: #141414; color: #888; border: 1px solid #1e1e1e; }
.modal-btn-ghost:hover { background: #1e1e1e; color: #ccc; }

/* ── Badges ── */
.badge {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 10.5px; font-weight: 700; padding: 3px 9px;
  border-radius: 99px; border: 1px solid;
  letter-spacing: 0.02em;
}
.badge-pending  { color: #2a2a2a; background: #0d0d0d; border-color: #1a1a1a; }
.badge-loading  { color: #aaa; background: #111; border-color: #222; animation: pulse 1.5s ease infinite; }
.badge-done     { color: #888; background: #0f0f0f; border-color: #1e1e1e; }
.badge-warn     { color: #555; background: #0d0d0d; border-color: #1a1a1a; }
.badge-error    { color: #555; background: #0d0d0d; border-color: #1a1a1a; }

/* ── Spinner ── */
.spinner { width: 14px; height: 14px; border: 2px solid rgba(0,0,0,0.15); border-top-color: #000; border-radius: 50%; animation: spin 0.6s linear infinite; display: inline-block; }
.spinner-xs { width: 7px; height: 7px; border: 1.5px solid currentColor; border-top-color: transparent; border-radius: 50%; animation: spin 0.6s linear infinite; display: inline-block; }

/* ── Error ── */
.error-box { margin-top: 14px; padding: 12px 16px; background: #0d0000; border: 1px solid #1e0000; border-radius: 9px; color: #555; font-size: 12.5px; }

/* ── Toast ── */
.toast {
  position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%);
  background: #fff; color: #000; padding: 9px 20px; border-radius: 99px;
  font-size: 12px; font-weight: 700; z-index: 2000;
  box-shadow: 0 8px 30px rgba(0,0,0,0.6);
  animation: toastIn 0.22s ease; white-space: nowrap; letter-spacing: -0.01em;
}

/* ── Watermark ── */
.watermark { text-align: center; margin-top: 52px; font-size: 11.5px; color: #1e1e1e; }
.watermark-link {
  color: #2e2e2e; text-decoration: none; font-weight: 700;
  transition: color 0.15s; border-bottom: 1px solid #1e1e1e; padding-bottom: 1px;
}
.watermark-link:hover { color: #888; border-color: #444; }

/* ── Misc ── */
.muted { color: #333; font-size: 12.5px; }
code { background: #111; padding: 2px 7px; border-radius: 5px; color: #555; font-size: 11.5px; border: 1px solid #1a1a1a; font-family: 'SF Mono', 'Fira Code', monospace; }
input[type="checkbox"] { accent-color: #fff; cursor: pointer; }

@media (max-width: 600px) {
  .header { flex-direction: column; align-items: flex-start; gap: 12px; }
  .image-grid { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); }
  .search-form { flex-direction: column; }
  .input-wrap-sm { max-width: none; }
  .tab-bar { width: 100%; }
  .tab { flex: 1; justify-content: center; }
}
`;
