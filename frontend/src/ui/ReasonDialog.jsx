import { useState } from 'react'
import { Button } from './Button'
import { Dialog } from './Dialog'
import { Field, Textarea } from './Field'

/**
 * Collects a mandatory note before a negative action (reject, suspend, cancel).
 * `onSubmit(note)` may be async; the dialog closes when it resolves.
 */
export function ReasonDialog({
  trigger,
  title,
  description,
  label = 'Reason',
  placeholder,
  confirmLabel = 'Submit',
  tone = 'danger',
  onSubmit,
  required = true,
  open: controlledOpen,
  onOpenChange,
}) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = onOpenChange ?? setInternalOpen
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const submit = async () => {
    if (required && !note.trim()) {
      setError('Please add a note')
      return
    }
    setBusy(true)
    try {
      await onSubmit(note.trim())
      setOpen(false)
      setNote('')
    } catch {
      /* caller surfaces the error (toast); keep the dialog open so the note isn't lost */
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !busy && (setOpen(v), setError(null))}
      trigger={trigger}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} loading={busy} onClick={submit}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <Field label={label} error={error} required={required}>
        {(p) => (
          <Textarea
            {...p}
            rows={4}
            value={note}
            placeholder={placeholder}
            maxLength={1000}
            onChange={(e) => (setNote(e.target.value), setError(null))}
            autoFocus
          />
        )}
      </Field>
    </Dialog>
  )
}
