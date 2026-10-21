import { toast } from 'sonner'
import { create } from 'zustand'
import { safeStorage } from '@/core/lib/storage'

const KEY = 'tb:compare'
// Matches the API's cap; four columns is also what fits a laptop screen.
export const COMPARE_MAX = 4

/** Just enough to draw the compare tray without a request. */
const mini = (p) => {
  // Cards carry `image`; the full product page carries `images`.
  const image = p.image ?? p.images?.[0]
  return { _id: p._id, slug: p.slug, name: p.name, image: image ? { url: image.url } : null }
}

export const compareHref = (ids) => `/compare?ids=${ids.join(',')}`

/** Products picked for side-by-side comparison (this browser only, in the order picked). */
export const useCompare = create((set, get) => ({
  items: safeStorage.get(KEY, []),
  has: (id) => get().items.some((i) => i._id === id),
  save(items) {
    safeStorage.set(KEY, items)
    set({ items })
  },
  toggle(product) {
    const { items, has, save } = get()
    if (has(product._id)) return save(items.filter((i) => i._id !== product._id))
    if (items.length >= COMPARE_MAX) {
      toast.error(`You can compare up to ${COMPARE_MAX} products`, { description: 'Remove one from the compare tray first.' })
      return
    }
    save([...items, mini(product)])
  },
  remove(id) {
    get().save(get().items.filter((i) => i._id !== id))
  },
  /** Replaces the list with what the compare page is showing (e.g. a shared link). */
  replace(products) {
    get().save(products.slice(0, COMPARE_MAX).map(mini))
  },
  clear() {
    get().save([])
  },
}))
