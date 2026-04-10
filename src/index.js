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
];

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`[init] Variable de entorno requerida no definida: ${key}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Inicialización del bot
// ---------------------------------------------------------------------------

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

registerCommands(bot);
registerMessageHandler(bot);

console.log('✅ Bot de finanzas iniciado con polling.');

// ---------------------------------------------------------------------------
// Manejo de errores globales
// ---------------------------------------------------------------------------

bot.on('polling_error', (err) => {
  // EFATAL/AggregateError es un error transitorio de DNS en sistemas IPv4+IPv6, no es fatal
  if (err.code === 'EFATAL') return;
  console.error('[polling_error]', err.code, err.message);
});

bot.on('error', (err) => {
  console.error('[bot_error]', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
