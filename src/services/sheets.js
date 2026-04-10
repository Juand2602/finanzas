'use strict';

const { google } = require('googleapis');

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;

const SHEETS = {
  TRANSACCIONES: 'Transacciones',
  DEUDAS: 'Deudas',
  PRESUPUESTOS: 'Presupuestos',
  OBLIGACIONES: 'Obligaciones',
};

let _sheetsClient = null;

function getSheetsClient() {
  if (_sheetsClient) return _sheetsClient;
  const raw = process.env.GOOGLE_PRIVATE_KEY || '';
  const key = raw.includes('-----BEGIN')
    ? raw.replace(/\\n/g, '\n')
    : Buffer.from(raw, 'base64').toString('utf8');
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  _sheetsClient = google.sheets({ version: 'v4', auth });
  return _sheetsClient;
}

/**
 * Obtiene todas las filas de un rango y las devuelve como array de arrays.
 * Retorna [] si la hoja está vacía.
 */
async function getRows(sheetName, range) {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!${range}`,
  });
  return res.data.values || [];
}

/**
 * Agrega una fila al final de la hoja indicada.
 */
async function appendRow(sheetName, values) {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A1`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [values] },
  });
}

/**
 * Actualiza una celda o rango en una fila específica (1-indexed).
 */
async function updateRow(sheetName, rowIndex, colStart, values) {
  const sheets = getSheetsClient();
  const colEnd = String.fromCharCode(colStart.charCodeAt(0) + values.length - 1);
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!${colStart}${rowIndex}:${colEnd}${rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [values] },
  });
}

// ---------------------------------------------------------------------------
// TRANSACCIONES
// ---------------------------------------------------------------------------

/**
 * Agrega una transacción.
 * @param {{ fecha, usuario, tipo, monto, categoria, descripcion }} data
 */
async function appendTransaccion(data) {
  try {
    const { fecha, usuario, tipo, monto, categoria, descripcion } = data;
    await appendRow(SHEETS.TRANSACCIONES, [fecha, usuario, tipo, monto, categoria, descripcion]);
  } catch (err) {
    throw new Error(`appendTransaccion: ${err.message}`);
  }
}

/**
 * Retorna transacciones filtradas por rango de fechas y opcionalmente por usuario.
 * @param {string} fechaInicio  YYYY-MM-DD
 * @param {string} fechaFin     YYYY-MM-DD
 * @param {string} [usuario]
 * @returns {Array<{ rowIndex, fecha, usuario, tipo, monto, categoria, descripcion }>}
 */
