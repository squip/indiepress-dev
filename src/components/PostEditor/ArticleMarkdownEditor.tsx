import React, {
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { Node } from '@tiptap/core'
import { EditorContent, ReactNodeViewRenderer, useEditor, NodeViewWrapper } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import ImageExtension from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Markdown } from 'tiptap-markdown'
import { createPortal } from 'react-dom'
import Uploader from './Uploader'
import EmojiPickerDialog from '../EmojiPickerDialog'
import Mentions from './Mentions'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn, isTouchDevice } from '@/lib/utils'
import {
  Bold,
  Code,
  CodeXml,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Minus,
  Quote,
  Redo,
  Type,
  Underline as UnderlineIcon,
  Undo,
  Smile,
  Save,
  SquarePlus,
  SquareX
} from 'lucide-react'
import Mention from './PostTextarea/Mention'
import mentionSuggestion from './PostTextarea/Mention/suggestion'
import Emoji from './PostTextarea/Emoji'
import emojiSuggestion from './PostTextarea/Emoji/suggestion'
import { ClipboardAndDropHandler } from './PostTextarea/ClipboardAndDropHandler'
import WebPreview from '../WebPreview'
import YoutubeEmbeddedPlayer from '../YoutubeEmbeddedPlayer'
import VideoPlayer from '../VideoPlayer'
import { useFetchWebMetadata } from '@/hooks/useFetchWebMetadata'
import { Play } from 'lucide-react'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { Plugin } from '@tiptap/pm/state'
import { DOMParser as PMDOMParser } from '@tiptap/pm/model'

type ArticleMarkdownEditorProps = {
  value: string
  onChange: (next: string) => void
  initialJson?: any
  onJsonChange?: (json: any) => void
  mentions?: string[]
  setMentions?: (m: string[]) => void
  onEmojiSelect?: (emoji: any) => void
  onUploadStart?: (file: File, cancel: () => void) => void
  onUploadEnd?: (file: File) => void
  onUploadProgress?: (file: File, progress: number) => void
  onUploadSuccess?: ({ url, tags }: { url: string; tags: string[][] }) => void
  onSaveDraft?: () => void
}

