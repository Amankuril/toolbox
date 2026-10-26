import { Fragment } from 'react'
import { cn } from '@/core/lib/cn'

/** **bold** inside a line. Text only, never HTML, so admin-written content can't inject markup. */
function inline(text) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
      <strong key={i} className="font-semibold text-slate-900">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  )
}

/**
 * Light formatting for admin-written pages: "## " and "### " headings, "- " bullet lists, **bold**,
 * blank lines between paragraphs.
 */
export function RichText({ text, className }) {
  const blocks = []
  let list = null
  let para = []
  const flushPara = () => {
    if (para.length) blocks.push({ type: 'p', text: para.join(' ') })
    para = []
  }
  const flushList = () => {
    if (list) blocks.push({ type: 'ul', items: list })
    list = null
  }
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trim()
    const heading = line.match(/^(#{1,3})\s+(.*)$/)
    if (!line) {
      flushPara()
      flushList()
    } else if (heading) {
      flushPara()
      flushList()
      blocks.push({ type: heading[1].length <= 2 ? 'h2' : 'h3', text: heading[2] })
    } else if (/^[-*•]\s+/.test(line)) {
      flushPara()
      list ??= []
      list.push(line.replace(/^[-*•]\s+/, ''))
    } else {
      flushList()
      para.push(line)
    }
  }
  flushPara()
  flushList()

  return (
    <div className={cn('space-y-4 text-[0.95rem] leading-relaxed text-slate-700', className)}>
      {blocks.map((b, i) =>
        b.type === 'h2' ? (
          <h2 key={i} className="pt-2 font-display text-xl font-bold text-slate-900">
            {inline(b.text)}
          </h2>
        ) : b.type === 'h3' ? (
          <h3 key={i} className="font-display text-base font-bold text-slate-900">
            {inline(b.text)}
          </h3>
        ) : b.type === 'ul' ? (
          <ul key={i} className="list-disc space-y-1.5 pl-5 marker:text-slate-400">
            {b.items.map((item, k) => (
              <li key={k}>{inline(item)}</li>
            ))}
          </ul>
        ) : (
          <p key={i}>{inline(b.text)}</p>
        ),
      )}
    </div>
  )
}
