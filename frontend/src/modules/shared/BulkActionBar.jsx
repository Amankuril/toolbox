import { X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { errorMessage } from '@/core/api/errors'
import { formatNumber } from '@/core/lib/format'
import { Button } from '@/ui/Button'
import { ConfirmDialog } from '@/ui/Dialog'

/**
 * Sticky bar over a table while rows are ticked: how many, actions for all of them, and clear.
 *
 * @param {{ selected: Set<string>, onClear: () => void, noun?: [string, string],
 *   actions: { key: string, label: string, icon?: any, danger?: boolean, confirm?: { title: (n: number) => string, description: string, label: string } }[],
 *   run: (action: string, ids: string[]) => Promise<{ updated: number, skipped: number }>, done?: Record<string, string>, onDone?: () => void }} props
 *   `done`: past-tense verb per action for the toast ("hidden", "deleted").
 */
export function BulkActionBar({ selected, onClear, actions, run, done = {}, onDone, noun = ['product', 'products'] }) {
  const [busy, setBusy] = useState(null)
  const [confirming, setConfirming] = useState(null)
  const n = selected.size
  if (!n) return null
  const plural = (k) => `${formatNumber(k)} ${k === 1 ? noun[0] : noun[1]}`

  const go = async (action) => {
    setBusy(action.key)
    try {
      const { updated, skipped } = await run(action.key, [...selected])
      toast.success(`${plural(updated)} ${done[action.key] ?? 'updated'}`, {
        description: skipped ? `${plural(skipped)} skipped: the action doesn’t apply to ${skipped === 1 ? 'it' : 'them'} (check the status).` : undefined,
      })
      onClear()
      onDone?.()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <div
        role="region"
        aria-label="Bulk actions"
        className="sticky top-2 z-20 flex flex-wrap items-center gap-2 border-b border-primary/20 bg-primary/5 px-4 py-2.5 backdrop-blur"
      >
        <span className="mr-1 text-sm font-semibold text-slate-900">{plural(n)} selected</span>
        {actions.map((a) => {
          const Icon = a.icon
          return (
            <Button
              key={a.key}
              size="sm"
              variant={a.danger ? 'danger-outline' : 'outline'}
              loading={busy === a.key}
              disabled={busy !== null}
              onClick={() => (a.confirm ? setConfirming(a) : go(a))}
            >
              {Icon && <Icon />} {a.label}
            </Button>
          )
        })}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onClear} disabled={busy !== null}>
          <X /> Clear
        </Button>
      </div>
      <ConfirmDialog
        open={Boolean(confirming)}
        onOpenChange={(v) => !v && setConfirming(null)}
        title={confirming?.confirm.title(n) ?? ''}
        description={confirming?.confirm.description}
        confirmLabel={confirming?.confirm.label}
        onConfirm={() => go(confirming)}
      />
    </>
  )
}
