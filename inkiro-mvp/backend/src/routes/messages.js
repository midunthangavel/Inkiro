'use strict';

const express      = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const messageService  = require('../services/messageService');

const router = express.Router();

// ─── POST /conversations/open ─────────────────────────────────────────────────
// Find or create a conversation between the caller and another participant.
// Body: { order_id, other_type, other_id }
// Caller identity (my_type, my_id) is derived from the JWT — never trusted from body.

router.post(
  '/conversations/open',
  requireAuth(),
  asyncHandler(async (req, res) => {
    const { order_id, other_type, other_id } = req.body;

    if (!order_id || !other_type || !other_id) {
      return res.status(400).json({ error: 'order_id, other_type, and other_id are required' });
    }

    const myId = await messageService._resolveParticipantId(req.user.userId, req.user.role);
    if (!myId) return res.status(403).json({ error: 'Forbidden' });

    const conversation = await messageService.openConversation(
      order_id, req.user.role, myId, other_type, other_id
    );
    res.json({ conversation });
  })
);

// ─── GET /conversations/for-user/:userId ─────────────────────────────────────
// Returns conversations for the authenticated user only.

router.get(
  '/conversations/for-user/:userId',
  requireAuth(),
  asyncHandler(async (req, res) => {
    if (req.params.userId !== req.user.userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const conversations = await messageService.getUserConversations(
      req.user.userId, req.user.role
    );
    res.json({ conversations });
  })
);

// ─── GET /conversations/:convId/messages ──────────────────────────────────────

router.get(
  '/conversations/:convId/messages',
  requireAuth(),
  asyncHandler(async (req, res) => {
    await messageService.getConversationForUser(
      req.params.convId, req.user.userId, req.user.role
    );
    const { limit, before } = req.query;
    const messages = await messageService.getMessages(
      req.params.convId,
      limit ? parseInt(limit, 10) : 50,
      before || null
    );
    res.json({ messages });
  })
);

// ─── POST /conversations/:convId/messages ─────────────────────────────────────
// Body: { text }
// Sender identity sourced from JWT, not body.

router.post(
  '/conversations/:convId/messages',
  requireAuth(),
  asyncHandler(async (req, res) => {
    const { text } = req.body;

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({ error: 'text is required' });
    }
    if (text.length > 2000) {
      return res.status(400).json({ error: 'text must be 2000 characters or fewer' });
    }

    const { myType, myId } = await messageService.getConversationForUser(
      req.params.convId, req.user.userId, req.user.role
    );
    const message = await messageService.sendMessage(
      req.params.convId, myType, myId, { type: 'text', text: text.trim() }
    );
    res.status(201).json({ message });
  })
);

// ─── POST /conversations/:convId/voice ────────────────────────────────────────
// Body: { audio_base64, mime_type? }

router.post(
  '/conversations/:convId/voice',
  requireAuth(),
  asyncHandler(async (req, res) => {
    const { audio_base64, mime_type } = req.body;

    if (!audio_base64) {
      return res.status(400).json({ error: 'audio_base64 is required' });
    }

    const { myType, myId } = await messageService.getConversationForUser(
      req.params.convId, req.user.userId, req.user.role
    );
    const message = await messageService.sendVoiceMessage(
      req.params.convId, myType, myId, audio_base64, mime_type || 'audio/m4a'
    );
    res.status(201).json({ message });
  })
);

// ─── POST /conversations/:convId/image ────────────────────────────────────────
// Body: { image_base64, mime_type? }

router.post(
  '/conversations/:convId/image',
  requireAuth(),
  asyncHandler(async (req, res) => {
    const { image_base64, mime_type } = req.body;

    if (!image_base64) {
      return res.status(400).json({ error: 'image_base64 is required' });
    }

    const { myType, myId } = await messageService.getConversationForUser(
      req.params.convId, req.user.userId, req.user.role
    );
    const message = await messageService.sendImageMessage(
      req.params.convId, myType, myId, image_base64, mime_type || 'image/jpeg'
    );
    res.status(201).json({ message });
  })
);

// ─── POST /conversations/:convId/read ─────────────────────────────────────────
// Reader identity sourced from JWT, not body.

router.post(
  '/conversations/:convId/read',
  requireAuth(),
  asyncHandler(async (req, res) => {
    const { myType, myId } = await messageService.getConversationForUser(
      req.params.convId, req.user.userId, req.user.role
    );
    await messageService.markAsRead(req.params.convId, myType, myId);
    res.json({ ok: true });
  })
);

// ─── GET /quick-replies ───────────────────────────────────────────────────────

router.get(
  '/quick-replies',
  requireAuth(),
  asyncHandler(async (req, res) => {
    const replies = messageService.getQuickReplies(req.user.role);
    res.json({ replies });
  })
);

module.exports = router;
