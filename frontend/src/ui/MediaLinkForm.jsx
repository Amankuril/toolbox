import { Link2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/core/api/http'
import { errorMessage } from '@/core/api/errors'
import { Button } from './Button'
import { Input } from './Field'

/**
 * "Add from link": the server downloads the file (or, for videos, turns a YouTube/Vimeo link into an embed)
 * and answers with the value to append, exactly like an upload would.
 *
 * @param {{ audience: string, uploadPath?: string, folder: string, kind: 'image'|'video', placeholder?: string, disabled?: boolean, onAdded: (value: any) => void }} props
 */
export function MediaLinkForm({ audience, uploadPath = '/media', folder, kind, placeholder, disabled, onAdded }) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)

  const add = async () => {
    const link = url.trim()
    if (!/^https?:\/\/\S+$/i.test(link)) {
      toast.error('Paste a full link starting with http:// or https://')
      return
    }
    setBusy(true)
    try {
      const res = await api[audience].post(`${uploadPath}/from-url`, { url: link, kind, folder }, { timeout: 120_000 })
      onAdded(res.data.data)
      setUrl('')
      setOpen(false)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <Button variant="ghost" size="sm" disabled={disabled} onClick={() => setOpen(true)}>
        <Link2 /> Add from link
      </Button>
    )
  }
  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      <div className="min-w-0 flex-1 basis-60">
        <Input
          autoFocus
          type="url"
          inputMode="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
            if (e.key === 'Escape') setOpen(false)
          }}
          placeholder={placeholder ?? 'https://…'}
          aria-label={kind === 'video' ? 'Video link' : 'Image link'}
        />
      </div>
      <Button size="sm" loading={busy} onClick={add}>
        Add
      </Button>
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </div>
  )
}
