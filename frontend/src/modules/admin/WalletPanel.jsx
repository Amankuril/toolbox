import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Minus, Plus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { errorMessage } from '@/core/api/errors'
import { cn } from '@/core/lib/cn'
import { formatDateTime, formatINR } from '@/core/lib/format'
import { Button } from '@/ui/Button'
import { Skeleton } from '@/ui/Card'
import { Dialog } from '@/ui/Dialog'
import { Field, Input } from '@/ui/Field'
import { PriceInput } from '@/ui/inputs'
import { adminApi } from './api'

const REASON = {
  topup: 'Added by the customer',
  admin_credit: 'Credit',
  admin_debit: 'Debit',
  order_payment: 'Order payment',
  order_refund: 'Refund',
  order_release: 'Returned (order not completed)',
}

/** A customer's wallet in the customer dialog: balance, recent changes, and a manual credit or debit. */
export function WalletPanel({ userId, canEdit }) {
  const qc = useQueryClient()
  const key = ['admin', 'wallet', userId]
  const { data, isLoading } = useQuery({ queryKey: key, queryFn: () => adminApi.wallet(userId) })
  const [type, setType] = useState(null)
  const [amount, setAmount] = useState()
  const [note, setNote] = useState('')
  const adjust = useMutation({
    mutationFn: () => adminApi.adjustWallet(userId, { type, amount, note: note.trim() || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key })
      qc.invalidateQueries({ queryKey: ['admin', 'users'] })
      toast.success(type === 'credit' ? 'Wallet credited' : 'Wallet debited')
      setType(null)
      setAmount(undefined)
      setNote('')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  if (isLoading) return <Skeleton className="h-24" />
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">
          Wallet <span className="tabular ml-1 text-base text-primary">{formatINR(data.meta.balance)}</span>
        </h3>
        {canEdit && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setType('credit')}>
              <Plus /> Add money
            </Button>
            <Button size="sm" variant="ghost" disabled={!data.meta.balance} onClick={() => setType('debit')}>
              <Minus /> Deduct
            </Button>
          </div>
        )}
      </div>
      {data.items.length ? (
        <ul className="max-h-48 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200 text-sm">
          {data.items.map((t) => (
            <li key={t._id} className="flex items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="text-slate-800">{REASON[t.reason] ?? t.reason}</span>
                <span className="block text-xs text-slate-500">
                  {formatDateTime(t.createdAt)}
                  {t.orderNumber && ` · ${t.orderNumber}`}
                  {t.note && ` · ${t.note}`}
                </span>
              </span>
              <span className={cn('tabular font-semibold', t.type === 'credit' ? 'text-emerald-700' : 'text-slate-900')}>
                {t.type === 'credit' ? '+' : '−'}
                {formatINR(t.amount)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-500">No wallet activity.</p>
      )}
      <Dialog
        open={Boolean(type)}
        onOpenChange={(o) => !o && setType(null)}
        size="sm"
        title={type === 'credit' ? 'Add money to wallet' : 'Deduct from wallet'}
        footer={
          <>
            <Button variant="outline" onClick={() => setType(null)}>
              Cancel
            </Button>
            <Button loading={adjust.isPending} disabled={!(amount >= 100)} onClick={() => adjust.mutate()}>
              {type === 'credit' ? 'Add' : 'Deduct'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Amount">{(p) => <PriceInput {...p} value={amount} onChange={setAmount} />}</Field>
          <Field label="Note" hint="Shown to the customer in their wallet history">
            {(p) => <Input {...p} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={type === 'credit' ? 'e.g. Goodwill for the late delivery' : 'e.g. Correction'} />}
          </Field>
        </div>
      </Dialog>
    </div>
  )
}

/** The same credit for every ticked customer. */
export function BulkWalletCredit({ open, onOpenChange, users, onDone }) {
  const [amount, setAmount] = useState()
  const [note, setNote] = useState('')
  const qc = useQueryClient()
  const credit = useMutation({
    mutationFn: () => adminApi.bulkCreditWallets({ userIds: users.map((u) => u._id), amount, note: note.trim() || undefined }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['admin'] })
      toast.success(`Added ${formatINR(amount)} to ${res.credited} wallet${res.credited === 1 ? '' : 's'}`)
      onOpenChange(false)
      onDone?.()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title="Add money to wallets"
      description={`Each of the ${users.length} selected customers gets this amount.`}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={credit.isPending} disabled={!(amount >= 100)} onClick={() => credit.mutate()}>
            Add to {users.length} wallet{users.length === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Amount each">{(p) => <PriceInput {...p} value={amount} onChange={setAmount} />}</Field>
        <Field label="Note" hint="Shown in their wallet history">
          {(p) => <Input {...p} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />}
        </Field>
      </div>
    </Dialog>
  )
}
