import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, Building2, Eye, RotateCcw, TicketPercent, User, Wallet, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { errorMessage } from '@/core/api/errors'
import { useSearchParamsState } from '@/core/hooks/useSearchParamsState'
import { formatDate, formatDateTime, formatINR, formatPhone } from '@/core/lib/format'
import { Badge, StatusBadge } from '@/ui/Badge'
import { Button } from '@/ui/Button'
import { Card, Skeleton } from '@/ui/Card'
import { FilterTabs } from '@/ui/Controls'
import { DataTable, Pagination, pageSize } from '@/ui/DataTable'
import { ConfirmDialog, Dialog } from '@/ui/Dialog'
import { DescriptionList, PageHeader } from '@/ui/PageHeader'
import { ActionDialog, RowActions } from '@/ui/RowActions'
import { SearchField } from '@/ui/SearchField'
import { useBranding } from '@/core/settings/usePublicSettings'
import { ShareCouponDialog } from '@/modules/shared/ShareCoupon'
import { WhatsAppButton, WhatsAppIcon, whatsappLink } from '@/modules/shared/whatsapp'
import { Textarea } from '@/ui/Field'
import { useAdminAccess } from '../access'
import { BulkWalletCredit, WalletPanel } from '../WalletPanel'
import { adminApi, adminKeys, platformCouponApi } from '../api'

const couponShareClient = { root: ['admin', 'platform-coupons'], coupons: platformCouponApi.coupons, customers: platformCouponApi.customers, share: platformCouponApi.shareCoupon }

