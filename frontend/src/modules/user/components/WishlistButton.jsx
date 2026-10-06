import { Heart } from 'lucide-react'
import { cn } from '@/core/lib/cn'
import { useWishlist } from '../wishlist/useWishlist'

/**
 * Heart toggle. `overlay` sits on a product image; `labelled` is the product-page button.
 * Always a sibling of the card link, never inside it (no nested interactive elements).
 */
export function WishlistButton({ product, variant = 'overlay', className }) {
  const wishlist = useWishlist()
  const saved = wishlist.has(product._id)
  const label = saved ? `Remove ${product.name} from wishlist` : `Save ${product.name} to wishlist`
  const icon = <Heart className={cn('size-[18px] transition-colors', saved ? 'fill-red-600 text-red-600' : 'text-slate-700')} strokeWidth={1.9} />

  if (variant === 'labelled') {
    return (
      <button
        type="button"
        aria-pressed={saved}
        aria-label={label}
        onClick={() => wishlist.toggle(product)}
        className={cn(
          'inline-flex h-12 items-center justify-center gap-2 rounded-md border-[1.5px] border-slate-300 bg-white px-4 font-semibold text-slate-800 transition-colors hover:border-slate-500',
          className,
        )}
      >
        {icon}
        {saved ? 'Saved' : 'Save'}
      </button>
    )
  }
  return (
    <button
      type="button"
      aria-pressed={saved}
      aria-label={label}
      title={saved ? 'Saved to wishlist' : 'Save to wishlist'}
      onClick={() => wishlist.toggle(product)}
      className={cn(
        'grid size-9 place-items-center rounded-full bg-white/95 shadow-[0_1px_2px_rgb(0_0_0/0.12)] ring-1 ring-slate-200 transition-transform hover:scale-105 active:scale-95',
        className,
      )}
    >
      {icon}
    </button>
  )
}
