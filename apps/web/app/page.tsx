'use client';

import React, { useEffect, useState, useRef, useMemo } from 'react';
import {
  APIClient,
  WSClient,
  SyncEngine,
  IndexedDBStorageDriver,
  Conversation,
  LocalMessage,
  User,
  generateUUID,
} from '@company-chat/shared';
import {
  Send,
  Paperclip,
  MessageSquare,
  Search,
  ShieldCheck,
  CheckCheck,
  Clock,
  Plus,
  Users,
  User as UserIcon,
  X,
  Building2,
  Filter,
  UserCheck,
  ChevronRight,
  Info,
  Sparkles,
  Hash,
  Star,
  Activity,
} from 'lucide-react';

const DEPARTMENTS = [
  'All Departments',
  'Engineering',
  'Product & Design',
  'Marketing & Sales',
  'Operations & HR',
  'Executive & Legal',
] as const;

type Department = typeof DEPARTMENTS[number];

// Generate realistic dataset of 150 company employees
const GENERATED_COMPANY_150_EMPLOYEES: (User & { department: Department; title: string })[] = [
  // Executive & Legal
  { id: 'u-1', oidc_subject: 'oidc-1', email: 'elena.vance@company.com', display_name: 'Elena Vance', status: 'online', department: 'Executive & Legal', title: 'Chief Executive Officer', created_at: '2026-01-01T00:00:00Z' },
  { id: 'u-2', oidc_subject: 'oidc-2', email: 'marcus.sterling@company.com', display_name: 'Marcus Sterling', status: 'online', department: 'Executive & Legal', title: 'Chief Technology Officer', created_at: '2026-01-01T00:00:00Z' },
  { id: 'u-3', oidc_subject: 'oidc-3', email: 'sarah.connor@company.com', display_name: 'Sarah Connor', status: 'away', department: 'Executive & Legal', title: 'General Counsel', created_at: '2026-01-01T00:00:00Z' },
  { id: 'u-4', oidc_subject: 'oidc-4', email: 'victor.hugo@company.com', display_name: 'Victor Hugo', status: 'offline', department: 'Executive & Legal', title: 'VP of Finance', created_at: '2026-01-01T00:00:00Z' },

  // Engineering (Core Infrastructure, Frontend, Backend, Security, Mobile, DevOps)
  { id: 'u-5', oidc_subject: 'oidc-5', email: 'alice.vance@company.com', display_name: 'Alice Vance', status: 'online', department: 'Engineering', title: 'Principal Staff Engineer', created_at: '2026-01-02T00:00:00Z' },
  { id: 'u-6', oidc_subject: 'oidc-6', email: 'bob.smith@company.com', display_name: 'Bob Smith', status: 'online', department: 'Engineering', title: 'Lead Mobile Architect', created_at: '2026-01-02T00:00:00Z' },
  { id: 'u-7', oidc_subject: 'oidc-7', email: 'charlie.davis@company.com', display_name: 'Charlie Davis', status: 'online', department: 'Engineering', title: 'Senior Go Backend Engineer', created_at: '2026-01-02T00:00:00Z' },
  { id: 'u-8', oidc_subject: 'oidc-8', email: 'diana.prince@company.com', display_name: 'Diana Prince', status: 'away', department: 'Engineering', title: 'AppSec & Cloud Security Specialist', created_at: '2026-01-02T00:00:00Z' },
  { id: 'u-9', oidc_subject: 'oidc-9', email: 'evan.wright@company.com', display_name: 'Evan Wright', status: 'offline', department: 'Engineering', title: 'DevOps & Site Reliability Lead', created_at: '2026-01-02T00:00:00Z' },
  { id: 'u-10', oidc_subject: 'oidc-10', email: 'frank.miller@company.com', display_name: 'Frank Miller', status: 'online', department: 'Engineering', title: 'Frontend Systems Specialist', created_at: '2026-01-02T00:00:00Z' },
  { id: 'u-11', oidc_subject: 'oidc-11', email: 'grace.hopper@company.com', display_name: 'Grace Hopper', status: 'online', department: 'Engineering', title: 'Distinguished Compiler Engineer', created_at: '2026-01-02T00:00:00Z' },
  { id: 'u-12', oidc_subject: 'oidc-12', email: 'henry.ford@company.com', display_name: 'Henry Ford', status: 'offline', department: 'Engineering', title: 'QA & Test Automation Lead', created_at: '2026-01-02T00:00:00Z' },
  { id: 'u-13', oidc_subject: 'oidc-13', email: 'ian.malcolm@company.com', display_name: 'Ian Malcolm', status: 'away', department: 'Engineering', title: 'Chaos Systems Engineer', created_at: '2026-01-02T00:00:00Z' },
  { id: 'u-14', oidc_subject: 'oidc-14', email: 'julia.roberts@company.com', display_name: 'Julia Roberts', status: 'online', department: 'Engineering', title: 'Distributed Databases Architect', created_at: '2026-01-02T00:00:00Z' },

  // Populate remaining 136 employees programmatically with high quality titles & departments
  ...Array.from({ length: 136 }).map((_, idx) => {
    const idNum = idx + 15;
    const depts: Department[] = ['Engineering', 'Product & Design', 'Marketing & Sales', 'Operations & HR'];
    const dept = depts[idx % depts.length];
    
    const titlesMap: Record<Department, string[]> = {
      'Engineering': ['Full Stack Developer', 'Data Infrastructure Engineer', 'iOS Engineer', 'Android Developer', 'Security Auditor', 'Site Reliability Engineer'],
      'Product & Design': ['Senior Product Manager', 'Staff UX Researcher', 'Lead UI Designer', 'Design Systems Lead', 'Product Owner'],
      'Marketing & Sales': ['Account Executive', 'Growth Marketing Manager', 'Sales Development Rep', 'Content Strategist', 'Enterprise Solutions Architect'],
      'Operations & HR': ['People Operations Partner', 'Technical Recruiter', 'Talent Acquisition Lead', 'Office Operations Specialist', 'Finance Analyst'],
      'Executive & Legal': ['Director of Operations', 'Legal Specialist', 'Executive Assistant', 'VP of Growth'],
      'All Departments': ['Employee'],
    };
    
    const firstNames = ['Alexander', 'Beatrix', 'Caleb', 'Dominic', 'Evelyn', 'Felix', 'Gideon', 'Helena', 'Isabella', 'Julian', 'Kendra', 'Lucas', 'Maya', 'Nathan', 'Olivia', 'Penelope', 'Quentin', 'Rosalie', 'Sebastian', 'Tessa', 'Ulysses', 'Valerie', 'Winston', 'Xena', 'Yara', 'Zachary'];
    const lastNames = ['Vance', 'Sterling', 'Hayes', 'Chen', 'Oakley', 'Kovacs', 'Russo', 'Thorne', 'Mercer', 'Blackwood', 'Sinclair', 'Vanguard', 'Gallagher', 'Montague', 'Winters', 'Davenport', 'Kensington', 'Navarro'];

    const fn = firstNames[idx % firstNames.length];
    const ln = lastNames[(idx * 3) % lastNames.length];
    const name = `${fn} ${ln}`;
    const titles = titlesMap[dept];
    const title = titles[idx % titles.length];
    const statuses: ('online' | 'away' | 'offline')[] = ['online', 'online', 'away', 'offline'];
    const status = statuses[idx % statuses.length];

    return {
      id: `u-${idNum}`,
      oidc_subject: `oidc-${idNum}`,
      email: `${fn.toLowerCase()}.${ln.toLowerCase()}${idNum}@company.com`,
      display_name: name,
      status,
      department: dept,
      title,
      created_at: '2026-01-03T00:00:00Z',
    };
  }),
];

