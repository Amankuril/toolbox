import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Banknote,
  Building2,
  Check,
  CreditCard,
  Home,
  Lock,
  MapPin,
  MessageSquareText,
  PencilLine,
  Plus,
  ReceiptText,
  WalletCards,
  Warehouse,
  Wrench,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { parseApiError } from '@/core/api/errors'
import { useSession } from '@/core/auth/session'
import { cn } from '@/core/lib/cn'
import { formatINR, formatNumber, formatPhone } from '@/core/lib/format'
import { splitPartial } from '@/core/lib/pricing'
import { gstin as gstinRule } from '@/core/lib/validators'
import { usePublicSettings } from '@/core/settings/usePublicSettings'
import { Thumb } from '@/ui/Brand'
import { Button } from '@/ui/Button'
import { Alert, Skeleton } from '@/ui/Card'
import { Checkbox, Field, Input, Textarea } from '@/ui/Field'
import { storeKeys, userApi } from '../api'
import { useCart } from '../cart/useCart'
import { dispatchOf, groupBySeller } from '../cart/groups'
import { AddressDialog } from '../components/AddressDialog'
import { CartSummary } from '../components/CartSummary'
import { CheckoutHeader, CheckoutSteps, MobileCheckoutBar, TrustRow } from '../components/checkoutKit'
import { payForOrder } from '../payments'

const LABEL_ICON = { Home, Office: Building2, Workshop: Wrench, Warehouse }

/** A numbered checkout section. Shows a tick and a one-line summary once it's complete. */
function Section({ n, title, done, summary, action, children }) {
  return (
    <section className={cn('overflow-hidden rounded-lg border bg-white transition-colors', done ? 'border-slate-200' : 'border-slate-300')}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={cn(
              'grid size-8 shrink-0 place-items-center rounded-full text-sm font-bold transition-colors',
              done ? 'bg-primary text-primary-fg' : 'border-2 border-slate-900 text-slate-900',
            )}
          >
            {done ? <Check className="size-4" strokeWidth={3} /> : n}
          </span>
          <div className="min-w-0">
            <h2 className="text-[1.0625rem] font-bold text-slate-900">{title}</h2>
            {summary && <p className="truncate text-sm text-slate-600">{summary}</p>}
          </div>
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  )
}

/** Selectable tile with a radio mark. */
function Tile({ selected, onSelect, disabled, className, children }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'relative flex w-full items-start gap-3 rounded-lg border-[1.5px] p-4 text-left transition-[border-color,background-color,box-shadow] disabled:cursor-not-allowed disabled:opacity-55',
        selected ? 'border-primary bg-primary-soft shadow-[0_0_0_3px] shadow-primary/12' : 'border-slate-200 bg-white enabled:hover:border-slate-400',
        className,
      )}
    >
      <span
        className={cn(
          'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2 transition-colors',
          selected ? 'border-primary bg-primary text-primary-fg' : 'border-slate-300 bg-white',
        )}
      >
        {selected && <Check className="size-3" strokeWidth={3.5} />}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  )
}

function MethodIcon({ icon: Icon, selected }) {
  return (
    <span
      className={cn(
        'grid size-10 shrink-0 place-items-center rounded-md border transition-colors',
        selected ? 'border-primary/30 bg-white text-primary' : 'border-slate-200 bg-slate-50 text-slate-700',
      )}
    >
      <Icon className="size-5" strokeWidth={1.8} />
    </span>
  )
}

const chip = 'rounded-sm border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-slate-700'

