// The videos of a program's YouTube link, from the official YouTube Data API v3 (asked for by the
// user on 2026-11-03): each video of a playlist becomes one session members play and tick off.
// Only the server holds the key (YOUTUBE_API_KEY); members read the copy saved in
// fitness_program_videos, so the API is called only when an admin saves a link or refreshes it.
//
// Every answer is checked before it's kept: IDs must look like YouTube's, titles are cleaned and
// cut short, private and deleted videos are left out, and a playlist stops at MAX_VIDEOS.
//
// YouTube's API terms (kept on purpose, see AGENTS.md "YouTube videos"): the videos play only in
// YouTube's own embedded player, unchanged (ads and branding included); nothing is downloaded or
// re-hosted; what the API answered (titles, lengths, the channel) is refreshed before it's
// REFRESH_DAYS old and never shown or kept past KEEP_DAYS (fitness/youtubeRefresh.js); the
// creator's channel is credited under the player; programs with YouTube videos stay free.
const REFRESH_DAYS = 25;
const KEEP_DAYS = 30;
const MAX_VIDEOS = 200;
const PAGE = 50; // the most the API answers at once
const TIMEOUT_MS = 10000;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const HIDDEN_TITLES = new Set(["Private video", "Deleted video"]);

class YouTubeError extends Error {}

const configured = (env = process.env) => Boolean(env.YOUTUBE_API_KEY);
// Tests point this at a local fake; everywhere else it's Google's
const apiBase = (env) => env.YOUTUBE_API_URL || "https://www.googleapis.com/youtube/v3";

const cleanTitle = (value) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);

// "PT1H2M30S" → seconds (0 when YouTube gives none, as for a live stream)
function durationSec(iso) {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(iso ?? ""));
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0;
}

// One API call. The key travels only in the request; errors never repeat the URL (it holds the key).
async function call(env, path, params) {
  const url = new URL(`${apiBase(env)}/${path}`);
  for (const [k, v] of Object.entries({ ...params, key: env.YOUTUBE_API_KEY })) url.searchParams.set(k, v);
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "application/json" } });
  } catch {
    throw new YouTubeError("YouTube couldn't be reached. Please try again.");
  }
  if (response.status === 404) throw new YouTubeError("YouTube can't find that playlist. Check it's public or unlisted.");
  if (response.status === 403) throw new YouTubeError("YouTube refused the request. Check YOUTUBE_API_KEY and that YouTube Data API v3 is enabled for it.");
  if (!response.ok) throw new YouTubeError("YouTube didn't answer properly. Please try again.");
  return response.json().catch(() => ({}));
}

// Titles and lengths for up to 50 video IDs at a time, in the order asked, and the channel of the first
async function videoDetails(env, ids) {
  const found = new Map();
  let channel = "";
  for (let i = 0; i < ids.length; i += PAGE) {
    const body = await call(env, "videos", { part: "snippet,contentDetails,status", id: ids.slice(i, i + PAGE).join(","), maxResults: String(PAGE) });
    for (const item of Array.isArray(body.items) ? body.items : []) {
      if (!VIDEO_ID.test(item?.id ?? "") || item?.status?.privacyStatus === "private") continue;
      found.set(item.id, { title: cleanTitle(item.snippet?.title), seconds: durationSec(item.contentDetails?.duration) });
      if (!channel) channel = cleanTitle(item.snippet?.channelTitle).slice(0, 100);
    }
  }
  return { videos: ids.filter((id) => found.has(id)).map((id) => ({ videoId: id, ...found.get(id) })), channel };
}

// The channel that owns a playlist (credited under the player)
async function playlistChannel(env, playlistId) {
  const body = await call(env, "playlists", { part: "snippet", id: playlistId, maxResults: "1" });
  const item = Array.isArray(body.items) ? body.items[0] : null;
  if (!item) throw new YouTubeError("YouTube can't find that playlist. Check it's public or unlisted.");
  return cleanTitle(item.snippet?.channelTitle).slice(0, 100);
}

/**
 * The videos of a link ({ kind: "playlist" | "video", id }) in order, and the channel to credit
 * → { videos: [{ videoId, title, seconds }], channel }.
 * Throws YouTubeError with a line for the admin when YouTube can't be asked or the link is empty.
 */
async function fetchVideos(link, env = process.env) {
  if (!configured(env)) throw new YouTubeError("Add YOUTUBE_API_KEY to the server's .env to load the videos.");
  let ids = [link.id];
  let owner = "";
  if (link.kind === "playlist") {
    owner = await playlistChannel(env, link.id);
    ids = [];
    let pageToken = "";
    do {
      const body = await call(env, "playlistItems", { part: "snippet,status", playlistId: link.id, maxResults: String(PAGE), ...(pageToken ? { pageToken } : {}) });
      for (const item of Array.isArray(body.items) ? body.items : []) {
        const id = item?.snippet?.resourceId?.videoId;
        if (VIDEO_ID.test(id ?? "") && !HIDDEN_TITLES.has(item.snippet?.title) && item?.status?.privacyStatus !== "private" && !ids.includes(id)) ids.push(id);
      }
      pageToken = typeof body.nextPageToken === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(body.nextPageToken) ? body.nextPageToken : "";
    } while (pageToken && ids.length < MAX_VIDEOS);
    ids = ids.slice(0, MAX_VIDEOS);
  }
  const { videos, channel } = await videoDetails(env, ids);
  if (videos.length === 0) throw new YouTubeError(link.kind === "playlist" ? "That playlist has no public videos." : "That video is private or was removed.");
  return { videos, channel: owner || channel };
}

module.exports = { fetchVideos, configured, durationSec, YouTubeError, MAX_VIDEOS, REFRESH_DAYS, KEEP_DAYS };
