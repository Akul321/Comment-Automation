# Comment desk

Local LinkedIn comment automation. Watches a list of profiles for new posts, drafts one-sentence comments with an LLM, and submits them after your approval.

![Node](https://img.shields.io/badge/node-18%2B-0f3d5c) ![License](https://img.shields.io/badge/license-MIT-0f3d5c)

## Requirements

- Node.js 18 or newer
- A LinkedIn account
- Optional: a free API key from Groq or Google Gemini

## Install

```bash
git clone https://github.com/Akul321/Comment-Automation.git
cd Comment-Automation
npm install
npx playwright install chromium
cp .env.example .env
```

Add your Groq API key to `.env`:

```
GROQ_API_KEY=gsk_your_key_here
```

Start the app:

```bash
npm start
```

Dashboard: http://localhost:4141

## Providers

| Provider | Key required | Source |
|---|---|---|
| Groq | Yes (free tier) | [console.groq.com/keys](https://console.groq.com/keys) |
| Google Gemini | Yes (free tier) | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| Ollama | No | Requires local install from [ollama.com](https://ollama.com) |
| Templates | No | Built-in static output |

### Groq models

- `openai/gpt-oss-20b` (default)
- `openai/gpt-oss-120b`
- `openai/gpt-oss-safeguard-20b`
- `groq/compound`
- `groq/compound-mini`
- `qwen/qwen3.6-27b`

The app does not support paid tiers or billing.

## Usage

1. Sign in to LinkedIn from the dashboard.
2. Add profile URLs — one per line or comma-separated.
3. Select a provider and model. Use *Test writer* to verify credentials.
4. Press *Start*.

Drafts appear as new posts are detected. Card actions:

- **Post this** — queues the comment for submission
- **Save edit** — saves changes to the draft
- **Copy** — copies the comment to clipboard
- **Discard** — removes the draft

### Backfill

The first scan of a new profile marks all existing posts as skipped. Only posts detected after that point are considered new. This prevents comment bursts on historical content.

## Configuration

Editable in the dashboard (*Activity → Limits*) or via `.env`:

| Setting | Default | Purpose |
|---|---|---|
| `MAX_COMMENTS_PER_DAY` | 8 | Daily submission cap |
| `MIN_MINUTES_BETWEEN_COMMENTS` | 10 | Minimum gap between comments |
| `COMMENT_DELAY_MAX_SECONDS` | 40 | Delay between approval and submission |
| `POLL_MINUTES` | 10 | Interval between profile scans |
| `REQUIRE_APPROVAL` | true | Whether each draft needs manual approval |

See `.env.example` for the full list.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `S` | Start / stop worker |
| `C` | Run scan now |
| `D` | Toggle dark mode |
| `?` | Show shortcut list |

## Rate limiting

Hosted API calls use exponential backoff and respect `Retry-After` headers. On rate limit, the writer enters a cooldown and drafts fall back to built-in templates. Normal operation resumes automatically when the cooldown expires.

## Sharing state across machines

Point multiple installs at a shared dedupe store:

```bash
DATA_DIR="/path/to/shared/folder" npm start
```

Sign in separately on each machine. Session cookies are bound to the browser fingerprint and cannot be copied.

## Remote access

```bash
HOST=0.0.0.0 npm start
```

Accessible at `http://<host-ip>:4141`. The dashboard has no authentication — restrict to trusted networks.

## Troubleshooting

| Error | Resolution |
|---|---|
| `EADDRINUSE` | Port 4141 in use. Run `PORT=4200 npm start` |
| Test writer: `401` | Invalid API key |
| Test writer: `model_not_found` | Select a listed model and save |
| `submit_all_paths_failed` | LinkedIn markup changed. Check log for HTML snapshot |
| `LinkedIn session expired` | Sign in again from the dashboard |
| Queue empty | Backfill in progress, or filters skipped everything — check *Skipped* |

Run the test suite: `npm test`

## Project structure

```
src/
  server.js      HTTP server and JSON API
  worker.js      Scan and post loop
  scraper.js     Post extraction
  generator.js   LLM integration, filters, guardrails, backoff
  commenter.js   Comment submission
  selectors.js   LinkedIn CSS selectors
  session.js     Browser session management
  db.js          JSON persistence
  settings.js    Runtime settings
  config.js      Environment configuration
public/
  index.html     Dashboard markup
  styles.css     Light and dark theme styles
  app.js         Dashboard logic
```

LinkedIn markup changes should only require edits to `src/selectors.js`.

## Content guardrails

Drafts are filtered before submission for length, banned openers, emoji, links, hashtags, unverifiable statistics, and duplicates within the last 40 comments. Sensitive topics — bereavement, illness, layoffs, job-seeking, politics, legal matters — are excluded at the pre-filter stage.

## Licence

MIT. See [LICENSE](LICENSE).