export default function CheckoutPage() {
  const cart = useCart()
  const account = useSession('user', (s) => s.account)
  const { data: settings } = usePublicSettings()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data: addresses, isLoading: addressesLoading } = useQuery({ queryKey: storeKeys.addresses, queryFn: userApi.addresses })

  const idempotencyKeyRef = useRef(crypto.randomUUID())
  const [addressId, setAddressId] = useState(null)
  const [addressDialog, setAddressDialog] = useState({ open: false, address: null })
  const [method, setMethod] = useState(null)
  const [wantsGst, setWantsGst] = useState(account?.accountType === 'business')
  const [gst, setGst] = useState({ gstin: account?.business?.gstin ?? '', businessName: account?.business?.name ?? '' })
  const [notesOpen, setNotesOpen] = useState(false)
  const [notes, setNotes] = useState('')
  const [paying, setPaying] = useState(false)

  const payments = settings?.payments
  const total = cart.summary.total
  const codAllowed = payments?.codEnabled && (!payments.codMaxOrderValue || total <= payments.codMaxOrderValue)
  const split = payments?.partialEnabled ? splitPartial(total, payments.partialAdvancePercent) : null
  const partialBlock = !split
    ? null
    : total < payments.partialMinOrderValue
      ? `Available on orders of ${formatINR(payments.partialMinOrderValue, { whole: true })} or more`
      : payments.partialMaxBalance && split.balanceDue > payments.partialMaxBalance
        ? `Up to ${formatINR(payments.partialMaxBalance, { whole: true })} can be paid on delivery`
        : null
  const chosenMethod = method ?? (payments?.razorpayEnabled ? 'razorpay' : codAllowed ? 'cod' : null)
  const chosenAddress = addressId ?? addresses?.find((a) => a.isDefault)?._id ?? addresses?.[0]?._id
  const address = addresses?.find((a) => a._id === chosenAddress)
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
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-56" />
          <Skeleton className="h-64" />
        </div>
        <Skeleton className="h-[28rem]" />
      </div>
    )
  }

  const canPlace = chosenAddress && chosenMethod && !cart.hasIssues && !gstError
  const groups = groupBySeller(cart.items, cart.sellers)
  const dueNow = chosenMethod === 'razorpay' ? total : chosenMethod === 'partial' && split ? split.advance : 0
  const dueLater = total - dueNow
  const cta =
    chosenMethod === 'razorpay' ? `Pay ${formatINR(total)}` : chosenMethod === 'partial' && split ? `Pay ${formatINR(split.advance)} now` : 'Place order'
  const methodLabel = { razorpay: 'Pay online', partial: 'Part payment', cod: 'Cash on delivery' }[chosenMethod]
  const busy = place.isPending || paying
  const placeButton = (props) => (
    <Button size="lg" variant="accent" disabled={!canPlace} loading={busy} onClick={() => place.mutate()} {...props}>
      <Lock /> {cta}
    </Button>
  )

  return (
    <div className="mx-auto max-w-7xl px-4 pt-6 pb-28 sm:px-6 lg:pb-10">
      <title>Checkout</title>
      <CheckoutHeader
        back={
          <Link to="/cart" className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-slate-600 hover:text-slate-900">
            <ArrowLeft className="size-4" /> Back to cart
          </Link>
        }
        eyebrow="Secure checkout"
        title="Checkout"
        meta={
          <>
            <span>
              {formatNumber(cart.count)} {cart.count === 1 ? 'unit' : 'units'} · {formatINR(total)}
            </span>
            {groups.length > 1 && <span>{groups.length} sellers, shipped separately</span>}
          </>
        }
        steps={<CheckoutSteps done={['cart', ...(chosenAddress ? ['address'] : []), ...(chosenAddress && chosenMethod ? ['payment'] : [])]} />}
      />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Section
            n={1}
            title="Delivery address"
            done={Boolean(address)}
            summary={address && `${address.name} · ${address.city}, ${address.pincode}`}
            action={
              addresses?.length > 0 && (
                <Button variant="outline" size="sm" onClick={() => setAddressDialog({ open: true, address: null })}>
                  <Plus /> New address
                </Button>
              )
            }
          >
            {addresses?.length ? (
              <div role="radiogroup" aria-label="Delivery address" className="grid gap-3 sm:grid-cols-2">
                {addresses.map((a) => {
                  const Icon = LABEL_ICON[a.label] ?? MapPin
                  const selected = chosenAddress === a._id
                  return (
                    <div key={a._id} className="relative">
                      <Tile selected={selected} onSelect={() => setAddressId(a._id)} className="h-full pr-12">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold tracking-[0.08em] text-slate-600 uppercase">
                            <Icon className="size-3.5" strokeWidth={2} /> {a.label || 'Address'}
                          </span>
                          {a.isDefault && <span className="rounded-sm bg-slate-900 px-1.5 py-0.5 text-[10px] font-bold text-white uppercase">Default</span>}
                        </span>
                        <span className="mt-1.5 block font-semibold text-slate-900">{a.name}</span>
                        <span className="mt-0.5 block text-sm leading-relaxed text-slate-600">
                          {[a.line1, a.line2, a.landmark].filter(Boolean).join(', ')}
                          <br />
                          {a.city}, {a.state} <span className="code">{a.pincode}</span>
                        </span>
                        <span className="mt-1.5 block text-xs text-slate-500">{formatPhone(a.phone)}</span>
                        {selected && <span className="mt-2 block text-xs font-bold text-primary">Delivering here</span>}
                      </Tile>
                      <button
                        type="button"
                        onClick={() => setAddressDialog({ open: true, address: a })}
                        className="absolute top-3 right-3 grid size-8 place-items-center rounded-md text-slate-500 hover:bg-white hover:text-slate-900"
                        aria-label={`Edit address for ${a.name}`}
                      >
                        <PencilLine className="size-4" />
                      </button>
                    </div>
                  )
                })}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAddressDialog({ open: true, address: null })}
                className="flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed border-slate-300 py-10 text-sm font-semibold text-slate-700 hover:border-primary hover:text-primary"
              >
                <span className="grid size-11 place-items-center rounded-full bg-slate-100">
                  <MapPin className="size-5" />
                </span>
                Add a delivery address
                <span className="text-xs font-normal text-slate-500">Enter a pincode and we&apos;ll fill in the city and state</span>
              </button>
            )}
          </Section>

          <Section
            n={2}
            title="Payment method"
            done={Boolean(chosenMethod)}
            summary={chosenMethod && (dueLater && dueNow ? `${methodLabel} · ${formatINR(dueNow)} now` : methodLabel)}
          >
            <div role="radiogroup" aria-label="Payment method" className="flex flex-col gap-3">
              {payments.razorpayEnabled && (
                <Tile selected={chosenMethod === 'razorpay'} onSelect={() => setMethod('razorpay')}>
                  <span className="flex items-start gap-3">
                    <MethodIcon icon={CreditCard} selected={chosenMethod === 'razorpay'} />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-bold text-slate-900">Pay online</span>
                        <span className="price text-lg text-slate-900">{formatINR(total)}</span>
                      </span>
                      <span className="mt-0.5 block text-sm text-slate-600">Instant confirmation. Refunds go straight back to your account.</span>
                      <span className="mt-2 flex flex-wrap gap-1.5">
                        {['UPI', 'Cards', 'Net banking', 'Wallets', 'EMI'].map((c) => (
                          <span key={c} className={chip}>
                            {c}
                          </span>
                        ))}
                      </span>
                    </span>
                  </span>
                </Tile>
              )}
              {split && (
                <Tile selected={chosenMethod === 'partial'} onSelect={() => setMethod('partial')} disabled={Boolean(partialBlock)}>
                  <span className="flex items-start gap-3">
                    <MethodIcon icon={WalletCards} selected={chosenMethod === 'partial'} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-bold text-slate-900">Pay {payments.partialAdvancePercent}% now, rest on delivery</span>
                      {partialBlock ? (
                        <span className="mt-0.5 block text-sm text-slate-600">{partialBlock}</span>
                      ) : (
                        <>
                          <span className="mt-0.5 block text-sm text-slate-600">
                            A small advance online confirms the order; pay the balance in cash to the courier.
                          </span>
                          <span className="mt-3 flex h-2 overflow-hidden rounded-full bg-slate-200" aria-hidden>
                            <span className="h-full bg-primary" style={{ width: `${payments.partialAdvancePercent}%` }} />
                          </span>
                          <span className="mt-2 grid grid-cols-2 gap-2 text-sm">
                            <span>
                              <span className="flex items-center gap-1.5 text-xs text-slate-600">
                                <span className="size-2 rounded-full bg-primary" /> Online now
                              </span>
                              <span className="price block text-lg text-slate-900">{formatINR(split.advance)}</span>
                            </span>
                            <span className="text-right">
                              <span className="flex items-center justify-end gap-1.5 text-xs text-slate-600">
                                <span className="size-2 rounded-full bg-slate-300" /> Cash on delivery
                              </span>
                              <span className="price block text-lg text-slate-900">{formatINR(split.balanceDue)}</span>
                            </span>
                          </span>
                        </>
                      )}
                    </span>
                  </span>
                </Tile>
              )}
              {payments.codEnabled && (
                <Tile selected={chosenMethod === 'cod'} onSelect={() => setMethod('cod')} disabled={!codAllowed}>
                  <span className="flex items-start gap-3">
                    <MethodIcon icon={Banknote} selected={chosenMethod === 'cod'} />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-bold text-slate-900">Cash on delivery</span>
                        {codAllowed && <span className="price text-lg text-slate-900">{formatINR(total)}</span>}
                      </span>
                      <span className="mt-0.5 block text-sm text-slate-600">
                        {codAllowed
                          ? 'Pay in cash when your order arrives. Keep the exact amount ready.'
                          : `Available for orders up to ${formatINR(payments.codMaxOrderValue)}`}
                      </span>
                    </span>
                  </span>
                </Tile>
              )}
              {!payments.razorpayEnabled && !payments.codEnabled && <Alert tone="warning">Checkout is temporarily unavailable. Please try again later.</Alert>}
            </div>
          </Section>

          <Section n={3} title="Billing" done summary={wantsGst && gst.gstin && !gstError ? `GST invoice for ${gst.gstin.toUpperCase()}` : 'Personal invoice'}>
            <Checkbox
              label="I'm buying for my business (add GSTIN)"
              description="Claim input tax credit. Your GSTIN and business name go on the seller's invoice."
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
                      placeholder="22AAAAA0000A1Z5"
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
            <div className="mt-5 border-t border-slate-100 pt-4">
              {notesOpen || notes ? (
                <Field label="Delivery instructions" hint="Optional. Shared with the seller, e.g. gate number or best time to call.">
                  {(p) => <Textarea {...p} rows={2} maxLength={500} autoFocus={!notes} value={notes} onChange={(e) => setNotes(e.target.value)} />}
                </Field>
              ) : (
                <button
                  type="button"
                  onClick={() => setNotesOpen(true)}
                  className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
                >
                  <MessageSquareText className="size-4" /> Add delivery instructions
                </button>
              )}
            </div>
          </Section>
        </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-36 lg:self-start">
          <CartSummary
            summary={cart.summary}
            title={
              <span className="flex items-center justify-between gap-3">
                Your order
                <Link to="/cart" className="text-sm font-semibold text-primary hover:underline">
                  Edit cart
                </Link>
              </span>
            }
            before={
              <div className="max-h-80 overflow-y-auto border-b border-slate-100">
                {groups.map((g) => {
                  const dispatch = dispatchOf(g.lines)
                  return (
                    <div key={g.key} className="border-b border-slate-100 px-5 py-3 last:border-b-0">
                      {g.seller && (
                        <p className="mb-2 flex items-center justify-between gap-2 text-xs">
                          <span className="truncate font-bold text-slate-800">{g.seller.name}</span>
                          {dispatch != null && <span className="shrink-0 text-slate-500">Dispatch {dispatch === 0 ? '24 h' : `${dispatch} d`}</span>}
                        </p>
                      )}
                      <ul className="flex flex-col gap-3">
                        {g.lines.map((i) => (
                          <li key={`${i.productId}:${i.variantId ?? ''}`} className="flex items-center gap-3 text-sm">
                            <span className="relative shrink-0">
                              <Thumb src={i.variant?.image?.url ?? i.product?.image?.url} className="size-12 rounded-md border border-slate-200" />
                              <span className="tabular absolute -top-1.5 -right-1.5 min-w-5 rounded-full bg-secondary px-1 text-center text-[10px] leading-5 font-bold text-secondary-fg ring-2 ring-white">
                                {i.quantity > 999 ? '999+' : i.quantity}
                              </span>
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="line-clamp-2 leading-snug text-slate-800">{i.product?.name}</span>
                              {i.variant && <span className="text-xs text-slate-500">{i.variant.title}</span>}
                            </span>
                            <span className="tabular font-semibold text-slate-900">{formatINR(i.lineTotal)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )
                })}
              </div>
            }
          >
            {chosenMethod && (
              <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-slate-200 bg-slate-200 text-sm">
                <div className="bg-white px-3 py-2.5">
                  <dt className="text-xs text-slate-500">Pay now</dt>
                  <dd className="price text-lg text-slate-900">{formatINR(dueNow)}</dd>
                </div>
                <div className="bg-white px-3 py-2.5">
                  <dt className="text-xs text-slate-500">On delivery</dt>
                  <dd className="price text-lg text-slate-900">{formatINR(dueLater)}</dd>
                </div>
              </dl>
            )}
            {placeButton({ className: 'mt-4 w-full' })}
            {!canPlace && !busy && (
              <p className="mt-2 text-center text-xs font-medium text-amber-800">
                {!chosenAddress
                  ? 'Add a delivery address to continue'
                  : !chosenMethod
                    ? 'Choose a payment method'
                    : gstError
                      ? 'Check your GSTIN'
                      : 'Review your cart to continue'}
              </p>
            )}
            <p className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-slate-500">
              <ReceiptText className="mt-px size-3.5 shrink-0" />
              Stock and prices are confirmed when you place the order. Each seller ships and invoices their items separately.
            </p>
          </CartSummary>
          <TrustRow />
        </aside>
      </div>

      <MobileCheckoutBar
        label={chosenMethod === 'partial' ? 'Pay now' : chosenMethod === 'cod' ? 'Pay on delivery' : 'Total'}
        amount={chosenMethod === 'partial' && split ? split.advance : total}
        note={address ? `Deliver to ${address.city}, ${address.pincode}` : 'Add a delivery address'}
      >
        {placeButton()}
      </MobileCheckoutBar>

      <AddressDialog
        open={addressDialog.open}
        onOpenChange={(open) => setAddressDialog((d) => ({ ...d, open }))}
        address={addressDialog.address}
        defaults={{ name: account?.name, phone: account?.phone }}
        onSaved={(_list, id) => setAddressId(id)}
      />
    </div>
  )
}
