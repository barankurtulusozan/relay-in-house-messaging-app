import { ILocalStorageDriver } from './IDriver.js';
import { LocalMessage, OutboxItem } from '../types/models.js';

export class MemoryStorageDriver implements ILocalStorageDriver {
  private messages: Map<string, LocalMessage> = new Map();
  private outbox: Map<string, OutboxItem> = new Map();
  private cursors: Map<string, number> = new Map();

  async init(): Promise<void> {}

  async getPendingOutbox(): Promise<OutboxItem[]> {
    return Array.from(this.outbox.values());
  }

  async saveOutboxItem(item: OutboxItem): Promise<void> {
    this.outbox.set(item.id, item);
  }

  async removeOutboxItem(id: string): Promise<void> {
    this.outbox.delete(id);
  }

  async saveMessage(msg: LocalMessage): Promise<void> {
    this.messages.set(msg.id, msg);
  }

  async saveMessagesBatch(msgs: LocalMessage[]): Promise<void> {
    for (const msg of msgs) {
      this.messages.set(msg.id, msg);
    }
  }

  async getMessages(conversationId: string, limit = 50): Promise<LocalMessage[]> {
    const list = Array.from(this.messages.values())
      .filter((m) => m.conversation_id === conversationId)
      .slice(0, limit);
    return list;
  }

  async updateMessageStatus(id: string, status: LocalMessage['status'], serverSeq?: number): Promise<void> {
    const existing = this.messages.get(id);
    if (existing) {
      existing.status = status;
      if (serverSeq !== undefined) {
        existing.server_seq = serverSeq;
      }
    }
  }

  async getSyncCursor(conversationId: string): Promise<number> {
    return this.cursors.get(conversationId) || 0;
  }

  async setSyncCursor(conversationId: string, seq: number): Promise<void> {
    this.cursors.set(conversationId, seq);
  }
}
