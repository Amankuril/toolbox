import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Banknote, Check, CreditCard, MapPin, Plus } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { parseApiError } from '@/core/api/errors'
import { useSession } from '@/core/auth/session'
import { cn } from '@/core/lib/cn'
import { formatINR, formatPhone } from '@/core/lib/format'
import { gstin as gstinRule } from '@/core/lib/validators'
import { usePublicSettings } from '@/core/settings/usePublicSettings'
import { Badge } from '@/ui/Badge'
import { Thumb } from '@/ui/Brand'
import { Button } from '@/ui/Button'
import { Alert, Card, Skeleton } from '@/ui/Card'
import { Checkbox, Field, Input, Textarea } from '@/ui/Field'
import { storeKeys, userApi } from '../api'
import { useCart } from '../cart/useCart'
import { AddressDialog } from '../components/AddressDialog'
import { CartSummary } from '../components/CartSummary'
import { payForOrder } from '../payments'

function Step({ n, title, children, action }) {
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-3 text-base font-semibold text-slate-900">
          <span className="grid size-7 place-items-center rounded-full bg-secondary text-xs font-bold text-secondary-fg">{n}</span>
          {title}
        </h2>
        {action}
      </div>
      {children}
    </Card>
  )
}

function Option({ selected, onSelect, disabled, children }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'relative flex w-full items-start gap-3 rounded-lg border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        selected ? 'border-primary bg-primary-soft ring-1 ring-primary' : 'border-slate-200 bg-white hover:border-slate-300',
      )}
    >
      <span
        className={cn(
          'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2',
          selected ? 'border-primary bg-primary text-primary-fg' : 'border-slate-300',
        )}
      >
        {selected && <Check className="size-3" strokeWidth={3} />}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  )
}

