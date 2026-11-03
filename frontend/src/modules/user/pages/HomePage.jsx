import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Layers, Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { usePublicSettings } from '@/core/settings/usePublicSettings'
import { Thumb } from '@/ui/Brand'
import { Button } from '@/ui/Button'
import { Skeleton } from '@/ui/Card'
import { storeApi, storeKeys } from '../api'
import { HeroCarousel } from '../components/HeroCarousel'
import { ServiceStrip, StatsBand } from '../components/Highlights'
import { ProductRail, SectionHeading } from '../components/ProductCard'
import { useCategoryTree } from '../hooks'
import { fillTemplate, useSeoTitle } from '@/core/seo/templates'

/** The trade buyer's shortcut: search by the machine you own, land on parts that fit it. */
function PartsFinder() {
  const navigate = useNavigate()
  const location = useLocation()
  const inputRef = useRef(null)
  const sectionRef = useRef(null)
  const [model, setModel] = useState('')

  useEffect(() => {
    if (location.hash === '#parts-finder') {
      sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      inputRef.current?.focus({ preventScroll: true })
    }
  }, [location.hash])

  return (
    <section
      ref={sectionRef}
      id="parts-finder"
      className="flex flex-col justify-between gap-4 rounded-md border-[1.5px] border-slate-900 bg-white p-5 sm:flex-row sm:items-center"
    >
      <div className="min-w-0">
        <p className="eyebrow">Spare parts finder</p>
        <h2 className="mt-1 text-xl leading-tight font-extrabold text-slate-900">Find parts that fit your machine</h2>
        <p className="mt-1 text-sm text-slate-600">Enter the model number on the machine’s rating plate.</p>
      </div>
      <form
        className="w-full sm:max-w-sm"
        onSubmit={(e) => {
          e.preventDefault()
          if (model.trim()) navigate(`/search?q=${encodeURIComponent(model.trim())}&type=part`)
        }}
      >
        <label htmlFor="parts-model" className="sr-only">
          Machine model number
        </label>
        <div className="flex h-11 overflow-hidden rounded-md border border-slate-300 bg-white focus-within:border-primary">
          <input
            id="parts-model"
            ref={inputRef}
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="e.g. GSB 550, KS-128"
            className="code min-w-0 flex-1 px-3 text-[15px] text-slate-900 outline-none placeholder:text-slate-500"
          />
          <button type="submit" aria-label="Find parts" className="grid w-12 place-items-center bg-primary text-primary-fg hover:bg-primary-hover">
            <Search className="size-5" />
          </button>
        </div>
      </form>
    </section>
  )
}

function BulkCallout() {
  return (
    <Link to="/search?bulk=true" className="group flex flex-col justify-between gap-3 rounded-md bg-accent p-5 text-accent-fg">
      <span className="flex items-center gap-2">
        <Layers className="size-5 shrink-0" strokeWidth={1.9} />
        <span className="text-xl leading-tight font-extrabold">Buying in bulk?</span>
      </span>
      <span className="text-sm">Price breaks apply automatically in your cart. For larger orders, ask the seller for a quote.</span>
      <span className="inline-flex items-center gap-1 text-sm font-bold group-hover:underline">
        Shop bulk deals <ArrowRight className="size-4" />
      </span>
    </Link>
  )
}

/** No hero banners yet: the same full-width banner, over a department photo. */
function FallbackHero({ siteName, tagline, tree }) {
  const photo = tree.find((d) => d.image?.url)?.image.url
  return (
    <section className="relative isolate overflow-hidden rounded-md bg-secondary text-secondary-fg">
      {photo && (
        <>
          <Thumb src={photo} alt="" fit="cover" className="absolute inset-0 -z-10 size-full" />
          <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-r from-secondary via-secondary/85 to-secondary/30" />
        </>
      )}
      <div className="flex min-h-[340px] flex-col justify-between gap-8 p-7 sm:min-h-[380px] sm:p-10 lg:h-[400px] lg:p-11">
        <div className="flex max-w-xl flex-col gap-4">
          <span className="code text-xs tracking-widest text-accent uppercase">{siteName}</span>
          <h1 className="font-display text-[2.2rem] leading-[0.98] font-extrabold tracking-[-0.03em] [font-stretch:110%] sm:text-[3.1rem] lg:text-[3.4rem]">
            Tools, machinery and spare parts from reviewed sellers.
          </h1>
          {tagline && <p className="max-w-md text-[1.0625rem] leading-relaxed text-secondary-fg/75">{tagline}</p>}
        </div>
        <div className="flex flex-wrap gap-3">
          <a href="#departments" className="inline-flex h-12 items-center gap-2 rounded-md bg-accent px-5 font-bold text-accent-fg hover:brightness-[0.96]">
            Shop departments <ArrowRight className="size-4" />
          </a>
          <Link to="/search?bulk=true" className="inline-flex h-12 items-center rounded-md border-[1.5px] border-white/35 px-5 font-semibold hover:border-white/70">
            Bulk &amp; quotes
          </Link>
        </div>
      </div>
    </section>
  )
}

