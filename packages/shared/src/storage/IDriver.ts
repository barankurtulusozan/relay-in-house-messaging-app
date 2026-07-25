import { LocalMessage, OutboxItem } from '../types/models.js';

export interface ILocalStorageDriver {
  init(): Promise<void>;
  getPendingOutbox(): Promise<OutboxItem[]>;
  saveOutboxItem(item: OutboxItem): Promise<void>;
  removeOutboxItem(id: string): Promise<void>;
  saveMessage(msg: LocalMessage): Promise<void>;
  saveMessagesBatch(msgs: LocalMessage[]): Promise<void>;
  getMessages(conversationId: string, limit?: number): Promise<LocalMessage[]>;
  updateMessageStatus(id: string, status: LocalMessage['status'], serverSeq?: number): Promise<void>;
  getSyncCursor(conversationId: string): Promise<number>;
  setSyncCursor(conversationId: string, seq: number): Promise<void>;
}
