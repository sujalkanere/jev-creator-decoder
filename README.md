# NextWork Content Decoder

Decode any YouTube creator's Shorts with **Jev**, TypeSafe AI's System One model. Type a handle, watch Jev label every video live, find which hooks actually drive views, score new hooks before you film, and ask questions about the results.

Runs on Cloudflare's free tier, plus $5 of TypeSafe credit for Jev. Built for a NextWork project.

## What you need
- Node.js 22 or newer
- A free Cloudflare account
- A free YouTube Data API v3 key from Google Cloud
- A TypeSafe API key. TypeSafe asks you to add $5 of credit before you can create one.
- **uv** (for the hook strategy check's transcripts). macOS/Linux: `curl -LsSf https://astral.sh/uv/install.sh | sh`. Windows: `powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"`. Other options: [uv installation](https://docs.astral.sh/uv/getting-started/installation/). uv runs **yt-dlp** for you (`uvx yt-dlp`), so there's nothing else to install. Without uv the app still works; Shorts just show "No transcript".

## Setup
```bash
npm install
npm run setup      # logs you in, creates the database, registers your workers.dev subdomain, asks for your YouTube and TypeSafe keys, checks uv
```
Jev runs on TypeSafe's API with your TypeSafe key. The Llama models (and Jev's fallback) run on Workers AI, which has no local version, so `npm run dev` runs your Worker and database on your machine but sends those calls to Cloudflare. That connection runs through your workers.dev subdomain, which is why setup registers one.
Then:
```bash
npm run dev        # open http://localhost:8787
```
`npm run dev` starts two things in one terminal: your Worker (wrangler) and the **transcript helper** on `http://127.0.0.1:8790`, a small local server that downloads Shorts audio with yt-dlp for the hook strategy check. It also applies any new database tables. Ctrl+C stops both.
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
8. Hook strategy check (after the fast decode, see below): Jev reads what is actually said in the top and latest Shorts and compares them.

Google Cloud only supplies the YouTube API key. TypeSafe runs Jev. Cloudflare hosts the Worker, runs the Llama models and Whisper (and Jev as a fallback), and stores decodes and transcripts in D1. The app reads public data only, so there is no YouTube login.

## Hook strategy check
*Is this creator still using the hooks that made their top videos work?*
1. The fast decode runs first, from titles and descriptions, exactly as before.
2. The app picks the **Top 10 by views** and the **10 latest** Shorts (no overlap; 5 + 5 in Settings).
3. The transcript helper downloads each Short's audio with yt-dlp, one at a time, 3 seconds apart, with one retry after 30 seconds on HTTP 403/429. Each audio file is deleted as soon as it's read; only text is kept.
4. Workers AI **Whisper** (`@cf/openai/whisper-large-v3-turbo`) turns the audio into text with timestamps, up to 4 at a time. Whisper only transcribes.
5. **Jev** re-decodes those Shorts from what is said: `opening` (the first ~45 seconds) plus the full `transcript`, with the `per_video_spoken` instructions in `schema.json`. Their labels upgrade on screen.
6. **Jev** compares the groups with the questions in `compare.json`: does each latest opening grab attention the way the top openings do? Latest Shorts are judged on hook patterns, not views.
7. The verdict shows the sample size, for example "Based on 10 top and 8 recent Shorts with transcripts (2 missing)".

Transcripts are cached per video, so re-runs never transcribe the same Short twice. **Clear cached transcripts** on the panel removes them for that creator.

| Status | Meaning |
|---|---|
| Transcribed | Jev read the spoken opening and transcript |
| No clear speech | Under ~1 word per second (music or near-silence). Jev keeps the title-based result |
| No transcript | The audio download failed (for example a YouTube rate limit), transcription failed, or the helper isn't running. Jev keeps the title-based result |

Transcripts only work in `npm run dev`: the deployed app can't reach the helper on your machine, so it shows "No transcript".

## The sidebar
- **Creators:** everyone you've decoded, with their avatar. Click to reload instantly with 0 Jev calls, or remove them.
- **Shortlist:** the hooks you saved for the current creator. Click to copy.
- **Jump to:** scrolls to a panel and highlights it.
- **Model Race, Settings, Theme, Sign out.**

## Settings
Open **Settings** in the sidebar (or the link on the Model Race page).
- **API keys:** YouTube, TypeSafe, Anthropic, OpenAI, OpenRouter. Saved encrypted in your D1 database with `SETTINGS_SECRET` and never shown again, only the last 4 characters. A key saved here wins over `.env`; **Remove** falls back to `.env`.
- **Ask the Decoder model:** Llama 3.3 70B (free) by default, or Claude, OpenAI, or OpenRouter once its key is set. Jev still routes and fact-checks every answer. If you remove that key, chat falls back to Llama.
- **Model Race models:** which model each provider races with (same as the `*_MODEL` lines in `.env`).
- **Defaults:** the needs-review threshold and how many hooks each Draft writes (3 to 10).
- **Password** change (signs out other devices) and **Data:** clear all shortlists or forget all saved creators.

`npm run setup` and `npm run ship` create `SETTINGS_SECRET` in `.env` once and reuse it. Don't change it: keys already saved in Settings would become unreadable (Settings tells you to paste them again).

## After a decode
- **Gallery:** filter by hook, Needs review, or Outperformers, sort by views or date, click any video to see every Jev answer.
- **Usage vs lift:** click a hook row to filter the gallery to it.
- **Hooks:** Copy or Shortlist any scored hook.
- **Your hooks:** **View list** on the Score new hooks card (or **Your hooks** in the sidebar) shows every hook you added or drafted, ranked by score, with an All / Shortlisted filter. **Add to list** opens it with the new hook highlighted. Shortlisted hooks are saved per creator; the rest clear on reload.
- **View creator snapshot:** opens a card in the side panel with the Winning Formula, top videos with links, and your shortlisted hooks. **Copy as text** inside it gives you a paste-ready version.
- **Download CSV:** every video with its Jev labels, confidence, views, and lift.

## The files you edit
| File | What it controls |
|---|---|
| `schema.json` | The questions Jev asks about every video |
| `judge.json` | How Jev scores new hooks in the Hook Lab |
| `chat.json` | How Jev routes questions and fact-checks answers in Ask the Decoder |
| `compare.json` | How Jev compares the top and latest openings in the hook strategy check |

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
| Hook strategy check transcripts (speech to text only) | `@cf/openai/whisper-large-v3-turbo` |

The Llama models and Whisper run on Workers AI and share the free 10,000 Neurons per day. Whisper costs 46.63 Neurons per audio minute: about 300 to 1,100 Neurons for one creator's 20 Shorts, so a few new creators a day fit comfortably (cached transcripts cost nothing). When the daily Neurons run out, Workers AI calls fail until 00:00 UTC and the dashboard says so. Jev on Workers AI is paid from AI Gateway credits instead, which is why the app calls it on TypeSafe's API with your key.

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
| Hook strategy check says the transcript helper isn't running | Start the app with `npm run dev` (not `npx wrangler dev`), and make sure nothing else uses port 8790. |
| Hook strategy check says uv isn't installed | Install uv (see What you need), open a new terminal, then `npm run dev` again. |
| Shorts show "No transcript" with "YouTube rate limit" | YouTube is limiting downloads from your network. Wait a while and use **Clear cached transcripts**, or just re-open the creator later: only missing Shorts are fetched. |
| "Workers AI's free daily limit is used up" | The free 10,000 Neurons a day are spent. Everything on Workers AI works again after 00:00 UTC. |

## Credits
Jev by TypeSafe AI. Runs on Cloudflare Workers AI. Video data from the YouTube Data API.