export default function CustomersPage() {
  const { siteName } = useBranding()
  const [filters, setFilters] = useSearchParamsState()
  const [selected, setSelected] = useState(null)
  const [action, setAction] = useState(null)
  // Ticked customers, kept across pages and searches: { id → customer }.
  const [picked, setPicked] = useState(() => new Map())
  const [bulk, setBulk] = useState(null) // 'coupon' | 'whatsapp' | 'block'
  const { can } = useAdminAccess()
  const qc = useQueryClient()
  const setStatus = async (u, status) => {
    try {
      await adminApi.setUserStatus(u._id, status)
      qc.invalidateQueries({ queryKey: ['admin', 'users'] })
      qc.invalidateQueries({ queryKey: adminKeys.user(u._id) })
      toast.success(status === 'blocked' ? 'Customer blocked and signed out' : 'Customer unblocked')
    } catch (err) {
      toast.error(errorMessage(err))
      throw err
    }
  }
  const params = { page: Number(filters.page ?? 1), limit: pageSize(filters.limit), status: filters.status || undefined, q: filters.q || undefined }
  const { data, isLoading } = useQuery({ queryKey: adminKeys.users(params), queryFn: () => adminApi.users(params), placeholderData: keepPreviousData })

  return (
    <>
      <PageHeader title="Customers" description="People who buy on the storefront. Tick customers to send them a coupon or a WhatsApp message together." />
      {picked.size > 0 && (
        <div className="sticky top-2 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-white p-3 shadow-lg">
          <span className="mr-auto text-sm font-semibold text-slate-900">{picked.size} selected</span>
          {can('marketing') && (
            <Button size="sm" onClick={() => setBulk('coupon')}>
              <TicketPercent /> Share coupon
            </Button>
          )}
          {can('customers', 'manage') && (
            <Button size="sm" variant="outline" onClick={() => setBulk('wallet')}>
              <Wallet /> Add to wallet
            </Button>
          )}
          <Button size="sm" variant="outline" className="text-[#128c4b]" onClick={() => setBulk('whatsapp')}>
            <WhatsAppIcon /> WhatsApp message
          </Button>
          {can('customers', 'manage') && (
            <Button size="sm" variant="outline" className="text-red-600" onClick={() => setBulk('block')}>
              <Ban /> Block
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setPicked(new Map())}>
            <X /> Clear
          </Button>
        </div>
      )}
      <Card>
        <div className="px-4 pt-2">
          <FilterTabs
            value={filters.status ?? ''}
            onChange={(status) => setFilters({ status })}
            options={[
              { value: '', label: 'All' },
              { value: 'active', label: 'Active' },
              { value: 'blocked', label: 'Blocked' },
            ]}
          />
        </div>
        <div className="border-b border-slate-100 p-4">
          <SearchField value={filters.q ?? ''} onChange={(q) => setFilters({ q })} placeholder="Name, phone, email or GSTIN" />
        </div>
        <DataTable
          loading={isLoading}
          rows={data?.items}
          empty={{ title: 'No customers found' }}
          columns={[
            {
              key: 'pick',
              header: (
                <input
                  type="checkbox"
                  aria-label="Select all on this page"
                  className="size-4 accent-[var(--tb-primary)]"
                  checked={Boolean(data?.items?.length) && data.items.every((u) => picked.has(u._id))}
                  onChange={(e) =>
                    setPicked((m) => {
                      const next = new Map(m)
                      for (const u of data?.items ?? []) e.target.checked ? next.set(u._id, u) : next.delete(u._id)
                      return next
                    })
                  }
                />
              ),
              className: 'w-px',
              cell: (u) => (
                <input
                  type="checkbox"
                  aria-label={`Select ${u.name}`}
                  className="size-4 accent-[var(--tb-primary)]"
                  checked={picked.has(u._id)}
                  onChange={() =>
                    setPicked((m) => {
                      const next = new Map(m)
                      if (next.has(u._id)) next.delete(u._id)
                      else next.set(u._id, u)
                      return next
                    })
                  }
                />
              ),
            },
            {
              key: 'name',
              header: 'Customer',
              cell: (u) => (
                <div className="flex items-center gap-3">
                  <span className="grid size-9 place-items-center rounded-full bg-slate-100 text-slate-500">
                    {u.accountType === 'business' ? <Building2 className="size-4" /> : <User className="size-4" />}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900">{u.name}</p>
                    <p className="truncate text-xs text-slate-500">{u.email ?? 'No email'}</p>
                  </div>
                </div>
              ),
            },
            {
              key: 'phone',
              header: 'Mobile',
              cell: (u) => (
                <span className="flex items-center gap-1 whitespace-nowrap">
                  {formatPhone(u.phone)}
                  <WhatsAppButton phone={u.phone} text={`Hi ${u.name?.split(' ')[0] ?? ''}, greetings from ${siteName}!`} title={`WhatsApp ${u.name}`} />
                </span>
              ),
            },
            { key: 'wallet', header: 'Wallet', className: 'text-right', cell: (u) => <span className="tabular text-slate-700">{u.walletBalance ? formatINR(u.walletBalance) : '—'}</span> },
            { key: 'type', header: 'Type', cell: (u) => (u.accountType === 'business' ? <Badge tone="info">Business</Badge> : <Badge>Individual</Badge>) },
            { key: 'status', header: 'Status', cell: (u) => <StatusBadge status={u.status} /> },
            { key: 'last', header: 'Last sign-in', cell: (u) => formatDate(u.lastLoginAt) },
            { key: 'joined', header: 'Joined', cell: (u) => formatDate(u.createdAt) },
            {
              key: 'actions',
              header: '',
              className: 'w-px',
              cell: (u) => (
                <RowActions
                  label={`Actions for ${u.name}`}
                  items={[
                    { label: 'View details', icon: Eye, onSelect: () => setSelected(u._id) },
                    'separator',
                    u.status === 'active'
                      ? { label: 'Block', icon: Ban, danger: true, onSelect: () => setAction({ type: 'block', row: u }) }
                      : { label: 'Unblock', icon: RotateCcw, onSelect: () => setStatus(u, 'active').catch(() => {}) },
                  ]}
                />
              ),
            },
          ]}
        />
        <Pagination meta={data?.meta} onPageChange={(page) => setFilters({ page })} onLimitChange={(limit) => setFilters({ limit })} />
      </Card>
      <CustomerDialog id={selected} onClose={() => setSelected(null)} />
      <ActionDialog
        action={action}
        onClose={() => setAction(null)}
        configs={{
          block: {
            kind: 'confirm',
            title: (u) => `Block ${u.name}?`,
            description: 'They are signed out and cannot sign in or place orders until unblocked.',
            confirmLabel: 'Block',
            run: (u) => setStatus(u, 'blocked'),
          },
        }}
      />
      <ShareCouponDialog open={bulk === 'coupon'} onOpenChange={(o) => !o && setBulk(null)} client={couponShareClient} users={[...picked.values()]} />
      <BulkWalletCredit open={bulk === 'wallet'} onOpenChange={(o) => !o && setBulk(null)} users={[...picked.values()]} />
      <BulkWhatsApp open={bulk === 'whatsapp'} onOpenChange={(o) => !o && setBulk(null)} users={[...picked.values()]} siteName={siteName} />
      <ConfirmDialog
        open={bulk === 'block'}
        onOpenChange={(o) => !o && setBulk(null)}
        title={`Block ${picked.size} customer${picked.size === 1 ? '' : 's'}?`}
        description="They are signed out and cannot sign in or place orders until unblocked."
        confirmLabel="Block"
        onConfirm={async () => {
          const results = await Promise.allSettled([...picked.values()].filter((u) => u.status === 'active').map((u) => adminApi.setUserStatus(u._id, 'blocked')))
          qc.invalidateQueries({ queryKey: ['admin', 'users'] })
          const failed = results.filter((r) => r.status === 'rejected').length
          if (failed) toast.error(`${failed} could not be blocked`)
          else toast.success('Customers blocked')
          setPicked(new Map())
        }}
      />
    </>
  )
}

/** One message, sent to each ticked customer with a tap (WhatsApp has no bulk send from a browser). */
function BulkWhatsApp({ open, onOpenChange, users, siteName }) {
  const [text, setText] = useState(`Greetings from ${siteName}! `)
  const [sent, setSent] = useState(() => new Set())
  const withPhone = users.filter((u) => u.phone)
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg" title="WhatsApp message" description={`${withPhone.length} of ${users.length} selected have a mobile number.`}>
      <Textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} aria-label="Message" maxLength={1000} />
      <p className="mt-1 mb-3 text-xs text-slate-500">Each chat opens with the message typed in, starting “Hi &lt;first name&gt;”.</p>
      <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200">
        {withPhone.map((u) => (
          <li key={u._id} className="flex items-center gap-3 px-3 py-2 text-sm">
            <span className="min-w-0 flex-1">
              <span className="font-medium text-slate-900">{u.name}</span> <span className="text-xs text-slate-500">{formatPhone(u.phone)}</span>
            </span>
            <Button asChild size="sm" variant={sent.has(u._id) ? 'ghost' : 'outline'} className="text-[#128c4b]">
              <a
                href={whatsappLink(u.phone, `Hi ${u.name.split(' ')[0]}, ${text.trim()}`)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setSent((s) => new Set(s).add(u._id))}
              >
                <WhatsAppIcon /> {sent.has(u._id) ? 'Opened' : 'Send'}
              </a>
            </Button>
          </li>
        ))}
      </ul>
    </Dialog>
  )
}

