import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useNostr } from './NostrProvider'
import { MultiPartyMessenger, createNDKWithSigner } from '@/lib/messaging/multi-party-messenger'
import type { ConversationMeta, DMMessage, MessengerEvent } from '@/lib/messaging/types'
import NDKCacheAdapterDexie from '@nostr-dev-kit/cache-dexie'
import { MemoryStorage } from '@/lib/messaging/storage'
import { CacheStorage } from '@/lib/messaging/cache-storage'
import NDK, { NDKNip07Signer } from '@nostr-dev-kit/ndk'
import * as nip49 from '@nostr/tools/nip49'

const PASSWORD_PROMPT = 'Enter the password to decrypt your ncryptsec for messaging'

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
  const { pubkey, relayList, nsec, ncryptsec, isReady } = useNostr()
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

      const discoveryRelay = import.meta.env.VITE_DISCOVERY_RELAY as string | undefined
      const relayUrls = Array.from(
        new Set([
          ...((relayList.read || []) as string[]),
          ...((relayList.write || []) as string[]),
          discoveryRelay
        ].filter(Boolean))
      ) as string[]

      let mp: MultiPartyMessenger | null = null
      let off: (() => void) | null = null

      try {
        const cacheAdapter = new NDKCacheAdapterDexie({ dbName: 'fevela-nip17' })
        let ndk: NDK | null = null

        if (nsec) {
          ndk = createNDKWithSigner(nsec, relayUrls, discoveryRelay, cacheAdapter)
        } else if (ncryptsec) {
          const password = typeof window !== 'undefined' ? window.prompt(PASSWORD_PROMPT) : null
          if (!password) {
            setUnsupportedReason('Password required to decrypt ncryptsec for messaging.')
            setReadyFlag(true)
            return
          }
          const privkey = nip49.decrypt(ncryptsec, password)
          ndk = createNDKWithSigner(privkey, relayUrls, discoveryRelay, cacheAdapter)
        } else if (typeof window !== 'undefined' && (window as any).nostr) {
          const signer = new NDKNip07Signer(10_000)
          ndk = new NDK({
            explicitRelayUrls: relayUrls,
            signer
          })
          if (signer.blockUntilReady) {
            await signer.blockUntilReady()
          }
        } else {
          setUnsupportedReason('No compatible signer available for NIP-17.')
          setReadyFlag(true)
          return
        }

        ndk.cacheAdapter = cacheAdapter as any

        await ndk.connect()

        const adapterAny = cacheAdapter as any
        const supportsModules =
          typeof adapterAny?.registerModule === 'function' &&
          typeof adapterAny?.getCollection === 'function'

        const storage = supportsModules ? new CacheStorage(adapterAny) : new MemoryStorage()

        mp = new MultiPartyMessenger(ndk, { storage })
        await mp.start()
        ready.current = true
        setMessenger(mp)
        setConversations(await mp.getConversations())

        off = mp.on(async (event: MessengerEvent) => {
          if (event.type === 'message') {
            setMessages((prev) => {
              const next = { ...prev }
              const list = next[event.message.conversationId] || []
              next[event.message.conversationId] = [
                ...list.filter((m) => m.id !== event.message.id),
                event.message
              ]
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
      } catch (err) {
        console.error('Failed to initialize NIP-17 messenger', err)
        setUnsupportedReason(
          err instanceof Error ? err.message : 'Unable to initialize NIP-17 messaging with this signer.'
        )
        setMessenger(null)
      } finally {
        setReadyFlag(true)
      }

      return () => {
        if (off) off()
        mp?.stop()
      }
    }

    const cleanupPromise = init()
    return () => {
      cleanupPromise?.then((cleanup) => cleanup?.())
    }
  }, [isReady, pubkey, relayList, nsec, ncryptsec])

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
