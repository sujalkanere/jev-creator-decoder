import type { AdapterResult, VideoRecord } from "./adapter";

const API = "https://www.googleapis.com/youtube/v3";
const MAX_SHORTS = 200;      // cap for the lab
const MAX_PAGES = 8;         // scan up to 400 recent uploads to find Shorts
const SHORT_MAX_S = 180;     // no official "is Short" flag, so filter by duration

// Quota: channels.list, playlistItems.list and videos.list cost 1 unit each.
// Never use search.list (100 units).
async function yt(path: string, params: Record<string, string>, key: string) {
  const qs = new URLSearchParams({ ...params, key });
  const res = await fetch(`${API}/${path}?${qs}`);
  const body: any = await res.json();
  if (!res.ok) {
    const reason = body?.error?.errors?.[0]?.reason || body?.error?.message || res.statusText;
    throw new Error(`YouTube API ${path} failed: ${reason}`);
  }
  return body;
}

function isoToSeconds(iso: string): number {
  const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || "");
  if (!m) return 0;
  const [, d, h, mi, s] = m.map((x) => Number(x || 0));
  return d * 86400 + h * 3600 + mi * 60 + s;
}

export async function fetchShorts(handleInput: string, key: string): Promise<AdapterResult> {
  if (!key) throw new Error("YOUTUBE_API_KEY is not set");
  const handle = handleInput.trim().startsWith("@") ? handleInput.trim() : "@" + handleInput.trim();
  let units = 0;

  // 1. Handle -> channel + uploads playlist
  const ch = await yt("channels", { part: "snippet,contentDetails", forHandle: handle }, key);
  units++;
  const channel = ch.items?.[0];
  if (!channel) throw new Error(`No public channel found for ${handle}`);
  const uploads = channel.contentDetails.relatedPlaylists.uploads;

  // 2. Page through uploads, 50 at a time
  const ids: string[] = [];
  let pageToken = "";
  for (let p = 0; p < MAX_PAGES; p++) {
    const params: Record<string, string> = { part: "contentDetails", playlistId: uploads, maxResults: "50" };
    if (pageToken) params.pageToken = pageToken;
    const page = await yt("playlistItems", params, key);
    units++;
    for (const it of page.items || []) ids.push(it.contentDetails.videoId);
    pageToken = page.nextPageToken || "";
    if (!pageToken) break;
  }

  // 3. Details in batches of 50 IDs, keep Shorts only
  const records: VideoRecord[] = [];
  for (let i = 0; i < ids.length && records.length < MAX_SHORTS; i += 50) {
    const batch = ids.slice(i, i + 50);
    const vids = await yt("videos", { part: "snippet,statistics,contentDetails", id: batch.join(",") }, key);
    units++;
    for (const v of vids.items || []) {
      const duration = isoToSeconds(v.contentDetails?.duration);
      if (!duration || duration > SHORT_MAX_S) continue;
      const th = v.snippet.thumbnails || {};
      records.push({
        platform: "youtube",
        id: v.id,
        url: `https://www.youtube.com/shorts/${v.id}`,
        title: v.snippet.title || "",
        text: (v.snippet.description || "").slice(0, 300),
        views: Number(v.statistics?.viewCount || 0),
        likes: Number(v.statistics?.likeCount || 0),
        posted_at: v.snippet.publishedAt,
        thumbnail: (th.high || th.medium || th.default || {}).url || "",
        duration_s: duration,
      });
      if (records.length >= MAX_SHORTS) break;
    }
  }

  const th = channel.snippet.thumbnails || {};
  const avatar = (th.medium || th.default || {}).url || "";
  return { channel: { id: channel.id, title: channel.snippet.title, handle, avatar }, records, quota_units: units };
}
