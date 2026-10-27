import { useEffect, useRef, useState } from 'react'

const Recognition = typeof window !== 'undefined' ? (window.SpeechRecognition ?? window.webkitSpeechRecognition) : undefined

const ERRORS = {
  'not-allowed': 'Microphone access is blocked. Allow it in your browser to search by voice.',
  'service-not-allowed': 'Microphone access is blocked. Allow it in your browser to search by voice.',
  'audio-capture': 'No microphone found.',
  network: 'Voice search needs an internet connection.',
}

/**
 * Browser speech-to-text (Web Speech API). `supported` is false on browsers without it
 * (e.g. Firefox), so callers simply hide the mic. Interim text streams through onInterim;
 * the final transcript goes to onResult once the speaker pauses.
 */
export function useVoiceSearch({ onInterim, onResult, onError, lang = 'en-IN' }) {
  const [listening, setListening] = useState(false)
  const recRef = useRef(null)
  const handlers = useRef({ onInterim, onResult, onError })
  useEffect(() => {
    handlers.current = { onInterim, onResult, onError }
  })

  useEffect(() => () => recRef.current?.abort(), [])

  const start = () => {
    if (!Recognition || recRef.current) return
    const rec = new Recognition()
    rec.lang = lang
    rec.interimResults = true
    rec.maxAlternatives = 1
    rec.continuous = false
    rec.onresult = (e) => {
      const text = Array.from(e.results, (r) => r[0].transcript)
        .join('')
        .trim()
      if (e.results[e.results.length - 1].isFinal) handlers.current.onResult?.(text)
      else handlers.current.onInterim?.(text)
    }
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return
      handlers.current.onError?.(ERRORS[e.error] ?? 'Voice search failed. Please try again.')
    }
    rec.onend = () => {
      recRef.current = null
      setListening(false)
    }
    recRef.current = rec
    setListening(true)
    try {
      rec.start()
    } catch {
      recRef.current = null
      setListening(false)
    }
  }

  const stop = () => recRef.current?.stop()

  return { supported: Boolean(Recognition), listening, start, stop, toggle: () => (recRef.current ? stop() : start()) }
}
