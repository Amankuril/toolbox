import { cn } from '@/core/lib/cn'
import { Button } from '@/ui/Button'

/**
 * Click-to-chat link for one number. Not wa.me: its redirect turns emoji into "�"; api.whatsapp.com keeps them
 * (same as the API's leads links). Without a number, WhatsApp asks who to send it to.
 */
export function whatsappLink(phone, text = '') {
  const digits = String(phone ?? '').replace(/\D/g, '')
  // Bare 10-digit Indian mobiles get the country code.
  const number = digits.length === 10 ? `91${digits}` : digits
  const query = [number && `phone=${number}`, text && `text=${encodeURIComponent(text)}`].filter(Boolean).join('&')
  return `https://api.whatsapp.com/send${query ? `?${query}` : ''}`
}

/** The WhatsApp glyph (lucide has no brand marks). */
export function WhatsAppIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={cn('size-4', className)}>
      <path d="M17.47 14.38c-.3-.15-1.75-.86-2.02-.96-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.25-.46-2.38-1.47-.88-.79-1.47-1.76-1.65-2.06-.17-.3-.02-.46.13-.6.13-.14.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.6-.92-2.2-.24-.58-.49-.5-.67-.5h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.07 2.88 1.21 3.07.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.7.63.71.22 1.36.19 1.87.12.57-.09 1.75-.72 2-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35M12.05 21.5h-.01a9.4 9.4 0 0 1-4.8-1.32l-.34-.2-3.57.94.95-3.48-.22-.36a9.4 9.4 0 0 1-1.44-5.02c0-5.2 4.24-9.43 9.44-9.43 2.52 0 4.89.98 6.67 2.77a9.37 9.37 0 0 1 2.76 6.67c0 5.2-4.23 9.43-9.44 9.43m8.03-17.47A11.3 11.3 0 0 0 12.05.7C5.79.7.7 5.79.7 12.04c0 2 .52 3.95 1.52 5.67L.6 23.3l5.72-1.5a11.3 11.3 0 0 0 5.72 1.46h.01c6.25 0 11.34-5.09 11.34-11.34 0-3.03-1.18-5.88-3.32-8.02" />
    </svg>
  )
}

/** Opens a WhatsApp chat with `phone`, the message typed in. Icon-only unless `label` is given. */
export function WhatsAppButton({ phone, text, label, size, variant = 'ghost', className, title = 'Chat on WhatsApp' }) {
  if (!phone) return null
  return (
    <Button
      asChild
      variant={variant}
      size={label ? (size ?? 'sm') : (size ?? 'icon-sm')}
      className={cn('text-[#128c4b] hover:text-[#0b6e3a]', className)}
    >
      <a href={whatsappLink(phone, text)} target="_blank" rel="noopener noreferrer" title={label ? undefined : title} aria-label={label ? undefined : title} onClick={(e) => e.stopPropagation()}>
        <WhatsAppIcon />
        {label}
      </a>
    </Button>
  )
}
