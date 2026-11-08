// YouTube on Fitness programs: one playlist or one video, never both. The server stores only the
// kind and the ID (it checks the same shapes in JustFit_server/fitness/rules.js); the app builds
// every address from them.
export type YouTubeLink = { kind: "playlist" | "video"; id: string };

const PLAYLIST_ID = /^PL[A-Za-z0-9_-]{16,64}$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
export const validLink = (link: YouTubeLink) => (link.kind === "playlist" ? PLAYLIST_ID : VIDEO_ID).test(link.id);

// YouTube's own player, privacy-enhanced (no YouTube cookies until a video is played), with its
// branding and controls as YouTube ships them (never hidden)
export const embedUrl = ({ kind, id }: YouTubeLink) =>
  `https://www.youtube-nocookie.com/embed/${kind === "playlist" ? `videoseries?list=${encodeURIComponent(id)}&` : `${encodeURIComponent(id)}?`}rel=0&playsinline=1`;

// What anyone watching YouTube's player agrees to (YouTube's API terms ask apps to link both)
export const YOUTUBE_TERMS_URL = "https://www.youtube.com/t/terms";
export const GOOGLE_PRIVACY_URL = "https://policies.google.com/privacy";

// The playlist or video on YouTube itself, for "Watch on YouTube" (and the admin's field)
export const watchUrl = ({ kind, id }: YouTubeLink) =>
  kind === "playlist" ? `https://www.youtube.com/playlist?list=${encodeURIComponent(id)}` : `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
