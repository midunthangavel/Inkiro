import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Modal, View, Text, FlatList, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, StyleSheet, SafeAreaView, ActivityIndicator,
} from 'react-native';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import api from '../lib/api';
import { getSocket } from '../lib/socket';
import MessageBubble from './MessageBubble';
import QuickReplies from './QuickReplies';
import VoiceRecordButton from './VoiceRecordButton';

/**
 * Full-screen chat modal for in-order conversations.
 *
 * Props:
 *   visible       boolean
 *   onClose       () => void
 *   orderId       string
 *   myType        'customer' | 'shop' | 'runner'
 *   myId          string
 *   otherType     'customer' | 'shop' | 'runner'
 *   otherId       string
 *   otherName     string
 */
export default function ChatModal({ visible, onClose, orderId, myType, myId, otherType, otherId, otherName }) {
  const [conv, setConv]           = useState(null);
  const [messages, setMessages]   = useState([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(false);
  const [recording, setRecording] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [quickReplies, setQuickReplies] = useState([]);
  const listRef = useRef(null);

  // Open or fetch conversation when modal becomes visible
  useEffect(() => {
    if (!visible || !orderId || !myId || !otherId) return;
    let cancelled = false;

    setError(false);
    (async () => {
      setLoading(true);
      try {
        const { data } = await api.post('/messages/conversations/open', {
          order_id: orderId, my_type: myType, my_id: myId, other_type: otherType, other_id: otherId,
        });
        if (cancelled) return;
        setConv(data.conversation);

        const [msgsRes, repliesRes] = await Promise.all([
          api.get(`/messages/conversations/${data.conversation.id}/messages`),
          api.get(`/messages/quick-replies?type=${myType}`),
        ]);
        if (cancelled) return;
        setMessages(msgsRes.data.messages || []);
        setQuickReplies(repliesRes.data.replies || []);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [visible, orderId, myId, otherId]);

  // Mark as read when conv loaded
  useEffect(() => {
    if (!conv) return;
    api.post(`/messages/conversations/${conv.id}/read`, { reader_type: myType, reader_id: myId }).catch(() => {});
  }, [conv?.id]);

  // Socket listener for incoming messages
  useEffect(() => {
    if (!conv) return;
    const socket = getSocket();

    const handler = (data) => {
      if (data.conversation_id !== conv.id) return;
      setMessages(prev => [...prev, data.message]);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      api.post(`/messages/conversations/${conv.id}/read`, { reader_type: myType, reader_id: myId }).catch(() => {});
    };

    const readHandler = (data) => {
      if (data.conversation_id !== conv.id) return;
      setMessages(prev => prev.map(m => m.sender_type === myType ? { ...m, is_read: true } : m));
    };

    socket.on('message:new',  handler);
    socket.on('message:read', readHandler);
    return () => { socket.off('message:new', handler); socket.off('message:read', readHandler); };
  }, [conv?.id, myType, myId]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
    }
  }, [messages.length]);

  const sendText = useCallback(async (text) => {
    const t = (text || inputText).trim();
    if (!t || !conv) return;
    setInputText('');

    const temp = {
      id: `tmp-${Date.now()}`, conversation_id: conv.id,
      sender_type: myType, sender_id: myId,
      message_type: 'text', text_content: t, is_read: false,
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, temp]);

    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      await api.post(`/messages/conversations/${conv.id}/messages`, {
        sender_type: myType, sender_id: myId, text: t,
      });
    } catch {
      setMessages(prev => prev.filter(m => m.id !== temp.id));
    }
  }, [inputText, conv, myType, myId]);

  const startRecording = async () => {
    try {
      await Audio.requestPermissionsAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording: rec } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      setRecording(rec);
      setIsRecording(true);
    } catch { /* permission denied */ }
  };

  const stopRecording = async () => {
    if (!recording || !conv) return;
    setIsRecording(false);
    await recording.stopAndUnloadAsync();
    const uri = recording.getURI();
    setRecording(null);

    try {
      const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      await api.post(`/messages/conversations/${conv.id}/voice`, {
        sender_type: myType, sender_id: myId, audio_base64: b64, mime_type: 'audio/m4a',
      });
    } catch { /* ignore upload error */ }
  };

  const renderItem = ({ item }) => (
    <MessageBubble message={item} isMine={item.sender_type === myType} />
  );

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={s.safe}>
        {/* Header */}
        <View style={s.header}>
          <TouchableOpacity onPress={onClose} style={s.closeBtn}>
            <Text style={s.closeText}>✕</Text>
          </TouchableOpacity>
          <View style={s.headerCenter}>
            <Text style={s.headerName}>{otherName || otherType}</Text>
            <Text style={s.headerSub}>Order #{orderId?.slice(-6)?.toUpperCase()}</Text>
          </View>
          <View style={{ width: 36 }} />
        </View>

        {/* Messages */}
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={0}
        >
          {loading ? (
            <View style={s.loader}><ActivityIndicator color="#22c55e" /></View>
          ) : error ? (
            <View style={s.loader}>
              <Text style={{ color: '#999', fontSize: 14, textAlign: 'center', marginBottom: 12 }}>
                Couldn't load chat.
              </Text>
              <TouchableOpacity onPress={() => { setError(false); setLoading(true); }}>
                <Text style={{ color: '#22c55e', fontWeight: '600', fontSize: 14 }}>Tap to retry</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <FlatList
              ref={listRef}
              data={messages}
              renderItem={renderItem}
              keyExtractor={item => item.id}
              contentContainerStyle={s.list}
              onContentSizeChange={() => listRef.current?.scrollToEnd()}
              ListEmptyComponent={
                <View style={s.empty}>
                  <Text style={s.emptyText}>No messages yet — say hello!</Text>
                </View>
              }
            />
          )}

          {/* Quick replies */}
          <QuickReplies replies={quickReplies} onPress={(r) => sendText(r.text)} />

          {/* Input bar */}
          <View style={s.inputBar}>
            <VoiceRecordButton isRecording={isRecording} onStart={startRecording} onStop={stopRecording} />
            <TextInput
              style={s.input}
              value={inputText}
              onChangeText={setInputText}
              placeholder="Message…"
              placeholderTextColor="#aaa"
              multiline
              maxLength={500}
              returnKeyType="send"
              blurOnSubmit={false}
              onSubmitEditing={() => sendText()}
            />
            <TouchableOpacity
              style={[s.sendBtn, { opacity: inputText.trim().length > 0 ? 1 : 0.35 }]}
              onPress={() => sendText()}
              disabled={inputText.trim().length === 0}
            >
              <Text style={s.sendIcon}>↑</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const s = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: '#fff' },
  header:     {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16,
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
  },
  closeBtn:   { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  closeText:  { fontSize: 16, color: '#666' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerName: { fontSize: 16, fontWeight: '600', color: '#1a1a1a' },
  headerSub:  { fontSize: 12, color: '#999', marginTop: 2 },
  loader:     { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list:       { padding: 16, flexGrow: 1, paddingBottom: 8 },
  empty:      { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 80 },
  emptyText:  { color: '#bbb', fontSize: 15 },
  inputBar:   {
    flexDirection: 'row', alignItems: 'flex-end', padding: 10,
    borderTopWidth: 1, borderTopColor: '#f0f0f0', backgroundColor: '#fff',
  },
  input:      {
    flex: 1, backgroundColor: '#f5f5f5', borderRadius: 22,
    paddingHorizontal: 16, paddingVertical: 9, maxHeight: 100, fontSize: 15,
  },
  sendBtn:    {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#22c55e',
    alignItems: 'center', justifyContent: 'center', marginLeft: 8,
  },
  sendIcon:   { color: '#fff', fontSize: 20, fontWeight: '700' },
});
