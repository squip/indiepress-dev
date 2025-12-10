import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { forwardRef, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNotepad } from '@/providers/NotepadProvider'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import { remarkNostrLinks, nostrSanitizeSchema } from '@/lib/markdown'
import { Button } from '@/components/ui/button'
import PostEditor from '@/components/PostEditor'
import { useNostr } from '@/providers/NostrProvider'
import { useSecondaryPage } from '@/PageManager'

const NotepadNotePage = forwardRef(({ id, index }: { id?: string; index?: number }, ref) => {
  const { t } = useTranslation()
  const { notes, publish } = useNotepad()
  const { pubkey } = useNostr()
  const { pop } = useSecondaryPage()
  const [openEditor, setOpenEditor] = useState(false)

  const note = useMemo(() => {
    if (!id) return undefined
    return Array.from(notes.values()).find((n) => (n.d || n.id) === id)
  }, [id, notes])

  const title = note?.tags.find((t) => t[0] === 'title')?.[1] || t('Notepad')

  return (
    <SecondaryPageLayout
      ref={ref}
      index={index}
      title={title}
      displayScrollToTopButton
      controls={
        <div className="flex gap-2">
          <Button variant="ghost" size="icon" onClick={() => pop()}>
            {t('Back')}
          </Button>
          <Button size="sm" onClick={() => setOpenEditor(true)}>
            {t('Edit')}
          </Button>
        </div>
      }
    >
      {!note ? (
        <div className="text-center text-muted-foreground py-12">{t('Note not found')}</div>
      ) : (
        <article className="px-4 pt-3 pb-8 max-w-3xl mx-auto">
          <h1 className="text-2xl font-bold mb-6 select-text">{title}</h1>
          <div className="prose prose-lg dark:prose-invert max-w-none select-text">
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkNostrLinks]}
              rehypePlugins={[rehypeRaw, [rehypeSanitize, nostrSanitizeSchema]]}
            >
              {note.content}
            </ReactMarkdown>
          </div>
        </article>
      )}
      <PostEditor
        open={openEditor}
        setOpen={setOpenEditor}
        defaultTab="article"
        articleOptions={{
          existingEvent: note
            ? {
                id: note.id,
                kind: note.kind,
                pubkey: note.pubkey,
                created_at: note.created_at,
                content: note.content,
                tags: note.tags
              } as any
            : undefined,
          extraTags: pubkey ? [['t', `notepad:${pubkey}`]] : [],
          onPublish: async (draftEvent, { isDraft, relayUrls }) => {
            await publish(draftEvent, { isDraft, relayUrls })
            setOpenEditor(false)
          }
        }}
      />
    </SecondaryPageLayout>
  )
})

NotepadNotePage.displayName = 'NotepadNotePage'
export default NotepadNotePage
