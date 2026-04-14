'use strict';

const { parseMessage }               = require('../services/parser');
const {
  appendTransaccion,
  appendDeuda,
  appendObligacion,
  marcarDeudaPagada,
  registrarAbono,
  marcarObligacionPagada,
  upsertPresupuesto,
  getGastadoPorCategoria,
  getTransacciones,
  getDeudas,
  getObligaciones,
  upsertAhorro,
  getAhorros,
  depositarAhorro,
  appendMovimientoAhorro,
}                                     = require('../services/sheets');
const {
  generarGraficoBarras,
  generarGraficoPastel,
  generarGraficoPresupuesto,
}                                     = require('../services/charts');
const {
  resumenHoy,
  resumenSemanal,
  resumenMensual,
  resumenDisponible,
  resumenDeudas,
  resumenPresupuestos,
  resumenObligaciones,
  resumenAhorros,
}                                     = require('../services/reports');

// ---------------------------------------------------------------------------
// Lista blanca de usuarios
// ---------------------------------------------------------------------------

function getUsuariosPermitidos() {
  const raw = process.env.USUARIOS_PERMITIDOS || '';
  return raw.split(',').map((u) => u.trim()).filter(Boolean);
}

function estaPermitido(username) {
  const lista = getUsuariosPermitidos();
  if (!lista.length) return true; // sin lista → acceso abierto
  return lista.includes(username);
}

// ---------------------------------------------------------------------------
// Helpers de fecha (duplicados localmente para no acoplar al módulo de commands)
// ---------------------------------------------------------------------------

function hoy() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
}

function mesActual() {
  return hoy().slice(0, 7);
}

function inicioSemana() {
  const d = new Date(new Date().toLocaleString('en-CA', { timeZone: 'America/Bogota' }));
  const dia = d.getDay();
  const diff = dia === 0 ? -6 : 1 - dia;
  d.setDate(d.getDate() + diff);
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
}

function inicioMes() {
  return `${mesActual()}-01`;
}

