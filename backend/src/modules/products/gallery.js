/**
 * A product's gallery is `images` and `videos` (each in its own order) plus `mediaOrder`, which says
 * how the two interleave: ['image', 'video', 'image'] = images[0], videos[0], images[1].
 */

/**
 * Makes `order` agree with the lists it describes: extra entries are dropped and media it doesn't
 * cover goes at the end (photos, then videos), so a stale or missing order can never hide anything.
 */
export function normalizeMediaOrder(order, imageCount, videoCount) {
  const left = { image: imageCount, video: videoCount };
  const out = [];
  for (const kind of order ?? []) {
    if (left[kind] > 0) {
      out.push(kind);
      left[kind] -= 1;
    }
  }
  for (const kind of ['image', 'video']) while (left[kind]-- > 0) out.push(kind);
  return out;
}

/** The order to store and serialize for a product (plain object or document). */
export const mediaOrderOf = (p) => normalizeMediaOrder(p.mediaOrder, p.images?.length ?? 0, p.videos?.length ?? 0);
