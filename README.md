# NextWork Content Decoder

Decode any YouTube creator's Shorts with **Jev**, TypeSafe AI's System One model. Type a handle, watch Jev label every video live, find which hooks actually drive views, score new hooks before you film, and ask questions about the results.

Runs on Cloudflare's free tier. Built for a NextWork project.

## What you need
- Node.js 20 or newer
- A free Cloudflare account, with a workers.dev subdomain registered (Workers and Pages in the dashboard)
- A free YouTube Data API v3 key from Google Cloud

## Setup
```bash
npm install
npx wrangler login
npm run setup      # creates the database, then asks for your YouTube key and a passcode
```
Then:
```bash
npm run dev        # open http://localhost:8787
```

## Deploy
```bash
npm run ship       # cloud database, deploy, then secrets from .dev.vars
```
Open the workers.dev URL it prints and enter your passcode.

## How it works
1. You enter a creator: `@handle`, a channel link, or any video or Shorts link from that creator. A creator you decoded before loads instantly from your library with zero Jev calls.
2. The YouTube adapter pulls up to 200 Shorts (180 seconds or shorter) with title, description, views, likes, thumbnail, and date. About 10 to 20 YouTube quota units per creator. It never uses `search.list`.
3. The dashboard sends 10 videos per request to the Worker, 4 requests at a time. Each request is **one Jev call** that answers every question in `schema.json` for all 10 videos in parallel.
4. Answers below the confidence threshold are flagged for review.
5. The dashboard compares each hook's median views with the channel median (lift) and builds the Winning Formula.
6. The Hook Lab: Llama 3.1 8B drafts hooks, Jev scores them with the questions in `judge.json`.
7. Ask the Decoder: Jev routes each question, Llama 3.3 70B writes the answer from your decoded data only, and Jev fact-checks it with the questions in `chat.json`.

Google Cloud only supplies the YouTube API key. Cloudflare hosts the Worker, runs every model, and stores decodes in D1. The app reads public data only, so there is no YouTube login. It decodes titles and descriptions, not spoken scripts, because YouTube's captions API requires the video owner's login.

## After a decode
- **Gallery:** filter by hook, Needs review, or Outperformers, sort by views or date, click any video to see every Jev answer.
- **Usage vs lift:** click a hook row to filter the gallery to it.
- **Hooks:** Copy or Shortlist any scored hook.
- **Copy client brief:** Winning Formula, top videos with links, and your shortlisted hooks, ready to paste.
- **Download CSV:** every video with its Jev labels, confidence, views, and lift.
- **Demo mode:** add `?demo` to the URL to try the dashboard with sample data and no API calls.

## The files you edit
| File | What it controls |
|---|---|
| `schema.json` | The questions Jev asks about every video |
| `judge.json` | How Jev scores new hooks in the Hook Lab |
| `chat.json` | How Jev routes questions and fact-checks answers in Ask the Decoder |

Question types: `choice` picks one option and returns confidence, `noul` returns a yes/no probability, `score` places the answer on an ordered scale. After editing `schema.json`, use **Re-run Jev** on the dashboard. It re-decodes the saved creator without new YouTube calls.

## Pages
- `/` the dashboard
- `/race.html` Model Race: Jev vs Llama 3.1 8B on the same 10 videos, live

## Models
| Job | Model |
|---|---|
| Decoding, Hook Lab scoring, question routing, fact-checking | Jev (`typesafe/jev`) |
| Draft 5, Model Race | `@cf/meta/llama-3.1-8b-instruct-fp8-fast` |
| Ask the Decoder answers | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` |

All three run on Workers AI and share the free 10,000 Neurons per day.

## Costs
- Jev: $0.042 per 1M input tokens, output free. A 200-video decode costs well under $0.01.
- Workers, D1, and Workers AI: free plan limits. Going over a limit returns errors until the daily reset, it never bills you.
- YouTube Data API: 10,000 free quota units per day.

## Troubleshooting
| Problem | Fix |
|---|---|
| `npm install` fails on `sharp` (Linux with a system libvips, like Arch) | `SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm install` |
| `You need to register a workers.dev subdomain` | Open the link in the error, pick a free subdomain, run `npm run dev` again. Do not press `l` for local mode: Workers AI has no local version. |
| Wrong passcode | Match it to `DASHBOARD_PASSCODE` in `.dev.vars` (locally) or the secret you shipped. |
| Jev access or billing error | Confirm your account can call `typesafe/jev` on Workers AI. |
| `quotaExceeded` from YouTube | The quota resets at midnight Pacific time. |
| `No public channel found` | Include the `@` and check the channel is public. |
| `No Shorts found` | The creator may post long-form only. Try another handle. |
| Many videos flagged for review | Tighten the criteria in `schema.json`, then Re-run Jev. |

## Credits
Jev by TypeSafe AI. Runs on Cloudflare Workers AI. Video data from the YouTube Data API.
