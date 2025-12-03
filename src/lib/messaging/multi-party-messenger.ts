import NDK, {
  NDKFilter,
  NDKKind,
  NDKEvent,
  NDKPrivateKeySigner,
  NDKRelaySet,
  NDKSubscription,
  NDKUser,
  type NostrEvent
} from '@nostr-dev-kit/ndk'
import { bytesToHex } from '@noble/hashes/utils'
import type { ConversationMeta, DMMessage, MessengerEvent, SendMessageOptions } from './types'
import { MultiPartyNIP17Protocol } from './nip17-protocol'
import { MemoryStorage, type StorageAdapter } from './storage'
import { SimpleEmitter } from './emitter'
import * as nip19 from '@nostr/tools/nip19'

type MessengerOptions = {
  discoveryRelay?: string
  explicitRelayUrls?: string[]
  storage?: StorageAdapter
}

const DEFAULT_DISCOVERY = 'wss://hypertuna.com/relay'

export class MultiPartyMessenger {
  private ndk: NDK
  private protocol: MultiPartyNIP17Protocol
  private storage: StorageAdapter
  private emitter = new SimpleEmitter<MessengerEvent>()
  private conversations = new Map<string, ConversationMeta>()
  private messages = new Map<string, DMMessage[]>()
  private myPubkey?: string
  private subscription?: NDKSubscription
  private discoveryRelay: string

  constructor(ndk: NDK, options: MessengerOptions = {}) {
    this.ndk = ndk
    this.discoveryRelay = options.discoveryRelay || DEFAULT_DISCOVERY
    this.storage = options.storage || new MemoryStorage()

    const signer = ndk.signer
    if (!signer) {
      throw new Error('NDK signer required for messenger')
    }
    this.protocol = new MultiPartyNIP17Protocol(
      ndk,
      signer,
      this.getUserDMRelays,
      this.publishDMRelays,
      this.discoveryRelay
    )
  }

  on(cb: (event: MessengerEvent) => void) {
    return this.emitter.on('event', cb)
  }

  off(cb: (event: MessengerEvent) => void) {
    return this.emitter.off('event', cb)
  }

  private emit(event: MessengerEvent) {
    this.emitter.emit('event', event)
  }

  async start() {
    if (!this.ndk.signer) throw new Error('NDK signer required')
    const user = await this.ndk.signer.user()
    this.myPubkey = user.pubkey
    await this.loadPersisted()
    await this.subscribe()
  }

  async stop() {
    this.subscription?.stop()
    this.subscription = undefined
  }

  async getConversations(): Promise<ConversationMeta[]> {
    return Array.from(this.conversations.values()).sort(
      (a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0)
    )
  }

  async getConversationMessages(conversationId: string, limit?: number): Promise<DMMessage[]> {
    const cached = this.messages.get(conversationId)
    if (cached) return limit ? cached.slice(-limit) : cached
    const stored = await this.storage.getMessages(conversationId, limit)
    this.messages.set(conversationId, stored)
    return stored
  }

  async sendMessage(
    participants: NDKUser[],
    content: string,
    opts: SendMessageOptions = {}
  ): Promise<DMMessage[]> {
    if (!this.myPubkey) await this.start()
    const wraps = await this.protocol.sendMessage(participants, content, opts)
    const senderPubkey = this.myPubkey!
    const rumorMessage: DMMessage = {
      id: wraps[0]?.id ?? `${Date.now()}`,
      type: 'text',
      content,
      sender: new NDKUser({ pubkey: senderPubkey }),
      recipients: participants.filter((p) => p.pubkey !== senderPubkey),
      timestamp: Math.floor(Date.now() / 1000),
      protocol: 'nip17',
      read: true,
      conversationId: this.conversationIdFromParticipants([...participants.map((p) => p.pubkey), senderPubkey]),
      replyTo: opts.replyTo
    }
    await this.persistMessage(rumorMessage)
    return [rumorMessage]
  }

  async markConversationRead(conversationId: string) {
    const msgs = await this.getConversationMessages(conversationId)
    const unreadIds = msgs.filter((m) => !m.read && m.sender.pubkey !== this.myPubkey).map((m) => m.id)
    if (unreadIds.length) {
      await this.storage.markAsRead(unreadIds)
      msgs.forEach((m) => {
        if (unreadIds.includes(m.id)) m.read = true
      })
      const meta = this.conversations.get(conversationId)
      if (meta) {
        meta.unreadCount = 0
        this.emit({ type: 'conversation-updated', conversation: meta })
      }
    }
  }

  private async loadPersisted() {
    const metas = await this.storage.getConversations()
    metas.forEach((meta) => this.conversations.set(meta.id, meta))
    for (const meta of metas) {
      const msgs = await this.storage.getMessages(meta.id)
      this.messages.set(meta.id, msgs)
    }
  }

