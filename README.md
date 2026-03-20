# Stock Research

Stock Research is a local React + Node.js + SQLite application for evaluating whether tracked stocks are suitable buys in the current market environment.

The app combines:
- market-wide context gathering
- ticker-to-company resolution
- source-grounded per-question stock analysis
- AI-based final evaluation and ranking
- persistent local history in SQLite

The current implementation is built around a simple local workflow:
- add tickers
- refresh market sentiment
- run analysis questions across all tracked tickers
- run final evaluations
- review answers, scores, and history in the UI

## What It Does

- Tracks stock tickers and resolves them to real public company identities
- Stores company name, exchange, CIK, and resolution source
- Supports editable question groups for reusable stock-analysis checklists
- Stores freeform answer narratives plus structured scoring fields
- Captures market sentiment and downstream macro effects
- Ranks stocks for current-market suitability
- Supports paused and resumed analysis jobs
- Stores all runs in local SQLite history
- Supports Gemini and xAI API keys via the Settings tab
- Supports manual company overrides when ticker resolution is incomplete or ambiguous

## Current Feature Set

### Client

The UI currently includes these tabs:
- Tickers
- Market Sentiment
- Questions
- Instructions
- Answers
- Evaluation
- History
- Settings

### Server

The backend currently provides endpoints for:
- settings and model selection
- ticker management
- company resolution and company overrides
- SEC filings lookup
- question group CRUD
- instructions storage
- market sentiment generation
- analysis job creation, pause, and resume
- answers and evaluations
- history summary and deletion

## Tech Stack

- Client: React 18, Vite 5, Mantine 8
- Server: Node.js 22+, Express 4
- Database: SQLite via Node's built-in `node:sqlite`
- AI providers: Google Gemini, xAI

## Project Structure

```text
.
├── client/          React + Vite frontend
├── server/          Express API, SQLite access, AI + retrieval logic
├── data/            Local SQLite database files
├── scripts/         Workspace helper scripts
├── reference/       Reference implementation used during development
├── todo.txt         Product notes and clarified requirements
└── progress.txt     Implementation progress notes
```

## Requirements

- Node.js 22 or newer
- npm
- A Gemini API key and/or xAI API key if you want to run AI workflows

## Installation

```bash
npm install
```

## Running the App

### Development

Starts both the client and server:

```bash
npm run dev
```

Or run them separately:

```bash
npm run dev:server
npm run dev:client
```

### Production-style local run

Build the client:

```bash
npm run build
```

Start the server:

```bash
npm run start
```

## Configuration

### API keys

API keys are stored in the local SQLite database through the Settings tab.

Supported providers:
- Gemini
- xAI

### Optional environment settings

The server reads `env.local` and `.env` from the repository root if present.

Useful optional settings:
- `PORT`
- `GEMINI_MODEL`
- `XAI_MODEL`
- `SEC_USER_AGENT`

Example:

```env
PORT=3000
GEMINI_MODEL=models/gemini-2.5-pro
XAI_MODEL=grok-4-1-fast-reasoning
SEC_USER_AGENT=Stock Research local app (your-email@example.com)
```

`SEC_USER_AGENT` is recommended because SEC endpoints prefer a descriptive user agent.

## Local Data Storage

The main application database is stored at:

```text
data/stock-research.sqlite
```

The database currently stores:
- settings
- tracked tickers
- company overrides
- question groups
- questions
- instructions
- market runs
- jobs
- answers
- evaluations

## Workflow

### 1. Add tickers

Use the Tickers tab to add one or many tickers. Bulk add accepts mixed delimiters such as:
- newlines
- spaces
- commas
- semicolons
- tabs

The server attempts to resolve each ticker to a company using multiple public sources.

### 2. Review or override company identity

If a ticker resolves incorrectly or incompletely, use the company override controls in the Tickers tab.

Overrides become the authoritative company identity for downstream analysis.

### 3. Refresh market sentiment

Use the Market Sentiment tab to generate a market-wide snapshot for the current environment.

The app stores:
- markdown summary
- structured risk and opportunity lists
- favored and pressured sectors
- source URLs

### 4. Edit question groups

Use the Questions tab to:
- create question groups
- duplicate an existing group
- edit questions
- activate the current group used for analysis

### 5. Run stock analysis

Use the active question group to analyze all tracked tickers.

The job system supports:
- sequential processing
- progress tracking
- pause
- resume
- persisted partial progress

### 6. Run evaluations

After answers are generated, run evaluations to produce a final suitability score and summary for each ticker.

## Data Sources and Grounding

The app tries to ground answers in public sources rather than relying on prompt-only memory.

### Company resolution

Ticker resolution currently uses a fallback chain based on:
- SEC exchange data
- SEC ticker-to-CIK data
- Yahoo Finance
- StockAnalysis

### Market context

Market proxy retrieval currently uses:
- Yahoo Finance as the primary source when available
- Stooq daily history as fallback for broad and sector ETF proxies
- FRED CSV series as fallback for the 10Y yield and WTI crude

### Ticker context

Ticker-specific context currently uses:
- Yahoo quote snapshot when available
- SEC filings retrieval
- company identity sources from the resolver

## Reliability Notes

Several reliability improvements are already built in:
- market-data retrieval degrades gracefully instead of failing the entire run
- analysis jobs are resumable
- answers are idempotent per job + ticker + question
- transient provider errors such as 429/502/503/504 are retried with backoff

## Current Known Limitations

- Some market fallback sources are daily-close based rather than true intraday snapshots.
- Yahoo can be rate-limited from the local environment, so the app should not depend on Yahoo alone for market-wide context.
- There are no automated tests yet.
- The UI is functional, but some presentation details such as richer citation display and deeper evaluation tooling still need refinement.

## Validated State

The current implementation has already been validated for:
- settings persistence
- SEC filings retrieval
- company override save and clear flows
- market sentiment generation
- paused and resumed analysis jobs
- completed full analysis runs
- completed evaluation runs

Most recently validated outcomes on the current local dataset:
- full analysis run completed for AAPL, MSFT, and NVDA
- evaluations completed successfully
- latest market context identified a risk-off backdrop with technology under pressure and energy relatively favored

## Scripts

Root workspace scripts:

```bash
npm run dev
npm run dev:client
npm run dev:server
npm run build
npm run start
```

## Roadmap

Near-term next steps:
- add a stronger intraday market data source
- improve evaluation presentation and ranking UX
- improve citation visibility in the UI
- expose retrieval-source status more clearly
- add cleanup or archival handling for failed historical jobs

## Notes

- This project is intended for research support, not automated trading.
- Outputs depend on the quality and availability of external public data sources and AI provider responses.
