import type {
  CacheModuleCollection,
  CacheModuleDefinition,
  CacheModuleStorage
} from '@nostr-dev-kit/ndk'
import type { ConversationMeta, DMMessage } from './types'
import type { StorageAdapter } from './storage'

const MODULE_NAMESPACE = 'nip17'

const moduleDefinition: CacheModuleDefinition = {
  namespace: MODULE_NAMESPACE,
  version: 1,
  collections: {
    messages: {
      primaryKey: 'id',
      indexes: ['conversationId', 'timestamp', 'sender']
    },
    conversations: {
      primaryKey: 'id',
      indexes: ['lastMessageAt']
    }
  },
  migrations: {
    1: async (ctx) => {
      await ctx.createCollection('messages', moduleDefinition.collections.messages)
      await ctx.createCollection('conversations', moduleDefinition.collections.conversations)
    }
  }
}

/**
 * Cache-backed storage using NDK cache modules (Dexie adapter).
 */
export class CacheStorage implements StorageAdapter {
  private adapter: CacheModuleStorage
  private ready: Promise<void>
  private messages?: CacheModuleCollection<DMMessage>
  private conversations?: CacheModuleCollection<ConversationMeta>

  constructor(adapter: CacheModuleStorage) {
    if (typeof (adapter as any)?.getCollection !== 'function') {
      throw new Error('Cache adapter does not support cache modules API')
    }
    this.adapter = adapter
    this.ready = this.init()
  }

  private async init() {
    if (!this.adapter.registerModule) {
      throw new Error('Cache adapter does not support module registration')
    }

    if (!this.adapter.hasModule || !this.adapter.hasModule(MODULE_NAMESPACE)) {
      await this.adapter.registerModule(moduleDefinition)
    }

    this.messages = await (this.adapter as any).getCollection<DMMessage>(MODULE_NAMESPACE, 'messages')
    this.conversations = await (this.adapter as any).getCollection<ConversationMeta>(
      MODULE_NAMESPACE,
      'conversations'
    )
  }

  private async ensureReady() {
    await this.ready
    if (!this.messages || !this.conversations) {
      throw new Error('CacheStorage not initialized')
    }
  }

  async saveMessage(message: DMMessage): Promise<void> {
    await this.ensureReady()
    await this.messages!.save(message)
  }

  async getMessages(conversationId: string, limit?: number): Promise<DMMessage[]> {
    await this.ensureReady()
    const list = await this.messages!.findBy('conversationId', conversationId)
    const sorted = list.sort((a, b) => a.timestamp - b.timestamp)
    if (limit && sorted.length > limit) {
      return sorted.slice(-limit)
    }
    return sorted
  }

  async markAsRead(messageIds: string[]): Promise<void> {
    await this.ensureReady()
    const msgs = await this.messages!.getMany(messageIds)
    if (!msgs.length) return
    msgs.forEach((m) => (m.read = true))
    await this.messages!.saveMany(msgs)
  }

  async getConversations(): Promise<ConversationMeta[]> {
    await this.ensureReady()
    return this.conversations!.all()
  }

  async saveConversation(conversation: ConversationMeta): Promise<void> {
    await this.ensureReady()
    await this.conversations!.save(conversation)
  }
}
