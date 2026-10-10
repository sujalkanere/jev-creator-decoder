# NextWork Project Prompt: Jev Content Decoder

Paste everything below the line into the NextWork project generator.

---

Generate a detailed, beginner-friendly NextWork project from this brief. Use every fact, command, file name, and button label exactly as written. The project has **Steps 1 to 4 plus one Secret Mission**, nothing more. For every file the learner edits, include an "I'd like to check the full code" section showing that file's full contents from the repository.

## Repository and links
- Repository: https://github.com/Nik-1019/Jev-Creator-Decoder-NextWork (branch `main`, the finished project)

## Overview
**Title:** Jev Content Decoder
**Persona:** You are the AI content strategist at a creator-led agency. Every client asks what actually works for creators in their niche, and answering it means hours of scrolling. You are going to run an internal tool that answers it in about a minute, powered by a brand-new decision model called Jev.
**What you will build:** the NextWork Content Decoder, a dashboard you run on your own Cloudflare account. Enter any YouTube creator, and Jev labels every recent Short by hook type, structure, call to action, and hook strength from its title, in seconds. Then the app transcribes what the creator actually says in their 10 most-viewed and 10 latest Shorts, and Jev re-analyzes those spoken openings to check whether the creator's current hooks still match what worked. The dashboard shows which hooks actually drive views, runs this Top vs Latest hook strategy check, scores new hook ideas before you film, opens a creator snapshot, and answers questions about the results.
**Difficulty:** Intermediate
**Time:** about 65 minutes, plus about 20 for the Secret Mission
**Cost:** $5, one time. TypeSafe asks you to add $5 of credit before you can create an API key, and your Jev usage comes out of that credit (a 200-video decode costs well under $0.01). Cloudflare and YouTube are free with no credit card.
**Star of the project:** Jev. Every step should make Jev's speed, low cost, and decision quality visible, and point to the on-screen number that proves each claim.

## Verified facts (use exactly)
**Jev**
- Jev is TypeSafe AI's first System One model, launched September 15, 2026. It does not write text. You send it a `state` (the data) and typed questions, and it returns typed answers with probabilities and confidence.
- Question types: `choice` picks one option and returns `choice`, `confidence`, and `probabilities`. `noul` returns a yes/no probability. `score` places the answer on an ordered scale.
- All questions in one call are answered in parallel, so adding questions barely changes the time a call takes. Typical call time is 70 to 500 ms.
- Price: $0.042 per 1 million input tokens. Output is free.
- On Cloudflare Workers AI the model id is `typesafe/jev`, called as `env.AI.run('typesafe/jev', { state, questions })`.
- In this app, Jev runs on TypeSafe's own API (`https://api.typesafe.ai/v1/systemone`) with the learner's TypeSafe API key, and Workers AI is the fallback. On Workers AI, Jev is paid from AI Gateway credits, not the free daily Neurons, so a new Cloudflare account calling it there gets `Insufficient AI Gateway credits`. That is why the TypeSafe key is required.

**How this app uses Jev**
- One Jev call decodes 10 videos. Every question in `schema.json` is repeated once per video, and the dashboard runs 4 calls at a time.
- `schema.json` ships with 4 questions per video (hook, structure, cta, strength), so one call asks 40 questions. After the learner adds 2 questions in Step 3, one call asks 60.
- A 200-video decode costs well under $0.01 of Jev usage.
- The app works in two phases. First, Jev decodes all recent Shorts (up to 200) from their titles and descriptions, in seconds. Then the hook strategy check transcribes the Top 10 most-viewed and the 10 latest Shorts, and Jev re-decodes them from what is actually said: `opening` (the first ~45 seconds) plus the full `transcript`.
- For Shorts with a transcript, Jev uses the instructions in `schema.json` `per_video_spoken` instead of `per_video`. Same keys and criteria, so the dashboard reads the answers the same way. A question with no `per_video_spoken` version uses its `per_video` instructions.
- Jev then compares the two groups with the questions in `compare.json`. Latest Shorts are judged on hook patterns, not views, because new videos have not built up views yet.
- Jev makes every decision. Transcription only turns speech into text.

**Other models (all on Cloudflare Workers AI)**
- `@cf/meta/llama-3.1-8b-instruct-fp8-fast`: drafts hooks (Draft 5) and is the opponent in the Model Race.
- `@cf/meta/llama-3.3-70b-instruct-fp8-fast`: writes answers in Ask the Decoder (Secret Mission).
- `@cf/openai/whisper-large-v3-turbo`: turns each Short's audio into text for the hook strategy check. It makes no decisions.

