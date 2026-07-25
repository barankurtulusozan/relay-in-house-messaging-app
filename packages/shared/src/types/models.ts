export type UserStatus = 'online' | 'away' | 'offline';

export interface User {
  id: string;
  oidc_subject: string;
  email: string;
  display_name: string;
  avatar_url?: string;
  status: UserStatus;
  created_at: string;
  last_seen_at?: string;
}

export type ConversationType = 'direct' | 'group';
export type MemberRole = 'owner' | 'admin' | 'member';

export interface Conversation {
  id: string;
  type: ConversationType;
  name?: string;
  created_by: string;
  created_at: string;
}

export interface ConversationMember {
  conversation_id: string;
  user_id: string;
  role: MemberRole;
  joined_at: string;
  last_read_message_id?: string;
  user?: User;
}

export type MessageStatus = 'sending' | 'sent' | 'failed';

export interface LocalMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  body?: string;
  reply_to_id?: string;
  edited_from_id?: string;
  deleted: boolean;
  created_at: string;
  server_seq?: number;
  status: MessageStatus;
  sender?: User;
  attachments?: Attachment[];
}

export type ScanStatus = 'pending' | 'clean' | 'infected' | 'error';

export interface Attachment {
  id: string;
  message_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  storage_key: string;
  scan_status: ScanStatus;
  uploaded_by: string;
  created_at: string;
}

export interface OutboxItem {
  id: string;
  conversation_id: string;
  body?: string;
  reply_to_id?: string;
  created_at: string;
  retry_count: number;
}
