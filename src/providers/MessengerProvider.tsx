import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useNostr } from './NostrProvider'
import { MultiPartyMessenger, createNDKWithSigner } from '@/lib/messaging/multi-party-messenger'
import type { ConversationMeta, DMMessage, MessengerEvent } from '@/lib/messaging/types'
import NDKCacheAdapterDexie from '@nostr-dev-kit/cache-dexie'
import { MemoryStorage } from '@/lib/messaging/storage'

type MessengerContextType = {
  messenger: MultiPartyMessenger | null
  conversations: ConversationMeta[]
  messages: Record<string, DMMessage[]>
  ready: boolean
  unsupportedReason?: string
}

const MessengerContext = createContext<MessengerContextType | undefined>(undefined)

export function useMessenger() {
  const ctx = useContext(MessengerContext)
  if (!ctx) throw new Error('useMessenger must be used within MessengerProvider')
  return ctx
}

export function MessengerProvider({ children }: { children: React.ReactNode }) {
  const { pubkey, relayList, nsec, isReady } = useNostr()
  const [messenger, setMessenger] = useState<MultiPartyMessenger | null>(null)
  const [conversations, setConversations] = useState<ConversationMeta[]>([])
  const [messages, setMessages] = useState<Record<string, DMMessage[]>>({})
  const [unsupportedReason, setUnsupportedReason] = useState<string | undefined>(undefined)
  const ready = useRef(false)
  const [readyFlag, setReadyFlag] = useState(false)

  useEffect(() => {
    const init = async () => {
      if (!isReady || !pubkey || !relayList) return
      setUnsupportedReason(undefined)
      setReadyFlag(false)
      if (!nsec) {
        setUnsupportedReason('NIP-17 requires a signer with private key access (nsec).')
        return
      }

      const cacheAdapter = new NDKCacheAdapterDexie({ dbName: 'fevela-nip17' })
      const ndk = createNDKWithSigner(nsec, [...relayList.read, ...relayList.write], undefined, cacheAdapter)
      await ndk.connect()
      const mp = new MultiPartyMessenger(ndk, { storage: new MemoryStorage() })
      await mp.start()
      ready.current = true
      setReadyFlag(true)
      setMessenger(mp)
      setConversations(await mp.getConversations())

      const off = mp.on(async (event: MessengerEvent) => {
        if (event.type === 'message') {
          setMessages((prev) => {
            const next = { ...prev }
            const list = next[event.message.conversationId] || []
            next[event.message.conversationId] = [...list.filter((m) => m.id !== event.message.id), event.message]
            return next
          })
        } else if (
          event.type === 'conversation-created' ||
          event.type === 'conversation-updated'
        ) {
          setConversations((prev) => {
            const existing = prev.filter((c) => c.id !== event.conversation.id)
            return [...existing, event.conversation].sort(
              (a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0)
            )
          })
        }
      })

      setMessages({})

      return () => {
        off?.()
        mp.stop()
      }
    }

    const cleanupPromise = init()
    return () => {
      cleanupPromise?.then((cleanup) => cleanup?.())
    }
  }, [isReady, pubkey, relayList, nsec])

  const value = useMemo(
    () => ({
      messenger,
      conversations,
      messages,
      ready: readyFlag,
      unsupportedReason
    }),
    [messenger, conversations, messages, unsupportedReason, readyFlag]
  )

  return <MessengerContext.Provider value={value}>{children}</MessengerContext.Provider>
}
