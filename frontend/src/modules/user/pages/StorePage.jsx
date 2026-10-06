import { useQuery } from '@tanstack/react-query'
import { BadgeCheck, MapPin } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { formatDate } from '@/core/lib/format'
import { useBranding } from '@/core/settings/usePublicSettings'
import { Thumb } from '@/ui/Brand'
import { Button } from '@/ui/Button'
import { EmptyState, Skeleton } from '@/ui/Card'
import { storeApi, storeKeys } from '../api'
import { ProductListing } from '../components/ProductListing'

export default function StorePage() {
  const { slug } = useParams()
  const { siteName } = useBranding()
  const { data: store, isLoading, isError } = useQuery({ queryKey: storeKeys.store(slug), queryFn: () => storeApi.store(slug), retry: false })

  if (isError) {
    return (
      <EmptyState
        title="Store not found"
        description="This seller may no longer be active."
        action={
          <Button asChild>
            <Link to="/">Back to home</Link>
          </Button>
        }
      />
    )
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      {store && <title>{`${store.store.name} | ${siteName}`}</title>}
      <div className="mb-10 border-b border-slate-200 pb-8">
        {isLoading ? (
          <Skeleton className="h-16" />
        ) : (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <Thumb src={store.store.logo?.url} alt={store.store.name} className="size-16 shrink-0 rounded-lg border border-slate-200" />
            <div className="min-w-0 flex-1">
              <h1 className="flex flex-wrap items-center gap-3 font-display text-4xl font-bold text-slate-900">
                {store.store.name}
                {store.official ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-0.5 text-xs font-bold text-primary-fg">
                    <BadgeCheck className="size-3.5" /> Official store
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent-ink">
                    <BadgeCheck className="size-3.5" /> Reviewed seller
                  </span>
                )}
              </h1>
              <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500">
                {store.city && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="size-3.5" /> {store.city}, {store.state}
                  </span>
                )}
                <span>
                  On {siteName} since {formatDate(store.memberSince)}
                </span>
              </p>
              {store.store.description && <p className="mt-3 max-w-3xl text-sm whitespace-pre-line text-slate-600">{store.store.description}</p>}
            </div>
          </div>
        )}
      </div>
      <ProductListing
        key={slug}
        base={{ vendor: slug }}
        heading={<h2 className="font-display text-2xl font-bold text-slate-900">All products from this seller</h2>}
      />
    </div>
  )
}
