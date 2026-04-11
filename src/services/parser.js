'use strict';

// ---------------------------------------------------------------------------
// Categorías
// ---------------------------------------------------------------------------

const CATEGORIAS = [
  { nombre: 'Comida',     alias: ['comida']     },
  { nombre: 'Transporte', alias: ['transporte'] },
  { nombre: 'Servicios',  alias: ['servicios']  },
  { nombre: 'Salud',      alias: ['salud']      },
  { nombre: 'Ocio',       alias: ['ocio']       },
  { nombre: 'Personal',   alias: ['personal']   },
  { nombre: 'Trabajo',    alias: ['trabajo']    },
  { nombre: 'Otros',      alias: ['otros']      },
];

const NOMBRES_CATEGORIA = CATEGORIAS.map((c) => c.nombre);

const TIPOS_OBLIGACION = ['arriendo', 'tarjeta', 'credito', 'servicio', 'otro'];

const MESES_ES = {
  enero: '01', febrero: '02', marzo: '03', abril: '04',
  mayo: '05', junio: '06', julio: '07', agosto: '08',
  septiembre: '09', octubre: '10', noviembre: '11', diciembre: '12',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizar(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[¿?¡!]/g, '')
    .trim();
}

function hoy() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
}

function mesActual() {
  return hoy().slice(0, 7);
}

function extraerMonto(text) {
  const match = String(text).replace(/[.,](?=\d{3})/g, '').match(/\d+/);
  return match ? parseInt(match[0], 10) : null;
}

/**
 * Similitud simple: porcentaje de caracteres de `a` presentes en `b`.
 * Útil para detectar typos como "trasnporte" → "transporte".
 */
function similitud(a, b) {
  if (a === b) return 1;
  const longer  = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  let matches = 0;
  for (const ch of shorter) {
    if (longer.includes(ch)) matches++;
  }
  return matches / longer.length;
}

/**
 * Resuelve la categoría a partir del texto ingresado.
 * 1. Busca coincidencia exacta (normalizada).
 * 2. Si no, busca la categoría con mayor similitud (umbral ≥ 0.75).
 * 3. Si no alcanza el umbral, retorna 'Otros'.
 */
function resolverCategoria(texto) {
  const t = normalizar(texto || '');
  // Coincidencia exacta
  for (const cat of CATEGORIAS) {
    if (normalizar(cat.nombre) === t) return cat.nombre;
    if (cat.alias.some((a) => normalizar(a) === t)) return cat.nombre;
  }
  // Coincidencia por similitud (tolera typos)
  let mejorCat   = null;
  let mejorScore = 0;
  for (const cat of CATEGORIAS) {
    const score = similitud(t, normalizar(cat.nombre));
    if (score > mejorScore) { mejorScore = score; mejorCat = cat.nombre; }
  }
  return mejorScore >= 0.75 ? mejorCat : 'Otros';
}

function inferirTipoObligacion(texto) {
  const t = normalizar(texto);
  if (t.includes('arriendo'))              return 'arriendo';
  if (t.includes('tarjeta'))               return 'tarjeta';
  if (t.includes('credito'))               return 'credito';
  if (t.includes('servicio'))              return 'servicio';
  return 'otro';
}

function parsearMes(fragmento) {
  if (!fragmento) return null;
  const f = normalizar(fragmento);
  const isoMatch = f.match(/^(\d{4}-\d{2})/);
  if (isoMatch) return isoMatch[1];
  for (const [nombre, num] of Object.entries(MESES_ES)) {
    if (f.includes(nombre)) return `${new Date().getFullYear()}-${num}`;
  }
  return null;
}