function finMes() {
  const [y, m] = mesActual().split('-').map(Number);
  const ultimo = new Date(y, m, 0).getDate();
  return `${mesActual()}-${String(ultimo).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Helpers de envío
// ---------------------------------------------------------------------------

async function send(bot, chatId, text) {
  try {
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error(`[send] chatId=${chatId}:`, err.message);
  }
}

async function sendPhoto(bot, chatId, url, caption) {
  try {
    await bot.sendPhoto(chatId, url, { caption: caption || '', parse_mode: 'Markdown' });
  } catch (err) {
    console.error(`[sendPhoto] chatId=${chatId}:`, err.message);
    if (caption) await send(bot, chatId, caption);
  }
}

/** Formatea número como $X.XXX */
function fmt(n) {
  return `$${Number(n).toLocaleString('es-CO')}`;
}

// ---------------------------------------------------------------------------
// Manejadores por tipo de mensaje
// ---------------------------------------------------------------------------

async function handleEgresoIngreso(bot, chatId, parsed) {
  const { tipo, monto, categoria, descripcion, usuario, fecha } = parsed;

  await appendTransaccion({ fecha, usuario, tipo, monto, categoria, descripcion });

  const emoji = tipo === 'egreso' ? '💸' : '💰';
  const label = tipo === 'egreso' ? 'Egreso' : 'Ingreso';
  await send(bot, chatId, `✅ ${label} · ${descripcion} · *${fmt(monto)}* · ${categoria}`);

  // Alerta de presupuesto solo para egresos
  if (tipo !== 'egreso') return;

  try {
    const mes        = mesActual();
    const conGastado = await getGastadoPorCategoria(usuario, mes);
    const entry      = conGastado.find((p) => p.categoria === categoria);
    if (entry && entry.porcentaje >= 80) {
      await send(
        bot,
        chatId,
        `🚨 *Alerta presupuesto* · Llevas *${fmt(entry.gastado)}* de *${fmt(entry.presupuesto)}* en ${categoria} *(${entry.porcentaje}%)*`,
      );
    }
  } catch (err) {
    // No interrumpir el flujo por un error de alerta
    console.error('[handleEgresoIngreso] alerta presupuesto:', err.message);
  }
}

async function handleDeuda(bot, chatId, parsed) {
  const { monto, subtipo, persona, descripcion, usuario, fecha } = parsed;

  // Marcar deuda existente como pagada
  if (subtipo === 'pagada') {
    try {
      const deudas = await getDeudas(usuario, 'pendiente');
      const nombreNorm = (persona || '').toLowerCase();
      const match = deudas.find(
        (d) => d.direccion === 'me_deben' &&
               d.persona.toLowerCase().includes(nombreNorm),
      );

      if (!match) {
        await send(bot, chatId, `⚠️ No encontré una deuda pendiente de _"${persona}"_.`);
        return;
      }

      await marcarDeudaPagada(match.rowIndex);
      const montoTexto = monto ? ` · *${fmt(monto)}*` : ` · *${fmt(match.monto)}*`;
      await send(bot, chatId, `✅ Deuda cobrada · *${match.persona}* te pagó${montoTexto}`);
    } catch (err) {
      console.error('[handleDeuda pagada]', err.message);
      await send(bot, chatId, '❌ Error al marcar la deuda como pagada.');
    }
    return;
  }

  // Registrar abono parcial
  if (subtipo === 'abono') {
    try {
      const deudas = await getDeudas(usuario, 'pendiente');
      const nombreNorm = (persona || '').toLowerCase();
      const match = deudas.find(
        (d) => d.direccion === 'me_deben' &&
               d.persona.toLowerCase().includes(nombreNorm),
      );

      if (!match) {
        await send(bot, chatId, `⚠️ No encontré una deuda pendiente de _"${persona}"_.`);
        return;
      }

      const { nuevoAbonado, saldo, pagadaCompleta } = await registrarAbono(
        match.rowIndex, monto, match.monto, match.abonado,
      );

      if (pagadaCompleta) {
        await send(bot, chatId,
          `✅ Abono registrado · *${match.persona}* · *${fmt(monto)}*\n` +
          `🎉 Deuda saldada completamente · Total cobrado: *${fmt(nuevoAbonado)}*`);
      } else {
        await send(bot, chatId,
          `💰 Abono registrado · *${match.persona}* · *${fmt(monto)}*\n` +
          `📊 Abonado: *${fmt(nuevoAbonado)}* de *${fmt(match.monto)}* · Saldo pendiente: *${fmt(saldo)}*`);
      }
    } catch (err) {
      console.error('[handleDeuda abono]', err.message);
      await send(bot, chatId, '❌ Error al registrar el abono.');
    }
    return;
  }

  // Registrar nueva deuda
  await appendDeuda({ fecha, usuario, direccion: subtipo, monto, persona, descripcion, estado: 'pendiente' });

  if (subtipo === 'debo') {
    await send(bot, chatId, `💳 Deuda · Le debes *${fmt(monto)}* a *${persona || 'alguien'}*`);
  } else {
    await send(bot, chatId, `💳 Deuda · *${persona || 'Alguien'}* te debe *${fmt(monto)}*`);
  }
}

async function handleObligacion(bot, chatId, parsed) {
  const {
    monto, subtipo, tipoObligacion, descripcion,
    diaPago, mes, usuario, fecha,
  } = parsed;

  if (subtipo === 'registrar') {
    await appendObligacion({
      usuario,
      nombre:  descripcion,
      tipo:    tipoObligacion,
      monto,
      diaPago,
      estado:  'pendiente',
      mes:     mes || mesActual(),
    });
    await send(
      bot,
      chatId,
      `🔒 Obligación registrada · *${descripcion}* · *${fmt(monto)}* · día ${diaPago}`,
    );
    return;
  }

  // subtipo === 'pagar' → buscar la obligación por nombre y marcarla
  if (subtipo === 'pagar') {
    try {
      const obls = await getObligaciones(usuario, mes || mesActual());
      const nombreNorm = descripcion.toLowerCase();
      const match = obls.find(
        (o) => o.estado === 'pendiente' && o.nombre.toLowerCase().includes(nombreNorm),
      );

      if (!match) {
        await send(bot, chatId, `⚠️ No encontré una obligación pendiente con ese nombre.\nUsá /obligaciones para ver las pendientes.`);
        return;
      }

      await marcarObligacionPagada(match.rowIndex);

      // Registrar automáticamente como egreso
      const categoriaObl = ['arriendo', 'servicio'].includes(match.tipo) ? 'Servicios'
        : match.tipo === 'tarjeta' ? 'Servicios'
        : match.tipo === 'credito' ? 'Servicios'
        : 'Otros';

      await appendTransaccion({
        fecha:       hoy(),
        usuario,
        tipo:        'egreso',
        monto:       match.monto,
        categoria:   categoriaObl,
        descripcion: match.nombre,
      });

      await send(bot, chatId,
        `✅ *${match.nombre}* pagado · *${fmt(match.monto)}*\n` +
        `💸 Egreso registrado automáticamente en _${categoriaObl}_`);
    } catch (err) {
      console.error('[handleObligacion pagar]', err.message);
      await send(bot, chatId, '❌ Error al marcar la obligación como pagada.');
    }
  }
}

async function handlePresupuesto(bot, chatId, parsed) {
  const { categoria, monto, mes, usuario } = parsed;
  await upsertPresupuesto(usuario, categoria, monto, mes || mesActual());
  await send(bot, chatId, `🎯 Presupuesto actualizado · *${categoria}* · *${fmt(monto)}/mes*`);
}

async function handleConsulta(bot, chatId, parsed) {
  const { subtipo, usuario } = parsed;
  const mes = mesActual();

  try {
    switch (subtipo) {
      case 'hoy': {
        const txs = await getTransacciones(hoy(), hoy(), usuario);
        await send(bot, chatId, resumenHoy(txs, usuario));
        break;
      }

      case 'semanal': {
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
        break;
      }

      case 'mensual': {
        const [txs, obls] = await Promise.all([
          getTransacciones(inicioMes(), finMes(), usuario),
          getObligaciones(usuario, mes),
        ]);
        const texto   = resumenMensual(txs, obls, usuario);
        const egresos = txs.filter((t) => t.tipo === 'egreso');
        if (egresos.length) {
          const mapa   = egresos.reduce((acc, t) => { acc[t.categoria] = (acc[t.categoria] || 0) + t.monto; return acc; }, {});
          const cats   = Object.keys(mapa);
          const montos = cats.map((c) => mapa[c]);
          await sendPhoto(bot, chatId, generarGraficoPastel(cats, montos, `Egresos ${mes}`), texto);
        } else {
          await send(bot, chatId, texto);
        }
        break;
      }

      case 'disponible': {
        const [txs, obls] = await Promise.all([
          getTransacciones(inicioMes(), finMes(), usuario),
          getObligaciones(usuario, mes),
        ]);
        await send(bot, chatId, resumenDisponible(txs, obls, usuario, mes));
        break;
      }

      case 'deudas': {
        const deudas = await getDeudas(usuario, 'pendiente');
        await send(bot, chatId, resumenDeudas(deudas, usuario));
        break;
      }

      case 'obligaciones': {
        const obls = await getObligaciones(usuario, mes);
        await send(bot, chatId, resumenObligaciones(obls, usuario));
        break;
      }

      case 'presupuestos': {
        const conGastado = await getGastadoPorCategoria(usuario, mes);
        const texto      = resumenPresupuestos(conGastado, usuario);
        if (conGastado.length) {
          const cats    = conGastado.map((p) => p.categoria);
          const gastado = conGastado.map((p) => p.gastado);
          const limites = conGastado.map((p) => p.presupuesto);
          await sendPhoto(bot, chatId, generarGraficoPresupuesto(cats, gastado, limites, `Presupuestos ${mes}`), texto);
        } else {
          await send(bot, chatId, texto);
        }
        break;
      }

      case 'ahorros': {
        const ahorros = await getAhorros(usuario, mes);
        await send(bot, chatId, resumenAhorros(ahorros, usuario));
        break;
      }

      default:
        await send(bot, chatId, '🤔 No entendí qué consulta querés hacer. Probá con /ayuda.');
    }
  } catch (err) {
    console.error('[handleConsulta]', err.message);
    await send(bot, chatId, '❌ Error al generar el reporte. Intenta de nuevo.');
  }
}

async function handleAhorro(bot, chatId, parsed) {
  const { monto, subtipo, descripcion, mes, usuario } = parsed;

  if (subtipo === 'meta') {
    await upsertAhorro(usuario, descripcion, monto, mes || mesActual());
    await send(bot, chatId, `💰 Meta de ahorro definida · *${descripcion}* · *${fmt(monto)}*`);
    return;
  }

  if (subtipo === 'deposito') {
    try {
      const ahorros    = await getAhorros(usuario, mes || mesActual());
      const nombreNorm = descripcion.toLowerCase();
      const match      = ahorros.find((a) => a.nombre.toLowerCase().includes(nombreNorm));

      if (!match) {
        await send(bot, chatId, `⚠️ No encontré una meta de ahorro con ese nombre.\nUsá /ahorros para ver tus metas.`);
        return;
      }

      const { nuevoAcumulado, completado } = await depositarAhorro(
        match.rowIndex, monto, match.meta, match.acumulado,
      );

      await appendMovimientoAhorro({ fecha: hoy(), usuario, nombre: match.nombre, monto });

      if (completado) {
        await send(bot, chatId,
          `🎉 *¡Meta alcanzada!* · *${match.nombre}*\n` +
          `💰 Total ahorrado: *${fmt(nuevoAcumulado)}* de *${fmt(match.meta)}*`);
      } else {
        const porcentaje = Math.round((nuevoAcumulado / match.meta) * 100);
        await send(bot, chatId,
          `💰 Ahorro registrado · *${match.nombre}* · *${fmt(monto)}*\n` +
          `📊 Acumulado: *${fmt(nuevoAcumulado)}* de *${fmt(match.meta)}* *(${porcentaje}%)*`);
      }
    } catch (err) {
      console.error('[handleAhorro deposito]', err.message);
      await send(bot, chatId, '❌ Error al registrar el ahorro.');
    }
  }
}

async function handleDesconocido(bot, chatId, texto) {
  await send(
    bot,
    chatId,
    `🤔 No entendí _"${texto}"_\n\nAlgunos ejemplos:\n• \`almuerzo 12000\`\n• \`gasté 30000 en taxi\`\n• \`recibí 500000 de salario\`\n• \`le debo 50000 a Pedro\`\n• \`presupuesto comida 300000\`\n• \`pagar arriendo 800000 día 5\`\n\nEscribí /ayuda para ver todos los ejemplos.`,
  );
}

