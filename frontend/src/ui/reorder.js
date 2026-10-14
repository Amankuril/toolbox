import { useState } from 'react'

/** Moves one item of a list; shared with the video uploader. */
export function moveItem(list, from, to) {
  const next = list.slice()
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

/**
 * Drag-to-reorder for a grid of tiles. Tiles get `draggable` props; dropping files from the desktop
 * is left alone (it carries no tile index) so the upload drop zone keeps working.
 */
export function useReorder(value, onChange) {
  const [dragging, setDragging] = useState(null)
  const [over, setOver] = useState(null)
  const tileProps = (i) => ({
    draggable: true,
    onDragStart: (e) => {
      setDragging(i)
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/x-tile-index', String(i))
    },
    onDragOver: (e) => {
      if (dragging === null) return
      e.preventDefault()
      setOver(i)
    },
    onDragLeave: () => setOver((o) => (o === i ? null : o)),
    onDrop: (e) => {
      if (dragging === null) return
      e.preventDefault()
      if (dragging !== i) onChange(moveItem(value, dragging, i))
      setDragging(null)
      setOver(null)
    },
    onDragEnd: () => {
      setDragging(null)
      setOver(null)
    },
  })
  return { tileProps, dragging, over }
}
