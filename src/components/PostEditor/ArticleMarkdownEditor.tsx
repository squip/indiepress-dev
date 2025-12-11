import React, { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import ImageExtension from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import { Markdown } from 'tiptap-markdown'
import { createPortal } from 'react-dom'
import Uploader from './Uploader'
import EmojiPickerDialog from '../EmojiPickerDialog'
import Mentions from './Mentions'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import { remarkNostrLinks, nostrSanitizeSchema } from '@/lib/markdown'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { isTouchDevice } from '@/lib/utils'
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

type ArticleMarkdownEditorProps = {
  value: string
  onChange: (next: string) => void
  showPreview: boolean
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
  showPreview,
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

  const [isTouchSmallScreen, setIsTouchSmallScreen] = useState(() => {
    if (typeof window === 'undefined') return false
    // Include tablets/landscape touch devices
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

  const editor = useEditor({
    content: value || '',
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] }
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true
      }),
      ImageExtension.configure({
        inline: false,
        allowBase64: true,
        HTMLAttributes: {
          class: 'rounded-md my-3 max-w-full'
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
      })
    ],
    editorProps: {
      attributes: {
        class: 'article-editor__content'
      }
    },
    onUpdate: ({ editor }) => {
      const markdown = getMarkdown(editor as any)
      lastMarkdown.current = markdown
      onChange(markdown)
    },
    onFocus() {
      setHasFocus(true)
    },
    onBlur() {
      setHasFocus(false)
    }
  })

  useEffect(() => {
    if (!editor) return
    if (value === lastMarkdown.current) return
    editor.commands.setContent(value || '')
    lastMarkdown.current = value
  }, [value, editor])

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
    if (showPreview) return false
    if (typeof window !== 'undefined' && typeof window.visualViewport === 'undefined') {
      return hasFocus
    }
    return keyboardOpen
  }, [isTouchSmallScreen, showPreview, keyboardOpen, hasFocus])

  const previewContent = useMemo(() => {
    if (showPreview && editor) {
      return getMarkdown(editor as any)
    }
    return value || ''
  }, [editor, getMarkdown, showPreview, value])

  if (showPreview) {
    return (
      <div className="prose prose-base dark:prose-invert max-w-none border rounded-lg p-4 bg-background">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkNostrLinks]}
          rehypePlugins={[rehypeRaw, [rehypeSanitize, nostrSanitizeSchema]]}
        >
          {previewContent}
        </ReactMarkdown>
      </div>
    )
  }

  if (!editor) return null

  const toolbarBody = (
    <>
      <ToolbarGroup>
        <ToolbarButton
          icon={Undo}
          label="Undo"
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          isFirst
          shouldIgnoreTap={() => skipToolbarTapRef.current}
        />
        <ToolbarButton
          icon={Redo}
          label="Redo"
          onClick={() => editor.chain().focus().redo().run()}
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
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive('bold')}
          shouldIgnoreTap={() => skipToolbarTapRef.current}
        />
        <ToolbarButton
          icon={Italic}
          label="Italic"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive('italic')}
          shouldIgnoreTap={() => skipToolbarTapRef.current}
        />
        <ToolbarButton
          icon={UnderlineIcon}
          label="Underline"
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          active={editor.isActive('underline')}
          shouldIgnoreTap={() => skipToolbarTapRef.current}
        />
        <ToolbarButton
          icon={Code}
          label="Inline code"
          onClick={() => editor.chain().focus().toggleCode().run()}
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
            const url = window.prompt('Enter URL', previousUrl || 'https://')
            if (url === null) return
            if (url === '') {
              editor.chain().focus().unsetLink().run()
              return
            }
            editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
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
            editor.chain().focus().insertContent(`\n${url}\n`).run()
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
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          isLast
          shouldIgnoreTap={() => skipToolbarTapRef.current}
        />
      </ToolbarGroup>
      <ToolbarDivider />
      <ToolbarGroup>
        <ToolbarButton
          icon={List}
          label="Bullet list"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          active={editor.isActive('bulletList')}
          shouldIgnoreTap={() => skipToolbarTapRef.current}
        />
        <ToolbarButton
          icon={ListOrdered}
          label="Numbered list"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          active={editor.isActive('orderedList')}
          shouldIgnoreTap={() => skipToolbarTapRef.current}
        />
        <ToolbarButton
          icon={Quote}
          label="Blockquote"
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          active={editor.isActive('blockquote')}
          shouldIgnoreTap={() => skipToolbarTapRef.current}
        />
        <ToolbarButton
          icon={CodeXml}
          label="Code block"
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
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
          onClick={() => onSaveDraft?.()}
          isFirst
          isLast
          shouldIgnoreTap={() => skipToolbarTapRef.current}
        />
      </ToolbarGroup>
      {mentions && setMentions && showPreview && (
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
              <div
                className={`flex items-center gap-1 overflow-x-auto whitespace-nowrap bg-background border border-border px-2 py-2 rounded-md shadow-lg transition-all duration-200 ease-out origin-bottom-right touch-pan-x ${
                  isFabOpen
                    ? 'opacity-100 translate-x-0'
                    : 'opacity-0 translate-x-4 pointer-events-none'
                }`}
                style={{
                  maxWidth: 'calc(100vw - 72px)',
                  width: 'calc(100vw - 72px)',
                  WebkitOverflowScrolling: 'touch'
                }}
                ref={toolbarScrollRef}
                onTouchStart={(e) => {
                  if (!toolbarScrollRef.current) return
                  const touch = e.touches[0]
                  toolbarDragRef.current = {
                    startX: touch.clientX,
                    startScrollLeft: toolbarScrollRef.current.scrollLeft,
                    moved: false
                  }
                  skipToolbarTapRef.current = false
                }}
                onTouchMove={(e) => {
                  if (!toolbarScrollRef.current || !toolbarDragRef.current) return
                  const touch = e.touches[0]
                  const deltaX = touch.clientX - toolbarDragRef.current.startX
                  if (Math.abs(deltaX) > 4) {
                    toolbarDragRef.current.moved = true
                    skipToolbarTapRef.current = true
                  }
                  toolbarScrollRef.current.scrollLeft =
                    toolbarDragRef.current.startScrollLeft - deltaX
                  if (toolbarDragRef.current.moved) {
                    e.preventDefault()
                  }
                }}
                onTouchEnd={() => {
                  toolbarDragRef.current = null
                  requestAnimationFrame(() => {
                    skipToolbarTapRef.current = false
                  })
                }}
              >
                {toolbarBody}
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
        className="article-prose tiptap max-h-[45vh] sm:max-h-none overflow-auto min-h-[290px]"
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
        // Prevent blur/keyboard dismissal when tapping toolbar buttons on touch devices
        e.preventDefault()
        e.stopPropagation()
      }}
      onClick={(e) => {
        e.stopPropagation()
        if (shouldIgnoreTap?.()) return
        if (isTouchDevice() && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          navigator.vibrate?.(50)
        }
        // Keep editor focused so keyboard stays open
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(ref as any)?.current?.focus?.()
        } catch {}
        onClick()
      }}
    >
      <Icon className="h-4 w-4" />
      {withText && <span className="ml-1 text-sm">{label}</span>}
    </Button>
  )
})
ToolbarButton.displayName = 'ToolbarButton'
