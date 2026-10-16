import { AnimatePresence, motion } from 'framer-motion'
import { ArrowUp, AudioLines, Mic, Paperclip, Plus, Square, X } from 'lucide-react'
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { cx } from '@/lib/format'
import { api } from '@/lib/ipc'
import { useApp } from '@/stores/app'
import { Tooltip } from './ui'

interface SpeechRec {
  continuous: boolean
  interimResults: boolean
  lang: string
  start(): void
  stop(): void
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
}

function speechCtor(): (new () => SpeechRec) | null {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export interface ComposerHandle {
  addAttachments(paths: string[]): Promise<void>
  focus(): void
}

export const Composer = forwardRef<ComposerHandle, { placeholder: string; busy: boolean; onSend: (text: string, attachments: string[]) => void; onStop: () => void }>(
  function Composer({ placeholder, busy, onSend, onStop }, ref) {
    const [text, setText] = useState('')
    const [attachments, setAttachments] = useState<string[]>([])
    const [listening, setListening] = useState(false)
    const [voiceOk, setVoiceOk] = useState(() => !!speechCtor())
    const [multi, setMulti] = useState(false)
    const ta = useRef<HTMLTextAreaElement>(null)
    const rec = useRef<SpeechRec | null>(null)
    const baseText = useRef('')
    const toast = useApp((s) => s.toast)

    const addAttachments = async (paths: string[]) => {
      if (!paths.length) return
      const r = await api.importAttachments(paths)
      if (!r.ok) return toast('error', r.error)
      setAttachments((a) => [...a, ...r.data.filter((p) => !a.includes(p))])
      toast('success', `Added ${r.data.length} file${r.data.length === 1 ? '' : 's'} to your workspace.`)
    }

    useImperativeHandle(ref, () => ({ addAttachments, focus: () => ta.current?.focus() }))

    useLayoutEffect(() => {
      const el = ta.current
      if (!el) return
      el.style.height = '0px'
      const lh = 24
      const max = lh * 8
      const h = Math.min(el.scrollHeight, max)
      el.style.height = `${Math.max(lh, h)}px`
      el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden'
      setMulti(h > lh + 4 || attachments.length > 0)
    }, [text, attachments.length])

    useEffect(() => () => rec.current?.stop(), [])

    const submit = () => {
      const t = text.trim()
      if (!t && !attachments.length) return
      onSend(t || 'Please take a look at the attached file(s).', attachments)
      setText('')
      setAttachments([])
      rec.current?.stop()
    }

    const toggleVoice = () => {
      if (listening) {
        rec.current?.stop()
        return
      }
      const C = speechCtor()
      if (!C) return setVoiceOk(false)
      const r = new C()
      r.continuous = true
      r.interimResults = true
      r.lang = navigator.language || 'en-US'
      baseText.current = text ? text.trimEnd() + ' ' : ''
      r.onresult = (e) => {
        let s = ''
        for (let i = 0; i < e.results.length; i++) s += e.results[i][0].transcript
        setText(baseText.current + s)
      }
      r.onerror = (e) => {
        if (e.error === 'network' || e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') {
          setVoiceOk(false)
          toast('info', "Voice typing isn't available on this computer, so the mic button has been hidden.")
        }
      }
      r.onend = () => setListening(false)
      rec.current = r
      try {
        r.start()
        setListening(true)
      } catch {
        setVoiceOk(false)
      }
    }

    const hasText = text.trim().length > 0 || attachments.length > 0

    return (
      <div data-tour="composer" className={cx('w-full border border-[#3a3a3a] bg-[#141414] transition-[border-radius] duration-150 focus-within:border-[#4a4a4a]', multi ? 'rounded-[24px]' : 'rounded-full')}>
        <AnimatePresence>
          {attachments.length > 0 && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
              <div className="flex flex-wrap gap-1.5 px-4 pt-3">
                {attachments.map((a) => (
                  <span key={a} className="flex items-center gap-1.5 text-[12.5px] bg-card border border-line rounded-full pl-2.5 pr-1.5 h-7">
                    <Paperclip size={12} className="text-muted" /> {a.split('/').pop()}
                    <button aria-label="Remove attachment" className="text-muted hover:text-fg" onClick={() => setAttachments((x) => x.filter((p) => p !== a))}><X size={13} /></button>
                  </span>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <div className={cx('flex gap-2 px-[11px]', multi ? 'items-end py-[10px]' : 'items-center py-[8px]')}>
          <Tooltip label="Attach files" side="top">
            <button aria-label="Attach files" onClick={async () => addAttachments(await api.pickFiles())} className="w-[30px] h-[30px] rounded-full bg-[#3a3a3a] hover:bg-[#474747] text-fg flex items-center justify-center shrink-0 transition">
              <Plus size={19} strokeWidth={2} />
            </button>
          </Tooltip>
          <textarea
            ref={ta}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                submit()
              }
            }}
            placeholder={listening ? 'Listening…' : placeholder}
            className="flex-1 bg-transparent resize-none outline-none text-[15px] leading-[24px] placeholder:text-muted py-[3px] px-1"
          />
          {voiceOk && (
            <Tooltip label={listening ? 'Stop dictation' : 'Dictate with your voice'} side="top">
              <button aria-label="Dictate" onClick={toggleVoice} className={cx('w-[30px] h-[30px] rounded-full flex items-center justify-center shrink-0 transition', listening ? 'text-accent bg-accent-soft' : 'text-fg-2 hover:text-fg')}>
                <Mic size={18} />
              </button>
            </Tooltip>
          )}
          {busy && !hasText ? (
            <Tooltip label="Stop" side="top">
              <button aria-label="Stop" onClick={onStop} className="w-[32px] h-[32px] rounded-full bg-white text-black flex items-center justify-center shrink-0 hover:opacity-90 active:scale-95 transition">
                <Square size={12} fill="currentColor" />
              </button>
            </Tooltip>
          ) : (
            <Tooltip label={hasText ? 'Send (Enter)' : voiceOk ? 'Talk' : 'Send'} side="top">
              <button
                aria-label={hasText ? 'Send' : 'Talk'}
                onClick={hasText ? submit : voiceOk ? toggleVoice : submit}
                className={cx('w-[32px] h-[32px] rounded-full bg-white text-black flex items-center justify-center shrink-0 hover:opacity-90 active:scale-95 transition', listening && !hasText && 'ring-2 ring-accent')}
              >
                {hasText || !voiceOk ? <ArrowUp size={18} strokeWidth={2.4} /> : <AudioLines size={18} strokeWidth={2.4} />}
              </button>
            </Tooltip>
          )}
        </div>
      </div>
    )
  }
)