export default function ArticleMarkdownEditor({
  value,
  onChange,
  initialJson,
  onJsonChange,
  mentions,
  setMentions,
  onEmojiSelect,
  onUploadStart,
  onUploadEnd,
  onUploadProgress,
  onUploadSuccess,
  onSaveDraft
}: ArticleMarkdownEditorProps) {
  const lastMarkdown = useRef(value)
  const initialJsonRef = useRef<any>(initialJson)
  const [hasFocus, setHasFocus] = useState(false)
  const [keyboardOffset, setKeyboardOffset] = useState(0)
  const [isFabOpen, setIsFabOpen] = useState(false)
  const [keyboardOpen, setKeyboardOpen] = useState(false)
  const keyboardOpenRef = useRef(false)
  const baselineViewportHeight = useRef<number | null>(null)
  const toolbarScrollRef = useRef<HTMLDivElement | null>(null)
  const toolbarDragRef = useRef<{
    startX: number
    startScrollLeft: number
    moved: boolean
  } | null>(null)
  const skipToolbarTapRef = useRef(false)
  const [scrollShadows, setScrollShadows] = useState({ left: false, right: false })
  const inertiaFrameRef = useRef<number | null>(null)
  const lastTouchRef = useRef<{ x: number; t: number } | null>(null)
  const prevTouchRef = useRef<{ x: number; t: number } | null>(null)
  const [linkDialogOpen, setLinkDialogOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('https://')
  const [linkText, setLinkText] = useState('')
  const [debugEnabled, setDebugEnabled] = useState(() => {
    if (typeof window === 'undefined') return false
    const stored = localStorage.getItem('article-editor-debug')
    if (stored === 'true') return true
    if (stored === 'false') return false
    return Boolean(import.meta.env.DEV)
  })
  const [debugEntries, setDebugEntries] = useState<
    { id: string; time: string; message: string; data?: unknown }[]
  >([])
  const [debugPanelOpen, setDebugPanelOpen] = useState(() => {
    if (typeof window === 'undefined') return false
    const stored = localStorage.getItem('article-editor-debug')
    if (stored === 'true') return true
    if (stored === 'false') return false
    return Boolean(import.meta.env.DEV)
  })
  const linkSelectionRef = useRef<{ from: number; to: number } | null>(null)

  const debugIdRef = useRef(0)
  const debugLog = useCallback(
    (message: string, data?: unknown) => {
      if (!debugEnabled) return
      const now = new Date()
      debugIdRef.current += 1
      const entry = {
        id: `${now.getTime()}-${debugIdRef.current}`,
        time: now.toLocaleTimeString(),
        message,
        data: serializeDebug(data)
      }
      setDebugEntries((prev) => [...prev.slice(-49), entry])
      console.log('[ArticleEditor]', message, entry.data ?? '')
    },
    [debugEnabled]
  )

  useEffect(() => {
    localStorage.setItem('article-editor-debug', debugEnabled ? 'true' : 'false')
    if (debugEnabled) {
      setDebugPanelOpen(true)
    }
  }, [debugEnabled])

  const updateScrollShadows = useCallback(() => {
    const el = toolbarScrollRef.current
    if (!el) return
    const { scrollLeft, scrollWidth, clientWidth } = el
    const maxScrollLeft = Math.max(0, scrollWidth - clientWidth)
    setScrollShadows({
      left: scrollLeft > 2,
      right: scrollLeft < maxScrollLeft - 2
    })
  }, [])

  const [isTouchSmallScreen, setIsTouchSmallScreen] = useState(() => {
    if (typeof window === 'undefined') return false
    return isTouchDevice() && window.innerWidth <= 1100
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handleResize = () => {
      setIsTouchSmallScreen(isTouchDevice() && window.innerWidth <= 1100)
    }
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const getMarkdown = useCallback(
    (editorInstance: ReturnType<typeof useEditor> | null) => {
      if (!editorInstance) return ''
      const storage = (editorInstance as any)?.storage?.markdown
      if (storage?.getMarkdown) {
        return storage.getMarkdown()
      }
      return editorInstance?.getText?.() ?? ''
    },
    []
  )

  const MentionWithMarkdown = useMemo(
    () =>
      Mention.extend({
        addStorage() {
          return {
            markdown: {
              serialize: (state: any, node: any) => {
                // Render mention as its label or id as plain text for markdown output.
                const text = (node?.attrs?.label as string) || (node?.attrs?.id as string) || ''
                state.write(text)
              },
              parse: {
                // no-op; mentions will come back as plain text unless a custom parser is added
              }
            }
          }
        }
      }),
    []
  )

  const EmojiWithMarkdown = useMemo(
    () =>
      Emoji.extend({
        addStorage() {
          const parent = this.parent?.() ?? {}
          return {
            ...parent,
            markdown: {
              serialize: (state: any, node: any) => {
                const text = node?.attrs?.name || node?.text || ''
                state.write(text)
              },
              parse: {
                // no-op; emojis will round-trip as text
              }
            }
          }
        }
      }),
    []
  )

  const editor = useEditor({
    content: initialJsonRef.current ?? (value || ''),
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] }
      }),
      Underline.extend({
        addStorage() {
          return {
            markdown: {
              // Markdown has no native underline; serialize by keeping plain text (no markers).
              serialize: {
                open: '',
                close: '',
                mixable: true,
                expelEnclosingWhitespace: true
              },
              parse: {
                // handled by markdown-it if html is enabled; otherwise ignored
              }
            }
          }
        }
      }),
      Link.configure({
        openOnClick: true,
        autolink: true,
        linkOnPaste: true
      }),
      TaskList,
      TaskItem.configure({
        nested: false
      }),
      ImageNode.configure({
        inline: false,
        allowBase64: true,
        HTMLAttributes: {
          class: 'rounded-md my-3 max-w-full'
        }
      }),
      MentionWithMarkdown.configure({
        suggestion: mentionSuggestion
      }),
      EmojiWithMarkdown.configure({
        suggestion: emojiSuggestion
      }),
      ClipboardAndDropHandler.configure({
        onUploadStart: (file, cancel) => {
          onUploadStart?.(file, cancel)
          debugLog('upload:start', { name: file.name, type: file.type, size: file.size })
        },
        onUploadEnd: (file) => onUploadEnd?.(file),
        onUploadProgress: (file, p) => onUploadProgress?.(file, p),
        onUploadSuccess: (file, result) => {
          const handled = insertUploadedMedia(editor, file.type, result.url)
          if (handled) {
            onUploadSuccess?.(result)
            debugLog('upload:inserted', {
              url: result.url,
              type: detectMediaType(result.url, file.type)
            })
          }
          return handled
        }
      }),
      Placeholder.configure({
        placeholder: 'Start writing your article...',
        includeChildren: true,
        showOnlyCurrent: false
      }),
      Markdown.configure({
        html: false,
        transformCopiedText: true,
        transformPastedText: true,
        breaks: true
      }),
      LinkPreviewNode,
      MediaEmbedNode,
      ParagraphHighlight
    ],
    editorProps: {
      attributes: {
        class: 'article-editor__content'
      },
      handlePaste: (view, event) => {
        const hasFiles =
          event.clipboardData?.files && Array.from(event.clipboardData.files).some((f) => f)
        if (hasFiles) {
          // Let ClipboardAndDropHandler manage file uploads.
          return false
        }
        const pastedText = event.clipboardData?.getData('text/plain') ?? ''
        if (!pastedText.trim()) {
          return false
        }

        const slice = parseMarkdownToSlice(editor, pastedText, debugLog)
        if (!slice) {
          return false
        }

        event.preventDefault()
        const tr = view.state.tr.replaceSelection(slice)
        view.dispatch(tr)
        convertStandaloneUrls(editor, debugLog)
        return true
      },
      handleKeyDown: (view, event) => {
        const isList =
          editor?.isActive('bulletList') ||
          editor?.isActive('orderedList') ||
          editor?.isActive('taskList')
        const isTask = editor?.isActive('taskItem')
        const isCode = editor?.isActive('codeBlock')

        if (event.key === 'Tab' && (isList || isCode)) {
          if (isList) {
            // Disable list indent/outdent behavior to keep lists single-level.
            return false
          }
          event.preventDefault()
          if (event.shiftKey) {
            editor?.chain().focus().command(({ tr }) => {
              const { from, to } = tr.selection
              tr.replaceRangeWith(from, Math.min(to, from + 4), editor.state.schema.text(''))
              return true
            }).run()
          } else {
            editor?.chain().focus().insertContent('    ').run()
          }
          debugLog('keydown:tab', { shift: event.shiftKey, isList, isTask, isCode })
          return true
        }

        if (event.key === 'Backspace' && (isList || isCode)) {
          const { state } = view
          const { from } = state.selection
          const $from = state.doc.resolve(from)
          if ($from.parentOffset === 0) {
            if (isList) {
              const type = isTask ? 'taskItem' : 'listItem'
              editor?.chain().focus().liftListItem(type as any).run()
              debugLog('keydown:backspace-lift', { isTask })
              return true
            }
          }
        }
        return false
      }
    },
    onUpdate: ({ editor }) => {
      const markdown = getMarkdown(editor as any)
      lastMarkdown.current = markdown
      onChange(markdown)
      onJsonChange?.(editor.getJSON())
      debugLog('update', {
        markdownLength: markdown?.length ?? 0,
        selection: editor.state.selection?.toJSON?.()
      })
    },
    onFocus() {
      setHasFocus(true)
      debugLog('focus')
    },
    onBlur() {
      setHasFocus(false)
      convertStandaloneUrls(editor, debugLog)
      debugLog('blur')
    }
  })

  useEffect(() => {
    if (!editor) return
    // Avoid resetting content while user is actively editing; only sync when not focused.
    if (hasFocus) return
    const applyContent = (content: any) => {
      const run = () => {
        if (!editor) return
        editor.commands.setContent(content)
      }
      if (typeof queueMicrotask === 'function') {
        queueMicrotask(run)
      } else {
        Promise.resolve().then(run)
      }
    }
    if (initialJson && initialJson !== initialJsonRef.current) {
      initialJsonRef.current = initialJson
      applyContent(initialJson)
      lastMarkdown.current = getMarkdown(editor as any)
      return
    }
    if (value === lastMarkdown.current) return
    applyContent(value || '')
    lastMarkdown.current = value
  }, [value, initialJson, editor, getMarkdown, hasFocus])

  useEffect(() => {
    const el = toolbarScrollRef.current
    if (!el) return
    updateScrollShadows()
    const handler = () => updateScrollShadows()
    el.addEventListener('scroll', handler, { passive: true })
    return () => {
      el.removeEventListener('scroll', handler)
    }
  }, [updateScrollShadows, isTouchSmallScreen, isFabOpen])

  useEffect(() => {
    if (!isFabOpen) return
    requestAnimationFrame(() => updateScrollShadows())
  }, [isFabOpen, updateScrollShadows])

  useEffect(() => {
    if (!isTouchSmallScreen || typeof window === 'undefined') {
      return
    }
    const vv = window.visualViewport
    const update = () => {
      const vpH = vv?.height ?? window.innerHeight
      const offset = Math.max(0, window.innerHeight - vpH - (vv?.offsetTop ?? 0))
      setKeyboardOffset(offset)
      const baseline = baselineViewportHeight.current
      if (
        baseline === null ||
        (!keyboardOpenRef.current && vpH > baseline - 16) ||
        (!keyboardOpenRef.current && Math.abs(vpH - baseline) > 200)
      ) {
        baselineViewportHeight.current = vpH
      }

      const deltaFromBaseline = (baselineViewportHeight.current ?? vpH) - vpH
      const keyboardLikelyOpen = deltaFromBaseline > 110 || offset > 40
      keyboardOpenRef.current = keyboardLikelyOpen
      setKeyboardOpen(keyboardLikelyOpen)
      if (!keyboardLikelyOpen) {
        setIsFabOpen(false)
      }
    }
    update()
    vv?.addEventListener('resize', update)
    vv?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    return () => {
      vv?.removeEventListener('resize', update)
      vv?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [isTouchSmallScreen])

  const floatingToolbarVisible = useMemo(() => {
    if (!isTouchSmallScreen) return false
    if (typeof window !== 'undefined' && typeof window.visualViewport === 'undefined') {
      return hasFocus
    }
    return keyboardOpen
  }, [isTouchSmallScreen, keyboardOpen, hasFocus])

  if (!editor) return null

  const toolbarBody = (
    <>
      <ToolbarGroup>
        <ToolbarButton
          icon={Undo}
          label="Undo"
          onClick={() => {
            debugLog('toolbar:undo')
            editor.chain().focus().undo().run()
          }}
          disabled={!editor.can().undo()}
          isFirst
          shouldIgnoreTap={() => skipToolbarTapRef.current}
        />
        <ToolbarButton
          icon={Redo}
          label="Redo"
          onClick={() => {
            debugLog('toolbar:redo')
            editor.chain().focus().redo().run()
          }}
          disabled={!editor.can().redo()}
          isLast
          shouldIgnoreTap={() => skipToolbarTapRef.current}
        />
      </ToolbarGroup>
      <ToolbarDivider />
      <ToolbarGroup>
        <HeadingMenu editor={editor} shouldIgnoreTap={() => skipToolbarTapRef.current} />
        <ToolbarButton
          icon={Bold}
          label="Bold"
          onClick={() => {
            debugLog('toolbar:bold')
            editor.chain().focus().toggleBold().run()
          }}
          active={editor.isActive('bold')}
          shouldIgnoreTap={() => skipToolbarTapRef.current}
        />
        <ToolbarButton
          icon={Italic}
          label="Italic"
          onClick={() => {
            debugLog('toolbar:italic')
            editor.chain().focus().toggleItalic().run()
          }}
          active={editor.isActive('italic')}
          shouldIgnoreTap={() => skipToolbarTapRef.current}
        />
        <ToolbarButton
          icon={UnderlineIcon}
          label="Underline"
          onClick={() => {
            debugLog('toolbar:underline')
            editor.chain().focus().toggleUnderline().run()
          }}
          active={editor.isActive('underline')}
          shouldIgnoreTap={() => skipToolbarTapRef.current}
        />
        <ToolbarButton
          icon={Code}
          label="Inline code"
          onClick={() => {
            debugLog('toolbar:inline-code')
            editor.chain().focus().toggleCode().run()
          }}
          active={editor.isActive('code')}
          isLast
          shouldIgnoreTap={() => skipToolbarTapRef.current}
        />
      </ToolbarGroup>
      <ToolbarDivider />
      <ToolbarGroup>
        <ToolbarButton
          icon={LinkIcon}
          label="Insert link"
          onClick={() => {
            const previousUrl = editor.getAttributes('link').href as string | undefined
            setLinkUrl(previousUrl || 'https://')
            const { from, to } = editor.state.selection
            linkSelectionRef.current = { from, to }
            const selectionText = editor.state.doc.textBetween(
              editor.state.selection.from,
              editor.state.selection.to,
              ' '
            )
            setLinkText(selectionText || '')
            debugLog('toolbar:link-open', { previousUrl, selectionText })
            setLinkDialogOpen(true)
          }}
          active={editor.isActive('link')}
          shouldIgnoreTap={() => skipToolbarTapRef.current}
        />
        <Uploader
          onUploadStart={onUploadStart}
          onUploadEnd={onUploadEnd}
          onProgress={onUploadProgress}
          onUploadSuccess={({ url, tags }) => {
            onUploadSuccess?.({ url, tags })
            const type = detectMediaType(url)
            if (type === 'image') {
              editor.chain().focus().setImage({ src: url, alt: '' }).run()
            } else if (type === 'video') {
              editor
                .chain()
                .focus()
                .insertContent({ type: 'mediaEmbed', attrs: { src: url, mediaType: 'video' } })
                .run()
            } else {
              editor.chain().focus().insertContent(url).run()
            }
            debugLog('toolbar:upload-insert', { url, type })
          }}
          accept="image/*,video/*,audio/*"
          onPickerOpen={() => setIsFabOpen(false)}
        >
          <ToolbarButton
            icon={ImageIcon}
            label="Upload media"
            onClick={() => {}}
            shouldIgnoreTap={() => skipToolbarTapRef.current}
          />
        </Uploader>
        {!isTouchDevice() && (
          <EmojiPickerDialog
            onEmojiClick={(emoji) => {
              onEmojiSelect?.(emoji)
              if (!emoji) return
              editor
                .chain()
                .focus()
                .insertContent(typeof emoji === 'string' ? emoji : `:${emoji.shortcode}:`)
                .run()
              debugLog('toolbar:emoji-insert', {
                emoji: typeof emoji === 'string' ? emoji : emoji?.shortcode
              })
            }}
          >
            <ToolbarButton
              icon={Smile}
              label="Emoji"
              onClick={() => {}}
              shouldIgnoreTap={() => skipToolbarTapRef.current}
            />
          </EmojiPickerDialog>
        )}
          <ToolbarButton
            icon={Minus}
            label="Horizontal rule"
            onClick={() => {
              debugLog('toolbar:hr')
              editor.chain().focus().setHorizontalRule().run()
            }}
            isLast
            shouldIgnoreTap={() => skipToolbarTapRef.current}
          />
      </ToolbarGroup>
      <ToolbarDivider />
      <ToolbarGroup>
        <ToolbarButton
          icon={List}
          label="Bullet list"
          onClick={() => {
            debugLog('toolbar:bullet-list')
            editor.chain().focus().toggleBulletList().run()
          }}
          active={editor.isActive('bulletList')}
          shouldIgnoreTap={() => skipToolbarTapRef.current}
        />
        <ToolbarButton
          icon={ListOrdered}
          label="Numbered list"
          onClick={() => {
            debugLog('toolbar:ordered-list')
            editor.chain().focus().toggleOrderedList().run()
          }}
          active={editor.isActive('orderedList')}
          shouldIgnoreTap={() => skipToolbarTapRef.current}
        />
        <ToolbarButton
          icon={Quote}
          label="Blockquote"
          onClick={() => {
            debugLog('toolbar:blockquote')
            editor.chain().focus().toggleBlockquote().run()
          }}
          active={editor.isActive('blockquote')}
          shouldIgnoreTap={() => skipToolbarTapRef.current}
        />
        <ToolbarButton
          icon={CodeXml}
          label="Code block"
          onClick={() => {
            debugLog('toolbar:code-block')
            editor.chain().focus().toggleCodeBlock().run()
          }}
          active={editor.isActive('codeBlock')}
          isLast
          shouldIgnoreTap={() => skipToolbarTapRef.current}
        />
      </ToolbarGroup>
      <ToolbarDivider />
      <ToolbarGroup>
        <ToolbarButton
          icon={Save}
          label="Save Draft"
          onClick={() => {
            debugLog('toolbar:save-draft')
            onSaveDraft?.()
          }}
          isFirst
          isLast
          shouldIgnoreTap={() => skipToolbarTapRef.current}
        />
      </ToolbarGroup>
      {mentions && setMentions && (
        <>
          <ToolbarDivider />
          <ToolbarGroup>
            <Mentions content={value} mentions={mentions} setMentions={setMentions} />
          </ToolbarGroup>
        </>
      )}
    </>
  )

  return (
    <div className="article-editor space-y-2">
      <LinkDialog
        open={linkDialogOpen}
        setOpen={setLinkDialogOpen}
        url={linkUrl}
        setUrl={setLinkUrl}
          text={linkText}
          setText={setLinkText}
        onSubmit={(url, text) => {
          const trimmed = url.trim()
          if (!trimmed) {
            editor.chain().focus().unsetLink().run()
            debugLog('link:unset')
            return
          }
          editor.commands.focus()
          const { state, view } = editor
          const stored = linkSelectionRef.current
          const from = stored?.from ?? state.selection.from
          const to = stored?.to ?? state.selection.to
          const hasText = Boolean(text)
          const insertText = hasText
            ? text!
            : state.doc.textBetween(from, to, ' ') || trimmed

          editor.chain().command(({ tr, dispatch }) => {
            // Replace selection (or caret) with text
            tr.insertText(insertText, from, to)
            const start = from
            const end = from + insertText.length
            tr.setSelection((state.selection as any).constructor.create(tr.doc, start, end))
            tr.addMark(start, end, state.schema.marks.link.create({ href: trimmed }))
            if (dispatch) {
              dispatch(tr.scrollIntoView())
            }
            return true
          }).run()

          debugLog('link:apply', { url: trimmed, text: insertText })
          linkSelectionRef.current = null
          }}
        />
      {!isTouchSmallScreen && (
        <div className="article-toolbar flex flex-wrap items-center gap-2">{toolbarBody}</div>
      )}
      {floatingToolbarVisible &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed left-0 right-0 z-[80] flex items-center justify-end px-4 pb-2 pointer-events-none"
            style={{
              bottom: Math.max(12, keyboardOffset + 12),
              paddingBottom: 'env(safe-area-inset-bottom, 0px)'
            }}
          >
            <div className="relative inline-flex items-center gap-2 pointer-events-auto">
              <div className="relative">
                <div
                  className={`flex items-center gap-1 overflow-x-auto whitespace-nowrap bg-background border border-border px-2 py-2 rounded-md shadow-lg transition-all duration-200 ease-out origin-bottom-right touch-pan-x ${
                    isFabOpen
                      ? 'opacity-100 translate-x-0'
                      : 'opacity-0 translate-x-4 pointer-events-none'
                  }`}
                  style={{
                    maxWidth: 'calc(100vw - 72px)',
                    width: 'calc(100vw - 72px)',
                    WebkitOverflowScrolling: 'touch',
                    touchAction: 'pan-x'
                  }}
                  ref={toolbarScrollRef}
                  onTouchStart={(e) => {
                    if (!toolbarScrollRef.current) return
                    if (inertiaFrameRef.current) {
                      cancelAnimationFrame(inertiaFrameRef.current)
                      inertiaFrameRef.current = null
                    }
                    const touch = e.touches[0]
                    toolbarDragRef.current = {
                      startX: touch.clientX,
                      startScrollLeft: toolbarScrollRef.current.scrollLeft,
                      moved: false
                    }
                    prevTouchRef.current = null
                    lastTouchRef.current = { x: touch.clientX, t: performance.now() }
                    skipToolbarTapRef.current = false
                  }}
                  onTouchMove={(e) => {
                    if (!toolbarScrollRef.current || !toolbarDragRef.current) return
                    const touch = e.touches[0]
                    const deltaX = touch.clientX - toolbarDragRef.current.startX
                    if (Math.abs(deltaX) > 2) {
                      toolbarDragRef.current.moved = true
                      skipToolbarTapRef.current = true
                    }
                    const next = toolbarDragRef.current.startScrollLeft - deltaX
                    toolbarScrollRef.current.scrollLeft = next
                    updateScrollShadows()
                    prevTouchRef.current = lastTouchRef.current
                    lastTouchRef.current = { x: touch.clientX, t: performance.now() }
                    if (toolbarDragRef.current.moved) {
                      e.preventDefault()
                    }
                  }}
                  onTouchEnd={() => {
                    const el = toolbarScrollRef.current
                    const last = lastTouchRef.current
                    const prev = prevTouchRef.current
                    toolbarDragRef.current = null
                    if (el && last && prev) {
                      const dt = Math.max(1, last.t - prev.t)
                      const velocityPxPerMs = (last.x - prev.x) / dt
                      const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth)
                      let v = velocityPxPerMs
                      const friction = 0.94
                      const bounce = 0.55

                      const step = () => {
                        if (!el) return
                        const next = el.scrollLeft - v * 16
                        el.scrollLeft = Math.min(maxScroll + 32, Math.max(-32, next))
                        updateScrollShadows()
                        const atBoundary = el.scrollLeft < 0 || el.scrollLeft > maxScroll
                        v *= friction * (atBoundary ? bounce : 1)
                        if (Math.abs(v) < 0.05) {
                          if (el.scrollLeft < 0) el.scrollTo({ left: 0, behavior: 'smooth' })
                          if (el.scrollLeft > maxScroll) el.scrollTo({ left: maxScroll, behavior: 'smooth' })
                          inertiaFrameRef.current = null
                          return
                        }
                        inertiaFrameRef.current = requestAnimationFrame(step)
                      }
                      inertiaFrameRef.current = requestAnimationFrame(step)
                    }
                    requestAnimationFrame(() => {
                      skipToolbarTapRef.current = false
                    })
                  }}
                >
                  {toolbarBody}
                </div>
                <div
                  className={`pointer-events-none absolute inset-y-1 left-0 w-6 rounded-l-md bg-gradient-to-r from-background to-transparent transition-opacity duration-150 ${
                    scrollShadows.left && isFabOpen ? 'opacity-70' : 'opacity-0'
                  }`}
                />
                <div
                  className={`pointer-events-none absolute inset-y-1 right-0 w-6 rounded-r-md bg-gradient-to-l from-background to-transparent transition-opacity duration-150 ${
                    scrollShadows.right && isFabOpen ? 'opacity-70' : 'opacity-0'
                  }`}
                />
              </div>
              <Button
                size="icon"
                variant="default"
                className="shadow-lg rounded-md h-11 w-11"
                onMouseDown={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                }}
                onClick={() => {
                  setIsFabOpen((open: boolean) => !open)
                  editor?.commands.focus()
                }}
              >
                {isFabOpen ? <SquareX className="h-8 w-8" /> : <SquarePlus className="h-8 w-8" />}
              </Button>
            </div>
          </div>,
          document.body
        )}
      <EditorContent
        editor={editor}
        className="article-prose tiptap prose prose-zinc dark:prose-invert max-w-none break-words overflow-wrap-anywhere max-h-[45vh] sm:max-h-none overflow-auto min-h-[290px]"
      />
      <DebugConsole
        enabled={debugEnabled}
        setEnabled={setDebugEnabled}
        open={debugPanelOpen}
        setOpen={setDebugPanelOpen}
        entries={debugEntries}
        onClear={() => setDebugEntries([])}
      />
    </div>
  )
}

