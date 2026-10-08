import { Download, ReceiptText } from 'lucide-react'
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
 * Tax invoices for an order, one per seller.
 * @param {{ invoices?: Array, onDownload: (entry) => Promise<void>, showSeller?: boolean }} props
 */
export function InvoicesCard({ invoices, onDownload, showSeller = true }) {
  const [busy, setBusy] = useState(null)
  if (!invoices?.length) return null
  const single = invoices.length === 1

  return (
    <Card>
      <CardHeader title={single ? 'Tax invoice' : 'Tax invoices'} description={single ? undefined : 'Each seller invoices their own items.'} />
      <CardBody className="flex flex-col gap-3">
        {invoices.map((inv) => {
          const available = inv.status === 'issued' || inv.status === 'ready'
          return (
            <div key={inv.vendor} className="flex items-center gap-3 text-sm">
              <ReceiptText className="size-5 shrink-0 text-slate-400" />
              <div className="min-w-0 flex-1">
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
