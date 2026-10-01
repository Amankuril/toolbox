import { AlertTriangle, Compass } from 'lucide-react'
import { isRouteErrorResponse, Link, useRouteError } from 'react-router'
import { Button } from '@/ui/Button'

export function RouteError() {
  const error = useRouteError()
  const notFound = isRouteErrorResponse(error) && error.status === 404
  // A deploy replaced the chunk this tab was pointing at: a reload fetches the new build.
  const staleChunk = error instanceof TypeError && /dynamically imported module|Importing a module script failed/i.test(error.message)

  if (import.meta.env.DEV && !notFound) console.error(error)

  return (
    <div className="grid min-h-dvh place-items-center bg-slate-50 px-6">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-5 grid size-14 place-items-center rounded-full bg-primary-soft text-primary">
          {notFound ? <Compass className="size-7" /> : <AlertTriangle className="size-7" />}
        </div>
        <h1 className="text-2xl font-bold text-slate-900">
          {notFound ? 'Page not found' : staleChunk ? 'A new version is available' : 'Something went wrong'}
        </h1>
        <p className="mt-2 text-slate-600">
          {notFound
            ? "The page you're looking for doesn't exist or has moved."
            : staleChunk
              ? 'Reload to get the latest version.'
              : 'An unexpected error occurred. Please try again.'}
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Button onClick={() => window.location.reload()}>Reload</Button>
          <Button variant="outline" asChild>
            <Link to="/">Go home</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}

export function NotFoundPage() {
  return (
    <div className="grid min-h-[60vh] place-items-center px-6">
      <div className="max-w-md text-center">
        <p className="text-sm font-semibold text-primary">404</p>
        <h1 className="mt-2 text-3xl font-bold text-slate-900">Page not found</h1>
        <p className="mt-2 text-slate-600">The page you&apos;re looking for doesn&apos;t exist or has moved.</p>
        <Button className="mt-6" asChild>
          <Link to="/">Back to home</Link>
        </Button>
      </div>
    </div>
  )
}