**Transcripts**
- uv runs yt-dlp automatically (`uvx yt-dlp`), so learners install only uv. `npm run dev` starts a small local transcript helper next to the app. It downloads each Short's audio with yt-dlp, one at a time, and deletes the audio file as soon as it is read. Only the transcript text is saved.
- Transcripts are cached per video, so re-runs never transcribe the same Short twice. Cached transcripts are free.
- The transcript phase takes about 2 minutes for 20 Shorts. The fast decode always appears first.
- Transcripts only work when running locally. The deployed app cannot reach the helper on the learner's computer, so it shows "No transcript".

**Free tiers and credit**
- TypeSafe: add $5 of credit in your TypeSafe account before you can create an API key. Jev usage is deducted from that credit at $0.042 per 1 million input tokens.
- Cloudflare Workers Free plan: no card. Workers AI includes 10,000 Neurons per day, shared by the Llama models and transcription. Cached transcripts are free. Going over a free limit returns errors until the daily reset at 00:00 UTC. It never bills you.
- YouTube Data API v3: free key, 10,000 quota units per day. The app uses `channels.list`, `playlistItems.list`, and `videos.list` at 1 unit each, about 10 to 20 units per creator. It never uses `search.list`.

**Which videos get decoded**
- Shorts only. The app scans the creator's latest uploads and keeps up to 200 videos that are 3 minutes or shorter. YouTube's API has no official "is a Short" flag, so the app filters by length before Jev sees anything. Jev does not decide what counts as a Short.
- The fast decode reads titles and descriptions. The hook strategy check then transcribes what is actually said in the Top 10 and Latest 10 Shorts, and Jev re-decodes and compares them. YouTube's captions API can't be used for other creators' videos because it needs the video owner's login, which is why the app transcribes the audio itself.

**Accounts and roles**
- Google Cloud is only used to create the YouTube API key. TypeSafe runs Jev. Cloudflare hosts the app, runs the Llama models and transcription (and Jev as a fallback), and stores decodes and transcripts in a D1 database.
- The dashboard is protected by a password the learner creates in the browser. Only a salted hash is stored in their D1 database, sign-in uses a secure session cookie, and 10 wrong attempts lock sign-in for 15 minutes. On the deployed app, the password can only be created through a one-time setup link printed by `npm run ship`, so a stranger who finds the URL can never claim it.

## What the learner needs before starting
- A computer with a terminal (macOS, Linux, or Windows with PowerShell or WSL)
- Node.js 22 or newer (nodejs.org) and Git (git-scm.com)
- A code editor such as VS Code
- uv, which runs yt-dlp automatically, so there is nothing else to install. You install it in Step 1.
- A Google account, an email for a free Cloudflare account, and a TypeSafe account with $5 of credit

## Step 1: Set up and meet Jev (~15 min)
**Goal:** get the Content Decoder running on your computer and understand how Jev thinks.

1. **Check your tools.** Run `node --version` (needs 22 or newer) and `git --version`. If either is missing, install it, then continue.
2. **Install uv.** Explain why first: the app transcribes what creators say in their Shorts, and uv is the tool that downloads that audio for you. Concept tag: uv: a tool that installs and runs other tools on demand, so you don't set them up yourself. uv runs yt-dlp automatically, so there is nothing else to install.
   - macOS/Linux:
     ```bash
     curl -LsSf https://astral.sh/uv/install.sh | sh
     ```
   - Windows:
     ```powershell
     powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
     ```
   Open a new terminal afterwards, so it can find uv.
3. **Get a YouTube API key.** In Google Cloud Console: create a project, go to APIs & Services, enable **YouTube Data API v3**, then Credentials, Create credentials, API key. Restrict the key to YouTube Data API v3. Copy it somewhere safe.
4. **Get a TypeSafe API key.** Sign in to your TypeSafe account and add $5 of credit; TypeSafe won't let you create an API key until you do. Then create an API key and copy it somewhere safe. Explain why: Jev runs on TypeSafe's API with this key, and every decode is paid from this credit (well under $0.01 for 200 videos).
5. **Create a free Cloudflare account** at dash.cloudflare.com. You don't need to change any settings there; setup handles the rest.
6. **Clone the repository:**
   ```bash
   git clone https://github.com/Nik-1019/Jev-Creator-Decoder-NextWork.git
   cd Jev-Creator-Decoder-NextWork
   ```
7. **Install the packages:**
   ```bash
   npm install
   ```
   If this fails with `sharp: Attempting to build from source` (it happens when your computer already has the `vips` image library, for example from Homebrew on macOS or a Linux package), run `SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm install` instead. On Windows PowerShell: `$env:SHARP_IGNORE_GLOBAL_LIBVIPS=1; npm install`.
