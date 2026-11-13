import { useQueryClient } from '@tanstack/react-query'
import { Undo2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { errorMessage } from '@/core/api/errors'
import { formatDateTime, formatINR } from '@/core/lib/format'
import { Button } from '@/ui/Button'
import { Alert } from '@/ui/Card'
import { Dialog } from '@/ui/Dialog'
import { Field, Select, Textarea } from '@/ui/Field'
import { PriceInput } from '@/ui/inputs'
import { adminApi, adminKeys } from './api'

const METHOD_LABEL = {
  gateway: 'Original payment (Razorpay)',
  wallet: "Buyer's wallet",
  offline: 'Paid outside the site (cash / UPI / bank)',
}

/** Refund due banner, refund button and the list of refunds, for the admin order page. */
export function RefundsPanel({ order: o, canManage }) {
  const s = o.refundSummary
  const refunds = o.refunds ?? []
  if (!s) return null
  return (
    <div className="flex flex-col gap-3 border-t border-slate-100 pt-3">
      {s.suggested > 0 && (
        <Alert tone="warning" title={`Refund due: ${formatINR(s.suggested)}`}>
          Paid for items that were cancelled and hasn&apos;t been refunded yet.
        </Alert>
      )}
      {refunds.length > 0 && (
        <div className="flex flex-col gap-1.5 text-xs text-slate-600">
          <p className="eyebrow">Refunds</p>
          {refunds.map((r, k) => (
            <div key={r.providerRefundId ?? `${r.at}-${k}`} className="flex justify-between gap-2">
              <span className="min-w-0">
                {formatDateTime(r.at)} · {r.manual ? (METHOD_LABEL[r.method] ?? r.method) : 'Automatic'} · {r.status}
                {r.note && <span className="block truncate text-slate-500">{r.note}</span>}
              </span>
              <span className="tabular shrink-0 font-semibold text-slate-900">{formatINR(r.amount)}</span>
            </div>
          ))}
        </div>
      )}
      {canManage && s.refundable > 0 && <ManualRefundButton order={o} />}
    </div>
  )
}

function ManualRefundButton({ order: o }) {
  const qc = useQueryClient()
  const s = o.refundSummary
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState()
  const [method, setMethod] = useState('gateway')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const start = () => {
    setAmount(s.suggested || s.refundable)
    setMethod(s.gatewayRefundable > 0 ? 'gateway' : 'wallet')
    setNote('')
    setOpen(true)
  }
  const max = method === 'gateway' ? s.gatewayRefundable : s.refundable
  const tooMuch = amount > max
  const submit = async () => {
    setBusy(true)
    try {
      const updated = await adminApi.refundOrder(o._id, { amount, method, note: note.trim() || undefined })
      qc.setQueryData(adminKeys.order(o._id), updated)
      qc.invalidateQueries({ queryKey: ['admin', 'orders'] })
      toast.success(`${formatINR(amount)} refunded`)
      setOpen(false)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant={s.suggested > 0 ? 'primary' : 'outline'} className="w-full" onClick={start}>
        <Undo2 /> Refund
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={`Refund order ${o.orderNumber}`}
        description="Choose how much to give back and where it goes."
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button loading={busy} disabled={!(amount > 0) || tooMuch} onClick={submit}>
              Refund {amount > 0 ? formatINR(amount) : ''}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-3 gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
            <div>
              <dt className="text-xs text-slate-500">Paid</dt>
              <dd className="tabular font-semibold text-slate-900">{formatINR(s.paid)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Refunded</dt>
              <dd className="tabular font-semibold text-slate-900">{formatINR(s.refunded)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Can refund</dt>
              <dd className="tabular font-semibold text-slate-900">{formatINR(s.refundable)}</dd>
            </div>
          </dl>

          <Field label="Refund to">
            {(p) => (
              <Select {...p} value={method} onChange={(e) => setMethod(e.target.value)}>
                {s.gatewayRefundable > 0 && <option value="gateway">{METHOD_LABEL.gateway}</option>}
                <option value="wallet">{METHOD_LABEL.wallet}</option>
                <option value="offline">{METHOD_LABEL.offline}</option>
              </Select>
            )}
          </Field>

          <Field
            label="Amount"
            hint={
              s.suggested > 0
                ? `Owed for cancelled items: ${formatINR(s.suggested)} · most you can refund here: ${formatINR(max)}`
                : `Most you can refund here: ${formatINR(max)}`
            }
            error={tooMuch ? `At most ${formatINR(max)}` : undefined}
          >
            {(p) => <PriceInput {...p} value={amount} onChange={setAmount} />}
          </Field>

          <Field label="Note" hint="For your team; the buyer doesn't see it.">
            {(p) => (
              <Textarea
                {...p}
                rows={2}
                maxLength={300}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Deducted ₹200 for return shipping"
              />
            )}
          </Field>

          {method === 'gateway' && <p className="text-xs text-slate-500">Razorpay sends it back to the buyer&apos;s card / UPI / bank in 5–7 working days.</p>}
          {method === 'wallet' && <p className="text-xs text-slate-500">Added to the buyer&apos;s wallet instantly; they can spend it on their next order.</p>}
          {method === 'offline' && <p className="text-xs text-slate-500">Only records the refund here. Pay the buyer yourself.</p>}
        </div>
      </Dialog>
    </>
  )
}
