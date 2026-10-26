import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDownLeft, ArrowUpRight, Plus, Wallet } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/core/api/errors'
import { cn } from '@/core/lib/cn'
import { formatDateTime, formatINR } from '@/core/lib/format'
import { openRazorpayCheckout } from '@/core/payments/razorpay'
import { useBranding, usePublicSettings } from '@/core/settings/usePublicSettings'
import { Button } from '@/ui/Button'
import { Card, CardBody, Skeleton } from '@/ui/Card'
import { Pagination } from '@/ui/DataTable'
import { PriceInput } from '@/ui/inputs'
import { storeKeys, userApi } from '../../api'

const PRESETS = [500_00, 1000_00, 2000_00, 5000_00]
const REASON = {
  topup: 'Money added',
  admin_credit: 'Credit from the store',
  admin_debit: 'Adjustment by the store',
  order_payment: 'Paid for an order',
  order_refund: 'Refund for a cancelled item',
  order_release: 'Returned: order not completed',
}

/** The buyer's wallet: balance, add money (online), and every change. */
export default function WalletPage() {
  const qc = useQueryClient()
  const { siteName } = useBranding()
  const { data: settings } = usePublicSettings()
  const [page, setPage] = useState(1)
  const [amount, setAmount] = useState(1000_00)
  const { data, isLoading } = useQuery({ queryKey: storeKeys.wallet({ page }), queryFn: () => userApi.wallet({ page, limit: 15 }), placeholderData: keepPreviousData })
  const balance = data?.meta?.balance ?? 0
  const canTopUp = settings?.payments?.razorpayEnabled

  const topup = useMutation({
    mutationFn: async () => {
      const payment = await userApi.topupWallet(amount)
      const result = await openRazorpayCheckout({
        payment,
        name: siteName,
        description: 'Add money to wallet',
        color: getComputedStyle(document.documentElement).getPropertyValue('--tb-primary').trim() || undefined,
      })
      if (result.status !== 'paid') return null
      return userApi.verifyTopup({ providerOrderId: result.providerOrderId, paymentId: result.paymentId, signature: result.signature })
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['user', 'wallet'] })
      if (res) toast.success(`Added ${formatINR(amount)} to your wallet`)
    },
    onError: (err) => {
      qc.invalidateQueries({ queryKey: ['user', 'wallet'] })
      toast.error(errorMessage(err))
    },
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900">Wallet</h1>
        <p className="text-sm text-slate-600">Pay for orders from your balance, in full or in part. Refunds for wallet payments come back here instantly.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-[1fr_1.3fr]">
        <Card className="bg-secondary text-secondary-fg">
          <CardBody className="flex h-full flex-col justify-between gap-6">
            <span className="flex items-center gap-2 text-sm text-secondary-fg/70">
              <Wallet className="size-4" /> Balance
            </span>
            {isLoading ? <Skeleton className="h-10 w-40 bg-white/20" /> : <p className="price text-4xl">{formatINR(balance)}</p>}
            <Link to="/search" className="text-sm font-semibold text-accent hover:underline">
              Shop now
            </Link>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="space-y-3">
            <p className="font-semibold text-slate-900">Add money</p>
            {canTopUp ? (
              <>
                <div className="flex flex-wrap gap-2">
                  {PRESETS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setAmount(p)}
                      className={cn('rounded-full border px-3 py-1 text-sm font-semibold', amount === p ? 'border-primary bg-primary/10 text-primary' : 'border-slate-300 text-slate-700 hover:border-slate-500')}
                    >
                      {formatINR(p, { whole: true })}
                    </button>
                  ))}
                </div>
                <PriceInput value={amount} onChange={(v) => setAmount(v ?? 0)} aria-label="Amount to add" />
                <Button className="w-full" loading={topup.isPending} disabled={!(amount >= 100_00)} onClick={() => topup.mutate()}>
                  <Plus /> Add {amount >= 100_00 ? formatINR(amount) : ''}
                </Button>
                <p className="text-xs text-slate-500">UPI, cards or net banking. Minimum ₹100.</p>
              </>
            ) : (
              <p className="text-sm text-slate-500">Adding money online isn't available right now.</p>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <ul className="divide-y divide-slate-100">
          {isLoading ? (
            <Skeleton className="m-4 h-40" />
          ) : data?.items.length ? (
            data.items.map((t) => (
              <li key={t._id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <span className={cn('grid size-8 shrink-0 place-items-center rounded-full', t.type === 'credit' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600')}>
                  {t.type === 'credit' ? <ArrowDownLeft className="size-4" /> : <ArrowUpRight className="size-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-slate-900">
                    {REASON[t.reason] ?? t.reason}
                    {t.status === 'pending' && <span className="ml-1.5 text-xs text-amber-700">(waiting for payment)</span>}
                  </span>
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
            ))
          ) : (
            <li className="px-4 py-10 text-center text-sm text-slate-500">No wallet activity yet.</li>
          )}
        </ul>
        <Pagination meta={data?.meta} onPageChange={setPage} />
      </Card>
    </div>
  )
}
