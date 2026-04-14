'use strict';

// ---------------------------------------------------------------------------
// Constantes de formato
// ---------------------------------------------------------------------------

const SEP = '──────────────────';

const EMOJI_CAT = {
  Comida:     '🍔',
  Transporte: '🚌',
  Salud:      '💊',
  Ocio:       '🎮',
  Personal:   '👕',
  Trabajo:    '💼',
  Servicios:  '🔌',
  Otros:      '📦',
};

const EMOJI_TIPO_OBL = {
  arriendo: '🏠',
  tarjeta:  '💳',
  credito:  '🏦',
  servicio: '🔌',
  otro:     '📋',
};

// ---------------------------------------------------------------------------
// Helpers de formato
// ---------------------------------------------------------------------------

/** Escapa caracteres especiales de Markdown v1 de Telegram en texto dinámico. */
function esc(text) {
  return String(text || '').replace(/[_*`[]/g, '\\$&');
}

/** Formatea número entero como $X.XXX (separador de miles con punto). */
function fmt(monto) {
  return `$${Number(monto).toLocaleString('es-CO')}`;
}

/** Emoji de categoría con fallback. */
function emojiCat(cat) {
  return EMOJI_CAT[cat] || '📦';
}

/** Emoji de tipo de obligación. */
function emojiObl(tipo) {
  return EMOJI_TIPO_OBL[tipo] || '📋';
}

/**
 * Barra de progreso de texto (10 bloques).
 * Ej: pct=75 → "███████░░░ 75%"
 */
function barraProgreso(pct) {
  const total = 10;
  const llenos = Math.min(Math.round((pct / 100) * total), total);
  const vacios = total - llenos;
  return `${'█'.repeat(llenos)}${'░'.repeat(vacios)} ${pct}%`;
}

/**
 * Agrupa transacciones por categoría sumando montos.
 * @param {object[]} txs  Lista de transacciones filtradas por tipo
 * @returns {{ [cat]: number }}
 */
function agruparPorCategoria(txs) {
  return txs.reduce((acc, t) => {
    acc[t.categoria] = (acc[t.categoria] || 0) + t.monto;
    return acc;
  }, {});
}

/** Suma montos de una lista de transacciones. */
function sumar(txs) {
  return txs.reduce((s, t) => s + t.monto, 0);
}

/**
 * Devuelve el encabezado estándar de reporte.
 * @param {string} titulo
 * @param {string} usuario
 */
function encabezado(titulo, usuario) {
  return `${titulo}\n_@${usuario}_\n${SEP}`;
}

/**
 * Construye el bloque de desglose por categoría.
 * @param {{ [cat]: number }} mapaGastos
 */
function bloqueCategoria(mapaGastos) {
  const entradas = Object.entries(mapaGastos).sort((a, b) => b[1] - a[1]);
  if (!entradas.length) return '_Sin movimientos registrados._';
  return entradas
    .map(([cat, monto]) => `${emojiCat(cat)} ${cat}: *${fmt(monto)}*`)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Reportes
// ---------------------------------------------------------------------------

/**
 * Resumen de transacciones del día actual.
 * @param {object[]} transacciones  Ya filtradas por fecha de hoy y usuario
 * @param {string}   usuario
 * @returns {string}
 */
function resumenHoy(transacciones, usuario) {
  const egresos  = transacciones.filter((t) => t.tipo === 'egreso');
  const ingresos = transacciones.filter((t) => t.tipo === 'ingreso');

  const totalEgresos  = sumar(egresos);
  const totalIngresos = sumar(ingresos);
  const mapaGastos    = agruparPorCategoria(egresos);

  const lineas = [
    encabezado('📅 *Resumen de hoy*', usuario),
    '',
    `💰 Ingresos:  *${fmt(totalIngresos)}*`,
    `💸 Egresos:   *${fmt(totalEgresos)}*`,
    `📊 Balance:   *${fmt(totalIngresos - totalEgresos)}*`,
  ];

  if (egresos.length) {
    lineas.push('', SEP, '📋 *Detalle de gastos*', '');
    lineas.push(bloqueCategoria(mapaGastos));
  }

  if (!transacciones.length) {
    lineas.push('', '_Sin movimientos hoy._');
  }

  return lineas.join('\n');
}

/**
 * Resumen semanal de transacciones.
 * @param {object[]} transacciones  Ya filtradas por semana y usuario
 * @param {string}   usuario
 * @returns {string}
 */
function resumenSemanal(transacciones, usuario) {
  const egresos  = transacciones.filter((t) => t.tipo === 'egreso');
  const ingresos = transacciones.filter((t) => t.tipo === 'ingreso');

  const totalEgresos  = sumar(egresos);
  const totalIngresos = sumar(ingresos);
  const mapaGastos    = agruparPorCategoria(egresos);
  const promDiario    = egresos.length ? Math.round(totalEgresos / 7) : 0;

  const lineas = [
    encabezado('📆 *Resumen semanal*', usuario),
    '',
    `💰 Ingresos:      *${fmt(totalIngresos)}*`,
    `💸 Egresos:       *${fmt(totalEgresos)}*`,
    `📊 Balance:       *${fmt(totalIngresos - totalEgresos)}*`,
    `📉 Gasto/día:     *${fmt(promDiario)}*`,
  ];

  if (egresos.length) {
    lineas.push('', SEP, '📋 *Gastos por categoría*', '');
    lineas.push(bloqueCategoria(mapaGastos));
  }

  if (!transacciones.length) {
    lineas.push('', '_Sin movimientos esta semana._');
  }

  return lineas.join('\n');
}

/**
 * Resumen mensual con sección de obligaciones.
 * @param {object[]} transacciones  Ya filtradas por mes y usuario
 * @param {object[]} obligaciones   Ya filtradas por mes y usuario
 * @param {string}   usuario
 * @returns {string}
 */
function resumenMensual(transacciones, obligaciones, usuario) {
  const egresos  = transacciones.filter((t) => t.tipo === 'egreso');
  const ingresos = transacciones.filter((t) => t.tipo === 'ingreso');

  const totalEgresos  = sumar(egresos);
  const totalIngresos = sumar(ingresos);
  const mapaGastos    = agruparPorCategoria(egresos);

  const oblPagadas   = obligaciones.filter((o) => o.estado === 'pagada');
  const oblPendientes = obligaciones.filter((o) => o.estado === 'pendiente');
  const totalOblPend = oblPendientes.reduce((s, o) => s + o.monto, 0);

  const lineas = [
    encabezado('🗓️ *Resumen mensual*', usuario),
    '',
    `💰 Ingresos:  *${fmt(totalIngresos)}*`,
    `💸 Egresos:   *${fmt(totalEgresos)}*`,
    `📊 Balance:   *${fmt(totalIngresos - totalEgresos)}*`,
  ];

  if (egresos.length) {
    lineas.push('', SEP, '📋 *Gastos por categoría*', '');
    lineas.push(bloqueCategoria(mapaGastos));
  }

  // Sección obligaciones
  lineas.push('', SEP, '🔒 *Obligaciones del mes*', '');
  if (!obligaciones.length) {
    lineas.push('_Sin obligaciones registradas._');
  } else {
    lineas.push(
      `✅ Pagadas (${oblPagadas.length}):   *${fmt(oblPagadas.reduce((s, o) => s + o.monto, 0))}*`,
      `⏳ Pendientes (${oblPendientes.length}): *${fmt(totalOblPend)}*`,
    );
    if (oblPendientes.length) {
      lineas.push('');
      oblPendientes.forEach((o) => {
        lineas.push(`  ${emojiObl(o.tipo)} ${esc(o.nombre)} — *${fmt(o.monto)}* (día ${o.diaPago})`);
      });
    }
  }

  return lineas.join('\n');
}

/**
 * Disponible real del mes: ingresos − egresos − obligaciones pendientes.
 * @param {object[]} transacciones  Filtradas por mes y usuario
 * @param {object[]} obligaciones   Filtradas por mes y usuario
 * @param {string}   usuario
 * @param {string}   mes            YYYY-MM
 * @returns {string}
 */
function resumenDisponible(transacciones, obligaciones, usuario, mes) {
  const egresos  = transacciones.filter((t) => t.tipo === 'egreso');
  const ingresos = transacciones.filter((t) => t.tipo === 'ingreso');

  const totalIngresos = sumar(ingresos);
  const totalEgresos  = sumar(egresos);

  const oblPendientes  = obligaciones.filter((o) => o.estado === 'pendiente');
  const totalOblPend   = oblPendientes.reduce((s, o) => s + o.monto, 0);
  const disponible     = totalIngresos - totalEgresos - totalOblPend;

  const lineas = [
    encabezado(`💵 *Disponible — ${mes}*`, usuario),
    '',
    `💰 Ingresos del mes:          *${fmt(totalIngresos)}*`,
    `💸 Egresos del mes:           *${fmt(totalEgresos)}*`,
    `🔒 Obligaciones pendientes:   *${fmt(totalOblPend)}*`,
  ];

  if (oblPendientes.length) {
    lineas.push('');
    oblPendientes.forEach((o) => {
      lineas.push(`    ${emojiObl(o.tipo)} ${esc(o.nombre)}: *${fmt(o.monto)}*`);
    });
  }

  lineas.push(
    '',
    SEP,
    `✅ *Disponible real: ${fmt(disponible)}*`,
  );

  if (disponible < 0) {
    lineas.push('', '⚠️ _Gastos y obligaciones superan los ingresos registrados._');
  }

  return lineas.join('\n');
}

/**
 * Lista de deudas (debo / me deben).
 * @param {object[]} deudas  Ya filtradas por usuario
 * @param {string}   usuario
 * @returns {string}
 */
function resumenDeudas(deudas, usuario) {
  const debo    = deudas.filter((d) => d.direccion === 'debo');
  const meDeben = deudas.filter((d) => d.direccion === 'me_deben');

  // Saldos reales (descontando abonos)
  const totalDebo    = debo.reduce((s, d) => s + (d.saldo ?? d.monto), 0);
  const totalMeDeben = meDeben.reduce((s, d) => s + (d.saldo ?? d.monto), 0);

  const lineas = [
    encabezado('💬 *Deudas pendientes*', usuario),
    '',
    `📤 Total que debo:     *${fmt(totalDebo)}*`,
    `📥 Total que me deben: *${fmt(totalMeDeben)}*`,
  ];

  if (debo.length) {
    lineas.push('', SEP, '📤 *Le debo a:*', '');
    debo.forEach((d) => {
      const tieneAbono = d.abonado > 0;
      lineas.push(`  ⏳ *${esc(d.persona || 'Desconocido')}*`);
      if (tieneAbono) {
        lineas.push(`     Total: ${fmt(d.monto)} · Abonado: ${fmt(d.abonado)} · Saldo: *${fmt(d.saldo)}*`);
      } else {
        lineas.push(`     Monto: *${fmt(d.monto)}*`);
      }
      if (d.descripcion) lineas.push(`     _${esc(d.descripcion)}_`);
    });
  }

  if (meDeben.length) {
    lineas.push('', SEP, '📥 *Me deben:*', '');
    meDeben.forEach((d) => {
      const tieneAbono = d.abonado > 0;
      lineas.push(`  ⏳ *${esc(d.persona || 'Alguien')}*`);
      if (tieneAbono) {
        lineas.push(`     Total: ${fmt(d.monto)} · Abonado: ${fmt(d.abonado)} · Saldo: *${fmt(d.saldo)}*`);
      } else {
        lineas.push(`     Monto: *${fmt(d.monto)}*`);
      }
      if (d.descripcion) lineas.push(`     _${esc(d.descripcion)}_`);
    });
  }

  if (!deudas.length) {
    lineas.push('', '_Sin deudas pendientes._ 🎉');
  }

  return lineas.join('\n');
}

/**
 * Estado de presupuestos con barra de progreso.
 * @param {Array<{ categoria, presupuesto, gastado, porcentaje, alerta }>} presupuestosConGastado
 * @param {string} usuario
 * @returns {string}
 */
function resumenPresupuestos(presupuestosConGastado, usuario) {
  const lineas = [
    encabezado('📊 *Presupuestos*', usuario),
    '',
  ];

  if (!presupuestosConGastado.length) {
    lineas.push('_Sin presupuestos definidos para este mes._');
    return lineas.join('\n');
  }

  let hayAlerta = false;

  presupuestosConGastado.forEach((p) => {
    const { categoria, presupuesto, gastado, porcentaje } = p;
    let icono;
    if (porcentaje >= 80) {
      icono = '🚨';
      hayAlerta = true;
    } else if (porcentaje >= 60) {
      icono = '⚠️';
    } else {
      icono = '✅';
    }

    lineas.push(
      `${icono} *${emojiCat(categoria)} ${categoria}*`,
      `   ${barraProgreso(porcentaje)}`,
      `   ${fmt(gastado)} de ${fmt(presupuesto)}`,
      '',
    );
  });

  if (hayAlerta) {
    lineas.push(SEP, '🚨 _Algunas categorías superan el 80% del presupuesto._');
  }

  return lineas.join('\n');
}

/**
 * Lista de obligaciones mensuales con estado.
 * @param {object[]} obligaciones  Ya filtradas por mes y usuario
 * @param {string}   usuario
 * @returns {string}
 */
function resumenObligaciones(obligaciones, usuario) {
  const pagadas    = obligaciones.filter((o) => o.estado === 'pagada');
  const pendientes = obligaciones.filter((o) => o.estado === 'pendiente');

  const totalPagado   = pagadas.reduce((s, o) => s + o.monto, 0);
  const totalPendiente = pendientes.reduce((s, o) => s + o.monto, 0);

  const lineas = [
    encabezado('🔒 *Obligaciones del mes*', usuario),
    '',
    `✅ Pagado:    *${fmt(totalPagado)}*   (${pagadas.length} items)`,
    `⏳ Pendiente: *${fmt(totalPendiente)}*  (${pendientes.length} items)`,
    '',
    SEP,
  ];

  if (!obligaciones.length) {
    lineas.push('', '_Sin obligaciones registradas._');
    return lineas.join('\n');
  }

  // Pendientes primero, ordenadas por día de pago
  const ordenadas = [
    ...pendientes.sort((a, b) => a.diaPago - b.diaPago),
    ...pagadas.sort((a, b) => a.diaPago - b.diaPago),
  ];

  ordenadas.forEach((o) => {
    const estado = o.estado === 'pagada' ? '✅' : '⏳';
    lineas.push(
      `${estado} ${emojiObl(o.tipo)} *${esc(o.nombre)}*`,
      `   ${fmt(o.monto)} — día ${o.diaPago}`,
      '',
    );
  });

  return lineas.join('\n');
}

/**
 * Estado de metas de ahorro con barra de progreso.
 * @param {Array<{ nombre, meta, acumulado, porcentaje }>} ahorros
 * @param {string} usuario
 * @returns {string}
 */
function resumenAhorros(ahorros, usuario) {
  const lineas = [
    encabezado('💰 *Ahorros*', usuario),
    '',
  ];

  if (!ahorros.length) {
    lineas.push('_Sin metas de ahorro definidas._');
    return lineas.join('\n');
  }

  const totalMeta      = ahorros.reduce((s, a) => s + a.meta, 0);
  const totalAcumulado = ahorros.reduce((s, a) => s + a.acumulado, 0);

  ahorros.forEach((a) => {
    const { porcentaje } = a;
    const icono = porcentaje >= 100 ? '🎉'
      : porcentaje >= 60 ? '✅'
      : porcentaje >= 30 ? '📈'
      : '🪙';

    lineas.push(
      `${icono} *${esc(a.nombre)}*`,
      `   ${barraProgreso(porcentaje)}`,
      `   ${fmt(a.acumulado)} de ${fmt(a.meta)}`,
      '',
    );
  });

  lineas.push(
    SEP,
    `💰 Total ahorrado: *${fmt(totalAcumulado)}* de *${fmt(totalMeta)}*`,
  );

  return lineas.join('\n');
}

// ---------------------------------------------------------------------------

module.exports = {
  resumenHoy,
  resumenSemanal,
  resumenMensual,
  resumenDisponible,
  resumenDeudas,
  resumenPresupuestos,
  resumenObligaciones,
  resumenAhorros,
};
