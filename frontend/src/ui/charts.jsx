import { useEffect, useRef, useState } from 'react'
import { cn } from '@/core/lib/cn'

const PAD = { top: 14, right: 12, bottom: 26, left: 56 }
// The comparison period is context, not a second identity: recessive neutral ink, dashed.
const PREVIOUS = '#94a3b8'

function niceStep(max, targetTicks = 4) {
  if (max <= 0) return 1
  const raw = max / targetTicks
  const mag = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / mag
  return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag
}

function useWidth(fallback = 600) {
  const ref = useRef(null)
  const [width, setWidth] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(280, entry.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  })
  return [ref, width]
}

function TableToggle({ showTable, setShowTable }) {
  return (
    <button type="button" onClick={() => setShowTable((v) => !v)} className="text-xs font-medium text-slate-500 hover:text-slate-800">
      {showTable ? 'Show chart' : 'Show table'}
    </button>
  )
}

/**
 * This period against the one before, on one axis: a 2px line in the module's primary colour for now
 * and a dashed neutral line for before. Crosshair + tooltip on hover/focus; a table is one click away.
 *
 * @param {{ data: { label: string, value: number, previous?: number }[], formatValue: (n) => string, formatTick?: (n) => string,
 *   title: string, currentLabel?: string, previousLabel?: string, height?: number, empty?: string }} props
 */
