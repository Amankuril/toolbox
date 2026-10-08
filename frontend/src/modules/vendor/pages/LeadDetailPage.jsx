import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Lightbulb, MessageCircle, MessageSquareText, TicketPercent } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/core/api/errors'
import { formatDate, formatINR, formatPhone, formatRelative, pluralize } from '@/core/lib/format'
import { safeStorage as storage } from '@/core/lib/storage'
import { cn } from '@/core/lib/cn'
import { Badge } from '@/ui/Badge'
import { Thumb } from '@/ui/Brand'
import { Button } from '@/ui/Button'
import { Alert, Card, CardBody, CardHeader, EmptyState, Skeleton } from '@/ui/Card'
import { Dialog } from '@/ui/Dialog'
import { DescriptionList, PageHeader } from '@/ui/PageHeader'
import { couponConditions, couponOffer } from '../coupons'
import { formatActivity, openContact } from '../leads'
import { useSeller } from '../seller'

const STATUS = {
  abandoned: { label: 'Abandoned', tone: 'danger' },
  active: { label: 'Shopping now', tone: 'success' },
}
const KIND_LABELS = { cart_reminder: 'Cart reminder', follow_up: 'Follow-up', offer: 'Offer' }
const TIP_KEY = 'leads-tip-dismissed'

