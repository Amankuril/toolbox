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
 * One full-width banner: the image fills the frame and the banner's own words (title, subtitle, button)
 * sit over it on a dark fade. Admins keep full control through the banner fields; text is real text
 * (searchable, translatable, readable on phones) rather than baked into the art.
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
      className="relative isolate overflow-hidden rounded-md bg-secondary text-white"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <SmartLink to={b.link} className="absolute inset-0 -z-10 block" aria-hidden tabIndex={-1}>
        <picture>
          {b.mobileImage && <source media="(max-width: 640px)" srcSet={b.mobileImage.url} />}
          <img
            key={b._id}
            src={b.image.url}
            alt=""
            className="size-full animate-[fade-in_400ms_ease-out] object-cover"
            loading={index === 0 ? 'eager' : 'lazy'}
            fetchPriority={index === 0 ? 'high' : 'auto'}
          />
        </picture>
      </SmartLink>
      {/* Keeps the words readable over any photo: darkest behind the text, clear on the far side. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-t from-black/80 via-black/45 to-black/10 sm:bg-gradient-to-r sm:from-black/75 sm:via-black/40 sm:to-transparent" />

      <div className="flex min-h-[340px] flex-col justify-end gap-8 p-7 sm:min-h-[380px] sm:justify-between sm:p-10 lg:h-[400px] lg:p-11">
        <div key={b._id} className="flex max-w-xl animate-[fade-in_400ms_ease-out] flex-col gap-4">
          {count > 1 && (
            <span className="code text-xs tracking-widest text-white/60">
              {String(index + 1).padStart(2, '0')} / {String(count).padStart(2, '0')}
            </span>
          )}
          <h1 className="font-display text-[2.2rem] leading-[0.98] font-extrabold tracking-[-0.03em] [font-stretch:110%] drop-shadow-sm sm:text-[3.1rem] lg:text-[3.4rem]">
            {b.title}
          </h1>
          {b.subtitle && <p className="max-w-md text-[1.0625rem] leading-relaxed text-white/85">{b.subtitle}</p>}
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
              className="inline-flex h-12 items-center rounded-md border-[1.5px] border-white/45 px-5 font-semibold text-white backdrop-blur-[2px] transition-colors hover:border-white/80"
            >
              Bulk &amp; quotes
            </Link>
          </div>
          {count > 1 && (
            <div className="flex items-center gap-3">
              <span className="flex gap-1.5" aria-hidden>
                {banners.map((x, i) => (
                  <span key={x._id} className={cn('h-1.5 rounded-full transition-all', i === index ? 'w-6 bg-accent' : 'w-1.5 bg-white/70')} />
                ))}
              </span>
              <button
                type="button"
                aria-label="Previous"
                onClick={() => go(index - 1)}
                className="grid size-10 place-items-center rounded-md border border-white/35 bg-black/20 hover:border-white/70"
              >
                <ChevronLeft className="size-4" />
              </button>
              <button
                type="button"
                aria-label="Next"
                onClick={() => go(index + 1)}
                className="grid size-10 place-items-center rounded-md border border-white/35 bg-black/20 hover:border-white/70"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
