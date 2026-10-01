# NextWork Content Decoder

Decode any YouTube creator's Shorts with **Jev**, TypeSafe AI's System One model. Type a handle, watch Jev label every video live, find which hooks actually drive views, score new hooks before you film, and ask questions about the results.

Runs on Cloudflare's free tier, plus $5 of TypeSafe credit for Jev. Built for a NextWork project.

## What you need
- Node.js 22 or newer
- A free Cloudflare account
- A free YouTube Data API v3 key from Google Cloud
- A TypeSafe API key. TypeSafe asks you to add $5 of credit before you can create one.

## Setup
```bash
npm install
npm run setup      # logs you in, creates the database, registers your workers.dev subdomain, asks for your YouTube and TypeSafe keys
```
Jev runs on TypeSafe's API with your TypeSafe key. The Llama models (and Jev's fallback) run on Workers AI, which has no local version, so `npm run dev` runs your Worker and database on your machine but sends those calls to Cloudflare. That connection runs through your workers.dev subdomain, which is why setup registers one.
Then:
```bash
npm run dev        # open http://localhost:8787
```
The first time you open it, create your dashboard password.

## Deploy
```bash
npm run ship       # cloud database, deploy, then your YouTube and TypeSafe keys
```
Ship prints your app URL and a **one-time setup link**. Open the setup link to create the password for your deployed app. Anyone else who opens the URL sees a sign-in screen, never a way to create one.

## Your password
- Only a salted PBKDF2 hash is stored, in your own D1 database. The password itself is never saved.
- Signing in sets a secure, HttpOnly session cookie. Choose "Keep me signed in" for 30 days, otherwise 12 hours.
- 10 wrong attempts lock sign-in for 15 minutes.
- Forgot it? `npm run reset-password`, then create a new one.

## How it works
1. You enter a creator: `@handle`, a channel link, or any video or Shorts link from that creator. A creator you decoded before loads instantly from your library with zero Jev calls.
2. The YouTube adapter pulls up to 200 Shorts (180 seconds or shorter) with title, description, views, likes, thumbnail, and date. About 10 to 20 YouTube quota units per creator. It never uses `search.list`.
3. The dashboard sends 10 videos per request to the Worker, 4 requests at a time. Each request is **one Jev call** that answers every question in `schema.json` for all 10 videos in parallel.
4. Answers below the confidence threshold are flagged for review.
5. The dashboard compares each hook's median views with the channel median (lift) and builds the Winning Formula.
6. The Hook Lab: Llama 3.1 8B drafts hooks, Jev scores them with the questions in `judge.json`.
7. Ask the Decoder: Jev routes each question, Llama 3.3 70B writes the answer from your decoded data only, and Jev fact-checks it with the questions in `chat.json`.

Google Cloud only supplies the YouTube API key. TypeSafe runs Jev. Cloudflare hosts the Worker, runs the Llama models (and Jev as a fallback), and stores decodes in D1. The app reads public data only, so there is no YouTube login. It decodes titles and descriptions, not spoken scripts, because YouTube's captions API requires the video owner's login.

## The sidebar
- **Creators:** everyone you've decoded, with their avatar. Click to reload instantly with 0 Jev calls, or remove them.
- **Shortlist:** the hooks you saved for the current creator. Click to copy.
- **Jump to:** scrolls to a panel and highlights it.
- **Model Race, Theme, Sign out.**

## After a decode
- **Gallery:** filter by hook, Needs review, or Outperformers, sort by views or date, click any video to see every Jev answer.
- **Usage vs lift:** click a hook row to filter the gallery to it.
- **Hooks:** Copy or Shortlist any scored hook.
- **Copy client brief:** Winning Formula, top videos with links, and your shortlisted hooks, ready to paste.
- **Download CSV:** every video with its Jev labels, confidence, views, and lift.

## The files you edit
| File | What it controls |
|---|---|
| `schema.json` | The questions Jev asks about every video |
| `judge.json` | How Jev scores new hooks in the Hook Lab |
| `chat.json` | How Jev routes questions and fact-checks answers in Ask the Decoder |

Question types: `choice` picks one option and returns confidence, `noul` returns a yes/no probability, `score` places the answer on an ordered scale. After editing `schema.json`, use **Re-run Jev** on the dashboard. **Replay slowly** re-runs the decode at watch speed for recordings. It re-decodes the saved creator without new YouTube calls.

## Pages
- `/` the dashboard
- `/race.html` Model Race: Jev vs Llama 3.1 8B on the same 10 videos, live

## Models
| Job | Model |
|---|---|
| Decoding, Hook Lab scoring, question routing, fact-checking | Jev, on TypeSafe's API (`typesafe/jev` on Workers AI as the fallback) |
| Draft 5, Model Race | `@cf/meta/llama-3.1-8b-instruct-fp8-fast` |
| Ask the Decoder answers | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` |

The two Llama models run on Workers AI and share the free 10,000 Neurons per day. Jev on Workers AI is paid from AI Gateway credits instead, which is why the app calls it on TypeSafe's API with your key.

## Costs
- Jev: $0.042 per 1M input tokens, output free, paid from your TypeSafe credit ($5 to start). A 200-video decode costs well under $0.01.
- Workers, D1, and the Llama models on Workers AI: free plan limits. Going over a limit returns errors until the daily reset, it never bills you.
- YouTube Data API: 10,000 free quota units per day.

## Troubleshooting
| Problem | Fix |
|---|---|
| `npm install` fails on `sharp: Attempting to build from source` (macOS with Homebrew `vips`, or Linux with a system libvips) | macOS/Linux: `SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm install`. Windows PowerShell: `$env:SHARP_IGNORE_GLOBAL_LIBVIPS=1; npm install` |
| `You need to register a workers.dev subdomain` | Run `npm run setup` again; it registers one. Do not press `l` for local mode: Workers AI has no local version, so every AI feature fails with `Binding AI needs to be run remotely`. |
| Keys in `.env` seem ignored (`npm run dev` prints `Using secrets defined in .dev.vars`) | An old `.dev.vars` file wins over `.env`. Run `npm run setup`; it moves your keys into `.env`. |
| Wrangler logs in to the wrong account | Remove any `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_ACCOUNT_ID` lines from `.env`. Wrangler reads `.env` too, so those override `npx wrangler login`. |
| Forgot your password | `npm run reset-password` |
| Deployed app says it isn't set up yet | Open the one-time setup link that `npm run ship` printed |
| `Insufficient AI Gateway credits` or `Jev unavailable: TypeSafe API (401 ...)` | Your TypeSafe key is missing or wrong, so Jev fell back to Workers AI, which needs paid credits. Check `TYPESAFE_API_KEY` in `.env` (or run `npm run setup` again), confirm your TypeSafe account has credit, then restart `npm run dev`. |
| `quotaExceeded` from YouTube | The quota resets at midnight Pacific time. |
| `No public channel found` | Include the `@` and check the channel is public. |
| `No Shorts found` | The creator may post long-form only. Try another handle. |
| Many videos flagged for review | Tighten the criteria in `schema.json`, then Re-run Jev. |

## Credits
Jev by TypeSafe AI. Runs on Cloudflare Workers AI. Video data from the YouTube Data API.
