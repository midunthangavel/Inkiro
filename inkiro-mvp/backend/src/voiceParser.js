'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');
const logger                 = require('./utils/logger');
const C                      = require('./config/constants');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: C.GEMINI_MODEL });

async function parseVoiceOrder(audioBase64, language = 'ta-IN') {
  if (audioBase64.length > C.MAX_AUDIO_BASE64_BYTES) {
    throw new Error(
      `Audio exceeds maximum allowed size. ` +
      `Base64 limit: ${C.MAX_AUDIO_BASE64_BYTES} bytes (~${C.MAX_AUDIO_BYTES / (1024 * 1024)} MB raw)`
    );
  }

  const langHint = language === 'ta-IN' ? 'Tamil or Tamil-English mix' : 'Hindi or Hindi-English mix';

  const prompt = `You are a grocery order parser for an Indian hyperlocal delivery app in Tamil Nadu.
The audio may be in ${langHint}.

Listen to the audio and extract grocery items from the voice order.
Return ONLY a valid JSON object — no markdown, no explanation, no extra text.

Format:
{
  "raw_text": "<transcription of what was said>",
  "items": [{ "name": string, "quantity": number, "unit": string, "estimated_price_rupees": number }]
}

Rules for items:
- Estimate realistic retail prices (Coimbatore market rates)
- Common units: kg, g, litre, ml, piece, dozen, pack, bunch
- If quantity is unclear, default to 1
- If unit is unclear, use "piece"
- Translate Tamil item names to English`;

  let result;
  try {
    result = await model.generateContent([
      { inlineData: { mimeType: 'audio/mp4', data: audioBase64 } },
      { text: prompt },
    ]);
  } catch (err) {
    logger.error({ err }, 'Gemini audio call failed');
    throw new Error('Failed to transcribe audio');
  }

  const raw     = result.response.text().trim();
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    logger.error({ raw }, 'Gemini returned unparseable JSON');
    throw new Error('Could not parse voice order');
  }

  const { raw_text, items } = parsed;

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('No items detected in audio');
  }

  logger.info({ language, transcript: raw_text, itemCount: items.length }, 'Audio parsed');

  const validItems = items.filter(
    (item) =>
      item.name &&
      typeof item.quantity === 'number' &&
      item.unit &&
      typeof item.estimated_price_rupees === 'number'
  );

  const subtotalPaise = Math.round(
    validItems.reduce((sum, item) => sum + item.estimated_price_rupees * item.quantity, 0) * 100
  );

  return {
    items:        validItems,
    raw_text:     raw_text || '',
    subtotal:     subtotalPaise,
    platform_fee: C.PLATFORM_FEE_PAISE,
    delivery_fee: C.DELIVERY_FEE_PAISE,
    total:        subtotalPaise + C.PLATFORM_FEE_PAISE + C.DELIVERY_FEE_PAISE,
  };
}

module.exports = { parseVoiceOrder };
