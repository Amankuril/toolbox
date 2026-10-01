import { useQuery } from '@tanstack/react-query'
import { BadgeCheck, ChevronRight, FileText, Receipt, ShieldCheck, ShoppingCart, Truck, Wrench } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { useSession } from '@/core/auth/session'
import { PRODUCT_TYPE_LABEL } from '@/core/lib/constants'
import { cn } from '@/core/lib/cn'
import { formatINR, formatNumber } from '@/core/lib/format'
import { priceFor, usableTiers } from '@/core/lib/pricing'
import { useBranding } from '@/core/settings/usePublicSettings'
import { Thumb } from '@/ui/Brand'
import { Button } from '@/ui/Button'
import { EmptyState, Skeleton } from '@/ui/Card'
import { QuantityStepper } from '@/ui/inputs'
import { storeApi, storeKeys } from '../api'
import { useCart } from '../cart/useCart'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { BulkPricingTable } from '../components/BulkPricingTable'
import { ProductCard, ProductRail, SectionHeading } from '../components/ProductCard'
import { QuoteRequestDialog } from '../components/QuoteRequestDialog'
import { unitPlural, unitShort } from '@/core/lib/units'

export default function ProductPage() {
  const { slug } = useParams()
  const { data, isLoading, isError } = useQuery({ queryKey: storeKeys.product(slug), queryFn: () => storeApi.product(slug), retry: false })

  if (isError) {
    return (
      <EmptyState
        title="Product not available"
        description="It may be out of the catalogue or temporarily hidden."
        action={
          <Button asChild>
            <Link to="/">Continue shopping</Link>
          </Button>
        }
      />
    )
  }
  if (isLoading) {
    return (
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-6 sm:px-6 lg:grid-cols-[1.1fr_1fr]">
        <Skeleton className="aspect-square" />
        <div className="flex flex-col gap-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-10 w-3/4" />
          <Skeleton className="h-12 w-48" />
          <Skeleton className="h-40" />
        </div>
      </div>
    )
  }
  return <ProductView key={data.product._id} data={data} />
}

