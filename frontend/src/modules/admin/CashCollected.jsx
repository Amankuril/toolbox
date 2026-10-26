import { useQueryClient } from '@tanstack/react-query'
import { Banknote } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { errorMessage } from '@/core/api/errors'
import { formatINR } from '@/core/lib/format'
import { Button } from '@/ui/Button'
import { ConfirmDialog } from '@/ui/Dialog'
import { adminApi, adminKeys } from './api'

/** Cash still to come in: cash on delivery, or the balance of a part payment. */
export const cashDue = (o) =>
  !['pending_payment', 'cancelled'].includes(o.status) &&
  ((o.payment.method === 'cod' && o.payment.status === 'pending') || (o.payment.method === 'partial' && o.payment.status === 'partially_paid'))

const amountDue = (o) => (o.payment.method === 'partial' ? (o.amounts.balanceDue ?? 0) : o.amounts.total - (o.amounts.refunded ?? 0))

/** "Mark cash collected" for one order, with a confirmation. */
export function CashCollectedButton({ order, size = 'sm', variant = 'outline', className }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  if (!cashDue(order)) return null
  const confirm = async () => {
    try {
      const updated = await adminApi.markCashCollected(order._id)
      qc.setQueryData(adminKeys.order(order._id), updated)
      qc.invalidateQueries({ queryKey: ['admin', 'orders'] })
      toast.success(`Cash collected for ${order.orderNumber}`)
    } catch (err) {
      toast.error(errorMessage(err))
      throw err
    }
  }
  return (
    <>
      <Button
        size={size}
        variant={variant}
        className={className}
        onClick={(e) => {
          e.stopPropagation()
          setOpen(true)
        }}
      >
        <Banknote /> Cash collected
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        tone="primary"
        title={`Mark ${formatINR(amountDue(order))} collected?`}
        description={`Order ${order.orderNumber} is marked paid. Do this once the courier or seller has handed over the cash.`}
        confirmLabel="Mark collected"
        onConfirm={confirm}
      />
    </>
  )
}