/** Department directory: every root with its sub-departments as plain links, like a trade catalogue index. */
function Departments({ tree, loading }) {
  return (
    <section id="departments" className="mx-auto mt-14 max-w-7xl scroll-mt-40 px-4 sm:px-6">
      <SectionHeading title="Shop by department" />
      {loading ? (
        <div className="grid gap-px sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
      ) : (
        <div className="grid gap-px overflow-hidden rounded-md border border-slate-200 bg-slate-200 sm:grid-cols-2 lg:grid-cols-3">
          {tree.map((dept) => (
            <div key={dept._id} className="flex gap-4 bg-white p-5">
              <Link to={`/c/${dept.slug}`} className="shrink-0" tabIndex={-1} aria-hidden>
                <Thumb src={dept.image?.url} alt="" className="size-20 rounded bg-slate-100" fit="cover" />
              </Link>
              <div className="min-w-0">
                <Link to={`/c/${dept.slug}`} className="font-display text-xl leading-tight font-bold text-slate-900 hover:underline">
                  {dept.name}
                </Link>
                <ul className="mt-2 flex flex-col gap-1">
                  {(dept.children ?? []).slice(0, 4).map((sub) => (
                    <li key={sub._id}>
                      <Link to={`/c/${sub.slug}`} className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 hover:underline">
                        {sub.image?.url && <Thumb src={sub.image.url} alt="" className="size-5 shrink-0 rounded-sm" fit="cover" />}
                        {sub.name}
                      </Link>
                    </li>
                  ))}
                </ul>
                {dept.children?.length > 4 && (
                  <Link to={`/c/${dept.slug}`} className="mt-1.5 inline-block text-sm font-semibold text-slate-900 hover:underline">
                    + {dept.children.length - 4} more
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function Brands({ title, brands }) {
  if (!brands?.length) return null
  return (
    <section className="mx-auto mt-16 max-w-7xl px-4 sm:px-6">
      <SectionHeading title={title || 'Brands'} />
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-slate-200 bg-slate-200 sm:grid-cols-4 lg:grid-cols-6">
        {brands.slice(0, 12).map((b) => (
          <Link
            key={b.value}
            to={`/search?brand=${encodeURIComponent(b.value)}`}
            className="flex h-20 items-center justify-center bg-white px-3 text-center font-display text-xl font-bold tracking-wide text-slate-400 uppercase transition-colors hover:text-slate-900"
          >
            {b.value}
          </Link>
        ))}
      </div>
    </section>
  )
}

const HOW_IT_WORKS = [
  { title: 'Reviewed sellers', text: 'Every store’s GST and bank details are checked before it can sell.' },
  { title: 'Parts matched to machines', text: 'Sellers link spare parts to the exact models they fit.' },
  { title: 'Bulk pricing built in', text: 'Price breaks apply in your cart. Need more? Request a quote.' },
  { title: 'GST billing', text: 'Add your GSTIN at checkout; it’s shared with the seller for billing.' },
]

function OfferTiles({ offers }) {
  if (!offers.length) return null
  return (
    <section className="mx-auto mt-14 grid max-w-7xl gap-4 px-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-3">
      {offers.slice(0, 3).map((b) => (
        <Link key={b._id} to={b.link || '#'} className="block overflow-hidden rounded-md">
          <img src={b.image.url} alt={b.title} loading="lazy" className="aspect-[2/1] w-full object-cover transition-transform duration-500 hover:scale-[1.02]" />
        </Link>
      ))}
    </section>
  )
}

function PromoStrip({ strip }) {
  if (!strip) return null
  return (
    <section className="mx-auto mt-16 max-w-7xl px-4 sm:px-6">
      <Link to={strip.link || '#'} className="block overflow-hidden rounded-md">
        <img src={strip.image.url} alt={strip.title} loading="lazy" className="aspect-[16/3] w-full object-cover" />
      </Link>
    </section>
  )
}

function HowItWorks() {
  return (
    <section className="mt-20 border-y border-slate-200 bg-slate-100">
      <div className="mx-auto grid max-w-7xl gap-px px-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
        {HOW_IT_WORKS.map((item, i) => (
          <div key={item.title} className={`py-8 lg:px-6 ${i > 0 ? 'lg:border-l lg:border-slate-200' : 'lg:pl-0'}`}>
            <p className="font-display text-sm font-semibold text-slate-400 tabular">0{i + 1}</p>
            <h3 className="mt-1 font-display text-xl font-bold text-slate-900">{item.title}</h3>
            <p className="mt-1 text-sm text-slate-600">{item.text}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

function SellCta({ siteName }) {
  return (
    <section className="mx-auto mt-16 max-w-7xl px-4 sm:px-6">
      <div className="grid items-center gap-6 rounded-md border-2 border-slate-900 p-8 md:grid-cols-[1fr_auto]">
        <div>
          <h2 className="font-display text-3xl leading-tight font-bold text-slate-900">Sell on {siteName}</h2>
          <p className="mt-2 max-w-2xl text-slate-600">
            Dealers, distributors and manufacturers: list tools, machinery and spare parts, set bulk prices, answer quote requests and manage orders from one dashboard.
          </p>
        </div>
        <Button size="lg" variant="secondary" asChild>
          <Link to="/vendor/login">
            Start selling <ArrowRight />
          </Link>
        </Button>
      </div>
    </section>
  )
}

/** One block of the admin-arranged page (Admin → Home page). */
function HomeSection({ section: s, siteName, offers, strip }) {
  switch (s.kind) {
    case 'products':
      return <ProductRail className="mt-16" title={s.title} subtitle={s.subtitle} products={s.products} rows={s.rows} viewAll={s.viewAll} />
    case 'partsFinder':
      return (
        <div className="mx-auto mt-4 grid max-w-7xl gap-4 px-4 sm:px-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <PartsFinder />
          <BulkCallout />
        </div>
      )
    case 'offers':
      return <OfferTiles offers={offers} />
    case 'strip':
      return <PromoStrip strip={strip} />
    case 'brands':
      return <Brands title={s.title} brands={s.brands} />
    case 'stats':
      return <StatsBand siteName={siteName} className="mt-16" />
    case 'howItWorks':
      return <HowItWorks />
    case 'sellCta':
      return <SellCta siteName={siteName} />
    default:
      return null
  }
}

export default function HomePage() {
  const { data: settings } = usePublicSettings()
  const { data: tree = [], isLoading: treeLoading } = useCategoryTree()
  const { data: banners = [], isLoading: bannersLoading } = useQuery({ queryKey: storeKeys.banners, queryFn: storeApi.banners, staleTime: 5 * 60_000 })
  // Shuffled per visit on the server; kept for the session so going back doesn't reshuffle under the visitor.
  const home = useQuery({ queryKey: storeKeys.home, queryFn: storeApi.home, staleTime: Infinity })

  const siteName = settings?.branding.siteName ?? 'ToolsHubs'
  const title = useSeoTitle('home', {})
  const hero = banners.filter((b) => b.placement === 'home_hero')
  const offers = banners.filter((b) => b.placement === 'home_offer')
  const strip = banners.find((b) => b.placement === 'home_strip')

  return (
    <>
      <title>{title}</title>
      <meta
        name="description"
        content={fillTemplate(settings?.seo?.home?.description, { site: siteName }) || 'Buy tools, machinery and spare parts from reviewed sellers across India, with bulk pricing and quotes for business buyers.'}
      />

      <div className="mx-auto max-w-7xl px-4 pt-5 sm:px-6">
        {bannersLoading || treeLoading ? (
          <Skeleton className="h-[400px] w-full rounded-md" />
        ) : hero.length ? (
          <HeroCarousel banners={hero} />
        ) : (
          <FallbackHero siteName={siteName} tagline={settings?.branding?.tagline} tree={tree} />
        )}
      </div>
      <ServiceStrip className="mt-4" />

      <Departments tree={tree} loading={treeLoading} />

      {home.isLoading
        ? [0, 1].map((i) => <ProductRail key={i} className="mt-16" title="" loading />)
        : (home.data?.sections ?? []).map((s) => <HomeSection key={s.id} section={s} siteName={siteName} offers={offers} strip={strip} />)}
    </>
  )
}
