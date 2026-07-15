import { useState, useEffect, useRef, useCallback } from 'react';
import api from '@/lib/api';
import { getSocket } from '@/lib/socket';

/**
 * Web chat panel for shop↔customer conversations.
 * Props: open, onClose, orderId, myType, myId, otherType, otherId, otherName
 */
export default function ChatModal({ open, onClose, orderId, myType, myId, otherType, otherId, otherName }) {
  const [conv, setConv]         = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputText, setInput]   = useState('');
  const [loading, setLoading]   = useState(true);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open || !orderId || !myId || !otherId) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const { data } = await api.post('/messages/conversations/open', {
          order_id: orderId, my_type: myType, my_id: myId, other_type: otherType, other_id: otherId,
        });
        if (cancelled) return;
        setConv(data.conversation);

        const msgsRes = await api.get(`/messages/conversations/${data.conversation.id}/messages`);
        if (cancelled) return;
        setMessages(msgsRes.data.messages || []);

        api.post(`/messages/conversations/${data.conversation.id}/read`, { reader_type: myType, reader_id: myId }).catch(() => {});
      } catch {
        // empty chat on error
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [open, orderId, myId, otherId]);

  useEffect(() => {
    if (!conv) return;
    const socket = getSocket();

    const handler = (data) => {
      if (data.conversation_id !== conv.id) return;
      setMessages(prev => [...prev, data.message]);
      api.post(`/messages/conversations/${conv.id}/read`, { reader_type: myType, reader_id: myId }).catch(() => {});
    };

    const readHandler = (data) => {
      if (data.conversation_id !== conv.id) return;
      setMessages(prev => prev.map(m => m.sender_type === myType ? { ...m, is_read: true } : m));
    };

    socket.on('message:new', handler);
    socket.on('message:read', readHandler);
    return () => { socket.off('message:new', handler); socket.off('message:read', readHandler); };
  }, [conv?.id, myType, myId]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }), 60);
    }
  }, [messages.length]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 200);
  }, [open]);

  const sendText = useCallback(async () => {
    const t = inputText.trim();
    if (!t || !conv) return;
    setInput('');

    const temp = {
      id: `tmp-${Date.now()}`, conversation_id: conv.id,
      sender_type: myType, sender_id: myId,
      message_type: 'text', text_content: t, is_read: false,
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, temp]);

    try {
      await api.post(`/messages/conversations/${conv.id}/messages`, {
        sender_type: myType, sender_id: myId, text: t,
      });
    } catch {
      setMessages(prev => prev.filter(m => m.id !== temp.id));
    }
  }, [inputText, conv, myType, myId]);

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(); }
  }

  if (!open) return null;

  const shortId = orderId ? `#${String(orderId).replace(/-/g, '').slice(0, 6).toUpperCase()}` : '';

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.25)' }} onClick={onClose} />
      <div
        style={{
          position: 'relative', zIndex: 1,
          width: 380, height: '70vh', maxHeight: 600,
          display: 'flex', flexDirection: 'column',
          backgroundColor: '#fff', borderRadius: '16px 16px 0 0',
          boxShadow: '0 -4px 32px rgba(0,0,0,0.12)',
          margin: '0 24px',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '14px 16px', borderBottom: '1px solid #f0f0f0', gap: 10 }}>
          <button
            onClick={onClose}
            style={{ width: 28, height: 28, borderRadius: '50%', border: 'none', background: '#f5f5f5', cursor: 'pointer', fontSize: 14, color: '#666' }}
          >
            ✕
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a' }}>{otherName || otherType}</div>
            <div style={{ fontSize: 11, color: '#999', marginTop: 1 }}>Order {shortId}</div>
          </div>
        </div>

        {/* Messages */}
        <div
          ref={listRef}
          style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}
        >
          {loading ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#aaa', fontSize: 13 }}>
              Loading…
            </div>
          ) : messages.length === 0 ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb', fontSize: 14 }}>
              No messages yet
            </div>
          ) : (
            messages.map(m => {
              const isMine = m.sender_type === myType;
              const isSystem = m.sender_type === 'system' || m.message_type === 'system';
              if (isSystem) {
                return (
                  <div key={m.id} style={{ textAlign: 'center', fontSize: 11, color: '#aaa', padding: '2px 8px' }}>
                    {m.text_content}
                  </div>
                );
              }
              return (
                <div key={m.id} style={{ display: 'flex', justifyContent: isMine ? 'flex-end' : 'flex-start' }}>
                  <div
                    style={{
                      maxWidth: '72%', padding: '8px 12px', borderRadius: isMine ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                      backgroundColor: isMine ? '#22c55e' : '#f3f4f6',
                      color: isMine ? '#fff' : '#1a1a1a',
                      fontSize: 13, lineHeight: '1.4',
                    }}
                  >
                    {m.text_content}
                    {isMine && (
                      <span style={{ marginLeft: 6, fontSize: 10, opacity: 0.75 }}>
                        {m.is_read ? '✓✓' : '✓'}
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Input */}
        <div style={{ display: 'flex', alignItems: 'flex-end', padding: '10px 12px', borderTop: '1px solid #f0f0f0', gap: 8 }}>
          <textarea
            ref={inputRef}
            value={inputText}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message…"
            rows={1}
            style={{
              flex: 1, resize: 'none', border: 'none', outline: 'none',
              backgroundColor: '#f5f5f5', borderRadius: 18,
              padding: '8px 14px', fontSize: 14, lineHeight: '1.4',
              maxHeight: 80, overflowY: 'auto', fontFamily: 'inherit',
            }}
          />
          {inputText.trim().length > 0 && (
            <button
              onClick={sendText}
              style={{
                width: 36, height: 36, borderRadius: '50%', border: 'none',
                backgroundColor: '#22c55e', color: '#fff', cursor: 'pointer',
                fontSize: 18, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              ↑
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
