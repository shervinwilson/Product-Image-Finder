// pages/api/remove-bg.js
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  const apiKey = process.env.REMOVEBG_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "Missing REMOVEBG_API_KEY. Add it in your .env.local file and Vercel environment variables.",
    });
  }

  const { imageUrl } = req.body || {};
  if (!imageUrl) return res.status(400).json({ error: "imageUrl is required" });

  try {
    const formData = new FormData();
    formData.append("image_url", imageUrl);
    formData.append("size", "auto");
    formData.append("format", "png"); // always PNG for transparency

    const response = await fetch("https://api.remove.bg/v1.0/removebg", {
      method: "POST",
      headers: { "X-Api-Key": apiKey },
      body: formData,
    });

    if (!response.ok) {
      const errText = await response.text();
      // Parse remove.bg error JSON if possible
      try {
        const errJson = JSON.parse(errText);
        const msg = errJson?.errors?.[0]?.title || "Remove.bg error";
        return res.status(response.status).json({ error: msg });
      } catch {
        return res.status(response.status).json({ error: `Remove.bg error (${response.status})` });
      }
    }

    // Get the processed image as a buffer
    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");

    return res.status(200).json({
      imageBase64: `data:image/png;base64,${base64}`,
    });
  } catch (err) {
    return res.status(500).json({ error: `Request failed: ${err.message}` });
  }
}
