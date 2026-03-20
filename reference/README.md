# marketmind

React + Node app that queries xAI or Google Gemini for a stock's cash runway, news signals, and analyst sentiment.

## Prereqs

- Node.js 22+

You'll enter API keys in the app's **Settings** screen (stored locally in SQLite).

No API keys are read from env vars or key files.

## Run (dev)

One command (starts API + Vite UI):

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

Optional (recommended for Dilution tab SEC endpoints):

```bash
cp .env.example env.local
```

Then open **Settings** in the UI and add your xAI and/or Gemini key.

## Run (single container)

Build:

```bash
docker build -t marketmind:local .
```

Run (detached, with persistent local storage in `./data`):

```bash
mkdir -p data
docker run -d --name marketmind -p 3000:3000 \
	-e SEC_USER_AGENT="marketmind (Private; Laurent@hotmail.co.za)" \
	-v "$PWD/data:/app/data" marketmind:local
```

Logs / stop:

```bash
docker logs -f marketmind
docker stop marketmind
docker rm marketmind
```

Open `http://localhost:3000`.

Then open **Settings** in the UI and add your xAI and/or Gemini key.

## Config

- `SEC_USER_AGENT` (recommended): a descriptive User-Agent with contact email for SEC endpoints (e.g. `marketmind (Private; Laurent@hotmail.co.za)`)

- `XAI_MODEL` (default: `grok-4-1-fast-reasoning`)
- `XAI_API_URL` (default: `https://api.x.ai/v1/chat/completions`)
- `XAI_TIMEOUT_MS` (default: `120000`)

- `GEMINI_MODEL` (default: `models/gemini-2.5-pro`)
- `GEMINI_API_URL` (default: Google Generative Language API endpoint)
- `GEMINI_TIMEOUT_MS` (default: `120000`)

### Analysts

The Analysts tab uses recent Yahoo Finance RSS headlines and asks xAI to detect analyst actions (upgrade/downgrade/price target changes) and aggregate sentiment by time bucket.

### News

The News tab fetches recent headlines via Yahoo Finance RSS and asks xAI to:
- flag split/dilution items expected within ~30 days
- score positivity by time bucket (1h / 24h / week / month)
