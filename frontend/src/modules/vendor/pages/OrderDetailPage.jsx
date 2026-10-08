import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/core/api/errors'
import { formatINR } from '@/core/lib/format'
import { downloadPdf } from '@/modules/shared/download'
import { InvoicesCard } from '@/modules/shared/invoices'
import { ActivityTimeline, NoteCard, OrderFacts, OrderHeader, OrderProgress, PaymentCard, SellerItems, ShipToCard } from '@/modules/shared/orderDetail'
import { ItemStatusActions, OrderItemRow } from '@/modules/shared/orders'
import { LabelButton, ScanList, ShipmentFacts, ShipmentStatusBadge } from '@/modules/shared/shipments'
import { Card, CardBody, CardHeader, Skeleton } from '@/ui/Card'
import { useSeller } from '../seller'

export default function VendorOrderDetailPage() {
  const seller = useSeller()
  const { id } = useParams()
  const qc = useQueryClient()
  const { data: o, isLoading } = useQuery({ queryKey: seller.keys.order(id), queryFn: () => seller.api.order(id) })
  const { data: shipments = [] } = useQuery({ queryKey: seller.keys.shipments(id), queryFn: () => seller.api.shipments(id) })
  const { data: invoice } = useQuery({ queryKey: seller.keys.invoice(id), queryFn: () => seller.api.invoice(id) })

  const updateItem = (itemId) => async (body) => {
    try {
      const updated = await seller.api.updateOrderItem(id, itemId, body)
      qc.setQueryData(seller.keys.order(id), updated)
      qc.invalidateQueries({ queryKey: [...seller.keys.all, 'orders'] })
      qc.invalidateQueries({ queryKey: seller.keys.dashboard })
      // Shipping the last line issues the invoice.
      qc.invalidateQueries({ queryKey: seller.keys.invoice(id) })
      toast.success('Order updated')
    } catch (err) {
      toast.error(errorMessage(err))
      throw err
    }
  }

  if (isLoading || !o) return <Skeleton className="h-96" />

  const cod = ['cod', 'partial'].includes(o.payment.method)

  return (
    <>
      <OrderHeader order={o} back={{ to: `${seller.base}/orders`, label: 'Orders' }} />
      <OrderProgress order={o} />
      <OrderFacts order={o} total={o.amounts.subtotal} label="Your items" />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          <SellerItems title="Your items" subtitle="Move each item forward as you fulfil it. The customer sees every update." items={o.items}>
            {o.items.map((item) => (
              <OrderItemRow key={item._id} item={item} actions={<ItemStatusActions item={item} onUpdate={updateItem(item._id)} />} />
            ))}
          </SellerItems>
          <ActivityTimeline order={o} />
        </div>

        <aside className="flex flex-col gap-6">
          <NoteCard note={o.notes} />
          {shipments
            .filter((s) => s.status !== 'pending')
            .map((s) => (
              <Card key={s._id}>
                <CardHeader
                  title={s.type === 'return' ? 'Return pickup' : 'Shipment'}
                  description={<span className="code">{s.providerOrderId}</span>}
                  action={<ShipmentStatusBadge status={s.status} />}
                />
                <CardBody className="flex flex-col gap-4">
                  <ShipmentFacts
                    shipment={s}
                    extra={[s.paymentType === 'cod' && s.type === 'forward' && ['Collect on delivery', formatINR(s.codAmount ?? 0)]]}
                  />
                  <ScanList scans={s.tracking.scans} />
                  <div className="print:hidden">
                    <LabelButton shipment={s} fetchLabel={seller.api.shipmentLabel} />
                  </div>
                </CardBody>
              </Card>
            ))}
          <InvoicesCard
            invoices={invoice ? [invoice] : []}
            showSeller={false}
            onDownload={() => downloadPdf(() => seller.api.invoicePdf(id), `Invoice-${o.orderNumber}.pdf`)}
          />
          <ShipToCard address={o.shippingAddress} billing={o.billing} showGstin />
          <PaymentCard
            order={o}
            title="Payment"
            // Your lines before and after your coupon; the total is what you're paid for.
            amounts={{
              subtotal: o.amounts.subtotal + (o.amounts.discount ?? 0),
              discount: o.amounts.discount ?? 0,
              shipping: 0,
              tax: o.amounts.tax,
              total: o.amounts.subtotal,
            }}
            note={
              cod && (
                <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  {o.payment.method === 'partial'
                    ? 'The customer paid an advance online. The courier collects the rest in cash on delivery.'
                    : 'Cash on delivery: the courier collects payment; the order is marked paid once every item is delivered.'}
                </p>
              )
            }
          />
        </aside>
      </div>
    </>
  )
}
