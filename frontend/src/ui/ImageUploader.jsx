import { ArrowLeft, ArrowRight, ImagePlus, Star, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/core/api/http'
import { errorMessage } from '@/core/api/errors'
import { cn } from '@/core/lib/cn'
import { Spinner } from './Spinner'

const ACCEPT = 'image/jpeg,image/png,image/webp,image/avif,image/gif,image/heic,image/heif'
const MAX_MB = 8

/**
 * Uploads through the centralised media API (compressed → WebP → Cloudinary or local, per admin toggle).
 * Value is an array of `{ media, url, alt? }`. The first image is the cover.
 *
 * @param {{ audience: 'admin'|'vendor'|'user', folder: string, value: any[], onChange: (v: any[]) => void, max?: number, aspect?: string }} props
 */
export function ImageUploader({ audience, folder, value = [], onChange, max = 10, aspect = 'aspect-square', label = 'Upload images', compact = false }) {
  const inputRef = useRef(null)
  const [progress, setProgress] = useState(null)
  const remaining = max - value.length

  const upload = async (fileList) => {
    const files = [...fileList].slice(0, remaining)
    const tooBig = files.find((f) => f.size > MAX_MB * 1024 * 1024)
    if (tooBig) {
      toast.error(`${tooBig.name} is larger than ${MAX_MB} MB`)
      return
    }
    if (!files.length) return

    const form = new FormData()
    files.forEach((f) => form.append('files', f))
    setProgress(0)
    try {
      const res = await api[audience].post(`/media?folder=${folder}`, form, {
        onUploadProgress: (e) => e.total && setProgress(Math.round((e.loaded / e.total) * 100)),
        timeout: 120_000,
      })
      onChange([...value, ...res.data.data.map((m) => ({ media: m._id, url: m.url }))])
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setProgress(null)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const move = (from, to) => {
    const next = value.slice()
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    onChange(next)
  }

  const uploading = progress !== null

  return (
    <div>
      <div className={cn('grid gap-3', compact ? 'grid-cols-3 sm:grid-cols-4' : 'grid-cols-2 sm:grid-cols-4 lg:grid-cols-5')}>
        {value.map((img, i) => (
          <div key={img.media} className={cn('group relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50', aspect)}>
            <img src={img.url} alt={img.alt ?? ''} className="size-full object-contain" loading="lazy" />
            {i === 0 && max > 1 && (
              <span className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 rounded bg-slate-900/80 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                <Star className="size-3" /> Cover
              </span>
            )}
            <div className="absolute inset-x-0 bottom-0 flex justify-between gap-1 bg-gradient-to-t from-slate-900/70 p-1.5 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
              <div className="flex gap-1">
                {i > 0 && (
                  <IconAction label="Move left" onClick={() => move(i, i - 1)}>
                    <ArrowLeft />
                  </IconAction>
                )}
                {i < value.length - 1 && (
                  <IconAction label="Move right" onClick={() => move(i, i + 1)}>
                    <ArrowRight />
                  </IconAction>
                )}
              </div>
              <IconAction label="Remove image" onClick={() => onChange(value.filter((_, j) => j !== i))} danger>
                <Trash2 />
              </IconAction>
            </div>
          </div>
        ))}

        {remaining > 0 && (
          <button
            type="button"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              upload(e.dataTransfer.files)
            }}
            className={cn(
              'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 bg-white p-3 text-center text-slate-500 transition-colors hover:border-primary hover:text-primary',
              aspect,
            )}
          >
            {uploading ? (
              <>
                <Spinner className="size-5" />
                <span className="tabular text-xs font-medium">{progress}%</span>
              </>
            ) : (
              <>
                <ImagePlus className="size-6" />
                <span className="text-xs font-medium">{label}</span>
              </>
            )}
          </button>
        )}
      </div>
      <input ref={inputRef} type="file" accept={ACCEPT} multiple={max > 1} hidden onChange={(e) => upload(e.target.files)} />
      {!compact && (
        <p className="mt-2 text-xs text-slate-500">
          JPG, PNG, WebP or HEIC up to {MAX_MB} MB. Images are optimised automatically. {max > 1 && `Up to ${max} images; the first is the cover.`}
        </p>
      )}
    </div>
  )
}

function IconAction({ label, onClick, danger, children }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        'grid size-7 place-items-center rounded bg-white/90 text-slate-700 shadow [&_svg]:size-3.5',
        danger ? 'hover:text-red-600' : 'hover:text-slate-900',
      )}
    >
      {children}
    </button>
  )
}
