import { Heart, Trash2 } from 'lucide-react'
import { Link } from 'react-router'
import { useBranding } from '@/core/settings/usePublicSettings'
import { Thumb } from '@/ui/Brand'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/Card'
import { ProductCard, ProductCardSkeleton } from '../components/ProductCard'
import { useWishlistProducts } from '../wishlist/useWishlist'

/** Saved products. Signed-in lists come from the account; guests see their local list with a nudge to sign in. */
export default function WishlistPage() {
  const { siteName } = useBranding()
  const { wishlist, rows, isLoading: loading } = useWishlistProducts()
  const live = rows.filter((r) => r.available)
  const gone = rows.filter((r) => !r.available)

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <title>{`Wishlist | ${siteName}`}</title>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <p className="eyebrow">Saved for later</p>
          <h1 className="mt-1 font-display text-3xl font-extrabold tracking-tight text-slate-900">Wishlist</h1>
        </div>
        {!loading && rows.length > 0 && (
          <p className="text-sm text-slate-600">
            {rows.length} {rows.length === 1 ? 'item' : 'items'}
          </p>
        )}
      </div>

      {!wishlist.signedIn && wishlist.count > 0 && (
        <p className="mb-6 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          This list is saved on this device only.{' '}
          <Link to="/login?next=%2Fwishlist" className="font-semibold text-primary underline">
            Sign in
          </Link>{' '}
          to keep it on your account and see it everywhere.
        </p>
      )}

      {loading ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: Math.min(wishlist.count || 5, 10) }, (_, i) => (
            <ProductCardSkeleton key={i} />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Heart}
          title="Nothing saved yet"
          description="Tap the heart on any product to keep it here while you compare prices and specs."
          action={
            <Button asChild>
              <Link to="/search">Browse products</Link>
            </Button>
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {live.map((r) => (
              <ProductCard key={r.product._id} product={r.product} />
            ))}
          </div>
          {gone.length > 0 && (
            <section className="mt-12">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">No longer available</h2>
              <ul className="divide-y divide-slate-200 border-y border-slate-200">
                {gone.map((r) => (
                  <li key={r.product._id} className="flex items-center gap-4 py-3">
                    <Thumb src={r.product.image?.url} alt="" className="size-14 shrink-0 rounded-md opacity-60 grayscale" />
                    <p className="min-w-0 flex-1 truncate text-sm text-slate-600">{r.product.name}</p>
                    <Button size="sm" variant="ghost" onClick={() => wishlist.toggle(r.product)}>
                      <Trash2 /> Remove
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}
