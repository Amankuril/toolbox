import { useQuery, useQueryClient } from '@tanstack/react-query'
import { downloadPdf } from '@/modules/shared/download'
import { InvoicesCard } from '@/modules/shared/invoices'
import { BadgeCheck } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/ui/Button'
import { Link, useParams } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/core/api/errors'
import { formatDateTime, formatINR } from '@/core/lib/format'
import {
  ActivityTimeline,
  CustomerCard,
  NoteCard,
  OrderFacts,
  OrderHeader,
  OrderProgress,
  PaymentCard,
  SellerItems,
  PickupCard,
  ShipToCard,
} from '@/modules/shared/orderDetail'
import { ItemStatusActions, OrderItemRow } from '@/modules/shared/orders'
import { Alert, Skeleton } from '@/ui/Card'
import { useAdminAccess } from '../access'
import { CashCollectedButton, cashDue } from '../CashCollected'
import { adminApi, adminKeys } from '../api'
import { VendorShipments } from '../shipping'

export default function OrderDetailPage() {
  const { id } = useParams()
  const qc = useQueryClient()
  const { can } = useAdminAccess()
  const { data: o, isLoading } = useQuery({ queryKey: adminKeys.order(id), queryFn: () => adminApi.order(id) })
  const { data: invoices } = useQuery({ queryKey: adminKeys.orderInvoices(id), queryFn: () => adminApi.orderInvoices(id) })
  // Only needs to know whether shipping is on: doesn't require the Settings permission.
  const { data: shipping } = useQuery({ queryKey: adminKeys.shippingStatus, queryFn: adminApi.shippingStatus, staleTime: 60_000 })
  const shippingOn = Boolean(shipping?.enabled)
  const { data: shipments = [] } = useQuery({ queryKey: adminKeys.shipments(id), queryFn: () => adminApi.shipments(id), enabled: shippingOn })
  const runShipment = useShipmentRunner(id, qc)

  const updateItem = (itemId) => async (body) => {
    try {
      const updated = await adminApi.updateOrderItem(id, itemId, body)
      qc.setQueryData(adminKeys.order(id), updated)
      qc.invalidateQueries({ queryKey: ['admin', 'orders'] })
      qc.invalidateQueries({ queryKey: adminKeys.orderInvoices(id) })
      toast.success('Order updated')
    } catch (err) {
      toast.error(errorMessage(err))
      throw err
    }
  }

  if (isLoading || !o) return <Skeleton className="h-96" />

  // Group lines by vendor: each vendor fulfils their own items.
  const groups = Object.values(
    o.items.reduce((acc, item) => {
      const key = item.vendor?._id ?? item.vendor
      ;(acc[key] ??= { vendor: item.vendor, items: [] }).items.push(item)
      return acc
    }, {}),
  )

  return (
    <>
      <OrderHeader order={o} back={{ to: '/admin/orders', label: 'Orders' }} />

      {o.status === 'pending_payment' && (
        <Alert tone="warning" title="Awaiting payment" className="mb-6">
          Stock is held until {formatDateTime(o.expiresAt)}. The order is cancelled automatically if payment doesn&apos;t arrive.
          {o.payment.failureReason && ` Last attempt: ${o.payment.failureReason}.`}
        </Alert>
      )}
      <OrderProgress order={o} />
      <OrderFacts order={o} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          {groups.map((g) => (
            <SellerItems
              key={g.vendor?._id ?? 'unknown'}
              title={
                g.vendor?.isPlatform ? (
                  <span className="flex flex-wrap items-center gap-2">
                    {g.vendor.store?.name}
                    <span className="inline-flex items-center gap-1 rounded-sm bg-primary px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-primary-fg uppercase">
                      <BadgeCheck className="size-3" /> Our store
                    </span>
                    {can('store') && (
                      <Link to={`/admin/store/orders/${o._id}`} className="text-xs font-semibold text-primary hover:underline">
                        Open in store orders
                      </Link>
                    )}
                  </span>
                ) : (
                  (g.vendor?.store?.name ?? 'Seller')
                )
              }
              subtitle={`${g.items.length} ${g.items.length === 1 ? 'line' : 'lines'} fulfilled by ${g.vendor?.isPlatform ? 'your store' : 'this seller'}`}
              contactPhone={g.vendor?.phone}
              items={g.items}
              footer={
                shippingOn && (
                  <VendorShipments
                    shipments={shipments.filter((s) => String(s.vendor) === String(g.vendor?._id ?? g.vendor))}
                    canCreate={['placed', 'processing'].includes(o.status)}
                    onCreate={async () => {
                      const result = await runShipment(() => adminApi.createShipments(id), 'Shipments created').catch(() => null)
                      // Seller-level failures stay retryable on the shipment; surface the first one.
                      if (result?.errors?.length) toast.error(result.errors[0].message)
                    }}
                    run={runShipment}
                  />
                )
              }
            >
              {g.items.map((item) => (
                <OrderItemRow
                  key={item._id}
                  item={item}
                  actions={
                    <ItemStatusActions
                      item={item}
                      onUpdate={updateItem(item._id)}
                      disabled={o.status === 'pending_payment'}
                      pickup={o.pickups?.some((p) => String(p.vendor) === String(item.vendor?._id ?? item.vendor))}
                    />
                  }
                />
              ))}
            </SellerItems>
          ))}
          <ActivityTimeline order={o} />
        </div>

        <aside className="flex flex-col gap-6">
          <NoteCard note={o.notes} />
          <InvoicesCard
            invoices={o.status === 'pending_payment' ? [] : invoices}
            onDownload={(inv) => downloadPdf(() => adminApi.orderInvoicePdf(id, inv.vendor), `Invoice-${o.orderNumber}.pdf`)}
            confirmation={
              o.status === 'pending_payment' || o.status === 'cancelled'
                ? undefined
                : {
                    onDownload: () => downloadPdf(() => adminApi.orderConfirmationPdf(id), `Order-${o.orderNumber}.pdf`),
                    note: confirmationNote(o.confirmationEmail),
                    action: can('orders', 'manage') && o.confirmationEmail?.status !== 'sending' && (
                      <ResendConfirmation orderId={id} sent={o.confirmationEmail?.status === 'sent'} />
                    ),
                  }
            }
          />
          <PaymentCard
            order={o}
            note={
              cashDue(o) && can('orders', 'manage') ? (
                <CashCollectedButton order={o} variant="primary" className="w-full" />
              ) : o.payment.cashCollected ? (
                <p className="text-xs text-slate-600">Cash collected {formatDateTime(o.payment.cashCollected.at)}</p>
              ) : (
                o.refunds?.length > 0 && (
                  <div className="flex flex-col gap-1 border-t border-slate-100 pt-3 text-xs text-slate-600">
                    <p className="eyebrow">Refunds</p>
                    {o.refunds.map((r) => (
                      <p key={r.providerRefundId ?? r.at} className="flex justify-between gap-2">
                        <span>
                          {formatDateTime(r.at)} · {r.status}
                        </span>
                        <span className="tabular font-semibold text-slate-900">{formatINR(r.amount)}</span>
                      </p>
                    ))}
                  </div>
                )
              )
            }
          />
          <CustomerCard user={o.user} billing={o.billing} />
          <PickupCard pickups={o.pickups} sellers={Object.fromEntries(o.items.map((i) => [String(i.vendor?._id ?? i.vendor), i.vendor?.store?.name]))} />
          <ShipToCard address={o.shippingAddress} />
        </aside>
      </div>
    </>
  )
}

