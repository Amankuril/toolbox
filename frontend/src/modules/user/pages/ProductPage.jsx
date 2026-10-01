import { useQuery } from '@tanstack/react-query'
import { BadgeCheck, Clock, PackageCheck, ShieldCheck, ShoppingCart, Store, Wrench, Zap } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { PRODUCT_TYPE_LABEL } from '@/core/lib/constants'
import { cn } from '@/core/lib/cn'
import { formatINR } from '@/core/lib/format'
import { useBranding } from '@/core/settings/usePublicSettings'
import { Badge } from '@/ui/Badge'
import { Price, Thumb } from '@/ui/Brand'
import { Button } from '@/ui/Button'
import { EmptyState, Skeleton } from '@/ui/Card'
import { QuantityStepper } from '@/ui/inputs'
import { storeApi, storeKeys } from '../api'
import { useCart } from '../cart/useCart'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { ProductCard, ProductRail } from '../components/ProductCard'

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
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-6 sm:px-6 lg:grid-cols-2">
        <Skeleton className="aspect-square" />
        <div className="flex flex-col gap-4">
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-32" />
        </div>
      </div>
    )
  }
  return <ProductView key={data.product._id} data={data} />
}

function ProductView({ data: { product: p, breadcrumbs, spareParts, related } }) {
  const { siteName } = useBranding()
  const cart = useCart()
  const navigate = useNavigate()
  const [image, setImage] = useState(0)
  const min = p.inventory.moq
  const max = Math.max(min, Math.min(p.inventory.stock, p.inventory.maxOrderQty ?? Infinity))
  const [qty, setQty] = useState(min)
  const [busy, setBusy] = useState(null)
  const inCart = cart.quantityOf(p._id)

  const add = async (thenGo) => {
    setBusy(thenGo ? 'buy' : 'add')
    try {
      await cart.setQty(p._id, Math.min(max, inCart + qty))
      if (thenGo) navigate('/cart')
      else toast.success('Added to cart', { description: `${qty} × ${p.name}`, action: { label: 'View cart', onClick: () => navigate('/cart') } })
    } catch {
      /* toast already shown */
    } finally {
      setBusy(null)
    }
  }

  const stockNote = !p.inStock ? (
    <span className="font-semibold text-red-600">Out of stock</span>
  ) : p.inventory.stock <= 5 ? (
    <span className="font-semibold text-amber-700">Only {p.inventory.stock} left</span>
  ) : (
    <span className="font-semibold text-accent">In stock</span>
  )

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <title>{`${p.seo?.title || p.name} | ${siteName}`}</title>
      <meta name="description" content={p.seo?.description || p.shortDescription || `Buy ${p.name} on ${siteName}.`} />
      {p.images[0] && <meta property="og:image" content={p.images[0].url} />}

      <Breadcrumbs items={[...breadcrumbs.map((b) => ({ label: b.name, to: `/c/${b.slug}` })), { label: p.name }]} />

      <div className="mt-5 grid gap-8 lg:grid-cols-2 lg:gap-12">
        <div className="lg:sticky lg:top-36 lg:self-start">
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white p-4">
            <Thumb src={p.images[image]?.url} alt={p.images[image]?.alt ?? p.name} className="aspect-square w-full" />
          </div>
          {p.images.length > 1 && (
            <div className="scrollbar-none mt-3 flex gap-2 overflow-x-auto">
              {p.images.map((img, i) => (
                <button
                  key={img.media}
                  type="button"
                  onClick={() => setImage(i)}
                  aria-label={`Show image ${i + 1}`}
                  aria-current={i === image}
                  className={cn(
                    'size-16 shrink-0 overflow-hidden rounded-lg border-2 bg-white p-1 sm:size-20',
                    i === image ? 'border-primary' : 'border-slate-200 hover:border-slate-300',
                  )}
                >
                  <Thumb src={img.url} alt="" className="size-full" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="flex flex-wrap items-center gap-2">
            {p.brand && (
              <Link to={`/search?brand=${encodeURIComponent(p.brand)}`} className="text-sm font-semibold tracking-wide text-primary uppercase hover:underline">
                {p.brand}
              </Link>
            )}
            <Badge>{PRODUCT_TYPE_LABEL[p.type]}</Badge>
            {p.condition !== 'new' && (
              <Badge tone="warning" className="capitalize">
                {p.condition}
              </Badge>
            )}
          </div>
          <h1 className="mt-2 text-2xl leading-tight font-bold text-slate-900 sm:text-3xl">{p.name}</h1>
          <p className="mt-1.5 text-sm text-slate-500">{[p.modelNumber && `Model ${p.modelNumber}`, p.sku && `SKU ${p.sku}`].filter(Boolean).join(' · ')}</p>

          <div className="mt-5 rounded-xl border border-slate-200 bg-white p-5">
            <Price price={p.pricing.price} mrp={p.pricing.mrp} size="xl" showTaxNote />
            <p className="mt-3 text-sm">{stockNote}</p>
            {p.inventory.moq > 1 && (
              <p className="mt-1 text-sm text-slate-600">
                Minimum order: {p.inventory.moq} {p.inventory.unit}s
              </p>
            )}

            {p.inStock && (
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <QuantityStepper value={qty} onChange={setQty} min={min} max={max} />
                <Button size="lg" variant="outline" className="flex-1" loading={busy === 'add'} onClick={() => add(false)}>
                  <ShoppingCart /> Add to cart
                </Button>
                <Button size="lg" className="flex-1" loading={busy === 'buy'} onClick={() => add(true)}>
                  <Zap /> Buy now
                </Button>
              </div>
            )}
            {inCart > 0 && (
              <p className="mt-3 text-sm text-slate-600">
                {inCart} already in your{' '}
                <Link to="/cart" className="font-medium text-primary hover:underline">
                  cart
                </Link>
              </p>
            )}

            <ul className="mt-5 grid gap-3 border-t border-slate-100 pt-5 text-sm text-slate-700 sm:grid-cols-2">
              {p.shipping?.dispatchDays != null && (
                <li className="flex items-center gap-2">
                  <Clock className="size-4 text-slate-400" /> Dispatched in{' '}
                  {p.shipping.dispatchDays === 0 ? 'same day' : `${p.shipping.dispatchDays} day${p.shipping.dispatchDays === 1 ? '' : 's'}`}
                </li>
              )}
              {(p.warranty?.months || p.warranty?.details) && (
                <li className="flex items-center gap-2">
                  <ShieldCheck className="size-4 text-slate-400" /> {p.warranty.months ? `${p.warranty.months} months warranty` : 'Warranty'}
                  {p.warranty.details && ` · ${p.warranty.details}`}
                </li>
              )}
              <li className="flex items-center gap-2">
                <PackageCheck className="size-4 text-slate-400" /> GST {p.pricing.gstRate}% included{p.hsnCode && ` · HSN ${p.hsnCode}`}
              </li>
            </ul>
          </div>

          {p.vendor && (
            <Link
              to={`/store/${p.vendor.store.slug}`}
              className="mt-4 flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-300"
            >
              <Thumb src={p.vendor.store.logo?.url} className="size-11 shrink-0 rounded-lg border border-slate-100" />
              <span className="min-w-0 flex-1">
                <span className="block text-xs text-slate-500">Sold by</span>
                <span className="flex items-center gap-1.5 font-semibold text-slate-900">
                  {p.vendor.store.name} <BadgeCheck className="size-4 text-accent" aria-label="Reviewed seller" />
                </span>
                {p.vendor.city && <span className="block text-xs text-slate-500">{[p.vendor.city, p.vendor.state].join(', ')}</span>}
              </span>
              <Store className="size-4 text-slate-400" />
            </Link>
          )}

          {p.shortDescription && <p className="mt-5 text-slate-700">{p.shortDescription}</p>}

          {p.type === 'part' && (p.compatibleWith.length > 0 || p.compatibleModels.length > 0) && (
            <div className="mt-6 rounded-xl border border-primary-muted bg-primary-soft p-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Wrench className="size-4 text-primary" /> Fits these machines
              </h2>
              {p.compatibleWith.length > 0 && (
                <ul className="mt-3 flex flex-col gap-2">
                  {p.compatibleWith.map((m) => (
                    <li key={m._id}>
                      <Link
                        to={`/p/${m.slug}`}
                        className="flex items-center gap-3 rounded-lg bg-white p-2 text-sm font-medium text-slate-800 hover:text-primary"
                      >
                        <Thumb src={m.image?.url} className="size-10 rounded" />
                        {m.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {p.compatibleModels.length > 0 && <p className="mt-3 text-sm text-slate-700">Also fits: {p.compatibleModels.join(', ')}</p>}
            </div>
          )}
        </div>
      </div>

      <div className="mt-12 grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
        {p.description && (
          <section>
            <h2 className="mb-3 text-xl font-bold text-slate-900">Description</h2>
            <div className="text-[15px] leading-7 whitespace-pre-line text-slate-700">{p.description}</div>
          </section>
        )}
        {p.specifications.length > 0 && (
          <section className={cn(!p.description && 'lg:col-span-2')}>
            <h2 className="mb-3 text-xl font-bold text-slate-900">Specifications</h2>
            <table className="w-full overflow-hidden rounded-lg border border-slate-200 bg-white text-sm">
              <tbody className="divide-y divide-slate-100">
                {p.specifications.map((s) => (
                  <tr key={s.label}>
                    <th scope="row" className="w-2/5 bg-slate-50 px-4 py-2.5 text-left font-medium text-slate-600">
                      {s.label}
                    </th>
                    <td className="px-4 py-2.5 text-slate-900">{s.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>

      {spareParts.length > 0 && (
        <section className="mt-12">
          <h2 className="text-xl font-bold text-slate-900">Spare parts &amp; accessories for this {PRODUCT_TYPE_LABEL[p.type].toLowerCase()}</h2>
          <p className="mt-0.5 mb-4 text-sm text-slate-500">Matched by sellers to this exact product.</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5">
            {spareParts.map((sp) => (
              <ProductCard key={sp._id} product={sp} />
            ))}
          </div>
        </section>
      )}

      <div className="-mx-4 sm:-mx-6">
        <ProductRail title="You may also like" products={related} />
      </div>

      {p.inStock && (
        <div className="fixed inset-x-0 bottom-0 z-20 flex items-center gap-3 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:hidden">
          <span className="tabular text-lg font-bold">{formatINR(p.pricing.price)}</span>
          <Button className="flex-1" loading={busy === 'add'} onClick={() => add(false)}>
            <ShoppingCart /> Add to cart
          </Button>
        </div>
      )}
    </div>
  )
}
