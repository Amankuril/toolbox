import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { formatPhone } from '@/core/lib/format'
import { ProductImport } from '@/modules/shared/ProductImport'
import { Field, Select } from '@/ui/Field'
import { PageHeader } from '@/ui/PageHeader'
import { SearchField } from '@/ui/SearchField'
import { adminApi, adminKeys } from '../api'

/** Admins import into a chosen vendor's catalogue; the vendor is kept in the URL (?vendor=). */
export default function AdminProductImportPage() {
  const [params, setParams] = useSearchParams()
  const vendorId = params.get('vendor')
  const [q, setQ] = useState('')
  const query = { status: 'approved', limit: 50, ...(q ? { q } : {}) }
  const { data } = useQuery({ queryKey: adminKeys.vendors(query), queryFn: () => adminApi.vendors(query), placeholderData: keepPreviousData })
  const { data: selected } = useQuery({ queryKey: adminKeys.vendor(vendorId), queryFn: () => adminApi.vendor(vendorId), enabled: Boolean(vendorId) })
  const options = [...(data?.items ?? [])]
  if (selected && !options.some((v) => v._id === selected._id)) options.unshift(selected)

  const choose = (id) =>
    setParams((prev) => {
      const next = Object.fromEntries(prev)
      delete next.id
      if (id) next.vendor = id
      else delete next.vendor
      return next
    })

  const picker = (
    <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2">
      <Field label="Find vendor">{() => <SearchField value={q} onChange={setQ} placeholder="Store, name or phone" />}</Field>
      <Field label="Import into" required>
        {(p) => (
          <Select {...p} value={vendorId ?? ''} onChange={(e) => choose(e.target.value)} placeholder="Choose an approved vendor">
            {options.map((v) => (
              <option key={v._id} value={v._id}>
                {v.store?.name ?? v.contactName} · {formatPhone(v.phone)}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </div>
  )

  return (
    <>
      <PageHeader
        back={{ to: '/admin/products', label: 'Products' }}
        title="Bulk upload products"
        description="Import an Excel or CSV file into a vendor’s catalogue. Products belong to the vendor and follow moderation rules."
      />
      <ProductImport
        key={vendorId ?? 'none'}
        panel="admin"
        api={adminApi.productImports}
        vendorId={vendorId}
        vendorPicker={picker}
        productsPath="/admin/products"
      />
    </>
  )
}
