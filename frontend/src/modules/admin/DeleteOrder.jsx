import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { errorMessage } from '@/core/api/errors'
import { ConfirmDialog } from '@/ui/Dialog'
import { Input } from '@/ui/Field'
import { adminApi } from './api'

/**
 * Permanently deletes an order after the admin types its number. Controlled: `order` set = open.
 * Nothing is reversed (stock, payments, refunds, coupon and wallet use stay as they are).
 */
export function DeleteOrderDialog({ order, onClose, onDeleted }) {
  const qc = useQueryClient()
  const [typed, setTyped] = useState('')
  const matches = order && typed.trim().toUpperCase() === order.orderNumber.toUpperCase()

  return (
    <ConfirmDialog
      key={order?._id}
      open={Boolean(order)}
      onOpenChange={(v) => {
        if (!v) {
          setTyped('')
          onClose()
        }
      }}
      title={order ? `Delete order ${order.orderNumber}?` : ''}
      description="This permanently removes the order for everyone: you, the seller and the customer. It cannot be undone."
      confirmLabel="Delete order"
      onConfirm={async () => {
        if (!matches) {
          toast.error('Type the order number to confirm')
          throw new Error('not confirmed')
        }
        try {
          await adminApi.deleteOrder(order._id)
          toast.success(`Order ${order.orderNumber} deleted`)
          setTyped('')
          qc.invalidateQueries({ queryKey: ['admin', 'orders'] })
          qc.removeQueries({ queryKey: ['admin', 'order', order._id] })
          onDeleted?.()
        } catch (err) {
          toast.error(errorMessage(err))
          throw err
        }
      }}
    >
      <div className="flex flex-col gap-3 text-sm">
        <ul className="list-disc space-y-1 rounded-md border border-amber-200 bg-amber-50 py-2.5 pr-3 pl-7 text-amber-900">
          <li>Its invoices, shipments and payment records are deleted too.</li>
          <li>Stock is not returned and money is not refunded. Cancel the items first if you need that.</li>
        </ul>
        <label className="flex flex-col gap-1.5">
          <span className="font-medium text-slate-700">
            Type <span className="font-mono font-semibold">{order?.orderNumber}</span> to confirm
          </span>
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
        </label>
      </div>
    </ConfirmDialog>
  )
}
