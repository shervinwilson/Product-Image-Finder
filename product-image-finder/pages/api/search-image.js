// pages/api/search-image.js
//
// Server-side route. Runs on Vercel, never in the browser.
// Keeps SERPAPI_KEY hidden from the client at all times.

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

  const params = new URLSearchParams({
    engine: "google_images",
    q: query,
    api_key: apiKey,
    num: "8",
  });

  try {
    const response = await fetch(`https://serpapi.com/search.json?${params.toString()}`);

    if (!response.ok) {
      const text = await response.text();
      return res.status(502).json({ error: `SerpAPI error (${response.status}): ${text.slice(0, 200)}` });
    }

    const data = await response.json();
    const rawResults = data.images_results || [];

    const results = rawResults.slice(0, 8).map((r) => ({
      title: r.title || "",
      imageUrl: r.original || r.thumbnail,
      thumbnailUrl: r.thumbnail,
      source: r.source || "",
      link: r.link || "",
    })).filter((r) => r.imageUrl);

    return res.status(200).json({
      query,
      results,
    });
  } catch (err) {
    return res.status(500).json({ error: `Request failed: ${err.message}` });
  }
}
