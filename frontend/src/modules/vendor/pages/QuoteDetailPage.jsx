import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, Send } from 'lucide-react'
import { useState } from 'react'
import { useParams } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/core/api/errors'
import { formatINR, formatNumber } from '@/core/lib/format'
import { unitPlural } from '@/core/lib/units'
import { OfferBreakdown, QuoteRequestFacts, QuoteStatus, QuoteTimeline } from '@/modules/shared/quotes'
import { Button } from '@/ui/Button'
import { Alert, Card, CardBody, CardHeader, Skeleton } from '@/ui/Card'
import { SegmentedControl } from '@/ui/Controls'
import { Field, Textarea } from '@/ui/Field'
import { PriceInput } from '@/ui/inputs'
import { DescriptionList, PageHeader } from '@/ui/PageHeader'
import { ReasonDialog } from '@/ui/ReasonDialog'
import { useSeller } from '../seller'

const VALIDITY = [3, 7, 14, 30].map((d) => ({ value: d, label: `${d} days` }))

export default function VendorQuoteDetailPage() {
  const seller = useSeller()
  const { id } = useParams()
  const qc = useQueryClient()
  const { data: q, isLoading } = useQuery({ queryKey: seller.keys.quote(id), queryFn: () => seller.api.quote(id) })
  const [revising, setRevising] = useState(false)

  const onSaved = (message) => (updated) => {
    qc.setQueryData(seller.keys.quote(id), updated)
    qc.invalidateQueries({ queryKey: [...seller.keys.all, 'quotes'] })
    setRevising(false)
    toast.success(message)
  }
  const decline = useMutation({
    mutationFn: (reason) => seller.api.declineQuote(id, { reason }),
    onSuccess: onSaved('Request declined'),
    onError: (e) => toast.error(errorMessage(e)),
  })

  if (isLoading || !q) return <Skeleton className="h-96" />
  const canOffer = q.status === 'requested' || q.status === 'expired' || (q.status === 'quoted' && revising)

  return (
    <>
      <PageHeader back={{ to: `${seller.base}/quotes`, label: 'Quote requests' }} title={`Request ${q.number}`} meta={<QuoteStatus status={q.status} />} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card>
            <CardHeader title="What they need" />
            <CardBody>
              <QuoteRequestFacts quote={q} />
            </CardBody>
          </Card>

          {q.offer && !canOffer && (
            <Card>
              <CardHeader
                title="Your offer"
                action={
                  q.status === 'quoted' && (
                    <Button variant="outline" size="sm" onClick={() => setRevising(true)}>
                      Revise offer
                    </Button>
                  )
                }
              />
              <CardBody>
                <OfferBreakdown quote={q} />
                {q.status === 'accepted' && (
                  <Alert tone="success" className="mt-4">
                    The buyer accepted. It’s in their cart at your price until the offer expires.
                  </Alert>
                )}
                {q.status === 'ordered' && (
                  <Alert tone="success" className="mt-4">
                    Ordered — you’ll find it in Orders.
                  </Alert>
                )}
              </CardBody>
            </Card>
          )}

          {canOffer && (
            <OfferForm
              quote={q}
              onSaved={onSaved(q.offer ? 'Revised offer sent' : 'Quote sent to the buyer')}
              onCancel={q.status === 'quoted' ? () => setRevising(false) : null}
            />
          )}

          {q.status === 'declined' && (
            <Alert tone="neutral" title="You declined this request">
              {q.declineReason}
            </Alert>
          )}
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Buyer" />
            <CardBody>
              <DescriptionList
                className="sm:grid-cols-1"
                items={[
                  ['Name', q.buyer?.name],
                  ['Business', q.buyer?.businessName ?? (q.buyer?.accountType === 'business' ? '—' : 'Individual buyer')],
                  ['GSTIN', q.buyer?.gstin && <span className="font-mono">{q.buyer.gstin}</span>],
                  ['Deliver to pincode', q.pincode],
                ]}
              />
              <p className="mt-4 text-xs text-slate-500">Contact details are shared once an order is placed.</p>
            </CardBody>
          </Card>
          {['requested', 'quoted'].includes(q.status) && (
            <ReasonDialog
              title="Decline this request"
              description="The buyer sees your reason. Be specific so they can adjust, e.g. a smaller quantity or later date."
              label="Reason"
              confirmLabel="Decline request"
              onSubmit={(reason) => decline.mutateAsync(reason)}
              trigger={
                <Button variant="danger-outline">
                  <Ban /> Decline request
                </Button>
              }
            />
          )}
          <Card>
            <CardHeader title="History" />
            <CardBody>
              <QuoteTimeline history={q.history} />
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  )
}

function OfferForm({ quote, onSaved, onCancel }) {
  const seller = useSeller()
  const [unitPrice, setUnitPrice] = useState(quote.offer?.unitPrice ?? quote.targetUnitPrice ?? undefined)
  const [validDays, setValidDays] = useState(7)
  const [note, setNote] = useState(quote.offer?.note ?? '')
  const send = useMutation({
    mutationFn: () => seller.api.sendOffer(quote._id, { unitPrice, validDays, note: note.trim() || undefined }),
    onSuccess: onSaved,
    onError: (e) => toast.error(errorMessage(e)),
  })
  const list = quote.product.basePrice
  const total = unitPrice ? unitPrice * quote.quantity : 0
  const discount = unitPrice && list ? Math.round(((list - unitPrice) / list) * 100) : 0

  return (
    <Card>
      <CardHeader title={quote.offer ? 'Revise your offer' : 'Send a quote'} description="Prices include GST, like your listed prices." />
      <CardBody className="flex flex-col gap-5">
        <div className="grid gap-5 sm:grid-cols-[1fr_auto]">
          <Field
            label={`Price per ${quote.product.unit ?? 'unit'}`}
            required
            hint={`Listed at ${formatINR(list)}${quote.targetUnitPrice ? ` · buyer's target ${formatINR(quote.targetUnitPrice)}` : ''}`}
          >
            {(p) => <PriceInput {...p} value={unitPrice} onChange={setUnitPrice} />}
          </Field>
          <div>
            <p className="mb-1.5 text-sm font-medium text-slate-800">Offer valid for</p>
            <SegmentedControl value={validDays} onChange={setValidDays} options={VALIDITY} />
          </div>
        </div>
        {unitPrice > 0 && (
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-lg bg-slate-50 px-4 py-3 text-sm">
            <span className="tabular text-base font-semibold text-slate-900">{formatINR(total)}</span>
            <span className="text-slate-600">
              for {formatNumber(quote.quantity)} {unitPlural(quote.product.unit, quote.quantity)}
            </span>
            {discount > 0 && <span className="font-medium text-accent-ink">{discount}% below your listed price</span>}
            {discount < 0 && <span className="font-medium text-amber-700">Above your listed price</span>}
          </div>
        )}
        <Field label="Note to the buyer" hint="Delivery time, freight, payment terms…">
          {(p) => <Textarea {...p} rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
        <p className="text-xs text-slate-500">
          Make sure your stock covers {formatNumber(quote.quantity)} {unitPlural(quote.product.unit, quote.quantity)}: stock is checked again when the buyer
          checks out.
        </p>
        <div className="flex justify-end gap-2">
          {onCancel && (
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button loading={send.isPending} disabled={!unitPrice} onClick={() => send.mutate()}>
            <Send /> {quote.offer ? 'Send revised offer' : 'Send quote'}
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}
