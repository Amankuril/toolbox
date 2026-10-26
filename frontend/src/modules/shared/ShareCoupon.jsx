import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { Check, ChevronLeft, Copy, Send, TicketPercent, Users } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { errorMessage } from '@/core/api/errors'
import { cn } from '@/core/lib/cn'
import { formatPhone } from '@/core/lib/format'
import { Badge } from '@/ui/Badge'
import { Button } from '@/ui/Button'
import { Skeleton } from '@/ui/Card'
import { Dialog } from '@/ui/Dialog'
import { Pagination } from '@/ui/DataTable'
import { SearchField } from '@/ui/SearchField'
import { couponConditions, couponOffer } from '@/modules/vendor/coupons'
import { whatsappLink, WhatsAppIcon } from './whatsapp'

/**
 * Share coupon: pick a coupon, pick customers, send. Each customer finds it under "My coupons" in their account,
 * and gets a one-tap WhatsApp message from here.
 *
 * `client`: { root, coupons(params), customers(params), share(couponId, userIds) }.
 * `users` preselects customers (bulk action on a customer list) and skips choosing them.
 */
export function ShareCouponDialog({ open, onOpenChange, client, users, coupon: presetCoupon }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg" title="Share coupon" description="Send a coupon to customers: it appears in their account, and you can WhatsApp each one.">
      {open && <Flow client={client} presetUsers={users} presetCoupon={presetCoupon} onDone={() => onOpenChange(false)} />}
    </Dialog>
  )
}

function Flow({ client, presetUsers, presetCoupon, onDone }) {
  const [coupon, setCoupon] = useState(presetCoupon ?? null)
  const [chosen, setChosen] = useState(() => new Map((presetUsers ?? []).map((u) => [u._id, u])))
  const [step, setStep] = useState(presetCoupon ? (presetUsers?.length ? 'confirm' : 'users') : 'coupon')
  const send = useMutation({
    mutationFn: () => client.share(coupon._id, [...chosen.keys()]),
    onSuccess: () => setStep('sent'),
    onError: (err) => toast.error(errorMessage(err)),
  })

  if (step === 'sent') return <Sent result={send.data} onDone={onDone} />
  if (step === 'coupon') {
    return (
      <CouponStep
        client={client}
        value={coupon}
        onPick={(c) => {
          setCoupon(c)
          setStep(presetUsers?.length ? 'confirm' : 'users')
        }}
      />
    )
  }
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 rounded-md bg-slate-50 p-3">
        <div className="min-w-0">
          <p className="font-mono font-bold text-slate-900">{coupon.code}</p>
          <p className="text-xs text-slate-600">
            {couponOffer(coupon)} · {couponConditions(coupon)}
          </p>
        </div>
        {!presetCoupon && (
          <Button variant="ghost" size="sm" onClick={() => setStep('coupon')}>
            <ChevronLeft /> Change
          </Button>
        )}
      </div>
      {step === 'users' ? (
        <CustomerStep client={client} chosen={chosen} onChange={setChosen} />
      ) : (
        <p className="flex items-center gap-2 text-sm text-slate-700">
          <Users className="size-4 text-slate-400" /> {chosen.size} customer{chosen.size === 1 ? '' : 's'} selected
        </p>
      )}
      <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
        <Button disabled={!chosen.size} loading={send.isPending} onClick={() => send.mutate()}>
          <Send /> Send to {chosen.size || ''} customer{chosen.size === 1 ? '' : 's'}
        </Button>
      </div>
    </div>
  )
}

