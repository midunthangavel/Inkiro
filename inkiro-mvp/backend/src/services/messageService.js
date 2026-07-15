'use strict';

const { db }                                   = require('../db');
const { emitToShop, emitToRunner, emitToCustomer } = require('../socket/index');
const { sendPush }                             = require('./notificationService');
const EVENTS                                   = require('../socket/events');
const logger                                   = require('../utils/logger');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _normalizeParticipants(t1, i1, t2, i2) {
  // Ensure consistent ordering so UNIQUE constraint is always satisfied
  if ((t1 + i1) <= (t2 + i2)) return [t1, i1, t2, i2];
  return [t2, i2, t1, i1];
}

async function _getUserIdFor(type, id) {
  if (type === 'customer') return id; // customer_id IS user_id
  if (type === 'shop') {
    const { data } = await db.from('shops').select('user_id').eq('id', id).maybeSingle();
    return data?.user_id || null;
  }
  if (type === 'runner') {
    const { data } = await db.from('runners').select('user_id').eq('id', id).maybeSingle();
    return data?.user_id || null;
  }
  return null;
}

async function _getDisplayName(type, id) {
  if (type === 'shop') {
    const { data } = await db.from('shops').select('shop_name').eq('id', id).maybeSingle();
    return data?.shop_name || 'Shop';
  }
  if (type === 'system') return 'Inkiro';
  const { data } = await db.from('users').select('name').eq('id', id).maybeSingle();
  return data?.name || (type === 'runner' ? 'Runner' : 'Customer');
}

function _emitToParticipant(type, id, event, payload) {
  if (type === 'shop')     emitToShop(id, event, payload);
  else if (type === 'runner')   emitToRunner(id, event, payload);
  else if (type === 'customer') emitToCustomer(id, event, payload);
}

async function _sendPushToParticipant(type, id, title, body, data) {
  try {
    const userId = await _getUserIdFor(type, id);
    if (!userId) return;
    const { data: tokenRows } = await db
      .from('push_tokens')
      .select('token')
      .eq('user_id', userId)
      .eq('is_active', true);
    if (tokenRows && tokenRows.length > 0) {
      await sendPush(tokenRows, title, body, data);
    }
  } catch (err) {
    logger.warn({ err, type, id }, 'Chat push failed');
  }
}

// ─── getConversationForUser ───────────────────────────────────────────────────
// Resolves a conversation and verifies the calling user is a participant.
// Throws 404 if not found, 403 if not a participant.
// Used by routes/messages.js to prevent IDOR on every conversation endpoint.

async function _resolveParticipantId(userId, userType) {
  if (userType === 'customer') return userId;
  const table = userType === 'shop' ? 'shops' : 'runners';
  const { data } = await db.from(table).select('id').eq('user_id', userId).maybeSingle();
  return data?.id || null;
}

async function getConversationForUser(convId, userId, userType) {
  const { data: conv, error } = await db
    .from('conversations').select('*').eq('id', convId).maybeSingle();
  if (error || !conv) {
    const e = new Error('Conversation not found'); e.status = 404; throw e;
  }
  const resolved = await _resolveParticipantId(userId, userType);
  if (!resolved) {
    const e = new Error('Forbidden'); e.status = 403; throw e;
  }
  const isP1 = conv.participant_type_1 === userType && conv.participant_id_1 === resolved;
  const isP2 = conv.participant_type_2 === userType && conv.participant_id_2 === resolved;
  if (!isP1 && !isP2) {
    const e = new Error('Forbidden'); e.status = 403; throw e;
  }
  return { conv, myType: userType, myId: resolved };
}

// ─── openConversation ─────────────────────────────────────────────────────────

