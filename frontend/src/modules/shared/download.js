import { toast } from 'sonner'
import { errorMessage } from '@/core/api/errors'

/**
 * Fetches a PDF as a blob and saves it. A failed blob request carries its JSON error as a Blob,
 * so it's decoded first to show the server's message.
 */
export async function downloadPdf(request, filename) {
  try {
    const res = await request()
    const url = URL.createObjectURL(res.data)
    const a = document.createElement('a')
    a.href = url
    a.download = /filename="([^"]+)"/.exec(res.headers?.['content-disposition'] ?? '')?.[1] ?? filename
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  } catch (err) {
    if (err?.response?.data instanceof Blob) {
      try {
        err.response.data = JSON.parse(await err.response.data.text())
      } catch {
        /* not JSON: fall back to the generic message */
      }
    }
    toast.error(errorMessage(err))
  }
}
