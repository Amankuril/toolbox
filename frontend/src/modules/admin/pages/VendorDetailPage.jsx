import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, Check, Eye, FileText, MessageSquareWarning, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/core/api/errors'
import { BUSINESS_TYPES, VENDOR_DOCUMENTS } from '@/core/lib/constants'
import { formatDate, formatDateTime, formatPhone, titleCase } from '@/core/lib/format'
import { StatusBadge } from '@/ui/Badge'
import { Thumb } from '@/ui/Brand'
import { Button } from '@/ui/Button'
import { Alert, Card, CardBody, CardHeader, Skeleton } from '@/ui/Card'
import { ConfirmDialog } from '@/ui/Dialog'
import { DescriptionList, PageHeader } from '@/ui/PageHeader'
import { ReasonDialog } from '@/ui/ReasonDialog'
import { adminApi, adminKeys } from '../api'

const businessLabel = Object.fromEntries(BUSINESS_TYPES.map((b) => [b.value, b.label]))
const docLabel = Object.fromEntries(VENDOR_DOCUMENTS.map((d) => [d.value, d.label]))

export default function VendorDetailPage() {
  const { id } = useParams()
  const qc = useQueryClient()
  const { data: v, isLoading } = useQuery({ queryKey: adminKeys.vendor(id), queryFn: () => adminApi.vendor(id) })
  const [bank, setBank] = useState(null)

  const onDone = (message) => (data) => {
    qc.setQueryData(adminKeys.vendor(id), (old) => ({ ...old, ...data }))
    qc.invalidateQueries({ queryKey: ['admin', 'vendors'] })
    qc.invalidateQueries({ queryKey: adminKeys.dashboard })
    toast.success(message)
  }
  const onError = (err) => toast.error(errorMessage(err))

  const approve = useMutation({
    mutationFn: () => adminApi.reviewVendor(id, { action: 'approve' }),
    onSuccess: onDone('Vendor approved — their products are now live'),
    onError,
  })
  const reject = useMutation({
    mutationFn: (note) => adminApi.reviewVendor(id, { action: 'reject', note }),
    onSuccess: onDone('Changes requested from vendor'),
    onError,
  })
  const suspend = useMutation({ mutationFn: (note) => adminApi.suspendVendor(id, { note }), onSuccess: onDone('Vendor suspended'), onError })
  const reinstate = useMutation({ mutationFn: () => adminApi.reinstateVendor(id), onSuccess: onDone('Vendor reinstated'), onError })
  const reveal = useMutation({ mutationFn: () => adminApi.vendorBank(id), onSuccess: setBank, onError })

  if (isLoading || !v) return <Skeleton className="h-96" />

  const stats = v.productStats ?? {}
  const actions = (
    <>
      {v.status === 'pending_review' && (
        <>
          <ReasonDialog
            title="Request changes"
            description="The vendor will see this note and can resubmit."
            label="What needs to change?"
            placeholder="e.g. The GST certificate is unreadable, please upload a clearer copy."
            confirmLabel="Send to vendor"
            onSubmit={(note) => reject.mutateAsync(note)}
            trigger={
              <Button variant="outline">
                <MessageSquareWarning /> Request changes
              </Button>
            }
          />
          <ConfirmDialog
            title="Approve this vendor?"
            description="They will be able to list products, and their approved products will go live on the storefront."
            confirmLabel="Approve"
            tone="primary"
            onConfirm={() => approve.mutateAsync()}
            trigger={
              <Button>
                <Check /> Approve
              </Button>
            }
          />
        </>
      )}
      {['approved', 'rejected', 'onboarding'].includes(v.status) && (
        <ReasonDialog
          title="Suspend vendor"
          description="They will be signed out, and all their products will be hidden immediately."
          confirmLabel="Suspend"
          onSubmit={(note) => suspend.mutateAsync(note)}
          trigger={
            <Button variant="danger-outline">
              <Ban /> Suspend
            </Button>
          }
        />
      )}
      {v.status === 'suspended' && (
        <ConfirmDialog
          title="Reinstate vendor?"
          description="Their account and products will be restored."
          confirmLabel="Reinstate"
          tone="primary"
          onConfirm={() => reinstate.mutateAsync()}
          trigger={
            <Button>
              <RotateCcw /> Reinstate
            </Button>
          }
        />
      )}
    </>
  )

  return (
    <>
      <PageHeader
        back={{ to: '/admin/vendors', label: 'Vendors' }}
        title={v.store?.name}
        meta={<StatusBadge status={v.status} />}
        description={`Joined ${formatDate(v.createdAt)}`}
        actions={actions}
      />

      {v.review?.note && (
        <Alert
          tone={v.status === 'suspended' ? 'danger' : 'warning'}
          title={v.status === 'suspended' ? 'Suspension note' : 'Changes requested'}
          className="mb-6"
        >
          {v.review.note}
        </Alert>
      )}
      {v.status === 'onboarding' && (
        <Alert tone="neutral" title="Still onboarding" className="mb-6">
          Completed steps: {v.onboarding.completedSteps.length ? v.onboarding.completedSteps.map(titleCase).join(', ') : 'none yet'}.
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card>
            <CardHeader title="Business" />
            <CardBody>
              <DescriptionList
                items={[
                  ['Legal name', v.business?.legalName],
                  ['Business type', businessLabel[v.business?.type]],
                  ['GSTIN', v.business?.gstin && <span className="font-mono">{v.business.gstin}</span>],
                  ['PAN', v.business?.pan && <span className="font-mono">{v.business.pan}</span>],
                  ['Established', v.business?.yearEstablished],
                  [
                    'Store URL',
                    v.store?.slug && v.status === 'approved' ? (
                      <Link to={`/store/${v.store.slug}`} target="_blank" className="text-primary hover:underline">
                        /store/{v.store.slug}
                      </Link>
                    ) : (
                      v.store?.slug
                    ),
                  ],
                ]}
              />
              {v.store?.description && <p className="mt-5 text-sm whitespace-pre-line text-slate-600">{v.store.description}</p>}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Documents" description="Verify these against the business details before approving." />
            <CardBody>
              {v.documents?.length ? (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  {v.documents.map((d) => (
                    <a key={d._id} href={d.url} target="_blank" rel="noreferrer" className="group block overflow-hidden rounded-lg border border-slate-200">
                      <Thumb src={d.url} alt={docLabel[d.type]} className="aspect-[4/3] w-full transition-transform group-hover:scale-[1.02]" />
                      <div className="flex items-center gap-2 border-t border-slate-100 px-3 py-2 text-sm font-medium text-slate-700">
                        <FileText className="size-4 text-slate-400" /> {docLabel[d.type] ?? titleCase(d.type)}
                      </div>
                    </a>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-500">No documents uploaded yet.</p>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Contact" />
            <CardBody>
              <DescriptionList
                className="sm:grid-cols-1"
                items={[
                  ['Name', v.contactName],
                  ['Mobile', formatPhone(v.phone)],
                  [
                    'Email',
                    <a key="e" href={`mailto:${v.email}`} className="text-primary hover:underline">
                      {v.email}
                    </a>,
                  ],
                  [
                    'Address',
                    v.address && [v.address.line1, v.address.line2, `${v.address.city}, ${v.address.state} ${v.address.pincode}`].filter(Boolean).join(', '),
                  ],
                  ['Last sign-in', formatDateTime(v.lastLoginAt)],
                ]}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Bank account"
              action={
                v.bank &&
                !bank && (
                  <Button variant="ghost" size="sm" loading={reveal.isPending} onClick={() => reveal.mutate()}>
                    <Eye /> Reveal
                  </Button>
                )
              }
            />
            <CardBody>
              {v.bank ? (
                <DescriptionList
                  className="sm:grid-cols-1"
                  items={[
                    ['Account holder', v.bank.accountHolderName],
                    [
                      'Account number',
                      <span key="n" className="font-mono">
                        {bank?.accountNumber ?? v.bank.accountNumberMasked}
                      </span>,
                    ],
                    [
                      'IFSC',
                      <span key="i" className="font-mono">
                        {v.bank.ifsc}
                      </span>,
                    ],
                    ['Bank', [v.bank.bankName, v.bank.branch].filter(Boolean).join(', ')],
                  ]}
                />
              ) : (
                <p className="text-sm text-slate-500">Not added yet.</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Products"
              action={
                <Link to={`/admin/products?vendor=${v._id}`} className="text-sm font-medium text-primary hover:underline">
                  View
                </Link>
              }
            />
            <CardBody className="grid grid-cols-3 gap-3 text-center">
              {[
                ['Live', stats.active ?? 0],
                ['Pending', stats.pending ?? 0],
                ['Drafts', stats.draft ?? 0],
              ].map(([label, n]) => (
                <div key={label} className="rounded-lg bg-slate-50 py-3">
                  <p className="text-xl font-semibold text-slate-900">{n}</p>
                  <p className="text-xs text-slate-500">{label}</p>
                </div>
              ))}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  )
}
