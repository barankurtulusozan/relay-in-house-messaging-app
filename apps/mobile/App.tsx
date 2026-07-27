import React, { useEffect, useState, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  FlatList,
  SafeAreaView,
  StatusBar,
  Alert,
  ActivityIndicator,
  Modal,
  ScrollView,
} from 'react-native';
import Constants from 'expo-constants';
import {
  APIClient,
  WSClient,
  SyncEngine,
  MemoryStorageDriver,
  Conversation,
  LocalMessage,
  User,
  generateUUID,
} from '@company-chat/shared';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';

function getBackendHost(): string {
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL.replace(/\/$/, '');
  }

  const hostUri = Constants.expoConfig?.hostUri || (Constants as any).developerLauncherConfig?.hostUri;
  if (hostUri) {
    const host = hostUri.split(':')[0];
    if (host && host !== 'localhost' && host !== '127.0.0.1') {
      return `http://${host}:8080`;
    }
  }

  return 'http://localhost:8080';
}

function getBackendWSHost(): string {
  const httpUrl = getBackendHost();
  return httpUrl.replace(/^http/, 'ws') + '/ws';
}

const DEFAULT_COMPANY_USERS: User[] = [
  {
    id: 'user-alice',
    oidc_subject: 'oidc-alice',
    email: 'alice@company.com',
    display_name: 'Alice Vance',
    status: 'online',
    created_at: new Date().toISOString(),
  },
  {
    id: 'user-charlie',
    oidc_subject: 'oidc-charlie',
    email: 'charlie@company.com',
    display_name: 'Charlie Davis',
    status: 'online',
    created_at: new Date().toISOString(),
  },
  {
    id: 'user-diana',
    oidc_subject: 'oidc-diana',
    email: 'diana@company.com',
    display_name: 'Diana Prince',
    status: 'away',
    created_at: new Date().toISOString(),
  },
  {
    id: 'user-evan',
    oidc_subject: 'oidc-evan',
    email: 'evan@company.com',
    display_name: 'Evan Wright',
    status: 'offline',
    created_at: new Date().toISOString(),
  },
];

