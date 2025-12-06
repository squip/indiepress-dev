
import React, { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import mediaUploadService from '@/services/media-upload.service'
import * as nip19 from '@nostr/tools/nip19'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
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
import client from '@/services/client.service'
import { NostrUser } from '@nostr/gadgets/metadata'
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

export function DMThread({ conversationId, myPubkey }: { conversationId: string; myPubkey: string | null }) {
  const { messenger, messages, conversations, ready, unsupportedReason } = useMessenger()
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
  const listRef = useRef<HTMLDivElement>(null)
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const [anchored, setAnchored] = useState(false)

  const conversation = useMemo(
    () => conversations.find((c) => c.id === conversationId) || null,
    [conversations, conversationId]
  )

  useEffect(() => {
    if (!messenger || !conversationId) return
    messenger.getConversationMessages(conversationId).then((msgs) => setLocalMessages(msgs))
  }, [messenger, conversationId])

  useEffect(() => {
    const newMsgs = messages[conversationId]
    if (newMsgs) {
      setLocalMessages(newMsgs)
    }
  }, [messages, conversationId])

  const firstUnreadIdx = useMemo(
    () => localMessages.findIndex((m) => !m.read && m.sender.pubkey !== myPubkey),
    [localMessages, myPubkey]
  )

  const unreadCount = useMemo(
    () => localMessages.filter((m) => !m.read && m.sender.pubkey !== myPubkey).length,
    [localMessages, myPubkey]
  )

  useEffect(() => {
    if (anchored) return
    if (!localMessages.length) return
    const showDivider = firstUnreadIdx >= 0 && unreadCount > 10
    const targetId = showDivider
      ? localMessages[firstUnreadIdx]?.id
      : localMessages.at(-1)?.id
    if (!targetId) return
    requestAnimationFrame(() => {
      scrollToMessage(targetId, false)
      setAnchored(true)
    })
  }, [localMessages, firstUnreadIdx, anchored, unreadCount])

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const handler = () => {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
      setShowScrollBottom(!nearBottom)
      if (nearBottom && messenger) {
        messenger.markConversationRead(conversationId)
      }
    }
    handler()
    el.addEventListener('scroll', handler)
    return () => el.removeEventListener('scroll', handler)
  }, [messenger, conversationId])

  const handleSend = async () => {
    if (!messenger || !conversation || !draft.trim()) return
    setSending(true)
    try {
      const participants = conversation.participants.map((p) => new NDKUser({ pubkey: p }))
      const msgs = await messenger.sendMessage(participants, draft, {
        replyTo: replyTarget?.id
      })
      setLocalMessages((prev) => [...prev, ...msgs])
      setDraft('')
      setReplyTarget(null)
      await messenger.markConversationRead(conversationId)
      scrollToBottom()
    } catch (err) {
      console.error('Failed to send DM', err)
    } finally {
      setSending(false)
    }
  }

  const handleMediaUpload = async (file: File) => {
    setUploading(true)
    setUploadProgress(0)
    try {
      const result = await mediaUploadService.upload(file, { onProgress: (p) => setUploadProgress(p) })
      const url = result.url
      setDraft((d) => `${d}${d ? ' ' : ''}${url}`)
    } catch (err) {
      console.error('Media upload failed', err)
    } finally {
      setUploading(false)
      setUploadProgress(null)
    }
  }

  const handleReact = async (message: DMMessage, emoji = '👍') => {
    if (!messenger || !conversation) return
    setReactionSendingId(message.id)
    try {
      const reaction = await messenger.sendReaction(conversation.id, message.id, emoji)
      if (reaction) {
        setLocalMessages((prev) => [...prev, reaction])
      }
    } catch (err) {
      console.error('Failed to send reaction', err)
    } finally {
      setReactionSendingId(null)
      setPickerOpen(null)
    }
  }

  const scrollToMessage = (id: string, smooth = true) => {
    const el = messageRefs.current.get(id)
    const list = listRef.current
    if (el && list) {
      const top = el.offsetTop - 24
      list.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' })
    }
  }

  const scrollToBottom = (smooth = true) => {
    const list = listRef.current
    if (!list) return
    list.scrollTo({ top: list.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
    messenger?.markConversationRead(conversationId)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !isSmallScreen) {
      e.preventDefault()
      handleSend()
    }
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
    <div className="flex flex-col h-full gap-3">
      <div ref={listRef} className="flex-1 overflow-y-auto space-y-3 px-3 py-2 relative">
        {localMessages.map((m, idx) => (
          <React.Fragment key={m.id}>
            {firstUnreadIdx === idx && unreadCount > 10 && (
              <UnreadDivider onClick={() => scrollToBottom()} />
            )}
            <MessageBubble
              messageRef={(el) => el && messageRefs.current.set(m.id, el)}
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
        {showScrollBottom && firstUnreadIdx < 0 && (
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
      onKeyDown={handleKeyDown}
      onAddMedia={handleMediaUpload}
      onAddEmoji={(emoji) => setDraft((d) => `${d}${emoji}`)}
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

  useEffect(() => {
    if (message.replyTo && !replyMessage) {
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
  onKeyDown,
  onAddMedia,
  onAddEmoji,
  uploading,
  uploadProgress
}: {
  isSmallScreen: boolean
  draft: string
  setDraft: (v: string) => void
  onSend: () => void
  sending: boolean
  replyTarget: DMMessage | null
  myPubkey: string | null
  clearReply: () => void
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void
  onAddMedia: (file: File) => void
  onAddEmoji: (emoji: string) => void
  uploading: boolean
  uploadProgress: number | null
}) {
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionResults, setMentionResults] = useState<NostrUser[]>([])
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const mentionRequest = useRef<number>(0)

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

  useEffect(() => {
    const match = draft.match(/@([\w\.-]{1,32})$/)
    if (!match) {
      setMentionQuery('')
      setMentionResults([])
      return
    }
    const q = match[1]
    setMentionQuery(q)
    const reqId = ++mentionRequest.current
    client.searchProfilesFromLocal(q, 8).then((res) => {
      if (mentionRequest.current !== reqId) return
      setMentionResults(res)
    })
  }, [draft])

  const insertMention = (pubkey: string) => {
    const npub = nip19.npubEncode(pubkey)
    const token = `nostr:${npub}`
    const next = draft.replace(/@([\w\.-]{1,32})$/, `${token} `)
    setDraft(next)
    setMentionResults([])
    setMentionQuery('')
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
            if (emoji) onAddEmoji(typeof emoji === 'string' ? emoji : (emoji as any).native || '+')
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
                      if (emoji) onAddEmoji(typeof emoji === 'string' ? emoji : (emoji as any).native || '+')
                    }}
                  />
                </PopoverContent>
              </Popover>
            </PopoverContent>
          </Popover>
        <div className="flex-1">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Message"
            className="min-h-[40px] max-h-40 resize-none rounded-2xl"
            rows={1}
          />
          {mentionResults.length > 0 && (
            <div className="mt-1 rounded-md border bg-popover text-popover-foreground shadow">
              {mentionResults.map((res) => (
                <button
                  key={res.pubkey}
                  className="w-full text-left px-3 py-2 hover:bg-accent hover:text-accent-foreground flex items-center gap-2"
                  onClick={() => insertMention(res.pubkey)}
                >
                  <SimpleUserAvatar profile={res} size="small" />
                  <div className="truncate">{res?.shortName || shortNpub(res.pubkey)}</div>
                </button>
              ))}
            </div>
          )}
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
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Type a message"
          className="min-h-[80px] max-h-60 resize-none"
        />
        {mentionResults.length > 0 && mentionQuery && (
          <div className="rounded-md border bg-popover text-popover-foreground shadow max-h-64 overflow-y-auto">
            {mentionResults.map((res) => (
              <button
                key={res.pubkey}
                className="w-full text-left px-3 py-2 hover:bg-accent hover:text-accent-foreground flex items-center gap-2"
                onClick={() => insertMention(res.pubkey)}
              >
                <SimpleUserAvatar profile={res} size="small" />
                <div className="truncate">{res?.shortName || shortNpub(res.pubkey)}</div>
              </button>
            ))}
          </div>
        )}
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

function UnreadDivider({ onClick }: { onClick: () => void }) {
  return (
    <div className="flex items-center justify-center py-1">
      <Button variant="secondary" size="sm" className="rounded-full" onClick={onClick}>
        <ChevronDown className="h-4 w-4" />
        <span className="ml-1">Jump to bottom</span>
      </Button>
    </div>
  )
}
