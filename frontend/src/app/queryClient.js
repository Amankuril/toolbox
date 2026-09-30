import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (count, error) => {
        const status = error?.response?.status
        // Don't retry client errors; they won't fix themselves.
        if (status && status < 500) return false
        return count < 2
      },
    },
    mutations: { retry: false },
  },
})