function CouponStep({ client, value, onPick }) {
  const { data, isLoading } = useQuery({ queryKey: [...client.root, 'coupons', { status: 'usable', limit: 50 }], queryFn: () => client.coupons({ status: 'usable', limit: 50, page: 1 }) })
  if (isLoading) return <Skeleton className="h-48" />
  if (!data?.items.length) return <p className="py-10 text-center text-sm text-slate-500">No live coupons. Create one first.</p>
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {data.items.map((c) => (
        <li key={c._id}>
          <button
            type="button"
            onClick={() => onPick(c)}
            className={cn(
              'flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:border-primary',
              value?._id === c._id ? 'border-primary bg-primary/5' : 'border-slate-200',
            )}
          >
            <TicketPercent className="mt-0.5 size-5 shrink-0 text-primary" />
            <span className="min-w-0">
              <span className="block font-mono font-bold text-slate-900">{c.code}</span>
              <span className="block text-sm text-slate-700">{couponOffer(c)}</span>
              <span className="block text-xs text-slate-500">{couponConditions(c)}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function CustomerStep({ client, chosen, onChange }) {
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const params = { q: q || undefined, page, limit: 20 }
  const { data, isLoading } = useQuery({ queryKey: [...client.root, 'share-customers', params], queryFn: () => client.customers(params), placeholderData: keepPreviousData })
  const rows = data?.items ?? []
  const toggle = (u) => {
    const next = new Map(chosen)
    if (next.has(u._id)) next.delete(u._id)
    else next.set(u._id, u)
    onChange(next)
  }
  const allOnPage = rows.length > 0 && rows.every((u) => chosen.has(u._id))
  const togglePage = () => {
    const next = new Map(chosen)
    for (const u of rows) {
      if (allOnPage) next.delete(u._id)
      else next.set(u._id, u)
    }
    onChange(next)
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <SearchField
          value={q}
          onChange={(v) => {
            setQ(v)
            setPage(1)
          }}
          placeholder="Name, mobile or email"
        />
        <Button variant="outline" size="sm" disabled={!rows.length} onClick={togglePage}>
          {allOnPage ? 'Clear this page' : 'Select this page'}
        </Button>
        {chosen.size > 0 && <Badge tone="info">{chosen.size} selected</Badge>}
      </div>
      {isLoading ? (
        <Skeleton className="h-64" />
      ) : rows.length ? (
        <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200">
          {rows.map((u) => (
            <li key={u._id}>
              <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-slate-50">
                <input type="checkbox" className="size-4 accent-[var(--tb-primary)]" checked={chosen.has(u._id)} onChange={() => toggle(u)} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-900">{u.name}</span>
                  <span className="block text-xs text-slate-500">{u.phone ? formatPhone(u.phone) : (u.email ?? 'No mobile')}</span>
                </span>
                {u.orders > 0 && <Badge>{u.orders} order{u.orders === 1 ? '' : 's'}</Badge>}
              </label>
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-8 text-center text-sm text-slate-500">No customers found.</p>
      )}
      <Pagination meta={data?.meta} onPageChange={setPage} className="px-0" />
    </div>
  )
}

function Sent({ result, onDone }) {
  const [opened, setOpened] = useState(() => new Set())
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.message)
      toast.success('Message copied')
    } catch {
      toast.error('Could not copy the message')
    }
  }
  return (
    <div className="space-y-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
        <Check className="size-4" /> {result.coupon.code} added to {result.recipients.length} customer account{result.recipients.length === 1 ? '' : 's'}.
      </p>
      <div className="rounded-md bg-[#d9fdd3] p-3 text-sm whitespace-pre-line text-slate-800">{result.message}</div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-slate-600">Tell them on WhatsApp, one tap each:</p>
        <Button variant="ghost" size="sm" onClick={copy}>
          <Copy /> Copy message
        </Button>
      </div>
      <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200">
        {result.recipients.map((u) => (
          <li key={u._id} className="flex items-center gap-3 px-3 py-2">
            <span className="min-w-0 flex-1 text-sm">
              <span className="font-medium text-slate-900">{u.name}</span>
              <span className="ml-2 text-xs text-slate-500">{formatPhone(u.phone)}</span>
            </span>
            {u.phone ? (
              <Button
                asChild
                size="sm"
                variant={opened.has(u._id) ? 'ghost' : 'outline'}
                className="text-[#128c4b]"
              >
                <a
                  href={whatsappLink(u.phone, `Hi ${u.name.split(' ')[0]}! ${result.message}`)}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setOpened((s) => new Set(s).add(u._id))}
                >
                  <WhatsAppIcon /> {opened.has(u._id) ? 'Sent' : 'WhatsApp'}
                </a>
              </Button>
            ) : (
              <span className="text-xs text-slate-400">No mobile</span>
            )}
          </li>
        ))}
      </ul>
      <div className="flex justify-end border-t border-slate-100 pt-4">
        <Button onClick={onDone}>Done</Button>
      </div>
    </div>
  )
}
