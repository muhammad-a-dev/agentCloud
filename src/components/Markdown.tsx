import { Check, Copy } from 'lucide-react'
import { memo, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import { api } from '@/lib/ipc'
import { useApp } from '@/stores/app'

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (node && typeof node === 'object' && 'props' in node) return textOf((node as { props: { children?: ReactNode } }).props.children)
  return ''
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false)
  const child = Array.isArray(children) ? children[0] : children
  const className = (child as { props?: { className?: string } })?.props?.className ?? ''
  const lang = /language-(\w+)/.exec(className)?.[1]
  const code = textOf(children)
  return (
    <div className="my-2 rounded-xl border border-line bg-[#0d0d0d] overflow-hidden">
      <div className="flex items-center justify-between px-3 h-8 border-b border-line text-xs text-muted">
        <span>{lang ?? 'code'}</span>
        <button
          className="flex items-center gap-1 hover:text-fg"
          onClick={() => {
            void navigator.clipboard.writeText(code.replace(/\n$/, ''))
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="px-3.5 py-3 overflow-x-auto text-[13px] leading-[1.55] font-mono">{children}</pre>
    </div>
  )
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const openTask = useApp((s) => s.openTask)
  return (
    <div className="markdown selectable">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]}
        urlTransform={(url) => url}
        components={{
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(e) => {
                e.preventDefault()
                if (!href) return
                if (href.startsWith('task://')) openTask(href.slice('task://'.length).replace(/\/$/, ''))
                else if (href.startsWith('file://')) void api.openPath(href.slice('file://'.length))
                else if (/^(https?|mailto):/.test(href)) void api.openExternal(href)
              }}
              title={href?.startsWith('file://') ? 'Open file' : href?.startsWith('task://') ? 'Open task' : href}
            >
              {children}
            </a>
          ),
          img: ({ src, alt }) => (typeof src === 'string' && /^https?:/.test(src) ? <img src={src} alt={alt ?? ''} className="max-w-full rounded-lg my-2" /> : null)
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})
