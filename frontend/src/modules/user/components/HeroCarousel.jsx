import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { cn } from '@/core/lib/cn'
import { Button } from '@/ui/Button'

const INTERVAL = 6000
// Arrows stay out of the way of copy baked into banner images until the pointer or keyboard is on the carousel.
const ARROW =
  'absolute top-1/2 hidden -translate-y-1/2 rounded-full bg-white/90 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 sm:inline-flex'

function BannerLink({ banner, children, ...props }) {
  if (!banner.link) return <div {...props}>{children}</div>
  return /^https?:\/\//.test(banner.link) ? (
    <a href={banner.link} rel="noopener" {...props}>
      {children}
    </a>
  ) : (
    <Link to={banner.link} {...props}>
      {children}
    </Link>
  )
}

/** Auto-advancing hero banners. Pauses on hover/focus and respects reduced motion. */
export function HeroCarousel({ banners, fill = false }) {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const count = banners.length

  useEffect(() => {
    if (count < 2 || paused || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const t = setInterval(() => setIndex((i) => (i + 1) % count), INTERVAL)
    return () => clearInterval(t)
  }, [count, paused])

  const go = (i) => setIndex((i + count) % count)

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Featured offers"
      className={cn('group relative overflow-hidden rounded-md bg-slate-200', fill && 'lg:h-full')}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className={cn('flex transition-transform duration-500 ease-out', fill && 'lg:h-full')} style={{ transform: `translateX(-${index * 100}%)` }}>
        {banners.map((b, i) => (
          <BannerLink
            key={b._id}
            banner={b}
            className={cn('relative block w-full shrink-0', fill && 'lg:h-full')}
            aria-hidden={i !== index}
            tabIndex={i === index ? undefined : -1}
          >
            <picture className={cn(fill && 'lg:block lg:h-full')}>
              {b.mobileImage && <source media="(max-width: 640px)" srcSet={b.mobileImage.url} />}
              {/* Without a dedicated mobile image, keep the wide ratio so text baked into the banner isn't cropped. */}
              <img
                src={b.image.url}
                alt={b.title}
                className={cn('w-full object-cover', b.mobileImage ? 'aspect-[4/3] sm:aspect-[16/5]' : 'aspect-[16/5]', fill && 'lg:aspect-auto lg:h-full')}
                loading={i === 0 ? 'eager' : 'lazy'}
                fetchPriority={i === 0 ? 'high' : 'auto'}
              />
            </picture>
            {b.ctaLabel && (
              <span className={cn('absolute bottom-4 left-4 sm:bottom-8 sm:left-10', !b.mobileImage && 'hidden sm:block')}>
                <span className="inline-flex items-center gap-2 rounded-md bg-white px-4 py-2 text-sm font-semibold text-slate-900 shadow-lg">
                  {b.ctaLabel} <ArrowRight className="size-4" />
                </span>
              </span>
            )}
          </BannerLink>
        ))}
      </div>
      {count > 1 && (
        <>
          <Button variant="outline" size="icon" aria-label="Previous slide" onClick={() => go(index - 1)} className={cn(ARROW, 'left-3')}>
            <ChevronLeft />
          </Button>
          <Button variant="outline" size="icon" aria-label="Next slide" onClick={() => go(index + 1)} className={cn(ARROW, 'right-3')}>
            <ChevronRight />
          </Button>
          <div className="absolute inset-x-0 bottom-3 flex justify-center gap-1.5">
            {banners.map((b, i) => (
              <button
                key={b._id}
                type="button"
                aria-label={`Go to slide ${i + 1}`}
                aria-current={i === index}
                onClick={() => go(i)}
                className={cn('h-1.5 rounded-full transition-all', i === index ? 'w-6 bg-white' : 'w-1.5 bg-white/60')}
              />
            ))}
          </div>
        </>
      )}
    </section>
  )
}
