import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { cn } from '@/core/lib/cn'

const INTERVAL = 7000

function SmartLink({ to, className, children }) {
  if (!to) return <span className={className}>{children}</span>
  return /^https?:\/\//.test(to) ? (
    <a href={to} rel="noopener" className={className}>
      {children}
    </a>
  ) : (
    <Link to={to} className={className}>
      {children}
    </Link>
  )
}

/**
 * Editorial hero: a night panel carrying the banner's own words (title, subtitle, button)
 * beside a photo plate with its image. Admins keep full control through the banner fields;
 * text is real text (searchable, translatable, readable on phones) rather than baked into art.
 */
export function HeroCarousel({ banners }) {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const count = banners.length
  const b = banners[index] ?? banners[0]

  useEffect(() => {
    if (count < 2 || paused || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const t = setInterval(() => setIndex((i) => (i + 1) % count), INTERVAL)
    return () => clearInterval(t)
  }, [count, paused])

  const go = (i) => setIndex((i + count) % count)

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Featured"
      className="grid gap-4 lg:min-h-[400px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="order-2 flex flex-col justify-between gap-8 rounded-md bg-secondary p-7 text-secondary-fg sm:p-10 lg:order-1 lg:p-11">
        <div key={b._id} className="flex animate-[fade-in_400ms_ease-out] flex-col gap-4">
          {count > 1 && (
            <span className="code text-xs tracking-widest text-secondary-fg/55">
              {String(index + 1).padStart(2, '0')} / {String(count).padStart(2, '0')}
            </span>
          )}
          <h1 className="font-display text-[2.4rem] leading-[0.98] font-extrabold tracking-[-0.03em] [font-stretch:110%] sm:text-[3.1rem] lg:text-[3.4rem]">
            {b.title}
          </h1>
          {b.subtitle && <p className="max-w-md text-[1.0625rem] leading-relaxed text-secondary-fg/75">{b.subtitle}</p>}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap gap-3">
            <SmartLink
              to={b.link || '/search'}
              className="inline-flex h-12 items-center gap-2 rounded-md bg-accent px-5 font-bold text-accent-fg transition-[filter] hover:brightness-[0.96]"
            >
              {b.ctaLabel || 'Shop now'} <ArrowRight className="size-4" />
            </SmartLink>
            <Link
              to="/search?bulk=true"
              className="inline-flex h-12 items-center rounded-md border-[1.5px] border-white/35 px-5 font-semibold text-secondary-fg transition-colors hover:border-white/70"
            >
              Bulk &amp; quotes
            </Link>
          </div>
          {count > 1 && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Previous"
                onClick={() => go(index - 1)}
                className="grid size-10 place-items-center rounded-md border border-white/25 hover:border-white/60"
              >
                <ChevronLeft className="size-4" />
              </button>
              <button
                type="button"
                aria-label="Next"
                onClick={() => go(index + 1)}
                className="grid size-10 place-items-center rounded-md border border-white/25 hover:border-white/60"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      <SmartLink to={b.link} className="relative order-1 block overflow-hidden rounded-md bg-slate-100 lg:order-2">
        <picture>
          {b.mobileImage && <source media="(max-width: 640px)" srcSet={b.mobileImage.url} />}
          <img
            key={b._id}
            src={b.image.url}
            alt={b.title}
            className="aspect-[16/10] w-full animate-[fade-in_400ms_ease-out] object-cover lg:absolute lg:inset-0 lg:aspect-auto lg:h-full"
            loading={index === 0 ? 'eager' : 'lazy'}
            fetchPriority={index === 0 ? 'high' : 'auto'}
          />
        </picture>
        {count > 1 && (
          <span className="absolute bottom-4 left-4 flex gap-1.5" aria-hidden>
            {banners.map((x, i) => (
              <span key={x._id} className={cn('h-1.5 rounded-full transition-all', i === index ? 'w-6 bg-accent' : 'w-1.5 bg-white/80')} />
            ))}
          </span>
        )}
      </SmartLink>
    </section>
  )
}
