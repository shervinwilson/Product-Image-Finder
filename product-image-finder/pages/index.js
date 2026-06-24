// pages/index.js
import { useState, useCallback, useRef } from "react";
import { parseCsv, rowsToCsv, downloadCsv } from "../lib/csv";

const SAMPLE_CSV = `Product Name,Brand
iPhone 16 Pro Max,Apple
Galaxy S25 Ultra,Samsung
WH-1000XM5 Headphones,Sony
Instant Pot Duo,Instant Pot`;

async function fetchImagesFor(productName, brand) {
  const res = await fetch("/api/search-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productName, brand }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Search failed");
  }
  return data.results || [];
}

export default function Home() {
  // Single search state
  const [singleName, setSingleName] = useState("");
  const [singleBrand, setSingleBrand] = useState("");
  const [singleLoading, setSingleLoading] = useState(false);
  const [singleError, setSingleError] = useState(null);
  const [singleResults, setSingleResults] = useState(null);

  // Batch state
  const [batchRows, setBatchRows] = useState([]);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState(0);
  const fileInputRef = useRef(null);
  const cancelRef = useRef(false);

  const runSingleSearch = useCallback(async (e) => {
    e.preventDefault();
    if (!singleName.trim()) return;
    setSingleLoading(true);
    setSingleError(null);
    setSingleResults(null);
    try {
      const results = await fetchImagesFor(singleName.trim(), singleBrand.trim());
      setSingleResults(results);
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
      setBatchRows(
        parsed.map((p) => ({
          ...p,
          status: "pending",
          results: null,
          error: null,
        }))
      );
    };
    reader.readAsText(file);
  }, []);

  const loadSample = useCallback(() => {
    const parsed = parseCsv(SAMPLE_CSV);
    setBatchRows(
      parsed.map((p) => ({ ...p, status: "pending", results: null, error: null }))
    );
  }, []);

  const runBatch = useCallback(async () => {
    if (batchRows.length === 0) return;
    setBatchRunning(true);
    cancelRef.current = false;
    setBatchProgress(0);

    for (let i = 0; i < batchRows.length; i++) {
      if (cancelRef.current) break;

      setBatchRows((prev) =>
        prev.map((r, idx) => (idx === i ? { ...r, status: "loading" } : r))
      );

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

      // Small delay between requests to stay well within free-tier rate limits.
      if (i < batchRows.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
    }

    setBatchRunning(false);
  }, [batchRows]);

  const stopBatch = useCallback(() => {
    cancelRef.current = true;
    setBatchRunning(false);
  }, []);

  const exportResults = useCallback(() => {
    const csv = rowsToCsv(batchRows);
    downloadCsv(csv, "product-images-results.csv");
  }, [batchRows]);

  return (
    <div style={styles.page}>
      <style>{globalCss}</style>

      <header style={styles.header}>
        <h1 style={styles.h1}>Product Image Finder</h1>
        <p style={styles.subtitle}>
          Search a single product, or upload a CSV to look up many at once. Images come from a
          live Google Images search via SerpAPI.
        </p>
      </header>

      {/* Single search */}
      <section style={styles.card}>
        <h2 style={styles.h2}>Search one product</h2>
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
          <div style={styles.imageGrid}>
            {singleResults.length === 0 && <p style={styles.mutedText}>No images found.</p>}
            {singleResults.map((r, i) => (
              <a key={i} href={r.link} target="_blank" rel="noreferrer" style={styles.imageCard}>
                <img src={r.thumbnailUrl} alt={r.title} style={styles.imageThumb} loading="lazy" />
                <span style={styles.imageCardTitle}>{r.title}</span>
                <span style={styles.imageCardSource}>{r.source}</span>
              </a>
            ))}
          </div>
        )}
      </section>

      {/* Batch / CSV upload */}
      <section style={styles.card}>
        <h2 style={styles.h2}>Bulk upload (CSV)</h2>
        <p style={styles.mutedText}>
          Columns: <code>Product Name</code> (required), <code>Brand</code> (optional)
        </p>

        <div style={styles.row}>
          <button
            type="button"
            style={styles.btnSecondary}
            onClick={() => fileInputRef.current?.click()}
            disabled={batchRunning}
          >
            Choose CSV file
          </button>
          <button type="button" style={styles.btnGhost} onClick={loadSample} disabled={batchRunning}>
            Load sample data
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
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
              <button
                type="button"
                style={styles.btnGhost}
                onClick={exportResults}
                disabled={batchRunning || !batchRows.some((r) => r.results)}
              >
                Export results to CSV
              </button>
              <span style={styles.mutedText}>{batchProgress}% complete</span>
            </div>

            <div style={styles.progressBar}>
              <div style={{ ...styles.progressFill, width: `${batchProgress}%` }} />
            </div>

            <div style={styles.tableWrap}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Product name</th>
                    <th style={styles.th}>Brand</th>
                    <th style={styles.th}>Image</th>
                    <th style={styles.th}>Matched title</th>
                    <th style={styles.th}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {batchRows.map((row, i) => (
                    <tr key={i}>
                      <td style={styles.td}>{row.productName}</td>
                      <td style={styles.td}>{row.brand || "—"}</td>
                      <td style={styles.td}>
                        {row.results?.[0]?.thumbnailUrl ? (
                          <img
                            src={row.results[0].thumbnailUrl}
                            alt=""
                            style={{ width: 40, height: 40, objectFit: "contain" }}
                          />
                        ) : (
                          "—"
                        )}
                      </td>
                      <td style={{ ...styles.td, maxWidth: 240 }}>
                        {row.results?.[0]?.title || "—"}
                      </td>
                      <td style={styles.td}>
                        <StatusBadge status={row.status} error={row.error} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <footer style={styles.footer}>
        Image results come from Google Images via SerpAPI and link back to their original source.
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
    <span
      title={error || ""}
      style={{
        display: "inline-block",
        fontSize: 12,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 999,
        color: cfg.color,
        background: cfg.bg,
      }}
    >
      {cfg.label}
    </span>
  );
}

const styles = {
  page: {
    maxWidth: 880,
    margin: "0 auto",
    padding: "32px 20px 60px",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    color: "#1a1d23",
  },
  header: { marginBottom: 28 },
  h1: { fontSize: 24, fontWeight: 700, margin: "0 0 6px" },
  subtitle: { fontSize: 14, color: "#5b6270", margin: 0, lineHeight: 1.5, maxWidth: 560 },
  card: {
    background: "#fff",
    border: "1px solid #e4e6eb",
    borderRadius: 12,
    padding: 24,
    marginBottom: 20,
  },
  h2: { fontSize: 16, fontWeight: 700, margin: "0 0 14px" },
  singleForm: { display: "flex", gap: 10, flexWrap: "wrap" },
  input: {
    flex: 1,
    minWidth: 200,
    padding: "10px 12px",
    fontSize: 14,
    border: "1px solid #d1d5db",
    borderRadius: 8,
    outline: "none",
  },
  row: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14 },
  btnPrimary: {
    background: "#2f5fd6",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "10px 18px",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
  btnSecondary: {
    background: "#fff",
    color: "#1a1d23",
    border: "1px solid #d1d5db",
    borderRadius: 8,
    padding: "10px 16px",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
  btnGhost: {
    background: "transparent",
    color: "#2f5fd6",
    border: "none",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    padding: "10px 4px",
  },
  errorText: { color: "#c4432f", fontSize: 13, marginTop: 10 },
  mutedText: { color: "#5b6270", fontSize: 13, margin: "4px 0 14px" },
  imageGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
    gap: 12,
    marginTop: 16,
  },
  imageCard: {
    border: "1px solid #e4e6eb",
    borderRadius: 8,
    padding: 8,
    textDecoration: "none",
    color: "#1a1d23",
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  imageThumb: {
    width: "100%",
    height: 100,
    objectFit: "contain",
    background: "#f7f8fa",
    borderRadius: 6,
  },
  imageCardTitle: {
    fontSize: 11.5,
    fontWeight: 600,
    lineHeight: 1.3,
    overflow: "hidden",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
  },
  imageCardSource: { fontSize: 10.5, color: "#5b6270" },
  progressBar: {
    height: 6,
    background: "#f1f2f5",
    borderRadius: 999,
    overflow: "hidden",
    marginBottom: 16,
  },
  progressFill: { height: "100%", background: "#2f5fd6", transition: "width 0.3s ease" },
  tableWrap: { overflowX: "auto", border: "1px solid #e4e6eb", borderRadius: 8 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 600 },
  th: {
    textAlign: "left",
    padding: "10px 12px",
    background: "#f7f8fa",
    borderBottom: "1px solid #e4e6eb",
    fontSize: 11,
    textTransform: "uppercase",
    color: "#5b6270",
    fontWeight: 600,
  },
  td: { padding: "8px 12px", borderBottom: "1px solid #f1f2f5", verticalAlign: "middle" },
  footer: { fontSize: 12, color: "#9aa0aa", textAlign: "center", marginTop: 8 },
};

const globalCss = `
  body { margin: 0; background: #f7f8fa; }
  input:focus { border-color: #2f5fd6 !important; }
  table { table-layout: auto; }
`;
