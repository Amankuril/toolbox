import { useQuery } from '@tanstack/react-query'
import { Clock, LocateFixed, MapPin, Store, Truck } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { one, publicApi } from '@/core/api/http'
import { cn } from '@/core/lib/cn'
import { Button } from '@/ui/Button'
import { SegmentedControl } from '@/ui/Controls'

/** Pickup points of the cart's sellers, nearest to the delivery pincode (or the buyer's location) first. */
export function usePickupPoints(vendorIds, near) {
  return useQuery({
    queryKey: ['public', 'pickup-points', vendorIds, near],
    queryFn: () => one(publicApi.get('/public/pickup-points', { params: { vendors: vendorIds.join(','), ...near } })),
    enabled: vendorIds.length > 0,
    staleTime: 5 * 60_000,
  })
}

/**
 * Per seller: delivery, or collect from one of their pickup points. `value` is { [vendorId]: pointId };
 * a seller missing from it is delivered.
 */
export function PickupChooser({ groups, points, value, onChange, onLocate, locating }) {
  const sellers = groups.filter((g) => points?.[g.key]?.length)
  if (!sellers.length) return null
  const set = (vendor, point) => {
    const next = { ...value }
    if (point) next[vendor] = point
    else delete next[vendor]
    onChange(next)
  }
  return (
    <div className="flex flex-col gap-4">
      {sellers.map((g) => {
        const list = points[g.key]
        const chosen = value[g.key]
        return (
          <div key={g.key} className="rounded-lg border border-slate-200 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-semibold text-slate-900">{g.seller?.name ?? 'Seller'}</p>
              <SegmentedControl
                size="sm"
                value={chosen ? 'pickup' : 'delivery'}
                onChange={(mode) => set(g.key, mode === 'pickup' ? list[0]._id : null)}
                options={[
                  { value: 'delivery', label: 'Deliver to me' },
                  { value: 'pickup', label: 'Self pickup' },
                ]}
              />
            </div>
            {chosen ? (
              <>
                <div role="radiogroup" aria-label={`Pickup location for ${g.seller?.name ?? 'seller'}`} className="mt-3 flex flex-col gap-2">
                  {list.map((p) => (
                    <PointTile key={p._id} point={p} selected={chosen === p._id} onSelect={() => set(g.key, p._id)} />
                  ))}
                </div>
                <Button variant="ghost" size="sm" className="mt-2" loading={locating} onClick={onLocate}>
                  <LocateFixed /> Sort by my location
                </Button>
              </>
            ) : (
              <p className="mt-2 flex items-center gap-1.5 text-sm text-slate-600">
                <Truck className="size-4 text-slate-400" /> Delivered to your address. Prefer to collect? {list.length} pickup location{list.length === 1 ? '' : 's'} available.
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}

function PointTile({ point: p, selected, onSelect }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'flex items-start gap-3 rounded-md border p-3 text-left transition-colors',
        selected ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-slate-200 hover:border-slate-400',
      )}
    >
      <Store className={cn('mt-0.5 size-4 shrink-0', selected ? 'text-primary' : 'text-slate-400')} />
      <span className="min-w-0 flex-1 text-sm">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-slate-900">{p.name}</span>
          {p.distanceKm != null ? (
            <span className="rounded-sm bg-emerald-50 px-1.5 text-xs font-semibold text-emerald-700">{p.distanceKm} km</span>
          ) : (
            p.nearby && <span className="rounded-sm bg-emerald-50 px-1.5 text-xs font-semibold text-emerald-700">Near you</span>
          )}
        </span>
        <span className="mt-0.5 block text-slate-600">
          {[p.line1, p.line2, p.landmark, p.city].filter(Boolean).join(', ')} – <span className="code">{p.pincode}</span>
        </span>
        <span className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-500">
          {p.hours && (
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3" /> {p.hours}
            </span>
          )}
          {p.mapUrl && (
            <a href={p.mapUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
              <MapPin className="size-3" /> Map
            </a>
          )}
        </span>
      </span>
    </button>
  )
}

/** The browser's location for "Sort by my location". */
export function useBuyerLocation() {
  const [coords, setCoords] = useState(null)
  const [locating, setLocating] = useState(false)
  const locate = () => {
    if (!navigator.geolocation) return toast.error('Your browser cannot share your location')
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: Number(pos.coords.latitude.toFixed(4)), lng: Number(pos.coords.longitude.toFixed(4)) })
        setLocating(false)
      },
      () => {
        setLocating(false)
        toast.error('Could not get your location. Locations are sorted by your pincode instead.')
      },
      { timeout: 10_000, maximumAge: 10 * 60_000 },
    )
  }
  return { coords, locate, locating }
}
