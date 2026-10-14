import { ArrowLeft, ArrowRight, ImagePlus, Star, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/core/api/http'
import { errorMessage } from '@/core/api/errors'
import { cn } from '@/core/lib/cn'
import { MediaLinkForm } from './MediaLinkForm'
import { moveItem, useReorder } from './reorder'
import { Spinner } from './Spinner'

const ACCEPT = 'image/jpeg,image/png,image/webp,image/avif,image/gif,image/heic,image/heif'
const MAX_MB = 8

/**
 * Uploads through the centralised media API (compressed → WebP → Cloudinary or local, per admin toggle).
 * Value is an array of `{ media, url, alt? }`. The first image is the cover. Images can be added from
 * files or links, removed, and reordered with drag and drop or the arrow buttons.
 *
 * `gridClassName` replaces the default column layout, e.g. `grid-cols-1` for a single wide slot.
 *
 * @param {{ audience: 'admin'|'vendor'|'user', folder: string, value: any[], onChange: (v: any[]) => void, max?: number, aspect?: string, gridClassName?: string, cover?: boolean, uploadPath?: string, allowLinks?: boolean }} props
 */
export function ImageUploader({
  audience,
  folder,
  value = [],
  onChange,
  max = 10,
  aspect = 'aspect-square',
  label = 'Upload images',
  compact = false,
  gridClassName,
  cover = true,
  uploadPath = '/media',
  allowLinks = true,
}) {
  const inputRef = useRef(null)
  const [progress, setProgress] = useState(null)
  const remaining = max - value.length
  const { tileProps, dragging, over } = useReorder(value, onChange)

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
      const res = await api[audience].post(`${uploadPath}?folder=${folder}`, form, {
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

  const move = (from, to) => onChange(moveItem(value, from, to))
  const uploading = progress !== null
  const reorderable = max > 1 && value.length > 1

  return (
    <div>
      <div className={cn('grid gap-3', gridClassName ?? (compact ? 'grid-cols-3 sm:grid-cols-4' : 'grid-cols-2 sm:grid-cols-4 lg:grid-cols-5'))}>
        {value.map((img, i) => (
          <div
            key={img.media}
            {...(reorderable ? tileProps(i) : {})}
            className={cn(
              'group relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50',
              reorderable && 'cursor-grab active:cursor-grabbing',
              dragging === i && 'opacity-40',
              over === i && dragging !== i && 'ring-2 ring-primary',
              aspect,
            )}
          >
            <img src={img.url} alt={img.alt ?? ''} className="pointer-events-none size-full object-contain" loading="lazy" />
            {cover && i === 0 && max > 1 && (
              <span className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 rounded bg-slate-900/80 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                <Star className="size-3" /> Cover
              </span>
            )}
            {/* Always visible, so a wrong upload can be removed straight away on any device. */}
            <IconAction label="Remove image" onClick={() => onChange(value.filter((_, j) => j !== i))} danger className="absolute top-1.5 right-1.5">
              <X />
            </IconAction>
            {reorderable && (
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
                {cover && i > 0 && (
                  <IconAction label="Make cover" onClick={() => move(i, 0)}>
                    <Star />
                  </IconAction>
                )}
              </div>
            )}
          </div>
        ))}

        {remaining > 0 && (
          <button
            type="button"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => dragging === null && e.preventDefault()}
            onDrop={(e) => {
              if (dragging !== null) return
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
      {allowLinks && remaining > 0 && (
        <div className="mt-2">
          <MediaLinkForm
            audience={audience}
            uploadPath={uploadPath}
            folder={folder}
            kind="image"
            disabled={uploading}
            placeholder="Paste an image link, e.g. https://example.com/photo.jpg"
            onAdded={(img) => onChange(max === 1 ? [img] : [...value, img].slice(0, max))}
          />
        </div>
      )}
      {!compact && (
        <p className="mt-2 text-xs text-slate-500">
          JPG, PNG, WebP or HEIC up to {MAX_MB} MB, from your device or a link. Images are optimised automatically.{' '}
          {max > 1 && `Up to ${max} images${cover ? '; the first is the cover. Drag to reorder' : ''}.`}
        </p>
      )}
    </div>
  )
}

export function IconAction({ label, onClick, danger, className, children }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'grid size-7 place-items-center rounded bg-white/90 text-slate-700 shadow [&_svg]:size-3.5',
        danger ? 'hover:text-red-600' : 'hover:text-slate-900',
        className,
      )}
    >
      {children}
    </button>
  )
}
