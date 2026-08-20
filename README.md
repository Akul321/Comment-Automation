# Comment desk

A tool that watches a list of LinkedIn profiles, notices when they publish something new, drafts a one-line comment, and posts it once you approve.

It runs entirely on your own computer. There is no server, no account to create, and nothing is uploaded anywhere except the model call that writes the comment.

![Node](https://img.shields.io/badge/node-18%2B-0f3d5c) ![Cost](https://img.shields.io/badge/cost-free-0f3d5c) ![License](https://img.shields.io/badge/license-MIT-0f3d5c)

---

## What it costs

Nothing. Every writer the app supports is free:

| Writer | Cost | Card required |
|---|---|---|
| Groq (default) | Free tier | No |
| Google Gemini | Free tier | No |
| Ollama (local) | Free — runs on your machine | No |
| Built-in templates | Free — no API call | No |

The app does not offer a paid tier and never will. If a free-tier limit is hit, the writer pauses and drafts keep flowing via built-in templates until the window reopens — so a quota spike is never silent and never costs money.

---

## What it does

- Checks each profile you list every 10 minutes for new posts
- Skips anything sensitive — bereavement, illness, layoffs, job-seeking, politics, legal trouble — before a comment is ever written
- Drafts a short comment using a free hosted AI service, a local model, or built-in templates
- Shows you each draft next to the original post, laid out the way it will look on LinkedIn
- Posts it after you press **Post this**, spaced out so it doesn't look automated

---

## Requirements

- **Node.js 18 or newer.** Check with `node -v`. If that fails or shows v16 or lower, install the LTS build from [nodejs.org](https://nodejs.org), then close and reopen your terminal.
- A LinkedIn account you're willing to sign in with on this machine.
- **Optional but recommended:** a free Groq API key from [console.groq.com/keys](https://console.groq.com/keys). You can also skip this and use Ollama or the built-in templates.

---

## Install

```bash
git clone https://github.com/Akul321/Comment-Automation.git
cd Comment-Automation
npm install
npx playwright install chromium
```

`npx playwright install chromium` downloads a browser (~150 MB). It's separate from the one you browse with — it won't touch your bookmarks, extensions, or logins.

### Add your API key

Copy the example env file and paste your Groq key into it. The `.env` file is gitignored, so the key never leaves your machine.

```bash
cp .env.example .env
```

Open `.env` and set:

```
GROQ_API_KEY=gsk_your_key_here
```

*Prefer another writer?* Skip this step — you'll pick a provider in the dashboard, and the app will work with Ollama or templates without any key.

### Run it

```bash
npm start
```

Open **http://localhost:4141** in your browser. Leave the terminal open — closing it stops the app.

---

## First-run walkthrough

Everything happens in the dashboard. Three steps, in order.

### 1. Sign in to LinkedIn

Click **Sign in**. A browser window opens on LinkedIn's own login page — you type your password there. **This app never sees your password.** It waits for the page to become logged in, saves the resulting session cookies to `data/session.json` on your computer, and closes the window.

The session lasts a few weeks. If it expires, the dashboard tells you and you press Sign in again.

### 2. Add profiles

Paste LinkedIn profile URLs into the textarea — one per line or comma-separated. Tracking parameters and duplicates are cleaned up automatically. Anything that isn't a profile URL is listed back to you so you can fix it.

### 3. Choose a comment writer

Pick a **Provider** and a **Model**. If the provider needs a key you either already set it in `.env` (Groq) or paste one here.

| Provider | What it needs | Notes |
|---|---|---|
| Groq | Free key from [console.groq.com/keys](https://console.groq.com/keys) — put in `.env` or paste here | Fastest, most natural results. Default |
| Google Gemini | Free key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | Comparable quality |
| Ollama | [Ollama](https://ollama.com) installed and running | No key, no quota, works offline. Needs ~5 GB disk for the model |
| Built-in templates | Nothing | Works immediately but reads generically. Also used as the fallback when hosted APIs are rate-limited |

Groq models available (validated against the current free tier):

- `openai/gpt-oss-20b` — fast, recommended default
- `openai/gpt-oss-120b` — best quality
- `openai/gpt-oss-safeguard-20b` — safety-tuned
- `groq/compound` / `groq/compound-mini` — agentic
- `qwen/qwen3.6-27b` — multilingual

Press **Test writer** to run one live call and see a sample sentence — proves the setup works without waiting for a real post.

Press **Save writer** to commit the choice.

### 4. Press Start.

---

## The first run looks like nothing happened

That's correct. You'll see lines like:

```
alice-example: added. 14 existing posts recorded and skipped — only new posts from now on.
```

Every profile you add has its whole existing backlog **recorded and permanently skipped**. Only posts that appear on a *later* check count as new.

Without this, adding 25 profiles would mean commenting on months of history in one burst — the fastest way to get a LinkedIn account restricted.

So the queue stays empty until someone you're watching actually posts. With 25 active profiles, expect the first drafts within a few hours. **Check now** forces an immediate check but won't bypass the backfill rule.

---

## Reviewing drafts

Each card in *Waiting for you* shows the original post in small grey text, then your draft rendered as a LinkedIn comment — because the question you're answering is *"do I want this under my name?"*

- Click into the comment to edit it, then **Save edit**
- **Post this** queues it to go out
- **Copy** copies the comment to your clipboard
- **Discard** throws it away

Comments are spaced apart and delayed by a few seconds so they don't land the instant a post goes up. Posted items appear under *Posted* with a Copy button so you can grab the exact wording if you need it later.

### Turning off approval

Under **Limits** there's *Hold each draft until I approve it*, on by default. Turning it off means comments go out under your name with nobody reading them first. Only do that once you've reviewed a few dozen drafts and trust the output.

---

## What happens when a free-tier limit is hit

Nothing bad. The app:

1. Reads the API's `Retry-After` response header and sets a global cooldown.
2. Shows a soft banner and a toast: *Writer cooling down (~Ns). Templates used in the meantime.*
3. Uses built-in templates for drafts that come in during the cooldown, so the queue keeps producing something reviewable.
4. Resumes the hosted writer automatically as soon as the cooldown clears.

You do not need to do anything. If you're doing heavy use and want more headroom, add your own key (which has its own quota separate from anyone else's).

---

## Dashboard basics

**Keyboard shortcuts**

| Key | Action |
|---|---|
| `S` | Start / stop the worker |
| `C` | Check now |
| `D` | Toggle dark mode |
| `?` | Show the shortcuts dialog |

**Dark mode** — auto-detected from your OS on first load, then remembered. Toggle in the top-right corner or press `D`.

**Limits** (under *Activity → Limits*):

| Setting | Default | What it does |
|---|---|---|
| Comments per day | 8 | Hard cap, resets at midnight |
| Minutes between | 10 | Minimum gap between two comments |
| Delay before posting | 40 sec | Pause so comments don't appear instantly |
| Hold each draft | on | Whether you approve each comment |

Anything else can be set in `.env` — copy `.env.example` to `.env` to see what's available.

---

## Using it on another computer

Clone and install as above, put your key in `.env`, and **sign in again on that machine**.

Do not copy `data/session.json` between computers. A LinkedIn session is tied to the browser fingerprint and IP that created it — a copied one looks like a hijacked session and triggers a security checkpoint.

To share one record of already-seen posts across machines so they never comment twice on the same post:

```bash
DATA_DIR="/path/to/shared/folder" npm start
```

Sessions always stay local regardless.

### Checking the dashboard from your phone

```bash
HOST=0.0.0.0 npm start
```

Then open `http://<your-computer-ip>:4141` from any device on the same wifi. There's no password on the dashboard, so use this only on a network you trust.

---

## Troubleshooting

| What you see | Fix |
|---|---|
| `node: command not found` | Install Node, then reopen your terminal |
| `EADDRINUSE` | Port 4141 is taken. Run `PORT=4200 npm start` |
| Sign-in never finishes | Complete every prompt LinkedIn shows, including 2FA |
| *LinkedIn session expired* | Normal every few weeks. Press Sign in again |
| Queue empty for days | Check **Skipped** — those are the filters working. Also normal on the first day |
| Everything skipped | Open **Skipped** to see the reason for each |
| Test writer says *401* / *invalid key* | The key in `.env` (or the one you pasted) is wrong. Get a fresh one from the provider's console |
| Test writer says *model_not_found* | Switch to a listed model in the dropdown and Save. Free-tier model lineups change occasionally |
| Rate-limit banner keeps returning | You're at the free-tier quota. Add your own key or wait |
| `comment_editor_not_found` | LinkedIn changed its layout. Add the new selector to `src/selectors.js` |

Run `npm test` to check the filtering and guardrail logic is working (38 tests).

---

## How it's built

```
src/
  server.js      local web server and JSON API
  worker.js      the loop: scan, draft, post
  scraper.js     reads posts from a profile's activity page
  generator.js   sensitive-topic filter, LLM call, guardrails, rate-limit backoff
  commenter.js   types and submits a comment
  selectors.js   every LinkedIn CSS selector, isolated here
  session.js     browser launch and login session
  db.js          JSON file store
  settings.js    settings the dashboard can change
  config.js      env-var-driven configuration
public/
  index.html    the dashboard
  styles.css    styles (light + dark mode via CSS variables)
  app.js        client-side rendering and API calls
```

When LinkedIn changes its layout, `src/selectors.js` is the only file that should need editing. Each entry is a list of candidates tried in order.

Comments are checked in code before they can be posted — length, no emoji, no links, no hashtags, no invented statistics, no openers like "Great post", and no repeat of anything used in the last 40. Guardrails written into a prompt get ignored; these don't.

Hosted API calls go through `fetchWithBackoff` in `src/generator.js` — retries on 5xx, respects `Retry-After` on 429/503, sets a global cooldown, and falls back to built-in templates when the LLM is quota-exhausted. This is how the free tier is kept safe.

---

## Worth knowing

Automated commenting is against LinkedIn's user agreement, and accounts doing it at volume get restricted. The defaults here are deliberately slow for that reason.

Use an account you could afford to lose, keep the daily limit low, and keep reading the drafts rather than letting it run unwatched.

---

## Licence

MIT. See [LICENSE](LICENSE).
