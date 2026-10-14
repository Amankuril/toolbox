/** Product videos: an uploaded file (`media`) or a YouTube/Vimeo embed (`url`). */
export const videoKey = (v) => String(v.media ?? v.url)

/** What the product API takes back: the file id for uploads, the link for embeds. */
export const videoPayload = (v) =>
  v.media ? { media: v.media, ...(v.title ? { title: v.title } : {}) } : { url: v.url, ...(v.title ? { title: v.title } : {}) }
