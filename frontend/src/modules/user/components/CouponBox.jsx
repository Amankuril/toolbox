import { useMutation, useQueryClient } from '@tanstack/react-query'
import { TicketPercent, X } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { parseApiError } from '@/core/api/errors'
import { formatINR } from '@/core/lib/format'
import { Button } from '@/ui/Button'
import { Input } from '@/ui/Field'
import { storeKeys, userApi } from '../api'

/** Apply / remove a seller's coupon code. Shows why an applied code no longer works. */
export function CouponBox({ coupon, signedIn }) {
  const qc = useQueryClient()
  const [code, setCode] = useState('')
  const [error, setError] = useState(null)
  const onCart = (cart) => {
    qc.setQueryData(storeKeys.cart, cart)
    setError(null)
    setCode('')
  }
  const apply = useMutation({
    mutationFn: () => userApi.applyCoupon(code.trim()),
    onSuccess: onCart,
    onError: (e) => setError(parseApiError(e).message),
  })
  const remove = useMutation({ mutationFn: userApi.removeCoupon, onSuccess: onCart, onError: (e) => setError(parseApiError(e).message) })

  if (!signedIn) {
    return (
      <p className="mt-4 flex items-center gap-2 rounded-md border border-dashed border-slate-300 px-3 py-2.5 text-sm text-slate-600">
        <TicketPercent className="size-4 shrink-0 text-slate-500" />
        <span>
          Have a coupon?{' '}
          <Link to="/login?next=/cart" className="font-semibold text-primary hover:underline">
            Sign in
          </Link>{' '}
          to apply it.
        </span>
      </p>
    )
  }

  if (coupon) {
    return (
      <div className={`mt-4 rounded-md border px-3 py-2.5 text-sm ${coupon.issue ? 'border-amber-300 bg-amber-50' : 'border-primary-muted bg-primary-soft'}`}>
        <div className="flex items-center gap-2">
          <TicketPercent className={`size-4 shrink-0 ${coupon.issue ? 'text-amber-700' : 'text-primary'}`} />
          <span className="font-mono font-semibold text-slate-900">{coupon.code}</span>
          <span className={`min-w-0 flex-1 truncate ${coupon.issue ? 'text-amber-800' : 'font-semibold text-primary'}`}>
            {coupon.issue ? 'Not applied' : `−${formatINR(coupon.discount)}`}
          </span>
          <Button variant="ghost" size="icon-sm" aria-label="Remove coupon" loading={remove.isPending} onClick={() => remove.mutate()}>
            <X />
          </Button>
        </div>
        {coupon.issue ? (
          <p className="mt-1 text-xs font-medium text-amber-800">{coupon.message}. Remove it to check out.</p>
        ) : (
          coupon.description && <p className="mt-0.5 text-xs text-slate-600">{coupon.description}</p>
        )}
        {error && <p className="mt-1 text-xs font-medium text-red-600">{error}</p>}
      </div>
    )
  }

  return (
    <form
      className="mt-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (code.trim()) apply.mutate()
      }}
    >
      <label htmlFor="coupon-code" className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-slate-900">
        <TicketPercent className="size-4 text-slate-500" /> Have a coupon?
      </label>
      <div className="flex gap-2">
        <Input
          id="coupon-code"
          className="font-mono uppercase"
          placeholder="Enter code"
          maxLength={20}
          value={code}
          aria-invalid={Boolean(error) || undefined}
          onChange={(e) => {
            setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))
            setError(null)
          }}
        />
        <Button type="submit" variant="outline" loading={apply.isPending} disabled={code.trim().length < 3}>
          Apply
        </Button>
      </div>
      {error && <p className="mt-1.5 text-xs font-medium text-red-600">{error}</p>}
    </form>
  )
}
