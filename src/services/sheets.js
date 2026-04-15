'use strict';

const { JWT } = require('google-auth-library');

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const BASE_URL = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}`;

const SHEETS = {
  TRANSACCIONES:      'Transacciones',
  DEUDAS:             'Deudas',
  PRESUPUESTOS:       'Presupuestos',
  OBLIGACIONES:       'Obligaciones',
  AHORROS:            'Ahorros',
  MOVIMIENTOS_AHORRO: 'MovimientosAhorro',
};

let _authClient = null;

function getAuthClient() {
  if (_authClient) return _authClient;
  const raw = process.env.GOOGLE_PRIVATE_KEY || '';
  const key = raw.includes('-----BEGIN')
    ? raw.replace(/\\n/g, '\n')
    : Buffer.from(raw, 'base64').toString('utf8');
  _authClient = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return _authClient;
}

async function getAccessToken() {
  const { token } = await getAuthClient().getAccessToken();
  return token;
}

/**
 * Obtiene todas las filas de un rango y las devuelve como array de arrays.
 * Retorna [] si la hoja está vacía.
 */
async function getRows(sheetName, range) {
  const token   = await getAccessToken();
  const encoded = encodeURIComponent(`${sheetName}!${range}`);
  const res     = await fetch(`${BASE_URL}/values/${encoded}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`getRows HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.values || [];
}

/**
 * Agrega una fila al final de la hoja indicada.
 */
async function appendRow(sheetName, values) {
  const token   = await getAccessToken();
  const encoded = encodeURIComponent(`${sheetName}!A1`);
  const res     = await fetch(
    `${BASE_URL}/values/${encoded}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ values: [values] }),
    },
  );
  if (!res.ok) throw new Error(`appendRow HTTP ${res.status}: ${await res.text()}`);
}

/**
 * Actualiza una celda o rango en una fila específica (1-indexed).
 */
