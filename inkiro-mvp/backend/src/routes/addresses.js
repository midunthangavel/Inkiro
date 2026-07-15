'use strict';

const express      = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { db }       = require('../db');

const router = express.Router();

// ─── GET / — list saved addresses ─────────────────────────────────────────────

router.get(
  '/',
  requireAuth(['customer']),
  asyncHandler(async (req, res) => {
    const { data, error } = await db
      .from('user_addresses')
      .select('id, label, address, lat, lng, is_default, created_at')
      .eq('user_id', req.user.userId)
      .order('created_at', { ascending: false });

    if (error) {
      req.log.error({ err: error }, 'Failed to fetch addresses');
      return res.status(500).json({ error: 'Failed to fetch addresses' });
    }
    res.json({ addresses: data || [] });
  })
);

// ─── POST / — save a new address ──────────────────────────────────────────────

router.post(
  '/',
  requireAuth(['customer']),
  asyncHandler(async (req, res) => {
    const { label, address, lat, lng } = req.body;
    if (!address?.trim()) return res.status(400).json({ error: 'Address required' });

    const { data, error } = await db
      .from('user_addresses')
      .insert({
        user_id: req.user.userId,
        label:   label?.trim() || 'Address',
        address: address.trim(),
        lat:     lat  || null,
        lng:     lng  || null,
      })
      .select()
      .single();

    if (error) {
      req.log.error({ err: error }, 'Failed to save address');
      return res.status(500).json({ error: 'Failed to save address' });
    }
    res.status(201).json({ address: data });
  })
);

// ─── DELETE /:id — remove a saved address ─────────────────────────────────────

router.delete(
  '/:id',
  requireAuth(['customer']),
  asyncHandler(async (req, res) => {
    const { error } = await db
      .from('user_addresses')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.userId);

    if (error) {
      req.log.error({ err: error }, 'Failed to delete address');
      return res.status(500).json({ error: 'Failed to delete address' });
    }
    res.json({ ok: true });
  })
);

module.exports = router;
