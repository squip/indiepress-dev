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

  // Layout instrumentation: log scroll parents and sticky positions on desktop.
  useEffect(() => {
    if (isSmallScreen) return
    if (typeof window === 'undefined') return

    const root = document.querySelector('[data-post-editor-scroll]') as HTMLElement | null
    const viewport =
      root?.querySelector('[data-radix-scroll-area-viewport]') ||
      root?.querySelector('[data-viewport]') ||
      null
    const tabs = document.querySelector('[data-post-editor-tabs]') as HTMLElement | null
    const toolbar = document.querySelector('.article-toolbar') as HTMLElement | null

    const findScrollParent = (el: HTMLElement | null): HTMLElement | null => {
      let node: HTMLElement | null = el
      while (node?.parentElement) {
        node = node.parentElement
        const style = getComputedStyle(node)
        if (/(auto|scroll)/.test(style.overflowY || style.overflow)) {
          return node
        }
      }
      return null
    }

    const logLayout = (label: string) => {
      const scrollParent = findScrollParent(tabs)
      const tabsRect = tabs?.getBoundingClientRect()
      const toolbarRect = toolbar?.getBoundingClientRect()
      const vpStyle = viewport ? getComputedStyle(viewport) : null
      const rootStyle = root ? getComputedStyle(root) : null
      const relaySelector = document.querySelector('[data-post-relay-selector]') as HTMLElement | null
      const cancelButton = document.querySelector('[data-post-cancel-button]') as HTMLElement | null
      const publishButton = document.querySelector('[data-post-publish-button]') as HTMLElement | null
      const relayRect = relaySelector?.getBoundingClientRect()
      const cancelRect = cancelButton?.getBoundingClientRect()
      const publishRect = publishButton?.getBoundingClientRect()
      // eslint-disable-next-line no-console
      console.log('[PostEditor] layout', {
        label,
        viewportOverflowY: vpStyle?.overflowY,
        rootOverflowY: rootStyle?.overflowY,
        scrollParent: scrollParent?.tagName,
        viewportScrollTop: viewport?.scrollTop ?? null,
        tabsTop: tabsRect?.top ?? null,
        toolbarTop: toolbarRect?.top ?? null,
        tabsPosition: tabs ? getComputedStyle(tabs).position : null,
        tabsTopStyle: tabs ? getComputedStyle(tabs).top : null,
        bodyScrollTop: document.scrollingElement?.scrollTop ?? null,
        relayTop: relayRect?.top ?? null,
        cancelTop: cancelRect?.top ?? null,
        publishTop: publishRect?.top ?? null
      })
    }

    const raf = requestAnimationFrame(() => logLayout('mount'))
    let loggedScroll = false
    const handleScroll = () => {
      if (!loggedScroll) {
        loggedScroll = true
      }
      logLayout('scroll')
    }
    const docScroll = () => logLayout('doc-scroll')
    viewport?.addEventListener('scroll', handleScroll, { passive: true })
    document.addEventListener('scroll', docScroll, { passive: true })
    return () => {
      cancelAnimationFrame(raf)
      viewport?.removeEventListener('scroll', handleScroll)
      document.removeEventListener('scroll', docScroll)
    }
  }, [isSmallScreen, tab])

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
          <div className="px-4 pt-4 space-y-2">
            <SheetHeader>
              {canToggleTabs ? (
                <Tabs
                  className="w-full"
                  value={tab}
                  onValueChange={(v) => setTab(v as 'post' | 'article')}
                >
                  <div className="sticky top-0 z-40 bg-background">
                    <TabsList
                      data-post-editor-tabs
                      className="bg-transparent p-0 h-auto gap-6 justify-start w-full"
                    >
                      <TabsTrigger
                        value="post"
                        className="rounded-none px-0 py-1 text-base font-semibold shadow-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:shadow-none text-muted-foreground"
                      >
                        {t('New Post')}
                      </TabsTrigger>
                      <TabsTrigger
                        value="article"
                        className="rounded-none px-0 py-1 text-base font-semibold shadow-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:shadow-none text-muted-foreground"
                      >
                        {t('New Article')}
                      </TabsTrigger>
                    </TabsList>
                  </div>
                </Tabs>
              ) : (
                <SheetTitle className="text-start">
                  <Title parentEvent={parentEvent} tab={tab} />
                </SheetTitle>
              )}
              {canToggleTabs && (
                <SheetTitle className="sr-only">
                  {tab === 'post' ? t('New Post') : t('New Article')}
                </SheetTitle>
              )}
              <SheetDescription className="hidden" />
            </SheetHeader>
          </div>
          <ScrollArea className="px-4 max-h-[calc(100vh-140px)]" allowStickyChildren data-post-editor-scroll>
            <div className="space-y-4 px-2 pt-9 pb-36">{content}</div>
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
        <div className="px-4 pt-4">
          <DialogHeader>
            {canToggleTabs ? (
              <DialogTitle className="w-full">
                <div className="sticky top-0 z-40 bg-background">
                  <Tabs
                    className="w-full"
                    value={tab}
                    onValueChange={(v) => setTab(v as 'post' | 'article')}
                  >
                    <TabsList
                      data-post-editor-tabs
                      className="bg-transparent p-0 h-auto gap-6 justify-start w-full"
                    >
                      <TabsTrigger
                        value="post"
                        className="rounded-none px-0 py-1 text-base font-semibold shadow-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:shadow-none text-muted-foreground"
                      >
                        {t('New Post')}
                      </TabsTrigger>
                      <TabsTrigger
                        value="article"
                        className="rounded-none px-0 py-1 text-base font-semibold shadow-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:shadow-none text-muted-foreground"
                      >
                        {t('New Article')}
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
              </DialogTitle>
            ) : (
              <DialogTitle>
                <Title parentEvent={parentEvent} tab={tab} />
              </DialogTitle>
            )}
            <DialogDescription className="hidden" />
          </DialogHeader>
        </div>
        <ScrollArea className="px-4 max-h-[calc(100vh-160px)]" allowStickyChildren data-post-editor-scroll>
          <div className="space-y-4 px-2 py-4 pt-9 pb-36">{content}</div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
