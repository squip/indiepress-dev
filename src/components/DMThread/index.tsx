
import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction
} from 'react'
import mediaUploadService from '@/services/media-upload.service'
import * as nip19 from '@nostr/tools/nip19'
import { Button } from '@/components/ui/button'
import { useMessenger } from '@/providers/MessengerProvider'
import { NDKUser } from '@nostr-dev-kit/ndk'
import type { DMMessage } from '@/lib/messaging/types'
import { cn } from '@/lib/utils'
import { SimpleUserAvatar } from '@/components/UserAvatar'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import EmojiPicker from '@/components/EmojiPicker'
import Content from '@/components/Content'
import { useFetchProfile } from '@/hooks'
import {
  Image as ImageIcon,
  Smile,
  Send,
  ChevronDown,
  Heart,
  MessageCircle,
  X,
  Plus
} from 'lucide-react'
import PostTextarea, { TPostTextareaHandle } from '@/components/PostEditor/PostTextarea'

const debug = (...args: any[]) => console.debug('[DMThread]', ...args)

function shortNpub(pubkey: string) {
  try {
    const npub = nip19.npubEncode(pubkey)
    return `${npub.slice(0, 6)}…${npub.slice(-4)}`
  } catch {
    return `${pubkey.slice(0, 6)}…${pubkey.slice(-4)}`
  }
}

function formatName(pubkey: string, myPubkey: string | null) {
  if (pubkey === myPubkey) return 'You'
  return shortNpub(pubkey)
}

type ReactionStat = { emoji: string; count: number; self: boolean }

function mergeMessagesById(existing: DMMessage[], incoming: DMMessage | DMMessage[]) {
  const list = Array.isArray(incoming) ? incoming : [incoming]
  const map = new Map<string, DMMessage>()
  existing.forEach((m) => map.set(m.id, m))
  list.forEach((m) => map.set(m.id, m))
  return Array.from(map.values()).sort((a, b) => a.timestamp - b.timestamp)
}

