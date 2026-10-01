import type { AdapterResult, VideoRecord } from "./adapter";

const API = "https://www.googleapis.com/youtube/v3";
const MAX_SHORTS = 600;      // cap for the lab
// Each page of 50 uploads costs 2 calls (list + details), plus 1–2 to find the channel.
// 23 pages keeps a pull at 48 calls or fewer, under the Workers Free plan's 50 per request,
// and scans up to 1,150 recent uploads.
const MAX_PAGES = 23;
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

// Accepts @handle, handle, a channel link, or any video/Shorts link.
export function parseInput(raw: string): { handle?: string; channelId?: string; videoId?: string } {
  const t = (raw || "").trim();
  let m = t.match(/youtube\.com\/(@[\w.-]+)/i); if (m) return { handle: m[1] };
  m = t.match(/youtube\.com\/channel\/(UC[\w-]{20,})/i); if (m) return { channelId: m[1] };
  m = t.match(/(?:youtube\.com\/(?:shorts\/|watch\?v=|live\/)|youtu\.be\/)([\w-]{11})/i); if (m) return { videoId: m[1] };
  if (/^@?[\w.-]{3,}$/.test(t)) return { handle: t.startsWith("@") ? t : "@" + t };
  return {};
}

export async function fetchShorts(input: string, key: string): Promise<AdapterResult> {
  if (!key || /paste-your/i.test(key)) throw new Error("Add your YouTube API key to .env, then restart npm run dev.");
  const p = parseInput(input);
  if (!p.handle && !p.channelId && !p.videoId) throw new Error("Enter a handle like @creator, a channel link, or a video link.");
  let units = 0;

  // 1. Input -> channel + uploads playlist
  let channelId = p.channelId;
  if (p.videoId) {
    const v = await yt("videos", { part: "snippet", id: p.videoId }, key); units++;
    channelId = v.items?.[0]?.snippet?.channelId;
    if (!channelId) throw new Error("That video link didn't match a public video.");
  }
  const ch = await yt("channels", channelId ? { part: "snippet,contentDetails", id: channelId } : { part: "snippet,contentDetails", forHandle: p.handle! }, key);
  units++;
  const channel = ch.items?.[0];
  if (!channel) throw new Error(`No public channel found for ${p.handle || input}`);
  const handle = String(channel.snippet.customUrl || p.handle || "@" + channel.id).toLowerCase();
  const uploads = channel.contentDetails.relatedPlaylists.uploads;

  // 2. Page through uploads 50 at a time, fetching each page's details right away,
  //    so the pull stops as soon as it has enough Shorts.
  const records: VideoRecord[] = [];
  let pageToken = "";
  for (let p = 0; p < MAX_PAGES && records.length < MAX_SHORTS; p++) {
    const params: Record<string, string> = { part: "contentDetails", playlistId: uploads, maxResults: "50" };
    if (pageToken) params.pageToken = pageToken;
    const page = await yt("playlistItems", params, key);
    units++;
    const batch = (page.items || []).map((it: any) => it.contentDetails.videoId);
    pageToken = page.nextPageToken || "";

    // 3. Details for this page, keep Shorts only
    if (!batch.length) break;
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
        // Array.from splits by code point, so the cut never lands inside an emoji.
        text: Array.from(v.snippet.description || "").slice(0, 300).join(""),
        views: Number(v.statistics?.viewCount || 0),
        likes: Number(v.statistics?.likeCount || 0),
        posted_at: v.snippet.publishedAt,
        thumbnail: (th.high || th.medium || th.default || {}).url || "",
        duration_s: duration,
      });
      if (records.length >= MAX_SHORTS) break;
    }
    if (!pageToken) break;
  }

  const th = channel.snippet.thumbnails || {};
  const avatar = (th.medium || th.default || {}).url || "";
  return { channel: { id: channel.id, title: channel.snippet.title, handle, avatar }, records, quota_units: units };
}