8. **Log in to Cloudflare from the terminal:**
   ```bash
   npx wrangler login
   ```
   A browser tab opens. Click Allow. When the terminal says you're logged in, continue.
9. **Run setup:**
   ```bash
   npm run setup
   ```
   Setup creates your D1 database, connects it, and checks that your Cloudflare account has a **workers.dev subdomain** (like `yourname.workers.dev`). If it doesn't, setup suggests one: press Enter to accept or type your own. Explain why: Workers AI has no local version, so even on your computer the Llama models (and Jev's fallback) run on Cloudflare, and the dev server reaches them through a temporary Worker on that subdomain. Setup then creates the database tables (answer **Y** when asked) and asks you to paste your YouTube API key, then your TypeSafe API key. It saves both keys to `.env`, a file that stays on your computer and is never committed (it's listed in `.gitignore`). Finally, setup checks for uv. If uv is missing, it prints the install command for your system. If uv is there, it fetches yt-dlp once, so your first transcripts start quickly.
10. **Start the app:**
   ```bash
   npm run dev
   ```
   Explain why one command is enough: `npm run dev` starts the app and the transcript helper together, in this one terminal. The helper is a small program on your computer that downloads each Short's audio for transcription. When you see `Ready on http://localhost:8787`, press `b` to open it in your browser.
   Don't run `npx wrangler dev` instead. It starts the app without the transcript helper, so every Short would show "No transcript".
11. **Create your dashboard password.** Enter a new password (at least 8 characters) and confirm it. Explain how it is stored: only a salted hash, never the password itself.
12. **Tour the Jev code.** Open `src/jev.ts` in your editor. Walk through `buildVideoQuestions`: it takes each question in `schema.json` and repeats it once per video, with keys like `v3_hook`, so one call can decide 10 videos. Then `classifyBatch` sends one call and splits the answers back per video.
13. **Predict:** how many questions will one Jev call ask? (10 videos x 4 questions = 40.) You'll check your answer in Step 2.

📸 Screenshot: the welcome screen of your running Content Decoder.

**What you should see:** the dashboard with a welcome card that explains how to find a creator.

## Step 2: Decode your first creator (~20 min)
**Goal:** see Jev's speed, cost, and judgment on a real creator.

1. **Pick a creator** that posts Shorts. Open their channel on YouTube, copy the link from the address bar (or the @name under their channel name), paste it into the input at the top, and click **Decode**. A link to any of their videos works too.
2. **Watch it run.** Thumbnails stream through the Jev lens and get labeled from their titles and descriptions. In **Every Jev call**, four lanes fill with bars, and each bar is one call deciding 10 videos. The **Call log** lists every call.
3. **Check your prediction:** the Every Jev call header shows questions per call (40).
4. **Record the numbers** from the summary strip: run time, videos per second, and Jev spend. Note how long 200 videos took and what it cost.
5. **Understand what happens next.** A title only tells you what a creator wrote, not what they say in the first seconds of the video, and that spoken opening is the real hook. So after the fast decode, the app transcribes the Top 10 most-viewed and the 10 latest Shorts. Concept tag: transcript: the text of everything said in a video, with a time for each line. Jev then re-analyzes their actual spoken openings, the first ~45 seconds, to check whether the creator's current hooks still match what worked. Jev makes every decision. The transcription only turns speech into text.
6. **Watch the Hook strategy check.** Scroll to the **Hook strategy check** panel, below the three main cards. The fast decode appears first, then the panel shows **Transcribing 7 of 20** as it works through the Shorts. This takes about 2 minutes for 20 Shorts. When it finishes, read the verdict and its sample size, then compare **Top 10** and **Latest 10** side by side. Latest Shorts are judged on how they open, not on views, because new videos have not built up views yet. Treat the verdict as a signal, not a fixed score: labels can shift slightly between runs. 📸 Screenshot: the Hook strategy check panel with the verdict and both groups.
7. **Know the fallback states.** Some Shorts can't be transcribed. Jev still decodes them from their titles, and the panel tells you which ones. Present these as 3 tabs:
   - **No transcript:** the download failed, transcription failed, or the helper isn't running. Jev keeps the title-based result. Hover the chip to see why.
   - **No clear speech:** music or near-silence. Jev keeps the title-based result.
   - **Partial runs:** you still get a verdict, and it says how many Shorts are missing.
8. **Read a transcript.** In the Hook strategy check, click a Short. The side panel opens with a **Transcript** section: a status chip, the opening highlighted, and a **Watch from the hook** link that starts the video at its first spoken line. Compare the highlighted opening with Jev's hook label underneath. 📸 Screenshot: the Transcript section in the side panel.
9. **Adjust the check (optional).** In **Settings**, under **Defaults**, **Hook strategy groups** lets you choose 10 + 10 (the default) or 5 + 5. Explain why you might: 5 + 5 finishes faster and uses less of Cloudflare's free daily allowance. Transcription shares that allowance with the app's other AI features. Cached transcripts are free, and if the limit runs out, the panel says so and everything works again after 00:00 UTC. **Clear cached transcripts** on the panel removes this creator's transcripts so you can fetch them again. 📸 Screenshot: Settings with Hook strategy groups.
10. **Watch it slowly.** Click **Replay slowly** under the summary strip. Jev decodes the creator again at a pace you can follow, and the timings shown are still real. 📸 Screen record it.
11. **Check Jev's judgment.** Click **Review them** in the summary strip. The drawer opens on videos where Jev was unsure. Read the probability bars and decide whether Jev was right to be unsure. Drag the **Flag below** slider and watch the Needs review count change.
12. **Read the insight.** In the summary strip: Top hook, Best combo, and Blind spot. In **Find what outperforms**, compare Usage and Lift for each hook. Which hook does the creator use most? Which one actually performs best? Click a hook row to filter the gallery to it.
13. **Use the sidebar.** The creator now appears under **Creators**. Use **Jump to** to move between panels: each click scrolls to that panel and highlights it.
14. **Make the deliverable.** Click **View creator snapshot**. It opens in the side panel with the Winning Formula, top videos, and hooks to film next. This is what you would send a client.

**What you should see:** a gallery of labeled Shorts, the Winning Formula in the summary strip, a Hook strategy check verdict comparing Top 10 and Latest 10, and a creator snapshot in the side panel.

## Step 3: Design Jev's questions (~15 min)
**Goal:** learn the core skill, which is writing questions a decision model can answer cleanly.

1. **Open `schema.json`.** Read the 4 existing questions and notice their shape: `type`, `instructions` (with `{v}` standing for the video), and `criteria`. Keep the existing `hook` option keys unchanged, because the dashboard colors depend on them. Below them, `per_video_spoken` holds a spoken version of the same 4 questions. Jev uses those instructions when a Short has a transcript, so it reads `{v}.opening` (the first ~45 seconds) and `{v}.transcript` instead of only the title.
2. **Write two new questions** inside `per_video`:
   - a `choice` with your own criteria, for example `topic` with 4 or 5 topics this creator covers
   - a `noul`, for example `promises_number`: "Does the title in `{v}.title` promise a specific number?"
   Then add a spoken version of each new question in `per_video_spoken`, with the same key. Explain why: it is used when a Short has a transcript, so your question checks what the creator actually says, not just the title. For example:
   - `topic`: "What primary topic does the video cover, based on what is said in `{v}.transcript`?"
   - `promises_number`: "Does the spoken opening `{v}.opening` or the title `{v}.title` promise a specific number?"
3. **Save, then click Re-run Jev.** Questions per call go from 40 to 60, and the call bars stay about the same length. That's parallel questions: more decisions, same speed. The Hook strategy check runs again too, from cached transcripts, so nothing is transcribed twice.
4. **Inspect the answers.** Click a video in the gallery. Your new questions appear in the drawer with their probabilities.
5. **Fix weak questions.** If one of your questions shows low confidence on many videos, rewrite its criteria to be clearer and more distinct, then Re-run Jev.
6. **Open `judge.json`.** This file controls how Jev scores new hooks. Rewrite the `fit` and `lift_odds` instructions in your own words.
7. **Score hooks.** In **Score new hooks**, type a hook idea. Jev scores it within a second. Click **Add to list**. Then click **Draft 5**: Llama 3.1 8B writes 5 hooks, and Jev scores all 5 in one call. The best hook gets the **Film this next** ribbon.
8. **Shortlist** the hooks worth filming. They appear in the sidebar **Shortlist** and are saved to your database. Click **View creator snapshot** again: your shortlist is now included.

**What you should see:** 60 questions per call, your new answers in the drawer, and a ranked, shortlisted list of hooks.

## Step 4: Race it and ship it (~12 min)
**Goal:** prove Jev was the right model for this job, then deploy your tool.

1. **Open Model Race** from the sidebar. Pick the creator you decoded and click **Start**.
2. **Watch both lanes.** Jev classifies 10 videos in one call. The chat model makes 10 separate calls, and unusable answers flash red.
3. **Read the verdict** and explain in your own words why typed answers beat chat output for this job. Only cite numbers from your own run. Do not claim Jev is better than chat models in general. A chat model could batch too, and this race shows the common way people call one.
4. **Deploy:**
   ```bash
   npm run ship
   ```
   This creates the tables in your cloud database, deploys the app, uploads your YouTube and TypeSafe keys, and prints your app URL plus a **one-time setup link**.
5. **Open the setup link** and create the password for your deployed app. Keep the link private. Anyone else who opens your app URL only sees a sign-in screen.
6. **Decode a creator** on your live app, then click them under **Creators** in the sidebar to reload them instantly with 0 Jev calls. Your deployed app has its own database, separate from your local one. Transcripts only work when running locally, so the Hook strategy check on your deployed app shows "No transcript" and keeps the title-based results.

📸 Screenshot: the race verdict, and your deployed dashboard with its URL visible.

**What you should see:** a live Content Decoder on your own URL that you can reuse on any creator.

## Secret Mission: Ask the Decoder (~20 min)
**Goal:** add a chat that answers questions about your decoded creator, with Jev deciding what gets answered and checking every answer.

1. **Open Ask the Decoder** with the button in the bottom right. The panel can be resized from its corner.
2. **Learn the flow:**
   - Jev **routes** the question using `chat.json` `router`: what kind of question it is (`topic`, a `choice`) and whether the decoded data can answer it (`answerable`, a `noul`).
   - Off-topic or unanswerable questions are blocked instantly, with no chat model call.
   - Answerable questions go to Llama 3.3 70B, which only sees a factual summary of your decode.
   - Jev **checks** the answer using `chat.json` `check`: `grounded` (does every number appear in the data?) and `actionable` (how clear is the next step?). The answer shows **Grounded** or **Check this**, plus a small chart built from your real numbers.
3. **Try it:** click all three starter questions, including the off-topic test, then ask your own.
4. **Try to trick it:** ask for a number that isn't in the data and watch what the check says.
5. **Make it yours:** in `chat.json`, add a new option to the router's `topic` criteria (for example `posting_frequency`) and tighten the `grounded` instructions. Save and ask again.
6. **Lesson:** decide before you spend, block what the data can't answer, check the writer's work, and use the smallest model that does the job.

## Troubleshooting (include as a section)
- `npm install` fails with `sharp: Attempting to build from source` (macOS with Homebrew `vips`, or Linux with a system libvips): run `SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm install`. Windows PowerShell: `$env:SHARP_IGNORE_GLOBAL_LIBVIPS=1; npm install`.
- `You need to register a workers.dev subdomain`: run `npm run setup` again; it registers one for you. Do not press `l` for local mode: Jev only runs remotely, so every AI feature would fail with `Binding AI needs to be run remotely`.
- `Insufficient AI Gateway credits` or `Jev unavailable: TypeSafe API (401 ...)`: your TypeSafe key is missing or wrong, so Jev fell back to Workers AI, which needs paid credits. Check `TYPESAFE_API_KEY` in `.env` (or run `npm run setup` again), confirm your TypeSafe account has credit, then restart `npm run dev`.
- Keys in `.env` seem ignored (`npm run dev` prints `Using secrets defined in .dev.vars`): an old `.dev.vars` file wins over `.env`. Run `npm run setup`; it moves your keys into `.env`.
- `wrangler: command not found`: run `npm install` first.
- Forgot your password: run `npm run reset-password`, choose local or deployed, then create a new one.
- The deployed app says it isn't set up yet: open the one-time setup link that `npm run ship` printed.
- `quotaExceeded` from YouTube: the daily quota resets at midnight Pacific time.
- `No Shorts found`: the creator may only post long videos. Try another creator.
- Many videos flagged for review: make your criteria clearer, then Re-run Jev.
- Your deployed app has no saved creators: the deployed app uses its own cloud database, separate from your local one.
- Hook strategy check says the transcript helper isn't running: start the app with `npm run dev`, not `npx wrangler dev`, and make sure nothing else is using port 8790.
- Hook strategy check says uv isn't installed: install uv with the command for your system from Step 1, open a new terminal, then run `npm run dev` again.
- Shorts show "No transcript" with "YouTube rate limit" when you hover the chip: YouTube is limiting downloads from your network. Wait a while, then open the creator again. Only the missing Shorts are fetched.
- Panel says Workers AI's free daily limit is used up: transcription and the app's other AI features share Cloudflare's free daily allowance. Everything works again after 00:00 UTC. Cached transcripts are free.

## Style
- Second person. The learner IS the professional. No invented character names.
- Short, plain sentences. No em dashes.
- Use 📸 for screenshots. End every step with what the learner should now see.
- Keep Jev the hero: whenever something fast, cheap, or confident happens, point to the number on screen.
