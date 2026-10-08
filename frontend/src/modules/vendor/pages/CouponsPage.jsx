import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, TicketPercent, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { errorMessage, parseApiError } from '@/core/api/errors'
import { useSearchParamsState } from '@/core/hooks/useSearchParamsState'
import { formatDate, formatNumber } from '@/core/lib/format'
import { Badge } from '@/ui/Badge'
import { Button } from '@/ui/Button'
import { Card, EmptyState } from '@/ui/Card'
import { FilterTabs, SegmentedControl, Switch } from '@/ui/Controls'
import { DataTable, Pagination } from '@/ui/DataTable'
import { ConfirmDialog, Dialog } from '@/ui/Dialog'
import { Field, Input } from '@/ui/Field'
import { NumberInput, PriceInput } from '@/ui/inputs'
import { PageHeader } from '@/ui/PageHeader'
import { RowActions } from '@/ui/RowActions'
import { SearchField } from '@/ui/SearchField'
import { COUPON_STATES, couponConditions, couponOffer } from '../coupons'
import { useSeller } from '../seller'

const TABS = [
  { value: '', label: 'All' },
  { value: 'usable', label: 'Live' },
  { value: 'inactive', label: 'Switched off' },
  { value: 'expired', label: 'Expired' },
]

export default function CouponsPage() {
  const seller = useSeller()
  const [filters, setFilters] = useSearchParamsState({ status: '' })
  const [editing, setEditing] = useState(null) // null = closed, {} = new, coupon = edit
  const [removing, setRemoving] = useState(null)
  const qc = useQueryClient()
  const params = { page: Number(filters.page ?? 1), limit: 20, status: filters.status || undefined, q: filters.q || undefined }
  const { data, isLoading } = useQuery({ queryKey: seller.keys.coupons(params), queryFn: () => seller.api.coupons(params), placeholderData: keepPreviousData })
  const nothingYet = !isLoading && data?.meta?.total === 0 && !filters.q && !filters.status

  const remove = useMutation({
    mutationFn: (id) => seller.api.deleteCoupon(id),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: [...seller.keys.all, 'coupons'] })
      toast.success(res.deleted ? 'Coupon deleted' : 'Coupon switched off. It was already used, so it stays on record.')
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const newButton = (
    <Button onClick={() => setEditing({})}>
      <Plus /> New coupon
    </Button>
  )

  return (
    <>
      <PageHeader
        title="Coupons"
        description="Discount codes for your products. Buyers apply them in the cart; share them with leads from the Leads page."
        actions={!nothingYet && newButton}
      />
      {nothingYet ? (
        <Card>
          <EmptyState
            icon={TicketPercent}
            title="No coupons yet"
            description="Create a code like FESTIVE10 for 10% off your products, then share it with customers who left items in their cart."
            action={newButton}
          />
        </Card>
      ) : (
        <Card>
          <div className="px-4 pt-2">
            <FilterTabs value={filters.status ?? ''} onChange={(status) => setFilters({ status })} options={TABS} />
          </div>
          <div className="border-b border-slate-100 p-4">
            <SearchField value={filters.q ?? ''} onChange={(q) => setFilters({ q })} placeholder="Search by code" />
          </div>
          <DataTable
            loading={isLoading}
            rows={data?.items}
            onRowClick={(c) => setEditing(c)}
            empty={{ title: 'No coupons here', description: 'Try another filter.' }}
            columns={[
              {
                key: 'code',
                header: 'Code',
                cell: (c) => (
                  <div>
                    <p className="font-mono font-semibold text-slate-900">{c.code}</p>
                    {c.description && <p className="max-w-64 truncate text-xs text-slate-500">{c.description}</p>}
                  </div>
                ),
              },
              { key: 'offer', header: 'Offer', cell: (c) => <span className="font-medium text-slate-800">{couponOffer(c)}</span> },
              { key: 'conditions', header: 'Conditions', cell: (c) => <span className="text-slate-600">{couponConditions(c)}</span> },
              {
                key: 'used',
                header: 'Used',
                className: 'text-right',
                cell: (c) => (
                  <span className="tabular text-slate-700">
                    {formatNumber(c.usedCount)}
                    {c.usageLimit ? ` / ${formatNumber(c.usageLimit)}` : ''}
                  </span>
                ),
              },
              {
                key: 'state',
                header: 'Status',
                cell: (c) => (
                  <div className="flex flex-col items-start gap-0.5">
                    <Badge tone={COUPON_STATES[c.state]?.tone}>{COUPON_STATES[c.state]?.label ?? c.state}</Badge>
                    {c.state === 'not_started' && <span className="text-xs text-slate-500">from {formatDate(c.startsAt)}</span>}
                  </div>
                ),
              },
              {
                key: 'actions',
                header: '',
                className: 'w-px',
                cell: (c) => (
                  // The row opens the editor; menu clicks (portaled, but they still bubble in React) mustn't too.
                  <div onClick={(e) => e.stopPropagation()}>
                    <RowActions
                      items={[
                        { label: 'Edit', icon: Pencil, onSelect: () => setEditing(c) },
                        { label: c.usedCount ? 'Switch off' : 'Delete', icon: Trash2, danger: true, onSelect: () => setRemoving(c) },
                      ]}
                    />
                  </div>
                ),
              },
            ]}
          />
          <Pagination meta={data?.meta} onPageChange={(page) => setFilters({ page })} />
        </Card>
      )}

      {editing && <CouponDialog coupon={editing._id ? editing : null} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={removing?.usedCount ? `Switch off ${removing?.code}?` : `Delete ${removing?.code}?`}
        description={
          removing?.usedCount
            ? 'Buyers have used this coupon, so it stays on record but can no longer be applied.'
            : 'Buyers will no longer be able to apply this code.'
        }
        confirmLabel={removing?.usedCount ? 'Switch off' : 'Delete'}
        tone="danger"
        onConfirm={() => remove.mutateAsync(removing._id).then(() => setRemoving(null))}
      />
    </>
  )
}

const toDateInput = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '')
/** A date input's value as the start (or end) of that day, in the browser's time zone. */
const fromDateInput = (v, endOfDay = false) => (v ? new Date(`${v}T${endOfDay ? '23:59:59' : '00:00:00'}`).toISOString() : null)

