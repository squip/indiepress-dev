import { useEffect, useMemo, useState } from 'react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'
import { useMessenger } from '@/providers/MessengerProvider'
import { NDKUser } from '@nostr-dev-kit/ndk'
import type { ConversationMeta, DMMessage } from '@/lib/messaging/types'

function deriveDisplayName(meta: ConversationMeta, myPubkey: string | null): string {
  if (meta.subject) return meta.subject
  const others = meta.participants.filter((p) => p !== myPubkey)
  if (others.length === 0) return 'Me'
  if (others.length === 1) return others[0]
  return `${others[0]} +${others.length - 1}`
}

export function DMConversationsView({ myPubkey }: { myPubkey: string | null }) {
  const { messenger, conversations, ready, unsupportedReason } = useMessenger()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [conversationMessages, setConversationMessages] = useState<Record<string, DMMessage[]>>({})
  const [newMembers, setNewMembers] = useState('')
  const [subject, setSubject] = useState('')
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (conversations.length && !selectedId) {
      setSelectedId(conversations[0].id)
    }
  }, [conversations, selectedId])

  useEffect(() => {
    if (!selectedId || !messenger) return
    messenger.getConversationMessages(selectedId).then((msgs) => {
      setConversationMessages((prev) => ({ ...prev, [selectedId]: msgs }))
    })
    messenger.markConversationRead(selectedId)
  }, [selectedId, messenger])

  const selectedConversation = useMemo(
    () => conversations.find((c) => c.id === selectedId) || null,
    [conversations, selectedId]
  )

  const handleSend = async () => {
    if (!messenger || !selectedConversation || !draft.trim()) return
    setSending(true)
    try {
      const participants = selectedConversation.participants.map((p) => new NDKUser({ pubkey: p }))
      const msgs = await messenger.sendMessage(participants, draft, { replyTo: undefined })
      setConversationMessages((prev) => {
        const list = prev[selectedConversation.id] || []
        return { ...prev, [selectedConversation.id]: [...list, ...msgs] }
      })
      setDraft('')
      await messenger.markConversationRead(selectedConversation.id)
    } catch (err) {
      console.error('Failed to send DM', err)
    } finally {
      setSending(false)
    }
  }

  const handleCreateConversation = async () => {
    if (!messenger) return
    const pubkeys = newMembers
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
    if (!pubkeys.length) return
    const participants = pubkeys.map((p) => new NDKUser({ pubkey: p }))
    setSending(true)
    try {
      const msgs = await messenger.sendMessage(participants, '(conversation created)', { subject })
      const convId =
        msgs[0]?.conversationId ||
        pubkeys.concat(myPubkey || '').sort().join(':')
      setSelectedId(convId)
      setNewMembers('')
      setSubject('')
    } catch (err) {
      console.error('Failed to create conversation', err)
    } finally {
      setSending(false)
    }
  }

  if (unsupportedReason) {
    return <div className="p-4 text-sm text-muted-foreground">{unsupportedReason}</div>
  }

  if (!ready || !messenger) {
    return <div className="p-4 text-sm text-muted-foreground">Loading conversations…</div>
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] gap-4 h-full">
      <div className="border rounded-lg p-3 space-y-3 overflow-y-auto">
        <div className="space-y-2">
          <Input
            value={newMembers}
            onChange={(e) => setNewMembers(e.target.value)}
            placeholder="Add recipients (comma-separated pubkeys)"
          />
          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject (optional)"
          />
          <Button onClick={handleCreateConversation} disabled={sending || !newMembers.trim()}>
            New conversation
          </Button>
        </div>
        <div className="text-xs font-semibold uppercase text-muted-foreground">Conversations</div>
        <div className="space-y-2">
          {conversations.map((c) => (
            <button
              key={c.id}
              className={`w-full text-left border rounded-md px-3 py-2 hover:bg-muted ${
                selectedId === c.id ? 'bg-muted' : ''
              }`}
              onClick={() => setSelectedId(c.id)}
            >
              <div className="flex items-center justify-between">
                <div className="font-medium">{deriveDisplayName(c, myPubkey)}</div>
                {c.unreadCount > 0 && (
                  <span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded-full">
                    {c.unreadCount}
                  </span>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                {c.participants.length} participant{c.participants.length === 1 ? '' : 's'}
              </div>
            </button>
          ))}
          {conversations.length === 0 && (
            <div className="text-sm text-muted-foreground">No conversations yet.</div>
          )}
        </div>
      </div>

      <div className="border rounded-lg p-3 flex flex-col min-h-[400px]">
        {selectedConversation ? (
          <>
            <div className="mb-2">
              <div className="font-semibold">
                {deriveDisplayName(selectedConversation, myPubkey)}
              </div>
              <div className="text-xs text-muted-foreground">
                {selectedConversation.participants.join(', ')}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto space-y-2 border rounded-md p-3 bg-muted/30">
              {(conversationMessages[selectedConversation.id] || []).map((m) => (
                <div key={m.id} className="border rounded-md p-2 bg-background">
                  <div className="text-xs text-muted-foreground flex justify-between">
                    <span>{m.sender.pubkey === myPubkey ? 'You' : m.sender.pubkey}</span>
                    <span>{new Date(m.timestamp * 1000).toLocaleString()}</span>
                  </div>
                  <div className="text-sm whitespace-pre-wrap mt-1">{m.content}</div>
                  {m.replyTo && (
                    <div className="text-xs text-muted-foreground mt-1">Reply to: {m.replyTo}</div>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-3 space-y-2">
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
          </>
        ) : (
          <div className="text-sm text-muted-foreground">Select a conversation to view messages.</div>
        )}
      </div>
    </div>
  )
}
