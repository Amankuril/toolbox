import { Check, Copy, Mail, MessageCircle, Send, Share2 } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'
import { cn } from '@/core/lib/cn'
import { Button } from '@/ui/Button'
import { Dialog } from '@/ui/Dialog'

/** Public storefront address of a product. The panels share the storefront's origin. */
export const productLink = (slug) => `${window.location.origin}/p/${slug}`

const canNativeShare = () => typeof navigator !== 'undefined' && typeof navigator.share === 'function'
// Phones and tablets get the system share sheet straight away; desktops get the dialog (their sheets are thin).
const prefersNativeShare = () => canNativeShare() && window.matchMedia?.('(pointer: coarse)').matches

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Older browsers / non-secure origins: fall back to a hidden textarea.
    const el = Object.assign(document.createElement('textarea'), { value: text })
    el.setAttribute('readonly', '')
    el.style.cssText = 'position:fixed;opacity:0'
    document.body.appendChild(el)
    el.select()
    const done = document.execCommand('copy')
    el.remove()
    return done
  }
}

const enc = encodeURIComponent

/** Where a link can be sent. `href` builds the share URL; `mark` is the coloured badge. */
const TARGETS = [
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    mark: <MessageCircle />,
    color: 'bg-[#25d366]',
    href: ({ url, text }) => `https://wa.me/?text=${enc(`${text}\n${url}`)}`,
  },
  {
    id: 'telegram',
    label: 'Telegram',
    mark: <Send />,
    color: 'bg-[#229ed9]',
    href: ({ url, text }) => `https://t.me/share/url?url=${enc(url)}&text=${enc(text)}`,
  },
  { id: 'facebook', label: 'Facebook', mark: 'f', color: 'bg-[#1877f2]', href: ({ url }) => `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}` },
  { id: 'x', label: 'X', mark: 'X', color: 'bg-slate-950', href: ({ url, text }) => `https://x.com/intent/post?url=${enc(url)}&text=${enc(text)}` },
  {
    id: 'linkedin',
    label: 'LinkedIn',
    mark: 'in',
    color: 'bg-[#0a66c2]',
    href: ({ url }) => `https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}`,
  },
  {
    id: 'email',
    label: 'Email',
    mark: <Mail />,
    color: 'bg-slate-600',
    href: ({ url, text, title }) => `mailto:?subject=${enc(title)}&body=${enc(`${text}\n\n${url}`)}`,
  },
]

/**
 * Copy-link field plus one-tap targets. `onShare(method)` reports what was used (storefront analytics).
 * `item` is { title, url, text }.
 */
export function ShareDialog({ open, onOpenChange, item, onShare }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef(null)
  if (!item) return null

  const copy = async () => {
    if (!(await copyText(item.url))) return toast.error('Could not copy. Select the link and copy it manually.')
    setCopied(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 2000)
    onShare?.('copy_link')
  }
  const more = async () => {
    try {
      await navigator.share({ title: item.title, text: item.text, url: item.url })
      onShare?.('native')
      onOpenChange(false)
    } catch {
      /* dismissed */
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sm" title="Share" description={item.title}>
      <div className="flex gap-2">
        <input
          readOnly
          value={item.url}
          aria-label="Link"
          onFocus={(e) => e.target.select()}
          className="code h-10 min-w-0 flex-1 rounded-md border border-slate-300 bg-slate-50 px-3 text-xs text-slate-700"
        />
        <Button variant={copied ? 'soft' : 'primary'} onClick={copy} className="shrink-0">
          {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <ul className="mt-5 grid grid-cols-3 gap-x-2 gap-y-4">
        {TARGETS.map((t) => (
          <li key={t.id}>
            <a
              href={t.href(item)}
              target={t.id === 'email' ? undefined : '_blank'}
              rel="noopener noreferrer"
              onClick={() => onShare?.(t.id)}
              className="group flex flex-col items-center gap-1.5 rounded-md py-1 text-xs font-medium text-slate-700 hover:text-slate-900"
            >
              <span
                aria-hidden
                className={cn(
                  'grid size-11 place-items-center rounded-full font-display text-base font-bold text-white transition-transform group-hover:scale-105 [&_svg]:size-5',
                  t.color,
                )}
              >
                {t.mark}
              </span>
              {t.label}
            </a>
          </li>
        ))}
      </ul>
      {canNativeShare() && (
        <Button variant="ghost" size="sm" className="mt-4 w-full" onClick={more}>
          <Share2 /> More options
        </Button>
      )}
    </Dialog>
  )
}

/**
 * `share(item)` opens the phone's share sheet, or the share dialog elsewhere. Render `dialog` once.
 * `item` is { title, url, text? }.
 */
export function useShare({ onShare } = {}) {
  const [item, setItem] = useState(null)
  const [open, setOpen] = useState(false)

  const share = useCallback(
    async (next) => {
      const full = { text: next.title, ...next }
      if (prefersNativeShare()) {
        try {
          await navigator.share({ title: full.title, text: full.text, url: full.url })
          onShare?.('native')
          return
        } catch (err) {
          if (err?.name === 'AbortError') return
          // Share sheet unavailable for this content: fall through to the dialog.
        }
      }
      setItem(full)
      setOpen(true)
    },
    [onShare],
  )

  const dialog = <ShareDialog open={open} onOpenChange={setOpen} item={item} onShare={onShare} />
  return { share, dialog }
}

/** Ready-made share item for a storefront product. */
export const productShareItem = (product, siteName) => ({
  title: product.name,
  url: productLink(product.slug),
  text: siteName ? `${product.name} on ${siteName}` : product.name,
})

/** Icon/labelled share button for one product (or any item). */
export function ShareButton({ item, onShare, variant = 'outline', size = 'md', label = 'Share', iconOnly = false, className }) {
  const { share, dialog } = useShare({ onShare })
  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={iconOnly ? 'icon' : size}
        className={className}
        aria-label={iconOnly ? `${label}: ${item.title}` : undefined}
        title={iconOnly ? label : undefined}
        onClick={() => share(item)}
      >
        <Share2 />
        {!iconOnly && label}
      </Button>
      {dialog}
    </>
  )
}
