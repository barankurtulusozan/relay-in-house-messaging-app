'use client';

import React, { useEffect, useState, useRef } from 'react';
import { APIClient, WSClient, SyncEngine, IndexedDBStorageDriver, Conversation, LocalMessage, User } from '@company-chat/shared';
import { Send, Paperclip, MessageSquare, Search, ShieldCheck, CheckCheck, Clock } from 'lucide-react';

export default function ChatDashboard() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const apiClientRef = useRef<APIClient>(new APIClient('http://localhost:8080'));
  const wsClientRef = useRef<WSClient>(new WSClient('ws://localhost:8080/ws'));
  const syncEngineRef = useRef<SyncEngine | null>(null);
  const streamRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function init() {
      try {
        const driver = new IndexedDBStorageDriver();
        await driver.init();

        const syncEngine = new SyncEngine(driver, wsClientRef.current, apiClientRef.current);
        syncEngineRef.current = syncEngine;

        // Auto login for dev simulation
        const loginRes = await apiClientRef.current.login(
          'oidc-user-1',
          'alice@company.com',
          'Alice Vance',
          'https://images.unsplash.com/photo-1494790108377-be9c29b29330'
        );

        setCurrentUser(loginRes.user);
        apiClientRef.current.setToken(loginRes.token);
        wsClientRef.current.setToken(loginRes.token);
        wsClientRef.current.connect();

        let convList = await apiClientRef.current.getConversations();
        if (!convList || convList.length === 0) {
          // Create default general channel
          const newConv = await apiClientRef.current.createConversation('group', [], 'General Channel');
          convList = [newConv];
        }

        setConversations(convList);
        if (convList.length > 0) {
          setActiveConv(convList[0]);
        }
      } catch (err) {
        console.error('Initialization error:', err);
      }
    }

    init();

    return () => {
      wsClientRef.current.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!activeConv || !syncEngineRef.current) return;

    async function loadMessages() {
      const msgs = await syncEngineRef.current!.syncConversation(activeConv!.id);
      setMessages(msgs);
    }

    loadMessages();

    const handleNewMsg = (frame: any) => {
      if (frame.message && frame.message.conversation_id === activeConv.id) {
        setMessages((prev) => [...prev, frame.message]);
      }
    };

    wsClientRef.current.on('message.new', handleNewMsg);
    return () => {
      wsClientRef.current.off('message.new', handleNewMsg);
    };
  }, [activeConv]);

  useEffect(() => {
    streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !activeConv || !currentUser || !syncEngineRef.current) return;

    const body = inputText;
    setInputText('');

    const localMsg = await syncEngineRef.current.sendMessage(activeConv.id, currentUser.id, body);
    setMessages((prev) => [...prev, localMsg]);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeConv || !currentUser) return;

    try {
      const presign = await apiClientRef.current.presignAttachment(
        crypto.randomUUID(),
        file.name,
        file.type,
        file.size
      );

      // Upload directly to MinIO presigned URL
      await fetch(presign.upload_url, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });

      await apiClientRef.current.completeAttachment(presign.attachment_id);
      alert(`File uploaded cleanly. Marked pending virus scan.`);
    } catch (err: any) {
      alert(`Upload failed: ${err.message}`);
    }
  };

  return (
    <div className="app-container">
      {/* Sidebar */}
      <div className="sidebar">
        <div className="sidebar-header">
          <div className="logo-badge">
            <ShieldCheck size={22} color="#818cf8" />
            <span>Relay Chat</span>
          </div>
          {currentUser && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem' }}>
              <span className="status-dot online"></span>
              <span>{currentUser.display_name}</span>
            </div>
          )}
        </div>

        <div style={{ padding: '12px' }}>
          <div style={{ position: 'relative' }}>
            <Search size={16} style={{ position: 'absolute', left: '12px', top: '10px', color: '#9ca3af' }} />
            <input
              type="text"
              placeholder="Search messages..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="chat-input"
              style={{ width: '100%', paddingLeft: '36px', borderRadius: '10px' }}
            />
          </div>
        </div>

        <div className="conv-list">
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#6b7280', padding: '0 8px 8px 8px' }}>
            CONVERSATIONS
          </div>
          {conversations.map((c) => (
            <div
              key={c.id}
              className={`conv-item ${activeConv?.id === c.id ? 'active' : ''}`}
              onClick={() => setActiveConv(c)}
            >
              <MessageSquare size={18} color="#a5b4fc" />
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{c.name || 'Direct Chat'}</div>
                <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>{c.type}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="chat-area">
        {activeConv ? (
          <>
            <div className="chat-header">
              <div>
                <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>{activeConv.name || 'Direct Chat'}</h2>
                <div style={{ fontSize: '0.8rem', color: '#9ca3af' }}>Self-Hosted TLS Encrypted</div>
              </div>
            </div>

            <div className="message-stream" ref={streamRef}>
              {messages.map((m) => {
                const isUser = currentUser && m.sender_id === currentUser.id;
                return (
                  <div key={m.id} className={`message-bubble ${isUser ? 'outgoing' : 'incoming'}`}>
                    <div>{m.body}</div>

                    {m.attachments?.map((att) => (
                      <a
                        key={att.id}
                        href={`http://localhost:8080/api/attachments/${att.id}/download`}
                        target="_blank"
                        rel="noreferrer"
                        className="attachment-chip"
                      >
                        <Paperclip size={14} />
                        <span>{att.file_name} ({(att.size_bytes / 1024).toFixed(1)} KB)</span>
                      </a>
                    ))}

                    <div className="message-meta">
                      <span>{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      {isUser && (
                        m.status === 'sent' ? <CheckCheck size={14} color="#a5b4fc" /> : <Clock size={12} />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <form className="chat-input-bar" onSubmit={handleSend}>
              <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                <Paperclip size={20} color="#9ca3af" />
                <input type="file" onChange={handleFileUpload} style={{ display: 'none' }} />
              </label>
              <input
                type="text"
                className="chat-input"
                placeholder="Type a message..."
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
              />
              <button type="submit" className="btn-send">
                <Send size={18} />
              </button>
            </form>
          </>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#9ca3af' }}>
            Select a conversation to start chatting
          </div>
        )}
      </div>
    </div>
  );
}