export default function App() {
  const [currentUser, setCurrentUser] = useState<User>({
    id: 'local-user',
    oidc_subject: 'oidc-mobile-user',
    email: 'bob@company.com',
    display_name: 'Bob Smith',
    status: 'offline',
    created_at: new Date().toISOString(),
  });
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isOffline, setIsOffline] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);

  // New Chat Modal States
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalTab, setModalTab] = useState<'direct' | 'group'>('direct');
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<User[]>(DEFAULT_COMPANY_USERS);
  const [isSearchingUsers, setIsSearchingUsers] = useState(false);
  const [groupNameInput, setGroupNameInput] = useState('');
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);

  const apiClientRef = useRef<APIClient>(new APIClient(getBackendHost()));
  const wsClientRef = useRef<WSClient>(new WSClient(getBackendWSHost()));
  const syncEngineRef = useRef<SyncEngine | null>(null);

  const connectAndLoad = async (showLoader = false) => {
    if (showLoader) setIsReconnecting(true);

    try {
      if (!syncEngineRef.current) {
        const driver = new MemoryStorageDriver();
        await driver.init();
        syncEngineRef.current = new SyncEngine(driver, wsClientRef.current, apiClientRef.current);
      }

      const loginRes = await apiClientRef.current.login(
        'oidc-mobile-user',
        'bob@company.com',
        'Bob Smith',
        ''
      );

      if (loginRes?.user) {
        setCurrentUser(loginRes.user);
        apiClientRef.current.setToken(loginRes.token);
        wsClientRef.current.setToken(loginRes.token);
        wsClientRef.current.connect();
      }

      const convs = await apiClientRef.current.getConversations();
      const safeConvs = Array.isArray(convs) ? convs : [];
      setConversations(safeConvs);

      if (safeConvs.length > 0) {
        setActiveConv((prev) => prev || safeConvs[0]);
      }

      setIsOffline(false);
    } catch (err: any) {
      setIsOffline(true);

      const fallbackConv: Conversation = {
        id: 'default-general',
        type: 'group',
        name: 'General Chat',
        created_by: 'local-user',
        created_at: new Date().toISOString(),
      };

      setConversations((prev) => (Array.isArray(prev) && prev.length > 0 ? prev : [fallbackConv]));
      setActiveConv((prev) => prev || fallbackConv);
    } finally {
      setIsReconnecting(false);
    }
  };

  useEffect(() => {
    connectAndLoad(false);

    const checkInterval = setInterval(() => {
      connectAndLoad(false);
    }, 60000);

    const onConnected = () => setIsOffline(false);
    const onDisconnected = () => setIsOffline(true);

    wsClientRef.current.on('connected', onConnected);
    wsClientRef.current.on('disconnected', onDisconnected);

    return () => {
      clearInterval(checkInterval);
      wsClientRef.current.off('connected', onConnected);
      wsClientRef.current.off('disconnected', onDisconnected);
      wsClientRef.current.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!activeConv || !syncEngineRef.current) return;

    let isMounted = true;
    async function sync() {
      if (!activeConv || !syncEngineRef.current) return;
      const msgs = await syncEngineRef.current.syncConversation(activeConv.id);
      if (isMounted) {
        setMessages(Array.isArray(msgs) ? msgs : []);
      }
    }
    sync();

    const handleNew = (frame: any) => {
      if (frame?.message && activeConv && frame.message.conversation_id === activeConv.id) {
        setMessages((prev) => [...(Array.isArray(prev) ? prev : []), frame.message]);
      }
    };

    wsClientRef.current.on('message.new', handleNew);
    return () => {
      isMounted = false;
      wsClientRef.current.off('message.new', handleNew);
    };
  }, [activeConv]);

  // User Search Functionality
  const handleUserSearch = async (query: string) => {
    setUserSearchQuery(query);
    if (!query.trim()) {
      setSearchResults(DEFAULT_COMPANY_USERS);
      return;
    }

    setIsSearchingUsers(true);
    try {
      if (!isOffline) {
        const users = await apiClientRef.current.searchUsers(query);
        const filtered = users.filter((u) => u.id !== currentUser.id);
        setSearchResults(filtered.length > 0 ? filtered : DEFAULT_COMPANY_USERS.filter((u) =>
          u.display_name.toLowerCase().includes(query.toLowerCase()) ||
          u.email.toLowerCase().includes(query.toLowerCase())
        ));
      } else {
        const filtered = DEFAULT_COMPANY_USERS.filter((u) =>
          u.display_name.toLowerCase().includes(query.toLowerCase()) ||
          u.email.toLowerCase().includes(query.toLowerCase())
        );
        setSearchResults(filtered);
      }
    } catch (e) {
      // Fallback local search
      const filtered = DEFAULT_COMPANY_USERS.filter((u) =>
        u.display_name.toLowerCase().includes(query.toLowerCase()) ||
        u.email.toLowerCase().includes(query.toLowerCase())
      );
      setSearchResults(filtered);
    } finally {
      setIsSearchingUsers(false);
    }
  };

  // Start 1:1 Personal Chat
  const handleStartDirectChat = async (targetUser: User) => {
    try {
      let newConv: Conversation;
      if (!isOffline) {
        newConv = await apiClientRef.current.createConversation('direct', [targetUser.id]);
      } else {
        newConv = {
          id: `direct-${targetUser.id}`,
          type: 'direct',
          name: targetUser.display_name,
          created_by: currentUser.id,
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
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not start chat.');
    }
  };

  // Create Group Chat
  const handleCreateGroupChat = async () => {
    if (!groupNameInput.trim()) {
      Alert.alert('Required', 'Please enter a name for the group chat.');
      return;
    }

    try {
      let newConv: Conversation;
      if (!isOffline) {
        newConv = await apiClientRef.current.createConversation('group', selectedUserIds, groupNameInput.trim());
      } else {
        newConv = {
          id: `group-${generateUUID()}`,
          type: 'group',
          name: groupNameInput.trim(),
          created_by: currentUser.id,
          created_at: new Date().toISOString(),
        };
      }

      setConversations((prev) => [newConv, ...prev]);
      setActiveConv(newConv);
      setIsModalOpen(false);
      setGroupNameInput('');
      setSelectedUserIds([]);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not create group.');
    }
  };

  const handleToggleSelectUser = (userId: string) => {
    setSelectedUserIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const handleSend = async () => {
    if (!inputText.trim() || !activeConv || !currentUser || !syncEngineRef.current) return;

    const body = inputText;
    setInputText('');

    try {
      await syncEngineRef.current.sendMessage(activeConv.id, currentUser.id, body);
      const updatedMsgs = await syncEngineRef.current.syncConversation(activeConv.id);
      setMessages(updatedMsgs);
    } catch (err) {
      console.warn('[Send error]', err);
    }
  };

  const handleAttachmentTap = async (attachmentId: string, fileName: string) => {
    if (isOffline) {
      Alert.alert(
        'Offline Mode',
        'Attachments cannot be downloaded while offline. Please reconnect to the server and try again.'
      );
      return;
    }

    try {
      const targetPath = `${FileSystem.cacheDirectory}${fileName}`;
      const downloadRes = await FileSystem.downloadAsync(
        `${getBackendHost()}/api/attachments/${attachmentId}/download`,
        targetPath
      );

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(downloadRes.uri);
      } else {
        Alert.alert('Download Complete', `File saved to ${downloadRes.uri}`);
      }
    } catch (e: any) {
      Alert.alert('Download Failed', e.message || 'Could not download attachment.');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View>
            <Text style={styles.headerTitle}>{activeConv?.name || 'Relay Mobile'}</Text>
            <Text style={styles.headerSub}>User: {currentUser.display_name}</Text>
          </View>

          <View style={styles.headerRight}>
            <TouchableOpacity style={styles.newChatBtn} onPress={() => setIsModalOpen(true)}>
              <Text style={styles.newChatBtnText}>+ New Chat</Text>
            </TouchableOpacity>
            <View style={[styles.statusBadge, isOffline ? styles.badgeOffline : styles.badgeOnline]}>
              <Text style={styles.statusBadgeText}>{isOffline ? '● Offline' : '● Online'}</Text>
            </View>
          </View>
        </View>

        {/* Conversation Switcher Bar */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.convBar}>
          {conversations.map((conv) => {
            const isActive = activeConv?.id === conv.id;
            const isDirect = conv.type === 'direct';
            return (
              <TouchableOpacity
                key={conv.id}
                style={[styles.convPill, isActive && styles.convPillActive]}
                onPress={() => setActiveConv(conv)}
              >
                <Text style={[styles.convPillText, isActive && styles.convPillTextActive]}>
                  {isDirect ? '👤 ' : '👥 '}
                  {conv.name || 'Chat'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Non-distracting Offline Status Banner */}
      {isOffline && (
        <TouchableOpacity
          style={styles.offlineBanner}
          onPress={() => connectAndLoad(true)}
          disabled={isReconnecting}
          activeOpacity={0.8}
        >
          {isReconnecting ? (
            <View style={styles.bannerContent}>
              <ActivityIndicator size="small" color="#fbbf24" style={{ marginRight: 8 }} />
              <Text style={styles.offlineBannerText}>Connecting to server...</Text>
            </View>
          ) : (
            <Text style={styles.offlineBannerText}>
              📡 Server offline — Working locally (Auto-checks every 1m). <Text style={styles.retryText}>Tap to Retry</Text>
            </Text>
          )}
        </TouchableOpacity>
      )}

      {/* Message List */}
      <FlatList
        data={Array.isArray(messages) ? messages : []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.messageList}
        renderItem={({ item }) => {
          const isUser = currentUser && item.sender_id === currentUser.id;
          const isPending = item.status === 'sending';
          return (
            <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubblePeer]}>
              <Text style={styles.bubbleText}>{item.body}</Text>
              {Array.isArray(item.attachments) &&
                item.attachments.map((att) => (
                  <TouchableOpacity
                    key={att.id}
                    style={styles.attachmentChip}
                    onPress={() => handleAttachmentTap(att.id, att.file_name)}
                  >
                    <Text style={styles.attachmentText}>📎 {att.file_name}</Text>
                  </TouchableOpacity>
                ))}
              <View style={styles.timeContainer}>
                <Text style={styles.timeText}>
                  {item.created_at
                    ? new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    : ''}
                </Text>
                {isUser && (
                  <Text style={isPending ? styles.pendingTag : styles.sentTag}>
                    {isPending ? ' ⏳ Pending (Offline)' : ' ✓ Sent'}
                  </Text>
                )}
              </View>
            </View>
          );
        }}
      />

      {/* Input Bar */}
      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          placeholder={isOffline ? 'Type message (saved locally)...' : 'Type a message...'}
          placeholderTextColor="#6b7280"
          value={inputText}
          onChangeText={setInputText}
        />
        <TouchableOpacity style={styles.sendButton} onPress={handleSend}>
          <Text style={styles.sendText}>Send</Text>
        </TouchableOpacity>
      </View>

      {/* New Chat Modal (User Search & Group Creation) */}
      <Modal visible={isModalOpen} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Start New Chat</Text>
              <TouchableOpacity onPress={() => setIsModalOpen(false)}>
                <Text style={styles.modalCloseBtn}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Modal Tabs */}
            <View style={styles.modalTabs}>
              <TouchableOpacity
                style={[styles.modalTab, modalTab === 'direct' && styles.modalTabActive]}
                onPress={() => setModalTab('direct')}
              >
                <Text style={[styles.modalTabText, modalTab === 'direct' && styles.modalTabTextActive]}>
                  👤 Personal 1:1
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalTab, modalTab === 'group' && styles.modalTabActive]}
                onPress={() => setModalTab('group')}
              >
                <Text style={[styles.modalTabText, modalTab === 'group' && styles.modalTabTextActive]}>
                  👥 Group Chat
                </Text>
              </TouchableOpacity>
            </View>

            {modalTab === 'direct' ? (
              <View style={styles.modalBody}>
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search user by name or email..."
                  placeholderTextColor="#9ca3af"
                  value={userSearchQuery}
                  onChangeText={handleUserSearch}
                />
                {isSearchingUsers && <ActivityIndicator color="#818cf8" style={{ marginVertical: 10 }} />}

                <FlatList
                  data={searchResults}
                  keyExtractor={(u) => u.id}
                  style={{ maxHeight: 260 }}
                  renderItem={({ item }) => (
                    <TouchableOpacity style={styles.userRow} onPress={() => handleStartDirectChat(item)}>
                      <View style={styles.avatarCircle}>
                        <Text style={styles.avatarText}>{item.display_name.charAt(0)}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.userName}>{item.display_name}</Text>
                        <Text style={styles.userEmail}>{item.email}</Text>
                      </View>
                      <Text style={styles.startBtnText}>Chat →</Text>
                    </TouchableOpacity>
                  )}
                />
              </View>
            ) : (
              <View style={styles.modalBody}>
                <TextInput
                  style={styles.searchInput}
                  placeholder="Group Name (e.g. Mobile Devs)..."
                  placeholderTextColor="#9ca3af"
                  value={groupNameInput}
                  onChangeText={setGroupNameInput}
                />
                <Text style={styles.sectionLabel}>Select Members:</Text>
                <FlatList
                  data={DEFAULT_COMPANY_USERS}
                  keyExtractor={(u) => u.id}
                  style={{ maxHeight: 180 }}
                  renderItem={({ item }) => {
                    const isSelected = selectedUserIds.includes(item.id);
                    return (
                      <TouchableOpacity
                        style={[styles.userRow, isSelected && styles.userRowSelected]}
                        onPress={() => handleToggleSelectUser(item.id)}
                      >
                        <Text style={styles.checkIcon}>{isSelected ? '☑' : '☐'}</Text>
                        <Text style={styles.userName}>{item.display_name}</Text>
                      </TouchableOpacity>
                    );
                  }}
                />
                <TouchableOpacity style={styles.createGroupBtn} onPress={handleCreateGroupChat}>
                  <Text style={styles.createGroupBtnText}>Create Group Chat</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b0f19',
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    backgroundColor: '#111827',
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#818cf8',
  },
  headerSub: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 2,
  },
  newChatBtn: {
    backgroundColor: '#4f46e5',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    marginRight: 8,
  },
  newChatBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  badgeOnline: {
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
  },
  badgeOffline: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#34d399',
  },
  convBar: {
    marginTop: 10,
    flexDirection: 'row',
  },
  convPill: {
    backgroundColor: '#1f2937',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#374151',
  },
  convPillActive: {
    backgroundColor: '#4f46e5',
    borderColor: '#6366f1',
  },
  convPillText: {
    color: '#9ca3af',
    fontSize: 13,
    fontWeight: '500',
  },
  convPillTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
  offlineBanner: {
    backgroundColor: '#1e1b4b',
    borderColor: '#3730a3',
    borderBottomWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  offlineBannerText: {
    color: '#c7d2fe',
    fontSize: 12,
    fontWeight: '500',
  },
  retryText: {
    color: '#818cf8',
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  messageList: {
    padding: 16,
  },
  bubble: {
    maxWidth: '75%',
    padding: 12,
    borderRadius: 14,
    marginBottom: 10,
  },
  bubbleUser: {
    alignSelf: 'flex-end',
    backgroundColor: '#4f46e5',
  },
  bubblePeer: {
    alignSelf: 'flex-start',
    backgroundColor: '#1f2937',
  },
  bubbleText: {
    color: '#ffffff',
    fontSize: 15,
  },
  timeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 4,
  },
  timeText: {
    color: '#a5b4fc',
    fontSize: 10,
  },
  pendingTag: {
    color: '#fbbf24',
    fontSize: 10,
    fontWeight: '600',
    marginLeft: 4,
  },
  sentTag: {
    color: '#34d399',
    fontSize: 10,
    fontWeight: '600',
    marginLeft: 4,
  },
  attachmentChip: {
    marginTop: 6,
    padding: 6,
    backgroundColor: 'rgba(0,0,0,0.2)',
    borderRadius: 6,
  },
  attachmentText: {
    color: '#c7d2fe',
    fontSize: 13,
  },
  inputBar: {
    flexDirection: 'row',
    padding: 12,
    backgroundColor: '#111827',
    borderTopWidth: 1,
    borderTopColor: '#1f2937',
  },
  input: {
    flex: 1,
    backgroundColor: '#1f2937',
    color: '#ffffff',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    fontSize: 15,
  },
  sendButton: {
    marginLeft: 10,
    backgroundColor: '#6366f1',
    borderRadius: 20,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  sendText: {
    color: '#ffffff',
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContainer: {
    width: '100%',
    backgroundColor: '#111827',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#818cf8',
  },
  modalCloseBtn: {
    color: '#9ca3af',
    fontSize: 18,
    fontWeight: '700',
  },
  modalTabs: {
    flexDirection: 'row',
    marginBottom: 12,
    backgroundColor: '#1f2937',
    borderRadius: 8,
    padding: 3,
  },
  modalTab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 6,
  },
  modalTabActive: {
    backgroundColor: '#4f46e5',
  },
  modalTabText: {
    color: '#9ca3af',
    fontSize: 13,
    fontWeight: '600',
  },
  modalTabTextActive: {
    color: '#ffffff',
  },
  modalBody: {
    marginTop: 4,
  },
  searchInput: {
    backgroundColor: '#1f2937',
    color: '#ffffff',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    fontSize: 14,
    marginBottom: 12,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
  },
  userRowSelected: {
    backgroundColor: 'rgba(79, 70, 229, 0.2)',
    borderRadius: 8,
  },
  avatarCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#3730a3',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  avatarText: {
    color: '#c7d2fe',
    fontWeight: '700',
  },
  userName: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  userEmail: {
    color: '#9ca3af',
    fontSize: 12,
  },
  startBtnText: {
    color: '#818cf8',
    fontWeight: '700',
    fontSize: 13,
  },
  sectionLabel: {
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  checkIcon: {
    color: '#818cf8',
    fontSize: 16,
    marginRight: 10,
  },
  createGroupBtn: {
    backgroundColor: '#6366f1',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 14,
  },
  createGroupBtnText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
  },
});
