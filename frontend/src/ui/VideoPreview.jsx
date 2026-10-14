import { cn } from '@/core/lib/cn'

/** Still frame for a video tile: the YouTube thumbnail, the file's first frame, or a plain play tile. */
export function VideoPreview({ video, className }) {
  if (video.thumbnailUrl) return <img src={video.thumbnailUrl} alt="" className={cn('object-cover', className)} loading="lazy" />
  if (video.source === 'upload') return <video src={`${video.url}#t=0.5`} preload="metadata" muted playsInline className={cn('object-cover', className)} />
  return (
    <div className={cn('grid place-items-center bg-slate-800 text-xs font-semibold text-white', className)}>{video.source === 'vimeo' ? 'Vimeo' : 'Video'}</div>
  )
}