function CouponDialog({ coupon, onClose }) {
  const seller = useSeller()
  const qc = useQueryClient()
  const used = Boolean(coupon?.usedCount)
  const [form, setForm] = useState(() => ({
    code: coupon?.code ?? '',
    description: coupon?.description ?? '',
    type: coupon?.type ?? 'percent',
    value: coupon?.value,
    maxDiscount: coupon?.maxDiscount ?? undefined,
    minOrderValue: coupon?.minOrderValue || undefined,
    startsAt: toDateInput(coupon?.startsAt),
    expiresAt: toDateInput(coupon?.expiresAt),
    usageLimit: coupon?.usageLimit ?? undefined,
    perUserLimit: coupon?.perUserLimit ?? 1,
    active: coupon?.active ?? true,
  }))
  const [errors, setErrors] = useState({})
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const percent = form.type === 'percent'

  const save = useMutation({
    mutationFn: () => {
      const body = {
        description: form.description.trim() || undefined,
        maxDiscount: percent ? (form.maxDiscount ?? null) : null,
        minOrderValue: form.minOrderValue ?? 0,
        startsAt: fromDateInput(form.startsAt),
        expiresAt: fromDateInput(form.expiresAt, true),
        usageLimit: form.usageLimit ?? null,
        perUserLimit: form.perUserLimit ?? 1,
        active: form.active,
        // A used coupon keeps its code and discount (the server refuses changes to them).
        ...(used ? {} : { code: form.code.trim(), type: form.type, value: form.value }),
      }
      return coupon ? seller.api.updateCoupon(coupon._id, body) : seller.api.createCoupon(body)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...seller.keys.all, 'coupons'] })
      toast.success(coupon ? 'Coupon updated' : 'Coupon created')
      onClose()
    },
    onError: (e) => {
      const { fields } = parseApiError(e)
      setErrors(fields)
      if (!Object.keys(fields).length) toast.error(errorMessage(e))
    },
  })

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={coupon ? `Edit ${coupon.code}` : 'New coupon'}
      description="Applies to your products only. Prices include GST; the discount comes off the price buyers pay."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={!form.code.trim() || !form.value} onClick={() => save.mutate()}>
            {coupon ? 'Save changes' : 'Create coupon'}
          </Button>
        </>
      }
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Code" required error={errors.code} hint={used ? 'Used coupons keep their code' : '3–20 letters or numbers, e.g. FESTIVE10'}>
          {(p) => (
            <Input
              {...p}
              className="font-mono uppercase"
              maxLength={20}
              disabled={used}
              value={form.code}
              onChange={(e) => set({ code: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '') })}
            />
          )}
        </Field>
        <Field label="Shown to buyers" error={errors.description} hint="e.g. on all drills and drivers">
          {(p) => <Input {...p} maxLength={200} value={form.description} onChange={(e) => set({ description: e.target.value })} />}
        </Field>

        <div className="sm:col-span-2">
          <p className="mb-1.5 text-sm font-semibold text-slate-900">Discount</p>
          <SegmentedControl
            value={form.type}
            onChange={(type) => !used && set({ type, value: undefined })}
            options={[
              { value: 'percent', label: 'Percentage' },
              { value: 'flat', label: 'Flat amount' },
            ]}
          />
        </div>
        <Field label={percent ? 'Percent off' : 'Amount off'} required error={errors.value} hint={percent ? 'Up to 90%' : undefined}>
          {(p) =>
            percent ? (
              <NumberInput {...p} min={1} max={90} disabled={used} value={form.value} onChange={(value) => set({ value })} />
            ) : (
              <PriceInput {...p} disabled={used} value={form.value} onChange={(value) => set({ value })} />
            )
          }
        </Field>
        {percent ? (
          <Field label="Maximum discount" error={errors.maxDiscount} hint="Optional cap per order">
            {(p) => <PriceInput {...p} value={form.maxDiscount} onChange={(maxDiscount) => set({ maxDiscount })} />}
          </Field>
        ) : (
          <div />
        )}

        <Field label="Minimum order" error={errors.minOrderValue} hint="Of your products in the cart">
          {(p) => <PriceInput {...p} value={form.minOrderValue} onChange={(minOrderValue) => set({ minOrderValue })} />}
        </Field>
        <div />
        <Field label="Starts" error={errors.startsAt} hint="Leave empty to start now">
          {(p) => <Input {...p} type="date" value={form.startsAt} onChange={(e) => set({ startsAt: e.target.value })} />}
        </Field>
        <Field label="Ends" error={errors.expiresAt} hint="Last day it can be used; empty = no end">
          {(p) => <Input {...p} type="date" value={form.expiresAt} onChange={(e) => set({ expiresAt: e.target.value })} />}
        </Field>
        <Field label="Total uses" error={errors.usageLimit} hint="Empty = unlimited">
          {(p) => <NumberInput {...p} min={1} value={form.usageLimit} onChange={(usageLimit) => set({ usageLimit })} />}
        </Field>
        <Field label="Uses per customer" error={errors.perUserLimit}>
          {(p) => <NumberInput {...p} min={1} max={100} value={form.perUserLimit} onChange={(perUserLimit) => set({ perUserLimit })} />}
        </Field>
        <div className="sm:col-span-2">
          <Switch checked={form.active} onCheckedChange={(active) => set({ active })} label="Active" description="Switch off to stop buyers applying it." />
        </div>
      </div>
    </Dialog>
  )
}
