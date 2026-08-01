export type WSEventListener = (event: any) => void;

export class WSClient {
  private url: string;
  private token: string | null = null;
  private ws: WebSocket | null = null;
  private listeners: Map<string, Set<WSEventListener>> = new Map();
  private isConnected = false;
  private reconnectTimer: any = null;
  private reconnectAttempts = 0;

  constructor(url: string) {
    this.url = url;
  }

  setToken(token: string | null) {
    this.token = token;
  }

  connect() {
    if (!this.token || this.ws) return;

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this.send({ type: 'auth', token: this.token });
      };

      this.ws.onmessage = (event) => {
        try {
          const frame = JSON.parse(event.data);
          if (frame.type === 'auth.ok') {
            this.isConnected = true;
            this.reconnectAttempts = 0;
            this.emit('connected', frame);
          }
          this.emit(frame.type, frame);
          this.emit('*', frame);
        } catch (e) {
          console.error('[WS] Parse error', e);
        }
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this.ws = null;
        this.emit('disconnected', null);
        this.scheduleReconnect();
      };

      this.ws.onerror = (err) => {
        console.error('[WS] Error', err);
      };
    } catch (e) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;

    this.reconnectAttempts++;
    const baseDelay = Math.min(30000, 1000 * Math.pow(2, Math.min(this.reconnectAttempts, 5)));
    const jitter = Math.floor(Math.random() * 1000);
    const delay = baseDelay + jitter;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  send(data: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  sendMessage(id: string, conversationId: string, body?: string, replyToId?: string) {
    this.send({
      type: 'message.send',
      id,
      conversation_id: conversationId,
      body,
      reply_to_id: replyToId,
    });
  }

  sendTyping(conversationId: string, isTyping: boolean) {
    this.send({
      type: isTyping ? 'typing.start' : 'typing.stop',
      conversation_id: conversationId,
    });
  }

  sendReadAck(conversationId: string, messageId: string) {
    this.send({
      type: 'read.ack',
      conversation_id: conversationId,
      message_id: messageId,
    });
  }

  on(event: string, fn: WSEventListener) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(fn);
  }

  off(event: string, fn: WSEventListener) {
    this.listeners.get(event)?.delete(fn);
  }

  private emit(event: string, payload: any) {
    this.listeners.get(event)?.forEach((fn) => fn(payload));
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
    this.isConnected = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
