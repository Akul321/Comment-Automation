# Comment desk

A tool that watches a list of LinkedIn profiles, notices when they publish something new, drafts a one-line comment, and posts it once you approve.

It runs entirely on your own computer. There is no server, no account to create, and nothing is uploaded anywhere.

![Node](https://img.shields.io/badge/node-18%2B-0f3d5c) ![License](https://img.shields.io/badge/license-MIT-0f3d5c)

---

## What it does

- Checks each profile you list every 10 minutes for new posts
- Skips anything sensitive — bereavement, illness, layoffs, job-seeking, politics, legal trouble — before a comment is ever written
- Drafts a short comment using a free AI service, a local model, or built-in templates
- Shows you each draft next to the original post, laid out the way it will look on LinkedIn
- Posts it after you press **Post this**, spaced out so it doesn't look automated

---

## Before you install

You need **Node.js 18 or newer**. Check with:

```bash
node -v
```

If that fails or shows v16 or lower, install the LTS build from [nodejs.org](https://nodejs.org), then close and reopen your terminal.

---

## Install

```bash
git clone https://github.com/YOUR-USERNAME/comment-desk.git
cd comment-desk
npm install
npx playwright install chromium
npm start
```

The last command prints a URL. Open **http://localhost:4141** in your browser.

`npx playwright install chromium` downloads a browser, around 150 MB. It's separate from the one you browse with and won't touch your bookmarks, extensions, or logins.

Leave the terminal open — closing it stops the app.

---

## Set up

Everything happens in the dashboard.

**1. Sign in to LinkedIn.** A browser window opens on LinkedIn's own login page. You type your password there. This app never sees it — it waits for the page to become logged in, then saves the resulting cookies to your computer.

**2. Add profiles.** Paste LinkedIn profile URLs, one per line or separated by commas. Tracking parameters and duplicates are cleaned up automatically. Anything that isn't a profile URL is listed back to you.

**3. Choose a comment writer.**

| Option | Needs | Notes |
|---|---|---|
| Hosted — Groq | Free API key from [console.groq.com/keys](https://console.groq.com/keys) | Fastest, most natural results |
| Hosted — Google Gemini | Free API key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | Comparable quality |
| Local — Ollama | [Ollama](https://ollama.com) installed | No key, no quota, works offline. Needs ~5 GB disk |
| Built-in templates | Nothing | Works immediately but reads generically |

Neither hosted option asks for a credit card.

**4. Press Start.**

---

## The first run looks like nothing happened

That's correct. You'll see lines like:

```
alice-example: added. 14 existing posts recorded and skipped — only new posts from now on.
```

Every profile you add has its whole existing backlog recorded and permanently skipped. Only posts that appear on a **later** check count as new.

Without this, adding 25 profiles would mean commenting on months of history in one burst — the fastest way to get a LinkedIn account restricted.

So the queue stays empty until someone you're watching actually posts. With 25 active profiles, expect the first drafts within a few hours. **Check now** forces an immediate check but won't bypass the backfill rule.

---

## Reviewing drafts

Each card shows the original post in small grey text, then your draft rendered as a LinkedIn comment — because the question you're answering is "do I want this under my name?"

- Click into the comment to edit it, then **Save edit**
- **Post this** queues it to go out
- **Discard** throws it away

Comments are spaced apart and delayed by a few seconds so they don't land the instant a post goes up.

### Turning off approval

Under **Limits** there's *Hold each draft until I approve it*, on by default. Turning it off means comments go out under your name with nobody reading them first. Only do that once you've reviewed a few dozen drafts and trust the output.

---

## Settings

Under **Limits**:

| Setting | Default | What it does |
|---|---|---|
| Comments per day | 8 | Hard cap, resets at midnight |
| Minutes between | 10 | Minimum gap between two comments |
| Delay before posting | 40 sec | Pause so comments don't appear instantly |
| Hold each draft | on | Whether you approve each comment |

Anything else can be set in a `.env` file — copy `.env.example` to `.env` to see what's available.

---

## Using it on another computer

Clone and install as above, and **sign in again on that machine**.

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
| Queue empty for days | Check **Skipped** — those are the filters working |
| Everything skipped | Open **Skipped** to see the reason for each |
| `comment_editor_not_found` | LinkedIn changed its layout. Add the new selector to `src/selectors.js` |

Run `npm test` to check the filtering and guardrail logic is working.

---

## How it's built

```
src/
  server.js      local web server and JSON API
  worker.js      the loop: scan, draft, post
  scraper.js     reads posts from a profile's activity page
  generator.js   sensitive-topic filter, AI call, output guardrails
  commenter.js   types and submits a comment
  selectors.js   every LinkedIn CSS selector, isolated here
  session.js     browser launch and login session
  db.js          JSON file store
  settings.js    settings the dashboard can change
public/          the dashboard
```

When LinkedIn changes its layout, `src/selectors.js` is the only file that should need editing. Each entry is a list of candidates tried in order.

Comments are checked in code before they can be posted — length, no emoji, no links, no hashtags, no invented statistics, no openers like "Great post", and no repeat of anything used in the last 40. Guardrails written into a prompt get ignored; these don't.

---

## Worth knowing

Automated commenting is against LinkedIn's user agreement, and accounts doing it at volume get restricted. The defaults here are deliberately slow for that reason.

Use an account you could afford to lose, keep the daily limit low, and keep reading the drafts rather than letting it run unwatched.

---

## Licence

MIT. See [LICENSE](LICENSE).
