const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);
const VIMEO_HOSTS = new Set(['vimeo.com', 'www.vimeo.com', 'player.vimeo.com']);

function youtubeId(url) {
  if (url.hostname === 'youtu.be') return url.pathname.split('/')[1];
  if (!YOUTUBE_HOSTS.has(url.hostname)) return null;
  if (url.pathname === '/watch') return url.searchParams.get('v');
  const [, kind, id] = url.pathname.split('/');
  return ['embed', 'shorts', 'live', 'v'].includes(kind) ? id : null;
}

function vimeoParts(url) {
  if (!VIMEO_HOSTS.has(url.hostname)) return null;
  const segments = url.pathname.split('/').filter(Boolean);
  const at = segments.findIndex((s) => /^\d+$/.test(s));
  if (at === -1) return null;
  // Unlisted videos carry a privacy hash, either as the next path segment or ?h=.
  const next = segments[at + 1];
  const hash = url.searchParams.get('h') ?? (next && /^[0-9a-f]{6,}$/i.test(next) ? next : null);
  return { id: segments[at], hash };
}

/**
 * Recognises YouTube and Vimeo links and returns how to embed them, or null for anything else.
 * Only the parsed id is kept, so whatever else the pasted link contained never reaches a page.
 *
 * @param {string} raw
 * @returns {{ source: 'youtube'|'vimeo', url: string, embedUrl: string, thumbnailUrl?: string } | null}
 */
export function parseVideoEmbed(raw) {
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol)) return null;
  url.hostname = url.hostname.toLowerCase();

  const yt = youtubeId(url);
  if (yt && YOUTUBE_ID.test(yt)) {
    return {
      source: 'youtube',
      url: `https://www.youtube.com/watch?v=${yt}`,
      embedUrl: `https://www.youtube-nocookie.com/embed/${yt}`,
      thumbnailUrl: `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`,
    };
  }

  const vimeo = vimeoParts(url);
  if (vimeo) {
    const query = vimeo.hash ? `?h=${encodeURIComponent(vimeo.hash)}` : '';
    return {
      source: 'vimeo',
      url: `https://vimeo.com/${vimeo.id}${vimeo.hash ? `/${encodeURIComponent(vimeo.hash)}` : ''}`,
      embedUrl: `https://player.vimeo.com/video/${vimeo.id}${query}`,
    };
  }
  return null;
}
