import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileText } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { parseApiError } from '@/core/api/errors'
import { formatINR, formatNumber } from '@/core/lib/format'
import { Button } from '@/ui/Button'
import { Alert } from '@/ui/Card'
import { Dialog } from '@/ui/Dialog'
import { Field, Input, Textarea } from '@/ui/Field'
import { NumberInput, PriceInput } from '@/ui/inputs'
import { storeKeys, userApi } from '../api'
import { unitPlural } from '@/core/lib/units'

const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)

/**
 * Request for quote: the buyer states quantity (and optionally a target price and date);
 * the seller replies with a price valid for a few days. Accepting puts it in the cart.
 */
export function QuoteRequestDialog({ open, onOpenChange, product }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const threshold = product.quotes.threshold
  const unit = product.inventory.unit
  const { data: addresses } = useQuery({ queryKey: storeKeys.addresses, queryFn: userApi.addresses, enabled: open })
  const defaultPincode = addresses?.find((a) => a.isDefault)?.pincode ?? addresses?.[0]?.pincode ?? ''
  const [v, setV] = useState({ quantity: threshold, targetUnitPrice: undefined, requiredBy: '', pincode: null, note: '' })
  const pincode = v.pincode ?? defaultPincode
  const set = (patch) => setV((cur) => ({ ...cur, ...patch }))

  const submit = useMutation({
    mutationFn: () =>
      userApi.requestQuote({
        productId: product._id,
        quantity: v.quantity,
        targetUnitPrice: v.targetUnitPrice || undefined,
        requiredBy: v.requiredBy || undefined,
        pincode,
        note: v.note.trim() || undefined,
      }),
    onSuccess: (quote) => {
      qc.invalidateQueries({ queryKey: ['user', 'quotes'] })
      onOpenChange(false)
      toast.success('Quote requested', { description: 'The seller will reply with a price. We’ll show it in your quotes.' })
      navigate(`/account/quotes/${quote._id}`)
    },
  })
  const error = submit.error && parseApiError(submit.error)
  const existing = error?.code === 'QUOTE_ALREADY_OPEN' ? error.details?.quoteId : null
  const invalidQty = !v.quantity || v.quantity < threshold

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Request a bulk quote"
      description={product.name}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={submit.isPending} disabled={invalidQty || !/^[1-9]\d{5}$/.test(pincode)} onClick={() => submit.mutate()}>
            <FileText /> Send request
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-slate-600">
          For {formatNumber(threshold)}+ {unitPlural(unit, 2)}. Listed at {formatINR(product.pricing.price)} each; the seller can offer a better price for volume.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Quantity" required error={invalidQty ? `At least ${formatNumber(threshold)}` : error?.fields?.quantity}>
            {(p) => <NumberInput {...p} min={threshold} value={v.quantity} onChange={(quantity) => set({ quantity })} />}
          </Field>
          <Field label="Target price per unit" hint="Optional" error={error?.fields?.targetUnitPrice}>
            {(p) => <PriceInput {...p} value={v.targetUnitPrice} onChange={(targetUnitPrice) => set({ targetUnitPrice })} />}
          </Field>
          <Field label="Needed by" hint="Optional">
            {(p) => <Input {...p} type="date" min={tomorrow()} value={v.requiredBy} onChange={(e) => set({ requiredBy: e.target.value })} />}
          </Field>
          <Field label="Delivery pincode" required>
            {(p) => <Input {...p} inputMode="numeric" maxLength={6} value={pincode} onChange={(e) => set({ pincode: e.target.value.replace(/\D/g, '') })} />}
          </Field>
        </div>
        <Field label="Details for the seller" hint="Delivery schedule, specs, packaging, payment terms…">
          {(p) => <Textarea {...p} rows={3} maxLength={1000} value={v.note} onChange={(e) => set({ note: e.target.value })} />}
        </Field>
        {error && !Object.keys(error.fields).length && (
          <Alert
            tone={existing ? 'info' : 'danger'}
            action={
              existing && (
                <Button size="sm" variant="outline" onClick={() => navigate(`/account/quotes/${existing}`)}>
                  View it
                </Button>
              )
            }
          >
            {error.message}
          </Alert>
        )}
      </div>
    </Dialog>
  )
}
