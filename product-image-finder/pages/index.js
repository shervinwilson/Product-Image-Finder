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

const FORMAT_OPTIONS = ["jpg", "png", "webp"];
const SIZE_PRESETS = [
  { label: "Original", w: null, h: null },
  { label: "800×800", w: 800, h: 800 },
  { label: "1000×1000", w: 1000, h: 1000 },
  { label: "1200×1200", w: 1200, h: 1200 },
  { label: "Custom", w: "custom", h: "custom" },
];

// ── Utilities ──────────────────────────────────────────────────

function buildFilename(pattern, productName, brand, index, format = "jpg") {
  const base = (pattern || "{productName}")
    .replace("{productName}", productName || "image")
    .replace("{brand}", brand || "unknown")
    .replace("{index}", index + 1)
    .replace(/[^a-zA-Z0-9\-_().]/g, "_");
  return `${base}.${format}`;
}

// AI-style product name cleaner
function cleanProductName(name) {
  return name
    .trim()
    .replace(/\b(new|buy|get|best|cheap|sale|deal|free|shipping)\b/gi, "")
    .replace(/[|•·–—]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/,\s*$/, "")
    .trim()
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

async function convertAndDownload(url, filename, format, targetW, targetH) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const img = new Image();
    const objectUrl = URL.createObjectURL(blob);

    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = objectUrl;
    });

    const canvas = document.createElement("canvas");
    const w = targetW || img.naturalWidth;
    const h = targetH || img.naturalHeight;
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext("2d");
    if (format === "jpg") { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h); }
    ctx.drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(objectUrl);

    const mimeMap = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };
    const quality = format === "jpg" ? 0.92 : format === "webp" ? 0.88 : undefined;
    canvas.toBlob((outBlob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(outBlob);
      a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    }, mimeMap[format] || "image/jpeg", quality);
  } catch {
    window.open(url, "_blank");
  }
}

async function downloadAsZip(items, format, targetW, targetH) {
  const script = document.createElement("script");
  script.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
  document.head.appendChild(script);
  await new Promise((res) => (script.onload = res));

  const zip = new window.JSZip();
  const folder = zip.folder("product-images");
  const mimeMap = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

  for (const item of items) {
    try {
      const res = await fetch(item.url);
      const blob = await res.blob();

      if (format === "jpg" || targetW || targetH) {
        const img = new Image();
        const objUrl = URL.createObjectURL(blob);
        await new Promise((r) => { img.onload = r; img.src = objUrl; });
        const canvas = document.createElement("canvas");
        const w = targetW || img.naturalWidth;
        const h = targetH || img.naturalHeight;
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (format === "jpg") { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); }
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(objUrl);
        const converted = await new Promise((r) => canvas.toBlob(r, mimeMap[format] || "image/jpeg", 0.92));
        folder.file(item.filename, converted);
      } else {
        folder.file(item.filename, blob);
      }
    } catch {}
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

// ── Duplicate Detection (perceptual hash via canvas) ──────────
async function getImageHash(url) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const img = new Image();
    const objUrl = URL.createObjectURL(blob);
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = objUrl; });
    const SIZE = 8;
    const canvas = document.createElement("canvas");
    canvas.width = SIZE; canvas.height = SIZE;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, SIZE, SIZE);
    URL.revokeObjectURL(objUrl);
    const data = ctx.getImageData(0, 0, SIZE, SIZE).data;
    // Convert to grayscale pixels
    const pixels = [];
    for (let i = 0; i < data.length; i += 4) {
      pixels.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    }
    const avg = pixels.reduce((a, b) => a + b, 0) / pixels.length;
    return pixels.map((p) => (p >= avg ? "1" : "0")).join("");
  } catch { return null; }
}

function hammingDistance(a, b) {
  if (!a || !b || a.length !== b.length) return 999;
  let dist = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) dist++;
  return dist;
}

// Returns array of duplicate group indices: [{indices:[0,2,5], representative:0}]
async function detectDuplicates(results, threshold = 8) {
  const hashes = await Promise.all(results.map((r) => getImageHash(r.thumbnailUrl)));
  const visited = new Set();
  const groups = [];
  for (let i = 0; i < hashes.length; i++) {
    if (visited.has(i) || !hashes[i]) continue;
    const group = [i];
    for (let j = i + 1; j < hashes.length; j++) {
      if (!visited.has(j) && hammingDistance(hashes[i], hashes[j]) <= threshold) {
        group.push(j);
        visited.add(j);
      }
    }
    if (group.length > 1) {
      visited.add(i);
      groups.push({ indices: group, representative: i });
    }
  }
  return groups;
}

// ── AI Best Image Picker ──────────────────────────────────────
// Scores each result heuristically (no external API needed):
// - Source quality (amazon, getty, shutterstock = high)
// - Title relevance to product name
// - Thumbnail URL suggests original size
function scoreImage(result, productName) {
  let score = 0;
  const url = (result.thumbnailUrl || "").toLowerCase();
  const source = (result.source || "").toLowerCase();
  const title = (result.title || "").toLowerCase();
  const name = (productName || "").toLowerCase();

  // Source quality bonuses
  const premiumSources = ["amazon", "walmart", "target", "bestbuy", "apple", "samsung", "sony", "getty", "shutterstock", "adobe"];
  if (premiumSources.some((s) => source.includes(s))) score += 30;

  // Title keyword overlap with product name
  const nameWords = name.split(/\s+/).filter((w) => w.length > 2);
  const matchedWords = nameWords.filter((w) => title.includes(w));
  score += (matchedWords.length / Math.max(nameWords.length, 1)) * 40;

  // Prefer URLs that suggest larger originals
  if (url.includes("_AC_") || url.includes("_SL") || url.includes("large") || url.includes("1000") || url.includes("800")) score += 10;

  // Penalise stock photo watermark hints
  if (title.includes("stock") || title.includes("illustration") || title.includes("clipart")) score -= 20;

  // Penalise if source is a forum/social
  const weakSources = ["reddit", "twitter", "pinterest", "ebay", "etsy", "aliexpress"];
  if (weakSources.some((s) => source.includes(s))) score -= 10;

  return Math.max(0, score);
}

function pickBestImage(results, productName) {
  if (!results || results.length === 0) return 0;
  let bestIdx = 0;
  let bestScore = -Infinity;
  results.forEach((r, i) => {
    const s = scoreImage(r, productName);
    if (s > bestScore) { bestScore = s; bestIdx = i; }
  });
  return bestIdx;
}