function HeadingMenu({
  editor,
  shouldIgnoreTap
}: {
  editor: NonNullable<ReturnType<typeof useEditor>>
  shouldIgnoreTap: () => boolean
}) {
  const isHeadingActive = (level: number) => editor.isActive('heading', { level })
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ToolbarButton
          icon={Type}
          label="Style"
          active={isHeadingActive(1) || isHeadingActive(2) || isHeadingActive(3) || isHeadingActive(4)}
          isFirst
          shouldIgnoreTap={shouldIgnoreTap}
          onClick={() => editor.chain().focus().run()}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-48">
        <DropdownMenuItem onSelect={() => editor.chain().focus().setParagraph().run()}>
          Paragraph
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>
          Heading 1
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
          Heading 2
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
          Heading 3
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => editor.chain().focus().toggleHeading({ level: 4 }).run()}>
          Heading 4
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ToolbarGroup({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center rounded-md border border-input overflow-hidden shrink-0">
      {children}
    </div>
  )
}

function ToolbarDivider() {
  return <Separator orientation="vertical" className="h-8" />
}

const ToolbarButton = React.forwardRef<
  HTMLButtonElement,
  {
    icon: React.ComponentType<{ className?: string }>
    label: string
    onClick: () => void
    active?: boolean
    disabled?: boolean
    isFirst?: boolean
    isLast?: boolean
    withText?: boolean
    shouldIgnoreTap?: () => boolean
  }
