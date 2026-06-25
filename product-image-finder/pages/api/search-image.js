// pages/api/search-image.js
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST" });
  }

  const { productName, brand } = req.body || {};
  if (!productName || !productName.trim()) {
    return res.status(400).json({ error: "productName is required" });
  }

  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "Server is missing SERPAPI_KEY. Add it in Vercel project settings under Environment Variables.",
    });
  }

  const query = [brand, productName, "amazon"].filter(Boolean).join(" ");

  // Fetch multiple pages to get as many results as possible
  const allResults = [];
  const PAGES = 5; // 5 pages × ~20 results = up to 100 images

  for (let page = 0; page < PAGES; page++) {
    const params = new URLSearchParams({
      engine: "google_images",
      q: query,
      api_key: apiKey,
      ijn: String(page), // SerpAPI uses ijn (image page index) for pagination
    });

    try {
      const response = await fetch(`https://serpapi.com/search.json?${params.toString()}`);
      if (!response.ok) {
        if (page === 0) {
          const text = await response.text();
          return res.status(502).json({ error: `SerpAPI error (${response.status}): ${text.slice(0, 200)}` });
        }
        break; // stop paginating on error after first page
      }

      const data = await response.json();
      const pageResults = data.images_results || [];
      if (pageResults.length === 0) break; // no more results

      for (const r of pageResults) {
        if (r.thumbnail && !allResults.find((x) => x.thumbnailUrl === r.thumbnail)) {
          allResults.push({
            title: r.title || "",
            imageUrl: r.original || r.thumbnail,
            thumbnailUrl: r.thumbnail,
            source: r.source || "",
            link: r.link || "",
          });
        }
      }
    } catch (err) {
      if (page === 0) {
        return res.status(500).json({ error: `Request failed: ${err.message}` });
      }
      break;
    }
  }

  return res.status(200).json({ query, results: allResults });
}