async function openConversation(orderId, myType, myId, otherType, otherId) {
  const [pt1, pi1, pt2, pi2] = _normalizeParticipants(myType, myId, otherType, otherId);

  const { data: existing } = await db
    .from('conversations')
    .select('*')
    .eq('order_id', orderId)
    .eq('participant_type_1', pt1)
    .eq('participant_id_1', pi1)
    .eq('participant_type_2', pt2)
    .eq('participant_id_2', pi2)
    .maybeSingle();

  if (existing) return existing;

  const { data, error } = await db
    .from('conversations')
    .insert({
      order_id:          orderId,
      participant_type_1: pt1,
      participant_id_1:  pi1,
      participant_type_2: pt2,
      participant_id_2:  pi2,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ─── sendMessage ──────────────────────────────────────────────────────────────

async function sendMessage(conversationId, senderType, senderId, content) {
  const { data: msg, error } = await db
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_type:     senderType,
      sender_id:       senderId,
      message_type:    content.type || 'text',
      text_content:    content.text     || null,
      voice_url:       content.voiceUrl || null,
      image_url:       content.imageUrl || null,
    })
    .select()
    .single();

  if (error) throw error;

  const preview = content.text || (content.type === 'voice' ? '🎤 Voice message' : '📷 Photo');

  await db
    .from('conversations')
    .update({ last_message_text: preview, last_message_at: new Date().toISOString() })
    .eq('id', conversationId);

  const { data: conv } = await db
    .from('conversations')
    .select('*')
    .eq('id', conversationId)
    .single();

  // Determine recipient
  const isSender1 = conv.participant_type_1 === senderType && conv.participant_id_1 === senderId;
  const recipientType = isSender1 ? conv.participant_type_2 : conv.participant_type_1;
  const recipientId   = isSender1 ? conv.participant_id_2   : conv.participant_id_1;

  const payload = { message: msg, conversation_id: conversationId, order_id: conv.order_id };

  // Real-time socket delivery
  _emitToParticipant(recipientType, recipientId, EVENTS.MESSAGE_NEW, payload);

  // Fire-and-forget push (only reaches app if backgrounded)
  const senderName = await _getDisplayName(senderType, senderId);
  _sendPushToParticipant(
    recipientType,
    recipientId,
    `💬 ${senderName}`,
    preview,
    { type: 'chat', conversation_id: conversationId, order_id: conv.order_id }
  );

  return msg;
}

// ─── sendVoiceMessage ─────────────────────────────────────────────────────────
// Accepts base64-encoded audio; uploads to Supabase Storage; returns message.

async function sendVoiceMessage(conversationId, senderType, senderId, audioBase64, mimeType = 'audio/m4a') {
  const fileName = `voice-notes/${conversationId}/${Date.now()}.m4a`;

  const buffer = Buffer.from(audioBase64, 'base64');

  const { error: uploadErr } = await db
    .storage
    .from('chat-media')
    .upload(fileName, buffer, { contentType: mimeType, upsert: false });

  if (uploadErr) throw uploadErr;

  const { data: { publicUrl } } = db.storage.from('chat-media').getPublicUrl(fileName);

  return sendMessage(conversationId, senderType, senderId, {
    type:     'voice',
    voiceUrl: publicUrl,
  });
}

// ─── sendImageMessage ─────────────────────────────────────────────────────────

async function sendImageMessage(conversationId, senderType, senderId, imageBase64, mimeType = 'image/jpeg') {
  const ext      = mimeType.split('/')[1] || 'jpg';
  const fileName = `chat-images/${conversationId}/${Date.now()}.${ext}`;
  const buffer   = Buffer.from(imageBase64, 'base64');

  const { error: uploadErr } = await db
    .storage
    .from('chat-media')
    .upload(fileName, buffer, { contentType: mimeType, upsert: false });

  if (uploadErr) throw uploadErr;

  const { data: { publicUrl } } = db.storage.from('chat-media').getPublicUrl(fileName);

  return sendMessage(conversationId, senderType, senderId, {
    type:     'image',
    imageUrl: publicUrl,
  });
}

// ─── sendSystemMessage ────────────────────────────────────────────────────────

const SYSTEM_SENDER_ID = '00000000-0000-0000-0000-000000000000';

async function sendSystemMessage(conversationId, text) {
  const { data, error } = await db
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_type:     'system',
      sender_id:       SYSTEM_SENDER_ID,
      message_type:    'system',
      text_content:    text,
      is_read:         true,
    })
    .select()
    .single();

  if (error) throw error;

  await db
    .from('conversations')
    .update({ last_message_text: text, last_message_at: new Date().toISOString() })
    .eq('id', conversationId);

  return data;
}

// ─── getMessages ──────────────────────────────────────────────────────────────

async function getMessages(conversationId, limit = 50, before = null) {
  let query = db
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (before) query = query.lt('created_at', before);

  const { data, error } = await query;
  if (error) throw error;

  return (data || []).reverse(); // return oldest-first for rendering
}

// ─── markAsRead ───────────────────────────────────────────────────────────────

