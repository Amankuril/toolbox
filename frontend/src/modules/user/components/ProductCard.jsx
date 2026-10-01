import { ChevronLeft, ChevronRight, ShoppingCart } from 'lucide-react'
import { useRef } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { cn } from '@/core/lib/cn'
import { Price, Thumb } from '@/ui/Brand'
import { Button } from '@/ui/Button'
import { Skeleton } from '@/ui/Card'
import { useCart } from '../cart/useCart'

export function ProductCard({ product: p, className }) {
  const cart = useCart()
  const navigate = useNavigate()
  const inCart = cart.quantityOf(p._id)

  const add = async () => {
    try {
      await cart.setQty(p._id, Math.max(p.moq, inCart + 1))
      toast.success('Added to cart', { description: p.name, action: { label: 'View cart', onClick: () => navigate('/cart') } })
    } catch {
      /* toast already shown */
    }
  }

  // The link and the button are siblings: interactive elements can't nest inside an <a>.
  return (
    <div
      className={cn('group relative flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white transition-shadow hover:shadow-lg', className)}
    >
      <Link to={`/p/${p.slug}`} className="flex flex-1 flex-col focus-visible:outline-offset-[-2px]">
        <div className="relative aspect-square bg-white p-3">
          <Thumb src={p.image?.url} alt={p.image?.alt ?? p.name} className="size-full transition-transform duration-300 group-hover:scale-[1.03]" />
          <div className="absolute top-2 left-2 flex flex-col items-start gap-1">
            {p.discountPercent >= 5 && <span className="rounded bg-accent px-1.5 py-0.5 text-[11px] font-bold text-accent-fg">{p.discountPercent}% OFF</span>}
            {p.type === 'part' && <span className="rounded bg-slate-900/80 px-1.5 py-0.5 text-[11px] font-semibold text-white">Spare part</span>}
            {p.condition !== 'new' && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800 capitalize">{p.condition}</span>
            )}
          </div>
          {!p.inStock && (
            <span className="absolute inset-x-0 bottom-2 mx-auto w-fit rounded bg-white/95 px-2 py-0.5 text-xs font-semibold text-red-600 shadow">
              Out of stock
            </span>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-1.5 border-t border-slate-100 px-3 pt-3">
          {p.brand && <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">{p.brand}</p>}
          <h3 className="line-clamp-2 min-h-10 text-sm leading-5 font-medium text-slate-800 group-hover:text-primary">{p.name}</h3>
          <Price price={p.price} mrp={p.mrp} size="sm" className="mt-auto pt-1" />
          {p.moq > 1 && (
            <p className="text-xs text-slate-500">
              Min. order {p.moq} {p.unit}s
            </p>
          )}
        </div>
      </Link>
      <div className="px-3 pt-1.5 pb-3">
        <Button size="sm" variant={inCart ? 'soft' : 'outline'} className="w-full" disabled={!p.inStock} onClick={add} aria-label={`Add ${p.name} to cart`}>
          <ShoppingCart /> {inCart ? `In cart (${inCart})` : 'Add to cart'}
        </Button>
      </div>
    </div>
  )
}

export function ProductCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <Skeleton className="aspect-square rounded-none" />
      <div className="flex flex-col gap-2 p-3">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-full" />
      </div>
    </div>
  )
}

export function ProductGrid({ products, loading, count = 8 }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
      {loading ? Array.from({ length: count }, (_, i) => <ProductCardSkeleton key={i} />) : products.map((p) => <ProductCard key={p._id} product={p} />)}
    </div>
  )
}

/** Horizontal scroller of product cards with arrow controls. */
export function ProductRail({ title, subtitle, products, loading, viewAll }) {
  const ref = useRef(null)
  if (!loading && !products?.length) return null
  const scroll = (dir) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.85, behavior: 'smooth' })
  return (
    <section className="mx-auto mt-10 max-w-7xl px-4 sm:px-6">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">
          {viewAll && (
            <Link to={viewAll} className="text-sm font-semibold text-primary hover:underline">
              View all
            </Link>
          )}
          <Button variant="outline" size="icon-sm" className="hidden sm:inline-flex" aria-label="Scroll left" onClick={() => scroll(-1)}>
            <ChevronLeft />
          </Button>
          <Button variant="outline" size="icon-sm" className="hidden sm:inline-flex" aria-label="Scroll right" onClick={() => scroll(1)}>
            <ChevronRight />
          </Button>
        </div>
      </div>
      <div ref={ref} className="scrollbar-none -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:gap-4 sm:px-0">
        {(loading ? Array.from({ length: 6 }, (_, i) => ({ _id: i })) : products).map((p) => (
          <div key={p._id} className="w-[46%] shrink-0 snap-start sm:w-[30%] lg:w-[23%] xl:w-[18.5%]">
            {loading ? <ProductCardSkeleton /> : <ProductCard product={p} className="h-full" />}
          </div>
        ))}
      </div>
    </section>
  )
}