>(({ icon: Icon, label, onClick, active, disabled, isFirst, isLast, withText, shouldIgnoreTap }, ref) => {
  return (
    <Button
      ref={ref}
      type="button"
      variant="ghost"
      size="sm"
      disabled={disabled}
      data-active={active ? 'true' : undefined}
      className={cn(
        'toolbar-button h-8 px-1.5 min-w-[38px] shadow-none border-r border-input rounded-none hover:bg-accent hover:text-accent-foreground shrink-0',
        isFirst && 'rounded-l-md',
        isLast && 'rounded-r-md border-r-0'
      )}
      onMouseDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      onClick={(e) => {
        e.stopPropagation()
        if (shouldIgnoreTap?.()) return
        if (isTouchDevice() && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          navigator.vibrate?.(50)
        }
        ;(ref as any)?.current?.focus?.()
        onClick()
      }}
    >
      <Icon className="h-4 w-4" />
      {withText && <span className="ml-1 text-sm">{label}</span>}
    </Button>
  )
})
ToolbarButton.displayName = 'ToolbarButton'

const LinkPreviewNode = Node.create({
  name: 'linkPreview',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      url: { default: '' }
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-link-preview]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', { ...HTMLAttributes, 'data-link-preview': 'true' }]
  },
  addNodeView() {
    return ReactNodeViewRenderer(LinkPreviewView)
  },
  addStorage() {
    return {
      markdown: {
        serialize: (state: any, node: any) => {
          state.ensureNewLine()
          state.write((node.attrs.url as string) ?? '')
          state.closeBlock(node)
        }
      }
    }
  }
})