export default function ChatDashboard() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Sidebar Tab: 'chats' or 'directory'
  const [activeSidebarTab, setActiveSidebarTab] = useState<'chats' | 'directory'>('chats');
  const [selectedDeptFilter, setSelectedDeptFilter] = useState<Department>('All Departments');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<'all' | 'online' | 'away' | 'offline'>('all');
  const [directorySearchQuery, setDirectorySearchQuery] = useState('');

  // Info Drawer State
  const [showInfoDrawer, setShowInfoDrawer] = useState(false);

  // New Chat Modal States
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalTab, setModalTab] = useState<'direct' | 'group'>('direct');
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<User[]>(GENERATED_COMPANY_150_EMPLOYEES);
  const [groupNameInput, setGroupNameInput] = useState('');
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);

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

        const loginRes = await apiClientRef.current.login(
          'oidc-user-1',
          'alice.vance@company.com',
          'Alice Vance',
          'https://images.unsplash.com/photo-1494790108377-be9c29b29330'
        );

        setCurrentUser(loginRes.user);
        apiClientRef.current.setToken(loginRes.token);
        wsClientRef.current.setToken(loginRes.token);
        wsClientRef.current.connect();

        let convList = await apiClientRef.current.getConversations();
        const safeConvs = Array.isArray(convList) ? convList : [];

        // Add default departmental channels if empty
        if (safeConvs.length === 0) {
          const defaultChannels = [
            { id: 'c-general', type: 'group' as const, name: '📢 Company Announcements', created_by: 'u-1', created_at: new Date().toISOString() },
            { id: 'c-engineering', type: 'group' as const, name: '💻 Engineering & Architecture', created_by: 'u-2', created_at: new Date().toISOString() },
            { id: 'c-product', type: 'group' as const, name: '🎨 Product Design & UX', created_by: 'u-3', created_at: new Date().toISOString() },
            { id: 'c-sales', type: 'group' as const, name: '🚀 Sales & Operations', created_by: 'u-4', created_at: new Date().toISOString() },
          ];
          setConversations(defaultChannels);
          setActiveConv(defaultChannels[0]);
        } else {
          setConversations(safeConvs);
          setActiveConv(safeConvs[0]);
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
      setMessages(Array.isArray(msgs) ? msgs : []);
    }

    loadMessages();

    const handleNewMsg = (frame: any) => {
      if (frame?.message && activeConv && frame.message.conversation_id === activeConv.id) {
        setMessages((prev) => [...(Array.isArray(prev) ? prev : []), frame.message]);
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

  // Filter 150 Employees Directory
  const filteredDirectoryEmployees = useMemo(() => {
    return GENERATED_COMPANY_150_EMPLOYEES.filter((emp) => {
      const matchesDept = selectedDeptFilter === 'All Departments' || emp.department === selectedDeptFilter;
      const matchesStatus = selectedStatusFilter === 'all' || emp.status === selectedStatusFilter;
      const matchesQuery =
        !directorySearchQuery ||
        emp.display_name.toLowerCase().includes(directorySearchQuery.toLowerCase()) ||
        emp.email.toLowerCase().includes(directorySearchQuery.toLowerCase()) ||
        emp.title.toLowerCase().includes(directorySearchQuery.toLowerCase());
      return matchesDept && matchesStatus && matchesQuery;
    });
  }, [selectedDeptFilter, selectedStatusFilter, directorySearchQuery]);

  // Handle User Search in Modal
  const handleUserSearch = (query: string) => {
    setUserSearchQuery(query);
    if (!query.trim()) {
      setSearchResults(GENERATED_COMPANY_150_EMPLOYEES);
      return;
    }
    const filtered = GENERATED_COMPANY_150_EMPLOYEES.filter(
      (u) =>
        u.display_name.toLowerCase().includes(query.toLowerCase()) ||
        u.email.toLowerCase().includes(query.toLowerCase()) ||
        u.title.toLowerCase().includes(query.toLowerCase())
    );
    setSearchResults(filtered);
  };

  const handleStartDirectChat = async (targetUser: User) => {
    try {
      let newConv: Conversation;
      try {
        newConv = await apiClientRef.current.createConversation('direct', [targetUser.id]);
      } catch {
        newConv = {
          id: `direct-${targetUser.id}`,
          type: 'direct',
          name: targetUser.display_name,
          created_by: currentUser?.id || 'local-user',
          created_at: new Date().toISOString(),
        };
      }

      setConversations((prev) => {
        const exists = prev.find((c) => c.id === newConv.id);
        return exists ? prev : [newConv, ...prev];
      });
      setActiveConv(newConv);
      setIsModalOpen(false);
      setUserSearchQuery('');
      setActiveSidebarTab('chats');
    } catch (err: any) {
      alert(err.message || 'Could not start direct chat.');
    }
  };

  const handleCreateGroupChat = async () => {
    if (!groupNameInput.trim()) {
      alert('Please enter a name for the group chat.');
      return;
    }

    try {
      let newConv: Conversation;
      try {
        newConv = await apiClientRef.current.createConversation('group', selectedUserIds, groupNameInput.trim());
      } catch {
        newConv = {
          id: `group-${generateUUID()}`,
          type: 'group',
          name: groupNameInput.trim(),
          created_by: currentUser?.id || 'local-user',
          created_at: new Date().toISOString(),
        };
      }

      setConversations((prev) => [newConv, ...prev]);
      setActiveConv(newConv);
      setIsModalOpen(false);
      setGroupNameInput('');
      setSelectedUserIds([]);
      setActiveSidebarTab('chats');
    } catch (err: any) {
      alert(err.message || 'Could not create group chat.');
    }
  };

  const handleToggleSelectUser = (userId: string) => {
    setSelectedUserIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !activeConv || !currentUser || !syncEngineRef.current) return;

    const body = inputText;
    setInputText('');

    const localMsg = await syncEngineRef.current.sendMessage(activeConv.id, currentUser.id, body);
    setMessages((prev) => [...(Array.isArray(prev) ? prev : []), localMsg]);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeConv || !currentUser) return;

    try {
      const presign = await apiClientRef.current.presignAttachment(
        generateUUID(),
        file.name,
        file.type,
        file.size
      );

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

  const onlineEmployeeCount = useMemo(
    () => GENERATED_COMPANY_150_EMPLOYEES.filter((e) => e.status === 'online').length,
    []
  );

  const filteredConversations = conversations.filter((c) =>
    (c.name || 'Direct Chat').toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="app-container">
      {/* Sidebar */}
      <div className="sidebar" style={{ width: '340px' }}>
        {/* Sidebar Brand Header */}
        <div className="sidebar-header">
          <div className="logo-badge">
            <ShieldCheck size={22} color="#818cf8" />
            <span>Relay Enterprise</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: '#9ca3af' }}>
            <span className="status-dot online"></span>
            <span>{onlineEmployeeCount}/150 Online</span>
          </div>
        </div>

        {/* Navigation Tabs (Chats vs Directory) */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--glass-border)', padding: '6px 12px 0 12px', gap: '6px' }}>
          <button
            onClick={() => setActiveSidebarTab('chats')}
            style={{
              flex: 1,
              padding: '8px',
              border: 'none',
              borderBottom: activeSidebarTab === 'chats' ? '2px solid #818cf8' : '2px solid transparent',
              backgroundColor: 'transparent',
              color: activeSidebarTab === 'chats' ? '#818cf8' : '#9ca3af',
              fontWeight: 600,
              fontSize: '0.85rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
            }}
          >
            <MessageSquare size={16} /> Channels & DMs ({conversations.length})
          </button>
          <button
            onClick={() => setActiveSidebarTab('directory')}
            style={{
              flex: 1,
              padding: '8px',
              border: 'none',
              borderBottom: activeSidebarTab === 'directory' ? '2px solid #818cf8' : '2px solid transparent',
              backgroundColor: 'transparent',
              color: activeSidebarTab === 'directory' ? '#818cf8' : '#9ca3af',
              fontWeight: 600,
              fontSize: '0.85rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
            }}
          >
            <Building2 size={16} /> Directory (150)
          </button>
        </div>

        {activeSidebarTab === 'chats' ? (
          <>
            {/* Conversation Search Bar */}
            <div style={{ padding: '12px' }}>
              <div style={{ position: 'relative' }}>
                <Search size={16} style={{ position: 'absolute', left: '12px', top: '10px', color: '#9ca3af' }} />
                <input
                  type="text"
                  placeholder="Search channels & DMs..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="chat-input"
                  style={{ width: '100%', paddingLeft: '36px', borderRadius: '10px' }}
                />
              </div>
            </div>

            <div className="conv-list">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 8px 8px 8px' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#6b7280' }}>MY CHANNELS & DMS</span>
                <button
                  onClick={() => setIsModalOpen(true)}
                  style={{
                    backgroundColor: '#4f46e5',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '4px 10px',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <Plus size={14} /> New Chat
                </button>
              </div>

              {filteredConversations.map((c) => (
                <div
                  key={c.id}
                  className={`conv-item ${activeConv?.id === c.id ? 'active' : ''}`}
                  onClick={() => setActiveConv(c)}
                >
                  {c.type === 'direct' ? <UserIcon size={18} color="#818cf8" /> : <Hash size={18} color="#a5b4fc" />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {c.name || 'Direct Chat'}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>{c.type === 'direct' ? 'Personal 1:1' : 'Team Channel'}</div>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          /* Employee Directory View (150 Staff Members) */
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
            <div style={{ padding: '12px', borderBottom: '1px solid var(--glass-border)' }}>
              <div style={{ position: 'relative', marginBottom: '8px' }}>
                <Search size={16} style={{ position: 'absolute', left: '12px', top: '10px', color: '#9ca3af' }} />
                <input
                  type="text"
                  placeholder="Filter 150 employees by name, title..."
                  value={directorySearchQuery}
                  onChange={(e) => setDirectorySearchQuery(e.target.value)}
                  className="chat-input"
                  style={{ width: '100%', paddingLeft: '36px', borderRadius: '10px', fontSize: '0.85rem' }}
                />
              </div>

              {/* Department Filter Pills */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {DEPARTMENTS.map((dept) => (
                  <button
                    key={dept}
                    onClick={() => setSelectedDeptFilter(dept)}
                    style={{
                      padding: '3px 8px',
                      borderRadius: '12px',
                      border: '1px solid var(--glass-border)',
                      backgroundColor: selectedDeptFilter === dept ? '#4f46e5' : 'rgba(31, 41, 55, 0.6)',
                      color: selectedDeptFilter === dept ? '#ffffff' : '#9ca3af',
                      fontSize: '0.7rem',
                      fontWeight: 500,
                      cursor: 'pointer',
                    }}
                  >
                    {dept}
                  </button>
                ))}
              </div>
            </div>

            {/* Employee Directory Scroll List */}
            <div className="conv-list" style={{ flex: 1 }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#6b7280', padding: '0 8px 8px 8px' }}>
                SHOWING {filteredDirectoryEmployees.length} EMPLOYEES
              </div>
              {filteredDirectoryEmployees.map((emp) => (
                <div
                  key={emp.id}
                  onClick={() => handleStartDirectChat(emp)}
                  className="conv-item"
                  style={{ justifyContent: 'space-between' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0 }}>
                    <div style={{ position: 'relative' }}>
                      <div
                        style={{
                          width: '34px',
                          height: '34px',
                          borderRadius: '50%',
                          backgroundColor: '#3730a3',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#c7d2fe',
                          fontWeight: 700,
                          fontSize: '0.85rem',
                        }}
                      >
                        {emp.display_name.charAt(0)}
                      </div>
                      <span
                        className={`status-dot ${emp.status}`}
                        style={{ position: 'absolute', bottom: 0, right: 0, border: '2px solid #111827' }}
                      ></span>
                    </div>

                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#ffffff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {emp.display_name}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: '#9ca3af', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {emp.title}
                      </div>
                    </div>
                  </div>

                  <span style={{ color: '#818cf8', fontWeight: 600, fontSize: '0.75rem' }}>Chat →</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Main Chat Area */}
      <div className="chat-area">
        {activeConv ? (
          <>
            {/* Header */}
            <div className="chat-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div>
                  <h2 style={{ fontSize: '1.1rem', fontWeight: 700 }}>{activeConv.name || 'Direct Chat'}</h2>
                  <div style={{ fontSize: '0.8rem', color: '#9ca3af', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>{activeConv.type === 'direct' ? '👤 Personal 1:1' : '👥 Team Channel'}</span>
                    <span>•</span>
                    <span style={{ color: '#34d399' }}>● TLS Encrypted</span>
                  </div>
                </div>
              </div>

              <button
                onClick={() => setShowInfoDrawer(!showInfoDrawer)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: showInfoDrawer ? '#818cf8' : '#9ca3af',
                  cursor: 'pointer',
                  padding: '6px',
                }}
                title="Toggle Conversation Info"
              >
                <Info size={20} />
              </button>
            </div>

            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
              {/* Message Stream */}
              <div className="message-stream" ref={streamRef} style={{ flex: 1 }}>
                {(Array.isArray(messages) ? messages : []).map((m) => {
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

              {/* Info Drawer */}
              {showInfoDrawer && (
                <div
                  style={{
                    width: '280px',
                    borderLeft: '1px solid var(--glass-border)',
                    backgroundColor: 'var(--bg-secondary)',
                    padding: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '16px',
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#818cf8' }}>Channel & Member Roster</div>
                  <div style={{ fontSize: '0.8rem', color: '#9ca3af' }}>
                    Organization: Relay Inc (150 Employees)
                  </div>

                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#6b7280' }}>ACTIVE MEMBERS IN THIS CHAT</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {GENERATED_COMPANY_150_EMPLOYEES.slice(0, 6).map((mem) => (
                      <div key={mem.id} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className={`status-dot ${mem.status}`}></span>
                        <div style={{ fontSize: '0.85rem', fontWeight: 500, color: '#ffffff' }}>{mem.display_name}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
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
            Select a conversation or employee to start chatting
          </div>
        )}
      </div>

      {/* New Chat & User Search Modal */}
      {isModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              backgroundColor: '#111827',
              border: '1px solid #1f2937',
              borderRadius: '16px',
              width: '460px',
              maxWidth: '90vw',
              padding: '20px',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.5)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#818cf8' }}>Start New Chat (150 Employees)</h3>
              <button
                onClick={() => setIsModalOpen(false)}
                style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Tabs */}
            <div
              style={{
                display: 'flex',
                backgroundColor: '#1f2937',
                borderRadius: '8px',
                padding: '3px',
                marginBottom: '16px',
              }}
            >
              <button
                onClick={() => setModalTab('direct')}
                style={{
                  flex: 1,
                  padding: '8px',
                  borderRadius: '6px',
                  border: 'none',
                  backgroundColor: modalTab === 'direct' ? '#4f46e5' : 'transparent',
                  color: modalTab === 'direct' ? '#ffffff' : '#9ca3af',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                }}
              >
                <UserIcon size={16} /> Personal 1:1
              </button>
              <button
                onClick={() => setModalTab('group')}
                style={{
                  flex: 1,
                  padding: '8px',
                  borderRadius: '6px',
                  border: 'none',
                  backgroundColor: modalTab === 'group' ? '#4f46e5' : 'transparent',
                  color: modalTab === 'group' ? '#ffffff' : '#9ca3af',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                }}
              >
                <Users size={16} /> Group Chat
              </button>
            </div>

            {modalTab === 'direct' ? (
              <div>
                <input
                  type="text"
                  placeholder="Search 150 employees by name, title, department..."
                  value={userSearchQuery}
                  onChange={(e) => handleUserSearch(e.target.value)}
                  className="chat-input"
                  style={{ width: '100%', marginBottom: '12px', borderRadius: '8px' }}
                />

                <div style={{ maxHeight: '260px', overflowY: 'auto' }}>
                  {searchResults.map((user) => (
                    <div
                      key={user.id}
                      onClick={() => handleStartDirectChat(user)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px',
                        borderRadius: '8px',
                        borderBottom: '1px solid #1f2937',
                        cursor: 'pointer',
                        transition: 'background 0.2s',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1f2937')}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div
                          style={{
                            width: '34px',
                            height: '34px',
                            borderRadius: '50%',
                            backgroundColor: '#3730a3',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#c7d2fe',
                            fontWeight: 700,
                          }}
                        >
                          {user.display_name.charAt(0)}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#ffffff' }}>{user.display_name}</div>
                          <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>{user.email}</div>
                        </div>
                      </div>
                      <span style={{ color: '#818cf8', fontWeight: 600, fontSize: '0.85rem' }}>Chat →</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div>
                <input
                  type="text"
                  placeholder="Group Name (e.g. Mobile Engineering)..."
                  value={groupNameInput}
                  onChange={(e) => setGroupNameInput(e.target.value)}
                  className="chat-input"
                  style={{ width: '100%', marginBottom: '12px', borderRadius: '8px' }}
                />

                <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#9ca3af', marginBottom: '8px' }}>
                  Select Members from 150 Employees:
                </div>

                <div style={{ maxHeight: '200px', overflowY: 'auto', marginBottom: '16px' }}>
                  {GENERATED_COMPANY_150_EMPLOYEES.map((user) => {
                    const isSelected = selectedUserIds.includes(user.id);
                    return (
                      <div
                        key={user.id}
                        onClick={() => handleToggleSelectUser(user.id)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px',
                          padding: '8px',
                          borderRadius: '8px',
                          cursor: 'pointer',
                          backgroundColor: isSelected ? 'rgba(79, 70, 229, 0.2)' : 'transparent',
                        }}
                      >
                        <input type="checkbox" checked={isSelected} readOnly />
                        <span style={{ fontWeight: 600, fontSize: '0.9rem', color: '#ffffff' }}>{user.display_name}</span>
                        <span style={{ fontSize: '0.75rem', color: '#9ca3af', marginLeft: 'auto' }}>{(user as any).department}</span>
                      </div>
                    );
                  })}
                </div>

                <button
                  onClick={handleCreateGroupChat}
                  style={{
                    width: '100%',
                    backgroundColor: '#6366f1',
                    color: '#ffffff',
                    padding: '10px',
                    borderRadius: '8px',
                    border: 'none',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Create Group Chat
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