async function markAsRead(conversationId, readerType, readerId) {
  const { error } = await db
    .from('messages')
    .update({ is_read: true })
    .eq('conversation_id', conversationId)
    .neq('sender_type', readerType)
    .eq('is_read', false);

  if (error) throw error;

  // Notify sender via socket that messages were read
  const { data: conv } = await db
    .from('conversations')
    .select('*')
    .eq('id', conversationId)
    .single();

  if (conv) {
    const isSender1 = conv.participant_type_1 === readerType && conv.participant_id_1 === readerId;
    const senderType = isSender1 ? conv.participant_type_2 : conv.participant_type_1;
    const senderId   = isSender1 ? conv.participant_id_2   : conv.participant_id_1;

    _emitToParticipant(senderType, senderId, EVENTS.MESSAGE_READ, {
      conversation_id: conversationId,
      read_by:         readerType,
    });
  }
}

// ─── getUserConversations ─────────────────────────────────────────────────────

async function getUserConversations(participantId, participantType, limit = 20) {
  const { data, error } = await db
    .from('conversations')
    .select('*')
    .or(`participant_id_1.eq.${participantId},participant_id_2.eq.${participantId}`)
    .order('last_message_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  if (!data || data.length === 0) return [];

  // Attach unread counts
  const withUnread = await Promise.all(data.map(async (conv) => {
    const { count } = await db
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('conversation_id', conv.id)
      .neq('sender_type', participantType)
      .eq('is_read', false);

    return { ...conv, unread_count: count || 0 };
  }));

  return withUnread;
}

// ─── autoCreateForOrder ───────────────────────────────────────────────────────
// Called when a shop accepts an order — creates the customer↔shop conversation.

async function autoCreateForOrder(order) {
  if (!order.customer_id || !order.shop_id) return;

  const conv = await openConversation(
    order.id, 'customer', order.customer_id, 'shop', order.shop_id
  );

  await sendSystemMessage(
    conv.id,
    '✅ Shop has accepted your order. Chat here if you need to discuss substitutions or changes.'
  );
}

// ─── autoCreateRunnerConversations ────────────────────────────────────────────
// Called when a runner accepts a job — creates customer↔runner and shop↔runner.

async function autoCreateRunnerConversations(order) {
  if (!order.runner_id) return;

  if (order.customer_id) {
    const custRunnerConv = await openConversation(
      order.id, 'customer', order.customer_id, 'runner', order.runner_id
    );
    await sendSystemMessage(
      custRunnerConv.id,
      '🏃 Your runner is heading to the shop. Chat here for delivery instructions.'
    );
  }

  if (order.shop_id) {
    const shopRunnerConv = await openConversation(
      order.id, 'shop', order.shop_id, 'runner', order.runner_id
    );
    await sendSystemMessage(
      shopRunnerConv.id,
      '📦 Runner is on the way for pickup. Use this to coordinate handoff details.'
    );
  }
}

// ─── getQuickReplies ──────────────────────────────────────────────────────────

const QUICK_REPLIES = {
  customer: [
    { text: '👍 Okay, thanks!',           emoji: '👍' },
    { text: 'How much longer?',           emoji: '⏱️' },
    { text: 'Please leave at the door',   emoji: '🚪' },
    { text: 'Call me when you arrive',    emoji: '📞' },
  ],
  shop: [
    { text: 'Order is ready for pickup',  emoji: '📦' },
    { text: 'Out of stock, substitute?',  emoji: '🔄' },
    { text: '5 more minutes please',      emoji: '⏰' },
    { text: 'Your order is being packed', emoji: '🛍️' },
  ],
  runner: [
    { text: "Reached the shop",           emoji: '🏪' },
    { text: "On my way 🛵",               emoji: '🛵' },
    { text: "I'm at your location",       emoji: '📍' },
    { text: "Traffic delay, sorry!",      emoji: '🚦' },
  ],
};

function getQuickReplies(myType) {
  return QUICK_REPLIES[myType] || [];
}

module.exports = {
  getConversationForUser,
  openConversation,
  sendMessage,
  sendVoiceMessage,
  sendImageMessage,
  sendSystemMessage,
  getMessages,
  markAsRead,
  getUserConversations,
  autoCreateForOrder,
  autoCreateRunnerConversations,
  getQuickReplies,
  _resolveParticipantId,
};
