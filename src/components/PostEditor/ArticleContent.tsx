import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import Mentions from './Mentions'
import PostRelaySelector from './PostRelaySelector'
import Uploader from './Uploader'
import EmojiPickerDialog from '../EmojiPickerDialog'
import { isTouchDevice } from '@/lib/utils'
import { createLongFormDraftEvent } from '@/lib/draft-event'
import { useNostr } from '@/providers/NostrProvider'
import postEditorCache from '@/services/post-editor-cache.service'
import { Event } from '@nostr/tools/wasm'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ImageUp, LoaderCircle, Smile } from 'lucide-react'
import { randomString } from '@/lib/random'
import * as nip19 from '@nostr/tools/nip19'
import { TDraftEvent } from '@/types'
import ArticleMarkdownEditor from './ArticleMarkdownEditor'

export default function ArticleContent({
  close,
  openFrom,
  existingEvent,
  extraTags = [],
  onPublish
}: {
  close: () => void
  openFrom?: string[]
  existingEvent?: Event
  extraTags?: string[][]
  onPublish?: (draftEvent: TDraftEvent, options: { isDraft: boolean; relayUrls: string[] }) => Promise<void>
}) {
  const { t } = useTranslation()
  const { publish, checkLogin } = useNostr()
  const [title, setTitle] = useState('')
  const [identifier, setIdentifier] = useState('')
  const [summary, setSummary] = useState('')
  const [image, setImage] = useState('')
  const [hashtagsText, setHashtagsText] = useState('')
  const [content, setContent] = useState('')
  const [publishedAt, setPublishedAt] = useState<number | undefined>(undefined)
  const [publishedAtInput, setPublishedAtInput] = useState('')
  const [posting, setPosting] = useState(false)
  const [savingDraft, setSavingDraft] = useState(false)
  const [mentions, setMentions] = useState<string[]>([])
  const [isProtectedEvent, setIsProtectedEvent] = useState(false)
  const [additionalRelayUrls, setAdditionalRelayUrls] = useState<string[]>([])
  const [uploadProgresses, setUploadProgresses] = useState<
    { file: File; progress: number; cancel: () => void }[]
  >([])
  const [showPreview, setShowPreview] = useState(false)
  const supportTouch = useMemo(() => isTouchDevice(), [])

  const cacheKey = useMemo(
    () => `article-editor:${existingEvent?.id ?? 'new'}`,
    [existingEvent?.id]
  )

  useEffect(() => {
    const cached = localStorage.getItem(cacheKey)
    if (cached) {
      try {
        const parsed = JSON.parse(cached)
        setTitle(parsed.title ?? '')
        setIdentifier(parsed.identifier ?? randomString(12))
        setSummary(parsed.summary ?? '')
        setImage(parsed.image ?? '')
        setHashtagsText(parsed.hashtagsText ?? '')
        setContent(parsed.content ?? '')
        setPublishedAt(parsed.publishedAt ?? undefined)
        if (parsed.publishedAt) {
          const dt = new Date(parsed.publishedAt * 1000).toISOString().slice(0, 16)
          setPublishedAtInput(dt)
        }
        return
      } catch (e) {
        console.error('Failed to parse article editor cache', e)
      }
    }

    if (!existingEvent) {
      setIdentifier(randomString(12))
      return
    }
    const getTag = (name: string) => existingEvent.tags.find((tag) => tag[0] === name)?.[1] ?? ''
    const pubAt = getTag('published_at')
    const pubAtNum = pubAt ? parseInt(pubAt) : undefined
    setTitle(getTag('title') || '')
    setIdentifier(getTag('d') || randomString(12))
    setSummary(getTag('summary') || '')
    setImage(getTag('image') || '')
    if (pubAtNum && !Number.isNaN(pubAtNum)) {
      setPublishedAt(pubAtNum)
      setPublishedAtInput(new Date(pubAtNum * 1000).toISOString().slice(0, 16))
    }
    const hashTags = existingEvent.tags.filter((tag) => tag[0] === 't').map((tag) => tag[1])
    if (hashTags.length) {
      setHashtagsText(hashTags.join(', '))
    }
    setContent(existingEvent.content || '')
  }, [existingEvent, cacheKey])

  useEffect(() => {
    const payload = {
      title,
      identifier,
      summary,
      image,
      hashtagsText,
      content,
      publishedAt
    }
    try {
      localStorage.setItem(cacheKey, JSON.stringify(payload))
    } catch (e) {
      console.error('Failed to cache article editor state', e)
    }
  }, [title, identifier, summary, image, hashtagsText, content, publishedAt, cacheKey])

  const canPublish = useMemo(() => {
    return (
      !!title.trim() &&
      !!identifier.trim() &&
      !!content.trim() &&
      !posting &&
      !savingDraft &&
      !uploadProgresses.length
    )
  }, [title, identifier, content, posting, savingDraft, uploadProgresses.length])

  const hashtags = useMemo(
    () =>
      hashtagsText
        .split(',')
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean),
    [hashtagsText]
  )

  const buildDraft = (isDraft: boolean) => {
    const base = createLongFormDraftEvent(
      {
        title: title.trim(),
        content,
        summary: summary.trim(),
        image: image.trim(),
        identifier: identifier.trim(),
        hashtags,
        publishedAt: isDraft ? undefined : publishedAt ?? Math.floor(Date.now() / 1000),
        extraTags
      },
      {
        isDraft,
        existingEvent
      }
    )
    postEditorCache.clearPostCache({ defaultContent: 'article' })
    return base
  }

  const publishDraft = async (isDraft: boolean) => {
    await checkLogin(async () => {
      if (!canPublish) return
      isDraft ? setSavingDraft(true) : setPosting(true)
      try {
        const draftEvent = buildDraft(isDraft)
        let newEvent
        if (onPublish) {
          await onPublish(draftEvent, { isDraft, relayUrls: additionalRelayUrls })
        } else {
          newEvent = await publish(draftEvent, {
            specifiedRelayUrls: isProtectedEvent ? additionalRelayUrls : undefined,
            additionalRelayUrls
          })
        }
        let description: string | undefined
        try {
          const dTag = (newEvent as Event | undefined)?.tags.find((tag) => tag[0] === 'd')?.[1] || identifier
          if (newEvent) {
            const naddr = nip19.naddrEncode({
              kind: 30023,
              pubkey: (newEvent as Event).pubkey,
              identifier: dTag,
              relays: []
            })
            description = naddr
          }
        } catch (e) {
          console.warn('Failed to encode naddr', e)
        }
        toast.success(isDraft ? t('Draft saved') : t('Article published'), {
          description
        })
        close()
        return newEvent
      } catch (error) {
        const errors = error instanceof AggregateError ? error.errors : [error]
        errors.forEach((err) => {
          toast.error(
            `${t('Failed to post')}: ${err instanceof Error ? err.message : String(err)}`,
            { duration: 10_000 }
          )
          console.error(err)
        })
      } finally {
        setSavingDraft(false)
        setPosting(false)
      }
    })
  }

  const handleUploadStart = (file: File, cancel: () => void) => {
    setUploadProgresses((prev) => [...prev, { file, progress: 0, cancel }])
  }

  const handleUploadProgress = (file: File, progress: number) => {
    setUploadProgresses((prev) =>
      prev.map((item) => (item.file === file ? { ...item, progress } : item))
    )
  }

  const handleUploadEnd = (file: File) => {
    setUploadProgresses((prev) => prev.filter((item) => item.file !== file))
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant={showPreview ? 'outline' : 'secondary'}
            size="sm"
            onClick={() => setShowPreview(false)}
          >
            {t('Edit')}
          </Button>
          <Button
            variant={showPreview ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => setShowPreview(true)}
          >
            {t('Preview')}
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="article-title">{t('Title')}</Label>
          <Input
            id="article-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('Enter a title') || 'Enter a title'}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="article-identifier">{t('Identifier')}</Label>
          <Input
            id="article-identifier"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder={t('Unique identifier') || 'Unique identifier'}
          />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="article-summary">{t('Summary')}</Label>
          <Textarea
            id="article-summary"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder={t('Optional summary') || 'Optional summary'}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="article-image">{t('Image URL')}</Label>
          <Input
            id="article-image"
            value={image}
            onChange={(e) => setImage(e.target.value)}
            placeholder="https://"
          />
          <div className="space-y-2">
            <Label htmlFor="article-published-at">{t('Published at')}</Label>
            <Input
              id="article-published-at"
              type="datetime-local"
              value={publishedAtInput}
              onChange={(e) => {
                const val = e.target.value
                setPublishedAtInput(val)
                if (!val) {
                  setPublishedAt(undefined)
                  return
                }
                const ts = Math.floor(new Date(val).getTime() / 1000)
                if (!Number.isNaN(ts)) {
                  setPublishedAt(ts)
                }
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="article-hashtags">{t('Hashtags')}</Label>
            <Input
              id="article-hashtags"
              value={hashtagsText}
              onChange={(e) => setHashtagsText(e.target.value)}
              placeholder={t('Comma separated') || 'Comma separated'}
            />
          </div>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="article-content">{t('Content')}</Label>
        <ArticleMarkdownEditor value={content} onChange={setContent} showPreview={showPreview} />
      </div>
      {uploadProgresses.length > 0 &&
        uploadProgresses.map(({ file, progress, cancel }, index) => (
          <div key={`${file.name}-${index}`} className="mt-2 flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs text-muted-foreground mb-1">
                {file.name ?? t('Uploading...')}
              </div>
              <div className="h-0.5 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary transition-[width] duration-200 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                cancel?.()
                handleUploadEnd(file)
              }}
              className="text-muted-foreground hover:text-foreground"
              title={t('Cancel')}
            >
              ×
            </button>
          </div>
        ))}
      <PostRelaySelector
        setIsProtectedEvent={setIsProtectedEvent}
        setAdditionalRelayUrls={setAdditionalRelayUrls}
        parentEvent={existingEvent}
        openFrom={openFrom}
      />
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex gap-2 items-center">
          <Uploader
            onUploadSuccess={({ url }) => {
              setContent((prev) => `${prev}\n${url}`)
            }}
            onUploadStart={handleUploadStart}
            onUploadEnd={handleUploadEnd}
            onProgress={handleUploadProgress}
            accept="image/*,video/*,audio/*"
          >
            <Button variant="ghost" size="icon">
              <ImageUp />
            </Button>
          </Uploader>
          {!supportTouch && (
            <EmojiPickerDialog
              onEmojiClick={(emoji) => {
                if (!emoji) return
                setContent((prev) =>
                  `${prev} ${typeof emoji === 'string' ? emoji : `:${emoji.shortcode}:`}`.trim()
                )
              }}
            >
              <Button variant="ghost" size="icon">
                <Smile />
              </Button>
            </EmojiPickerDialog>
          )}
          <Mentions content={content} mentions={mentions} setMentions={setMentions} />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={(e) => { e.stopPropagation(); close() }}>
            {t('Cancel')}
          </Button>
          <Button
            variant="outline"
            disabled={!canPublish || savingDraft}
            onClick={(e) => {
              e.stopPropagation()
              publishDraft(true)
            }}
          >
            {savingDraft && <LoaderCircle className="animate-spin mr-2 h-4 w-4" />}
            {t('Save Draft')}
          </Button>
          <Button disabled={!canPublish || posting} onClick={(e) => { e.stopPropagation(); publishDraft(false) }}>
            {posting && <LoaderCircle className="animate-spin mr-2 h-4 w-4" />}
            {t('Publish')}
          </Button>
        </div>
      </div>
    </div>
  )
}
