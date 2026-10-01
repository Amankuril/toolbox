import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Clock, ShoppingCart, X } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/core/api/errors'
import { formatDateTime } from '@/core/lib/format'
import { OfferBreakdown, QuoteRequestFacts, QuoteStatus, QuoteTimeline } from '@/modules/shared/quotes'
import { Button } from '@/ui/Button'
import { Alert, Skeleton } from '@/ui/Card'
import { ConfirmDialog } from '@/ui/Dialog'
import { PageHeader } from '@/ui/PageHeader'
import { ReasonDialog } from '@/ui/ReasonDialog'
import { storeKeys, userApi } from '../../api'

export default function MyQuoteDetailPage() {
  const { id } = useParams()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { data: q, isLoading } = useQuery({ queryKey: storeKeys.quote(id), queryFn: () => userApi.quote(id), refetchInterval: (query) => (query.state.data?.status === 'requested' ? 30_000 : false) })

  const refresh = (quote) => {
    qc.setQueryData(storeKeys.quote(id), quote)
    qc.invalidateQueries({ queryKey: ['user', 'quotes'] })
  }
  const onError = (e) => toast.error(errorMessage(e))
  const accept = useMutation({
    mutationFn: () => userApi.acceptQuote(id),
    onSuccess: ({ quote, cart }) => {
      refresh(quote)
      qc.setQueryData(storeKeys.cart, cart)
      toast.success('Added to your cart at the quoted price')
      navigate('/cart')
    },
    onError,
  })
  const reject = useMutation({ mutationFn: (reason) => userApi.rejectQuote(id, reason), onSuccess: (quote) => (refresh(quote), toast.success('Offer declined')), onError })
  const withdraw = useMutation({ mutationFn: () => userApi.withdrawQuote(id), onSuccess: (quote) => (refresh(quote), toast.success('Request withdrawn')), onError })

  if (isLoading || !q) return <Skeleton className="h-96" />

  return (
    <>
      <title>{`Quote ${q.number}`}</title>
      <PageHeader back={{ to: '/account/quotes', label: 'Bulk quotes' }} title={`Quote ${q.number}`} meta={<QuoteStatus status={q.status} />} description={`From ${q.vendor?.store?.name ?? 'the seller'}`} />

      <div className="flex flex-col gap-6">
        <QuoteRequestFacts quote={q} />

        {q.status === 'requested' && (
          <Alert tone="neutral" icon={Clock} title="Waiting for the seller">
            You’ll see their price here as soon as they reply.
          </Alert>
        )}

        {q.offer && <OfferBreakdown quote={q} />}

        {q.status === 'quoted' && (
          <div className="flex flex-wrap gap-3">
            <Button size="lg" loading={accept.isPending} onClick={() => accept.mutate()}>
              <Check /> Accept & add to cart
            </Button>
            <ReasonDialog
              title="Decline this offer?"
              description="Optionally tell the seller why, e.g. your target price."
              label="Reason"
              required={false}
              confirmLabel="Decline offer"
              onSubmit={(reason) => reject.mutateAsync(reason || undefined)}
              trigger={
                <Button size="lg" variant="outline">
                  <X /> Decline
                </Button>
              }
            />
          </div>
        )}
        {q.status === 'accepted' && (
          <Alert
            tone="success"
            title="Accepted"
            action={
              <Button size="sm" loading={accept.isPending} onClick={() => accept.mutate()}>
                <ShoppingCart /> Go to cart
              </Button>
            }
          >
            Check out before {formatDateTime(q.offer.validUntil)} to keep this price.
          </Alert>
        )}
        {q.status === 'ordered' && q.order && (
          <Alert tone="success" title="Ordered">
            <Link to={`/account/orders/${q.order}`} className="font-semibold underline">
              View the order
            </Link>
          </Alert>
        )}
        {q.status === 'declined' && (
          <Alert tone="danger" title="The seller declined">
            {q.declineReason}
          </Alert>
        )}
        {q.status === 'expired' && (
          <Alert tone="neutral" title="This offer expired">
            You can request a new quote from the product page.
          </Alert>
        )}

        {['requested', 'quoted', 'accepted'].includes(q.status) && (
          <ConfirmDialog
            title="Withdraw this request?"
            description="The seller won't be able to send or honour an offer for it."
            confirmLabel="Withdraw"
            onConfirm={() => withdraw.mutateAsync()}
            trigger={
              <button type="button" className="self-start text-sm font-medium text-slate-500 underline underline-offset-2 hover:text-slate-900">
                Withdraw request
              </button>
            }
          />
        )}

        <section>
          <h2 className="mb-3 font-display text-xl font-bold text-slate-900">History</h2>
          <QuoteTimeline history={q.history} />
        </section>
        <Link to={`/p/${q.product.slug}`} className="text-sm font-semibold text-slate-900 underline underline-offset-2">
          View product
        </Link>
      </div>
    </>
  )
}
