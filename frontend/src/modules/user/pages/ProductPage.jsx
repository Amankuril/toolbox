import { useQuery } from '@tanstack/react-query'
import { BadgeCheck, ChevronRight, FileText, MessageCircle, Receipt, ShieldCheck, ShoppingCart, Truck, Wrench } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/core/api/errors'
import { useSession } from '@/core/auth/session'
import { PRODUCT_TYPE_LABEL } from '@/core/lib/constants'
import { cn } from '@/core/lib/cn'
import { formatINR, formatNumber } from '@/core/lib/format'
import { priceFor, usableTiers } from '@/core/lib/pricing'
import { useBranding } from '@/core/settings/usePublicSettings'
import { Thumb } from '@/ui/Brand'
import { Sticker } from '@/ui/Badge'
import { Button } from '@/ui/Button'
import { EmptyState, Skeleton } from '@/ui/Card'
import { QuantityStepper } from '@/ui/inputs'
import { storeApi, storeKeys, userApi } from '../api'
import { useCart } from '../cart/useCart'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { BulkPricingTable } from '../components/BulkPricingTable'
import { ProductCard, ProductRail, SectionHeading } from '../components/ProductCard'
import { QuoteRequestDialog } from '../components/QuoteRequestDialog'
import { ServiceTiles } from '../components/Highlights'
import { Reviews } from '../components/Reviews'
import { WishlistButton } from '../components/WishlistButton'
import { RatingInline } from '../components/Stars'
import { useRecentlyViewed, useTrackView } from '../cart/recentlyViewed'
import { unitPlural, unitShort } from '@/core/lib/units'
import { gaItem, track, trackCartChange, trackItems } from '@/core/analytics/ga'

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
      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-4 sm:px-6 lg:grid-cols-[380px_1fr] xl:grid-cols-[440px_1fr] lg:gap-8">
        <Skeleton className="aspect-square max-h-[380px] rounded-lg" />
        <div className="flex flex-col gap-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-32" />
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
    <div className="flex flex-col-reverse gap-2.5 lg:flex-row">
      {images.length > 1 && (
        <div className="scrollbar-none flex gap-2 overflow-x-auto lg:max-h-[420px] lg:flex-col lg:overflow-y-auto">
          {images.map((img, i) => (
            <button
              key={img.media}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Show image ${i + 1}`}
              aria-current={i === index}
              className={cn(
                'size-12 shrink-0 overflow-hidden rounded-md border-2 bg-slate-100 p-1 sm:size-14',
                i === index ? 'border-slate-900' : 'border-transparent hover:border-slate-300',
              )}
            >
              <Thumb src={img.url} alt="" className="size-full bg-transparent mix-blend-multiply" />
            </button>
          ))}
        </div>
      )}
      <div className="flex-1 overflow-hidden rounded-lg border border-slate-200/60 bg-slate-100 p-4 sm:p-6 flex items-center justify-center">
        <Thumb
          src={current?.url}
          alt={current?.alt ?? name}
          className="aspect-square w-full max-h-[360px] sm:max-h-[400px] bg-transparent object-contain mix-blend-multiply"
        />
      </div>
    </div>
  )
}

const SECTIONS = [
  ['overview', 'Overview'],
  ['specs', 'Specifications'],
  ['parts', 'Spare parts'],
  ['fits', 'Fits'],
  ['reviews', 'Reviews'],
  ['related', 'Similar'],
]

function ProductView({ data: { product: p, breadcrumbs, spareParts, related, fromSeller = [] } }) {
  useTrackView(p._id)
  const recent = useRecentlyViewed(p._id)
  // GA: the product with its leaf category (from the breadcrumbs).
  const gaProduct = { ...p, category: breadcrumbs?.length ? { name: breadcrumbs[breadcrumbs.length - 1].name } : undefined }
  useEffect(() => {
    trackItems('view_item', [gaItem(gaProduct)])
    // Once per product page, not per re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p._id])
  const { siteName } = useBranding()
  const cart = useCart()
  const navigate = useNavigate()
  const account = useSession('user', (s) => s.account)
  const signedIn = useSession('user', (s) => s.status === 'authenticated')
  const isBusiness = account?.accountType === 'business'

  // Variant choice: start on the first combination that can be bought.
  const [selected, setSelected] = useState(() => (p.variants.find((v) => v.inStock) ?? p.variants[0])?.options ?? [])
  const variant = p.hasVariants ? (p.variants.find((v) => v.options.every((o, i) => o === selected[i])) ?? null) : null
  const sellable = p.hasVariants
    ? {
        price: variant?.price ?? p.pricing.price,
        mrp: variant?.mrp ?? p.pricing.mrp,
        discountPercent: variant?.discountPercent ?? 0,
        inStock: Boolean(variant?.inStock),
        stock: variant?.stock ?? null,
        lowStock: variant?.lowStock ?? null,
      }
    : {
        price: p.pricing.price,
        mrp: p.pricing.mrp,
        discountPercent: p.pricing.discountPercent,
        inStock: p.inStock,
        stock: p.inventory.stock,
        lowStock: p.lowStock,
      }

  const min = p.inventory.moq
  // `stock` is null when the seller doesn't track quantity.
  const max = Math.max(min, Math.min(sellable.stock ?? 9999, p.inventory.maxOrderQty ?? 9999))
  const [qty, setQty] = useState(min)
  const [busy, setBusy] = useState(null)
  const [quoteOpen, setQuoteOpen] = useState(false)
  const inCart = cart.quantityOf(p._id, variant?._id)
  const unit = unitShort(p.inventory.unit)

  const tiers = p.hasVariants ? [] : usableTiers(p.bulkPricing, { isBusiness })
  const { unitPrice, tier, next } = priceFor(sellable.price, tiers, qty)
  const total = unitPrice * qty
  const exGst = Math.round(unitPrice / (1 + p.pricing.gstRate / 100))
  const nextReachable = next && next.minQty <= max

  const sections = SECTIONS.filter(([id]) => {
    if (id === 'specs') return p.specifications.length > 0
    if (id === 'parts') return spareParts.length > 0
    if (id === 'fits') return p.type === 'part' && (p.compatibleWith.length > 0 || p.compatibleModels.length > 0)
    if (id === 'related') return related.length > 0
    if (id === 'reviews') return true
    return Boolean(p.description)
  })

  const add = async (thenGo) => {
    setBusy(thenGo ? 'buy' : 'add')
    try {
      const to = Math.min(max, inCart + qty)
      await cart.setQty(p._id, to, variant?._id)
      trackCartChange(gaProduct, { from: inCart, to, price: unitPrice, variant: variant?.options?.join(' / ') })
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

  // The seller's number comes from the server on tap (which also tells the seller who's interested).
  // The tab opens inside the click so popup blockers allow it.
  const chatOnWhatsApp = async () => {
    if (!signedIn) return navigate(`/login?next=${encodeURIComponent(`/p/${p.slug}`)}`)
    const tab = window.open('about:blank', '_blank')
    try {
      const { url } = await userApi.whatsappChat(p._id)
      track('generate_lead', { lead_source: 'whatsapp_chat', items: [gaItem(gaProduct)] })
      if (tab) {
        tab.opener = null
        tab.location.href = url
      } else window.location.href = url
    } catch (err) {
      tab?.close()
      toast.error(errorMessage(err))
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6 sm:py-4">
      <title>{`${p.seo?.title || p.name} | ${siteName}`}</title>
      <meta name="description" content={p.seo?.description || p.shortDescription || `Buy ${p.name} on ${siteName}.`} />
      {p.images[0] && <meta property="og:image" content={p.images[0].url} />}

      <Breadcrumbs items={[...breadcrumbs.map((b) => ({ label: b.name, to: `/c/${b.slug}` })), { label: p.name }]} />

      <div className="mt-4 grid gap-6 lg:grid-cols-[380px_1fr] xl:grid-cols-[440px_1fr] lg:gap-8 xl:gap-10 items-start">
        <div className="relative lg:sticky lg:top-24 lg:self-start">
          <WishlistButton product={p} className="absolute top-3 right-3 z-10 size-11" />
          <Gallery
            key={variant?.image?.url ?? 'default'}
            images={variant?.image ? [variant.image, ...p.images.filter((i) => i.url !== variant.image.url)] : p.images}
            name={p.name}
          />
        </div>

        <div>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs sm:text-sm">
            {p.brand && (
              <Link to={`/search?brand=${encodeURIComponent(p.brand)}`} className="font-semibold tracking-[0.08em] text-slate-900 uppercase hover:underline">
                {p.brand}
              </Link>
            )}
            <span className="text-slate-300">|</span>
            <span className="text-slate-500">{PRODUCT_TYPE_LABEL[p.type]}</span>
            {p.condition !== 'new' && (
              <span className="rounded-sm bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800 capitalize">{p.condition}</span>
            )}
          </div>
          <h1 className="mt-1.5 text-2xl leading-[1.12] font-extrabold tracking-tight text-slate-900 sm:text-[2rem]">{p.name}</h1>
          <p className="code mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-600">
            {p.modelNumber && <span>MODEL {p.modelNumber}</span>}
            {p.sku && !p.hasVariants && <span>SKU {p.sku}</span>}
          </p>
          {p.rating && (
            <a href="#reviews" className="mt-2 inline-flex hover:underline">
              <RatingInline rating={p.rating} size={15} className="text-sm" />
            </a>
          )}

          <div className="mt-3.5 border-t border-slate-200 pt-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="price text-[2.25rem] leading-none text-slate-900 sm:text-[2.75rem]">{formatINR(unitPrice)}</span>
              {qty > 1 && <span className="text-xs sm:text-sm text-slate-500">/ {unit}</span>}
              {tier ? (
                <span className="text-xs sm:text-sm text-slate-500 line-through">{formatINR(sellable.price)}</span>
              ) : (
                sellable.mrp > sellable.price && (
                  <>
                    <span className="text-xs sm:text-sm text-slate-500 line-through">MRP {formatINR(sellable.mrp)}</span>
                    <Sticker className="self-center">Save {sellable.discountPercent}%</Sticker>
                  </>
                )
              )}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Incl. {p.pricing.gstRate}% GST · {formatINR(exGst)} + GST{p.hsnCode && ` · HSN ${p.hsnCode}`}
            </p>
            {tier && (
              <p className="mt-1.5 text-xs sm:text-sm font-semibold text-accent-ink">
                Bulk price applied for {formatNumber(tier.minQty)}+ {unitPlural(p.inventory.unit, 2)}
              </p>
            )}
          </div>

          {p.hasVariants && <VariantPicker product={p} selected={selected} onChange={(next) => (setSelected(next), setQty(min))} />}

          <p className="mt-2.5 flex items-center gap-2 text-xs sm:text-sm">
            {sellable.inStock ? (
              <>
                <span className="size-2 rounded-full bg-accent" aria-hidden />
                <span className="font-semibold text-slate-900">{sellable.lowStock ? `Only ${sellable.lowStock} left` : 'In stock'}</span>
                {p.shipping?.dispatchDays != null && (
                  <span className="text-slate-500">
                    · dispatched in {p.shipping.dispatchDays === 0 ? '24 hours' : `${p.shipping.dispatchDays} day${p.shipping.dispatchDays === 1 ? '' : 's'}`}
                  </span>
                )}
              </>
            ) : (
              <span className="font-semibold text-red-600">Out of stock</span>
            )}
          </p>

          {!p.hasVariants && (tiers.length > 0 || p.bulkPricing.tiers.length > 0) && (
            <div className="mt-3.5">
              <BulkPricingTable product={p} tiers={tiers} quantity={qty} onPick={(q) => setQty(Math.min(max, q))} signedIn={signedIn} isBusiness={isBusiness} />
            </div>
          )}

          {sellable.inStock && (
            <div className="mt-3.5 rounded-lg bg-slate-100 p-3 sm:p-3.5 border border-slate-200/60">
              <div className="flex flex-wrap items-center gap-3">
                <QuantityStepper value={qty} onChange={setQty} min={min} max={max} />
                <div className="min-w-0 flex-1 text-xs sm:text-sm">
                  <p className="text-slate-500">Total for {formatNumber(qty)}</p>
                  <p className="tabular font-display text-xl sm:text-2xl leading-tight font-bold text-slate-900">{formatINR(total)}</p>
                </div>
              </div>
              {nextReachable && (
                <button
                  type="button"
                  onClick={() => setQty(next.minQty)}
                  className="mt-2.5 flex w-full items-center justify-between gap-2 text-left text-xs sm:text-sm text-slate-700 hover:text-slate-900"
                >
                  <span>
                    Add <strong>{formatNumber(next.unitsNeeded)}</strong> more to pay{' '}
                    <strong className="text-accent-ink">
                      {formatINR(next.price)}/{unit}
                    </strong>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-slate-400" />
                </button>
              )}
              {min > 1 && (
                <p className="mt-1.5 text-xs text-slate-500">
                  Minimum order {formatNumber(min)} {unitPlural(p.inventory.unit, min)}
                </p>
              )}
              <div className="mt-3 grid grid-cols-2 gap-2.5">
                <Button size="lg" loading={busy === 'add'} onClick={() => add(false)}>
                  <ShoppingCart /> Add to cart
                </Button>
                <Button size="lg" variant="accent" loading={busy === 'buy'} onClick={() => add(true)}>
                  Buy now
                </Button>
              </div>
              {inCart > 0 && (
                <p className="mt-2 text-xs sm:text-sm text-slate-600">
                  {formatNumber(inCart)} already in your{' '}
                  <Link to="/cart" className="font-semibold text-slate-900 underline underline-offset-2">
                    cart
                  </Link>
                </p>
              )}
            </div>
          )}

          {p.quotes.enabled && (
            <button
              type="button"
              onClick={requestQuote}
              className="mt-3 flex w-full items-center gap-3 rounded-lg border-2 border-primary/40 bg-primary-soft p-3 text-left transition-colors hover:border-primary"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-primary-fg">
                <FileText className="size-[18px]" strokeWidth={2} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-slate-900">
                  Need {formatNumber(p.quotes.threshold)}+ {unitPlural(p.inventory.unit, 2)}?
                </span>
                <span className="block text-xs text-slate-700">Request a quote and the seller replies with a price for your quantity.</span>
              </span>
              <ChevronRight className="size-5 shrink-0 text-primary" />
            </button>
          )}

          {p.vendor?.chat && (
            <button
              type="button"
              onClick={chatOnWhatsApp}
              className="mt-3 flex w-full items-center gap-3 rounded-lg border-2 border-emerald-500/40 bg-emerald-50 p-3 text-left transition-colors hover:border-emerald-500"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-emerald-500 text-white">
                <MessageCircle className="size-[18px]" strokeWidth={2} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-slate-900">Chat on WhatsApp</span>
                <span className="block text-xs text-slate-700">Ask the seller about this product, delivery or a bulk order.</span>
              </span>
              <ChevronRight className="size-5 shrink-0 text-emerald-600" />
            </button>
          )}

          <ul className="mt-3.5 divide-y divide-slate-200 border-y border-slate-200 text-xs sm:text-sm">
            {(p.warranty?.months || p.warranty?.details) && (
              <li className="flex gap-2.5 py-2.5">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-slate-400" strokeWidth={1.75} />
                <span>
                  <span className="font-medium text-slate-900">{p.warranty.months ? `${p.warranty.months}-month warranty` : 'Warranty'}</span>
                  {p.warranty.details && <span className="text-slate-600"> · {p.warranty.details}</span>}
                </span>
              </li>
            )}
            <li className="flex gap-2.5 py-2.5">
              <Truck className="mt-0.5 size-4 shrink-0 text-slate-400" strokeWidth={1.75} />
              <span className="text-slate-700">Shipped by the seller{p.vendor?.city && ` from ${p.vendor.city}`}</span>
            </li>
            <li className="flex gap-2.5 py-2.5">
              <Receipt className="mt-0.5 size-4 shrink-0 text-slate-400" strokeWidth={1.75} />
              <span className="text-slate-700">Add your GSTIN at checkout for business billing</span>
            </li>
          </ul>
          <ServiceTiles className="mt-4" />

          {p.vendor && (
            <Link to={`/store/${p.vendor.store.slug}`} className="mt-3.5 flex items-center gap-3 rounded-lg border border-slate-200 p-3 hover:border-slate-400">
              <Thumb src={p.vendor.store.logo?.url} className="size-10 shrink-0 rounded bg-slate-100" />
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] text-slate-500">Sold by</span>
                <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                  {p.vendor.store.name}
                  {p.vendor.official ? (
                    <span className="inline-flex items-center gap-1 rounded-sm bg-primary px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-primary-fg uppercase">
                      <BadgeCheck className="size-3" /> Official
                    </span>
                  ) : (
                    <BadgeCheck className="size-3.5 text-accent-ink" aria-label="Reviewed seller" />
                  )}
                </span>
                {p.vendor.city && <span className="block text-[11px] text-slate-500">{[p.vendor.city, p.vendor.state].join(', ')}</span>}
              </span>
              <span className="hidden text-xs font-semibold text-slate-900 sm:inline">Visit store</span>
            </Link>
          )}

          {p.type === 'part' && (p.compatibleWith.length > 0 || p.compatibleModels.length > 0) && (
            <div className="mt-3.5 rounded-lg border-l-4 border-primary bg-primary-soft p-3 text-xs sm:text-sm">
              <p className="flex items-center gap-2 font-semibold text-slate-900">
                <Wrench className="size-4" /> Fits {p.compatibleWith.length + p.compatibleModels.length} model
                {p.compatibleWith.length + p.compatibleModels.length === 1 ? '' : 's'}
              </p>
              <p className="mt-1 text-slate-700">{[...p.compatibleWith.map((m) => m.name), ...p.compatibleModels].join(', ')}</p>
            </div>
          )}
        </div>
      </div>

      {sections.length > 1 && (
        <nav aria-label="On this page" className="sticky top-20 z-20 mt-10 hidden border-b border-slate-200 bg-white lg:block">
          <ul className="flex gap-8">
            {sections.map(([id, label]) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  className="-mb-px inline-block border-b-2 border-transparent py-2.5 font-display text-sm font-semibold tracking-wide text-slate-600 uppercase hover:border-slate-900 hover:text-slate-900"
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        {p.description && (
          <section id="overview" className="scroll-mt-28">
            <SectionHeading title="Overview" />
            {p.shortDescription && <p className="mb-3 text-base leading-relaxed text-slate-800">{p.shortDescription}</p>}
            <div className="text-sm leading-6 whitespace-pre-line text-slate-700">{p.description}</div>
          </section>
        )}
        {p.specifications.length > 0 && (
          <section id="specs" className={cn('scroll-mt-28', !p.description && 'lg:col-span-2')}>
            <SectionHeading title="Specifications" />
            {/* Spec-sheet rows: label left, value right, dotted leader between. */}
            <dl className="text-[0.9375rem]">
              {p.specifications.map((s) => (
                <div key={s.label} className="flex items-baseline justify-between gap-6 border-b border-dotted border-slate-300 py-2.5 last:border-b-0">
                  <dt className="text-slate-600">{s.label}</dt>
                  <dd className="text-right font-semibold text-slate-900">{s.value}</dd>
                </div>
              ))}
              {p.shipping?.weightKg != null && (
                <div className="flex items-baseline justify-between gap-6 py-2.5">
                  <dt className="text-slate-600">Shipping weight</dt>
                  <dd className="text-right font-semibold text-slate-900">{p.shipping.weightKg} kg</dd>
                </div>
              )}
            </dl>
          </section>
        )}
      </div>

      <Reviews product={p} />

      {spareParts.length > 0 && (
        <section id="parts" className="mt-10 scroll-mt-28">
          <SectionHeading title={`Spare parts for this ${PRODUCT_TYPE_LABEL[p.type].toLowerCase()}`} subtitle="Matched by sellers to this exact product" />
          <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-5">
            {spareParts.map((sp) => (
              <ProductCard key={sp._id} product={sp} />
            ))}
          </div>
        </section>
      )}

      {p.type === 'part' && p.compatibleWith.length > 0 && (
        <section id="fits" className="mt-10 scroll-mt-28">
          <SectionHeading title="Fits these machines" />
          <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-5">
            {p.compatibleWith.map((m) => (
              <ProductCard key={m._id} product={m} />
            ))}
          </div>
        </section>
      )}

      <div id="related" className="-mx-4 scroll-mt-28 sm:-mx-6">
        <ProductRail className="mt-12" title="Similar products" subtitle="From the same category" products={related} />
        {fromSeller.length > 0 && (
          <ProductRail
            className="mt-12"
            title={`More from ${p.vendor?.store?.name ?? 'this seller'}`}
            products={fromSeller}
            viewAll={p.vendor?.store?.slug ? `/store/${p.vendor.store.slug}` : undefined}
          />
        )}
        {recent.length > 0 && <ProductRail className="mt-12" title="Recently viewed" products={recent} />}
      </div>

      {sellable.inStock && (
        <div className="fixed inset-x-0 bottom-0 z-20 flex items-center gap-3 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:hidden">
          <span className="min-w-0">
            <span className="price block text-xl leading-none">{formatINR(total)}</span>
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

/** One row of buttons per option (Size, Colour…). Values with no buyable combination are struck through. */
function VariantPicker({ product: p, selected, onChange }) {
  const buyable = (options) => p.variants.some((v) => v.inStock && v.options.every((o, i) => o === options[i]))
  return (
    <div className="mt-3 flex flex-col gap-3">
      {p.variantOptions.map((option, i) => (
        <div key={option.name}>
          <p className="mb-1.5 text-xs sm:text-sm text-slate-600">
            {option.name}: <span className="font-semibold text-slate-900">{selected[i]}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {option.values.map((value) => {
              const next = selected.map((s, j) => (j === i ? value : s))
              const exists = p.variants.some((v) => v.options.every((o, j) => o === next[j]))
              const active = selected[i] === value
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={active}
                  disabled={!exists}
                  onClick={() => onChange(next)}
                  className={cn(
                    'rounded-md border px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                    active ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-800 hover:border-slate-500',
                    exists && !buyable(next) && 'line-through decoration-slate-400',
                  )}
                >
                  {value}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
