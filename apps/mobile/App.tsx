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
} from 'react-native';
import Constants from 'expo-constants';
import { APIClient, WSClient, SyncEngine, MemoryStorageDriver, Conversation, LocalMessage, User } from '@company-chat/shared';
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

      // Populate default offline user & fallback conversation if not logged in
      setCurrentUser((prev) => prev || {
        id: 'offline-user',
        oidc_subject: 'oidc-mobile-user',
        email: 'bob@company.com',
        display_name: 'Bob Smith',
        status: 'offline',
        created_at: new Date().toISOString(),
      });

      const fallbackConv: Conversation = {
        id: 'offline-general',
        type: 'group',
        name: 'General (Offline)',
        created_by: 'offline-user',
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

    // Check server status every 1 minute (60,000 ms)
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
          <Text style={styles.headerTitle}>{activeConv?.name || 'Relay Mobile'}</Text>
          <View style={[styles.statusBadge, isOffline ? styles.badgeOffline : styles.badgeOnline]}>
            <Text style={styles.statusBadgeText}>
              {isOffline ? '● Offline' : '● Online'}
            </Text>
          </View>
        </View>
        <Text style={styles.headerSub}>
          User: {currentUser.display_name}
        </Text>
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
    paddingVertical: 12,
    backgroundColor: '#111827',
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#818cf8',
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
  headerSub: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 2,
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
});