export default function LeadDetailPage() {
  const seller = useSeller()
  const { userId } = useParams()
  const qc = useQueryClient()
  const { data: lead, isLoading } = useQuery({ queryKey: seller.keys.lead(userId), queryFn: () => seller.api.lead(userId) })
  const [offerOpen, setOfferOpen] = useState(false)
  const [tip, setTip] = useState(() => !storage.get(TIP_KEY))

  const contact = useMutation({
    mutationFn: ({ channel, couponId }) => openContact(channel, () => seller.api.contactLead(userId, { channel, ...(couponId ? { couponId } : {}) })),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: seller.keys.lead(userId) })
      qc.invalidateQueries({ queryKey: [...seller.keys.all, 'leads'] })
      setOfferOpen(false)
      toast.success(res.channel === 'sms' ? 'Opening your messages app' : 'Opening WhatsApp', {
        description: 'Nothing opened? Copy the message and send it yourself.',
        action: { label: 'Copy message', onClick: () => navigator.clipboard?.writeText(res.message) },
      })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  if (isLoading || !lead) return <Skeleton className="h-96" />
  const { customer, cart } = lead
  const status = STATUS[lead.status]

  return (
    <>
      <PageHeader
        back={{ to: `${seller.base}/leads`, label: 'Leads' }}
        title={customer.name || formatPhone(customer.phone) || 'Customer'}
        meta={status ? <Badge tone={status.tone}>{status.label}</Badge> : <Badge tone="info">WhatsApp lead</Badge>}
      />

      {tip && lead.canContact && (
        <div className="mb-6 flex items-center gap-3 rounded-lg bg-primary px-4 py-3 text-sm text-white">
          <Lightbulb className="size-5 shrink-0" />
          <p className="flex-1">Send a reminder to your customer and help them place an order.</p>
          <Button
            size="sm"
            variant="outline"
            className="border-white/70 bg-transparent text-white hover:bg-white/10"
            onClick={() => {
              storage.set(TIP_KEY, true)
              setTip(false)
            }}
          >
            Okay
          </Button>
        </div>
      )}

      <Card className="mb-6">
        <div className="grid divide-y divide-slate-100 sm:grid-cols-4 sm:divide-x sm:divide-y-0">
          <Stat label="Current status" value={status ? <Badge tone={status.tone}>{status.label}</Badge> : <span className="text-slate-500">No cart</span>} />
          <Stat label="Contact" value={customer.phone ? formatPhone(customer.phone) : (customer.email ?? '—')} />
          <Stat label="Total cart amount" value={formatINR(cart?.total ?? 0)} />
          <Stat label="Total items in cart" value={cart?.itemCount ?? 0} />
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          {cart ? (
            <Card>
              <CardHeader title="Items" description={`Your products in their cart · last updated ${formatActivity(cart.updatedAt)}`} />
              <ul className="divide-y divide-slate-100">
                {cart.items.map((i) => (
                  <li key={`${i.productId}-${i.variant ?? ''}`} className="flex items-center gap-3 px-5 py-3">
                    <Thumb src={i.image} className="size-12 shrink-0 rounded-md border border-slate-200" />
                    <div className="min-w-0 flex-1">
                      <a href={`/p/${i.slug}`} target="_blank" rel="noreferrer" className="block truncate font-medium text-slate-900 hover:underline">
                        {i.name}
                      </a>
                      <p className="text-xs text-slate-500">
                        {i.variant ? `${i.variant} · ` : ''}
                        {i.quantity} × {formatINR(i.unitPrice)}
                        {i.pricing.source === 'bulk' && ' · bulk price'}
                        {i.pricing.source === 'quote' && ' · quoted price'}
                      </p>
                      {i.issue && <p className="text-xs font-medium text-amber-700">{ISSUES[i.issue] ?? 'Needs attention'}</p>}
                    </div>
                    <span className="tabular font-medium text-slate-900">{formatINR(i.lineTotal)}</span>
                  </li>
                ))}
              </ul>
              <dl className="flex flex-col gap-1.5 border-t border-slate-200 px-5 py-4 text-sm">
                <Row label="Item total" value={formatINR(cart.subtotal)} />
                <Row label="Delivery charge" value={cart.delivery ? formatINR(cart.delivery) : 'Free'} />
                <Row label="Total amount" value={formatINR(cart.total)} strong />
              </dl>
            </Card>
          ) : (
            <Card>
              <EmptyState
                icon={MessageCircle}
                title="Nothing in their cart"
                description="They asked about your products on WhatsApp but haven't added any to their cart."
              />
            </Card>
          )}

          {lead.whatsapp && (
            <Card>
              <CardHeader
                title="Asked on WhatsApp about"
                description={`${pluralize(lead.whatsapp.clicks, 'chat tap')} · last ${formatRelative(lead.whatsapp.lastAt)}`}
              />
              <ul className="divide-y divide-slate-100">
                {lead.whatsapp.products.map((p) => (
                  <li key={p.product} className="flex items-center gap-3 px-5 py-3">
                    <Thumb src={p.image} className="size-10 shrink-0 rounded-md border border-slate-200" />
                    <a href={`/p/${p.slug}`} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-medium text-slate-900 hover:underline">
                      {p.name}
                    </a>
                    <span className="text-xs text-slate-500">{formatActivity(p.at)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card>
            <CardHeader title="Customer details" />
            <CardBody>
              <DescriptionList
                items={[
                  ['Name', customer.name],
                  ['Mobile', customer.phone && formatPhone(customer.phone)],
                  ['Email', customer.email],
                  ['Buyer type', customer.business ? `Business · ${customer.business.name}` : 'Individual'],
                  ['GSTIN', customer.business?.gstin && <span className="font-mono">{customer.business.gstin}</span>],
                  ['Area', lead.area ? `${lead.area.city}, ${lead.area.state} ${lead.area.pincode}` : '—'],
                  ['Customer since', formatDate(customer.memberSince)],
                ]}
              />
              <p className="mt-4 text-xs text-slate-500">The full delivery address is shared once they order from you.</p>
            </CardBody>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Connect with customer now" />
            {lead.canContact ? (
              <ul className="divide-y divide-slate-100">
                <ConnectAction
                  icon={MessageCircle}
                  iconClass="text-emerald-600"
                  label={cart ? 'Send reminder on WhatsApp' : 'Follow up on WhatsApp'}
                  disabled={contact.isPending}
                  onClick={() => contact.mutate({ channel: 'whatsapp' })}
                />
                <ConnectAction
                  icon={MessageSquareText}
                  iconClass="text-sky-600"
                  label={cart ? 'Send reminder on SMS' : 'Follow up on SMS'}
                  hint="Opens your phone's messages app"
                  disabled={contact.isPending}
                  onClick={() => contact.mutate({ channel: 'sms' })}
                />
                <ConnectAction
                  icon={TicketPercent}
                  iconClass="text-violet-600"
                  label="Share offer"
                  hint="Send one of your coupons on WhatsApp"
                  onClick={() => setOfferOpen(true)}
                />
              </ul>
            ) : (
              <CardBody>
                <Alert tone="neutral">This customer signed up with email and hasn't added a mobile number yet.</Alert>
              </CardBody>
            )}
          </Card>

          <Card>
            <CardHeader title="Messages sent" />
            <CardBody>
              {lead.contacts.length ? (
                <ol className="flex flex-col gap-3 text-sm">
                  {lead.contacts.map((c, k) => (
                    <li key={k} className="flex items-start justify-between gap-3">
                      <span className="text-slate-800">
                        {KIND_LABELS[c.kind]} on {c.channel === 'sms' ? 'SMS' : 'WhatsApp'}
                        {c.couponCode && <span className="ml-1 font-mono text-xs text-slate-500">{c.couponCode}</span>}
                      </span>
                      <span className="shrink-0 text-xs text-slate-500">{formatRelative(c.at)}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-slate-500">You haven't contacted this customer yet.</p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <ShareOfferDialog
        open={offerOpen}
        onOpenChange={setOfferOpen}
        sending={contact.isPending}
        onShare={(couponId) => contact.mutate({ channel: 'whatsapp', couponId })}
      />
    </>
  )
}

const ISSUES = {
  out_of_stock: 'Out of stock',
  exceeds_stock: 'More than you have in stock',
  below_moq: 'Below your minimum order quantity',
  unavailable: 'No longer listed',
  quote_expired: 'Quoted price expired',
  quote_in_order: 'Quote already ordered',
}

function Stat({ label, value }) {
  return (
    <div className="px-5 py-4">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <div className="mt-1 font-display text-lg font-semibold text-slate-900">{value}</div>
    </div>
  )
}

function Row({ label, value, strong }) {
  return (
    <div className={cn('flex justify-between gap-4', strong ? 'pt-1 text-base font-bold text-slate-900' : 'text-slate-600')}>
      <dt>{label}</dt>
      <dd className="tabular">{value}</dd>
    </div>
  )
}

function ConnectAction({ icon: Icon, iconClass, label, hint, onClick, disabled }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-slate-50 disabled:opacity-60"
      >
        <Icon className={cn('size-5 shrink-0', iconClass)} />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-primary">{label}</span>
          {hint && <span className="block text-xs text-slate-500">{hint}</span>}
        </span>
        <ChevronRight className="size-4 text-slate-400" />
      </button>
    </li>
  )
}

function ShareOfferDialog({ open, onOpenChange, onShare, sending }) {
  const seller = useSeller()
  const [selected, setSelected] = useState(null)
  const params = { status: 'usable', limit: 50, page: 1 }
  const { data, isLoading } = useQuery({ queryKey: seller.keys.coupons(params), queryFn: () => seller.api.coupons(params), enabled: open })
  const coupons = data?.items ?? []

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Share an offer"
      description="Pick one of your live coupons. It's sent on WhatsApp with the code and a link to shop."
      footer={
        coupons.length > 0 && (
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button loading={sending} disabled={!selected} onClick={() => onShare(selected)}>
              <MessageCircle /> Share on WhatsApp
            </Button>
          </>
        )
      }
    >
      {isLoading ? (
        <Skeleton className="h-32" />
      ) : coupons.length ? (
        <div role="radiogroup" className="flex flex-col gap-2">
          {coupons.map((c) => (
            <label
              key={c._id}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 transition-colors',
                selected === c._id ? 'border-primary bg-primary-soft' : 'border-slate-200 hover:bg-slate-50',
              )}
            >
              <input
                type="radio"
                name="coupon"
                className="mt-1 accent-[var(--color-primary)]"
                checked={selected === c._id}
                onChange={() => setSelected(c._id)}
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-mono font-semibold text-slate-900">{c.code}</span>
                  <span className="font-medium text-slate-800">{couponOffer(c)}</span>
                </span>
                {c.description && <span className="block text-sm text-slate-600">{c.description}</span>}
                <span className="block text-xs text-slate-500">{couponConditions(c)}</span>
              </span>
            </label>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={TicketPercent}
          title="No live coupons"
          description="Create a coupon first, then share it with this customer."
          action={
            <Button asChild variant="outline">
              <Link to={`${seller.base}/coupons`}>Create a coupon</Link>
            </Button>
          }
        />
      )}
    </Dialog>
  )
}
