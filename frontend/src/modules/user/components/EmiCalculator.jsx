import { CalendarClock, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { emiPlans, lowestEmi } from '@/core/lib/emi'
import { cn } from '@/core/lib/cn'
import { formatINR } from '@/core/lib/format'
import { usePublicSettings } from '@/core/settings/usePublicSettings'
import { Dialog } from '@/ui/Dialog'
import { PriceInput } from '@/ui/inputs'

/** Plans for an amount: monthly instalment, interest and total per tenure. */
export function EmiTable({ amount, payments }) {
  const plans = emiPlans(amount, payments)
  if (!plans.length) {
    return <p className="py-6 text-center text-sm text-slate-500">EMI is available on orders of {formatINR(payments?.emiMinOrderValue ?? 0, { whole: true })} or more.</p>
  }
  return (
    <div className="overflow-x-auto rounded-md border border-slate-200">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-600">
          <tr>
            <th className="px-3 py-2">Tenure</th>
            <th className="px-3 py-2 text-right">Monthly EMI</th>
            <th className="px-3 py-2 text-right">Interest</th>
            <th className="px-3 py-2 text-right">Total cost</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {plans.map((p) => (
            <tr key={p.months}>
              <td className="px-3 py-2">
                {p.months} months
                {p.noCost ? (
                  <span className="ml-1.5 rounded-sm bg-emerald-50 px-1.5 text-xs font-semibold text-emerald-700">No-cost</span>
                ) : (
                  <span className="ml-1.5 text-xs text-slate-500">@ {p.rate}% p.a.</span>
                )}
              </td>
              <td className="tabular px-3 py-2 text-right font-semibold text-slate-900">{formatINR(p.monthly, { whole: true })}</td>
              <td className="tabular px-3 py-2 text-right text-slate-600">{formatINR(p.interest, { whole: true })}</td>
              <td className="tabular px-3 py-2 text-right text-slate-600">{formatINR(p.total, { whole: true })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Change the amount and see the plans: the product price to start with. */
export function EmiCalculator({ initialAmount, payments }) {
  const [amount, setAmount] = useState(initialAmount)
  return (
    <div className="space-y-4">
      <label className="block text-sm font-semibold text-slate-900">
        Amount
        <PriceInput value={amount} onChange={(v) => setAmount(v ?? 0)} className="mt-1.5" />
      </label>
      <input
        type="range"
        min={Math.max(100_00, payments?.emiMinOrderValue ?? 0)}
        max={Math.max(initialAmount * 3, 10_00_000_00 / 100)}
        step={500_00}
        value={amount}
        onChange={(e) => setAmount(Number(e.target.value))}
        aria-label="Amount"
        className="w-full accent-[var(--tb-primary)]"
      />
      <EmiTable amount={amount} payments={payments} />
      <p className="text-xs leading-relaxed text-slate-500">
        Pay with a credit card, debit card or cardless EMI at checkout (powered by Razorpay). Your bank sets the final interest rate and may charge a processing fee; GST applies on
        interest.
      </p>
    </div>
  )
}

/** "EMI from ₹X/month · View plans" under a price. Nothing when EMI isn't offered for it. */
export function EmiLine({ price, className }) {
  const { data: settings } = usePublicSettings()
  const [open, setOpen] = useState(false)
  const payments = settings?.payments
  const low = lowestEmi(price, payments)
  if (!low) return null
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cn('flex items-center gap-1.5 text-left text-xs text-slate-700 hover:text-slate-900 sm:text-sm', className)}>
        <CalendarClock className="size-4 shrink-0 text-primary" />
        <span>
          EMI from <strong className="text-slate-900">{formatINR(low.monthly, { whole: true })}/month</strong>
          {payments.noCostMonths?.length > 0 && <span className="ml-1 font-semibold text-emerald-700">· No-cost EMI available</span>}
        </span>
        <span className="flex items-center font-semibold text-primary">
          Plans <ChevronRight className="size-3.5" />
        </span>
      </button>
      <Dialog open={open} onOpenChange={setOpen} title="EMI calculator" description="See your monthly instalment for each tenure.">
        {open && <EmiCalculator initialAmount={price} payments={payments} />}
      </Dialog>
    </>
  )
}
