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
} from 'react-native';
import { APIClient, WSClient, SyncEngine, MemoryStorageDriver, Conversation, LocalMessage, User } from '@company-chat/shared';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [inputText, setInputText] = useState('');

  const apiClientRef = useRef<APIClient>(new APIClient('http://localhost:8080'));
  const wsClientRef = useRef<WSClient>(new WSClient('ws://localhost:8080/ws'));
  const syncEngineRef = useRef<SyncEngine | null>(null);

  useEffect(() => {
    async function init() {
      try {
        const driver = new MemoryStorageDriver();
        await driver.init();

        const syncEngine = new SyncEngine(driver, wsClientRef.current, apiClientRef.current);
        syncEngineRef.current = syncEngine;

        const loginRes = await apiClientRef.current.login(
          'oidc-mobile-user',
          'bob@company.com',
          'Bob Smith',
          ''
        );

        setCurrentUser(loginRes.user);
        apiClientRef.current.setToken(loginRes.token);
        wsClientRef.current.setToken(loginRes.token);
        wsClientRef.current.connect();

        const convs = await apiClientRef.current.getConversations();
        setConversations(convs);
        if (convs.length > 0) {
          setActiveConv(convs[0]);
        }
      } catch (err: any) {
        Alert.alert('Connection Error', err.message);
      }
    }

    init();

    return () => {
      wsClientRef.current.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!activeConv || !syncEngineRef.current) return;

    async function sync() {
      const msgs = await syncEngineRef.current!.syncConversation(activeConv!.id);
      setMessages(msgs);
    }
    sync();

    const handleNew = (frame: any) => {
      if (frame.message && frame.message.conversation_id === activeConv.id) {
        setMessages((prev) => [...prev, frame.message]);
      }
    };

    wsClientRef.current.on('message.new', handleNew);
    return () => {
      wsClientRef.current.off('message.new', handleNew);
    };
  }, [activeConv]);

  const handleSend = async () => {
    if (!inputText.trim() || !activeConv || !currentUser || !syncEngineRef.current) return;

    const body = inputText;
    setInputText('');

    const localMsg = await syncEngineRef.current.sendMessage(activeConv.id, currentUser.id, body);
    setMessages((prev) => [...prev, localMsg]);
  };

  const handleAttachmentTap = async (attachmentId: string, fileName: string) => {
    try {
      const targetPath = `${FileSystem.cacheDirectory}${fileName}`;
      const downloadRes = await FileSystem.downloadAsync(
        `http://localhost:8080/api/attachments/${attachmentId}/download`,
        targetPath
      );

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(downloadRes.uri);
      } else {
        Alert.alert('Download Complete', `File saved to ${downloadRes.uri}`);
      }
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{activeConv?.name || 'Relay Mobile'}</Text>
        <Text style={styles.headerSub}>
          {currentUser ? `Logged in as ${currentUser.display_name}` : 'Connecting...'}
        </Text>
      </View>

      {/* Message List */}
      <FlatList
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.messageList}
        renderItem={({ item }) => {
          const isUser = currentUser && item.sender_id === currentUser.id;
          return (
            <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubblePeer]}>
              <Text style={styles.bubbleText}>{item.body}</Text>
              {item.attachments?.map((att) => (
                <TouchableOpacity
                  key={att.id}
                  style={styles.attachmentChip}
                  onPress={() => handleAttachmentTap(att.id, att.file_name)}
                >
                  <Text style={styles.attachmentText}>📎 {att.file_name}</Text>
                </TouchableOpacity>
              ))}
              <Text style={styles.timeText}>
                {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>
          );
        }}
      />

      {/* Input Bar */}
      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          placeholder="Type a message..."
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
    padding: 16,
    backgroundColor: '#111827',
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
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
  timeText: {
    color: '#a5b4fc',
    fontSize: 10,
    marginTop: 4,
    alignSelf: 'flex-end',
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
