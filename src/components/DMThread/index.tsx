import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useMessenger } from '@/providers/MessengerProvider'
import { NDKUser } from '@nostr-dev-kit/ndk'
import type { DMMessage } from '@/lib/messaging/types'

function formatName(pubkey: string, myPubkey: string | null) {
  if (pubkey === myPubkey) return 'You'
  return pubkey
}

export function DMThread({ conversationId, myPubkey }: { conversationId: string; myPubkey: string | null }) {
  const { messenger, messages, conversations, ready, unsupportedReason } = useMessenger()
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [replyTarget, setReplyTarget] = useState<DMMessage | null>(null)
  const [reactionSendingId, setReactionSendingId] = useState<string | null>(null)
  const [localMessages, setLocalMessages] = useState<DMMessage[]>([])

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
      <div className="flex-1 overflow-y-auto space-y-2 border rounded-md p-3 bg-muted/30">
        {localMessages.map((m) => (
          <div key={m.id} className="border rounded-md p-2 bg-background space-y-2">
            <div className="text-xs text-muted-foreground flex justify-between">
              <span>{formatName(m.sender.pubkey, myPubkey)}</span>
              <span>{new Date(m.timestamp * 1000).toLocaleString()}</span>
            </div>
            {m.replyTo && (
              <div className="text-xs text-muted-foreground">
                Reply to: <span className="font-mono">{m.replyTo}</span>
              </div>
            )}
            <div className="text-sm whitespace-pre-wrap mt-1">
              {m.type === 'reaction' ? `Reaction: ${m.content}` : m.content}
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={replyTarget?.id === m.id ? 'secondary' : 'ghost'}
                onClick={() => setReplyTarget(replyTarget?.id === m.id ? null : m)}
              >
                {replyTarget?.id === m.id ? 'Cancel reply' : 'Reply'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={reactionSendingId === m.id}
                onClick={() => handleReact(m)}
              >
                {reactionSendingId === m.id ? 'Reacting…' : '👍 React'}
              </Button>
            </div>
          </div>
        ))}
        {localMessages.length === 0 && (
          <div className="text-sm text-muted-foreground">No messages yet.</div>
        )}
      </div>
      <div className="space-y-2">
        {replyTarget && (
          <div className="text-xs text-muted-foreground flex items-center gap-2">
            Replying to <span className="font-mono">{replyTarget.id}</span>
            <Button variant="ghost" size="sm" onClick={() => setReplyTarget(null)}>
              Clear
            </Button>
          </div>
        )}
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Type a message"
          rows={3}
        />
        <div className="flex justify-end">
          <Button onClick={handleSend} disabled={sending || !draft.trim()}>
            Send
          </Button>
        </div>
      </div>
    </div>
  )
}
