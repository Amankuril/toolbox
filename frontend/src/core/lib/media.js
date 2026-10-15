/** Product videos: an uploaded file (`media`) or a YouTube/Vimeo embed (`url`). */
export const videoKey = (v) => String(v.media ?? v.url)

/** What the product API takes back: the file id for uploads, the link for embeds. */
export const videoPayload = (v) =>
  v.media ? { media: v.media, ...(v.title ? { title: v.title } : {}) } : { url: v.url, ...(v.title ? { title: v.title } : {}) }

/**
 * One gallery list from a product's `images`, `videos` and `mediaOrder` (['image', 'video', …]; the nth
 * 'image' is images[n]). Media the order doesn't mention follows it, photos first. Mirrors backend products/gallery.js.
 * @returns {Array<{ kind: 'image'|'video', item: any }>}
 */
export function mergeMedia(images = [], videos = [], order = []) {
  const queues = { image: [...images], video: [...videos] }
  const out = []
  for (const kind of order) if (queues[kind]?.length) out.push({ kind, item: queues[kind].shift() })
  return [...out, ...queues.image.map((item) => ({ kind: 'image', item })), ...queues.video.map((item) => ({ kind: 'video', item }))]
}

/** The reverse of mergeMedia: what the product API stores. */
export function splitMedia(list) {
  return {
    images: list.filter((m) => m.kind === 'image').map((m) => m.item),
    videos: list.filter((m) => m.kind === 'video').map((m) => m.item),
    mediaOrder: list.map((m) => m.kind),
  }
}

/** Whether a pasted link is a video (YouTube, Vimeo or a video file) or an image. */
export const linkKind = (url) => (/youtube\.com|youtu\.be|vimeo\.com|\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url) ? 'video' : 'image')