async function getTransacciones(fechaInicio, fechaFin, usuario) {
  try {
    const rows = await getRows(SHEETS.TRANSACCIONES, 'A2:F');
    return rows
      .map((r, i) => ({
        rowIndex: i + 2, // fila real en la hoja (con encabezado en fila 1)
        fecha: r[0] || '',
        usuario: r[1] || '',
        tipo: r[2] || '',
        monto: parseInt(r[3], 10) || 0,
        categoria: r[4] || '',
        descripcion: r[5] || '',
      }))
      .filter((t) => {
        const dentroDeRango = t.fecha >= fechaInicio && t.fecha <= fechaFin;
        const coincideUsuario = !usuario || t.usuario === usuario;
        return dentroDeRango && coincideUsuario;
      });
  } catch (err) {
    throw new Error(`getTransacciones: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// DEUDAS
// ---------------------------------------------------------------------------

/**
 * Agrega una deuda.
 * @param {{ fecha, usuario, direccion, monto, persona, descripcion, estado }} data
 */
async function appendDeuda(data) {
  try {
    const { fecha, usuario, direccion, monto, persona, descripcion, estado = 'pendiente' } = data;
    await appendRow(SHEETS.DEUDAS, [fecha, usuario, direccion, monto, persona, descripcion, estado]);
  } catch (err) {
    throw new Error(`appendDeuda: ${err.message}`);
  }
}

/**
 * Retorna deudas filtradas opcionalmente por usuario y/o estado.
 * Lee hasta columna H (Abonado).
 * @param {string} [usuario]
 * @param {string} [estado]  "pendiente" | "pagada"
 * @returns {Array<{ rowIndex, fecha, usuario, direccion, monto, persona, descripcion, estado, abonado, saldo }>}
 */
async function getDeudas(usuario, estado) {
  try {
    const rows = await getRows(SHEETS.DEUDAS, 'A2:H');
    return rows
      .map((r, i) => {
        const monto   = parseInt(r[3], 10) || 0;
        const abonado = parseInt(r[7], 10) || 0;
        return {
          rowIndex:    i + 2,
          fecha:       r[0] || '',
          usuario:     r[1] || '',
          direccion:   r[2] || '',
          monto,
          persona:     r[4] || '',
          descripcion: r[5] || '',
          estado:      r[6] || 'pendiente',
          abonado,
          saldo:       monto - abonado,
        };
      })
      .filter((d) => {
        const coincideUsuario = !usuario || d.usuario === usuario;
        const coincideEstado  = !estado  || d.estado  === estado;
        return coincideUsuario && coincideEstado;
      });
  } catch (err) {
    throw new Error(`getDeudas: ${err.message}`);
  }
}

/**
 * Marca una deuda como pagada actualizando la columna G de la fila indicada.
 * @param {number} rowIndex
 */
async function marcarDeudaPagada(rowIndex) {
  try {
    await updateRow(SHEETS.DEUDAS, rowIndex, 'G', ['pagada']);
  } catch (err) {
    throw new Error(`marcarDeudaPagada: ${err.message}`);
  }
}

/**
 * Registra un abono parcial en una deuda (columna H).
 * Si el acumulado >= monto total, la marca automáticamente como pagada.
 * @param {number} rowIndex
 * @param {number} montoAbono
 * @param {number} montoTotal   Monto original de la deuda
 * @param {number} abonadoPrev  Lo que ya estaba abonado antes
 * @returns {{ nuevoAbonado, saldo, pagadaCompleta }}
 */
async function registrarAbono(rowIndex, montoAbono, montoTotal, abonadoPrev) {
  try {
    const nuevoAbonado = abonadoPrev + montoAbono;
    const saldo        = montoTotal - nuevoAbonado;
    const pagadaCompleta = nuevoAbonado >= montoTotal;

    if (pagadaCompleta) {
      // Actualiza abonado y estado en una sola llamada (G y H)
      await updateRow(SHEETS.DEUDAS, rowIndex, 'G', ['pagada', nuevoAbonado]);
    } else {
      await updateRow(SHEETS.DEUDAS, rowIndex, 'H', [nuevoAbonado]);
    }

    return { nuevoAbonado, saldo: Math.max(saldo, 0), pagadaCompleta };
  } catch (err) {
    throw new Error(`registrarAbono: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// PRESUPUESTOS
// ---------------------------------------------------------------------------

/**
 * Crea o actualiza el presupuesto de un usuario para una categoría y mes.
 * @param {string} usuario
 * @param {string} categoria
 * @param {number} monto
 * @param {string} mes  YYYY-MM
 */
async function upsertPresupuesto(usuario, categoria, monto, mes) {
  try {
    const rows = await getRows(SHEETS.PRESUPUESTOS, 'A2:D');
    const existingIndex = rows.findIndex(
      (r) => r[0] === usuario && r[1] === categoria && r[3] === mes
    );

    if (existingIndex !== -1) {
      const rowIndex = existingIndex + 2;
      await updateRow(SHEETS.PRESUPUESTOS, rowIndex, 'A', [usuario, categoria, monto, mes]);
    } else {
      await appendRow(SHEETS.PRESUPUESTOS, [usuario, categoria, monto, mes]);
    }
  } catch (err) {
    throw new Error(`upsertPresupuesto: ${err.message}`);
  }
}

/**
 * Retorna todos los presupuestos de un usuario para un mes dado.
 * @param {string} usuario
 * @param {string} mes  YYYY-MM
 * @returns {Array<{ rowIndex, usuario, categoria, monto, mes }>}
 */
async function getPresupuestos(usuario, mes) {
  try {
    const rows = await getRows(SHEETS.PRESUPUESTOS, 'A2:D');
    return rows
      .map((r, i) => ({
        rowIndex: i + 2,
        usuario: r[0] || '',
        categoria: r[1] || '',
        monto: parseInt(r[2], 10) || 0,
        mes: r[3] || '',
      }))
      .filter((p) => p.usuario === usuario && p.mes === mes);
  } catch (err) {
    throw new Error(`getPresupuestos: ${err.message}`);
  }
}

/**
 * Cruza Transacciones con Presupuestos para el usuario y mes indicados.
 * @param {string} usuario
 * @param {string} mes  YYYY-MM  (ej: "2026-04")
 * @returns {Array<{ categoria, presupuesto, gastado, porcentaje, alerta }>}
 *          alerta es true si porcentaje >= 80
 */
async function getGastadoPorCategoria(usuario, mes) {
  try {
    const fechaInicio = `${mes}-01`;
    // Último día del mes calculado sin dependencias externas
    const [anio, mesNum] = mes.split('-').map(Number);
    const ultimoDia = new Date(anio, mesNum, 0).getDate();
    const fechaFin = `${mes}-${String(ultimoDia).padStart(2, '0')}`;

    const [presupuestos, transacciones] = await Promise.all([
      getPresupuestos(usuario, mes),
      getTransacciones(fechaInicio, fechaFin, usuario),
    ]);

    const egresos = transacciones.filter((t) => t.tipo === 'egreso');

    // Acumula gasto real por categoría
    const gastadoMap = {};
    for (const t of egresos) {
      gastadoMap[t.categoria] = (gastadoMap[t.categoria] || 0) + t.monto;
    }

    return presupuestos.map((p) => {
      const gastado = gastadoMap[p.categoria] || 0;
      const porcentaje = p.monto > 0 ? Math.round((gastado / p.monto) * 100) : 0;
      return {
        categoria: p.categoria,
        presupuesto: p.monto,
        gastado,
        porcentaje,
        alerta: porcentaje >= 80,
      };
    });
  } catch (err) {
    throw new Error(`getGastadoPorCategoria: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// OBLIGACIONES
// ---------------------------------------------------------------------------

/**
 * Agrega una obligación mensual.
 * @param {{ usuario, nombre, tipo, monto, diaPago, estado, mes }} data
 */
async function appendObligacion(data) {
  try {
    const { usuario, nombre, tipo, monto, diaPago, estado = 'pendiente', mes } = data;
    await appendRow(SHEETS.OBLIGACIONES, [usuario, nombre, tipo, monto, diaPago, estado, mes]);
  } catch (err) {
    throw new Error(`appendObligacion: ${err.message}`);
  }
}

/**
 * Retorna las obligaciones de un usuario para un mes dado.
 * @param {string} usuario
 * @param {string} mes  YYYY-MM
 * @returns {Array<{ rowIndex, usuario, nombre, tipo, monto, diaPago, estado, mes }>}
 */
async function getObligaciones(usuario, mes) {
  try {
    const rows = await getRows(SHEETS.OBLIGACIONES, 'A2:G');
    return rows
      .map((r, i) => ({
        rowIndex: i + 2,
        usuario: r[0] || '',
        nombre: r[1] || '',
        tipo: r[2] || '',
        monto: parseInt(r[3], 10) || 0,
        diaPago: parseInt(r[4], 10) || 0,
        estado: r[5] || 'pendiente',
        mes: r[6] || '',
      }))
      .filter((o) => o.usuario === usuario && o.mes === mes);
  } catch (err) {
    throw new Error(`getObligaciones: ${err.message}`);
  }
}

/**
 * Marca una obligación como pagada actualizando la columna F de la fila indicada.
 * @param {number} rowIndex  Número de fila real en la hoja (1-indexed)
 */
async function marcarObligacionPagada(rowIndex) {
  try {
    await updateRow(SHEETS.OBLIGACIONES, rowIndex, 'F', ['pagada']);
  } catch (err) {
    throw new Error(`marcarObligacionPagada: ${err.message}`);
  }
}

/**
 * Suma los montos de las obligaciones pendientes de un usuario en un mes.
 * @param {string} usuario
 * @param {string} mes  YYYY-MM
 * @returns {number}
 */
async function getTotalObligacionesPendientes(usuario, mes) {
  try {
    const obligaciones = await getObligaciones(usuario, mes);
    return obligaciones
      .filter((o) => o.estado === 'pendiente')
      .reduce((sum, o) => sum + o.monto, 0);
  } catch (err) {
    throw new Error(`getTotalObligacionesPendientes: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------

module.exports = {
  // Transacciones
  appendTransaccion,
  getTransacciones,
  // Deudas
  appendDeuda,
  getDeudas,
  marcarDeudaPagada,
  registrarAbono,
  // Presupuestos
  upsertPresupuesto,
  getPresupuestos,
  getGastadoPorCategoria,
  // Obligaciones
  appendObligacion,
  getObligaciones,
  marcarObligacionPagada,
  getTotalObligacionesPendientes,
};