function CustomerDialog({ id, onClose }) {
  const qc = useQueryClient()
  const canEditWallet = useAdminAccess().can('customers', 'manage')
  const { data: u, isLoading } = useQuery({ queryKey: adminKeys.user(id), queryFn: () => adminApi.user(id), enabled: Boolean(id) })
  const setStatus = useMutation({
    mutationFn: (status) => adminApi.setUserStatus(id, status),
    onSuccess: (_d, status) => {
      qc.invalidateQueries({ queryKey: ['admin', 'users'] })
      qc.invalidateQueries({ queryKey: adminKeys.user(id) })
      toast.success(status === 'blocked' ? 'Customer blocked and signed out' : 'Customer unblocked')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  return (
    <Dialog
      open={Boolean(id)}
      onOpenChange={(v) => !v && onClose()}
      title={u?.name ?? 'Customer'}
      size="lg"
      footer={
        u &&
        (u.status === 'active' ? (
          <ConfirmDialog
            title="Block this customer?"
            description="They will be signed out and cannot sign in or place orders until unblocked."
            confirmLabel="Block"
            onConfirm={() => setStatus.mutateAsync('blocked')}
            trigger={
              <Button variant="danger-outline">
                <Ban /> Block
              </Button>
            }
          />
        ) : (
          <Button loading={setStatus.isPending} onClick={() => setStatus.mutate('active')}>
            <RotateCcw /> Unblock
          </Button>
        ))
      }
    >
      {isLoading || !u ? (
        <Skeleton className="h-40" />
      ) : (
        <div className="flex flex-col gap-6">
          <DescriptionList
            items={[
              ['Mobile', formatPhone(u.phone)],
              ['Email', u.email],
              ['Status', <StatusBadge key="s" status={u.status} />],
              ['Account type', u.accountType === 'business' ? 'Business' : 'Individual'],
              u.business && ['Business', u.business.name],
              u.business && ['GSTIN', u.business.gstin && <span className="font-mono">{u.business.gstin}</span>],
              ['Joined', formatDateTime(u.createdAt)],
              ['Last sign-in', formatDateTime(u.lastLoginAt)],
            ]}
          />
          <WalletPanel userId={u._id} canEdit={canEditWallet} />
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Saved addresses</h3>
            {u.addresses?.length ? (
              <ul className="grid gap-3 sm:grid-cols-2">
                {u.addresses.map((a) => (
                  <li key={a._id} className="rounded-lg border border-slate-200 p-3 text-sm">
                    <p className="font-medium text-slate-900">
                      {a.label} {a.isDefault && <Badge tone="primary">Default</Badge>}
                    </p>
                    <p className="mt-1 text-slate-600">
                      {a.name}, {formatPhone(a.phone)}
                      <br />
                      {[a.line1, a.line2, a.landmark].filter(Boolean).join(', ')}
                      <br />
                      {a.city}, {a.state} {a.pincode}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">No saved addresses.</p>
            )}
          </div>
        </div>
      )}
    </Dialog>
  )
}