// ---------------------------------------------------------------------------
// Registro del listener principal
// ---------------------------------------------------------------------------

/**
 * Registra el manejador de mensajes de texto libre en el bot.
 * @param {TelegramBot} bot
 */
function registerMessageHandler(bot) {
  bot.on('message', async (msg) => {
    // Solo mensajes de texto (ignora fotos, stickers, etc.)
    if (!msg.text || msg.text.startsWith('/')) return;

    const chatId   = msg.chat.id;
    const username = msg.from.username || String(msg.from.id);

    // Lista blanca
    if (!estaPermitido(username)) {
      await send(bot, chatId, 'No tienes acceso a este bot. 🔒');
      return;
    }

    const parsed = parseMessage(msg.text, username);

    console.log(`[msg] @${username}: ${msg.text} → tipo=${parsed.tipo} subtipo=${parsed.subtipo}`);

    try {
      switch (parsed.tipo) {
        case 'egreso':
        case 'ingreso':
          await handleEgresoIngreso(bot, chatId, parsed);
          break;
        case 'deuda':
          await handleDeuda(bot, chatId, parsed);
          break;
        case 'obligacion':
          await handleObligacion(bot, chatId, parsed);
          break;
        case 'presupuesto':
          await handlePresupuesto(bot, chatId, parsed);
          break;
        case 'ahorro':
          await handleAhorro(bot, chatId, parsed);
          break;
        case 'consulta':
          await handleConsulta(bot, chatId, parsed);
          break;
        default:
          await handleDesconocido(bot, chatId, msg.text);
      }
    } catch (err) {
      console.error(`[message handler] @${username}:`, err.message);
      await send(bot, chatId, '❌ Ocurrió un error. Intenta de nuevo.');
    }
  });
}

module.exports = { registerMessageHandler };
