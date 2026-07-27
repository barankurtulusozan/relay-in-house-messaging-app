import { Conversation, User, LocalMessage, Attachment } from '../types/models.js';

export class APIClient {
  private baseURL: string;
  private token: string | null = null;

  constructor(baseURL: string) {
    this.baseURL = baseURL.replace(/\/$/, '');
  }

  setToken(token: string | null) {
    this.token = token;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    try {
      const res = await fetch(`${this.baseURL}${endpoint}`, {
        ...options,
        headers,
        signal: options.signal || controller.signal,
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(errBody.error || `HTTP error ${res.status}`);
      }

      return await res.json();
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async login(oidcSubject: string, email: string, displayName: string, avatarURL?: string): Promise<{ token: string; user: User }> {
    return this.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        oidc_subject: oidcSubject,
        email,
        display_name: displayName,
        avatar_url: avatarURL,
      }),
    });
  }

  async getMe(): Promise<User> {
    return this.request('/api/me');
  }

  async getConversations(): Promise<Conversation[]> {
    const res = await this.request<Conversation[]>('/api/conversations');
    return Array.isArray(res) ? res : [];
  }

  async createConversation(type: 'direct' | 'group', memberIDs: string[], name?: string): Promise<Conversation> {
    return this.request('/api/conversations', {
      method: 'POST',
      body: JSON.stringify({ type, name, member_ids: memberIDs }),
    });
  }

  async getMessages(conversationId: string, beforeSeq?: number, limit = 50): Promise<{ messages: LocalMessage[]; has_more: boolean }> {
    const params = new URLSearchParams();
    if (beforeSeq) params.set('before_seq', beforeSeq.toString());
    params.set('limit', limit.toString());
    const res = await this.request<{ messages: LocalMessage[]; has_more: boolean }>(`/api/conversations/${conversationId}/messages?${params.toString()}`);
    return {
      messages: Array.isArray(res?.messages) ? res.messages : [],
      has_more: !!res?.has_more,
    };
  }

  async presignAttachment(messageId: string, fileName: string, mimeType: string, sizeBytes: number): Promise<{ upload_url: string; storage_key: string; attachment_id: string }> {
    return this.request('/api/attachments/presign', {
      method: 'POST',
      body: JSON.stringify({
        message_id: messageId,
        file_name: fileName,
        mime_type: mimeType,
        size_bytes: sizeBytes,
      }),
    });
  }

  async completeAttachment(attachmentId: string): Promise<{ status: string }> {
    return this.request(`/api/attachments/${attachmentId}/complete`, {
      method: 'POST',
    });
  }

  async searchMessages(query: string, conversationId?: string): Promise<LocalMessage[]> {
    const params = new URLSearchParams({ q: query });
    if (conversationId) params.set('conversation_id', conversationId);
    return this.request(`/api/search?${params.toString()}`);
  }
}
