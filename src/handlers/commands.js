'use strict';

const {
  getTransacciones,
  getDeudas,
  getObligaciones,
  getPresupuestos,
  getGastadoPorCategoria,
} = require('../services/sheets');

const {
  generarGraficoBarras,
  generarGraficoPastel,
  generarGraficoPresupuesto,
} = require('../services/charts');

const {
  resumenHoy,
  resumenSemanal,
  resumenMensual,
  resumenDisponible,
  resumenDeudas,
  resumenPresupuestos,
  resumenObligaciones,
} = require('../services/reports');

// ---------------------------------------------------------------------------
// Helpers de fecha
// ---------------------------------------------------------------------------

function hoy() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
}

function mesActual() {
  return hoy().slice(0, 7);
}

/** Lunes de la semana actual como YYYY-MM-DD. */
function inicioSemana() {
  const d = new Date(new Date().toLocaleString('en-CA', { timeZone: 'America/Bogota' }));
  const dia = d.getDay(); // 0=dom
  const diff = dia === 0 ? -6 : 1 - dia;
  d.setDate(d.getDate() + diff);
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
}

/** Primer día del mes actual como YYYY-MM-DD. */
function inicioMes() {
  return `${mesActual()}-01`;
}

/** Último día del mes actual como YYYY-MM-DD. */
function finMes() {
  const [y, m] = mesActual().split('-').map(Number);
  const ultimo = new Date(y, m, 0).getDate();
  return `${mesActual()}-${String(ultimo).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Helpers de envío
// ---------------------------------------------------------------------------

/**
 * Envía un mensaje de texto con parseMode Markdown.
 * Captura errores de la API de Telegram para no romper el proceso.
 */
async function send(bot, chatId, text, parseMode = 'Markdown') {
  try {
    const opts = parseMode ? { parse_mode: parseMode } : {};
    await bot.sendMessage(chatId, text, opts);
  } catch (err) {
    console.error(`[send] chatId=${chatId}:`, err.message);
  }
}

/**
 * Envía una foto (URL) con caption opcional.
 */
async function sendPhoto(bot, chatId, url, caption) {
  try {
    await bot.sendPhoto(chatId, url, {
      caption: caption || '',
      parse_mode: 'Markdown',
    });
  } catch (err) {
    // QuickChart puede fallar si el payload es muy largo; avisa sin romper
    console.error(`[sendPhoto] chatId=${chatId}:`, err.message);
    if (caption) await send(bot, chatId, caption);
  }
}

// ---------------------------------------------------------------------------
// Registro de comandos
// ---------------------------------------------------------------------------

/**
 * Registra todos los comandos en el bot.
 * @param {TelegramBot} bot
 */
function registerCommands(bot) {
  bot.onText(/\/start/, (msg) => cmdStart(bot, msg));
  bot.onText(/\/hoy/,   (msg) => cmdHoy(bot, msg));
  bot.onText(/\/resumen/, (msg) => cmdResumen(bot, msg));
  bot.onText(/\/semana/,  (msg) => cmdSemana(bot, msg));
  bot.onText(/\/mes/,    (msg) => cmdMes(bot, msg));
  bot.onText(/\/disponible/, (msg) => cmdDisponible(bot, msg));
  bot.onText(/\/deudas/, (msg) => cmdDeudas(bot, msg));
  bot.onText(/\/obligaciones/, (msg) => cmdObligaciones(bot, msg));
  bot.onText(/\/presupuestos/, (msg) => cmdPresupuestos(bot, msg));
  bot.onText(/\/transacciones_egresos/,  (msg) => cmdTransacciones(bot, msg, 'egresos'));
  bot.onText(/\/transacciones_ingresos/, (msg) => cmdTransacciones(bot, msg, 'ingresos'));
  bot.onText(/\/transacciones_semana/,   (msg) => cmdTransacciones(bot, msg, 'semana'));
  bot.onText(/\/transacciones_hoy/,      (msg) => cmdTransacciones(bot, msg, 'hoy'));
  bot.onText(/\/transacciones(?!_)/,     (msg) => cmdTransacciones(bot, msg, 'mes'));
  bot.onText(/\/categorias/, (msg) => cmdCategorias(bot, msg));
  bot.onText(/\/comandos/,   (msg) => cmdComandos(bot, msg));
  bot.onText(/\/ayuda/, (msg) => cmdAyuda(bot, msg));
}

// ---------------------------------------------------------------------------
// Helpers de formato
// ---------------------------------------------------------------------------

function fmtMonto(n) {
  return `$${Number(n).toLocaleString('es-CO')}`;
}

function esc(text) {
  return String(text || '').replace(/[_*`[]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Implementación de cada comando
// ---------------------------------------------------------------------------

async function cmdStart(bot, msg) {
  const nombre = msg.from.first_name || msg.from.username || 'amigo';
  await send(bot, msg.chat.id, `👋 *¡Hola, ${nombre}!* Soy tu bot de finanzas personales.

Registro tus ingresos, egresos, deudas, presupuestos y obligaciones en Google Sheets.`);

  await send(bot, msg.chat.id, ESTRUCTURA_TEXTO, null);
  await send(bot, msg.chat.id, COMANDOS_TEXTO, null);
}

async function cmdHoy(bot, msg) {
  const usuario = msg.from.username;
  const chatId  = msg.chat.id;
  const fecha   = hoy();

  try {
    const txs = await getTransacciones(fecha, fecha, usuario);
    await send(bot, chatId, resumenHoy(txs, usuario));
  } catch (err) {
    console.error('[cmdHoy]', err.message);
    await send(bot, chatId, '❌ Error al obtener el resumen de hoy. Intenta de nuevo.');
  }
}

/** Resumen semanal (antes era /resumen, ahora es /semana) */
async function cmdSemana(bot, msg) {
  const usuario = msg.from.username;
  const chatId  = msg.chat.id;

  try {
    const txs   = await getTransacciones(inicioSemana(), hoy(), usuario);
    const texto = resumenSemanal(txs, usuario);

    const egresos = txs.filter((t) => t.tipo === 'egreso');
    if (egresos.length) {
      const mapa   = egresos.reduce((acc, t) => { acc[t.categoria] = (acc[t.categoria] || 0) + t.monto; return acc; }, {});
      const cats   = Object.keys(mapa);
      const montos = cats.map((c) => mapa[c]);
      await sendPhoto(bot, chatId, generarGraficoBarras(cats, montos, 'Gastos esta semana'), texto);
    } else {
      await send(bot, chatId, texto);
    }
  } catch (err) {
    console.error('[cmdSemana]', err.message);
    await send(bot, chatId, '❌ Error al generar el resumen semanal.');
  }
}

/** Resumen general: ingresos, egresos, deudas, obligaciones y presupuestos del mes */
async function cmdResumen(bot, msg) {
  const usuario = msg.from.username;
  const chatId  = msg.chat.id;
  const mes     = mesActual();
  const SEP     = '──────────────────';

  try {
    const [txs, deudas, obls, presupuestos] = await Promise.all([
      getTransacciones(inicioMes(), finMes(), usuario),
      getDeudas(usuario, 'pendiente'),
      getObligaciones(usuario, mes),
      getGastadoPorCategoria(usuario, mes),
    ]);

    const egresos  = txs.filter((t) => t.tipo === 'egreso');
    const ingresos = txs.filter((t) => t.tipo === 'ingreso');
    const totalEg  = egresos.reduce((s, t) => s + t.monto, 0);
    const totalIn  = ingresos.reduce((s, t) => s + t.monto, 0);

    const debo    = deudas.filter((d) => d.direccion === 'debo');
    const meDeben = deudas.filter((d) => d.direccion === 'me_deben');
    const totalDebo    = debo.reduce((s, d) => s + d.monto, 0);
    const totalMeDeben = meDeben.reduce((s, d) => s + d.monto, 0);

    const oblPend     = obls.filter((o) => o.estado === 'pendiente');
    const totalOblPend = oblPend.reduce((s, o) => s + o.monto, 0);
    const disponible  = totalIn - totalEg - totalOblPend;

    const lineas = [
      `📊 *Resumen general — ${mes}*`,
      `_@${usuario}_`,
      SEP,
      '',
      '💰 *Ingresos*',
      `   Total: *${fmtMonto(totalIn)}*  (${ingresos.length} movimientos)`,
      '',
      '💸 *Egresos*',
      `   Total: *${fmtMonto(totalEg)}*  (${egresos.length} movimientos)`,
      '',
      `📊 Balance: *${fmtMonto(totalIn - totalEg)}*`,
      `💵 Disponible real: *${fmtMonto(disponible)}*`,
      '',
      SEP,
      '',
      '🔒 *Obligaciones pendientes*',
      oblPend.length
        ? oblPend.map((o) => `   ⏳ ${o.nombre}: *${fmtMonto(o.monto)}*`).join('\n')
        : '   _Sin obligaciones pendientes_',
      `   Total: *${fmtMonto(totalOblPend)}*`,
      '',
      SEP,
      '',
      '💬 *Deudas pendientes*',
      `   📤 Debo:    *${fmtMonto(totalDebo)}* (${debo.length})`,
      `   📥 Me deben: *${fmtMonto(totalMeDeben)}* (${meDeben.length})`,
    ];

    // Sección presupuestos si hay definidos
    if (presupuestos.length) {
      const conAlerta = presupuestos.filter((p) => p.alerta);
      lineas.push('', SEP, '', '🎯 *Presupuestos*');
      presupuestos.forEach((p) => {
        const icono = p.porcentaje >= 80 ? '🚨' : p.porcentaje >= 60 ? '⚠️' : '✅';
        lineas.push(`   ${icono} ${p.categoria}: *${p.porcentaje}%* (${fmtMonto(p.gastado)} / ${fmtMonto(p.presupuesto)})`);
      });
      if (conAlerta.length) {
        lineas.push('', `🚨 *${conAlerta.length} categoría(s) superan el 80%*`);
      }
    }

    await send(bot, chatId, lineas.join('\n'));
  } catch (err) {
    console.error('[cmdResumen]', err.message);
    await send(bot, chatId, '❌ Error al generar el resumen.');
  }
}

async function cmdMes(bot, msg) {
  const usuario = msg.from.username;
  const chatId  = msg.chat.id;
  const mes     = mesActual();

  try {
    const [txs, obls] = await Promise.all([
      getTransacciones(inicioMes(), finMes(), usuario),
      getObligaciones(usuario, mes),
    ]);

    await send(bot, chatId, resumenMensual(txs, obls, usuario));
  } catch (err) {
    console.error('[cmdMes]', err.message);
    await send(bot, chatId, '❌ Error al generar el resumen mensual.');
  }
}

async function cmdDisponible(bot, msg) {
  const usuario = msg.from.username;
  const chatId  = msg.chat.id;
  const mes     = mesActual();

  try {
    const [txs, obls] = await Promise.all([
      getTransacciones(inicioMes(), finMes(), usuario),
      getObligaciones(usuario, mes),
    ]);
    await send(bot, chatId, resumenDisponible(txs, obls, usuario, mes));
  } catch (err) {
    console.error('[cmdDisponible]', err.message);
    await send(bot, chatId, '❌ Error al calcular el disponible.');
  }
}

async function cmdDeudas(bot, msg) {
  const usuario = msg.from.username;
  const chatId  = msg.chat.id;

  try {
    const deudas = await getDeudas(usuario, 'pendiente');
    await send(bot, chatId, resumenDeudas(deudas, usuario));
  } catch (err) {
    console.error('[cmdDeudas]', err.message);
    await send(bot, chatId, '❌ Error al obtener las deudas.');
  }
}

async function cmdObligaciones(bot, msg) {
  const usuario = msg.from.username;
  const chatId  = msg.chat.id;
  const mes     = mesActual();

  try {
    const obls = await getObligaciones(usuario, mes);
    await send(bot, chatId, resumenObligaciones(obls, usuario));
  } catch (err) {
    console.error('[cmdObligaciones]', err.message);
    await send(bot, chatId, '❌ Error al obtener las obligaciones.');
  }
}

async function cmdPresupuestos(bot, msg) {
  const usuario = msg.from.username;
  const chatId  = msg.chat.id;
  const mes     = mesActual();

  try {
    const conGastado = await getGastadoPorCategoria(usuario, mes);
    await send(bot, chatId, resumenPresupuestos(conGastado, usuario));
  } catch (err) {
    console.error('[cmdPresupuestos]', err.message);
    await send(bot, chatId, '❌ Error al obtener los presupuestos.');
  }
}

const EMOJI_CAT = {
  Comida: '🍔', Transporte: '🚌', Salud: '💊', Ocio: '🎮',
  Personal: '👕', Trabajo: '💼', Servicios: '🔌', Otros: '📦',
};

/**
 * /transacciones → mes actual
 * /egresos       → solo egresos del mes
 * /ingresos      → solo ingresos del mes
 * /semana        → todos los de esta semana
 */
async function cmdTransacciones(bot, msg, filtro) {
  const usuario = msg.from.username;
  const chatId  = msg.chat.id;

  // Determinar rango de fechas
  let desde, hasta, periodoLabel;
  if (filtro === 'hoy') {
    desde = hasta = hoy();
    periodoLabel = 'hoy';
  } else if (filtro === 'semana') {
    desde = inicioSemana();
    hasta = hoy();
    periodoLabel = 'esta semana';
  } else {
    desde = inicioMes();
    hasta = finMes();
    periodoLabel = mesActual();
  }

  // Determinar tipo a mostrar
  const soloTipo = filtro === 'egresos' ? 'egreso'
    : filtro === 'ingresos' ? 'ingreso'
    : null;

  try {
    const todas = await getTransacciones(desde, hasta, usuario);
    const txs   = soloTipo ? todas.filter((t) => t.tipo === soloTipo) : todas;

    if (!txs.length) {
      await send(bot, chatId, `📋 Sin transacciones para _${periodoLabel}_.`);
      return;
    }

    const egresos  = txs.filter((t) => t.tipo === 'egreso');
    const ingresos = txs.filter((t) => t.tipo === 'ingreso');
    const totalEg  = egresos.reduce((s, t) => s + t.monto, 0);
    const totalIn  = ingresos.reduce((s, t) => s + t.monto, 0);

    const SEP = '──────────────────';
    const lineas = [
      `📋 *Transacciones — ${periodoLabel}*`,
      `_@${usuario}_`,
      SEP,
    ];

    // Totales arriba
    if (!soloTipo || soloTipo === 'ingreso') {
      lineas.push(`💰 Ingresos:  *${fmtMonto(totalIn)}*`);
    }
    if (!soloTipo || soloTipo === 'egreso') {
      lineas.push(`💸 Egresos:   *${fmtMonto(totalEg)}*`);
    }
    if (!soloTipo) {
      lineas.push(`📊 Balance:   *${fmtMonto(totalIn - totalEg)}*`);
    }

    // Lista de ingresos
    if (ingresos.length && soloTipo !== 'egreso') {
      lineas.push('', SEP, `💰 *Ingresos (${ingresos.length})*`, '');
      ingresos.forEach((t) => {
        const emoji = EMOJI_CAT[t.categoria] || '📦';
        lineas.push(`${emoji} ${t.fecha}  *${fmtMonto(t.monto)}*  _${esc(t.descripcion)}_`);
      });
    }

    // Lista de egresos
    if (egresos.length && soloTipo !== 'ingreso') {
      lineas.push('', SEP, `💸 *Egresos (${egresos.length})*`, '');
      egresos.forEach((t) => {
        const emoji = EMOJI_CAT[t.categoria] || '📦';
        lineas.push(`${emoji} ${t.fecha}  *${fmtMonto(t.monto)}*  _${esc(t.descripcion)}_`);
      });
    }

    // Telegram tiene límite de 4096 caracteres; si supera, partir en chunks
    const texto = lineas.join('\n');
    if (texto.length <= 4000) {
      await send(bot, chatId, texto);
    } else {
      // Enviar encabezado + totales, luego listas por separado
      const encabezado = lineas.slice(0, lineas.indexOf('') + 1).join('\n');
      await send(bot, chatId, encabezado);
      const chunkSize = 30;
      for (let i = 0; i < txs.length; i += chunkSize) {
        const chunk = txs.slice(i, i + chunkSize).map((t) => {
          const emoji = t.tipo === 'egreso' ? '💸' : '💰';
          return `${emoji} ${t.fecha}  *${fmtMonto(t.monto)}*  _${esc(t.descripcion)}_`;
        });
        await send(bot, chatId, chunk.join('\n'));
      }
    }
  } catch (err) {
    console.error('[cmdTransacciones]', err.message);
    await send(bot, chatId, '❌ Error al obtener las transacciones.');
  }
}

async function cmdCategorias(bot, msg) {
  const texto = `🗂️ *Categorías disponibles*
_Escríbela exactamente así en tus mensajes_
──────────────────

🍔 \`comida\`
🚌 \`transporte\`
🔌 \`servicios\`
💊 \`salud\`
🎮 \`ocio\`
👕 \`personal\`
💼 \`trabajo\`
📦 \`otros\`

*Ejemplo:*
\`gaste 20000 comida almuerzo\`
\`recibi 500000 trabajo quincena\`

_Si no reconoce la categoría, asigna *Otros* automáticamente._`;

  await send(bot, msg.chat.id, texto);
}

async function cmdComandos(bot, msg) {
  await send(bot, msg.chat.id, COMANDOS_TEXTO, null);
}

const ESTRUCTURA_TEXTO = `📝 Estructura de mensajes:

• 💸 Gaste [monto] [categoria] [descripcion]
• 💰 Recibi [monto] [categoria] [descripcion]
• 📥 Me deben [persona] [monto] [descripcion]
• 📤 Le debo [persona] [monto] [descripcion]
• ✅ Me pagaron [persona] [monto?]
• 💳 Abono [persona] [monto]
• 🔒 Obligacion [nombre] [monto] dia [N]
• ✅ Pague [nombre]
• 🎯 Presupuesto [categoria] [monto] [mes?]

Categorias:
• 🍔 Comida
• 🚌 Transporte
• 🔌 Servicios
• 💊 Salud
• 🎮 Ocio
• 👕 Personal
• 💼 Trabajo
• 📦 Otros

Ejemplos:
• Gaste 20000 comida almuerzo
• Recibi 500000 trabajo quincena
• Me deben pedro 50000 almuerzo
• Le debo maria 80000 mercado
• Obligacion arriendo 800000 dia 5
• Pague arriendo`;

const COMANDOS_TEXTO = `📋 Comandos disponibles:

/resumen — resumen general del mes
/hoy — movimientos de hoy
/semana — resumen semanal
/mes — resumen mensual
/disponible — balance real disponible
/deudas — deudas pendientes
/obligaciones — obligaciones del mes
/presupuestos — estado de presupuestos
/transacciones — todas las del mes
/transacciones_egresos — solo egresos
/transacciones_ingresos — solo ingresos
/transacciones_semana — de esta semana
/transacciones_hoy — de hoy
/categorias — ver categorías y palabras clave
/comandos — ver esta lista
/ayuda — ejemplos de mensajes`;

async function cmdAyuda(bot, msg) {
  const texto = `📖 *Estructura de mensajes*
_palabra\\_clave + monto + categoría + descripción_
──────────────────

💸 *Egreso*
\`gaste 20000 comida almuerzo\`

💰 *Ingreso*
\`recibi 500000 trabajo quincena abril\`

📥 *Me deben*
\`medeben pedro 50000 almuerzo\`

📤 *Le debo*
\`ledebo maria 80000 mercado\`

✅ *Me pagaron deuda*
\`mepagaron pedro\`
\`mepagaron pedro 50000\`

💰 *Abono de deuda*
\`abono pedro 10000\`

🔒 *Registrar obligación*
\`obligacion arriendo 800000 dia 5\`

✅ *Pagar obligación*
\`pague arriendo\`

🎯 *Presupuesto*
\`presupuesto comida 300000\`
\`presupuesto transporte 150000 abril\`

📊 *Consultas*
• \`resumen semanal\`
• \`resumen del mes\`
• \`mis deudas\`
• \`mis obligaciones\`
• \`disponible este mes\`
• \`mis presupuestos\`

_Categorías: comida · transporte · servicios · salud · ocio · personal · trabajo · otros_`;

  await send(bot, msg.chat.id, texto);
  await send(bot, msg.chat.id, ESTRUCTURA_TEXTO, null);
  await send(bot, msg.chat.id, COMANDOS_TEXTO, null);
}

module.exports = { registerCommands };
