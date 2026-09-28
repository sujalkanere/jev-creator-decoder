# NextWork Project Prompt: NextWork Content Decoder

Paste everything below the line into the NextWork project generator.

---

Generate a detailed NextWork project from this brief. Use every fact exactly as written. The project has **Steps 1 to 4 plus one Secret Mission**, nothing more. Show full code for any file the learner edits in an "I'd like to check the full code" section, using the repository below.

## Repository
- Starter repo: https://github.com/Nik-1019/Jev-Creator-Decoder-NextWork (branch `main`, the finished project)
- Design preview: https://nik-1019.github.io/Jev-Creator-Decoder-NextWork/

## Overview
**Title:** Decode Any YouTube Creator with Jev
**Persona:** You are the AI content strategist at a creator-led agency. Every client asks what actually works for creators in their niche. You are shipping an internal tool that answers it in about a minute, powered by a brand-new decision model called Jev.
**Difficulty:** Intermediate. **Time:** about 60 minutes, plus about 20 for the Secret Mission. **Cost:** free.
**Star of the project:** Jev. Every step should make Jev's speed, low cost, and decision quality visible. Point to the on-screen number that proves each claim.

## Verified facts
- Jev is TypeSafe AI's first System One model, launched September 15, 2026. It does not generate text. You send a `state` and typed questions and get typed answers with probabilities and confidence.
- Question types: `choice` (pick one, returns `choice`, `confidence`, `probabilities`), `noul` (yes/no probability), `score` (position on an ordered scale).
- All questions in one call are answered in parallel. Adding questions barely changes latency. Typical latency is 70 to 500 ms.
- Price: $0.042 per 1M input tokens, output free. On Cloudflare Workers AI the model id is `typesafe/jev`, called with `env.AI.run('typesafe/jev', { state, questions })`.
- The app batches 10 videos per Jev call, with every `schema.json` question repeated per video. `schema.json` ships with 4 questions (hook, structure, cta, strength), so one call asks 40 questions.
- Other models, both on Workers AI: `@cf/meta/llama-3.1-8b-instruct-fp8-fast` (Draft 5 and Model Race), `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (Ask the Decoder answers).
- Cloudflare Workers Free plan: no card. Workers AI includes 10,000 Neurons per day shared across all models. D1 free limits return errors when exceeded, they never bill.
- YouTube Data API v3: free key, 10,000 quota units per day. The app uses `channels.list` (forHandle), `playlistItems.list`, and `videos.list` at 1 unit each, about 10 to 20 units per creator. It never uses `search.list`. It decodes titles and descriptions, not spoken scripts, because the captions API needs the owner's login.
- Google Cloud is only used for the YouTube API key. Cloudflare hosts the Worker, runs every model, and stores decodes in D1.

## Step 1: Set up and meet Jev (~15 min)
- Create a free Cloudflare account and register a workers.dev subdomain. Explain that Jev runs remotely on Workers AI, so `wrangler dev` needs it.
- Create a Google Cloud project, enable YouTube Data API v3, create an API key restricted to that API.
- Clone the repo, run `npm install`, `npx wrangler login`, then `npm run setup`. Setup creates the database and asks for the YouTube key and a passcode. Linux learners with a system libvips: `SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm install`.
- If the workers.dev onboarding link shows a 404, open Workers & Pages and check Account details for the subdomain, or run `npx wrangler deploy` once and accept the subdomain prompt.
- Run `npm run dev` and open http://localhost:8787. Enter the passcode.
- Guided tour of `src/jev.ts`: how `buildVideoQuestions` repeats each `schema.json` question per video as `v{i}_{key}`, and how answers are split back per video.
- The learner predicts how many questions one call asks (10 videos x 4 questions = 40) and checks it in Step 2.
- 📸 Screenshot: the welcome screen.

## Step 2: Decode your first creator (~15 min)
- Enter a creator that posts Shorts: an @handle (shown under the channel name on YouTube), a channel link, or any video link. Click Decode.
- Watch the thumbnail wall pass through the Jev lens, the four call lanes fill, and the call log stream. Read the hero: run time, videos per second, Jev spend, projected cost at 10,000 videos.
- Turn on Watch mode and click Re-run Jev to replay at a followable pace. 📸 Screen record the decode.
- Drag the confidence slider. Open a flagged video (Winning Formula, Review them) and read its probability bars in the drawer. Decide if Jev was right to be unsure.
- Read the summary strip and the usage vs lift rows: which hook does the creator use most, and which one actually outperforms? Name the blind spot. Click a hook row to filter the gallery to it.
- Click Copy client brief and paste it somewhere. This is the deliverable.

## Step 3: Design Jev's questions (~15 min)
- In `schema.json`, write two new questions: a `choice` with the learner's own criteria (for example topic) and a `noul` (for example "Does the title promise a specific number?"). Keep the existing `hook` option keys, because the dashboard colors depend on them.
- Click Re-run Jev. Questions per call go from 40 to 60, and the lane bars show latency barely moves. Open a video in the drawer to see the new answers.
- If a new question comes back with low confidence, rewrite its criteria and run again.
- In `judge.json`, rewrite the `fit` and `lift_odds` questions in the learner's own words.
- Type hooks into Score new hooks and watch Jev score each one live, then Add to board. Click Draft 5 (Llama 3.1 8B drafts, Jev scores all 5 in one call). The best hook gets the Film this next ribbon. Shortlist the hooks worth filming, then copy the client brief again: the shortlist is now included.

## Step 4: Race it and ship it (~12 min)
- Click Model Race. Pick the decoded creator and click Start. Jev classifies 10 videos in one call while the chat model makes 10 calls, with unusable answers flashing red.
- The learner explains why typed answers beat chat output for this job. Only cite numbers from the learner's own run. Do not claim Jev is better than chat models in general. Note that a chat model could batch too, and this race shows the common way people call one.
- Run `npm run ship`. Open the workers.dev URL, enter the passcode, reload the creator from Library with zero Jev calls.
- 📸 Screenshot: the race verdict and the deployed dashboard.

## Secret Mission: Ask the Decoder (~20 min)
- Open Ask the Decoder from the button in the bottom right.
- Explain the flow: Jev routes the question with `chat.json` `router` (topic `choice`, answerable `noul`). Off-topic or unanswerable questions are blocked with no chat model call. Answerable questions go to Llama 3.3 70B with a factual summary of the decode. Jev then fact-checks the answer with `chat.json` `check` (grounded `noul`, actionable `score`) and shows Grounded or Check this, plus a See chart link.
- The learner asks the three starter questions and the off-topic one, then tries to trick it by asking for a number that is not in the data.
- The learner edits `chat.json`: adds a new topic option to the router and tightens the grounded question, then asks again.
- Lesson: decide before you spend, guard what the data cannot answer, check the writer's work, and use the smallest model that does the job.

## Troubleshooting (include)
- sharp install error on Linux: `SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm install`
- workers.dev subdomain error: register one from the link, do not switch to local mode
- Wrong passcode: match `DASHBOARD_PASSCODE`
- YouTube `quotaExceeded`: resets at midnight Pacific
- No Shorts found: try a creator who posts Shorts
- Many flagged videos: tighten criteria, then Re-run Jev

## Style
Second person. The learner IS the professional. No invented character names. Short, plain sentences. No em dashes. Use 📸 for screenshots. End each step with what the learner should now see.
