import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, Building2, Eye, RotateCcw, User } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { errorMessage } from '@/core/api/errors'
import { useSearchParamsState } from '@/core/hooks/useSearchParamsState'
import { formatDate, formatDateTime, formatPhone } from '@/core/lib/format'
import { Badge, StatusBadge } from '@/ui/Badge'
import { Button } from '@/ui/Button'
import { Card, Skeleton } from '@/ui/Card'
import { FilterTabs } from '@/ui/Controls'
import { DataTable, Pagination } from '@/ui/DataTable'
import { ConfirmDialog, Dialog } from '@/ui/Dialog'
import { DescriptionList, PageHeader } from '@/ui/PageHeader'
import { ActionDialog, RowActions } from '@/ui/RowActions'
import { SearchField } from '@/ui/SearchField'
import { adminApi, adminKeys } from '../api'

export default function CustomersPage() {
  const [filters, setFilters] = useSearchParamsState()
  const [selected, setSelected] = useState(null)
  const [action, setAction] = useState(null)
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
  const params = { page: Number(filters.page ?? 1), limit: 20, status: filters.status || undefined, q: filters.q || undefined }
  const { data, isLoading } = useQuery({ queryKey: adminKeys.users(params), queryFn: () => adminApi.users(params), placeholderData: keepPreviousData })

  return (
    <>
      <PageHeader title="Customers" description="People who buy on the storefront." />
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
            { key: 'phone', header: 'Mobile', cell: (u) => formatPhone(u.phone) },
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
        <Pagination meta={data?.meta} onPageChange={(page) => setFilters({ page })} />
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
    </>
  )
}

function CustomerDialog({ id, onClose }) {
  const qc = useQueryClient()
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
