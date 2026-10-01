import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, Check, ExternalLink, Eye, MessageSquareWarning, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/core/api/errors'
import { useSearchParamsState } from '@/core/hooks/useSearchParamsState'
import { formatDate, formatPhone } from '@/core/lib/format'
import { StatusBadge } from '@/ui/Badge'
import { Thumb } from '@/ui/Brand'
import { Card } from '@/ui/Card'
import { FilterTabs } from '@/ui/Controls'
import { DataTable, Pagination } from '@/ui/DataTable'
import { PageHeader } from '@/ui/PageHeader'
import { ActionDialog, RowActions } from '@/ui/RowActions'
import { SearchField } from '@/ui/SearchField'
import { adminApi, adminKeys } from '../api'

const TABS = [
  { value: '', label: 'All' },
  { value: 'pending_review', label: 'Under review' },
  { value: 'approved', label: 'Approved' },
  { value: 'onboarding', label: 'Onboarding' },
  { value: 'rejected', label: 'Changes requested' },
  { value: 'suspended', label: 'Suspended' },
]

export default function VendorsPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [filters, setFilters] = useSearchParamsState()
  const [action, setAction] = useState(null)
  const params = { page: Number(filters.page ?? 1), limit: 20, status: filters.status || undefined, q: filters.q || undefined }
  const { data, isLoading } = useQuery({ queryKey: adminKeys.vendors(params), queryFn: () => adminApi.vendors(params), placeholderData: keepPreviousData })

  const run = (fn, message) => async (row, note) => {
    try {
      await fn(row, note)
      qc.invalidateQueries({ queryKey: ['admin', 'vendors'] })
      qc.invalidateQueries({ queryKey: adminKeys.vendor(row._id) })
      qc.invalidateQueries({ queryKey: adminKeys.dashboard })
      toast.success(message)
    } catch (err) {
      toast.error(errorMessage(err))
      throw err
    }
  }

  return (
    <>
      <PageHeader title="Vendors" description="Review seller applications and manage stores." />
      <Card>
        <div className="px-4 pt-2">
          <FilterTabs value={filters.status ?? ''} onChange={(status) => setFilters({ status })} options={TABS} />
        </div>
        <div className="flex items-center gap-3 border-b border-slate-100 p-4">
          <SearchField value={filters.q ?? ''} onChange={(q) => setFilters({ q })} placeholder="Store, phone, email or GSTIN" />
        </div>
        <DataTable
          loading={isLoading}
          rows={data?.items}
          empty={{ title: 'No vendors found', description: filters.q || filters.status ? 'Try a different filter.' : 'Vendors appear here once they sign up.' }}
          columns={[
            {
              key: 'store',
              header: 'Store',
              cell: (v) => (
                <div className="flex items-center gap-3">
                  <Thumb src={v.store?.logo?.url} alt="" className="size-9 shrink-0 rounded-md border border-slate-200" />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900">{v.store?.name}</p>
                    <p className="truncate text-xs text-slate-500">{v.business?.legalName ?? 'Business details pending'}</p>
                  </div>
                </div>
              ),
            },
            {
              key: 'contact',
              header: 'Contact',
              cell: (v) => (
                <div>
                  <p className="text-slate-800">{v.contactName}</p>
                  <p className="text-xs text-slate-500">{formatPhone(v.phone)}</p>
                </div>
              ),
            },
            { key: 'gstin', header: 'GSTIN', cell: (v) => <span className="font-mono text-xs">{v.business?.gstin ?? '—'}</span> },
            { key: 'city', header: 'Location', cell: (v) => (v.address ? `${v.address.city}, ${v.address.state}` : '—') },
            { key: 'status', header: 'Status', cell: (v) => <StatusBadge status={v.status} /> },
            { key: 'joined', header: 'Joined', cell: (v) => formatDate(v.createdAt) },
            {
              key: 'actions',
              header: '',
              className: 'w-px',
              cell: (v) => (
                <RowActions
                  label={`Actions for ${v.store?.name}`}
                  items={[
                    { label: 'View details', icon: Eye, onSelect: () => navigate(`/admin/vendors/${v._id}`) },
                    v.status === 'approved' && v.store?.slug && { label: 'View store', icon: ExternalLink, onSelect: () => window.open(`/store/${v.store.slug}`, '_blank', 'noopener') },
                    v.status === 'pending_review' && 'separator',
                    v.status === 'pending_review' && { label: 'Approve', icon: Check, onSelect: () => setAction({ type: 'approve', row: v }) },
                    v.status === 'pending_review' && { label: 'Request changes', icon: MessageSquareWarning, onSelect: () => setAction({ type: 'reject', row: v }) },
                    ['approved', 'rejected', 'onboarding'].includes(v.status) && 'separator',
                    ['approved', 'rejected', 'onboarding'].includes(v.status) && { label: 'Suspend', icon: Ban, danger: true, onSelect: () => setAction({ type: 'suspend', row: v }) },
                    v.status === 'suspended' && 'separator',
                    v.status === 'suspended' && { label: 'Reinstate', icon: RotateCcw, onSelect: () => setAction({ type: 'reinstate', row: v }) },
                  ]}
                />
              ),
            },
          ]}
        />
        <Pagination meta={data?.meta} onPageChange={(page) => setFilters({ page })} />
      </Card>

      <ActionDialog
        action={action}
        onClose={() => setAction(null)}
        configs={{
          approve: {
            kind: 'confirm',
            title: (v) => `Approve ${v.store?.name}?`,
            description: 'They can start listing products, and their approved products go live on the storefront.',
            confirmLabel: 'Approve',
            tone: 'primary',
            run: run((v) => adminApi.reviewVendor(v._id, { action: 'approve' }), 'Vendor approved'),
          },
          reject: {
            kind: 'reason',
            title: (v) => `Request changes from ${v.store?.name}`,
            description: 'The vendor sees this note and can resubmit.',
            label: 'What needs to change?',
            confirmLabel: 'Send to vendor',
            run: run((v, note) => adminApi.reviewVendor(v._id, { action: 'reject', note }), 'Changes requested'),
          },
          suspend: {
            kind: 'reason',
            title: (v) => `Suspend ${v.store?.name}?`,
            description: 'They are signed out and all their products are hidden immediately.',
            confirmLabel: 'Suspend vendor',
            run: run((v, note) => adminApi.suspendVendor(v._id, { note }), 'Vendor suspended'),
          },
          reinstate: {
            kind: 'confirm',
            title: (v) => `Reinstate ${v.store?.name}?`,
            description: 'Their account and products are restored.',
            confirmLabel: 'Reinstate',
            tone: 'primary',
            run: run((v) => adminApi.reinstateVendor(v._id), 'Vendor reinstated'),
          },
        }}
      />
    </>
  )
}
