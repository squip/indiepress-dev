import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import postEditor from '@/services/post-editor.service'
import { Event } from '@nostr/tools/wasm'
import { Dispatch, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import PostContent from './PostContent'
import ArticleContent from './ArticleContent'
import Title from './Title'

export default function PostEditor({
  defaultContent = '',
  parentEvent,
  open,
  setOpen,
  openFrom,
  defaultTab = 'post',
  articleOptions
}: {
  defaultContent?: string
  parentEvent?: Event
  open: boolean
  setOpen: Dispatch<boolean>
  openFrom?: string[]
  defaultTab?: 'post' | 'article'
  articleOptions?: {
    existingEvent?: Event
    extraTags?: string[][]
    onPublish?: (draftEvent: any, options: { isDraft: boolean; relayUrls: string[] }) => Promise<void>
  }
}) {
  const { isSmallScreen } = useScreenSize()
  const { t } = useTranslation()
  const canToggleTabs = !parentEvent
  const [tab, setTab] = useState<'post' | 'article'>(parentEvent ? 'post' : defaultTab)

  // Replies/quotes should never switch into article mode
  useEffect(() => {
    if (parentEvent && tab !== 'post') {
      setTab('post')
    }
  }, [parentEvent, tab])

  const content = useMemo(() => {
    if (parentEvent || tab === 'post') {
      return (
        <PostContent
          defaultContent={defaultContent}
          parentEvent={parentEvent}
          close={() => setOpen(false)}
          openFrom={openFrom}
        />
      )
    }
    return (
      <ArticleContent
        close={() => setOpen(false)}
        openFrom={openFrom}
        existingEvent={articleOptions?.existingEvent}
        extraTags={articleOptions?.extraTags}
        onPublish={articleOptions?.onPublish}
      />
    )
  }, [
    defaultContent,
    parentEvent,
    openFrom,
    setOpen,
    tab,
    articleOptions?.existingEvent,
    articleOptions?.extraTags,
    articleOptions?.onPublish
  ])

  if (isSmallScreen) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          className="h-full w-full p-0 border-none"
          side="bottom"
          hideClose
          onEscapeKeyDown={(e) => {
            if (postEditor.isSuggestionPopupOpen) {
              e.preventDefault()
              postEditor.closeSuggestionPopup()
            }
          }}
        >
          <ScrollArea className="px-4 h-full max-h-screen">
            <div className="space-y-4 px-2 py-6">
              <SheetHeader>
                {canToggleTabs ? (
                  <Tabs value={tab} onValueChange={(v) => setTab(v as 'post' | 'article')}>
                    <TabsList>
                      <TabsTrigger value="post">{t('New Post')}</TabsTrigger>
                      <TabsTrigger value="article">{t('New Article')}</TabsTrigger>
                    </TabsList>
                  </Tabs>
                ) : (
                  <SheetTitle className="text-start">
                    <Title parentEvent={parentEvent} tab={tab} />
                  </SheetTitle>
                )}
                <SheetDescription className="hidden" />
              </SheetHeader>
              {content}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className={`p-0 ${parentEvent || tab === 'post' ? 'max-w-2xl' : 'max-w-4xl'}`}
        withoutClose
        onEscapeKeyDown={(e) => {
          if (postEditor.isSuggestionPopupOpen) {
            e.preventDefault()
            postEditor.closeSuggestionPopup()
          }
        }}
      >
        <ScrollArea className="px-4 h-full max-h-screen">
          <div className="space-y-4 px-2 py-6">
            <DialogHeader>
              {canToggleTabs ? (
                <DialogTitle>
                  <Tabs value={tab} onValueChange={(v) => setTab(v as 'post' | 'article')}>
                    <TabsList>
                      <TabsTrigger value="post">{t('New Post')}</TabsTrigger>
                      <TabsTrigger value="article">{t('New Article')}</TabsTrigger>
                    </TabsList>
                  </Tabs>
                </DialogTitle>
              ) : (
                <DialogTitle>
                  <Title parentEvent={parentEvent} tab={tab} />
                </DialogTitle>
              )}
              <DialogDescription className="hidden" />
            </DialogHeader>
            {content}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
