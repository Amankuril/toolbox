import { ArrowLeft, ArrowRight, ImagePlus, Play, Star, Video, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
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

const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/avif,image/gif,image/heic,image/heif'
const VIDEO_ACCEPT = 'video/mp4,video/webm,video/quicktime'
const IMAGE_MB = 8
const VIDEO_MB = 50
const SOURCE_LABEL = { upload: 'Video', youtube: 'YouTube', vimeo: 'Vimeo' }

const keyOf = (m) => (m.kind === 'image' ? `i:${m.item.media}` : `v:${videoKey(m.item)}`)

/**
 * Product photos and videos in one sequence, the order buyers see them in. Add from files or links,
 * remove, and reorder by dragging or with the arrows; videos can sit anywhere between photos.
 * The first photo is the cover on listings.
 *
 * Value is mergeMedia()'s shape: `[{ kind: 'image', item: { media, url } } | { kind: 'video', item: video }]`.
 *
 * @param {{ audience: 'admin'|'vendor', uploadPath?: string, folder?: string, value: any[], onChange: (v: any[]) => void, maxImages?: number, maxVideos?: number }} props
 */
export function MediaUploader({ audience, uploadPath = '/media', folder = 'products', value = [], onChange, maxImages = 10, maxVideos = 5 }) {
  const imageInput = useRef(null)
  const videoInput = useRef(null)
  const [progress, setProgress] = useState(null)
  const { tileProps, dragging, over } = useReorder(value, onChange)
  const imageCount = value.filter((m) => m.kind === 'image').length
  const videoCount = value.length - imageCount
  const imagesLeft = maxImages - imageCount
  const videosLeft = maxVideos - videoCount
  const coverIndex = value.findIndex((m) => m.kind === 'image')
  const uploading = progress !== null
  // Uploads finish after the user may have reordered; append to whatever the list is by then.
  const latest = useRef(value)
  useEffect(() => {
    latest.current = value
  }, [value])

  const send = async (path, form, timeout) => {
    setProgress(0)
    try {
      const res = await api[audience].post(`${uploadPath}${path}?folder=${folder}`, form, {
        onUploadProgress: (e) => e.total && setProgress(Math.round((e.loaded / e.total) * 100)),
        timeout,
      })
      return res.data.data
    } catch (err) {
      toast.error(errorMessage(err))
      return null
    } finally {
      setProgress(null)
    }
  }

  const uploadImages = async (files) => {
    const list = files.slice(0, imagesLeft)
    if (files.length > imagesLeft) toast.info(`Up to ${maxImages} photos; ${files.length - list.length} not added`)
    const tooBig = list.find((f) => f.size > IMAGE_MB * 1024 * 1024)
    if (tooBig) return toast.error(`${tooBig.name} is larger than ${IMAGE_MB} MB`)
    if (!list.length) return
    const form = new FormData()
    list.forEach((f) => form.append('files', f))
    const added = await send('', form, 120_000)
    if (added) onChange([...latest.current, ...added.map((m) => ({ kind: 'image', item: { media: m._id, url: m.url } }))])
  }

  const uploadVideo = async (file) => {
    if (!file) return
    if (videosLeft <= 0) return toast.info(`Up to ${maxVideos} videos`)
    if (file.size > VIDEO_MB * 1024 * 1024) {
      return toast.error(`${file.name} is larger than ${VIDEO_MB} MB. Upload it to YouTube and paste the link instead.`)
    }
    const form = new FormData()
    form.append('file', file)
    const added = await send('/videos', form, 600_000)
    if (added) onChange([...latest.current, { kind: 'video', item: added }])
  }

  const addFiles = async (fileList) => {
    const files = [...fileList]
    const images = files.filter((f) => f.type.startsWith('image/'))
    const videos = files.filter((f) => f.type.startsWith('video/'))
    if (images.length) await uploadImages(images)
    for (const v of videos.slice(0, 1)) await uploadVideo(v)
    if (videos.length > 1) toast.info('Add videos one at a time')
  }

  const addLink = (item, kind) => {
    const entry = { kind, item }
    if (kind === 'image' ? imagesLeft <= 0 : videosLeft <= 0) return toast.info(kind === 'image' ? `Up to ${maxImages} photos` : `Up to ${maxVideos} videos`)
    if (latest.current.some((m) => keyOf(m) === keyOf(entry))) return toast.info('That video is already added')
    onChange([...latest.current, entry])
  }

  const move = (from, to) => onChange(moveItem(value, from, to))
  const reorderable = value.length > 1

  return (
    <div>
      <div
        className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5"
        onDragOver={(e) => dragging === null && e.dataTransfer.types.includes('Files') && e.preventDefault()}
        onDrop={(e) => {
          if (dragging !== null || !e.dataTransfer.files.length) return
          e.preventDefault()
          addFiles(e.dataTransfer.files)
        }}
      >
        {value.map((m, i) => (
          <div
            key={keyOf(m)}
            {...(reorderable ? tileProps(i) : {})}
            data-media-tile={m.kind}
            className={cn(
              'group relative aspect-square overflow-hidden rounded-lg border border-slate-200',
              m.kind === 'video' ? 'bg-slate-900' : 'bg-slate-50',
              reorderable && 'cursor-grab active:cursor-grabbing',
              dragging === i && 'opacity-40',
              over === i && dragging !== i && 'ring-2 ring-primary',
            )}
          >
            {m.kind === 'image' ? (
              <img src={m.item.url} alt={m.item.alt ?? ''} className="pointer-events-none size-full object-contain" loading="lazy" />
            ) : (
              <>
                <VideoPreview video={m.item} className="pointer-events-none size-full" />
                <span className="pointer-events-none absolute inset-0 grid place-items-center">
                  <span className="grid size-9 place-items-center rounded-full bg-slate-900/70 text-white">
                    <Play className="size-4 fill-current" />
                  </span>
                </span>
              </>
            )}
            <span className="pointer-events-none absolute top-1.5 left-1.5 flex items-center gap-1">
              <span className="tabular grid h-5 min-w-5 place-items-center rounded bg-white/90 px-1 text-[10px] font-bold text-slate-800 shadow">{i + 1}</span>
              {i === coverIndex ? (
                <span className="inline-flex items-center gap-1 rounded bg-slate-900/80 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  <Star className="size-3" /> Cover
                </span>
              ) : (
                m.kind === 'video' && (
                  <span className="rounded bg-slate-900/80 px-1.5 py-0.5 text-[10px] font-semibold text-white">{SOURCE_LABEL[m.item.source] ?? 'Video'}</span>
                )
              )}
            </span>
            <IconAction
              label={m.kind === 'image' ? 'Remove photo' : 'Remove video'}
              onClick={() => onChange(value.filter((_, j) => j !== i))}
              danger
              className="absolute top-1.5 right-1.5"
            >
              <X />
            </IconAction>
            {reorderable && (
              <div className="absolute inset-x-0 bottom-0 flex justify-between gap-1 bg-gradient-to-t from-slate-900/70 p-1.5 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
                <div className="flex gap-1">
                  {i > 0 && (
                    <IconAction label="Move earlier" onClick={() => move(i, i - 1)}>
                      <ArrowLeft />
                    </IconAction>
                  )}
                  {i < value.length - 1 && (
                    <IconAction label="Move later" onClick={() => move(i, i + 1)}>
                      <ArrowRight />
                    </IconAction>
                  )}
                </div>
                {m.kind === 'image' && i !== coverIndex && (
                  <IconAction label="Make cover (move to first)" onClick={() => move(i, 0)}>
                    <Star />
                  </IconAction>
                )}
              </div>
            )}
          </div>
        ))}

        {uploading ? (
          <div className="flex aspect-square flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-primary/50 bg-white text-primary">
            <Spinner className="size-5" />
            <span className="tabular text-xs font-medium">{progress}%</span>
          </div>
        ) : (
          <>
            {imagesLeft > 0 && (
              <AddTile icon={ImagePlus} label="Add photos" onClick={() => imageInput.current?.click()} />
            )}
            {videosLeft > 0 && <AddTile icon={Video} label="Add video" onClick={() => videoInput.current?.click()} />}
          </>
        )}
      </div>
      <input
        ref={imageInput}
        type="file"
        accept={IMAGE_ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          uploadImages([...e.target.files])
          e.target.value = ''
        }}
      />
      <input
        ref={videoInput}
        type="file"
        accept={VIDEO_ACCEPT}
        hidden
        onChange={(e) => {
          uploadVideo(e.target.files[0])
          e.target.value = ''
        }}
      />
      {(imagesLeft > 0 || videosLeft > 0) && (
        <div className="mt-2">
          <MediaLinkForm
            audience={audience}
            uploadPath={uploadPath}
            folder={folder}
            kind="auto"
            disabled={uploading}
            placeholder="Paste a photo link, or a YouTube / Vimeo / MP4 link"
            onAdded={addLink}
          />
        </div>
      )}
      <p className="mt-2 text-xs text-slate-500">
        Up to {maxImages} photos (JPG, PNG, WebP or HEIC, {IMAGE_MB} MB each) and {maxVideos} videos (MP4, WebM or MOV up to {VIDEO_MB} MB, or a YouTube /
        Vimeo link). Buyers see them in this order; drag a tile or use the arrows to move it. The first photo is the cover.
      </p>
    </div>
  )
}

function AddTile({ icon: Icon, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex aspect-square flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 bg-white p-3 text-center text-slate-500 transition-colors hover:border-primary hover:text-primary"
    >
      <Icon className="size-6" />
      <span className="text-xs font-medium">{label}</span>
    </button>
  )
}
