import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, EyeOff, ExternalLink, Eye, MessageSquareWarning, Star } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/core/api/errors'
import { PRODUCT_TYPE_LABEL } from '@/core/lib/constants'
import { formatDateTime, formatINR, formatNumber, formatPhone, titleCase } from '@/core/lib/format'
import { StatusBadge } from '@/ui/Badge'
import { Price, Thumb } from '@/ui/Brand'
import { Button } from '@/ui/Button'
import { Alert, Card, CardBody, CardHeader, Skeleton } from '@/ui/Card'
import { ConfirmDialog } from '@/ui/Dialog'
import { DescriptionList, PageHeader } from '@/ui/PageHeader'
import { ReasonDialog } from '@/ui/ReasonDialog'
import { adminApi, adminKeys } from '../api'

export default function ProductDetailPage() {
  const { id } = useParams()
  const qc = useQueryClient()
  const { data: p, isLoading } = useQuery({ queryKey: adminKeys.product(id), queryFn: () => adminApi.product(id) })

  const done = (message) => () => {
    qc.invalidateQueries({ queryKey: adminKeys.product(id) })
    qc.invalidateQueries({ queryKey: ['admin', 'products'] })
    qc.invalidateQueries({ queryKey: adminKeys.dashboard })
    toast.success(message)
  }
  const onError = (err) => toast.error(errorMessage(err))
  const review = useMutation({
    mutationFn: (body) => adminApi.reviewProduct(id, body),
    onSuccess: (_d, v) => done(v.action === 'approve' ? 'Product approved and live' : 'Sent back to vendor')(),
    onError,
  })
  const update = useMutation({ mutationFn: (body) => adminApi.updateProduct(id, body), onSuccess: done('Product updated'), onError })

  if (isLoading || !p) return <Skeleton className="h-96" />

  const reviewable = ['pending', 'rejected'].includes(p.status)

  return (
    <>
      <PageHeader
        back={{ to: '/admin/products', label: 'Products' }}
        title={p.name}
        meta={<StatusBadge status={p.status} />}
        description={`${PRODUCT_TYPE_LABEL[p.type]} · Updated ${formatDateTime(p.updatedAt)}`}
        actions={
          <>
            {p.status === 'active' && p.vendorApproved && (
              <Button variant="outline" asChild>
                <a href={`/p/${p.slug}`} target="_blank" rel="noreferrer">
                  <ExternalLink /> View on store
                </a>
              </Button>
            )}
            {['active', 'inactive'].includes(p.status) && (
              <Button
                variant="outline"
                loading={update.isPending && 'status' in (update.variables ?? {})}
                onClick={() => update.mutate({ status: p.status === 'active' ? 'inactive' : 'active' })}
              >
                {p.status === 'active' ? <EyeOff /> : <Eye />} {p.status === 'active' ? 'Hide' : 'Show'}
              </Button>
            )}
            <Button variant="outline" onClick={() => update.mutate({ isFeatured: !p.isFeatured })}>
              <Star className={p.isFeatured ? 'fill-amber-400 text-amber-400' : ''} /> {p.isFeatured ? 'Featured' : 'Feature'}
            </Button>
            {reviewable && (
              <>
                {p.status === 'pending' && (
                  <ReasonDialog
                    title="Send back to vendor"
                    description="Explain what needs fixing. The vendor sees this note on the product."
                    label="What should the vendor change?"
                    confirmLabel="Reject"
                    onSubmit={(note) => review.mutateAsync({ action: 'reject', note })}
                    trigger={
                      <Button variant="danger-outline">
                        <MessageSquareWarning /> Reject
                      </Button>
                    }
                  />
                )}
                <ConfirmDialog
                  title="Approve this product?"
                  description={p.vendorApproved ? 'It will go live on the storefront immediately.' : 'It will go live once the vendor is approved.'}
                  confirmLabel="Approve"
                  tone="primary"
                  onConfirm={() => review.mutateAsync({ action: 'approve' })}
                  trigger={
                    <Button>
                      <Check /> Approve
                    </Button>
                  }
                />
              </>
            )}
          </>
        }
      />

      {p.status === 'rejected' && p.moderation?.note && (
        <Alert tone="warning" title="Rejection note sent to vendor" className="mb-6">
          {p.moderation.note}
        </Alert>
      )}
      {!p.vendorApproved && (
        <Alert tone="neutral" className="mb-6">
          This vendor is not approved, so the product is hidden from the storefront regardless of its status.
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card>
            <CardHeader title="Images" description={`${p.images.length} image(s)`} />
            <CardBody>
              {p.images.length ? (
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
                  {p.images.map((img, i) => (
                    <a key={img.media} href={img.url} target="_blank" rel="noreferrer" className="overflow-hidden rounded-lg border border-slate-200">
                      <Thumb src={img.url} alt={img.alt ?? `Image ${i + 1}`} className="aspect-square w-full" />
                    </a>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-500">No images.</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Details" />
            <CardBody className="flex flex-col gap-6">
              <DescriptionList
                items={[
                  ['Category', p.category?.name],
                  ['Brand', p.brand],
                  ['Model', p.modelNumber],
                  ['SKU', p.sku],
                  ['Condition', titleCase(p.condition)],
                  ['HSN', p.hsnCode],
                  ['Warranty', p.warranty?.months ? `${p.warranty.months} months${p.warranty.details ? ` — ${p.warranty.details}` : ''}` : p.warranty?.details],
                  ['Dispatch', p.shipping?.dispatchDays != null ? `${p.shipping.dispatchDays} day(s)` : null],
                ]}
              />
              {p.shortDescription && <p className="text-sm font-medium text-slate-700">{p.shortDescription}</p>}
              {p.description && <p className="text-sm whitespace-pre-line text-slate-600">{p.description}</p>}
              {p.specifications.length > 0 && (
                <table className="w-full overflow-hidden rounded-lg border border-slate-200 text-sm">
                  <tbody className="divide-y divide-slate-100">
                    {p.specifications.map((s) => (
                      <tr key={s.label}>
                        <th scope="row" className="w-1/3 bg-slate-50 px-3 py-2 text-left font-medium text-slate-600">
                          {s.label}
                        </th>
                        <td className="px-3 py-2 text-slate-900">{s.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardBody>
          </Card>

          {(p.compatibleWith.length > 0 || p.compatibleModels.length > 0) && (
            <Card>
              <CardHeader title="Compatibility" />
              <CardBody className="flex flex-col gap-3">
                {p.compatibleWith.map((m) => (
                  <Link
                    key={m._id}
                    to={`/admin/products/${m._id}`}
                    className="flex items-center gap-3 rounded-lg border border-slate-200 p-2 hover:bg-slate-50"
                  >
                    <Thumb src={m.images?.[0]?.url} className="size-10 rounded" />
                    <span className="text-sm font-medium">{m.name}</span>
                  </Link>
                ))}
                {p.compatibleModels.length > 0 && <p className="text-sm text-slate-600">Models: {p.compatibleModels.join(', ')}</p>}
              </CardBody>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Pricing & stock" />
            <CardBody className="flex flex-col gap-4">
              <Price price={p.pricing.price} mrp={p.pricing.mrp} size="lg" />
              <DescriptionList
                className="sm:grid-cols-2"
                items={[
                  ['MRP', formatINR(p.pricing.mrp)],
                  ['GST', `${p.pricing.gstRate}%`],
                  ['Stock', `${formatNumber(p.inventory.stock)} ${p.inventory.unit}`],
                  ['MOQ', p.inventory.moq],
                  ['Max per order', p.inventory.maxOrderQty ?? 'No limit'],
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader
              title="Vendor"
              action={
                p.vendor?._id && (
                  <Link to={`/admin/vendors/${p.vendor._id}`} className="text-sm font-medium text-primary hover:underline">
                    Open
                  </Link>
                )
              }
            />
            <CardBody>
              <DescriptionList
                className="sm:grid-cols-1"
                items={[
                  ['Store', p.vendor?.store?.name],
                  ['Contact', p.vendor?.contactName],
                  ['Mobile', formatPhone(p.vendor?.phone)],
                  ['Vendor status', <StatusBadge key="s" status={p.vendor?.status} />],
                ]}
              />
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  )
}