async function updateRow(sheetName, rowIndex, colStart, values) {
  const token  = await getAccessToken();
  const colEnd = String.fromCharCode(colStart.charCodeAt(0) + values.length - 1);
  const range  = `${sheetName}!${colStart}${rowIndex}:${colEnd}${rowIndex}`;
  const res    = await fetch(
    `${BASE_URL}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    {
      method:  'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ values: [values] }),
    },
  );
  if (!res.ok) throw new Error(`updateRow HTTP ${res.status}: ${await res.text()}`);
}

// ---------------------------------------------------------------------------
// TRANSACCIONES
// ---------------------------------------------------------------------------

async function appendTransaccion(data) {
  try {
    const { fecha, usuario, tipo, monto, categoria, descripcion } = data;
    await appendRow(SHEETS.TRANSACCIONES, [fecha, usuario, tipo, monto, categoria, descripcion]);
  } catch (err) {
    throw new Error(`appendTransaccion: ${err.message}`);
  }
}

async function getTransacciones(fechaInicio, fechaFin, usuario) {
  try {
    const rows = await getRows(SHEETS.TRANSACCIONES, 'A2:F');
    return rows
      .map((r, i) => ({
        rowIndex:    i + 2,
        fecha:       r[0] || '',
        usuario:     r[1] || '',
        tipo:        r[2] || '',
        monto:       parseInt(r[3], 10) || 0,
        categoria:   r[4] || '',
        descripcion: r[5] || '',
      }))
      .filter((t) => {
        const dentroDeRango   = t.fecha >= fechaInicio && t.fecha <= fechaFin;
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

async function appendDeuda(data) {
  try {
    const { fecha, usuario, direccion, monto, persona, descripcion, estado = 'pendiente' } = data;
    await appendRow(SHEETS.DEUDAS, [fecha, usuario, direccion, monto, persona, descripcion, estado]);
  } catch (err) {
    throw new Error(`appendDeuda: ${err.message}`);
  }
}

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

async function marcarDeudaPagada(rowIndex) {
  try {
    await updateRow(SHEETS.DEUDAS, rowIndex, 'G', ['pagada']);
  } catch (err) {
    throw new Error(`marcarDeudaPagada: ${err.message}`);
  }
}

async function registrarAbono(rowIndex, montoAbono, montoTotal, abonadoPrev) {
  try {
    const nuevoAbonado   = abonadoPrev + montoAbono;
    const saldo          = montoTotal - nuevoAbonado;
    const pagadaCompleta = nuevoAbonado >= montoTotal;

    if (pagadaCompleta) {
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

async function upsertPresupuesto(usuario, categoria, monto, mes) {
  try {
    const rows          = await getRows(SHEETS.PRESUPUESTOS, 'A2:D');
    const existingIndex = rows.findIndex(
      (r) => r[0] === usuario && r[1] === categoria && r[3] === mes,
    );

    if (existingIndex !== -1) {
      await updateRow(SHEETS.PRESUPUESTOS, existingIndex + 2, 'A', [usuario, categoria, monto, mes]);
    } else {
      await appendRow(SHEETS.PRESUPUESTOS, [usuario, categoria, monto, mes]);
    }
  } catch (err) {
    throw new Error(`upsertPresupuesto: ${err.message}`);
  }
}

async function getPresupuestos(usuario, mes) {
  try {
    const rows = await getRows(SHEETS.PRESUPUESTOS, 'A2:D');
    return rows
      .map((r, i) => ({
        rowIndex:  i + 2,
        usuario:   r[0] || '',
        categoria: r[1] || '',
        monto:     parseInt(r[2], 10) || 0,
        mes:       r[3] || '',
      }))
      .filter((p) => p.usuario === usuario && p.mes === mes);
  } catch (err) {
    throw new Error(`getPresupuestos: ${err.message}`);
  }
}

async function getGastadoPorCategoria(usuario, mes) {
  try {
    const fechaInicio = `${mes}-01`;
    const [anio, mesNum] = mes.split('-').map(Number);
    const ultimoDia   = new Date(anio, mesNum, 0).getDate();
    const fechaFin    = `${mes}-${String(ultimoDia).padStart(2, '0')}`;

    const [presupuestos, transacciones] = await Promise.all([
      getPresupuestos(usuario, mes),
      getTransacciones(fechaInicio, fechaFin, usuario),
    ]);

    const egresos    = transacciones.filter((t) => t.tipo === 'egreso');
    const gastadoMap = {};
    for (const t of egresos) {
      gastadoMap[t.categoria] = (gastadoMap[t.categoria] || 0) + t.monto;
    }

    return presupuestos.map((p) => {
      const gastado    = gastadoMap[p.categoria] || 0;
      const porcentaje = p.monto > 0 ? Math.round((gastado / p.monto) * 100) : 0;
      return { categoria: p.categoria, presupuesto: p.monto, gastado, porcentaje, alerta: porcentaje >= 80 };
    });
  } catch (err) {
    throw new Error(`getGastadoPorCategoria: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// OBLIGACIONES
// ---------------------------------------------------------------------------

async function appendObligacion(data) {
  try {
    const { usuario, nombre, tipo, monto, diaPago, estado = 'pendiente', mes } = data;
    await appendRow(SHEETS.OBLIGACIONES, [usuario, nombre, tipo, monto, diaPago, estado, mes]);
  } catch (err) {
    throw new Error(`appendObligacion: ${err.message}`);
  }
}

async function getObligaciones(usuario, mes) {
  try {
    const rows = await getRows(SHEETS.OBLIGACIONES, 'A2:G');
    return rows
      .map((r, i) => ({
        rowIndex: i + 2,
        usuario:  r[0] || '',
        nombre:   r[1] || '',
        tipo:     r[2] || '',
        monto:    parseInt(r[3], 10) || 0,
        diaPago:  parseInt(r[4], 10) || 0,
        estado:   r[5] || 'pendiente',
        mes:      r[6] || '',
      }))
      .filter((o) => o.usuario === usuario && o.mes === mes);
  } catch (err) {
    throw new Error(`getObligaciones: ${err.message}`);
  }
}

async function marcarObligacionPagada(rowIndex) {
  try {
    await updateRow(SHEETS.OBLIGACIONES, rowIndex, 'F', ['pagada']);
  } catch (err) {
    throw new Error(`marcarObligacionPagada: ${err.message}`);
  }
}

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
// AHORROS
// ---------------------------------------------------------------------------

async function upsertAhorro(usuario, nombre, meta, mes) {
  try {
    const rows = await getRows(SHEETS.AHORROS, 'A2:E');
    const idx  = rows.findIndex(
      (r) => r[0] === usuario &&
             (r[1] || '').toLowerCase() === nombre.toLowerCase() &&
             r[4] === mes,
    );
    if (idx !== -1) {
      const acumulado = parseInt(rows[idx][3], 10) || 0;
      await updateRow(SHEETS.AHORROS, idx + 2, 'A', [usuario, nombre, meta, acumulado, mes]);
    } else {
      await appendRow(SHEETS.AHORROS, [usuario, nombre, meta, 0, mes]);
    }
  } catch (err) {
    throw new Error(`upsertAhorro: ${err.message}`);
  }
}

async function getAhorros(usuario, mes) {
  try {
    const rows = await getRows(SHEETS.AHORROS, 'A2:E');
    return rows
      .map((r, i) => {
        const meta      = parseInt(r[2], 10) || 0;
        const acumulado = parseInt(r[3], 10) || 0;
        return {
          rowIndex:   i + 2,
          usuario:    r[0] || '',
          nombre:     r[1] || '',
          meta,
          acumulado,
          mes:        r[4] || '',
          porcentaje: meta > 0 ? Math.min(Math.round((acumulado / meta) * 100), 100) : 0,
        };
      })
      .filter((a) => a.usuario === usuario && a.mes === mes);
  } catch (err) {
    throw new Error(`getAhorros: ${err.message}`);
  }
}

async function depositarAhorro(rowIndex, montoDeposito, meta, acumuladoPrev) {
  try {
    const nuevoAcumulado = acumuladoPrev + montoDeposito;
    const completado     = nuevoAcumulado >= meta;
    await updateRow(SHEETS.AHORROS, rowIndex, 'D', [nuevoAcumulado]);
    return { nuevoAcumulado, completado };
  } catch (err) {
    throw new Error(`depositarAhorro: ${err.message}`);
  }
}

async function appendMovimientoAhorro(data) {
  try {
    const { fecha, usuario, nombre, monto } = data;
    await appendRow(SHEETS.MOVIMIENTOS_AHORRO, [fecha, usuario, nombre, monto]);
  } catch (err) {
    throw new Error(`appendMovimientoAhorro: ${err.message}`);
  }
}

async function getMovimientosAhorro(usuario, nombre) {
  try {
    const rows       = await getRows(SHEETS.MOVIMIENTOS_AHORRO, 'A2:D');
    const nombreNorm = nombre.toLowerCase();
    return rows
      .map((r) => ({
        fecha:   r[0] || '',
        usuario: r[1] || '',
        nombre:  r[2] || '',
        monto:   parseInt(r[3], 10) || 0,
      }))
      .filter((m) => m.usuario === usuario && m.nombre.toLowerCase().includes(nombreNorm));
  } catch (err) {
    throw new Error(`getMovimientosAhorro: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------

module.exports = {
  appendTransaccion,
  getTransacciones,
  appendDeuda,
  getDeudas,
  marcarDeudaPagada,
  registrarAbono,
  upsertPresupuesto,
  getPresupuestos,
  getGastadoPorCategoria,
  appendObligacion,
  getObligaciones,
  marcarObligacionPagada,
  getTotalObligacionesPendientes,
  upsertAhorro,
  getAhorros,
  depositarAhorro,
  appendMovimientoAhorro,
  getMovimientosAhorro,
};