export function DMThread({ conversationId, myPubkey }: { conversationId: string; myPubkey: string | null }) {
  const { messenger, conversations, ready, unsupportedReason, drainBufferedMessages } = useMessenger()
  const { isSmallScreen } = useScreenSize()
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [replyTarget, setReplyTarget] = useState<DMMessage | null>(null)
  const [reactionSendingId, setReactionSendingId] = useState<string | null>(null)
  const [localMessages, setLocalMessages] = useState<DMMessage[]>([])
  const [pickerOpen, setPickerOpen] = useState<string | null>(null)
  const [showScrollBottom, setShowScrollBottom] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [nearBottom, setNearBottom] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const [anchored, setAnchored] = useState(false)
  const prevLength = useRef(0)
  const anchorRetry = useRef<number | null>(null)
  const localCountRef = useRef(0)

  const conversation = useMemo(
    () => conversations.find((c) => c.id === conversationId) || null,
    [conversations, conversationId]
  )

  useEffect(() => {
    if (!messenger || !conversationId) return
    let cancelled = false
    const load = async () => {
      debug('fetch messages (init)', { conversationId })
      await messenger.syncRecent(conversationId)
      const msgs = await messenger.getConversationMessages(conversationId)
      const buffered = drainBufferedMessages(conversationId)
      const merged = [...msgs, ...buffered]
        .reduce<Map<string, DMMessage>>((map, msg) => map.set(msg.id, msg), new Map())
      const mergedList = Array.from(merged.values()).sort((a, b) => a.timestamp - b.timestamp)
      if (cancelled) return
      debug('initial messages', { conversationId, count: mergedList.length, buffered: buffered.length })
      setLocalMessages(mergedList)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [messenger, conversationId])

  useEffect(() => {
    if (!messenger || !conversationId) return
    let cancelled = false
    const sync = async () => {
      await messenger.syncRecent(conversationId)
      const msgs = await messenger.getConversationMessages(conversationId)
      if (cancelled) return
      setLocalMessages((prev) => {
        const prevLast = prev.at(-1)?.id
        const nextLast = msgs.at(-1)?.id
        if (prev.length === msgs.length && prevLast === nextLast) return prev
        debug('periodic sync update', {
          conversationId,
          prev: prev.length,
          next: msgs.length,
          prevLast,
          nextLast
        })
        return msgs
      })
    }
    const id = window.setInterval(sync, 5000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [messenger, conversationId])

  useEffect(() => {
    localCountRef.current = localMessages.length
  }, [localMessages.length])

  useEffect(() => {
    if (!messenger) return
    debug('live listener attach', { conversationId })
    const off = messenger.on((event) => {
      if (event.type === 'message' && event.message.conversationId === conversationId) {
        debug('live event message', {
          id: event.message.id,
          ts: event.message.timestamp,
          read: event.message.read,
          localCount: localCountRef.current
        })
        setLocalMessages((prev) => mergeMessagesById(prev, event.message))
      }
    })
    return () => {
      debug('live listener detach', { conversationId })
      off?.()
    }
  }, [messenger, conversationId])

  useEffect(() => {
    if (localMessages.length !== prevLength.current) {
      debug('localMessages length change', {
        from: prevLength.current,
        to: localMessages.length,
        conversationId
      })
      setAnchored(false)
      prevLength.current = localMessages.length
    }
  }, [localMessages.length])

  const firstUnreadIdx = useMemo(
    () => localMessages.findIndex((m) => !m.read && m.sender.pubkey !== myPubkey),
    [localMessages, myPubkey]
  )

  const unreadCount = useMemo(
    () => localMessages.filter((m) => !m.read && m.sender.pubkey !== myPubkey).length,
    [localMessages, myPubkey]
  )

  const attemptAnchor = (attempt = 1) => {
    if (anchored) return
    if (!localMessages.length) return
    const hasReadMarker = !!conversation?.lastReadAt
    const targetMessage =
      unreadCount > 0 && firstUnreadIdx >= 0 && hasReadMarker
        ? localMessages[firstUnreadIdx]
        : localMessages.at(-1)
    if (!targetMessage) return
    const list = listRef.current
    if (!list) {
      debug('anchor attempt skipped - no list element', { conversationId })
      return
    }
    debug('anchor attempt', {
      conversationId,
      unreadCount,
      firstUnreadIdx,
      targetId: targetMessage.id,
      messages: localMessages.length,
      attempt,
      scrollTop: list.scrollTop,
      scrollHeight: list.scrollHeight,
      clientHeight: list.clientHeight
    })
    const scrolled =
      unreadCount > 0 && unreadCount > 10
        ? scrollToMessage(targetMessage.id, false)
        : scrollToBottom(false)
    const verify = () => {
      anchorRetry.current = null
      const listEl = listRef.current
      const targetVisible =
        unreadCount > 0 && unreadCount > 10
          ? isMessageVisible(targetMessage.id)
          : isNearBottom(listEl)
      debug('anchor verification', {
        conversationId,
        targetId: targetMessage.id,
        scrolled,
        targetVisible,
        scrollTop: listEl?.scrollTop,
        scrollHeight: listEl?.scrollHeight,
        clientHeight: listEl?.clientHeight,
        attempt
      })
      if (targetVisible) {
        if (scrolled && unreadCount > 0 && unreadCount <= 10) {
          messenger?.markConversationRead(conversationId)
        }
        setAnchored(true)
      } else if (attempt < 5) {
        anchorRetry.current = window.setTimeout(() => attemptAnchor(attempt + 1), 120)
      }
    }
    debug('anchor verify scheduled', { attempt })
    anchorRetry.current = window.setTimeout(verify, 16)
    // also try immediately in case refs are already ready
    verify()
  }

  useLayoutEffect(() => {
    attemptAnchor()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localMessages, firstUnreadIdx, anchored, unreadCount, messenger, conversationId, conversation?.lastReadAt])

  useEffect(() => {
    return () => {
      if (anchorRetry.current) clearTimeout(anchorRetry.current)
      anchorRetry.current = null
    }
  }, [])

  useEffect(() => {
    const el = getScrollElement()
    if (!el) return
    const handler = () => {
      const scrollEl = getScrollElement() as HTMLDivElement | null
      const isNear = scrollEl
        ? scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 120
        : false
      setNearBottom(isNear)
      setShowScrollBottom(unreadCount > 0 && !isNear)
      if (isNear && messenger && unreadCount > 0) {
        debug('scroll near bottom', { conversationId, unreadCount })
        messenger.markConversationRead(conversationId)
      }
    }
    handler()
    const target = getScrollElement()
    target?.addEventListener('scroll', handler)
    return () => target?.removeEventListener('scroll', handler)
  }, [messenger, conversationId, unreadCount])

  useEffect(() => {
    debug('showScrollBottom changed', { conversationId, showScrollBottom })
  }, [conversationId, showScrollBottom])

  useEffect(() => {
    // If we were anchored or already near bottom, keep snapping when new messages arrive
    if (!localMessages.length) return
    const scrollEl = getScrollElement()
    const wasNearBottom = isNearBottom(scrollEl)
    if (anchored || wasNearBottom) {
      scrollToBottom(false)
    }
  }, [localMessages.length])

  const handleSend = async () => {
    if (!messenger || !conversation || !draft.trim()) return
    setSending(true)
    try {
      debug('handleSend', { conversationId, draftLength: draft.length, replyTo: replyTarget?.id })
      const participants = conversation.participants.map((p) => new NDKUser({ pubkey: p }))
      const msgs = await messenger.sendMessage(participants, draft, {
        replyTo: replyTarget?.id
      })
      debug('handleSend result', { added: msgs.length })
      setLocalMessages((prev) => mergeMessagesById(prev, msgs))
      setDraft('')
      setReplyTarget(null)
      await messenger.markConversationRead(conversationId)
      scrollToBottom()
    } catch (err) {
      console.error('Failed to send DM', err)
      debug('handleSend error', err)
    } finally {
      setSending(false)
    }
  }

  const handleMediaUpload = async (file: File) => {
    setUploading(true)
    setUploadProgress(0)
    try {
      debug('media upload start', { name: file.name, size: file.size })
      const result = await mediaUploadService.upload(file, { onProgress: (p) => setUploadProgress(p) })
      const url = result.url
      setDraft((d) => `${d}${d ? ' ' : ''}${url}`)
    } catch (err) {
      console.error('Media upload failed', err)
      debug('media upload error', err)
    } finally {
      setUploading(false)
      setUploadProgress(null)
    }
  }

  const handleReact = async (message: DMMessage, emoji = '👍') => {
    if (!messenger || !conversation) return
    setReactionSendingId(message.id)
    try {
      debug('react start', { conversationId, messageId: message.id, emoji })
      const reaction = await messenger.sendReaction(conversation.id, message.id, emoji)
      if (reaction) {
        setLocalMessages((prev) => [...prev, reaction])
        debug('react persisted', { reactionId: reaction.id })
      }
    } catch (err) {
      console.error('Failed to send reaction', err)
      debug('react error', err)
    } finally {
      setReactionSendingId(null)
      setPickerOpen(null)
    }
  }

  const getScrollElement = (): HTMLElement | null => {
    const list = listRef.current
    if (!list) return (typeof document !== 'undefined' ? document.scrollingElement as HTMLElement | null : null)
    const viewport = list.closest('[data-radix-scroll-area-viewport]') as HTMLElement | null
    return viewport || list || (typeof document !== 'undefined' ? document.scrollingElement as HTMLElement | null : null)
  }

  const scrollToMessage = (id: string, smooth = true) => {
    const el = messageRefs.current.get(id)
    const list = getScrollElement()
    if (el && list) {
      const top = el.offsetTop - 24
      debug('scrollToMessage', { id, top, smooth })
      if ((list as any).scrollTo) {
        ;(list as any).scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' })
      } else {
        window.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' })
      }
      return true
    } else {
      debug('scrollToMessage missing ref', { id, hasEl: !!el, hasList: !!list })
      return false
    }
  }

  const scrollToBottom = (smooth = true) => {
    const list = getScrollElement()
    if (!list) {
      debug('scrollToBottom missing list')
      return false
    }
    debug('scrollToBottom', { scrollHeight: list.scrollHeight, smooth })
    if ((list as any).scrollTo) {
      ;(list as any).scrollTo({ top: list.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
    } else {
      window.scrollTo({ top: list.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
    }
    list.scrollTop = list.scrollHeight
    messenger?.markConversationRead(conversationId)
    return true
  }

  const isNearBottom = (list?: HTMLElement | null) => {
    if (!list) return false
    const distance = list.scrollHeight - list.scrollTop - list.clientHeight
    return distance < 80
  }

  const isMessageVisible = (id: string) => {
    const el = messageRefs.current.get(id)
    const list = getScrollElement()
    if (!el || !list) return false
    const top = el.offsetTop
    const bottom = top + el.offsetHeight
    const viewTop = list.scrollTop
    const viewBottom = list.scrollTop + list.clientHeight
    const visible = bottom <= viewBottom && top >= viewTop - 24
    debug('isMessageVisible', { id, visible, top, bottom, viewTop, viewBottom })
    return visible
  }

  if (unsupportedReason) {
    return <div className="p-4 text-sm text-muted-foreground">{unsupportedReason}</div>
  }

  if (!ready || !messenger) {
    return <div className="p-4 text-sm text-muted-foreground">Loading conversation…</div>
  }

  if (!conversation) {
    return <div className="p-4 text-sm text-muted-foreground">Conversation not found.</div>
  }

  return (
    <div className="flex flex-col h-full min-h-screen gap-3">
      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto space-y-3 px-3 py-2 relative">
        {localMessages.map((m, idx) => (
          <React.Fragment key={m.id}>
            {firstUnreadIdx === idx && unreadCount > 0 && (
              <UnreadDivider onClick={() => scrollToBottom()} disabled={nearBottom} />
            )}
            <MessageBubble
              messageRef={(el) => {
                if (!el) return
                const existing = messageRefs.current.get(m.id)
                if (existing === el) return
                messageRefs.current.set(m.id, el)
                debug('messageRef set', { id: m.id })
              }}
              message={m}
              myPubkey={myPubkey}
              onReply={() => setReplyTarget(m)}
              replyTarget={replyTarget}
              onReact={(emoji) => handleReact(m, emoji)}
              reactionSendingId={reactionSendingId}
              reactions={collectReactions(localMessages, m.id, myPubkey)}
              pickerOpen={pickerOpen === m.id}
              setPickerOpen={(open) => setPickerOpen(open ? m.id : null)}
              resolveReply={async (_id) => {
                debug('fetch messages (resolveReply)', { conversationId, replyId: _id })
                const msgs = await messenger.getConversationMessages(conversationId)
                setLocalMessages(msgs)
              }}
              allMessages={localMessages}
            />
          </React.Fragment>
        ))}
        {localMessages.length === 0 && (
          <div className="text-sm text-muted-foreground text-center py-6">No messages yet.</div>
        )}
        {showScrollBottom && (
          <div className="flex justify-center">
            <Button
              variant="secondary"
              size="sm"
              className="rounded-full shadow"
              onClick={() => scrollToBottom()}
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      <ChatComposer
        isSmallScreen={isSmallScreen}
        draft={draft}
        setDraft={setDraft}
        onSend={handleSend}
        sending={sending}
        replyTarget={replyTarget}
        myPubkey={myPubkey}
        clearReply={() => setReplyTarget(null)}
        onAddMedia={handleMediaUpload}
        uploading={uploading}
        uploadProgress={uploadProgress}
      />
    </div>
  )
}

function collectReactions(messages: DMMessage[], targetId: string, myPubkey: string | null) {
  const stats = new Map<string, { count: number; self: boolean }>()
  messages
    .filter((m) => m.type === 'reaction' && m.replyTo === targetId)
    .forEach((m) => {
      const key = m.content || '+'
      const prev = stats.get(key) || { count: 0, self: false }
      stats.set(key, { count: prev.count + 1, self: prev.self || m.sender.pubkey === myPubkey })
    })
  return Array.from(stats.entries()).map(([emoji, val]) => ({ emoji, ...val }))
}

function MessageBubble({
  message,
  myPubkey,
  onReply,
  replyTarget,
  onReact,
  reactions,
  reactionSendingId,
  pickerOpen,
  setPickerOpen,
  messageRef,
  resolveReply,
  allMessages
}: {
  message: DMMessage
  myPubkey: string | null
  onReply: () => void
  replyTarget: DMMessage | null
  onReact: (emoji: string) => void
  reactions: ReactionStat[]
  reactionSendingId: string | null
  pickerOpen: boolean
  setPickerOpen: (open: boolean) => void
  messageRef: (el: HTMLDivElement | null) => void
  resolveReply: (id: string) => void
  allMessages: DMMessage[]
}) {
  const mine = message.sender.pubkey === myPubkey
  const bubbleClasses = mine
    ? 'bg-primary/10 border-primary/30 ml-auto'
    : 'bg-muted/60 border-muted-foreground/20 mr-auto'

  const { profile } = useFetchProfile(message.sender.pubkey)

  const replyMessage = useMemo(() => {
    if (!message.replyTo) return null
    return allMessages.find((m) => m.id === message.replyTo) || null
  }, [allMessages, message.replyTo])

  const { profile: replyProfile } = useFetchProfile(replyMessage?.sender.pubkey || '')

  const attemptedResolve = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (message.replyTo && !replyMessage && !attemptedResolve.current.has(message.replyTo)) {
      attemptedResolve.current.add(message.replyTo)
      resolveReply(message.replyTo)
    }
  }, [message.replyTo, replyMessage, resolveReply])

  const displayName = (pubkey: string, prof?: any) => {
    if (pubkey === myPubkey) return 'You'
    if (prof?.shortName) return prof.shortName
    return shortNpub(pubkey)
  }

  return (
    <div className={cn('flex w-full gap-2', mine ? 'justify-end' : 'justify-start')} ref={messageRef}>
      {!mine && <SimpleUserAvatar userId={message.sender.pubkey} size="small" />}
      <div className={cn('max-w-[80%] space-y-2')}>
        <div
          className={cn(
            'rounded-2xl border px-3 py-2 shadow-sm',
            bubbleClasses,
            'flex flex-col gap-2'
          )}
        >
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{displayName(message.sender.pubkey, profile)}</span>
            <span>{new Date(message.timestamp * 1000).toLocaleString()}</span>
          </div>
          {message.replyTo && (
            <div className="text-[11px] text-muted-foreground border-l pl-2">
              {replyMessage ? (
                <>
                  <div className="font-semibold text-foreground/80 text-xs">
                    {displayName(replyMessage.sender.pubkey, replyProfile)}
                  </div>
                  <div className="text-sm line-clamp-2">
                    <Content content={replyMessage.content || 'Encrypted message'} />
                  </div>
                </>
              ) : (
                <div className="text-xs">Referenced message not loaded</div>
              )}
            </div>
          )}
          <div className="text-sm whitespace-pre-wrap space-y-2">
            <Content content={message.content || ''} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            className={cn(
              'flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors',
              replyTarget?.id === message.id && 'text-primary font-medium'
            )}
            onClick={() => onReply()}
          >
            <MessageCircle className="h-4 w-4" />
            Reply
          </button>
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <button
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                disabled={reactionSendingId === message.id}
              >
                <Heart className="h-4 w-4" />
                React
              </button>
            </PopoverTrigger>
            <PopoverContent className="p-0" align="start">
              <EmojiPicker
                onEmojiClick={(emoji) => {
                  if (emoji) onReact(typeof emoji === 'string' ? emoji : (emoji as any).native || '+')
                }}
              />
            </PopoverContent>
          </Popover>
          <div className="flex gap-1 flex-wrap">
            {reactions.map((r) => (
              <button
                key={r.emoji}
                className={cn(
                  'flex items-center gap-1 px-2 py-1 rounded-full border text-xs',
                  r.self ? 'border-primary text-primary bg-primary/10' : 'text-muted-foreground'
                )}
                onClick={() => onReact(r.emoji)}
              >
                <span>{r.emoji}</span>
                <span>{r.count}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      {mine && <SimpleUserAvatar userId={message.sender.pubkey} size="small" />}
    </div>
  )
}

function ChatComposer({
  isSmallScreen,
  draft,
  setDraft,
  onSend,
  sending,
  replyTarget,
  myPubkey,
  clearReply,
  onAddMedia,
  uploading,
  uploadProgress
}: {
  isSmallScreen: boolean
  draft: string
  setDraft: Dispatch<SetStateAction<string>>
  onSend: () => void
  sending: boolean
  replyTarget: DMMessage | null
  myPubkey: string | null
  clearReply: () => void
  onAddMedia: (file: File) => void
  uploading: boolean
  uploadProgress: number | null
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const editorRef = useRef<TPostTextareaHandle | null>(null)

  useEffect(() => {
    debug('composer render', { isSmallScreen, draftLength: draft.length, replyTarget: replyTarget?.id })
  }, [isSmallScreen, draft.length, replyTarget?.id])

  const handleMediaClick = () => {
    if (!fileInputRef.current) {
      fileInputRef.current = document.createElement('input')
      fileInputRef.current.type = 'file'
      fileInputRef.current.onchange = (e: any) => {
        const file = e.target.files?.[0]
        if (file) {
          onAddMedia(file)
        }
      }
    }
    fileInputRef.current.click()
  }

  const handleAddEmoji = (emoji: string) => {
    if (editorRef.current) {
      editorRef.current.insertEmoji(emoji)
    } else {
      setDraft((d) => `${d}${emoji}`)
    }
  }

  const emojiButton = (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" title="Emoji">
          <Smile className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0" align="start">
        <EmojiPicker
          onEmojiClick={(emoji) => {
            if (emoji) handleAddEmoji(typeof emoji === 'string' ? emoji : (emoji as any).native || '+')
          }}
        />
      </PopoverContent>
    </Popover>
  )

  if (isSmallScreen) {
    return (
      <div className="sticky bottom-0 left-0 right-0 bg-background px-3 py-2 border-t space-y-2">
        {replyTarget && (
          <div className="flex items-center justify-between text-xs text-muted-foreground px-2">
            <span>Replying to {formatName(replyTarget.sender.pubkey, myPubkey)}: {replyTarget.content || 'Encrypted message'}</span>
            <Button variant="ghost" size="sm" onClick={clearReply}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-full">
                <Plus className="h-5 w-5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="flex flex-col p-2 space-y-1 w-44">
              <Button variant="ghost" className="justify-start" onClick={handleMediaClick}>
                Media
              </Button>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" className="justify-start">
                    Emoji
                  </Button>
                </PopoverTrigger>
                  <PopoverContent className="p-0" align="start">
                    <EmojiPicker
                      onEmojiClick={(emoji) => {
                      if (emoji) handleAddEmoji(typeof emoji === 'string' ? emoji : (emoji as any).native || '+')
                    }}
                  />
                </PopoverContent>
              </Popover>
            </PopoverContent>
          </Popover>
        <div className="flex-1">
          <PostTextarea
            ref={editorRef}
            text={draft}
            setText={setDraft}
            onSubmit={onSend}
            className="min-h-[40px] rounded-2xl"
            submitOnEnter={!isSmallScreen}
            hidePreviewToggle
          />
        </div>
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full"
            disabled={sending || !draft.trim()}
            onClick={onSend}
          >
            <Send className="h-5 w-5" />
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="sticky bottom-0 left-0 right-0 bg-background border-t px-3 py-3 space-y-2">
      {replyTarget && (
        <div className="flex items-center justify-between text-xs text-muted-foreground px-2">
          <span>Replying to {formatName(replyTarget.sender.pubkey, myPubkey)}: {replyTarget.content || 'Encrypted message'}</span>
          <Button variant="ghost" size="sm" onClick={clearReply}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}
      <div className="rounded-lg border bg-muted/30 p-3 space-y-2 shadow-sm">
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Button variant="ghost" size="icon" className="rounded-full" title="Media" onClick={handleMediaClick}>
            <ImageIcon className="h-4 w-4" />
          </Button>
          {emojiButton}
        </div>
        {uploading && (
          <div className="text-xs text-muted-foreground flex items-center gap-2 px-1">
            <span>Uploading…</span>
            {uploadProgress !== null && <span>{Math.round(uploadProgress)}%</span>}
          </div>
        )}
        <PostTextarea
          ref={editorRef}
          text={draft}
          setText={setDraft}
          onSubmit={onSend}
          className="min-h-[80px]"
          submitOnEnter={!isSmallScreen}
          hidePreviewToggle
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDraft('')}>
            Cancel
          </Button>
          <Button onClick={onSend} disabled={sending || !draft.trim()}>
            {sending ? 'Sending…' : 'Send'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function UnreadDivider({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-center py-1">
      {disabled ? (
        <div className="text-xs text-muted-foreground px-3 py-1 rounded-full border bg-muted/40">
          Unread messages
        </div>
      ) : (
        <Button variant="secondary" size="sm" className="rounded-full" onClick={onClick}>
          <ChevronDown className="h-4 w-4" />
          <span className="ml-1">Jump to bottom</span>
        </Button>
      )}
    </div>
  )
}
