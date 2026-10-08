/**
 * Google Analytics 4 for the storefront. The Measurement ID comes from Admin → Settings → Analytics;
 * without one nothing loads and every call is a no-op. Events fired before settings arrive are
 * queued and sent (or dropped) once we know.
 *
 * Money in the app is paise; GA wants currency units, so items and values are converted here.
 */

const CURRENCY = 'INR'
const MAX_QUEUE = 50

let state = 'pending' // 'pending' → 'on' | 'off'
let queue = []

function gtag() {
  // gtag.js reads the `arguments` object itself, not an array.
  window.dataLayer.push(arguments)
}

let last = { key: '', at: 0 }

function send(...args) {
  // A component that mounts twice (React StrictMode in development, Suspense retries) would report
  // the same event twice; an identical event within a second is the same event.
  const key = JSON.stringify(args)
  if (key === last.key && Date.now() - last.at < 1000) return
  last = { key, at: Date.now() }
  if (state === 'on') window.gtag(...args)
  else if (state === 'pending' && queue.length < MAX_QUEUE) queue.push(args)
}

/** Starts GA with this ID (once), or switches analytics off when there's none. */
export function initAnalytics(measurementId) {
  if (state !== 'pending') return
  if (!measurementId) {
    state = 'off'
    queue = []
    return
  }
  window.dataLayer = window.dataLayer || []
  window.gtag = gtag
  gtag('js', new Date())
  // Page views are sent by the router (an SPA has no page loads after the first).
  gtag('config', measurementId, { send_page_view: false })
  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`
  document.head.appendChild(script)
  state = 'on'
  for (const args of queue) window.gtag(...args)
  queue = []
}

export function trackPageView() {
  send('event', 'page_view', { page_location: window.location.href, page_path: window.location.pathname + window.location.search, page_title: document.title })
}

/** Any GA4 event, e.g. track('search', { search_term }). */
export function track(name, params = {}) {
  send('event', name, params)
}

export const toRupees = (paise) => Math.round(Number(paise ?? 0)) / 100

/**
 * GA4 item from a product (card or full) plus optional variant / quantity / price override.
 * No personal data: products only.
 */
export function gaItem(product, { quantity = 1, price, variant } = {}) {
  if (!product) return null
  return {
    item_id: product.sku || String(product._id),
    item_name: product.name,
    ...(product.brand ? { item_brand: product.brand } : {}),
    ...(product.category?.name ? { item_category: product.category.name } : {}),
    ...(variant ? { item_variant: variant } : {}),
    price: toRupees(price ?? product.pricing?.price ?? product.price),
    quantity,
  }
}

/** Standard e-commerce event: value = sum of item price × quantity unless given. */
export function trackItems(name, items, extra = {}) {
  const list = items.filter(Boolean)
  if (!list.length) return
  const value = extra.value ?? list.reduce((sum, i) => sum + i.price * i.quantity, 0)
  track(name, { currency: CURRENCY, value: Math.round(value * 100) / 100, items: list, ...extra })
}

/** Fires an event at most once per browser session for `key` (e.g. a purchase on page reloads). */
export function trackOnce(key, fn) {
  try {
    const k = `ga:once:${key}`
    if (sessionStorage.getItem(k)) return
    sessionStorage.setItem(k, '1')
  } catch {
    /* storage blocked: still send once for this page */
  }
  fn()
}

/** add_to_cart / remove_from_cart for a quantity change from `from` to `to` (no event if equal). */
export function trackCartChange(product, { from = 0, to, price, variant } = {}) {
  if (!product || to === from) return
  const quantity = Math.abs(to - from)
  trackItems(to > from ? 'add_to_cart' : 'remove_from_cart', [gaItem(product, { quantity, price, variant })])
}

/** GA4 purchase for a placed order, sent at most once per order per browser session. */
export function trackPurchase(order) {
  if (!order || order.status === 'pending_payment') return
  trackOnce(`purchase:${order._id}`, () => {
    const items = order.items
      .filter((i) => i.status !== 'cancelled')
      .map((i) => ({
        item_id: i.sku || String(i.product),
        item_name: i.name,
        ...(i.variant?.title ? { item_variant: i.variant.title } : {}),
        price: toRupees(i.unitPrice),
        quantity: i.quantity,
        ...(i.discount ? { discount: toRupees(i.discount) } : {}),
      }))
    trackItems('purchase', items, {
      transaction_id: order.orderNumber,
      value: toRupees(order.amounts.total),
      tax: toRupees(order.amounts.tax),
      shipping: toRupees(order.amounts.shipping),
      ...(order.coupon?.code ? { coupon: order.coupon.code } : {}),
      payment_type: order.payment?.method,
    })
  })
}

/** Cart lines (as the cart API returns them) as GA4 items. */
export const cartItems = (lines) =>
  lines.filter((l) => l.product).map((l) => gaItem(l.product, { quantity: l.quantity, price: l.unitPrice, variant: l.variant?.title }))
