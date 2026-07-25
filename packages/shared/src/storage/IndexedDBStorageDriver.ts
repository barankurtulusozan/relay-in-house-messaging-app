import Dexie, { Table } from 'dexie';
import { ILocalStorageDriver } from './IDriver.js';
import { LocalMessage, OutboxItem } from '../types/models.js';

class ChatDatabase extends Dexie {
  messages!: Table<LocalMessage, string>;
  outbox!: Table<OutboxItem, string>;
  sync_cursors!: Table<{ conversation_id: string; seq: number }, string>;

  constructor() {
    super('CompanyChatDB');
    this.version(1).stores({
      messages: 'id, conversation_id, server_seq, created_at',
      outbox: 'id, conversation_id, created_at',
      sync_cursors: 'conversation_id',
    });
  }
}

export class IndexedDBStorageDriver implements ILocalStorageDriver {
  private db: ChatDatabase;

  constructor() {
    this.db = new ChatDatabase();
  }

  async init(): Promise<void> {
    await this.db.open();
  }

  async getPendingOutbox(): Promise<OutboxItem[]> {
    return this.db.outbox.orderBy('created_at').toArray();
  }

  async saveOutboxItem(item: OutboxItem): Promise<void> {
    await this.db.outbox.put(item);
  }

  async removeOutboxItem(id: string): Promise<void> {
    await this.db.outbox.delete(id);
  }

  async saveMessage(msg: LocalMessage): Promise<void> {
    await this.db.messages.put(msg);
  }

  async saveMessagesBatch(msgs: LocalMessage[]): Promise<void> {
    await this.db.messages.bulkPut(msgs);
  }

  async getMessages(conversationId: string, limit = 50): Promise<LocalMessage[]> {
    return this.db.messages
      .where('conversation_id')
      .equals(conversationId)
      .reverse()
      .limit(limit)
      .toArray();
  }

  async updateMessageStatus(id: string, status: LocalMessage['status'], serverSeq?: number): Promise<void> {
    const changes: Partial<LocalMessage> = { status };
    if (serverSeq !== undefined) {
      changes.server_seq = serverSeq;
    }
    await this.db.messages.update(id, changes);
  }

  async getSyncCursor(conversationId: string): Promise<number> {
    const row = await this.db.sync_cursors.get(conversationId);
    return row ? row.seq : 0;
  }

  async setSyncCursor(conversationId: string, seq: number): Promise<void> {
    await this.db.sync_cursors.put({ conversation_id: conversationId, seq });
  }
}
