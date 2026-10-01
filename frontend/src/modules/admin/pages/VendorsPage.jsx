import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { useSearchParamsState } from '@/core/hooks/useSearchParamsState'
import { formatDate, formatPhone } from '@/core/lib/format'
import { StatusBadge } from '@/ui/Badge'
import { Thumb } from '@/ui/Brand'
import { Card } from '@/ui/Card'
import { FilterTabs } from '@/ui/Controls'
import { DataTable, Pagination } from '@/ui/DataTable'
import { PageHeader } from '@/ui/PageHeader'
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
  const [filters, setFilters] = useSearchParamsState()
  const params = { page: Number(filters.page ?? 1), limit: 20, status: filters.status || undefined, q: filters.q || undefined }
  const { data, isLoading } = useQuery({ queryKey: adminKeys.vendors(params), queryFn: () => adminApi.vendors(params), placeholderData: keepPreviousData })

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
          onRowClick={(v) => navigate(`/admin/vendors/${v._id}`)}
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
          ]}
        />
        <Pagination meta={data?.meta} onPageChange={(page) => setFilters({ page })} />
      </Card>
    </>
  )
}
