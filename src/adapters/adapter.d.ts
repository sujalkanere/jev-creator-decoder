// Every source adapter (YouTube today, Instagram or file drop later) returns this shape.
// Everything after the adapter is platform-agnostic.
export interface VideoRecord {
  platform: string;      // "youtube"
  id: string;            // platform video id
  url: string;           // public link to the video
  title: string;
  text: string;          // description, trimmed to 300 characters
  views: number;
  likes: number;
  posted_at: string;     // ISO date
  thumbnail: string;     // image URL
  duration_s: number;
}

export interface AdapterResult {
  channel: { id: string; title: string; handle: string; avatar: string };
  records: VideoRecord[];
  quota_units: number;   // YouTube quota units this ingest used
}
