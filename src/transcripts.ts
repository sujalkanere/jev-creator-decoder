// Speech to text for the hook strategy check. The local helper (scripts/helper.mjs) downloads a Short's
// audio, the browser forwards it here, and Workers AI Whisper turns it into text with timestamps.
// Whisper only transcribes. Every judgment about the transcript is Jev's.
// Only the text is kept (D1 table "transcripts"); the audio is never stored.

export const WHISPER_MODEL = "@cf/openai/whisper-large-v3-turbo";
export const OPENING_S = 45;       // the hook: what is said in the first ~45 seconds
const MIN_WORDS_PER_S = 1;         // below this, treat the Short as music or near-silence

function toBase64(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// Workers AI fails every call once the free 10,000 Neurons a day are used up, until 00:00 UTC.
// The exact wording of that error isn't documented, so match on the words it is likely to contain.
export function isDailyLimit(err: any) {
  return /neuron|daily|free allocation|4006/i.test(String(err?.message || err));
}

export async function transcribe(env: any, audio: ArrayBuffer, durationS: number) {
  const res: any = await env.AI.run(WHISPER_MODEL, { audio: toBase64(audio) });
  const segs: [number, number, string][] = (res?.segments || []).map((s: any) => [
    Math.round(Number(s.start) * 10) / 10, Math.round(Number(s.end) * 10) / 10, String(s.text || "").trim(),
  ]);
  const text = segs.map((s) => s[2]).join(" ").replace(/\s+/g, " ").trim();
  const opening = segs.filter((s) => s[0] < OPENING_S).map((s) => s[2]).join(" ").replace(/\s+/g, " ").trim();
  const words = Number(res?.transcription_info?.word_count ?? res?.word_count ?? (text ? text.split(/\s+/).length : 0));
  const duration = durationS > 0 ? durationS : segs.length ? segs[segs.length - 1][1] : 0;
  // no_speech_prob came back 0.00 on every segment in testing, even for music, so words per second decides.
  const status = duration > 0 && words / duration < MIN_WORDS_PER_S ? "no_speech" : "ok";
  return { status, language: String(res?.transcription_info?.language || ""), text, opening, segments: segs, words, duration_s: duration };
}

const row = (r: any) => ({
  id: r.video_id, status: r.status, language: r.language, text: r.text, opening: r.opening,
  segments: JSON.parse(r.segments || "[]"), words: r.words, duration_s: r.duration_s,
});

export async function cachedTranscripts(env: any, handle: string) {
  const { results } = await env.DB.prepare("SELECT * FROM transcripts WHERE handle = ?").bind(handle).all();
  return (results || []).map(row);
}

export async function saveTranscript(env: any, handle: string, id: string, t: Awaited<ReturnType<typeof transcribe>>) {
  await env.DB.prepare(
    "INSERT INTO transcripts (video_id, handle, status, language, text, opening, segments, words, duration_s, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
    "ON CONFLICT(video_id) DO UPDATE SET handle = excluded.handle, status = excluded.status, language = excluded.language, text = excluded.text, " +
    "opening = excluded.opening, segments = excluded.segments, words = excluded.words, duration_s = excluded.duration_s, created_at = excluded.created_at"
  ).bind(id, handle, t.status, t.language, t.text, t.opening, JSON.stringify(t.segments), t.words, t.duration_s, new Date().toISOString()).run();
}

export async function clearTranscripts(env: any, handle: string) {
  await env.DB.prepare("DELETE FROM transcripts WHERE handle = ?").bind(handle).run();
}
