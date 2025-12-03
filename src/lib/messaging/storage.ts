import type { ConversationMeta, DMMessage } from './types'

export interface StorageAdapter {
  saveMessage(message: DMMessage): Promise<void>
  getMessages(conversationId: string, limit?: number): Promise<DMMessage[]>
  markAsRead(messageIds: string[]): Promise<void>
  getConversations(): Promise<ConversationMeta[]>
  saveConversation(conversation: ConversationMeta): Promise<void>
}

export class MemoryStorage implements StorageAdapter {
  private conversations = new Map<string, ConversationMeta>()
  private messages = new Map<string, DMMessage[]>()

  async saveMessage(message: DMMessage): Promise<void> {
    const list = this.messages.get(message.conversationId) || []
    const exists = list.find((m) => m.id === message.id)
    if (!exists) {
      list.push(message)
      list.sort((a, b) => a.timestamp - b.timestamp)
      this.messages.set(message.conversationId, list)
    }
  }

  async getMessages(conversationId: string, limit?: number): Promise<DMMessage[]> {
    const list = this.messages.get(conversationId) || []
    if (limit && list.length > limit) {
      return list.slice(-limit)
    }
    return [...list]
  }

  async markAsRead(messageIds: string[]): Promise<void> {
    for (const [, list] of this.messages) {
      list.forEach((msg) => {
        if (messageIds.includes(msg.id)) {
          msg.read = true
        }
      })
    }
  }

  async getConversations(): Promise<ConversationMeta[]> {
    return Array.from(this.conversations.values())
  }

  async saveConversation(conversation: ConversationMeta): Promise<void> {
    this.conversations.set(conversation.id, conversation)
  }
}
