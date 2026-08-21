# Comment desk

Watches a list of LinkedIn profiles, notices when they post something new, drafts a one-sentence comment, and posts it once you approve. Everything runs on your own machine — the only outbound traffic is the model call that writes the draft, and the eventual comment submission to LinkedIn itself.

![Node](https://img.shields.io/badge/node-18%2B-0f3d5c) ![License](https://img.shields.io/badge/license-MIT-0f3d5c)

---

## Requirements

- Node.js 18 or newer. `node -v` will tell you what you have; anything older, install the LTS build from [nodejs.org](https://nodejs.org) and reopen your terminal.
- A LinkedIn account you're willing to sign in with on this machine.
- Optional: a free Groq key from [console.groq.com/keys](https://console.groq.com/keys). Without one you can still use Ollama or the built-in templates.

---

## Install

```bash
git clone https://github.com/Akul321/Comment-Automation.git
cd Comment-Automation
npm install
npx playwright install chromium
```

The last command downloads a browser that's separate from the one you use every day — around 150 MB, won't touch your bookmarks or extensions.

Put your Groq key somewhere the app can find it:

```bash
cp .env.example .env
```

Open `.env` and paste your key next to `GROQ_API_KEY=`. That file is gitignored, so the key stays local. If you'd rather use Ollama or templates, skip this step and pick the provider in the dashboard.

Then:

```bash
npm start
```

Open http://localhost:4141. Leave the terminal open — closing it stops the app.

---

## First run

The dashboard has three setup steps and won't let you start until they're done.

**Sign in to LinkedIn.** A browser window opens on LinkedIn's own login page. Type your password there — the app never touches the password field, it just waits for the session to become authenticated and saves the resulting cookies to `data/session.json`. Sessions last a few weeks. When one expires the dashboard tells you to sign in again.

**Add profiles.** Paste LinkedIn URLs into the textarea, one per line or comma-separated. Tracking parameters and duplicates get cleaned up automatically. Anything that isn't a profile URL is listed back to you.

**Choose a writer.** Pick a provider and a model. Press **Test writer** to run a live call and see a sample sentence — quicker than waiting for a real post to prove the setup works. The current Groq lineup is:

- `openai/gpt-oss-20b` — fast, sensible default
- `openai/gpt-oss-120b` — better quality, slower, tighter quota
- `openai/gpt-oss-safeguard-20b` — same size, safety-tuned
- `groq/compound` / `groq/compound-mini` — agentic variants
- `qwen/qwen3.6-27b` — multilingual

Press **Start** when the setup card collapses. The header square turns navy while the worker is running.

---

## Why nothing happens for a while

The first pass across a profile records everything already on the page and marks all of it as skipped. Only posts that appear on a *later* check count as new.

Without this rule, adding 25 profiles would mean commenting on months of history the moment you press Start — the shortest possible path to a restricted account. You'll see lines like:

```
alice-example: added. 14 existing posts recorded and skipped — only new posts from now on.
```

So the queue stays empty until someone you're watching actually posts. With 25 active profiles you'll usually see the first drafts within a few hours. **Check now** forces an immediate pass but won't bypass the backfill rule.

---

## Reviewing drafts

Each card in *Waiting for you* shows the original post in small grey text, then your draft rendered the way it will appear on LinkedIn. The layout answers the only question that matters: *do I want this under my name?*

- Click into the comment to edit it, then **Save edit**
- **Post this** queues it to go out
- **Copy** copies the comment to your clipboard
- **Discard** throws it away

Comments are spaced apart and delayed by a few seconds so they don't land the instant a post goes up. Posted items appear under *Posted*, with a Copy button in case you want the exact wording later.

### Auto-post

Under **Limits** there's *Hold each draft until I approve it*, on by default. Turning it off means comments go out under your name without anyone reading them first. Don't do that until you've read a few dozen drafts and trust the output.

---

## When a free tier throttles you

The hosted APIs (Groq, Gemini) publish a `Retry-After` header when you're rate-limited. The app reads it, sets a global cooldown, and shows a soft banner and a toast: *Writer cooling down (~Ns).* During that window the built-in templates keep drafting so the queue doesn't stall. When the cooldown clears the hosted writer resumes automatically. There's nothing to click.

If you're using this heavily and would prefer more headroom, add your own key in the dashboard — separate quota, separate cooldown.

---

## Limits

Under *Activity → Limits*:

- **Comments per day** — hard cap, resets at local midnight. Default 8.
- **Minutes between** — minimum gap between two comments. Default 10.
- **Delay before posting** — pause between approval and submission, so comments don't appear the instant a post goes live. Default 40 seconds.
- **Hold each draft** — whether you approve each one. Default on.

Everything else that can be configured lives in `.env` — `.env.example` shows the full list.

---

## Shortcuts

| Key | Action |
|---|---|
| `S` | Start / stop the worker |
| `C` | Check now |
| `D` | Toggle dark mode |
| `?` | Show this list |

Dark mode is picked up from your OS on first load and remembered from then on.

---

## Running on more than one machine

Clone and install as above, paste your key into `.env` on the new machine, and **sign in again there**. Do not copy `data/session.json` across — a LinkedIn session is tied to the browser fingerprint and IP that created it. A copied one looks like a hijacked session and trips a security checkpoint.

If you want two machines to share a single "already-seen" record so they can't comment on the same post twice, point them at a shared folder:

```bash
DATA_DIR="/path/to/shared/folder" npm start
```

Sessions always stay on the local machine regardless.

### Reaching the dashboard from your phone

```bash
HOST=0.0.0.0 npm start
```

Open `http://<your-computer-ip>:4141` from any device on the same wifi. There's no password on the dashboard, so only do this on a network you trust.

---

## Troubleshooting

| What you see | What it means |
|---|---|
| `node: command not found` | Node isn't installed, or your terminal doesn't know about it yet — reopen it |
| `EADDRINUSE` | Port 4141 is already taken. `PORT=4200 npm start` |
| Sign-in never finishes | Complete every prompt LinkedIn shows, including 2FA. Some accounts also get an email verification step |
| *LinkedIn session expired* | Normal every few weeks. Press Sign in again |
| Queue empty for days | Check *Skipped* — those are the filters working. First-day emptiness is also expected |
| Everything skipped | Open *Skipped*, each row has the reason next to it |
| Test writer says *401 / invalid key* | The key in `.env` (or the one you pasted) is wrong. Get a fresh one from the provider's console |
| Test writer says *model_not_found* | Pick a listed model in the dropdown and Save — the free-tier lineup shifts occasionally |
| Rate-limit banner keeps coming back | You're at the free-tier ceiling. Add your own key or wait |
| `submit_all_paths_failed` | LinkedIn's comment box changed enough that all three submit strategies failed. The log will include a *Composer HTML snapshot* line — that's what needs to go into `src/selectors.js` |

`npm test` runs the 38 filtering and guardrail tests. Fast — always worth running before you touch anything in `src/`.

---

## How it's laid out

```
src/
  server.js      local HTTP server and JSON API
  worker.js      the loop: scan, draft, post
  scraper.js     reads posts from a profile's activity page
  generator.js   sensitive-topic filter, LLM call, guardrails, rate-limit backoff
  commenter.js   types and submits a comment
  selectors.js   every LinkedIn CSS selector, isolated here
  session.js     browser launch and login state
  db.js          JSON file store
  settings.js    dashboard-editable settings
  config.js      env-var-driven configuration
public/
  index.html     the dashboard
  styles.css     styles, light and dark themes via CSS variables
  app.js         client-side rendering and API calls
```

When LinkedIn changes its layout, `src/selectors.js` is the only file that should need editing — each entry is a list of candidates tried in order.

Comments are checked in code before they can be posted: length, no emoji, no links, no hashtags, no invented statistics, no openers like *Great post*, no repeat of anything used in the last 40. Guardrails written into a prompt get ignored; these don't.

Hosted API calls go through `fetchWithBackoff` in `src/generator.js` — retries on 5xx, respects `Retry-After` on 429/503, sets a global cooldown, and falls back to built-in templates when the LLM is quota-exhausted. That's the machinery that keeps the free tier safe.

Comment submission tries three strategies in order: the selector list, a runtime DOM walk from the editor to find any nearby button whose label matches Post / Reply / Comment, then LinkedIn's own Ctrl+Enter shortcut. If all three miss, the composer's HTML gets dumped into the log so the next fix has evidence to work from.

---

## Worth knowing

Automated commenting is against LinkedIn's user agreement, and accounts doing it at volume get restricted. The defaults here are deliberately slow for that reason.

Use an account you could afford to lose, keep the daily limit low, and keep reading the drafts rather than letting it run unwatched.

---

## Licence

MIT. See [LICENSE](LICENSE).