export function TrendChart({ data, formatValue, formatTick = formatValue, title, currentLabel = 'This period', previousLabel = 'Previous period', height = 240, empty = 'Nothing in this period yet' }) {
  const [ref, width] = useWidth()
  const [active, setActive] = useState(null)
  const [showTable, setShowTable] = useState(false)
  const hasPrevious = data.some((d) => d.previous != null)
  const max = Math.max(0, ...data.map((d) => Math.max(d.value, d.previous ?? 0)))
  const isEmpty = max === 0

  const innerW = width - PAD.left - PAD.right
  const innerH = height - PAD.top - PAD.bottom
  const step = niceStep(max)
  const top = Math.max(step, Math.ceil(max / step) * step)
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step)
  const n = data.length
  const x = (i) => PAD.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW)
  const y = (v) => PAD.top + innerH - (v / top) * innerH
  const path = (key) => data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[key] ?? 0).toFixed(1)}`).join('')
  const labelEvery = Math.ceil(n / Math.max(1, Math.floor(innerW / 64)))
  const tip = active !== null ? data[active] : null

  const pick = (clientX) => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect || !n) return
    const rel = clientX - rect.left - PAD.left
    setActive(Math.max(0, Math.min(n - 1, Math.round(n <= 1 ? 0 : (rel / innerW) * (n - 1)))))
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        {/* Legend: always present for two series; identity is the line style too, not colour alone. */}
        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600">
          <span className="flex items-center gap-1.5">
            <svg width="18" height="8" aria-hidden>
              <line x1="0" x2="18" y1="4" y2="4" stroke="var(--tb-primary)" strokeWidth="2" strokeLinecap="round" />
            </svg>
            {currentLabel}
          </span>
          {hasPrevious && (
            <span className="flex items-center gap-1.5">
              <svg width="18" height="8" aria-hidden>
                <line x1="0" x2="18" y1="4" y2="4" stroke={PREVIOUS} strokeWidth="2" strokeDasharray="4 3" strokeLinecap="round" />
              </svg>
              {previousLabel}
            </span>
          )}
        </div>
        <TableToggle showTable={showTable} setShowTable={setShowTable} />
      </div>

      {showTable ? (
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="py-2 font-medium">Period</th>
                <th className="py-2 text-right font-medium">{currentLabel}</th>
                {hasPrevious && <th className="py-2 text-right font-medium">{previousLabel}</th>}
              </tr>
            </thead>
            <tbody className="tabular divide-y divide-slate-100">
              {data.map((d) => (
                <tr key={d.label}>
                  <td className="py-1.5 text-slate-600">{d.label}</td>
                  <td className="py-1.5 text-right text-slate-900">{formatValue(d.value)}</td>
                  {hasPrevious && <td className="py-1.5 text-right text-slate-500">{formatValue(d.previous ?? 0)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : isEmpty ? (
        <div className="grid place-items-center rounded-lg border border-dashed border-slate-200 text-sm text-slate-500" style={{ height }}>
          {empty}
        </div>
      ) : (
        <div
          ref={ref}
          className="relative"
          onMouseMove={(e) => pick(e.clientX)}
          onMouseLeave={() => setActive(null)}
          tabIndex={0}
          role="group"
          aria-label={`${title}. Use the left and right arrow keys to read each point.`}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') setActive((a) => Math.min(n - 1, (a ?? -1) + 1))
            else if (e.key === 'ArrowLeft') setActive((a) => Math.max(0, (a ?? n) - 1))
          }}
          onBlur={() => setActive(null)}
        >
          <svg width={width} height={height} role="img" aria-label={title} className="block overflow-visible">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="#e2e8f0" strokeWidth="1" shapeRendering="crispEdges" />
                <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="tabular fill-slate-500 text-[11px]">
                  {formatTick(t)}
                </text>
              </g>
            ))}
            {data.map(
              (d, i) =>
                i % labelEvery === 0 && (
                  <text key={d.label} x={x(i)} y={height - 8} textAnchor="middle" className="fill-slate-500 text-[11px]">
                    {d.label}
                  </text>
                ),
            )}
            {hasPrevious && <path d={path('previous')} fill="none" stroke={PREVIOUS} strokeWidth="2" strokeDasharray="4 3" strokeLinejoin="round" strokeLinecap="round" />}
            <path d={path('value')} fill="none" stroke="var(--tb-primary)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            {tip && (
              <g>
                <line x1={x(active)} x2={x(active)} y1={PAD.top} y2={PAD.top + innerH} stroke="#94a3b8" strokeWidth="1" shapeRendering="crispEdges" />
                {hasPrevious && <circle cx={x(active)} cy={y(tip.previous ?? 0)} r="4" fill={PREVIOUS} stroke="#fff" strokeWidth="2" />}
                <circle cx={x(active)} cy={y(tip.value)} r="4.5" fill="var(--tb-primary)" stroke="#fff" strokeWidth="2" />
              </g>
            )}
          </svg>
          {tip && (
            <div
              className={cn(
                'pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs whitespace-nowrap shadow-lg',
                x(active) < 110 && 'translate-x-2',
                x(active) > width - 110 && '-translate-x-[calc(100%+8px)]',
              )}
              style={{ left: x(active) }}
            >
              <p className="font-medium text-slate-500">{tip.label}</p>
              <p className="tabular mt-0.5 text-sm font-semibold text-slate-900">{formatValue(tip.value)}</p>
              {hasPrevious && (
                <p className="tabular whitespace-nowrap text-slate-500">Before: {formatValue(tip.previous ?? 0)}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
// MongoDB's $dayOfWeek: 1 = Sunday … 7 = Saturday. Rows run Monday first.
const rowOf = (dow) => (dow + 5) % 7
const hourLabel = (h) => (h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`)

/**
 * When orders come in: weekday × hour (IST). One hue, light → dark for more orders; empty cells stay
 * the surface's own grey. Hover/focus a cell for its count; the busiest slot is spelled out below.
 *
 * @param {{ cells: { dow: number, hour: number, orders: number }[], title: string }} props
 */