// ── SVG Icons ─────────────────────────────────────────────────
const IC = {
  Search:      (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  Download:    (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
  Copy:        (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>,
  Link:        (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>,
  Upload:      (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>,
  Package:     (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 002 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>,
  Refresh:     (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>,
  Trash:       (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>,
  File:        (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>,
  ZoomIn:      (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>,
  Stop:        (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>,
  List:        (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>,
  Settings:    (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>,
  X:           (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  Tag:         (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>,
  ShoppingBag: (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>,
  Wand:        (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M17.8 6.2L19 5M3 21l9-9M12.2 6.2L11 5"/></svg>,
  Resize:      (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>,
  Image:       (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>,
  Sparkles:    (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/></svg>,
  Layers:      (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>,
  Trophy:      (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="8 21 12 21 16 21"/><line x1="12" y1="17" x2="12" y2="21"/><path d="M7 4H4a2 2 0 000 4c0 2.5 2 4 5 5"/><path d="M17 4h3a2 2 0 010 4c0 2.5-2 4-5 5"/><path d="M7 4h10v8a5 5 0 01-10 0V4z"/></svg>,
  Scissors:    (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>,
};

// ── Preloader ─────────────────────────────────────────────────
function Preloader({ done }) {
  const [hide, setHide] = useState(false);
  useEffect(() => { if (done) setTimeout(() => setHide(true), 700); }, [done]);
  if (hide) return null;
  return (
    <div className="preloader" style={{ opacity: done ? 0 : 1, pointerEvents: done ? "none" : "all" }}>
      <div className="preloader-content">
        <div className="preloader-logo">
          <IC.ShoppingBag width="26" height="26" />
        </div>
        <span className="preloader-title">Product Image Finder</span>
        <div className="preloader-bar-track"><div className="preloader-bar-fill" /></div>
        <span className="preloader-hint">Initialising workspace</span>
      </div>
    </div>
  );
}

// ── Status Badge ──────────────────────────────────────────────
function StatusBadge({ status, error }) {
  const map = {
    pending:   { label: "Pending",   cls: "badge-pending" },
    loading:   { label: "Searching", cls: "badge-loading" },
    done:      { label: "Found",     cls: "badge-done" },
    not_found: { label: "Not found", cls: "badge-warn" },
    error:     { label: "Error",     cls: "badge-error" },
  };
  const cfg = map[status] || map.pending;
  return (
    <span className={`badge ${cfg.cls}`} title={error || ""}>
      {status === "loading" && <span className="spinner-xs" />}
      {cfg.label}
    </span>
  );
}

// ── Main App ──────────────────────────────────────────────────
export default function Home() {
  const [ready, setReady] = useState(false);
  const [activeTab, setActiveTab] = useState("single");
  const [toast, setToast] = useState(null);
  const [preview, setPreview] = useState(null);
  const [showSettings, setShowSettings] = useState(false);

  // Single search
  const [singleName, setSingleName] = useState("");
  const [singleBrand, setSingleBrand] = useState("");
  const [singleLoading, setSingleLoading] = useState(false);
  const [singleError, setSingleError] = useState(null);
  const [singleResults, setSingleResults] = useState(null);
  const [selectedSingle, setSelectedSingle] = useState([]);

  // Output settings
  const [filenamePattern, setFilenamePattern] = useState("{productName}");
  const [outputFormat, setOutputFormat] = useState("jpg");
  const [sizePreset, setSizePreset] = useState(0); // index into SIZE_PRESETS
  const [customW, setCustomW] = useState(800);
  const [customH, setCustomH] = useState(800);

  // Batch
  const [batchRows, setBatchRows] = useState([]);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState(0);
  const [selectedRows, setSelectedRows] = useState([]);
  const [pickedImage, setPickedImage] = useState({});
  const [zipLoading, setZipLoading] = useState(false);

  // Duplicate detection
  const [dupGroups, setDupGroups] = useState([]); // for single search
  const [dupLoading, setDupLoading] = useState(false);
  const [showDupOnly, setShowDupOnly] = useState(false);

  // AI picker
  const [aiPickLoading, setAiPickLoading] = useState(false);
  const [aiPickedIdx, setAiPickedIdx] = useState(null); // for single search
  const [batchAiPicks, setBatchAiPicks] = useState({}); // rowIdx -> resultIdx

  // Background remover
  const [bgRemoving, setBgRemoving] = useState({}); // key -> bool
  const [bgRemoved, setBgRemoved] = useState({});   // key -> base64 data URL

  const removeBg = async (imageUrl, key) => {
    setBgRemoving((prev) => ({ ...prev, [key]: true }));
    try {
      const res = await fetch("/api/remove-bg", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Remove.bg failed");
      setBgRemoved((prev) => ({ ...prev, [key]: data.imageBase64 }));
      showToast("Background removed!");
    } catch (err) {
      showToast(`Error: ${err.message}`);
    } finally {
      setBgRemoving((prev) => ({ ...prev, [key]: false }));
    }
  };

  const downloadBase64 = (dataUrl, filename) => {
    const a = document.createElement("a");
    a.href = dataUrl; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  const fileInputRef = useRef(null);
  const cancelRef = useRef(false);

  // Computed size
  const getOutputSize = () => {
    const p = SIZE_PRESETS[sizePreset];
    if (!p || p.w === null) return { w: null, h: null };
    if (p.w === "custom") return { w: Number(customW) || null, h: Number(customH) || null };
    return { w: p.w, h: p.h };
  };

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

  const showToast = (msg, duration = 2400) => {
    setToast(msg); setTimeout(() => setToast(null), duration);
  };

  const clearSession = () => {
    localStorage.removeItem(SESSION_KEY);
    setBatchRows([]); setSelectedRows([]); setPickedImage({}); setBatchProgress(0);
  };

  const runSingleSearch = useCallback(async (e) => {
    e.preventDefault();
    if (!singleName.trim()) return;
    setSingleLoading(true); setSingleError(null); setSingleResults(null);
    setDupGroups([]); setShowDupOnly(false); setAiPickedIdx(null);
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

  // ── Duplicate detection (single search) ──
  const runDuplicateDetection = async () => {
    if (!singleResults?.length) return;
    setDupLoading(true);
    try {
      const groups = await detectDuplicates(singleResults);
      setDupGroups(groups);
      if (groups.length === 0) showToast("No duplicates found");
      else showToast(`Found ${groups.length} duplicate group${groups.length > 1 ? "s" : ""}`);
    } finally { setDupLoading(false); }
  };

  // ── AI best image picker (single search) ──
  const runAiPicker = () => {
    if (!singleResults?.length) return;
    setAiPickLoading(true);
    setTimeout(() => {
      const best = pickBestImage(singleResults, singleName);
      setAiPickedIdx(best);
      setAiPickLoading(false);
      showToast(`AI picked result #${best + 1} — ${singleResults[best]?.source || "best match"}`);
    }, 600); // slight delay for UX feel
  };

  // ── AI best image picker (bulk — all rows at once) ──
  const runBatchAiPicker = () => {
    const picks = {};
    batchRows.forEach((row, i) => {
      if (row.results?.length) picks[i] = pickBestImage(row.results, row.productName);
    });
    setBatchAiPicks(picks);
    setPickedImage((prev) => ({ ...prev, ...picks }));
    showToast(`AI auto-selected best image for ${Object.keys(picks).length} products`);
  };

  const stopBatch = useCallback(() => { cancelRef.current = true; setBatchRunning(false); }, []);
  const exportCsv = useCallback(() => { downloadCsv(rowsToCsv(batchRows), "product-images.csv"); }, [batchRows]);

  const rowsWithImages = batchRows.map((r, i) => ({ ...r, idx: i })).filter((r) => r.results?.[0]?.thumbnailUrl);
  const allSelected = rowsWithImages.length > 0 && rowsWithImages.every((r) => selectedRows.includes(r.idx));
  const toggleSelectAll = () => setSelectedRows(allSelected ? [] : rowsWithImages.map((r) => r.idx));
  const toggleRow = (idx) => setSelectedRows((prev) => prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]);
  const getPickedResult = (row, idx) => row.results?.[pickedImage[idx] ?? 0] || row.results?.[0];
  const failedCount = batchRows.filter((r) => r.status === "error" || r.status === "not_found").length;

  const downloadSelected = async () => {
    const { w, h } = getOutputSize();
    const rows = batchRows.map((r, i) => ({ ...r, idx: i })).filter((r) => selectedRows.includes(r.idx));
    for (const row of rows) {
      const result = getPickedResult(row, row.idx);
      if (!result?.thumbnailUrl) continue;
      const fn = buildFilename(filenamePattern, row.productName, row.brand, row.idx, outputFormat);
      await convertAndDownload(result.thumbnailUrl, fn, outputFormat, w, h);
      await new Promise((r) => setTimeout(r, 250));
    }
  };

  const downloadSelectedZip = async () => {
    setZipLoading(true);
    const { w, h } = getOutputSize();
    const items = batchRows.map((r, i) => ({ ...r, idx: i })).filter((r) => selectedRows.includes(r.idx))
      .map((row) => { const result = getPickedResult(row, row.idx); return result?.thumbnailUrl ? { url: result.thumbnailUrl, filename: buildFilename(filenamePattern, row.productName, row.brand, row.idx, outputFormat) } : null; })
      .filter(Boolean);
    await downloadAsZip(items, outputFormat, w, h);
    setZipLoading(false);
  };

  return (
    <>
      <style>{CSS}</style>
      <Preloader done={ready} />
      {toast && <div className="toast">{toast}</div>}

      {/* ── Preview Modal ── */}
      {preview && (
        <div className="modal-overlay" onClick={() => { setPreview(null); }}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setPreview(null)}>
              <IC.X width="13" height="13" />
            </button>
            {/* Toggle between original and bg-removed */}
            <div className="modal-img-wrap" style={{ background: bgRemoved["modal"] ? "repeating-conic-gradient(#27272a 0% 25%, #1f1f23 0% 50%) 0 0 / 16px 16px" : undefined }}>
              <img src={bgRemoved["modal"] || preview.url} alt={preview.title} className="modal-img" />
            </div>
            {bgRemoved["modal"] && (
              <div className="modal-bg-badge"><IC.Scissors width="10" height="10" /> Background removed</div>
            )}
            <p className="modal-title">{preview.title}</p>
            <div className="modal-actions">
              <a href={preview.link} target="_blank" rel="noreferrer" className="modal-btn modal-btn-ghost">
                <IC.Link width="13" height="13" /> Source
              </a>
              <button className="modal-btn modal-btn-primary" onClick={() => {
                if (bgRemoved["modal"]) {
                  downloadBase64(bgRemoved["modal"], buildFilename(filenamePattern, preview.title, "", 0, "png"));
                } else {
                  const { w, h } = getOutputSize();
                  convertAndDownload(preview.url, buildFilename(filenamePattern, preview.title, "", 0, outputFormat), outputFormat, w, h);
                }
              }}>
                <IC.Download width="13" height="13" /> {bgRemoved["modal"] ? "Download PNG" : "Download"}
              </button>
              <button className="modal-btn modal-btn-ghost" onClick={() => { navigator.clipboard.writeText(preview.url); showToast("URL copied"); }}>
                <IC.Copy width="13" height="13" /> Copy URL
              </button>
              <button
                className={`modal-btn ${bgRemoved["modal"] ? "modal-btn-bg-done" : "modal-btn-bg"}`}
                disabled={bgRemoving["modal"]}
                onClick={async () => {
                  if (bgRemoved["modal"]) {
                    setBgRemoved((prev) => { const n = { ...prev }; delete n["modal"]; return n; });
                  } else {
                    await removeBg(preview.url, "modal");
                  }
                }}
              >
                {bgRemoving["modal"] ? <span className="spinner-dark" /> : <IC.Scissors width="13" height="13" />}
                {bgRemoving["modal"] ? "Removing…" : bgRemoved["modal"] ? "Show original" : "Remove BG"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="page">

        {/* ── Header ── */}
        <header className="header">
          <div className="header-left">
            <div className="header-icon"><IC.ShoppingBag width="17" height="17" /></div>
            <div>
              <h1 className="site-title">Product Image Finder</h1>
              <p className="site-sub">E-commerce image sourcing</p>
            </div>
          </div>
          <div className="header-right">
            <button className={`icon-btn ${showSettings ? "icon-btn-active" : ""}`} title="Settings" onClick={() => setShowSettings((v) => !v)}>
              <IC.Settings width="15" height="15" />
            </button>
            <span className="header-badge">SerpAPI</span>
          </div>
        </header>

        {/* ── Settings / Output panel ── */}
        {showSettings && (
          <div className="settings-panel">
            <div className="settings-grid">

              {/* Filename */}
              <div className="settings-block">
                <div className="settings-block-label"><IC.Tag width="12" height="12" /> Filename pattern</div>
                <div className="chip-group">
                  {FILENAME_PATTERNS.map((p) => (
                    <button key={p.value} className={`chip ${filenamePattern === p.value ? "chip-active" : ""}`} onClick={() => setFilenamePattern(p.value)}>{p.label}</button>
                  ))}
                  <input className="chip-input" value={filenamePattern} onChange={(e) => setFilenamePattern(e.target.value)} placeholder="Custom…" />
                </div>
              </div>

              {/* Format */}
              <div className="settings-block">
                <div className="settings-block-label"><IC.Image width="12" height="12" /> Output format</div>
                <div className="chip-group">
                  {FORMAT_OPTIONS.map((f) => (
                    <button key={f} className={`chip chip-format ${outputFormat === f ? "chip-active" : ""}`} onClick={() => setOutputFormat(f)}>
                      {f.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              {/* Size */}
              <div className="settings-block">
                <div className="settings-block-label"><IC.Resize width="12" height="12" /> Output size</div>
                <div className="chip-group">
                  {SIZE_PRESETS.map((p, i) => (
                    <button key={i} className={`chip ${sizePreset === i ? "chip-active" : ""}`} onClick={() => setSizePreset(i)}>{p.label}</button>
                  ))}
                </div>
                {SIZE_PRESETS[sizePreset]?.w === "custom" && (
                  <div className="custom-size-row">
                    <input type="number" className="size-input" value={customW} onChange={(e) => setCustomW(e.target.value)} placeholder="W" />
                    <span className="size-x">×</span>
                    <input type="number" className="size-input" value={customH} onChange={(e) => setCustomH(e.target.value)} placeholder="H" />
                    <span className="size-unit">px</span>
                  </div>
                )}
              </div>

            </div>
            <div className="settings-preview">
              Preview — <code>{buildFilename(filenamePattern, "iPhone-16-Pro", "Apple", 0, outputFormat)}</code>
              {SIZE_PRESETS[sizePreset]?.w && (
                <span> · {SIZE_PRESETS[sizePreset].w === "custom" ? `${customW}×${customH}px` : `${SIZE_PRESETS[sizePreset].w}×${SIZE_PRESETS[sizePreset].h}px`}</span>
              )}
            </div>
          </div>
        )}

        {/* ── Tabs ── */}
        <div className="tab-bar">
          <button className={`tab ${activeTab === "single" ? "tab-active" : ""}`} onClick={() => setActiveTab("single")}>
            <IC.Search width="13" height="13" /> Single Search
          </button>
          <button className={`tab ${activeTab === "bulk" ? "tab-active" : ""}`} onClick={() => setActiveTab("bulk")}>
            <IC.List width="13" height="13" /> Bulk CSV
          </button>
        </div>

        {/* ══ SINGLE SEARCH ══ */}
        {activeTab === "single" && (
          <div className="card">
            <form onSubmit={runSingleSearch} className="search-form">
              <div className="input-wrap">
                <IC.ShoppingBag className="input-icon" width="14" height="14" />
                <input className="field" type="text" placeholder="Product name — e.g. iPhone 16 Pro Max" value={singleName} onChange={(e) => setSingleName(e.target.value)} />
                {singleName && (
                  <button type="button" className="clean-btn" title="Clean product name" onClick={() => { const cleaned = cleanProductName(singleName); setSingleName(cleaned); showToast(`Cleaned → ${cleaned}`); }}>
                    <IC.Wand width="13" height="13" /> Clean
                  </button>
                )}
              </div>
              <div className="input-wrap input-wrap-sm">
                <IC.Tag className="input-icon" width="13" height="13" />
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
                        <button className="btn-sm" onClick={() => {
                          const { w, h } = getOutputSize();
                          selectedSingle.forEach((i, n) => setTimeout(() => convertAndDownload(singleResults[i].thumbnailUrl, buildFilename(filenamePattern, singleName, singleBrand, i, outputFormat), outputFormat, w, h), n * 250));
                        }}>
                          <IC.Download width="13" height="13" /> Download {outputFormat.toUpperCase()}
                        </button>
                        <button className="btn-sm btn-outline" onClick={async () => {
                          const { w, h } = getOutputSize();
                          setZipLoading(true);
                          await downloadAsZip(selectedSingle.map((i) => ({ url: singleResults[i].thumbnailUrl, filename: buildFilename(filenamePattern, singleName, singleBrand, i, outputFormat) })), outputFormat, w, h);
                          setZipLoading(false);
                        }}>
                          <IC.Package width="13" height="13" /> {zipLoading ? "Zipping…" : "ZIP"}
                        </button>
                      </div>
                    )}
                    <div className="toolbar-actions" style={{ marginLeft: "auto" }}>
                      <button className="btn-sm btn-ai" onClick={runAiPicker} disabled={aiPickLoading} title="AI picks the best matching image">
                        {aiPickLoading ? <span className="spinner-dark" /> : <IC.Sparkles width="13" height="13" />}
                        AI Pick Best
                      </button>
                      <button className={`btn-sm ${showDupOnly ? "btn-dup-active" : "btn-outline"}`}
                        onClick={async () => { if (dupGroups.length === 0) await runDuplicateDetection(); else setShowDupOnly((v) => !v); }}
                        disabled={dupLoading} title="Detect visually similar duplicate images">
                        {dupLoading ? <span className="spinner-dark" /> : <IC.Layers width="13" height="13" />}
                        {dupLoading ? "Scanning…" : dupGroups.length > 0 ? `${dupGroups.length} Dup${dupGroups.length > 1 ? "s" : ""}` : "Find Dupes"}
                      </button>
                      {dupGroups.length > 0 && (
                        <button className="btn-sm btn-outline" onClick={() => setShowDupOnly((v) => !v)}>
                          {showDupOnly ? "Show all" : "Dupes only"}
                        </button>
                      )}
                    </div>
                    <span className="result-count">{singleResults.length} results</span>
                  </div>
                )}

                {dupGroups.length > 0 && (
                  <div className="dup-legend">
                    <IC.Layers width="12" height="12" />
                    <span>{dupGroups.length} duplicate group{dupGroups.length > 1 ? "s" : ""} detected — colour-coded borders</span>
                    <button className="dup-clear" onClick={() => { setDupGroups([]); setShowDupOnly(false); }}><IC.X width="10" height="10" /> Clear</button>
                  </div>
                )}

                {aiPickedIdx !== null && (
                  <div className="ai-banner">
                    <IC.Trophy width="13" height="13" />
                    <span>AI selected <strong>result #{aiPickedIdx + 1}</strong> ({singleResults[aiPickedIdx]?.source}) as the best match for "{singleName}"</span>
                    <button className="dup-clear" onClick={() => setAiPickedIdx(null)}><IC.X width="10" height="10" /></button>
                  </div>
                )}

                {(() => {
                  const dupMap = {};
                  dupGroups.forEach((g, gi) => g.indices.forEach((idx) => { dupMap[idx] = gi; }));
                  const dupIndices = new Set(Object.keys(dupMap).map(Number));
                  const displayResults = showDupOnly
                    ? singleResults.map((r, i) => ({ r, i })).filter(({ i }) => dupIndices.has(i))
                    : singleResults.map((r, i) => ({ r, i }));
                  const groupColors = ["#d97706","#7c3aed","#059669","#dc2626","#0284c7","#65a30d"];

                  return (
                    <div className="image-grid">
                      {displayResults.length === 0 && <div className="empty-state"><IC.Layers width="28" height="28" /><p>No duplicates found.</p></div>}
                      {displayResults.map(({ r, i }) => {
                        const isDup = dupIndices.has(i);
                        const dupGroupIdx = dupMap[i];
                        const groupColor = isDup ? groupColors[dupGroupIdx % groupColors.length] : null;
                        const isAiBest = aiPickedIdx === i;
                        return (
                          <div key={i}
                            className={`img-card ${selectedSingle.includes(i) ? "img-card-selected" : ""} ${isAiBest ? "img-card-ai-best" : ""}`}
                            style={isDup ? { borderColor: groupColor, boxShadow: `0 0 0 1px ${groupColor}44` } : {}}>
                            <div className="img-thumb-wrap">
                              <input type="checkbox" className="img-check"
                                checked={selectedSingle.includes(i)}
                                onChange={() => setSelectedSingle((prev) => prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i])}
                              />
                              {isAiBest && <div className="ai-best-badge"><IC.Trophy width="9" height="9" /> AI Best</div>}
                              {isDup && <div className="dup-badge" style={{ background: groupColor }}>G{dupGroupIdx + 1}</div>}
                              <img src={r.thumbnailUrl} alt={r.title} className="img-thumb" loading="lazy"
                                onClick={() => setPreview({ url: r.thumbnailUrl, title: r.title, link: r.link })} />
                              <div className="img-hover-overlay" onClick={() => setPreview({ url: r.thumbnailUrl, title: r.title, link: r.link })}>
                                <IC.ZoomIn width="14" height="14" /> Preview
                              </div>
                            </div>
                            <div className="img-meta">
                              <span className="img-title">{r.title}</span>
                              <span className="img-source">{r.source}</span>
                            </div>
                            {/* Removed BG preview */}
                            {bgRemoved[`single-${i}`] && (
                              <div className="bg-removed-wrap">
                                <div className="bg-removed-label"><IC.Scissors width="10" height="10" /> No background</div>
                                <img src={bgRemoved[`single-${i}`]} alt="No BG" className="bg-removed-thumb" />
                                <button className="bg-download-btn" onClick={() => downloadBase64(bgRemoved[`single-${i}`], buildFilename(filenamePattern, singleName, singleBrand, i, "png"))}>
                                  <IC.Download width="11" height="11" /> Download PNG
                                </button>
                              </div>
                            )}
                            <div className="img-actions">
                              <button className="img-btn" title={`Download as ${outputFormat.toUpperCase()}`} onClick={() => { const { w, h } = getOutputSize(); convertAndDownload(r.thumbnailUrl, buildFilename(filenamePattern, singleName, singleBrand, i, outputFormat), outputFormat, w, h); }}>
                                <IC.Download width="13" height="13" />
                              </button>
                              <button className="img-btn" title="Copy URL" onClick={() => { navigator.clipboard.writeText(r.thumbnailUrl); showToast("URL copied"); }}>
                                <IC.Copy width="13" height="13" />
                              </button>
                              <a href={r.link} target="_blank" rel="noreferrer" className="img-btn" title="Open source">
                                <IC.Link width="13" height="13" />
                              </a>
                              <button
                                className={`img-btn img-btn-bg ${bgRemoved[`single-${i}`] ? "img-btn-bg-done" : ""}`}
                                title="Remove background (Remove.bg)"
                                disabled={bgRemoving[`single-${i}`]}
                                onClick={() => removeBg(r.thumbnailUrl, `single-${i}`)}
                              >
                                {bgRemoving[`single-${i}`] ? <span className="spinner-xs" /> : <IC.Scissors width="13" height="13" />}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </>
            )}
          </div>
        )}

        {/* ══ BULK CSV ══ */}
        {activeTab === "bulk" && (
          <div className="card">
            <p className="section-hint">
              CSV columns — <code>Product Name</code> (required) · <code>Brand</code> (optional)
            </p>

            <div className="upload-row">
              <button className="btn-primary" onClick={() => fileInputRef.current?.click()} disabled={batchRunning}>
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
                      <IC.Search width="14" height="14" /> Find images · {batchRows.length} products
                    </button>
                  ) : (
                    <button className="btn-stop" onClick={stopBatch}>
                      <IC.Stop width="13" height="13" /> Stop
                    </button>
                  )}
                  {failedCount > 0 && !batchRunning && (
                    <button className="btn-outline-sm" onClick={retryFailed}>
                      <IC.Refresh width="13" height="13" /> Retry failed ({failedCount})
                    </button>
                  )}
                  <button className="btn-ghost-md" onClick={exportCsv} disabled={batchRunning || !batchRows.some((r) => r.results)}>
                    <IC.File width="13" height="13" /> Export CSV
                  </button>
                  {batchRows.some((r) => r.results?.length > 0) && !batchRunning && (
                    <button className="btn-sm btn-ai" onClick={runBatchAiPicker} title="AI auto-selects best image for every product">
                      <IC.Sparkles width="13" height="13" /> AI Pick All
                    </button>
                  )}
                  {selectedRows.length > 0 && (
                    <>
                      <button className="btn-sm" onClick={downloadSelected}>
                        <IC.Download width="13" height="13" /> Download {outputFormat.toUpperCase()} ({selectedRows.length})
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
                              {activeResult?.thumbnailUrl && <input type="checkbox" checked={selectedRows.includes(i)} onChange={() => toggleRow(i)} />}
                            </td>
                            <td className="td-product">
                              <div className="td-product-wrap">
                                {row.productName}
                                <button className="clean-inline-btn" title="Clean name" onClick={() => {
                                  const cleaned = cleanProductName(row.productName);
                                  setBatchRows((prev) => prev.map((r, idx) => idx === i ? { ...r, productName: cleaned } : r));
                                  showToast("Name cleaned");
                                }}>
                                  <IC.Wand width="11" height="11" />
                                </button>
                              </div>
                            </td>
                            <td className="td-muted">{row.brand || "—"}</td>
                            <td>
                              {activeResult?.thumbnailUrl ? (
                                <img src={activeResult.thumbnailUrl} alt="" className="table-thumb"
                                  onClick={() => setPreview({ url: activeResult.thumbnailUrl, title: activeResult.title, link: activeResult.link })} />
                              ) : <span className="td-muted">—</span>}
                            </td>
                            <td>
                              {row.results?.length > 1 ? (
                                <select className="pick-select" value={pickedIdx} onChange={(e) => setPickedImage((prev) => ({ ...prev, [i]: Number(e.target.value) }))}>
                                  {row.results.map((r, n) => <option key={n} value={n}>#{n + 1} — {r.source}</option>)}
                                </select>
                              ) : <span className="td-muted">—</span>}
                            </td>
                            <td className="td-title">{activeResult?.title || <span className="td-muted">—</span>}</td>
                            <td>
                              {activeResult?.thumbnailUrl && (
                                <div className="td-actions">
                                  <button className="img-btn" title={`Download ${outputFormat.toUpperCase()}`} onClick={() => {
                                    const { w, h } = getOutputSize();
                                    convertAndDownload(activeResult.thumbnailUrl, buildFilename(filenamePattern, row.productName, row.brand, i, outputFormat), outputFormat, w, h);
                                  }}>
                                    <IC.Download width="13" height="13" />
                                  </button>
                                  <button className="img-btn" title="Copy URL" onClick={() => { navigator.clipboard.writeText(activeResult.thumbnailUrl); showToast("URL copied"); }}>
                                    <IC.Copy width="13" height="13" />
                                  </button>
                                  <button
                                    className={`img-btn img-btn-bg ${bgRemoved[`batch-${i}`] ? "img-btn-bg-done" : ""}`}
                                    title="Remove background"
                                    disabled={bgRemoving[`batch-${i}`]}
                                    onClick={() => removeBg(activeResult.thumbnailUrl, `batch-${i}`)}
                                  >
                                    {bgRemoving[`batch-${i}`] ? <span className="spinner-xs" /> : <IC.Scissors width="13" height="13" />}
                                  </button>
                                  {bgRemoved[`batch-${i}`] && (
                                    <button className="img-btn" title="Download no-BG PNG" onClick={() => downloadBase64(bgRemoved[`batch-${i}`], buildFilename(filenamePattern, row.productName, row.brand, i, "png"))}>
                                      <IC.Download width="13" height="13" />
                                    </button>
                                  )}
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

// ── CSS ───────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  background: #111113;
  color: #e4e4e7;
  min-height: 100vh;
  -webkit-font-smoothing: antialiased;
}

/* ── Tokens ──
   bg-0: #111113  (page)
   bg-1: #18181b  (card)
   bg-2: #1f1f23  (input / elevated)
   bg-3: #27272a  (hover)
   border: #2e2e33
   text-primary: #f4f4f5
   text-secondary: #a1a1aa
   text-muted: #52525b
   white: #ffffff
*/

@keyframes spin     { to { transform: rotate(360deg); } }
@keyframes barSlide { 0%{transform:translateX(-100%)} 50%{transform:translateX(10%)} 100%{transform:translateX(110%)} }
@keyframes fadeUp   { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
@keyframes fadeIn   { from{opacity:0} to{opacity:1} }
@keyframes toastIn  { from{opacity:0;transform:translateX(-50%) translateY(6px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }
@keyframes pulse    { 0%,100%{opacity:1} 50%{opacity:.4} }

/* ── Preloader ── */
.preloader {
  position:fixed; inset:0; background:#111113; z-index:9999;
  display:flex; align-items:center; justify-content:center;
  transition: opacity 0.7s cubic-bezier(.4,0,.2,1);
}
.preloader-content { display:flex; flex-direction:column; align-items:center; gap:20px; }
.preloader-logo {
  width:52px; height:52px; background:#18181b; border:1px solid #2e2e33;
  border-radius:14px; display:flex; align-items:center; justify-content:center; color:#fff;
}
.preloader-title { font-size:15px; font-weight:700; color:#f4f4f5; letter-spacing:-.02em; }
.preloader-bar-track { width:100px; height:2px; background:#27272a; border-radius:99px; overflow:hidden; }
.preloader-bar-fill { height:100%; width:50%; background:#fff; border-radius:99px; animation:barSlide 1.5s ease-in-out infinite; }
.preloader-hint { font-size:11px; color:#52525b; letter-spacing:.04em; }

/* ── Page ── */
.page { max-width:1040px; margin:0 auto; padding:36px 24px 80px; animation:fadeUp .4s ease both; }

/* ── Header ── */
.header {
  display:flex; align-items:center; justify-content:space-between;
  margin-bottom:24px; padding-bottom:20px; border-bottom:1px solid #2e2e33;
}
.header-left { display:flex; align-items:center; gap:14px; }
.header-icon {
  width:38px; height:38px; background:#18181b; border:1px solid #2e2e33;
  border-radius:10px; display:flex; align-items:center; justify-content:center; color:#a1a1aa;
}
.site-title { font-size:16px; font-weight:700; color:#f4f4f5; letter-spacing:-.03em; }
.site-sub { font-size:12px; color:#52525b; margin-top:2px; }
.header-right { display:flex; align-items:center; gap:8px; }
.header-badge {
  font-size:10px; font-weight:700; padding:4px 10px;
  background:#18181b; color:#52525b; border:1px solid #2e2e33;
  border-radius:6px; letter-spacing:.06em; text-transform:uppercase;
}
.icon-btn {
  width:32px; height:32px; background:#18181b; border:1px solid #2e2e33;
  border-radius:8px; display:flex; align-items:center; justify-content:center;
  color:#71717a; cursor:pointer; transition:all .15s;
}
.icon-btn:hover { border-color:#3f3f46; color:#e4e4e7; }
.icon-btn-active { background:#27272a; border-color:#3f3f46; color:#f4f4f5; }

/* ── Settings panel ── */
.settings-panel {
  background:#18181b; border:1px solid #2e2e33; border-radius:12px;
  padding:20px; margin-bottom:16px; animation:fadeIn .2s ease;
}
.settings-grid { display:flex; flex-direction:column; gap:18px; }
.settings-block {}
.settings-block-label {
  display:flex; align-items:center; gap:6px;
  font-size:11px; font-weight:600; color:#71717a; text-transform:uppercase;
  letter-spacing:.07em; margin-bottom:10px;
}
.chip-group { display:flex; gap:6px; flex-wrap:wrap; align-items:center; }
.chip {
  padding:5px 12px; border-radius:7px; font-size:12px; font-weight:600;
  border:1px solid #2e2e33; background:#18181b; color:#71717a;
  cursor:pointer; transition:all .15s; font-family:inherit;
}
.chip:hover { border-color:#3f3f46; color:#a1a1aa; }
.chip-active { background:#f4f4f5; color:#111113; border-color:#f4f4f5; }
.chip-format { min-width:52px; text-align:center; }
.chip-input {
  flex:1; min-width:160px; padding:5px 10px; font-size:12px;
  border:1px solid #2e2e33; border-radius:7px; outline:none;
  background:#111113; color:#e4e4e7; font-family:inherit;
}
.chip-input:focus { border-color:#3f3f46; }
.custom-size-row { display:flex; align-items:center; gap:8px; margin-top:10px; }
.size-input {
  width:76px; padding:6px 10px; font-size:13px; font-family:inherit;
  border:1px solid #2e2e33; border-radius:7px; background:#111113; color:#e4e4e7; outline:none; text-align:center;
}
.size-input:focus { border-color:#3f3f46; }
.size-x { color:#52525b; font-size:13px; }
.size-unit { color:#52525b; font-size:12px; }
.settings-preview { margin-top:14px; font-size:12px; color:#52525b; padding-top:14px; border-top:1px solid #27272a; }

/* ── Tabs ── */
.tab-bar {
  display:flex; gap:2px; margin-bottom:14px;
  background:#18181b; border:1px solid #2e2e33;
  border-radius:10px; padding:4px; width:fit-content;
}
.tab {
  display:flex; align-items:center; gap:7px; padding:8px 18px;
  font-size:13px; font-weight:600; border:none; border-radius:7px;
  cursor:pointer; background:transparent; color:#71717a;
  transition:all .18s; font-family:inherit; letter-spacing:-.01em;
}
.tab:hover { color:#a1a1aa; }
.tab-active { background:#27272a; color:#f4f4f5; border:1px solid #3f3f46; }

/* ── Card ── */
.card {
  background:#18181b; border:1px solid #2e2e33; border-radius:14px;
  padding:24px; animation:fadeUp .3s ease both;
}

/* ── Search form ── */
.search-form { display:flex; gap:10px; flex-wrap:wrap; }
.input-wrap {
  flex:1; min-width:220px; display:flex; align-items:center; gap:10px;
  border:1px solid #2e2e33; border-radius:10px; padding:0 14px;
  background:#111113; transition:all .18s;
}
.input-wrap:focus-within { border-color:#3f3f46; background:#18181b; }
.input-wrap-sm { max-width:210px; }
.input-icon { color:#3f3f46; flex-shrink:0; display:flex; }
.field {
  flex:1; border:none; outline:none; background:transparent;
  font-size:13.5px; color:#e4e4e7; padding:12px 0; font-family:inherit;
}
.field::placeholder { color:#3f3f46; }
.clean-btn {
  display:flex; align-items:center; gap:5px;
  background:#27272a; color:#a1a1aa; border:1px solid #3f3f46;
  border-radius:6px; padding:4px 10px; font-size:11px; font-weight:600;
  cursor:pointer; font-family:inherit; white-space:nowrap; transition:all .15s;
}
.clean-btn:hover { background:#2e2e33; color:#f4f4f5; }

/* ── Buttons ── */
.btn-primary {
  display:flex; align-items:center; gap:8px;
  background:#fff; color:#111113; border:none; border-radius:10px;
  padding:11px 20px; font-size:13px; font-weight:700;
  cursor:pointer; transition:all .18s; font-family:inherit; white-space:nowrap;
}
.btn-primary:hover:not(:disabled) { background:#e4e4e7; }
.btn-primary:disabled { opacity:.3; cursor:not-allowed; }
.btn-stop {
  display:flex; align-items:center; gap:7px;
  background:#18181b; color:#a1a1aa; border:1px solid #2e2e33;
  border-radius:10px; padding:10px 18px; font-size:13px; font-weight:600;
  cursor:pointer; font-family:inherit; transition:all .15s;
}
.btn-stop:hover { border-color:#3f3f46; color:#f4f4f5; }
.btn-sm {
  display:inline-flex; align-items:center; gap:6px;
  background:#fff; color:#111113; border:none; border-radius:8px;
  padding:8px 14px; font-size:12px; font-weight:700;
  cursor:pointer; font-family:inherit; white-space:nowrap; transition:all .15s;
}
.btn-sm:hover { background:#e4e4e7; }
.btn-outline {
  background:transparent !important; color:#a1a1aa !important;
  border:1px solid #2e2e33 !important;
}
.btn-outline:hover { background:#27272a !important; color:#f4f4f5 !important; border-color:#3f3f46 !important; }
.btn-outline-sm {
  display:inline-flex; align-items:center; gap:6px;
  background:transparent; color:#a1a1aa; border:1px solid #2e2e33;
  border-radius:8px; padding:8px 14px; font-size:12px; font-weight:600;
  cursor:pointer; font-family:inherit; white-space:nowrap; transition:all .15s;
}
.btn-outline-sm:hover { background:#27272a; color:#f4f4f5; border-color:#3f3f46; }
.btn-ghost-md {
  display:flex; align-items:center; gap:7px;
  background:transparent; color:#71717a; border:none;
  font-size:12.5px; font-weight:600; cursor:pointer;
  padding:10px 6px; font-family:inherit; transition:color .15s;
}
.btn-ghost-md:hover { color:#a1a1aa; }
.btn-ghost-md.btn-danger:hover { color:#f87171; }

/* ── Upload row ── */
.upload-row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:20px; }

/* ── Results toolbar ── */
.results-toolbar {
  display:flex; align-items:center; gap:12px; flex-wrap:wrap;
  margin:20px 0 16px; padding:10px 14px;
  background:#111113; border:1px solid #27272a; border-radius:9px;
}
.check-label {
  display:flex; align-items:center; gap:8px;
  font-size:12.5px; font-weight:600; cursor:pointer;
  color:#a1a1aa; user-select:none;
}
.count-badge {
  background:#fff; color:#111113; font-size:10px; font-weight:800;
  padding:1px 7px; border-radius:99px;
}
.toolbar-actions { display:flex; gap:7px; }
.result-count { margin-left:auto; font-size:11.5px; color:#52525b; font-weight:500; }

/* ── Image grid ── */
.image-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(158px,1fr)); gap:10px; margin-top:4px; }
.img-card {
  border:1px solid #27272a; border-radius:10px; overflow:hidden;
  display:flex; flex-direction:column; background:#111113;
  transition:border-color .18s, box-shadow .18s;
}
.img-card:hover { border-color:#3f3f46; box-shadow:0 4px 20px rgba(0,0,0,.4); }
.img-card-selected { border-color:#71717a !important; }
.img-thumb-wrap { position:relative; overflow:hidden; }
.img-check {
  position:absolute; top:8px; left:8px; width:15px; height:15px;
  z-index:2; cursor:pointer; accent-color:#fff;
}
.img-thumb {
  width:100%; height:128px; object-fit:contain;
  background:#18181b; cursor:zoom-in; display:block; transition:transform .22s;
}
.img-card:hover .img-thumb { transform:scale(1.04); }
.img-hover-overlay {
  position:absolute; inset:0; background:rgba(0,0,0,.72);
  display:flex; align-items:center; justify-content:center; gap:7px;
  color:#fff; font-size:12px; font-weight:600; opacity:0; transition:opacity .18s; cursor:zoom-in;
}
.img-card:hover .img-hover-overlay { opacity:1; }
.img-meta { padding:9px 10px 4px; flex:1; }
.img-title {
  display:block; font-size:11px; font-weight:600; color:#a1a1aa;
  line-height:1.4; overflow:hidden; display:-webkit-box;
  -webkit-line-clamp:2; -webkit-box-orient:vertical; margin-bottom:3px;
}
.img-source { display:block; font-size:10px; color:#52525b; }
.img-actions { display:flex; gap:3px; padding:5px 7px 8px; }
.img-btn {
  flex:1; background:#18181b; color:#71717a; border:1px solid #27272a;
  border-radius:6px; padding:7px 0; cursor:pointer; text-align:center;
  text-decoration:none; display:flex; align-items:center; justify-content:center;
  transition:all .15s; font-family:inherit;
}
.img-btn:hover { background:#27272a; color:#e4e4e7; border-color:#3f3f46; }

/* ── Empty state ── */
.empty-state { display:flex; flex-direction:column; align-items:center; gap:12px; padding:48px; color:#3f3f46; text-align:center; }
.empty-state p { font-size:13px; color:#3f3f46; }

/* ── Batch toolbar ── */
.batch-toolbar { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:14px; }
.progress-label { font-size:11.5px; color:#52525b; font-weight:600; margin-left:auto; font-variant-numeric:tabular-nums; }

/* ── Progress ── */
.progress-track { height:2px; background:#27272a; border-radius:99px; overflow:hidden; margin-bottom:16px; }
.progress-fill { height:100%; background:#fff; border-radius:99px; transition:width .35s ease; }

/* ── Table ── */
.table-wrap { overflow-x:auto; border-radius:10px; border:1px solid #27272a; }
.data-table { width:100%; border-collapse:collapse; font-size:12.5px; min-width:740px; }
.data-table thead tr { background:#111113; }
.data-table th {
  text-align:left; padding:11px 14px; font-size:10px; font-weight:700;
  text-transform:uppercase; letter-spacing:.08em; color:#52525b;
  border-bottom:1px solid #27272a;
}
.data-table td { padding:10px 14px; border-bottom:1px solid #1f1f23; vertical-align:middle; }
.data-table tr:last-child td { border-bottom:none; }
.data-table tbody tr:hover td { background:#1f1f23; }
.row-selected td { background:#27272a !important; }
.td-product { font-weight:600; color:#e4e4e7; }
.td-product-wrap { display:flex; align-items:center; gap:8px; }
.td-muted { color:#52525b; }
.td-title { color:#71717a; max-width:220px; font-size:12px; }
.table-thumb { width:40px; height:40px; object-fit:contain; border-radius:6px; border:1px solid #27272a; cursor:zoom-in; background:#111113; }
.pick-select {
  font-size:11.5px; padding:4px 8px; border-radius:6px;
  border:1px solid #2e2e33; background:#111113; cursor:pointer;
  max-width:150px; color:#a1a1aa; font-family:inherit; outline:none;
}
.td-actions { display:flex; gap:5px; }
.clean-inline-btn {
  background:transparent; border:none; color:#3f3f46; cursor:pointer;
  padding:2px; border-radius:4px; display:flex; align-items:center; transition:color .15s;
}
.clean-inline-btn:hover { color:#a1a1aa; }

/* ── Section hint ── */
.section-hint { font-size:12.5px; color:#52525b; margin-bottom:18px; }

/* ── Modal ── */
.modal-overlay {
  position:fixed; inset:0; background:rgba(0,0,0,.85); z-index:1000;
  display:flex; align-items:center; justify-content:center;
  backdrop-filter:blur(10px); animation:fadeIn .2s ease;
}
.modal-box {
  background:#18181b; border:1px solid #2e2e33; border-radius:16px;
  padding:28px; max-width:480px; width:92%; position:relative;
  box-shadow:0 40px 80px rgba(0,0,0,.7); animation:fadeUp .22s ease;
}
.modal-close {
  position:absolute; top:14px; right:14px;
  background:#27272a; border:1px solid #3f3f46;
  width:28px; height:28px; border-radius:99px;
  display:flex; align-items:center; justify-content:center;
  cursor:pointer; color:#71717a; transition:all .15s;
}
.modal-close:hover { background:#3f3f46; color:#f4f4f5; }
.modal-img-wrap {
  background:#111113; border:1px solid #27272a; border-radius:10px;
  padding:20px; margin-bottom:14px;
  display:flex; align-items:center; justify-content:center;
}
.modal-img { max-width:100%; max-height:280px; object-fit:contain; border-radius:6px; }
.modal-title { font-size:12px; color:#71717a; margin-bottom:16px; line-height:1.6; text-align:center; }
.modal-actions { display:flex; gap:8px; justify-content:center; flex-wrap:wrap; }
.modal-btn {
  display:inline-flex; align-items:center; gap:7px; border-radius:8px;
  padding:9px 16px; font-size:12px; font-weight:600;
  cursor:pointer; font-family:inherit; transition:all .15s; text-decoration:none;
}
.modal-btn-primary { background:#fff; color:#111113; border:none; }
.modal-btn-primary:hover { background:#e4e4e7; }
.modal-btn-ghost { background:#27272a; color:#a1a1aa; border:1px solid #3f3f46; }
.modal-btn-ghost:hover { background:#3f3f46; color:#f4f4f5; }

/* ── Badges ── */
.badge {
  display:inline-flex; align-items:center; gap:5px;
  font-size:10.5px; font-weight:700; padding:3px 9px;
  border-radius:99px; border:1px solid; letter-spacing:.02em;
}
.badge-pending  { color:#52525b; background:#18181b; border-color:#27272a; }
.badge-loading  { color:#a1a1aa; background:#27272a; border-color:#3f3f46; animation:pulse 1.4s ease infinite; }
.badge-done     { color:#86efac; background:#052e16; border-color:#14532d; }
.badge-warn     { color:#fcd34d; background:#1c1400; border-color:#3d2c00; }
.badge-error    { color:#fca5a5; background:#1c0000; border-color:#3d0000; }

/* ── Spinners ── */
.spinner { width:14px; height:14px; border:2px solid rgba(17,17,19,.2); border-top-color:#111113; border-radius:50%; animation:spin .6s linear infinite; display:inline-block; }
.spinner-xs { width:7px; height:7px; border:1.5px solid currentColor; border-top-color:transparent; border-radius:50%; animation:spin .6s linear infinite; display:inline-block; }

/* ── Error box ── */
.error-box { margin-top:14px; padding:12px 16px; background:#1c0000; border:1px solid #3d0000; border-radius:9px; color:#fca5a5; font-size:12.5px; }

/* ── Toast ── */
.toast {
  position:fixed; bottom:28px; left:50%; transform:translateX(-50%);
  background:#f4f4f5; color:#111113; padding:9px 20px; border-radius:99px;
  font-size:12px; font-weight:700; z-index:2000;
  box-shadow:0 8px 24px rgba(0,0,0,.5);
  animation:toastIn .22s ease; white-space:nowrap; letter-spacing:-.01em;
}

/* ── Watermark ── */
.watermark { text-align:center; margin-top:52px; font-size:11.5px; color:#3f3f46; }
.watermark-link {
  color:#71717a; text-decoration:none; font-weight:700;
  border-bottom:1px solid #3f3f46; padding-bottom:1px; transition:color .15s;
}
.watermark-link:hover { color:#a1a1aa; border-color:#71717a; }

/* ── Background Remover ── */
.img-btn-bg { color: #86efac !important; border-color: #14532d !important; background: #052e16 !important; }
.img-btn-bg:hover { background: #14532d !important; color: #bbf7d0 !important; }
.img-btn-bg-done { color: #6ee7b7 !important; border-color: #065f46 !important; background: #022c22 !important; }
.bg-removed-wrap {
  margin: 0 7px 4px; border-radius: 7px; border: 1px solid #14532d;
  background: repeating-conic-gradient(#1f1f23 0% 25%, #18181b 0% 50%) 0 0 / 12px 12px;
  overflow: hidden;
}
.bg-removed-label {
  display: flex; align-items: center; gap: 5px;
  font-size: 9.5px; font-weight: 700; color: #6ee7b7;
  padding: 5px 8px; background: #052e16; border-bottom: 1px solid #14532d; letter-spacing: .04em;
}
.bg-removed-thumb { width: 100%; height: 90px; object-fit: contain; display: block; }
.bg-download-btn {
  width: 100%; display: flex; align-items: center; justify-content: center; gap: 6px;
  background: #14532d; color: #86efac; border: none; padding: 6px;
  font-size: 11px; font-weight: 700; cursor: pointer; font-family: inherit;
  transition: background .15s;
}
.bg-download-btn:hover { background: #166534; }
.modal-btn-bg {
  background: #052e16; color: #86efac; border: 1px solid #14532d;
}
.modal-btn-bg:hover { background: #14532d; }
.modal-btn-bg-done {
  background: #022c22; color: #6ee7b7; border: 1px solid #065f46;
}
.modal-btn-bg-done:hover { background: #14532d; }
.modal-bg-badge {
  display: flex; align-items: center; justify-content: center; gap: 6px;
  font-size: 10.5px; font-weight: 700; color: #6ee7b7;
  margin: -8px 0 8px; letter-spacing: .04em;
}

/* ── AI & Duplicate styles ── */
.btn-ai {
  background: linear-gradient(135deg, #1e1b4b, #312e81) !important;
  color: #a5b4fc !important; border: 1px solid #3730a3 !important;
}
.btn-ai:hover:not(:disabled) { background: linear-gradient(135deg, #312e81, #3730a3) !important; color: #c7d2fe !important; }
.btn-ai:disabled { opacity: .4; cursor: not-allowed; }
.btn-dup-active { background: #451a03 !important; color: #fdba74 !important; border: 1px solid #7c2d12 !important; }
.img-card-ai-best { border-color: #4338ca !important; box-shadow: 0 0 0 2px #3730a322 !important; }
.ai-best-badge {
  position: absolute; bottom: 6px; right: 6px; z-index: 3;
  background: #1e1b4b; color: #a5b4fc; border: 1px solid #3730a3;
  border-radius: 5px; padding: 2px 7px; font-size: 9.5px; font-weight: 700;
  display: flex; align-items: center; gap: 4px; letter-spacing: .02em;
}
.dup-badge {
  position: absolute; top: 6px; right: 6px; z-index: 3;
  color: #fff; border-radius: 5px; padding: 2px 7px;
  font-size: 9.5px; font-weight: 800; letter-spacing: .04em;
}
.dup-legend {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  margin: 8px 0; padding: 9px 14px; background: #1c0f00;
  border: 1px solid #7c2d12; border-radius: 8px;
  font-size: 12px; color: #fdba74;
}
.ai-banner {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  margin: 8px 0; padding: 9px 14px; background: #0f0f2a;
  border: 1px solid #3730a3; border-radius: 8px;
  font-size: 12px; color: #a5b4fc;
}
.ai-banner strong { color: #c7d2fe; }
.dup-clear {
  display: inline-flex; align-items: center; gap: 4px;
  background: transparent; border: none; color: inherit; cursor: pointer;
  font-size: 11px; font-weight: 600; opacity: .7; margin-left: auto; padding: 2px 4px;
}
.dup-clear:hover { opacity: 1; }
.spinner-dark { width: 12px; height: 12px; border: 2px solid rgba(165,180,252,.2); border-top-color: #a5b4fc; border-radius: 50%; animation: spin .6s linear infinite; display: inline-block; }
code {
  background:#27272a; padding:2px 7px; border-radius:5px;
  color:#a1a1aa; font-size:11.5px; border:1px solid #3f3f46;
  font-family:'SF Mono','Fira Code',monospace;
}
input[type="checkbox"] { accent-color:#fff; cursor:pointer; }

@media (max-width:600px) {
  .header { flex-direction:column; align-items:flex-start; gap:12px; }
  .image-grid { grid-template-columns:repeat(auto-fill,minmax(140px,1fr)); }
  .search-form, .upload-row { flex-direction:column; }
  .input-wrap-sm { max-width:none; }
  .tab-bar { width:100%; }
  .tab { flex:1; justify-content:center; }
  .batch-toolbar { gap:6px; }
}
`;
