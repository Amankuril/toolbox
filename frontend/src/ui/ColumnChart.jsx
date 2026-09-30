import { useEffect, useRef, useState } from 'react'
import { cn } from '@/core/lib/cn'

const PAD = { top: 12, right: 8, bottom: 26, left: 52 }
const MAX_BAR = 24
const RADIUS = 4

function niceStep(max, targetTicks = 4) {
  if (max <= 0) return 1
  const raw = max / targetTicks
  const mag = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / mag
  return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag
}

/** Column path: 4px rounded data-end, square at the baseline. */
function columnPath(x, y, w, h) {
  const r = Math.min(RADIUS, h, w / 2)
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
}

/**
 * Single-series column chart (e.g. daily sales). One hue — the module's primary colour —
 * so no legend: the card title names the series. Hover/focus shows a tooltip; a table view is one click away.
 *
 * @param {{ data: { label: string, value: number, detail?: string }[], formatValue: (n) => string, formatTick?: (n) => string, height?: number, title: string }} props
 */
export function ColumnChart({ data, formatValue, formatTick = formatValue, height = 220, title }) {
  const wrapRef = useRef(null)
  const [width, setWidth] = useState(600)
  const [active, setActive] = useState(null)
  const [showTable, setShowTable] = useState(false)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(280, entry.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [showTable])

  const innerW = width - PAD.left - PAD.right
  const innerH = height - PAD.top - PAD.bottom
  const max = Math.max(0, ...data.map((d) => d.value))
  const step = niceStep(max)
  const top = Math.max(step, Math.ceil(max / step) * step)
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step)
  const band = innerW / Math.max(1, data.length)
  const barW = Math.min(MAX_BAR, band * 0.62)
  const y = (v) => PAD.top + innerH - (v / top) * innerH
  const labelEvery = Math.ceil(data.length / Math.max(1, Math.floor(innerW / 56)))

  const tip = active !== null ? data[active] : null
  const tipX = active !== null ? PAD.left + band * active + band / 2 : 0

  return (
    <div>
      <div className="mb-2 flex justify-end">
        <button type="button" onClick={() => setShowTable((v) => !v)} className="text-xs font-medium text-slate-500 hover:text-slate-800">
          {showTable ? 'Show chart' : 'Show table'}
        </button>
      </div>

      {showTable ? (
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="py-2 font-medium">Date</th>
                <th className="py-2 text-right font-medium">Value</th>
              </tr>
            </thead>
            <tbody className="tabular divide-y divide-slate-100">
              {data.map((d) => (
                <tr key={d.label}>
                  <td className="py-1.5 text-slate-600">{d.label}</td>
                  <td className="py-1.5 text-right text-slate-900">
                    {formatValue(d.value)}
                    {d.detail && <span className="ml-2 text-slate-500">{d.detail}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={wrapRef} className="relative" onMouseLeave={() => setActive(null)}>
          <svg width={width} height={height} role="img" aria-label={title} className="block overflow-visible">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="#e2e8f0" strokeWidth="1" shapeRendering="crispEdges" />
                <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="tabular fill-slate-500 text-[11px]">
                  {formatTick(t)}
                </text>
              </g>
            ))}

            {data.map((d, i) => {
              const h = (d.value / top) * innerH
              const x = PAD.left + band * i + (band - barW) / 2
              return (
                <g key={d.label}>
                  {h > 0 && (
                    <path d={columnPath(x, y(d.value), barW, h)} fill="var(--tb-primary)" opacity={active === null || active === i ? 1 : 0.45} className="transition-opacity" />
                  )}
                  {i % labelEvery === 0 && (
                    <text x={PAD.left + band * i + band / 2} y={height - 8} textAnchor="middle" className="fill-slate-500 text-[11px]">
                      {d.label}
                    </text>
                  )}
                  {/* Full-height hit target: bigger than the mark, keyboard focusable. */}
                  <rect
                    x={PAD.left + band * i}
                    y={PAD.top}
                    width={band}
                    height={innerH}
                    fill="transparent"
                    tabIndex={0}
                    aria-label={`${d.label}: ${formatValue(d.value)}${d.detail ? `, ${d.detail}` : ''}`}
                    onMouseEnter={() => setActive(i)}
                    onFocus={() => setActive(i)}
                    onBlur={() => setActive(null)}
                    className="outline-none"
                  />
                </g>
              )
            })}
          </svg>

          {tip && (
            <div
              className={cn(
                'pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg',
                tipX < 80 && 'translate-x-0',
                tipX > width - 80 && '-translate-x-full',
              )}
              style={{ left: tipX }}
            >
              <p className="font-medium text-slate-500">{tip.label}</p>
              <p className="tabular mt-0.5 text-sm font-semibold text-slate-900">{formatValue(tip.value)}</p>
              {tip.detail && <p className="text-slate-500">{tip.detail}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
