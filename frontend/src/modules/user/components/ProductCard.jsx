import { ChevronLeft, ChevronRight, Layers, Plus } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { cn } from '@/core/lib/cn'
import { formatINR } from '@/core/lib/format'
import { Thumb } from '@/ui/Brand'
import { Button } from '@/ui/Button'
import { Skeleton } from '@/ui/Card'
import { useCart } from '../cart/useCart'
import { unitShort } from '@/core/lib/units'

/** "550 W · 13 mm" — the two specs that matter most, straight from the listing. */
const keyFacts = (p) =>
  (p.highlights ?? [])
    .slice(0, 2)
    .map((h) => h.value)
    .join(' · ')

export function Availability({ product: p, className }) {
  if (!p.inStock) return <p className={cn('text-xs font-medium text-red-600', className)}>Out of stock</p>
  return (
    <p className={cn('flex items-center gap-1.5 text-xs text-slate-600', className)}>
      <span className="size-1.5 rounded-full bg-accent" aria-hidden />
      {p.lowStock ? `Only ${p.lowStock} left` : 'In stock'}
      {p.dispatchDays != null && <span className="text-slate-400">· ships in {p.dispatchDays === 0 ? '24 h' : `${p.dispatchDays} d`}</span>}
    </p>
  )
}

export function BulkHint({ bulk, unit, className }) {
  if (!bulk) return null
  return (
    <p className={cn('flex items-center gap-1 text-xs font-medium text-accent-ink', className)}>
      <Layers className="size-3.5 shrink-0" />
      {formatINR(bulk.fromPrice)}/{unitShort(unit)} at {bulk.tiers.at(-1).minQty}+
      {bulk.businessOnly && <span className="font-normal text-slate-500"> · business</span>}
    </p>
  )
}

function useAddToCart(p) {
  const cart = useCart()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const inCart = cart.quantityOf(p._id)
  const add = async () => {
    // Variant products need an option picked on the product page.
    if (p.hasVariants) return navigate(`/p/${p.slug}`)
    setBusy(true)
    try {
      await cart.setQty(p._id, Math.max(p.moq, inCart + 1))
      toast.success('Added to cart', { description: p.name, action: { label: 'View cart', onClick: () => navigate('/cart') } })
    } catch {
      /* toast already shown */
    } finally {
      setBusy(false)
    }
  }
  return { add, busy, inCart }
}

/** Catalogue tile. The link and the button are siblings: interactive elements can't nest inside an <a>. */
export function ProductCard({ product: p, className }) {
  const { add, busy, inCart } = useAddToCart(p)
  const facts = keyFacts(p)
  return (
    <article className={cn('group relative flex flex-col bg-white', className)}>
      <Link to={`/p/${p.slug}`} className="flex flex-1 flex-col focus-visible:outline-offset-2">
        <div className="relative aspect-square overflow-hidden rounded-md bg-[#f4f4f2] p-4">
          <Thumb
            src={p.image?.url}
            alt={p.image?.alt ?? p.name}
            className="size-full bg-transparent mix-blend-multiply transition-transform duration-300 group-hover:scale-[1.04]"
          />
          {p.discountPercent >= 5 && (
            <span className="absolute top-2 left-2 rounded-sm bg-white px-1.5 py-0.5 text-[11px] font-bold tracking-wide text-accent-ink shadow-xs">
              −{p.discountPercent}%
            </span>
          )}
          {p.type === 'part' && (
            <span className="absolute top-2 right-2 rounded-sm bg-secondary px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-secondary-fg uppercase">
              Part
            </span>
          )}
        </div>
        <div className="flex flex-1 flex-col pt-3">
          {p.brand && <p className="text-[11px] font-semibold tracking-[0.08em] text-slate-500 uppercase">{p.brand}</p>}
          <h3 className="mt-0.5 line-clamp-2 text-[15px] leading-snug font-medium text-slate-900 group-hover:underline group-hover:decoration-slate-300 group-hover:underline-offset-2">
            {p.name}
          </h3>
          {facts && <p className="mt-1 truncate text-xs text-slate-500">{facts}</p>}
          <div className="mt-auto pt-2">
            <p className="flex items-baseline gap-2">
              <span className="font-display text-[1.375rem] leading-none font-bold text-slate-900">
                {p.hasVariants && <span className="mr-1 text-xs font-normal text-slate-500">From</span>}
                {formatINR(p.price)}
              </span>
              {p.mrp > p.price && <span className="text-xs text-slate-400 line-through">{formatINR(p.mrp)}</span>}
            </p>
            <BulkHint bulk={p.bulk} unit={p.unit} className="mt-1" />
            <Availability product={p} className="mt-1.5" />
          </div>
        </div>
      </Link>
      <Button
        size="sm"
        variant={inCart ? 'soft' : 'outline'}
        className="mt-3 w-full border-slate-300 font-semibold"
        disabled={!p.inStock}
        loading={busy}
        onClick={add}
        aria-label={`Add ${p.name} to cart`}
      >
        {p.hasVariants ? 'Choose options' : inCart ? `In cart · ${inCart}` : p.moq > 1 ? `Add ${p.moq} ${unitShort(p.unit)}` : 'Add to cart'}
      </Button>
    </article>
  )
}