const MediaEmbedNode = Node.create({
  name: 'mediaEmbed',
  priority: 1000,
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      src: { default: '' },
      mediaType: { default: 'video' }
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-media-embed]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', { ...HTMLAttributes, 'data-media-embed': 'true' }]
  },
  addNodeView() {
    return ReactNodeViewRenderer(MediaEmbedView)
  },
  addStorage() {
    return {
      markdown: {
        serialize: (state: any, node: any) => {
          state.ensureNewLine()
          state.write((node.attrs.src as string) ?? '')
          state.closeBlock(node)
        }
      }
    }
  }
})

const ParagraphHighlight = Node.create({
  name: 'paragraphHighlight',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations: (state) => {
            const { selection, doc } = state
            const { from } = selection
            const decorations: Decoration[] = []
            let found = false

            doc.nodesBetween(from, from, (node, pos) => {
              if (node.type.name === 'paragraph') {
                decorations.push(
                  Decoration.node(pos, pos + node.nodeSize, { class: 'pm-current-paragraph' })
                )
                found = true
                return false
              }
              return
            })

            return found ? DecorationSet.create(doc, decorations) : null
          }
        }
      })
    ]
  }
})

const ImageNode = ImageExtension.extend({
  addNodeView() {
    return ReactNodeViewRenderer(ImageView)
  }
})