export default function CheckoutPage() {
  const cart = useCart()
  const account = useSession('user', (s) => s.account)
  const { data: settings } = usePublicSettings()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data: addresses, isLoading: addressesLoading } = useQuery({ queryKey: storeKeys.addresses, queryFn: userApi.addresses })

  const idempotencyKeyRef = useRef(crypto.randomUUID())
  const [addressId, setAddressId] = useState(null)
  const [addressDialog, setAddressDialog] = useState(false)
  const [method, setMethod] = useState(null)
  const [wantsGst, setWantsGst] = useState(account?.accountType === 'business')
  const [gst, setGst] = useState({ gstin: account?.business?.gstin ?? '', businessName: account?.business?.name ?? '' })
  const [notes, setNotes] = useState('')
  const [paying, setPaying] = useState(false)

  const payments = settings?.payments
  const total = cart.summary.total
  const codAllowed = payments?.codEnabled && (!payments.codMaxOrderValue || total <= payments.codMaxOrderValue)
  const chosenMethod = method ?? (payments?.razorpayEnabled ? 'razorpay' : codAllowed ? 'cod' : null)
  const chosenAddress = addressId ?? addresses?.find((a) => a.isDefault)?._id ?? addresses?.[0]?._id
  const gstError = wantsGst && gst.gstin && !gstinRule.safeParse(gst.gstin).success ? 'Enter a valid 15 character GSTIN' : null

  const place = useMutation({
    mutationFn: () =>
      userApi.checkout({
        addressId: chosenAddress,
        paymentMethod: chosenMethod,
        notes: notes.trim() || undefined,
        idempotencyKey: idempotencyKeyRef.current,
        ...(wantsGst && gst.gstin ? { gstin: gst.gstin.trim().toUpperCase(), businessName: gst.businessName.trim() || undefined } : {}),
      }),
    onSuccess: async ({ order, payment }) => {
      qc.invalidateQueries({ queryKey: storeKeys.cart })
      qc.invalidateQueries({ queryKey: ['user', 'orders'] })
      if (!payment) {
        navigate(`/account/orders/${order._id}?placed=1`, { replace: true })
        return
      }
      setPaying(true)
      const payResult = await payForOrder({ order, payment, siteName: settings.branding.siteName })
      setPaying(false)
      qc.invalidateQueries({ queryKey: storeKeys.cart })
      const queryParam = payResult.status === 'paid' ? '?placed=1' : payResult.status === 'verifying' ? '?verifying=1' : ''
      navigate(`/account/orders/${order._id}${queryParam}`, { replace: true })
    },
    onError: (err) => {
      const e = parseApiError(err)
      if (['CART_HAS_ISSUES', 'OUT_OF_STOCK'].includes(e.code)) {
        qc.invalidateQueries({ queryKey: storeKeys.cart })
        toast.error(e.message, { action: { label: 'Review cart', onClick: () => navigate('/cart') } })
      } else toast.error(e.message)
    },
  })

  if (!cart.isLoading && !cart.items.length && !place.isSuccess) return <Navigate to="/cart" replace />
  if (cart.isLoading || addressesLoading || !settings) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <Skeleton className="h-96" />
      </div>
    )
  }

  const canPlace = chosenAddress && chosenMethod && !cart.hasIssues && !gstError

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <title>Checkout</title>
      <h1 className="mb-6 text-2xl font-bold text-slate-900">Checkout</h1>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-5">
          <Step
            n={1}
            title="Delivery address"
            action={
              addresses?.length > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setAddressDialog(true)}>
                  <Plus /> Add new
                </Button>
              )
            }
          >
            {addresses?.length ? (
              <div role="radiogroup" aria-label="Delivery address" className="grid gap-3 sm:grid-cols-2">
                {addresses.map((a) => (
                  <Option key={a._id} selected={chosenAddress === a._id} onSelect={() => setAddressId(a._id)}>
                    <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                      {a.name} <Badge>{a.label}</Badge>
                    </span>
                    <span className="mt-1 block text-sm text-slate-600">
                      {[a.line1, a.line2, a.landmark].filter(Boolean).join(', ')}, {a.city}, {a.state} {a.pincode}
                    </span>
                    <span className="mt-1 block text-xs text-slate-500">{formatPhone(a.phone)}</span>
                  </Option>
                ))}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAddressDialog(true)}
                className="flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed border-slate-300 py-8 text-sm font-medium text-slate-600 hover:border-primary hover:text-primary"
              >
                <MapPin className="size-5" /> Add a delivery address
              </button>
            )}
          </Step>

          <Step n={2} title="Billing">
            <Checkbox
              label="I'm buying for my business (add GSTIN)"
              description="Your GSTIN and business name are shared with the seller for billing."
              checked={wantsGst}
              onChange={(e) => setWantsGst(e.target.checked)}
            />
            {wantsGst && (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label="GSTIN" error={gstError}>
                  {(p) => (
                    <Input
                      {...p}
                      className="font-mono uppercase"
                      maxLength={15}
                      value={gst.gstin}
                      onChange={(e) => setGst({ ...gst, gstin: e.target.value })}
                    />
                  )}
                </Field>
                <Field label="Business name">
                  {(p) => <Input {...p} value={gst.businessName} onChange={(e) => setGst({ ...gst, businessName: e.target.value })} />}
                </Field>
              </div>
            )}
          </Step>

          <Step n={3} title="Payment">
            <div role="radiogroup" aria-label="Payment method" className="flex flex-col gap-3">
              {payments.razorpayEnabled && (
                <Option selected={chosenMethod === 'razorpay'} onSelect={() => setMethod('razorpay')}>
                  <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <CreditCard className="size-4" /> Pay online
                  </span>
                  <span className="mt-0.5 block text-sm text-slate-600">UPI, debit/credit cards, net banking and wallets via Razorpay</span>
                </Option>
              )}
              {payments.codEnabled && (
                <Option selected={chosenMethod === 'cod'} onSelect={() => setMethod('cod')} disabled={!codAllowed}>
                  <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <Banknote className="size-4" /> Cash on delivery
                  </span>
                  <span className="mt-0.5 block text-sm text-slate-600">
                    {codAllowed ? 'Pay in cash when your order arrives' : `Available for orders up to ${formatINR(payments.codMaxOrderValue)}`}
                  </span>
                </Option>
              )}
              {!payments.razorpayEnabled && !payments.codEnabled && <Alert tone="warning">Checkout is temporarily unavailable. Please try again later.</Alert>}
            </div>
          </Step>

          <Card className="p-5">
            <Field label="Order notes (optional)" hint="Delivery instructions for the seller">
              {(p) => <Textarea {...p} rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />}
            </Field>
          </Card>
        </div>

        <div className="lg:sticky lg:top-36 lg:self-start">
          <CartSummary summary={cart.summary}>
            <ul className="mt-4 flex max-h-64 flex-col gap-3 overflow-y-auto border-t border-slate-100 pt-4">
              {cart.items.map((i) => (
                <li key={i.productId} className="flex items-center gap-3 text-sm">
                  <Thumb src={i.product?.image?.url} className="size-12 shrink-0 rounded border border-slate-200" />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-slate-800">{i.product?.name}</span>
                    <span className="text-xs text-slate-500">Qty {i.quantity}</span>
                  </span>
                  <span className="tabular font-medium">{formatINR(i.lineTotal)}</span>
                </li>
              ))}
            </ul>
            <Button size="lg" className="mt-5 w-full" disabled={!canPlace} loading={place.isPending || paying} onClick={() => place.mutate()}>
              {chosenMethod === 'razorpay' ? `Pay ${formatINR(total)}` : 'Place order'}
            </Button>
            <p className="mt-3 text-center text-xs text-slate-500">
              <Link to="/cart" className="font-medium text-primary hover:underline">
                Edit cart
              </Link>
            </p>
          </CartSummary>
        </div>
      </div>

      <AddressDialog
        open={addressDialog}
        onOpenChange={setAddressDialog}
        defaults={{ name: account?.name, phone: account?.phone }}
        onSaved={(_list, id) => setAddressId(id)}
      />
    </div>
  )
}