function resultado(tipo, extra = {}) {
  return {
    tipo,
    monto:          null,
    categoria:      null,
    descripcion:    '',
    subtipo:        null,
    persona:        null,
    diaPago:        null,
    tipoObligacion: null,
    mes:            null,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Parsers por palabra clave
// ---------------------------------------------------------------------------

// INGRESO: recibi [monto] [en|de|para]? [categoria] [descripcion]
function tryIngreso(norm) {
  const m = norm.match(/^recibi\s+(\d[\d.,]*)\s+(?:en\s+|de\s+|para\s+)?(\S+)(?:\s+(.+))?$/);
  if (!m) return null;
  const categoria = resolverCategoria(m[2]);
  return resultado('ingreso', {
    monto:       extraerMonto(m[1]),
    categoria,
    descripcion: m[3] ? m[3].trim() : categoria,
  });
}

// EGRESO: gaste [monto] [en|de|para]? [categoria] [descripcion]
function tryEgreso(norm) {
  const m = norm.match(/^gaste\s+(\d[\d.,]*)\s+(?:en\s+|de\s+|para\s+)?(\S+)(?:\s+(.+))?$/);
  if (!m) return null;
  const categoria = resolverCategoria(m[2]);
  return resultado('egreso', {
    monto:       extraerMonto(m[1]),
    categoria,
    descripcion: m[3] ? m[3].trim() : categoria,
  });
}

// DEUDA ME DEBEN: "medeben" o "me deben" [persona] [monto] [descripcion]
function tryMeDeben(norm, original) {
  const m = norm.match(/^me\s*deben\s+(\S+)\s+(\d[\d.,]*)(?:\s+(.+))?$/);
  if (!m) return null;
  const persona = extraerPersonaOriginal(original, m[1]);
  return resultado('deuda', {
    monto:       extraerMonto(m[2]),
    subtipo:     'me_deben',
    persona,
    descripcion: m[3] ? m[3].trim() : `${persona} me debe`,
    categoria:   'Otros',
  });
}

// DEUDA DEBO: "ledebo" o "le debo" [persona] [monto] [descripcion]
function tryLeDebo(norm, original) {
  const m = norm.match(/^le\s*debo\s+(\S+)\s+(\d[\d.,]*)(?:\s+(.+))?$/);
  if (!m) return null;
  const persona = extraerPersonaOriginal(original, m[1]);
  return resultado('deuda', {
    monto:       extraerMonto(m[2]),
    subtipo:     'debo',
    persona,
    descripcion: m[3] ? m[3].trim() : `Le debo a ${persona}`,
    categoria:   'Otros',
  });
}

// DEUDA PAGADA: "mepagaron" o "me pagaron" [persona] [monto?]
function tryMePago(norm, original) {
  const m = norm.match(/^me\s*pagaron\s+(\S+)(?:\s+(\d[\d.,]*))?.*$/);
  if (!m) return null;
  const persona = extraerPersonaOriginal(original, m[1]);
  return resultado('deuda', {
    monto:       m[2] ? extraerMonto(m[2]) : null,
    subtipo:     'pagada',
    persona,
    descripcion: `${persona} pagó la deuda`,
    categoria:   'Otros',
  });
}

// ABONO: abono [persona] [monto]
function tryAbono(norm, original) {
  const m = norm.match(/^abono\s+(\S+)\s+(\d[\d.,]*).*$/);
  if (!m) return null;
  const persona = extraerPersonaOriginal(original, m[1]);
  return resultado('deuda', {
    monto:       extraerMonto(m[2]),
    subtipo:     'abono',
    persona,
    descripcion: `Abono de ${persona}`,
    categoria:   'Otros',
  });
}

// OBLIGACIÓN REGISTRAR: obligacion [nombre...] [monto] dia [N] [mes?]
function tryObligacionRegistrar(norm, original) {
  const m = norm.match(/^obligacion\s+(.+?)\s+(\d[\d.,]*)\s+dia\s+(\d{1,2})(?:\s+(.+))?$/);
  if (!m) return null;
  const nombre  = extraerPersonaOriginal(original, m[1].trim());
  const mesRaw  = m[4] ? parsearMes(m[4]) : null;
  return resultado('obligacion', {
    monto:          extraerMonto(m[2]),
    subtipo:        'registrar',
    tipoObligacion: inferirTipoObligacion(m[1]),
    descripcion:    nombre,
    diaPago:        parseInt(m[3], 10),
    mes:            mesRaw || mesActual(),
    categoria:      'Servicios',
  });
}

// OBLIGACIÓN PAGAR: pague [nombre...]
function tryObligacionPagar(norm, original) {
  const m = norm.match(/^pague\s+(.+)$/);
  if (!m) return null;
  const nombre = extraerPersonaOriginal(original, m[1].trim());
  return resultado('obligacion', {
    monto:          null,
    subtipo:        'pagar',
    tipoObligacion: inferirTipoObligacion(m[1]),
    descripcion:    nombre,
    mes:            mesActual(),
    categoria:      'Servicios',
  });
}

// PRESUPUESTO: presupuesto [categoria] [monto] [mes?]
function tryPresupuesto(norm) {
  const m = norm.match(/^presupuesto\s+(\S+)\s+(\d[\d.,]*)(?:\s+(.+))?$/);
  if (!m) return null;
  const categoria = resolverCategoria(m[1]);
  const mesRaw    = m[3] ? parsearMes(m[3]) : null;
  return resultado('presupuesto', {
    monto:       extraerMonto(m[2]),
    categoria,
    subtipo:     'definir',
    descripcion: `Presupuesto ${categoria}`,
    mes:         mesRaw || mesActual(),
  });
}

// CONSULTAS
function tryConsulta(norm) {
  const consultas = [
    { patron: /^hoy$/,                                                subtipo: 'hoy'          },
    { patron: /resumen\s+semanal|cuanto\s+he\s+gastado\s+esta\s+semana/, subtipo: 'semanal'   },
    { patron: /resumen\s+del?\s+mes|balance\s+del?\s+mes/,            subtipo: 'mensual'      },
    { patron: /disponible\s+este\s+mes/,                              subtipo: 'disponible'   },
    { patron: /mis\s+deudas|ver\s+deudas/,                            subtipo: 'deudas'       },
    { patron: /obligaciones\s+pendientes|mis\s+obligaciones/,         subtipo: 'obligaciones' },
    { patron: /como\s+voy\s+con\s+el\s+presupuesto|mis\s+presupuestos/, subtipo: 'presupuestos' },
  ];
  for (const { patron, subtipo } of consultas) {
    if (patron.test(norm)) {
      return resultado('consulta', { subtipo, descripcion: norm });
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

function extraerPersonaOriginal(original, personaNorm) {
  const regex = new RegExp(personaNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const match = original.match(regex);
  return match ? match[0].trim() : personaNorm;
}

// ---------------------------------------------------------------------------
// Función principal
// ---------------------------------------------------------------------------

/**
 * Parsea un mensaje en lenguaje estructurado.
 * Estructura: palabra_clave + monto/persona + categoría + descripción
 *
 * Palabras clave:
 *   recibi   [monto] [categoria] [descripcion]
 *   gaste    [monto] [categoria] [descripcion]
 *   medeben  [persona] [monto] [descripcion]
 *   ledebo   [persona] [monto] [descripcion]
 *   mepagaron [persona] [monto?]
 *   abono    [persona] [monto]
 *   obligacion [nombre] [monto] dia [N]
 *   pague    [nombre]
 *   presupuesto [categoria] [monto] [mes?]
 *
 * @param {string} text
 * @param {string} username
 */
function parseMessage(text, username) {
  const norm  = normalizar(text);
  const fecha = hoy();
  const base  = { usuario: username, fecha };

  const parsed =
    tryConsulta(norm) ||
    tryObligacionRegistrar(norm, text) ||
    tryObligacionPagar(norm, text) ||
    tryPresupuesto(norm) ||
    tryMeDeben(norm, text) ||
    tryLeDebo(norm, text) ||
    tryMePago(norm, text) ||
    tryAbono(norm, text) ||
    tryIngreso(norm) ||
    tryEgreso(norm) ||
    resultado('desconocido', { descripcion: text });

  return { ...parsed, ...base };
}

module.exports = { parseMessage, NOMBRES_CATEGORIA };
