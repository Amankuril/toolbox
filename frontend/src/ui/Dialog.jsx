import { X } from 'lucide-react'
import { AlertDialog, Dialog as RDialog } from 'radix-ui'
import { useState } from 'react'
import { cn } from '@/core/lib/cn'
import { Button } from './Button'

const overlay = 'fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-[2px]'
const panel =
  'fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-slate-200 bg-white shadow-2xl focus:outline-none'

const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }

/**
 * Controlled or uncontrolled modal. `footer` is pinned; the body scrolls.
 */
export function Dialog({ open, onOpenChange, trigger, title, description, children, footer, size = 'md', className }) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <RDialog.Trigger asChild>{trigger}</RDialog.Trigger>}
      <RDialog.Portal>
        <RDialog.Overlay className={overlay} />
        <RDialog.Content className={cn(panel, widths[size], className)}>
          <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
            <div>
              <RDialog.Title className="text-base font-semibold text-slate-900">{title}</RDialog.Title>
              {description ? (
                <RDialog.Description className="mt-0.5 text-sm text-slate-500">{description}</RDialog.Description>
              ) : (
                <RDialog.Description className="sr-only">{title}</RDialog.Description>
              )}
            </div>
            <RDialog.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Close" className="-mr-2 -mt-1">
                <X />
              </Button>
            </RDialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</div>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  )
}

/** Side sheet for mobile filters / navigation. */
export function Sheet({ open, onOpenChange, title, children, side = 'left', footer }) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className={overlay} />
        <RDialog.Content
          className={cn('fixed inset-y-0 z-50 flex w-[88vw] max-w-sm flex-col bg-white shadow-2xl focus:outline-none', side === 'left' ? 'left-0' : 'right-0')}
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <RDialog.Title className="text-base font-semibold">{title}</RDialog.Title>
            <RDialog.Description className="sr-only">{title}</RDialog.Description>
            <RDialog.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Close">
                <X />
              </Button>
            </RDialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
          {footer && <div className="border-t border-slate-100 p-3">{footer}</div>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  )
}

/**
 * Confirmation for destructive / important actions. `onConfirm` may be async;
 * the dialog stays open with a spinner until it settles.
 */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel = 'Confirm',
  tone = 'danger',
  onConfirm,
  children,
  open: controlledOpen,
  onOpenChange,
}) {
  const [internalOpen, setInternalOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = onOpenChange ?? setInternalOpen

  const handle = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await onConfirm?.()
      setOpen(false)
    } catch {
      /* caller surfaces the error (toast); keep the dialog open */
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog.Root open={open} onOpenChange={(v) => !busy && setOpen(v)}>
      {trigger && <AlertDialog.Trigger asChild>{trigger}</AlertDialog.Trigger>}
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={overlay} />
        <AlertDialog.Content className={cn(panel, widths.sm, 'p-5')}>
          <AlertDialog.Title className="text-base font-semibold text-slate-900">{title}</AlertDialog.Title>
          <AlertDialog.Description className="mt-1.5 text-sm text-slate-600">{description}</AlertDialog.Description>
          {children && <div className="mt-4">{children}</div>}
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <Button variant="outline" disabled={busy}>
                Cancel
              </Button>
            </AlertDialog.Cancel>
            <Button variant={tone === 'danger' ? 'danger' : 'primary'} loading={busy} onClick={handle}>
              {confirmLabel}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
