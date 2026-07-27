import { ILocalStorageDriver } from '../storage/IDriver.js';
import { WSClient } from '../client/wsClient.js';
import { APIClient } from '../client/apiClient.js';
import { LocalMessage, OutboxItem } from '../types/models.js';
import { generateUUID } from '../utils/uuid.js';

export class SyncEngine {
  private driver: ILocalStorageDriver;
  private wsClient: WSClient;
  private apiClient: APIClient;
  private isFlushing = false;

  constructor(driver: ILocalStorageDriver, wsClient: WSClient, apiClient: APIClient) {
    this.driver = driver;
    this.wsClient = wsClient;
    this.apiClient = apiClient;

    this.setupListeners();
  }

  private setupListeners() {
    this.wsClient.on('connected', () => {
      this.flushOutbox();
    });

    this.wsClient.on('message.ack', (frame: any) => {
      if (frame.client_id) {
        this.driver.updateMessageStatus(frame.client_id, 'sent', frame.server_seq);
        this.driver.removeOutboxItem(frame.client_id);
      }
    });

    this.wsClient.on('message.new', (frame: any) => {
      if (frame.message) {
        const msg = frame.message as LocalMessage;
        msg.status = 'sent';
        this.driver.saveMessage(msg);
      }
    });
  }

  async sendMessage(conversationId: string, senderId: string, body?: string, replyToId?: string): Promise<LocalMessage> {
    const id = generateUUID();
    const now = new Date().toISOString();

    const localMsg: LocalMessage = {
      id,
      conversation_id: conversationId,
      sender_id: senderId,
      body,
      reply_to_id: replyToId,
      deleted: false,
      created_at: now,
      status: 'sending',
    };

    const outboxItem: OutboxItem = {
      id,
      conversation_id: conversationId,
      body,
      reply_to_id: replyToId,
      created_at: now,
      retry_count: 0,
    };

    await this.driver.saveMessage(localMsg);
    await this.driver.saveOutboxItem(outboxItem);

    // Immediate flush attempt (catch errors silently when offline)
    this.flushOutbox().catch(() => {});

    return localMsg;
  }

  async flushOutbox() {
    if (this.isFlushing) return;
    this.isFlushing = true;

    try {
      const items = await this.driver.getPendingOutbox();
      for (const item of items) {
        this.wsClient.sendMessage(item.id, item.conversation_id, item.body, item.reply_to_id);
      }
    } catch (e) {
      // Offline mode: WebSocket send attempts ignored until connection is restored
    } finally {
      this.isFlushing = false;
    }
  }

  async syncConversation(conversationId: string): Promise<LocalMessage[]> {
    try {
      const cursor = await this.driver.getSyncCursor(conversationId);
      const result = await this.apiClient.getMessages(conversationId, cursor > 0 ? cursor : undefined, 50);

      if (result && Array.isArray(result.messages) && result.messages.length > 0) {
        const marked = result.messages.map((m) => ({ ...m, status: 'sent' as const }));
        await this.driver.saveMessagesBatch(marked);

        const maxSeq = Math.max(...marked.map((m) => m.server_seq || 0));
        if (maxSeq > cursor) {
          await this.driver.setSyncCursor(conversationId, maxSeq);
        }
      }
    } catch (err) {
      // Backend is offline or unreachable - serve cached local messages seamlessly
    }

    return this.driver.getMessages(conversationId, 50);
  }
}
