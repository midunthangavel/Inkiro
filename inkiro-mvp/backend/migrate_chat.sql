-- ─── Message system ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            UUID REFERENCES orders(id) ON DELETE CASCADE,
  participant_type_1  VARCHAR(10) NOT NULL,
  participant_id_1    UUID NOT NULL,
  participant_type_2  VARCHAR(10) NOT NULL,
  participant_id_2    UUID NOT NULL,
  last_message_text   TEXT,
  last_message_at     TIMESTAMPTZ DEFAULT NOW(),
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(order_id, participant_type_1, participant_id_1, participant_type_2, participant_id_2)
);

CREATE TABLE IF NOT EXISTS messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID REFERENCES conversations(id) ON DELETE CASCADE,
  sender_type      VARCHAR(10) NOT NULL,
  sender_id        UUID NOT NULL,
  message_type     VARCHAR(20) DEFAULT 'text',
  text_content     TEXT,
  voice_url        TEXT,
  image_url        TEXT,
  is_read          BOOLEAN DEFAULT false,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_order ON conversations(order_id);
CREATE INDEX IF NOT EXISTS idx_conversations_p1    ON conversations(participant_id_1);
CREATE INDEX IF NOT EXISTS idx_conversations_p2    ON conversations(participant_id_2);
CREATE INDEX IF NOT EXISTS idx_messages_conv       ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_unread     ON messages(conversation_id, is_read) WHERE NOT is_read;

-- ─── Runner streak / XP ───────────────────────────────────────────────────────
ALTER TABLE runners ADD COLUMN IF NOT EXISTS streak_count       INTEGER DEFAULT 0;
ALTER TABLE runners ADD COLUMN IF NOT EXISTS last_delivery_date DATE;
ALTER TABLE runners ADD COLUMN IF NOT EXISTS xp                 INTEGER DEFAULT 0;
ALTER TABLE runners ADD COLUMN IF NOT EXISTS level              INTEGER DEFAULT 1;
ALTER TABLE runners ADD COLUMN IF NOT EXISTS total_deliveries   INTEGER DEFAULT 0;

-- ─── Shop decline reason ──────────────────────────────────────────────────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS decline_reason TEXT;

-- Confirm
SELECT 'conversations' AS tbl, COUNT(*) FROM conversations
UNION ALL
SELECT 'messages',              COUNT(*) FROM messages;