/** Dense row for list view: specs up front, like a trade catalogue. */
export function ProductRow({ product: p }) {
  const { add, busy, inCart } = useAddToCart(p)
  return (
    <article className="group grid grid-cols-[96px_1fr] gap-4 border-b border-slate-200 py-4 sm:grid-cols-[120px_1fr_200px]">
      <Link to={`/p/${p.slug}`} className="aspect-square overflow-hidden rounded-md bg-[#f4f4f2] p-2">
        <Thumb src={p.image?.url} alt={p.name} className="size-full bg-transparent mix-blend-multiply" />
      </Link>
      <div className="min-w-0">
        {p.brand && <p className="text-[11px] font-semibold tracking-[0.08em] text-slate-500 uppercase">{p.brand}</p>}
        <Link to={`/p/${p.slug}`} className="mt-0.5 block font-medium text-slate-900 hover:underline">
          {p.name}
        </Link>
        {p.modelNumber && <p className="text-xs text-slate-500">Model {p.modelNumber}</p>}
        {p.highlights?.length > 0 && (
          <dl className="mt-2 grid max-w-md grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-xs">
            {p.highlights.map((h) => (
              <div key={h.label} className="contents">
                <dt className="text-slate-500">{h.label}</dt>
                <dd className="text-slate-800">{h.value}</dd>
              </div>
            ))}
          </dl>
        )}
        <Availability product={p} className="mt-2" />
      </div>
      <div className="col-span-2 flex items-end justify-between gap-3 sm:col-span-1 sm:flex-col sm:items-end sm:justify-start sm:text-right">
        <div>
          <p className="font-display text-2xl leading-none font-bold text-slate-900">
            {p.hasVariants && <span className="mr-1 text-xs font-normal text-slate-500">From</span>}
            {formatINR(p.price)}
          </p>
          {p.mrp > p.price && (
            <p className="mt-1 text-xs text-slate-500">
              <span className="line-through">{formatINR(p.mrp)}</span> <span className="font-semibold text-accent-ink">−{p.discountPercent}%</span>
            </p>
          )}
          <BulkHint bulk={p.bulk} unit={p.unit} className="mt-1 sm:justify-end" />
        </div>
        <Button size="sm" variant={inCart ? 'soft' : 'primary'} disabled={!p.inStock} loading={busy} onClick={add} className="sm:w-full">
          {p.hasVariants ? (
            'Choose options'
          ) : (
            <>
              <Plus /> {inCart ? `In cart · ${inCart}` : p.moq > 1 ? `Add ${p.moq}` : 'Add'}
            </>
          )}
        </Button>
      </div>
    </article>
  )
}

export function ProductCardSkeleton() {
  return (
    <div>
      <Skeleton className="aspect-square rounded-md" />
      <div className="flex flex-col gap-2 pt-3">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-8 w-full" />
      </div>
    </div>
  )
}

export function ProductGrid({ products, loading, count = 10, view = 'grid' }) {
  if (view === 'list' && !loading) {
    return (
      <div className="border-t border-slate-200">
        {products.map((p) => (
          <ProductRow key={p._id} product={p} />
        ))}
      </div>
    )
  }
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {loading ? Array.from({ length: count }, (_, i) => <ProductCardSkeleton key={i} />) : products.map((p) => <ProductCard key={p._id} product={p} />)}
    </div>
  )
}

/** Section heading used across the storefront: condensed title, optional subtitle, link on the right. */
export function SectionHeading({ title, subtitle, action, className }) {
  return (
    <div className={cn('mb-5 flex items-end justify-between gap-4 border-b border-slate-200 pb-3', className)}>
      <div className="min-w-0">
        <h2 className="font-display text-[1.65rem] leading-tight font-bold text-slate-900">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

/** Horizontal scroller of product tiles with arrow controls. */
export function ProductRail({ title, subtitle, products, loading, viewAll, className }) {
  const ref = useRef(null)
  if (!loading && !products?.length) return null
  const scroll = (dir) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.85, behavior: 'smooth' })
  return (
    <section className={cn('mx-auto max-w-7xl px-4 sm:px-6', className)}>
      <SectionHeading
        title={title}
        subtitle={subtitle}
        action={
          <div className="flex shrink-0 items-center gap-1">
            {viewAll && (
              <Link
                to={viewAll}
                className="mr-2 text-sm font-semibold text-slate-900 underline decoration-slate-300 underline-offset-4 hover:decoration-slate-900"
              >
                View all
              </Link>
            )}
            <Button variant="ghost" size="icon-sm" className="hidden sm:inline-flex" aria-label="Scroll left" onClick={() => scroll(-1)}>
              <ChevronLeft />
            </Button>
            <Button variant="ghost" size="icon-sm" className="hidden sm:inline-flex" aria-label="Scroll right" onClick={() => scroll(1)}>
              <ChevronRight />
            </Button>
          </div>
        }
      />
      <div ref={ref} className="scrollbar-none -mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
        {(loading ? Array.from({ length: 6 }, (_, i) => ({ _id: i })) : products).map((p) => (
          <div key={p._id} className="w-[46%] shrink-0 snap-start sm:w-[30%] lg:w-[23%] xl:w-[18.6%]">
            {loading ? <ProductCardSkeleton /> : <ProductCard product={p} className="h-full" />}
          </div>
        ))}
      </div>
    </section>
  )
}
