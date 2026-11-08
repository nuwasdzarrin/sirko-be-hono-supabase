import { webhookSecret } from '../lib/telegram.js';
import { setupWebhook } from '../services/telegram-bot.service.js';

/**
 * Pasang webhook bot admin Telegram → `${PUBLIC_BASE_URL}/v1/webhooks/telegram` + daftar perintah.
 * Jalankan sekali di server setelah deploy / ganti token bot:
 *   node --env-file=.env --import tsx src/cli/telegram-setup.ts
 */
const r = await setupWebhook(webhookSecret());
console.log(`Webhook Telegram terpasang: ${r.url}`);
process.exit(0);
