import { Camera, ImageUp, ScanSearch } from 'lucide-react'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { one, publicApi } from '@/core/api/http'
import { errorMessage } from '@/core/api/errors'
import { cn } from '@/core/lib/cn'
import { Button } from '@/ui/Button'
import { Dialog } from '@/ui/Dialog'
import { Spinner } from '@/ui/Spinner'

const MAX_MB = 8

/**
 * Camera button for the search box: take or upload a photo of a machine, tool or part (or its rating
 * plate), and land on the search for it. The server identifies the item; we only send the photo.
 */
export function ImageSearchButton({ className }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search by image"
        title="Search by image"
        className={cn('grid w-10 shrink-0 place-items-center text-slate-500 hover:text-slate-900', className)}
      >
        <Camera className="size-[18px]" />
      </button>
      <ImageSearchDialog open={open} onOpenChange={setOpen} />
    </>
  )
}

function ImageSearchDialog({ open, onOpenChange: setOpen }) {
  const navigate = useNavigate()
  const fileRef = useRef(null)
  const cameraRef = useRef(null)
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  // The preview URL is released when replaced and when the dialog closes.
  const showFile = (f) => {
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old)
      return f ? URL.createObjectURL(f) : null
    })
    setFile(f)
  }

  const onOpenChange = (next) => {
    if (!next) {
      showFile(null)
      setNotFound(false)
      setBusy(false)
    }
    setOpen(next)
  }

  // Paste a screenshot straight into the dialog.
  const onPaste = useEffectEvent((e) => {
    const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/'))
    if (f) pick(f)
  })
  useEffect(() => {
    if (!open) return
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [open])

  function pick(f) {
    if (!f) return
    if (!f.type.startsWith('image/')) return toast.error('Choose a photo (JPEG, PNG or WebP)')
    if (f.size > MAX_MB * 1024 * 1024) return toast.error(`Photos must be smaller than ${MAX_MB} MB`)
    setNotFound(false)
    showFile(f)
  }

  async function search() {
    if (!file) return
    setBusy(true)
    setNotFound(false)
    try {
      const form = new FormData()
      form.append('file', file)
      const result = await one(publicApi.post('/public/image-search', form, { timeout: 60_000 }))
      if (!result.recognised || !result.search?.total) {
        setNotFound(true)
        return
      }
      const qs = new URLSearchParams()
      if (result.search.q) qs.set('q', result.search.q)
      if (result.search.category) qs.set('category', result.search.category)
      onOpenChange(false)
      navigate(`/search?${qs}`)
      toast.success(`Showing results for “${result.label}”`, {
        description: result.modelNumber ? `Model ${result.modelNumber} read from your photo` : 'Found from your photo',
      })
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search by image"
      description="Take a photo of a machine, tool or spare part (the rating plate works best) and we’ll find it."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={search} disabled={!file} loading={busy}>
            <ScanSearch /> Find this item
          </Button>
        </>
      }
    >
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => (pick(e.target.files?.[0]), (e.target.value = ''))} />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => (pick(e.target.files?.[0]), (e.target.value = ''))}
      />
      <div
        onDragOver={(e) => (e.preventDefault(), setDragOver(true))}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          pick(e.dataTransfer.files?.[0])
        }}
        className={cn(
          'relative grid min-h-56 place-items-center overflow-hidden rounded-md border-2 border-dashed border-slate-300 bg-slate-50 p-4 text-center',
          dragOver && 'border-primary bg-primary/5',
        )}
      >
        {preview ? (
          <>
            <img src={preview} alt="Your photo" className="max-h-64 w-auto rounded object-contain" />
            {busy && (
              <div className="absolute inset-0 grid place-items-center bg-white/70">
                <span className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <Spinner /> Looking at your photo…
                </span>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 text-slate-600">
            <ImageUp className="size-9 text-slate-400" strokeWidth={1.5} />
            <p className="text-sm">Drag a photo here, paste a screenshot, or</p>
          </div>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => cameraRef.current?.click()} className="sm:hidden">
          <Camera /> Take a photo
        </Button>
        <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
          <ImageUp /> {file ? 'Choose another photo' : 'Upload a photo'}
        </Button>
      </div>
      {notFound && (
        <p role="status" className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          We couldn’t find a match for this photo. Try a clearer, closer shot, or a photo of the rating plate, or type the name in the search box.
        </p>
      )}
    </Dialog>
  )
}
