import { MoreVertical } from 'lucide-react'
import { Button } from './Button'
import { ConfirmDialog } from './Dialog'
import { Menu } from './Controls'
import { ReasonDialog } from './ReasonDialog'

/** The ⋮ button at the end of a table row. `items` follow the Menu format; falsy entries are skipped. */
export function RowActions({ items, label = 'Row actions' }) {
  return (
    <div className="flex justify-end">
      <Menu
        trigger={
          <Button size="icon-sm" variant="ghost" aria-label={label} className="text-slate-500 hover:text-slate-900">
            <MoreVertical />
          </Button>
        }
        items={items.filter(Boolean)}
      />
    </div>
  )
}

/**
 * Renders the confirm / reason dialog for whichever row action is pending.
 * `action` is `{ type, row }` or null; `configs[type]` describes the dialog:
 *   { kind: 'confirm' | 'reason', title(row), description, confirmLabel, tone, label, placeholder, run(row, note) }
 */
export function ActionDialog({ action, onClose, configs }) {
  const config = action ? configs[action.type] : null
  const row = action?.row
  const open = Boolean(config)
  const resolve = (v) => (typeof v === 'function' ? v(row) : v)

  if (config?.kind === 'reason') {
    return (
      <ReasonDialog
        key={`${action.type}-${row?._id}`}
        open={open}
        onOpenChange={(v) => !v && onClose()}
        title={resolve(config.title)}
        description={resolve(config.description)}
        label={config.label}
        placeholder={config.placeholder}
        confirmLabel={config.confirmLabel}
        tone={config.tone}
        required={config.required ?? true}
        onSubmit={(note) => config.run(row, note)}
      />
    )
  }
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={config ? resolve(config.title) : ''}
      description={config ? resolve(config.description) : ''}
      confirmLabel={config?.confirmLabel}
      tone={config?.tone}
      onConfirm={() => config?.run(row)}
    />
  )
}
