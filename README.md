# Reme Content Decoder

Decode any YouTube creator's Shorts with **Laya** (the open-source System 1 decision engine) or **Jev** (TypeSafe AI). Type a handle, watch the model label every video live, find which hooks actually drive views, score new hooks before you film, and ask questions about the results.

Runs on Cloudflare's free tier with **$0 token costs** using your local Laya engine (or optional TypeSafe credit for Jev). Built for the Reme project.

---

## What you need
- **Node.js 22 or newer**
- **A free Cloudflare account** (for Worker hosting and local D1 database)
- **A free YouTube Data API v3 key** from Google Cloud Console
- **Laya** installed locally (via `pip install "laya[serve]"`), which runs on `http://127.0.0.1:8000` with **$0 token cost**
- *(Optional)* A TypeSafe API key (only if you want to use proprietary Jev instead of open-source Laya)
- **uv** (for the hook strategy check's transcripts). macOS/Linux: `curl -LsSf https://astral.sh/uv/install.sh | sh`. Windows: `powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"`. uv runs **yt-dlp** for you (`uvx yt-dlp`), so there's nothing else to install. Without uv the app still works; Shorts just show "No transcript".

---

## Setup & Running

### 1. Install dependencies
```bash
npm install
```

### 2. Configure Environment (`.env`)
Make sure your `.env` contains your YouTube API key and Laya URL:
```env
YOUTUBE_API_KEY=your-youtube-api-key
LAYA_URL=http://127.0.0.1:8000/v1/systemone
```

### 3. Start the Laya Inference Engine (Terminal 1)
In one terminal, start your local Laya System 1 decision server:
```bash
npm run serve:laya
```
*(Runs `laya-serve` on `http://127.0.0.1:8000` with GPU acceleration enabled by default)*

> [!TIP]
> **Performance tips for Laya:**
> - **GPU (default):** `npm run serve:laya` auto-sets `LAYA_DEVICE=cuda` and loads only the `typed-decisions` model. Requires PyTorch with CUDA (see Troubleshooting).
> - **CPU fallback:** `npm run serve:laya:cpu` runs on CPU if you don't have an NVIDIA GPU.
> - **Instant Boot (<1s):** `$env:LAYA_PRELOAD="false"; npm run serve:laya` loads weights on first request instead of startup.

### 4. Verify Laya Wire Compatibility (Optional)
In another terminal, you can test the model anytime without launching the full dashboard:
```bash
npm run test:laya
```

### 5. Launch the Content Decoder Dashboard (Terminal 2)
```bash
npm run dev
```
`npm run dev` starts:
1. Your **Worker (wrangler)** and applies any local D1 migrations.
2. The **transcript helper** on `http://127.0.0.1:8790` (downloads Shorts audio with yt-dlp).

Open **`http://localhost:8787`** in your browser. The first time you open it, create your dashboard password.

---

## Deploy
```bash
npm run ship       # cloud database, deploy, then your YouTube keys
```
Ship prints your app URL and a **one-time setup link**. Open the setup link to create the password for your deployed app. Anyone else who opens the URL sees a sign-in screen, never a way to create one.

---

## Your password
- Only a salted PBKDF2 hash is stored, in your own D1 database. The password itself is never saved.
- Signing in sets a secure, HttpOnly session cookie. Choose "Keep me signed in" for 30 days, otherwise 12 hours.
- 10 wrong attempts lock sign-in for 15 minutes.
- Forgot it? `npm run reset-password`, then create a new one.

---

## How it works
1. **You enter a creator:** `@handle`, a channel link, or any video/Shorts link from that creator. A creator you decoded before loads instantly from your library with zero model calls.
2. **The YouTube adapter** pulls up to 200 Shorts (180 seconds or shorter) with title, description, views, likes, thumbnail, and date. Costs ~10 to 20 YouTube quota units per creator. It never uses `search.list`.
3. **The dashboard batches videos:** Sends 10 videos per request to the Worker. Each request is **one System 1 call** to Laya (or Jev) that answers every question in `schema.json` for all 10 videos in parallel in a single forward pass.
4. **Answers below the confidence threshold** are flagged for review.
5. **The dashboard calculates lift:** Compares each hook's median views with the channel median and builds the Winning Formula.
6. **The Hook Lab:** Llama 3.1 8B drafts hooks, Laya scores them with the questions in `judge.json`.
7. **Ask the Decoder:** Laya routes each question, Llama 3.3 70B writes the answer from your decoded data only, and Laya fact-checks it with the questions in `chat.json`.
8. **Hook strategy check:** Laya reads what is actually said in the top and latest Shorts and compares them.

---

## Hook strategy check
*Is this creator still using the hooks that made their top videos work?*
1. The fast decode runs first, from titles and descriptions.
2. The app picks the **Top 10 by views** and the **10 latest** Shorts (no overlap). **Settings → Hook strategy groups** offers 5, 10 (default), or 20 per group.
3. The transcript helper downloads each Short's audio with yt-dlp, one at a time, 3 seconds apart, with one retry after 30 seconds on HTTP 403/429. Each audio file is deleted as soon as it's read; only text is kept.
4. Workers AI **Whisper** (`@cf/openai/whisper-large-v3-turbo`) turns the audio into text with timestamps, up to 4 at a time. Whisper only transcribes.
5. **Laya** re-decodes those Shorts from what is said: `opening` (the first ~45 seconds) plus the full `transcript`, with the `per_video_spoken` instructions in `schema.json`.
6. **Laya** compares the groups with the questions in `compare.json`: does each latest opening grab attention the way the top openings do? Latest Shorts are judged on hook patterns, not views.
7. The verdict shows the sample size, for example *"Based on 10 top and 8 recent Shorts with transcripts (2 missing)"*.

Transcripts are cached per video in D1, so re-runs never transcribe the same Short twice.

---

## The sidebar
- **Creators:** everyone you've decoded, with their avatar. Click to reload instantly with 0 model calls, or remove them.
- **Shortlist:** the hooks you saved for the current creator. Click to copy.
- **Jump to:** scrolls to a panel and highlights it.
- **Model Race, Settings, Theme, Sign out.**

---

## Settings
Open **Settings** in the sidebar:
- **API keys:** YouTube, Laya URL, TypeSafe, Anthropic, OpenAI, OpenRouter. Saved encrypted in your D1 database with `SETTINGS_SECRET` and never shown again, only the last 4 characters. A key saved here wins over `.env`.
- **Ask the Decoder model:** Llama 3.3 70B (free) by default, or Claude, OpenAI, or OpenRouter once its key is set. Laya still routes and fact-checks every answer.
- **Model Race models:** which model each provider races with.
- **Defaults:** the needs-review threshold and how many hooks each Draft writes (3 to 10).
- **Password** change and **Data:** clear all shortlists or forget saved creators.

---

## The files you edit
| File | What it controls |
|---|---|
| `schema.json` | The questions Laya asks about every video |
| `judge.json` | How Laya scores new hooks in the Hook Lab |
| `chat.json` | How Laya routes questions and fact-checks answers in Ask the Decoder |
| `compare.json` | How Laya compares the top and latest openings in the hook strategy check |

Question types: `choice` picks one option and returns confidence, `noul` returns a calibrated yes/no probability, `score` places the answer on an ordered scale.

---

## Models & Architecture
| Job | Model | Hosting / Runtime | Cost |
|---|---|---|---|
| **Decoding, Scoring, Routing, Fact-Checking** | **Laya** (ModernBERT 421M System 1) | Local Python (`http://127.0.0.1:8000`) or hosted | **$0.00** (Free, Open-Source) |
| Fallback Decision Engine | Jev (`typesafe/jev`) | TypeSafe API / Cloudflare AI Gateway | $0.042 / 1M tokens |
| Draft 5, Model Race | `@cf/meta/llama-3.1-8b-instruct-fp8-fast` | Cloudflare Workers AI | Free tier (Neurons) |
| Ask the Decoder answers | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | Cloudflare Workers AI | Free tier (Neurons) |
| Spoken Transcripts | `@cf/openai/whisper-large-v3-turbo` | Cloudflare Workers AI | Free tier (Neurons) |

---

## Costs
- **Laya:** **$0.00**. Open-source, self-hosted on your machine or serverless GPU. Zero token charges.
- **Cloudflare Workers, D1, Workers AI:** Free tier limits (10,000 Neurons/day). Going over limits returns errors until the daily reset; it never bills you unexpectedly.
- **YouTube Data API:** 10,000 free quota units per day.

---

## Troubleshooting
| Problem | Fix |
|---|---|
| `Laya unavailable at http://127.0.0.1:8000` | Start the Laya inference server in another terminal: `npm run serve:laya`. |
| `Laya startup takes a long time` | Start with lazy loading: `$env:LAYA_PRELOAD="false"; npm run serve:laya` or load only the decision model: `$env:LAYA_MODELS="typed-decisions"; npm run serve:laya`. |
| Laya is very slow (running on CPU) | Check with `python -c "import torch; print(torch.cuda.is_available())"`. If it prints `False`, reinstall PyTorch with CUDA: `pip install torch --index-url https://download.pytorch.org/whl/cu128 --force-reinstall`. Then restart with `npm run serve:laya`. |
| `Expected "name" to be of type string, alphanumeric and lowercase` | Cloudflare Worker names must be strictly lowercase (e.g. `reme-content-decoder` in `wrangler.toml`). |
| `npm install` fails on sharp | Windows PowerShell: `$env:SHARP_IGNORE_GLOBAL_LIBVIPS=1; npm install`. |
| `You need to register a workers.dev subdomain` | Run `npm run setup` again to register one. |
| Keys in `.env` seem ignored | An old `.dev.vars` file wins over `.env`. Delete or rename `.dev.vars`. |
| Forgot your password | Run `npm run reset-password` to create a new one. |
| `quotaExceeded` from YouTube | The YouTube Data API quota resets at midnight Pacific time. |
| Hook strategy check says transcript helper isn't running | Start the app with `npm run dev` (not `npx wrangler dev`), and ensure port 8790 is free. |
| Hook strategy check says uv isn't installed | Install uv (see What you need), open a new terminal, and run `npm run dev` again. |

---

## Credits
- **Laya** by Convai Innovations & Nandakishor M (Open-Source ModernBERT System 1 Decision Engine).
- **Jev** by TypeSafe AI.
- Runs on **Cloudflare Workers**, **Workers AI**, and **Cloudflare D1**.
- Video metadata from the **YouTube Data API v3**.