export function Heatmap({ cells, title }) {
  const [active, setActive] = useState(null)
  const [showTable, setShowTable] = useState(false)
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0))
  for (const c of cells) grid[rowOf(c.dow)][c.hour] += c.orders
  const max = Math.max(0, ...grid.flat())
  const busiest = max ? grid.flatMap((row, r) => row.map((v, h) => ({ r, h, v }))).sort((a, b) => b.v - a.v)[0] : null
  // Five steps of the primary over white: a sequential ramp in one hue.
  const shade = (v) => (v ? 0.18 + 0.82 * Math.ceil((v / max) * 5) / 5 : 0)

  return (
    <div>
      <div className="mb-2 flex justify-end">
        <TableToggle showTable={showTable} setShowTable={setShowTable} />
      </div>
      {!max ? (
        <div className="grid h-40 place-items-center rounded-lg border border-dashed border-slate-200 text-sm text-slate-500">No orders in this period yet</div>
      ) : showTable ? (
        <div className="max-h-64 overflow-auto">
          <table className="w-full text-xs">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr className="text-slate-500">
                <th className="py-1 text-left font-medium">Day</th>
                <th className="py-1 text-left font-medium">Busiest hours</th>
                <th className="py-1 text-right font-medium">Orders</th>
              </tr>
            </thead>
            <tbody className="tabular divide-y divide-slate-100">
              {grid.map((row, r) => {
                const total = row.reduce((a, b) => a + b, 0)
                const hours = row
                  .map((v, h) => ({ v, h }))
                  .filter((x) => x.v)
                  .sort((a, b) => b.v - a.v)
                  .slice(0, 3)
                  .map((x) => `${hourLabel(x.h)} (${x.v})`)
                  .join(', ')
                return (
                  <tr key={r}>
                    <td className="py-1.5 text-slate-700">{WEEKDAYS[r]}</td>
                    <td className="py-1.5 text-slate-600">{hours || '—'}</td>
                    <td className="py-1.5 text-right text-slate-900">{total}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative overflow-x-auto" onMouseLeave={() => setActive(null)}>
          <div className="grid min-w-[560px] grid-cols-[2.5rem_repeat(24,minmax(0,1fr))] gap-[2px]" role="img" aria-label={title}>
            {grid.map((row, r) => (
              <div key={r} className="contents">
                <span className="pr-1 text-right text-[11px] leading-5 text-slate-500">{WEEKDAYS[r]}</span>
                {row.map((v, h) => (
                  <span
                    key={h}
                    tabIndex={0}
                    aria-label={`${WEEKDAYS[r]} ${hourLabel(h)}: ${v} order${v === 1 ? '' : 's'}`}
                    onMouseEnter={() => setActive({ r, h, v })}
                    onFocus={() => setActive({ r, h, v })}
                    onBlur={() => setActive(null)}
                    className={cn('h-5 rounded-[3px] bg-slate-100 outline-none focus-visible:ring-2 focus-visible:ring-slate-900', active?.r === r && active?.h === h && 'ring-2 ring-slate-900')}
                    style={v ? { background: `color-mix(in oklab, var(--tb-primary) ${Math.round(shade(v) * 100)}%, white)` } : undefined}
                  />
                ))}
              </div>
            ))}
            <span />
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} className="text-center text-[10px] text-slate-400">
                {h % 3 === 0 ? hourLabel(h) : ''}
              </span>
            ))}
          </div>
          <p className="mt-3 min-h-5 text-xs text-slate-600">
            {active ? (
              <>
                <span className="font-semibold text-slate-900">
                  {WEEKDAYS[active.r]} {hourLabel(active.h)}–{hourLabel((active.h + 1) % 24)}
                </span>
                : {active.v} order{active.v === 1 ? '' : 's'}
              </>
            ) : (
              busiest && (
                <>
                  Busiest:{' '}
                  <span className="font-semibold text-slate-900">
                    {WEEKDAYS[busiest.r]} {hourLabel(busiest.h)}–{hourLabel((busiest.h + 1) % 24)}
                  </span>{' '}
                  ({busiest.v} order{busiest.v === 1 ? '' : 's'}). Darker = more orders.
                </>
              )
            )}
          </p>
        </div>
      )}
    </div>
  )
}
