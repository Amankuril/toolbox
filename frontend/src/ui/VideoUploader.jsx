import { ArrowLeft, ArrowRight, Play, Video, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/core/api/http'
import { errorMessage } from '@/core/api/errors'
import { cn } from '@/core/lib/cn'
import { videoKey } from '@/core/lib/media'
import { IconAction } from './ImageUploader'
import { MediaLinkForm } from './MediaLinkForm'
import { moveItem, useReorder } from './reorder'
import { Spinner } from './Spinner'
import { VideoPreview } from './VideoPreview'

const ACCEPT = 'video/mp4,video/webm,video/quicktime'
const MAX_MB = 50
const SOURCE_LABEL = { upload: 'File', youtube: 'YouTube', vimeo: 'Vimeo' }

/**
 * Product videos: upload a file (MP4/WebM/MOV, stored as is) or add a link (YouTube/Vimeo become embeds,
 * a direct link to a video file is downloaded). Reorder by dragging or with the arrows; remove any time.
 *
 * @param {{ audience: 'admin'|'vendor', uploadPath?: string, folder?: string, value: any[], onChange: (v: any[]) => void, max?: number }} props
 */
export function VideoUploader({ audience, uploadPath = '/media', folder = 'products', value = [], onChange, max = 5 }) {
  const inputRef = useRef(null)
  const [progress, setProgress] = useState(null)
  const remaining = max - value.length
  const { tileProps, dragging, over } = useReorder(value, onChange)
  const uploading = progress !== null

  const upload = async (file) => {
    if (!file) return
    if (file.size > MAX_MB * 1024 * 1024) {
      toast.error(`${file.name} is larger than ${MAX_MB} MB. Upload it to YouTube and paste the link instead.`)
      return
    }
    const form = new FormData()
    form.append('file', file)
    setProgress(0)
    try {
      const res = await api[audience].post(`${uploadPath}/videos?folder=${folder}`, form, {
        onUploadProgress: (e) => e.total && setProgress(Math.round((e.loaded / e.total) * 100)),
        timeout: 600_000,
      })
      onChange([...value, res.data.data])
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setProgress(null)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const add = (video) => {
    if (value.some((v) => videoKey(v) === videoKey(video))) {
      toast.info('That video is already added')
      return
    }
    onChange([...value, video].slice(0, max))
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {value.map((v, i) => (
          <div
            key={videoKey(v)}
            {...(value.length > 1 ? tileProps(i) : {})}
            className={cn(
              'group relative aspect-video overflow-hidden rounded-lg border border-slate-200 bg-slate-900',
              value.length > 1 && 'cursor-grab active:cursor-grabbing',
              dragging === i && 'opacity-40',
              over === i && dragging !== i && 'ring-2 ring-primary',
            )}
          >
            <VideoPreview video={v} className="pointer-events-none size-full" />
            <span className="pointer-events-none absolute inset-0 grid place-items-center">
              <span className="grid size-9 place-items-center rounded-full bg-slate-900/70 text-white">
                <Play className="size-4 fill-current" />
              </span>
            </span>
            <span className="absolute top-1.5 left-1.5 rounded bg-slate-900/80 px-1.5 py-0.5 text-[10px] font-semibold text-white">
              {SOURCE_LABEL[v.source] ?? 'Video'}
            </span>
            <IconAction label="Remove video" onClick={() => onChange(value.filter((_, j) => j !== i))} danger className="absolute top-1.5 right-1.5">
              <X />
            </IconAction>
            {value.length > 1 && (
              <div className="absolute inset-x-0 bottom-0 flex gap-1 bg-gradient-to-t from-slate-900/70 p-1.5 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
                {i > 0 && (
                  <IconAction label="Move left" onClick={() => onChange(moveItem(value, i, i - 1))}>
                    <ArrowLeft />
                  </IconAction>
                )}
                {i < value.length - 1 && (
                  <IconAction label="Move right" onClick={() => onChange(moveItem(value, i, i + 1))}>
                    <ArrowRight />
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
              upload(e.dataTransfer.files[0])
            }}
            className="flex aspect-video flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 bg-white p-3 text-center text-slate-500 transition-colors hover:border-primary hover:text-primary"
          >
            {uploading ? (
              <>
                <Spinner className="size-5" />
                <span className="tabular text-xs font-medium">{progress}%</span>
              </>
            ) : (
              <>
                <Video className="size-6" />
                <span className="text-xs font-medium">Upload video</span>
              </>
            )}
          </button>
        )}
      </div>
      <input ref={inputRef} type="file" accept={ACCEPT} hidden onChange={(e) => upload(e.target.files[0])} />
      {remaining > 0 && (
        <div className="mt-2">
          <MediaLinkForm
            audience={audience}
            uploadPath={uploadPath}
            folder={folder}
            kind="video"
            disabled={uploading}
            placeholder="Paste a YouTube or Vimeo link, or a link to an MP4 file"
            onAdded={add}
          />
        </div>
      )}
      <p className="mt-2 text-xs text-slate-500">
        MP4, WebM or MOV up to {MAX_MB} MB, or a YouTube / Vimeo link. Up to {max} videos, shown after the photos.
      </p>
    </div>
  )
}
