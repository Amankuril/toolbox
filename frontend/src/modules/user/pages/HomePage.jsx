import { useQuery } from '@tanstack/react-query'
import { ArrowRight, BadgeCheck, Banknote, Building2, CreditCard, Wrench } from 'lucide-react'
import { Link } from 'react-router'
import { usePublicSettings } from '@/core/settings/usePublicSettings'
import { Button } from '@/ui/Button'
import { Skeleton } from '@/ui/Card'
import { storeApi, storeKeys } from '../api'
import { CategoryTiles } from '../components/Breadcrumbs'
import { HeroCarousel } from '../components/HeroCarousel'
import { ProductRail } from '../components/ProductCard'
import { useCategoryTree } from '../hooks'

function useProducts(params) {
  return useQuery({ queryKey: storeKeys.products(params), queryFn: () => storeApi.products(params), staleTime: 60_000 })
}

function FallbackHero({ siteName, tagline }) {
  return (
    <section className="relative overflow-hidden rounded-xl bg-secondary px-6 py-12 text-secondary-fg sm:px-12 sm:py-16">
      <div className="absolute -top-24 -right-24 size-80 rounded-full bg-primary/25 blur-3xl" aria-hidden />
      <div className="relative max-w-xl">
        <h1 className="text-3xl leading-tight font-extrabold sm:text-4xl">{tagline || `Tools, machinery & spare parts on ${siteName}`}</h1>
        <p className="mt-3 text-secondary-fg/75">Buy from reviewed sellers, and find spare parts linked to the exact machine you own.</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button size="lg" asChild>
            <a href="#categories">
              Shop categories <ArrowRight />
            </a>
          </Button>
          <Button size="lg" variant="outline" className="border-white/30 bg-transparent text-secondary-fg hover:bg-white/10" asChild>
            <Link to="/vendor/login">Sell with us</Link>
          </Button>
        </div>
      </div>
    </section>
  )
}

export default function HomePage() {
  const { data: settings } = usePublicSettings()
  const { data: tree, isLoading: treeLoading } = useCategoryTree()
  const { data: banners = [], isLoading: bannersLoading } = useQuery({ queryKey: storeKeys.banners, queryFn: storeApi.banners, staleTime: 5 * 60_000 })
  const featured = useProducts({ featured: true, limit: 12 })
  const latest = useProducts({ sort: 'newest', limit: 12 })

  const siteName = settings?.branding.siteName ?? 'Toolbox'
  const hero = banners.filter((b) => b.placement === 'home_hero')
  const offers = banners.filter((b) => b.placement === 'home_offer')
  const strip = banners.find((b) => b.placement === 'home_strip')
  const roots = tree ?? []

  const features = [
    { icon: BadgeCheck, title: 'Reviewed sellers', text: 'Every store is checked before it can list' },
    { icon: Wrench, title: 'Parts that fit', text: 'Spares are linked to the machines they fit' },
    { icon: Building2, title: 'Buying for business?', text: 'Add your GSTIN at checkout' },
    settings?.payments.razorpayEnabled
      ? { icon: CreditCard, title: 'Pay your way', text: 'UPI, cards & net banking' }
      : settings?.payments.codEnabled && { icon: Banknote, title: 'Cash on delivery', text: 'Pay when your order arrives' },
  ].filter(Boolean)

  return (
    <>
      <title>{`${siteName} — Tools, Machinery & Spare Parts`}</title>
      <div className="mx-auto max-w-7xl px-4 pt-4 sm:px-6 sm:pt-6">
        {bannersLoading ? (
          <Skeleton className="aspect-[16/5] w-full rounded-xl" />
        ) : hero.length ? (
          <HeroCarousel banners={hero} />
        ) : (
          <FallbackHero siteName={siteName} tagline={settings?.branding.tagline} />
        )}

        <ul className="mt-4 grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-white p-4 lg:grid-cols-4">
          {features.map((f) => (
            <li key={f.title} className="flex items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
                <f.icon className="size-5" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-slate-900">{f.title}</span>
                <span className="block text-xs text-slate-500">{f.text}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <section id="categories" className="mx-auto mt-10 max-w-7xl scroll-mt-32 px-4 sm:px-6">
        <h2 className="mb-4 text-xl font-bold text-slate-900">Shop by category</h2>
        {treeLoading ? (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="aspect-[4/5]" />
            ))}
          </div>
        ) : (
          <CategoryTiles categories={[...roots].sort((a, b) => Number(b.isFeatured) - Number(a.isFeatured))} />
        )}
      </section>

      {offers.length > 0 && (
        <section className="mx-auto mt-10 grid max-w-7xl gap-4 px-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-3">
          {offers.slice(0, 3).map((b) => (
            <Link
              key={b._id}
              to={b.link || '#'}
              className="block overflow-hidden rounded-xl border border-slate-200 bg-white transition-shadow hover:shadow-md"
            >
              <img src={b.image.url} alt={b.title} loading="lazy" className="aspect-[2/1] w-full object-cover" />
            </Link>
          ))}
        </section>
      )}

      <ProductRail
        title="Featured"
        subtitle="Picked by our team"
        products={featured.data?.items}
        loading={featured.isLoading}
        viewAll="/search?featured=true"
      />
      <ProductRail title="New arrivals" products={latest.data?.items} loading={latest.isLoading} viewAll="/search?sort=newest" />

      {strip && (
        <section className="mx-auto mt-10 max-w-7xl px-4 sm:px-6">
          <Link to={strip.link || '#'} className="block overflow-hidden rounded-xl">
            <img src={strip.image.url} alt={strip.title} loading="lazy" className="aspect-[16/3] w-full object-cover" />
          </Link>
        </section>
      )}

      {roots.slice(0, 3).map((c) => (
        <CategoryRail key={c._id} category={c} />
      ))}

      <section className="mx-auto mt-14 max-w-7xl px-4 sm:px-6">
        <div className="flex flex-col items-start justify-between gap-6 rounded-xl bg-primary-soft p-8 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Sell on {siteName}</h2>
            <p className="mt-1 max-w-xl text-slate-600">
              Dealers, distributors and manufacturers: list tools, machinery and spare parts, and manage orders from one dashboard.
            </p>
          </div>
          <Button size="lg" asChild>
            <Link to="/vendor/login">
              Start selling <ArrowRight />
            </Link>
          </Button>
        </div>
      </section>
    </>
  )
}

function CategoryRail({ category }) {
  const { data, isLoading } = useProducts({ category: category.slug, limit: 12 })
  return <ProductRail title={category.name} products={data?.items} loading={isLoading} viewAll={`/c/${category.slug}`} />
}
