import { useEffect, useMemo, useRef, useState } from 'react'
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
import { Heart, MessageCircle, Plus, Send, Smile, X } from 'lucide-react'

type ReactionStat = { emoji: string; count: number; self: boolean }

function formatName(pubkey: string, myPubkey: string | null) {
  if (pubkey === myPubkey) return 'You'
  return pubkey
}

export function DMThread({ conversationId, myPubkey }: { conversationId: string; myPubkey: string | null }) {
  const { messenger, messages, conversations, ready, unsupportedReason } = useMessenger()
  const { isSmallScreen } = useScreenSize()
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [replyTarget, setReplyTarget] = useState<DMMessage | null>(null)
  const [reactionSendingId, setReactionSendingId] = useState<string | null>(null)
  const [localMessages, setLocalMessages] = useState<DMMessage[]>([])
  const [pickerOpen, setPickerOpen] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const conversation = useMemo(
    () => conversations.find((c) => c.id === conversationId) || null,
    [conversations, conversationId]
  )

  useEffect(() => {
    if (!messenger || !conversationId) return
    messenger.getConversationMessages(conversationId).then((msgs) => setLocalMessages(msgs))
    messenger.markConversationRead(conversationId)
  }, [messenger, conversationId])

  useEffect(() => {
    const newMsgs = messages[conversationId]
    if (newMsgs) {
      setLocalMessages(newMsgs)
    }
  }, [messages, conversationId])

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [localMessages.length])

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
    } catch (err) {
      console.error('Failed to send DM', err)
    } finally {
      setSending(false)
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
      <div ref={listRef} className="flex-1 overflow-y-auto space-y-3 px-3 py-2">
        {localMessages.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            myPubkey={myPubkey}
            onReply={() => setReplyTarget(m)}
            replyTarget={replyTarget}
            onReact={(emoji) => handleReact(m, emoji)}
            reactionSendingId={reactionSendingId}
            reactions={collectReactions(localMessages, m.id, myPubkey)}
            pickerOpen={pickerOpen === m.id}
            setPickerOpen={(open) => setPickerOpen(open ? m.id : null)}
          />
        ))}
        {localMessages.length === 0 && (
          <div className="text-sm text-muted-foreground text-center py-6">No messages yet.</div>
        )}
      </div>

      <ChatComposer
        isSmallScreen={isSmallScreen}
        draft={draft}
        setDraft={setDraft}
        onSend={handleSend}
        sending={sending}
        replyTarget={replyTarget}
        clearReply={() => setReplyTarget(null)}
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
  setPickerOpen
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
}) {
  const mine = message.sender.pubkey === myPubkey
  const bubbleClasses = mine
    ? 'bg-primary/10 border-primary/30 ml-auto'
    : 'bg-muted/60 border-muted-foreground/20 mr-auto'

  return (
    <div className={cn('flex w-full gap-2', mine ? 'justify-end' : 'justify-start')}>
      {!mine && <SimpleUserAvatar userId={message.sender.pubkey} size="small" />}
      <div className={cn('max-w-[80%] space-y-2')}>
        <div
          className={cn(
            'rounded-2xl border px-3 py-2 shadow-sm',
            bubbleClasses,
            'flex flex-col gap-1'
          )}
        >
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{formatName(message.sender.pubkey, myPubkey)}</span>
            <span>{new Date(message.timestamp * 1000).toLocaleString()}</span>
          </div>
          {message.replyTo && (
            <div className="text-[11px] text-muted-foreground">
              Replying to <span className="font-mono">{message.replyTo}</span>
            </div>
          )}
          <div className="text-sm whitespace-pre-wrap">
            {message.type === 'reaction' ? `Reaction: ${message.content}` : message.content || 'Encrypted message'}
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
  clearReply
}: {
  isSmallScreen: boolean
  draft: string
  setDraft: (v: string) => void
  onSend: () => void
  sending: boolean
  replyTarget: DMMessage | null
  clearReply: () => void
}) {
  if (isSmallScreen) {
    return (
      <div className="sticky bottom-0 left-0 right-0 bg-background px-3 py-2 border-t space-y-2">
        {replyTarget && (
          <div className="flex items-center justify-between text-xs text-muted-foreground px-2">
            <span>Replying to {replyTarget.id}</span>
            <Button variant="ghost" size="sm" onClick={clearReply}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <MobileActionsMenu onSelect={() => {}} />
          <div className="flex-1">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Message"
              className="min-h-[40px] max-h-40 resize-none rounded-2xl"
              rows={1}
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
          <span>Replying to {replyTarget.id}</span>
          <Button variant="ghost" size="sm" onClick={clearReply}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}
      <div className="rounded-lg border bg-muted/30 p-3 space-y-2 shadow-sm">
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Button variant="ghost" size="icon" className="rounded-full" title="Media">
            <Plus className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="rounded-full" title="Emoji">
            <Smile className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="rounded-full" title="Poll">
            <MessageCircle className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="rounded-full" title="Settings">
            <Heart className="h-4 w-4" />
          </Button>
        </div>
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Type a message"
          className="min-h-[80px] max-h-60 resize-none"
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

function MobileActionsMenu({ onSelect }: { onSelect: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full">
          <Plus className="h-5 w-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="flex flex-col p-2 space-y-1 w-32">
        {['Media', 'Emoji', 'Poll', 'Settings'].map((label) => (
          <Button
            key={label}
            variant="ghost"
            className="justify-start"
            onClick={() => {
              onSelect()
              setOpen(false)
            }}
          >
            {label}
          </Button>
        ))}
      </PopoverContent>
    </Popover>
  )
}
