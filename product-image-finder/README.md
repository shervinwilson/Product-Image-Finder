# Product Image Finder

A small web app: type a product name (or upload a CSV of many), get back real
product images pulled from a live Google Images search.

## How it works

- **Frontend**: Next.js pages (`pages/index.js`) — single search box + CSV
  upload, both call the same backend route.
- **Backend**: one API route (`pages/api/search-image.js`) that calls
  [SerpAPI](https://serpapi.com)'s Google Images search. Your API key lives
  only on the server (as a Vercel environment variable) — it is never sent
  to the browser.
- **No database, no file storage.** Images are linked directly from their
  original source URL. Nothing is downloaded or saved anywhere.

## 1. Get a free SerpAPI key

1. Go to https://serpapi.com and sign up (free tier: ~100 searches/month).
2. After signing up, copy your API key from the dashboard.

## 2. Run it locally (optional, to test before deploying)

```bash
npm install
cp .env.local.example .env.local
# then edit .env.local and paste your real key after SERPAPI_KEY=
npm run dev
```

Open http://localhost:3000 — you should see the app running.

## 3. Deploy to Vercel (get a shareable link)

### Option A — via GitHub (recommended)

1. Create a new GitHub repository and push this project to it:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
   git push -u origin main
   ```
2. Go to https://vercel.com and sign up / log in (you can use your GitHub account to sign in directly).
3. Click **Add New → Project**.
4. Select the GitHub repo you just pushed.
5. Vercel will auto-detect it's a Next.js app — leave the build settings as default.
6. Before clicking Deploy, open **Environment Variables** and add:
   - Key: `SERPAPI_KEY`
   - Value: *(paste your real SerpAPI key)*
7. Click **Deploy**.
8. After ~1 minute, Vercel gives you a live URL like `https://your-project.vercel.app` — that's your shareable link.

### Option B — via Vercel CLI (no GitHub needed)

```bash
npm install -g vercel
vercel login
vercel
```

Follow the prompts (accept defaults). When it asks about environment
variables, or once the project exists, run:

```bash
vercel env add SERPAPI_KEY
```

Paste your key when prompted, choose "Production" (and "Preview"/"Development"
too if you want it available there as well), then redeploy:

```bash
vercel --prod
```

You'll get a `https://your-project.vercel.app` link to share.

## Notes on the free tier

- SerpAPI's free plan gives ~100 searches/month. Each single product search
  = 1 search. Each row in a CSV batch = 1 search per row. A 100-row CSV will
  use your whole month's quota in one upload — keep that in mind, or upgrade
  SerpAPI's plan if you need more volume.
- The batch uploader pauses ~600ms between each row on purpose, to avoid
  bursting requests — this also makes it easy to watch progress in the UI.
- If you exceed your quota, SerpAPI will return an error, which will show up
  as "Error" status on the affected row(s) rather than crashing the app.

## Where to go from here

- Swap SerpAPI for a different image source (Bing Image Search API, a UPC
  database, etc.) by editing only `pages/api/search-image.js` — nothing in
  the frontend needs to change.
- Add authentication if this becomes a tool other people log into, rather
  than an open link anyone can use (and burn your API quota).
- If you eventually get Amazon PA-API access, add it as a second backend
  route and let the frontend pick a source.