/** Runs a shipment action, toasts the outcome, and refreshes the order and its shipments. */
function useShipmentRunner(orderId, qc) {
  return async (fn, message) => {
    try {
      const result = await fn()
      toast.success(message)
      return result
    } catch (err) {
      toast.error(errorMessage(err))
      throw err
    } finally {
      qc.invalidateQueries({ queryKey: adminKeys.shipments(orderId) })
      qc.invalidateQueries({ queryKey: adminKeys.order(orderId) })
    }
  }
}

function confirmationNote(email) {
  if (!email) return 'Emailing the buyer…'
  if (email.status === 'sent') return `Emailed to the buyer ${formatDateTime(email.at)}`
  if (email.status === 'sending') return 'Emailing the buyer…'
  if (email.status === 'skipped') return `Not emailed: ${email.error ?? 'no email address'}`
  return `Email failed: ${email.error ?? 'unknown error'}. Retrying automatically.`
}

/** Sends the buyer's order confirmation email again (e.g. after they added an email address). */
function ResendConfirmation({ orderId, sent }) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  return (
    <Button
      variant="link"
      size="xs"
      loading={busy}
      onClick={async () => {
        setBusy(true)
        try {
          await adminApi.resendOrderConfirmation(orderId)
          toast.success('Order confirmation emailed')
        } catch (err) {
          toast.error(errorMessage(err))
        } finally {
          setBusy(false)
          qc.invalidateQueries({ queryKey: adminKeys.order(orderId) })
        }
      }}
    >
      {sent ? 'Send email again' : 'Send email now'}
    </Button>
  )
}
