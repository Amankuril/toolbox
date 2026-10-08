/** "Today at 05:18 am" · "Yesterday at 08:23 pm" · "6 Oct, 11:54 am" · "6 Oct 2025, 11:54 am" */
export function formatActivity(d) {
  if (!d) return '—'
  const date = new Date(d)
  const time = date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }).toLowerCase()
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const dayMs = 24 * 60 * 60 * 1000
  if (date >= startOfToday) return `Today at ${time}`
  if (date >= new Date(startOfToday.getTime() - dayMs)) return `Yesterday at ${time}`
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return `${date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })}, ${time}`
}

/**
 * Opens the WhatsApp / SMS link the server built. A tab is opened synchronously (inside the click)
 * so popup blockers allow it, then pointed at the link once the request returns.
 * @param {'whatsapp'|'sms'} channel
 * @param {() => Promise<{ url: string }>} request
 */
export async function openContact(channel, request) {
  const tab = channel === 'whatsapp' ? window.open('about:blank', '_blank') : null
  try {
    const { url, ...rest } = await request()
    if (tab) {
      tab.opener = null
      tab.location.href = url
    } else {
      window.location.href = url
    }
    return { url, ...rest }
  } catch (err) {
    tab?.close()
    throw err
  }
}