function ImageView({ node, getPos, editor, deleteNode }: any) {
  const src = node?.attrs?.src as string
  const alt = node?.attrs?.alt as string
  const title = node?.attrs?.title as string
  const imgClass = 'rounded-md my-3 max-w-full'

  return (
    <NodeViewWrapper
      as="div"
      className="my-3"
      data-image-node
      onClick={(e) => {
        e.stopPropagation()
        if (typeof getPos === 'function') {
          editor?.commands.setNodeSelection(getPos())
        }
      }}
    >
      <div className="flex justify-end">
        <button
          type="button"
          className="text-muted-foreground text-xs px-2 py-1 hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation()
            deleteNode?.()
          }}
        >
          ×
        </button>
      </div>
      <img src={src} alt={alt} title={title} className={imgClass} />
    </NodeViewWrapper>
  )
}

function LinkDialog({
  open,
  setOpen,
  url,
  setUrl,
  text,
  setText,
  onSubmit
}: {
  open: boolean
  setOpen: (v: boolean) => void
  url: string
  setUrl: (v: string) => void
  text: string
  setText: (v: string) => void
  onSubmit: (url: string, text: string) => void
}) {
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Insert link</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="link-url">URL</Label>
            <Input
              id="link-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="link-text">Text (optional)</Label>
            <Input
              id="link-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Link title"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={() => {
              onSubmit(url, text)
              setOpen(false)
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function convertStandaloneUrls(editor: any, debugLog?: (msg: string, data?: unknown) => void) {
  const urlRegex = /^(https?:\/\/\S+)$/
  const { state } = editor
  let tr = state.tr
  let changed = false
  const initialSelection = state.selection
  state.doc.descendants((node: any, pos: number) => {
    if (node.type.name !== 'paragraph') return true
    const text = node.textContent.trim()
    if (!text || node.childCount !== 1 || !node.firstChild?.isText) return true
    const match = urlRegex.exec(text)
    if (!match) return true
    const url = match[1]
    const linkPreview = state.schema.nodes.linkPreview?.create({ url })
    if (linkPreview) {
      tr = tr.replaceWith(pos, pos + node.nodeSize, linkPreview)
      changed = true
      debugLog?.('convert:url->preview', { url })
      return false
    }
    return true
  })
  if (changed) {
    // Preserve selection near the original position to avoid jumps.
    const mappedFrom = tr.mapping.map(initialSelection.from)
    const mappedTo = tr.mapping.map(initialSelection.to)
    const safePos = Math.min(tr.doc.content.size, Math.max(0, mappedFrom))
    try {
      tr = tr.setSelection(editor.state.selection.constructor.create(tr.doc, safePos, mappedTo))
    } catch (_e) {
      try {
        tr = tr.setSelection(editor.state.selection.constructor.near(tr.doc.resolve(safePos)))
      } catch {
        /* ignore */
      }
    }
    editor.view.dispatch(tr)
  }
}

function parseMarkdownToSlice(editor: any, text: string, debugLog?: (msg: string, data?: unknown) => void) {
  if (!text?.length) return null
  const parser = (editor as any)?.storage?.markdown?.parser
  if (!parser) return null
  try {
    const html = parser.parse(text)
    if (!html || typeof document === 'undefined') return null
    const container = document.createElement('div')
    container.innerHTML = html
    return PMDOMParser.fromSchema(editor.schema).parseSlice(container, {
      preserveWhitespace: true
    })
  } catch (error) {
    debugLog?.('paste:parse-error', { message: (error as Error)?.message })
    return null
  }
}

function insertUploadedMedia(editor: any, mimeType: string, url: string) {
  const mediaType = detectMediaType(url, mimeType)
  if (mediaType === 'image') {
    editor.chain().focus().setImage({ src: url, alt: '' }).run()
    return true
  }
  if (mediaType === 'video') {
    editor
      .chain()
      .focus()
      .insertContent({ type: 'mediaEmbed', attrs: { src: url, mediaType: 'video' } })
      .run()
    return true
  }
  return false
}

function detectMediaType(url: string, mimeType?: string) {
  const type = mimeType || ''
  if (type.startsWith('image/')) return 'image'
  if (type.startsWith('video/')) return 'video'
  if (/\.(png|jpe?g|gif|webp|avif)$/i.test(url)) return 'image'
  if (/\.(mp4|mov|webm|mkv|avi)$/i.test(url)) return 'video'
  return 'unknown'
}

function isYoutubeUrl(url: string) {
  return /(youtube\.com|youtu\.be)/i.test(url)
}

function extractYoutubeId(url: string) {
  try {
    const u = new URL(url)
    if (u.hostname.includes('youtu.be')) {
      return u.pathname.replace('/', '')
    }
    if (u.searchParams.has('v')) {
      return u.searchParams.get('v') || ''
    }
    const paths = u.pathname.split('/')
    return paths.includes('embed') ? paths[paths.length - 1] : ''
  } catch {
    return ''
  }
}

function LinkPreviewView(props: any) {
  const { node, getPos, editor, deleteNode } = props
  const url = node.attrs.url as string
  if (!url) return null
  if (isYoutubeUrl(url)) {
    return (
      <NodeViewWrapper
        data-link-preview
        className="my-2"
        onClick={(e) => {
          e.stopPropagation()
          if (typeof getPos === 'function') {
            editor?.commands.setNodeSelection(getPos())
          }
        }}
      >
        <div className="flex justify-end">
          <button
            type="button"
            className="text-muted-foreground text-xs px-2 py-1 hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation()
              ;(props as any)?.deleteNode?.()
            }}
          >
            ×
          </button>
        </div>
        <YoutubeCard url={url} />
      </NodeViewWrapper>
    )
  }
  return (
    <NodeViewWrapper
      data-link-preview
      className="my-2"
        onClick={(e) => {
          e.stopPropagation()
          if (typeof getPos === 'function') {
            editor?.commands.setNodeSelection(getPos())
          }
        }}
      >
        <div className="flex justify-end">
          <button
            type="button"
            className="text-muted-foreground text-xs px-2 py-1 hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation()
              ;(props as any)?.deleteNode?.()
            }}
          >
            ×
          </button>
        </div>
        <div className="space-y-2">
          <WebPreview url={url} className="my-2" showFallback={false} />
          <a
            href={url}
            target="_blank"
          rel="noopener noreferrer nofollow"
          className="text-primary underline break-words"
        >
          {url}
        </a>
      </div>
    </NodeViewWrapper>
  )
}

