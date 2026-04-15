'use strict';

require('dotenv').config();

const TelegramBot            = require('node-telegram-bot-api');
const { registerCommands }   = require('./handlers/commands');
const { registerMessageHandler } = require('./handlers/messages');

// ---------------------------------------------------------------------------
// Validación de variables de entorno obligatorias
// ---------------------------------------------------------------------------

const REQUIRED_ENV = [
  'TELEGRAM_TOKEN',
  'GOOGLE_SHEET_ID',
  'GOOGLE_SERVICE_ACCOUNT_EMAIL',
  'GOOGLE_PRIVATE_KEY',
  'WEBHOOK_URL',
];

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`[init] Variable de entorno requerida no definida: ${key}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Inicialización del bot con webhook
// ---------------------------------------------------------------------------

const PORT       = process.env.PORT || 3000;
const token      = process.env.TELEGRAM_TOKEN;
const webhookUrl = process.env.WEBHOOK_URL.replace(/\/$/, ''); // quitar trailing slash

const bot = new TelegramBot(token, {
  webHook: { port: PORT },
});

bot.setWebHook(`${webhookUrl}/bot${token}`)
  .then(() => console.log(`✅ Bot de finanzas iniciado. Webhook: ${webhookUrl}/bot${token}`))
  .catch((err) => {
    console.error('[webhook] Error al configurar webhook:', err.message);
    process.exit(1);
  });

registerCommands(bot);
registerMessageHandler(bot);

// ---------------------------------------------------------------------------
// Manejo de errores globales
// ---------------------------------------------------------------------------

bot.on('error', (err) => {
  console.error('[bot_error]', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