function Gallery({ images, name }) {
  const [index, setIndex] = useState(0)
  const current = images[index]
  return (
    <div className="flex flex-col-reverse gap-3 lg:flex-row">
      {images.length > 1 && (
        <div className="scrollbar-none flex gap-2 overflow-x-auto lg:max-h-[560px] lg:flex-col lg:overflow-y-auto">
          {images.map((img, i) => (
            <button
              key={img.media}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Show image ${i + 1}`}
              aria-current={i === index}
              className={cn(
                'size-16 shrink-0 overflow-hidden rounded-md border-2 bg-[#f4f4f2] p-1 sm:size-[72px]',
                i === index ? 'border-slate-900' : 'border-transparent hover:border-slate-300',
              )}
            >
              <Thumb src={img.url} alt="" className="size-full bg-transparent mix-blend-multiply" />
            </button>
          ))}
        </div>
      )}
      <div className="flex-1 overflow-hidden rounded-md bg-[#f4f4f2] p-6 sm:p-10">
        <Thumb src={current?.url} alt={current?.alt ?? name} className="aspect-square w-full bg-transparent mix-blend-multiply" />
      </div>
    </div>
  )
}

const SECTIONS = [
  ['overview', 'Overview'],
  ['specs', 'Specifications'],
  ['parts', 'Spare parts'],
  ['fits', 'Fits'],
  ['related', 'Related'],
]

function ProductView({ data: { product: p, breadcrumbs, spareParts, related } }) {
  const { siteName } = useBranding()
  const cart = useCart()
  const navigate = useNavigate()
  const account = useSession('user', (s) => s.account)
  const signedIn = useSession('user', (s) => s.status === 'authenticated')
  const isBusiness = account?.accountType === 'business'

  const min = p.inventory.moq
  const max = Math.max(min, Math.min(p.inventory.stock, p.inventory.maxOrderQty ?? Infinity))
  const [qty, setQty] = useState(min)
  const [busy, setBusy] = useState(null)
  const [quoteOpen, setQuoteOpen] = useState(false)
  const inCart = cart.quantityOf(p._id)
  const unit = unitShort(p.inventory.unit)

  const tiers = usableTiers(p.bulkPricing, { isBusiness })
  const { unitPrice, tier, next } = priceFor(p.pricing.price, tiers, qty)
  const total = unitPrice * qty
  const exGst = Math.round(unitPrice / (1 + p.pricing.gstRate / 100))
  const nextReachable = next && next.minQty <= max

  const sections = SECTIONS.filter(([id]) => {
    if (id === 'specs') return p.specifications.length > 0
    if (id === 'parts') return spareParts.length > 0
    if (id === 'fits') return p.type === 'part' && (p.compatibleWith.length > 0 || p.compatibleModels.length > 0)
    if (id === 'related') return related.length > 0
    return Boolean(p.description)
  })

  const add = async (thenGo) => {
    setBusy(thenGo ? 'buy' : 'add')
    try {
      await cart.setQty(p._id, Math.min(max, inCart + qty))
      if (thenGo) navigate('/cart')
      else toast.success('Added to cart', { description: `${formatNumber(qty)} × ${p.name}`, action: { label: 'View cart', onClick: () => navigate('/cart') } })
    } catch {
      /* toast already shown */
    } finally {
      setBusy(null)
    }
  }

  const requestQuote = () => {
    if (!signedIn) navigate(`/login?next=${encodeURIComponent(`/p/${p.slug}`)}`)
    else setQuoteOpen(true)
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <title>{`${p.seo?.title || p.name} | ${siteName}`}</title>
      <meta name="description" content={p.seo?.description || p.shortDescription || `Buy ${p.name} on ${siteName}.`} />
      {p.images[0] && <meta property="og:image" content={p.images[0].url} />}

      <Breadcrumbs items={[...breadcrumbs.map((b) => ({ label: b.name, to: `/c/${b.slug}` })), { label: p.name }]} />

      <div className="mt-6 grid gap-10 lg:grid-cols-[1.1fr_1fr] lg:gap-14">
        <div className="lg:sticky lg:top-40 lg:self-start">
          <Gallery images={p.images} name={p.name} />
        </div>

        <div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            {p.brand && (
              <Link to={`/search?brand=${encodeURIComponent(p.brand)}`} className="font-semibold tracking-[0.08em] text-slate-900 uppercase hover:underline">
                {p.brand}
              </Link>
            )}
            <span className="text-slate-300">|</span>
            <span className="text-slate-500">{PRODUCT_TYPE_LABEL[p.type]}</span>
            {p.condition !== 'new' && <span className="rounded-sm bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800 capitalize">{p.condition}</span>}
          </div>
          <h1 className="mt-2 text-[1.75rem] leading-tight font-semibold text-slate-900 sm:text-[2rem]">{p.name}</h1>
          <p className="mt-2 text-sm text-slate-500">{[p.modelNumber && `Model ${p.modelNumber}`, p.sku && `SKU ${p.sku}`].filter(Boolean).join('   ·   ')}</p>

          <div className="mt-6 border-t border-slate-200 pt-6">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-display text-[2.75rem] leading-none font-bold text-slate-900">{formatINR(unitPrice)}</span>
              {qty > 1 && <span className="text-sm text-slate-500">/ {unit}</span>}
              {tier ? (
                <span className="text-sm text-slate-500 line-through">{formatINR(p.pricing.price)}</span>
              ) : (
                p.pricing.mrp > p.pricing.price && (
                  <>
                    <span className="text-sm text-slate-500 line-through">MRP {formatINR(p.pricing.mrp)}</span>
                    <span className="text-sm font-semibold text-accent-ink">Save {p.pricing.discountPercent}%</span>
                  </>
                )
              )}
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              Incl. {p.pricing.gstRate}% GST · {formatINR(exGst)} + GST{p.hsnCode && ` · HSN ${p.hsnCode}`}
            </p>
            {tier && <p className="mt-2 text-sm font-semibold text-accent-ink">Bulk price applied for {formatNumber(tier.minQty)}+ {unitPlural(p.inventory.unit, 2)}</p>}
          </div>

          <p className="mt-4 flex items-center gap-2 text-sm">
            {p.inStock ? (
              <>
                <span className="size-2 rounded-full bg-accent" aria-hidden />
                <span className="font-semibold text-slate-900">{p.inventory.stock <= 5 ? `Only ${p.inventory.stock} left` : 'In stock'}</span>
                {p.shipping?.dispatchDays != null && (
                  <span className="text-slate-500">· dispatched in {p.shipping.dispatchDays === 0 ? '24 hours' : `${p.shipping.dispatchDays} day${p.shipping.dispatchDays === 1 ? '' : 's'}`}</span>
                )}
              </>
            ) : (
              <span className="font-semibold text-red-600">Out of stock</span>
            )}
          </p>

          {(tiers.length > 0 || p.bulkPricing.tiers.length > 0) && (
            <div className="mt-6">
              <BulkPricingTable product={p} tiers={tiers} quantity={qty} onPick={(q) => setQty(Math.min(max, q))} signedIn={signedIn} isBusiness={isBusiness} />
            </div>
          )}

          {p.inStock && (
            <div className="mt-6 rounded-md bg-[#f6f6f4] p-4">
              <div className="flex flex-wrap items-center gap-3">
                <QuantityStepper value={qty} onChange={setQty} min={min} max={max} />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="text-slate-500">Total for {formatNumber(qty)}</p>
                  <p className="tabular font-display text-2xl leading-tight font-bold text-slate-900">{formatINR(total)}</p>
                </div>
              </div>
              {nextReachable && (
                <button type="button" onClick={() => setQty(next.minQty)} className="mt-3 flex w-full items-center justify-between gap-2 text-left text-sm text-slate-700 hover:text-slate-900">
                  <span>
                    Add <strong>{formatNumber(next.unitsNeeded)}</strong> more to pay <strong className="text-accent-ink">{formatINR(next.price)}/{unit}</strong>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-slate-400" />
                </button>
              )}
              {min > 1 && <p className="mt-2 text-xs text-slate-500">Minimum order {formatNumber(min)} {unitPlural(p.inventory.unit, min)}</p>}
              <div className="mt-4 grid grid-cols-2 gap-3">
                <Button size="lg" variant="outline" className="border-slate-900 font-semibold" loading={busy === 'add'} onClick={() => add(false)}>
                  <ShoppingCart /> Add to cart
                </Button>
                <Button size="lg" className="font-semibold" loading={busy === 'buy'} onClick={() => add(true)}>
                  Buy now
                </Button>
              </div>
              {inCart > 0 && (
                <p className="mt-3 text-sm text-slate-600">
                  {formatNumber(inCart)} already in your{' '}
                  <Link to="/cart" className="font-semibold text-slate-900 underline underline-offset-2">
                    cart
                  </Link>
                </p>
              )}
            </div>
          )}

          {p.quotes.enabled && (
            <button type="button" onClick={requestQuote} className="mt-4 flex w-full items-center gap-3 rounded-md border border-slate-200 p-4 text-left hover:border-slate-400">
              <FileText className="size-5 shrink-0 text-slate-500" strokeWidth={1.75} />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-slate-900">
                  Need {formatNumber(p.quotes.threshold)}+ {unitPlural(p.inventory.unit, 2)}?
                </span>
                <span className="block text-sm text-slate-600">Request a quote and the seller replies with a price for your quantity.</span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-slate-400" />
            </button>
          )}

          <ul className="mt-6 divide-y divide-slate-200 border-y border-slate-200 text-sm">
            {(p.warranty?.months || p.warranty?.details) && (
              <li className="flex gap-3 py-3">
                <ShieldCheck className="size-5 shrink-0 text-slate-400" strokeWidth={1.75} />
                <span>
                  <span className="font-medium text-slate-900">{p.warranty.months ? `${p.warranty.months}-month warranty` : 'Warranty'}</span>
                  {p.warranty.details && <span className="text-slate-600"> · {p.warranty.details}</span>}
                </span>
              </li>
            )}
            <li className="flex gap-3 py-3">
              <Truck className="size-5 shrink-0 text-slate-400" strokeWidth={1.75} />
              <span className="text-slate-700">Shipped by the seller{p.vendor?.city && ` from ${p.vendor.city}`}</span>
            </li>
            <li className="flex gap-3 py-3">
              <Receipt className="size-5 shrink-0 text-slate-400" strokeWidth={1.75} />
              <span className="text-slate-700">Add your GSTIN at checkout for business billing</span>
            </li>
          </ul>

          {p.vendor && (
            <Link to={`/store/${p.vendor.store.slug}`} className="mt-6 flex items-center gap-3 rounded-md border border-slate-200 p-4 hover:border-slate-400">
              <Thumb src={p.vendor.store.logo?.url} className="size-12 shrink-0 rounded bg-[#f4f4f2]" />
              <span className="min-w-0 flex-1">
                <span className="block text-xs text-slate-500">Sold by</span>
                <span className="flex items-center gap-1.5 font-semibold text-slate-900">
                  {p.vendor.store.name} <BadgeCheck className="size-4 text-accent-ink" aria-label="Reviewed seller" />
                </span>
                {p.vendor.city && <span className="block text-xs text-slate-500">{[p.vendor.city, p.vendor.state].join(', ')}</span>}
              </span>
              <span className="hidden text-sm font-semibold text-slate-900 sm:inline">Visit store</span>
            </Link>
          )}

          {p.type === 'part' && (p.compatibleWith.length > 0 || p.compatibleModels.length > 0) && (
            <div className="mt-6 rounded-md border-l-4 border-primary bg-primary-soft p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Wrench className="size-4" /> Fits {p.compatibleWith.length + p.compatibleModels.length} model{p.compatibleWith.length + p.compatibleModels.length === 1 ? '' : 's'}
              </p>
              <p className="mt-1 text-sm text-slate-700">{[...p.compatibleWith.map((m) => m.name), ...p.compatibleModels].join(', ')}</p>
            </div>
          )}
        </div>
      </div>

      {sections.length > 1 && (
        <nav aria-label="On this page" className="sticky top-[132px] z-20 mt-14 hidden border-b border-slate-200 bg-white lg:block">
          <ul className="flex gap-8">
            {sections.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} className="-mb-px inline-block border-b-2 border-transparent py-3 font-display text-[15px] font-semibold tracking-wide text-slate-600 uppercase hover:border-slate-900 hover:text-slate-900">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <div className="mt-10 grid gap-12 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        {p.description && (
          <section id="overview" className="scroll-mt-48">
            <SectionHeading title="Overview" />
            {p.shortDescription && <p className="mb-4 text-lg leading-relaxed text-slate-800">{p.shortDescription}</p>}
            <div className="text-[15px] leading-7 whitespace-pre-line text-slate-700">{p.description}</div>
          </section>
        )}
        {p.specifications.length > 0 && (
          <section id="specs" className={cn('scroll-mt-48', !p.description && 'lg:col-span-2')}>
            <SectionHeading title="Specifications" />
            <dl className="divide-y divide-slate-200 border-y border-slate-200 text-sm">
              {p.specifications.map((s) => (
                <div key={s.label} className="grid grid-cols-[40%_1fr] gap-4 py-2.5">
                  <dt className="text-slate-500">{s.label}</dt>
                  <dd className="font-medium text-slate-900">{s.value}</dd>
                </div>
              ))}
              {p.shipping?.weightKg != null && (
                <div className="grid grid-cols-[40%_1fr] gap-4 py-2.5">
                  <dt className="text-slate-500">Shipping weight</dt>
                  <dd className="font-medium text-slate-900">{p.shipping.weightKg} kg</dd>
                </div>
              )}
            </dl>
          </section>
        )}
      </div>

      {spareParts.length > 0 && (
        <section id="parts" className="mt-16 scroll-mt-48">
          <SectionHeading title={`Spare parts for this ${PRODUCT_TYPE_LABEL[p.type].toLowerCase()}`} subtitle="Matched by sellers to this exact product" />
          <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-5">
            {spareParts.map((sp) => (
              <ProductCard key={sp._id} product={sp} />
            ))}
          </div>
        </section>
      )}

      {p.type === 'part' && p.compatibleWith.length > 0 && (
        <section id="fits" className="mt-16 scroll-mt-48">
          <SectionHeading title="Fits these machines" />
          <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-5">
            {p.compatibleWith.map((m) => (
              <ProductCard key={m._id} product={m} />
            ))}
          </div>
        </section>
      )}

      <div id="related" className="-mx-4 scroll-mt-48 sm:-mx-6">
        <ProductRail className="mt-16" title="You may also need" products={related} />
      </div>

      {p.inStock && (
        <div className="fixed inset-x-0 bottom-0 z-20 flex items-center gap-3 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:hidden">
          <span className="min-w-0">
            <span className="tabular block font-display text-xl leading-none font-bold">{formatINR(total)}</span>
            <span className="text-xs text-slate-500">
              {formatNumber(qty)} × {formatINR(unitPrice)}
            </span>
          </span>
          <Button className="ml-auto" loading={busy === 'add'} onClick={() => add(false)}>
            <ShoppingCart /> Add to cart
          </Button>
        </div>
      )}

      {p.quotes.enabled && signedIn && <QuoteRequestDialog open={quoteOpen} onOpenChange={setQuoteOpen} product={p} />}
      <div className="h-16 sm:hidden" aria-hidden />
    </div>
  )
}