function MediaEmbedView(props: any) {
  const { node, getPos, editor } = props
  const url = node?.attrs?.src as string
  if (!url) return null
  return (
    <NodeViewWrapper
      data-media-embed
      className="my-2"
      onClick={(e) => {
        e.stopPropagation()
        if (typeof getPos === 'function') {
          editor?.commands.setNodeSelection(getPos())
        }
      }}
    >
      <div className="flex justify-end">
        <button
          type="button"
          className="text-muted-foreground text-xs px-2 py-1 hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation()
            ;(props as any)?.deleteNode?.()
          }}
        >
          ×
        </button>
      </div>
      <VideoPlayer src={url} className="my-2" />
    </NodeViewWrapper>
  )
}

function YoutubeCard({ url }: { url: string }) {
  const { title, description, image } = useFetchWebMetadata(url)
  const thumb =
    image ||
    (isYoutubeUrl(url)
      ? `https://img.youtube.com/vi/${extractYoutubeId(url)}/hqdefault.jpg`
      : undefined)
  const [expanded, setExpanded] = useState(false)

  if (expanded) {
    return <YoutubeEmbeddedPlayer url={url} className="my-2" mustLoad />
  }

  return (
    <button
      type="button"
      className="youtube-card"
      onClick={(e) => {
        e.stopPropagation()
        setExpanded(true)
      }}
    >
      <div className="youtube-card__thumb">
        {thumb && <img src={thumb} alt={title || 'YouTube preview'} />}
        <div className="youtube-card__play">
          <Play className="h-6 w-6" />
        </div>
      </div>
      <div className="youtube-card__body">
        <div className="youtube-card__host">youtube.com</div>
        <div className="youtube-card__title">{title || url}</div>
        {description && <div className="youtube-card__desc">{description}</div>}
      </div>
    </button>
  )
}