  private async subscribe() {
    if (!this.myPubkey) return
    const filters: NDKFilter = {
      kinds: [NDKKind.GiftWrap],
      '#p': [this.myPubkey]
    }
    const userRelays = await this.getUserDMRelays(new NDKUser({ pubkey: this.myPubkey }))
    const relaySet =
      userRelays.length > 0
        ? NDKRelaySet.fromRelayUrls(Array.from(new Set([...userRelays, this.discoveryRelay])), this.ndk)
        : undefined
    this.subscription = this.ndk.subscribe(filters, {
      closeOnEose: false,
      subId: 'nip17-messenger',
      ...{ relaySet },
      onEvent: async (evt) => {
        await this.handleIncomingGiftWrap(evt)
      }
    })
  }

  private async handleIncomingGiftWrap(evt: NostrEvent) {
    if (!this.myPubkey) return
    const ndkEvt = new NDKEvent(this.ndk, evt)
    const rumor = await this.protocol.unwrapMessage(ndkEvt)
    if (!rumor) return
    const message = this.protocol.rumorToMessage(rumor, this.myPubkey)
    await this.persistMessage(message)
  }

  private async persistMessage(message: DMMessage) {
    const list = this.messages.get(message.conversationId) || []
    const exists = list.find((m) => m.id === message.id)
    if (!exists) {
      list.push(message)
      list.sort((a, b) => a.timestamp - b.timestamp)
      this.messages.set(message.conversationId, list)
      await this.storage.saveMessage(message)
      await this.ensureConversationMeta(message)
      this.emit({ type: 'message', message })
    }
  }

  private async ensureConversationMeta(message: DMMessage) {
    const participants = this.extractParticipantsFromMessage(message)
    const id = this.conversationIdFromParticipants(participants)
    const subject = message.tags?.find((t) => t[0] === 'subject')?.[1]
    const existing = this.conversations.get(id)
    if (existing) {
      existing.lastMessageAt = message.timestamp
      if (message.sender.pubkey !== this.myPubkey) {
        existing.unreadCount += 1
      }
      if (subject) existing.subject = subject
      await this.storage.saveConversation(existing)
      this.emit({ type: 'conversation-updated', conversation: existing })
      return
    }
    const meta: ConversationMeta = {
      id,
      participants,
      protocol: 'nip17',
      subject,
      unreadCount: message.sender.pubkey === this.myPubkey ? 0 : 1,
      lastMessageAt: message.timestamp
    }
    this.conversations.set(id, meta)
    await this.storage.saveConversation(meta)
    this.emit({ type: 'conversation-created', conversation: meta })
  }

  private extractParticipantsFromMessage(message: DMMessage): string[] {
    const pTags = message.tags?.filter((t) => t[0] === 'p').map((t) => t[1]) ?? []
    const set = new Set<string>([...pTags, message.sender.pubkey, ...(message.recipients || []).map((r) => r.pubkey)])
    return Array.from(set).sort()
  }

  private conversationIdFromParticipants(participants: string[]) {
    return Array.from(new Set(participants)).sort().join(':')
  }

  private getUserDMRelays = async (user: NDKUser): Promise<string[]> => {
    try {
      const dmRelayList = await this.ndk.fetchEvent({
        kinds: [NDKKind.DirectMessageReceiveRelayList],
        authors: [user.pubkey]
      })
      if (dmRelayList) {
        const relays = dmRelayList.getMatchingTags('relay').map((t) => t[1])
        if (relays.length > 0) return relays
      }
      const relayList = await this.ndk.fetchEvent({
        kinds: [10002],
        authors: [user.pubkey]
      })
      if (relayList) {
        const relays = relayList.getMatchingTags('r').map((t) => t[1])
        if (relays.length > 0) return relays.slice(0, 3)
      }
    } catch (err) {
      console.warn('Failed to load DM relays for', user.pubkey, err)
    }
    return []
  }

  private publishDMRelays = async (relays: string[]): Promise<void> => {
    const event = new NDKEvent(this.ndk)
    event.kind = NDKKind.DirectMessageReceiveRelayList
    event.tags = relays.map((r) => ['relay', r])
    event.created_at = Math.floor(Date.now() / 1000)
    await event.sign(this.ndk.signer!)
    const relaySet = NDKRelaySet.fromRelayUrls(relays, this.ndk)
    await event.publish(relaySet)
  }
}

export function createNDKWithSigner(
  nsec: string,
  explicitRelayUrls: string[],
  discoveryRelay = DEFAULT_DISCOVERY,
  cacheAdapter?: any
) {
  const decoded = nip19.decode(nsec)
  if (decoded.type !== 'nsec') {
    throw new Error('Invalid nsec for NIP-17 messenger')
  }
  const signer = new NDKPrivateKeySigner(bytesToHex(decoded.data as Uint8Array))
  const ndk = new NDK({
    explicitRelayUrls: Array.from(new Set([...(explicitRelayUrls || []), discoveryRelay])),
    signer,
    cacheAdapter
  })
  return ndk
}
