import { useEffect, useRef, useState } from 'react'
import { usePublicSettings } from '@/core/settings/usePublicSettings'
import { cn } from '@/core/lib/cn'
import { EmiLine } from './EmiCalculator'

const SCRIPT_URL = 'https://cdn.razorpay.com/widgets/affordability/affordability.js'
// Razorpay renders into this exact id, so there can be one widget per page.
const CONTAINER_ID = 'razorpay-affordability-widget'

let scriptPromise = null
function loadWidgetScript() {
  if (window.RazorpayAffordabilitySuite) return Promise.resolve()
  scriptPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = SCRIPT_URL
    s.async = true
    s.onload = () => (window.RazorpayAffordabilitySuite ? resolve() : reject(new Error('widget missing')))
    s.onerror = () => {
      scriptPromise = null
      s.remove()
      reject(new Error('widget script failed'))
    }
    document.head.appendChild(s)
  })
  return scriptPromise
}

/**
 * Razorpay's own Affordability widget under the price: "No cost EMI from ₹X/month · View plans", bank
 * logos and "Secured by Razorpay", with the plans Razorpay actually offers this merchant. Shown when EMI
 * is on (Admin → Settings → Payments) and the amount qualifies. If the widget can't load (blocked, offline),
 * our own EMI line takes its place.
 *
 * @param {{ amount: number, className?: string }} props amount in paise (price × quantity)
 */
export function RazorpayEmiWidget({ amount, className }) {
  const { data: settings } = usePublicSettings()
  const p = settings?.payments
  const eligible = Boolean(p?.emiEnabled && p.razorpayKeyId && amount >= (p.emiMinOrderValue ?? 0))
  const ref = useRef(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!eligible || failed) return
    let cancelled = false
    // Quantity changes re-render the widget for the new total, once typing settles.
    const t = setTimeout(async () => {
      try {
        await loadWidgetScript()
        if (cancelled || !ref.current) return
        ref.current.innerHTML = ''
        new window.RazorpayAffordabilitySuite({ key: p.razorpayKeyId, amount: Math.round(amount) }).render()
      } catch {
        if (!cancelled) setFailed(true)
      }
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [eligible, failed, amount, p?.razorpayKeyId])

  if (!eligible) return null
  if (failed) return <EmiLine price={amount} className={className} />
  return <div id={CONTAINER_ID} ref={ref} className={cn('min-h-[72px] max-w-md', className)} />
}
