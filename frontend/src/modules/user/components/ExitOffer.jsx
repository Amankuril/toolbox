import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, TicketPercent } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/core/api/errors'
import { useSession } from '@/core/auth/session'
import { safeStorage } from '@/core/lib/storage'
import { Button } from '@/ui/Button'
import { Dialog } from '@/ui/Dialog'
import { couponConditions, couponOffer } from '@/modules/vendor/coupons'
import { storeApi, storeKeys, userApi } from '../api'

const SEEN_KEY = 'exit-offer-seen'
const DAY = 24 * 60 * 60 * 1000
// Never interrupt someone paying or signing in.
const QUIET_PATHS = /^\/(checkout|pay\/|login|onboarding|account)/

/** True once the visitor looks like they're leaving: pointer heading for the tab bar (desktop), or a quick scroll back up after browsing (phones). */
function useLeaving(enabled) {
  const [leaving, setLeaving] = useState(false)
  useEffect(() => {
    if (!enabled) return
    const start = Date.now()
    const armed = () => Date.now() - start > 8_000
    const onMouseOut = (e) => {
      if (armed() && !e.relatedTarget && e.clientY <= 0) setLeaving(true)
    }
    let lastY = window.scrollY
    let lastT = Date.now()
    let deepest = 0
    const onScroll = () => {
      const y = window.scrollY
      const t = Date.now()
      deepest = Math.max(deepest, y)
      const speed = (lastY - y) / Math.max(1, t - lastT) // px per ms, upwards
      if (armed() && deepest > 800 && speed > 2.5) setLeaving(true)
      lastY = y
      lastT = t
    }
    const coarse = window.matchMedia?.('(pointer: coarse)').matches
    if (coarse) window.addEventListener('scroll', onScroll, { passive: true })
    else document.addEventListener('mouseout', onMouseOut)
    return () => {
      window.removeEventListener('scroll', onScroll)
      document.removeEventListener('mouseout', onMouseOut)
    }
  }, [enabled])
  return leaving
}

/** The admin's exit offer (Banners → Exit offer pop-up): once a day, with its coupon to apply in one tap. */
export function ExitOffer() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const signedIn = useSession('user', (s) => s.status === 'authenticated')
  const { data: banners = [] } = useQuery({ queryKey: storeKeys.banners, queryFn: storeApi.banners, staleTime: 5 * 60_000 })
  const offer = banners.find((b) => b.placement === 'exit_intent')
  const [seenAt] = useState(() => safeStorage.get(SEEN_KEY, {})[offer?._id] ?? 0)
  const [closed, setClosed] = useState(false)
  const [now] = useState(() => Date.now())
  const eligible = Boolean(offer) && !QUIET_PATHS.test(pathname) && now - seenAt > DAY
  const leaving = useLeaving(eligible)
  const open = leaving && eligible && !closed
  const setOpen = (v) => !v && setClosed(true)

  // Shown: not again for a day.
  useEffect(() => {
    if (open) safeStorage.set(SEEN_KEY, { ...safeStorage.get(SEEN_KEY, {}), [offer._id]: Date.now() })
  }, [open, offer])

  const apply = useMutation({
    mutationFn: () => userApi.applyCoupon(offer.coupon.code),
    onSuccess: (cart) => {
      qc.setQueryData(storeKeys.cart, cart)
      toast.success(`${offer.coupon.code} applied to your cart`)
      setOpen(false)
      navigate('/cart')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(offer.coupon.code)
      toast.success(`${offer.coupon.code} copied: use it at checkout`)
    } catch {
      toast.info(`Your code: ${offer.coupon.code}`)
    }
  }

  if (!offer) return null
  const c = offer.coupon
  return (
    <Dialog open={open} onOpenChange={setOpen} size="md" title={offer.title} description={offer.subtitle}>
      <div className="-mx-5 -mt-4 mb-4">
        <img src={offer.mobileImage?.url && window.innerWidth < 640 ? offer.mobileImage.url : offer.image.url} alt="" className="aspect-[1.91/1] w-full object-cover" />
      </div>
      {c ? (
        <div className="space-y-3">
          <div className="flex items-center gap-3 rounded-lg border-2 border-dashed border-primary/50 bg-primary/5 p-3">
            <TicketPercent className="size-6 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="font-display text-lg font-extrabold text-slate-900">{couponOffer(c)}</p>
              <p className="text-xs text-slate-600">{couponConditions(c)}</p>
            </div>
            <button type="button" onClick={copy} className="flex items-center gap-1.5 rounded border border-slate-300 bg-white px-2.5 py-1 font-mono text-sm font-bold" aria-label={`Copy code ${c.code}`}>
              {c.code} <Copy className="size-3.5 text-slate-400" />
            </button>
          </div>
          {signedIn ? (
            <Button size="lg" className="w-full" loading={apply.isPending} onClick={() => apply.mutate()}>
              Apply {c.code} to my cart
            </Button>
          ) : (
            <Button size="lg" className="w-full" onClick={copy}>
              Copy code
            </Button>
          )}
        </div>
      ) : (
        offer.link && (
          <Button size="lg" className="w-full" onClick={() => (setOpen(false), navigate(offer.link))}>
            {offer.ctaLabel || 'Shop now'}
          </Button>
        )
      )}
    </Dialog>
  )
}
