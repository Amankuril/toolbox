import { Download, FileCheck2, ReceiptText } from 'lucide-react'
import { useState } from 'react'
import { formatDate, formatINR } from '@/core/lib/format'
import { Button } from '@/ui/Button'
import { Card, CardBody, CardHeader } from '@/ui/Card'

const STATUS_TEXT = {
  awaiting_shipment: 'Issued once these items ship',
  ready: 'Ready to download',
  cancelled: 'No invoice: all items were cancelled',
}

/**
 * The order confirmation (sent when the order is confirmed) and the tax invoices, one per seller.
 * @param {{
 *   invoices?: Array,
 *   onDownload: (entry) => Promise<void>,
 *   showSeller?: boolean,
 *   confirmation?: { onDownload: () => Promise<void>, note?: React.ReactNode, action?: React.ReactNode },
 * }} props
 */
export function InvoicesCard({ invoices = [], onDownload, showSeller = true, confirmation }) {
  const [busy, setBusy] = useState(null)
  if (!invoices?.length && !confirmation) return null
  const single = invoices.length === 1

  return (
    <Card>
      <CardHeader
        title={confirmation ? 'Order documents' : single ? 'Tax invoice' : 'Tax invoices'}
        description={invoices.length > 1 ? 'Each seller invoices their own items.' : undefined}
      />
      <CardBody className="flex flex-col gap-3">
        {confirmation && (
          <div className="flex items-start gap-3 text-sm">
            <FileCheck2 className="size-5 shrink-0 text-slate-400" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-slate-900">Order confirmation</p>
              <p className="text-xs text-slate-500">{confirmation.note ?? 'Not a tax invoice'}</p>
              {confirmation.action}
            </div>
            <Button
              size="sm"
              variant="outline"
              loading={busy === 'confirmation'}
              onClick={async () => {
                setBusy('confirmation')
                await confirmation.onDownload()
                setBusy(null)
              }}
            >
              <Download /> PDF
            </Button>
          </div>
        )}
        {invoices.map((inv) => {
          const available = inv.status === 'issued' || inv.status === 'ready'
          return (
            <div key={inv.vendor} className="flex items-center gap-3 text-sm">
              <ReceiptText className="size-5 shrink-0 text-slate-400" />
              <div className="min-w-0 flex-1">
                {confirmation && single && <p className="font-semibold text-slate-900">Tax invoice</p>}
                {showSeller && !single && <p className="truncate font-semibold text-slate-900">{inv.storeName}</p>}
                {inv.status === 'issued' ? (
                  <>
                    <p className="font-mono text-xs font-semibold text-slate-900">{inv.number}</p>
                    <p className="text-xs text-slate-500">
                      {formatDate(inv.issuedAt)} · {formatINR(inv.total)}
                    </p>
                  </>
                ) : (
                  <p className="text-slate-500">{STATUS_TEXT[inv.status]}</p>
                )}
              </div>
              {available && (
                <Button
                  size="sm"
                  variant="outline"
                  loading={busy === inv.vendor}
                  onClick={async () => {
                    setBusy(inv.vendor)
                    await onDownload(inv)
                    setBusy(null)
                  }}
                >
                  <Download /> PDF
                </Button>
              )}
            </div>
          )
        })}
      </CardBody>
    </Card>
  )
}