function DebugConsole({
  enabled,
  setEnabled,
  open,
  setOpen,
  entries,
  onClear
}: {
  enabled: boolean
  setEnabled: (v: boolean) => void
  open: boolean
  setOpen: (v: boolean) => void
  entries: { id: string; time: string; message: string; data?: unknown }[]
  onClear: () => void
}) {
  return (
    <div className="mt-2 text-xs">
      <div className="flex items-center gap-2">
        <Button
          variant={enabled ? 'default' : 'outline'}
          size="sm"
          className="h-7"
          onClick={() => {
            const next = !enabled
            setEnabled(next)
            setOpen(next)
          }}
        >
          {enabled ? 'Debug on' : 'Debug off'}
        </Button>
        {enabled && (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="h-7"
              onClick={() => setOpen(!open)}
            >
              {open ? 'Hide log' : 'Show log'}
            </Button>
            <Button variant="ghost" size="sm" className="h-7" onClick={onClear}>
              Clear
            </Button>
            <span className="text-muted-foreground">{entries.length} events</span>
          </>
        )}
      </div>
      {enabled && open && (
        <div className="mt-2 max-h-52 overflow-auto rounded border bg-muted/30 p-2 space-y-1">
          {entries.length === 0 && <div className="text-muted-foreground">No events yet</div>}
          {entries.map((entry) => (
            <div key={entry.id} className="break-words">
              <span className="text-muted-foreground mr-1">{entry.time}</span>
              <span className="font-semibold">{entry.message}</span>
              {entry.data !== undefined && (
                <pre className="mt-0.5 whitespace-pre-wrap break-words text-[11px] text-muted-foreground bg-background/70 rounded p-1 border">
                  {JSON.stringify(entry.data, null, 2)}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function serializeDebug(data: unknown) {
  if (data === undefined) return undefined
  try {
    return JSON.parse(JSON.stringify(data))
  } catch (_e) {
    try {
      return String(data)
    } catch {
      return '[[unserializable]]'
    }
  }
}
