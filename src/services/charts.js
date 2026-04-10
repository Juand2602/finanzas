'use strict';

const QUICKCHART_BASE = 'https://quickchart.io/chart';

// Paleta de colores para barras/segmentos individuales
const COLORES = [
  'rgba(255, 99, 132, 0.85)',
  'rgba(54, 162, 235, 0.85)',
  'rgba(255, 206, 86, 0.85)',
  'rgba(75, 192, 192, 0.85)',
  'rgba(153, 102, 255, 0.85)',
  'rgba(255, 159, 64, 0.85)',
  'rgba(199, 199, 199, 0.85)',
  'rgba(83, 102, 255, 0.85)',
  'rgba(255, 99, 255, 0.85)',
  'rgba(100, 200, 100, 0.85)',
];

function colorPorIndice(i) {
  return COLORES[i % COLORES.length];
}

/**
 * Serializa la configuración de Chart.js y la convierte en URL de QuickChart.
 * width, height, bkg y f son parámetros separados de la URL, no van dentro de c=.
 */
function buildUrl(config, width = 500, height = 300) {
  const params = new URLSearchParams({
    c:   JSON.stringify(config),
    w:   width,
    h:   height,
    bkg: 'white',
    f:   'png',
  });
  return `${QUICKCHART_BASE}?${params.toString()}`;
}

// ---------------------------------------------------------------------------

/**
 * Genera una URL de QuickChart con barras horizontales, un color por barra.
 * @param {string[]} categorias
 * @param {number[]} montos
 * @param {string}   titulo
 * @returns {string} URL
 */
function generarGraficoBarras(categorias, montos, titulo) {
  const colores = categorias.map((_, i) => colorPorIndice(i));

  const config = {
    type: 'horizontalBar',
    data: {
      labels: categorias,
      datasets: [
        {
          label: titulo,
          data: montos,
          backgroundColor: colores,
          borderColor: colores.map((c) => c.replace('0.85', '1')),
          borderWidth: 1,
        },
      ],
    },
    options: {
      legend: { display: false },
      title: { display: true, text: titulo, fontSize: 14 },
      scales: {
        xAxes: [{ ticks: { beginAtZero: true } }],
      },
    },
  };

  return buildUrl(config, 520, Math.max(200, categorias.length * 40 + 80));
}

/**
 * Genera una URL de QuickChart con gráfico doughnut.
 * @param {string[]} categorias
 * @param {number[]} montos
 * @param {string}   titulo
 * @returns {string} URL
 */
function generarGraficoPastel(categorias, montos, titulo) {
  const colores = categorias.map((_, i) => colorPorIndice(i));

  const config = {
    type: 'doughnut',
    data: {
      labels: categorias,
      datasets: [
        {
          data: montos,
          backgroundColor: colores,
          borderColor: '#ffffff',
          borderWidth: 2,
        },
      ],
    },
    options: {
      title: { display: true, text: titulo, fontSize: 14 },
      legend: { position: 'right' },
      cutoutPercentage: 55,
    },
  };

  return buildUrl(config, 520, 320);
}

/**
 * Genera una URL de QuickChart con barras agrupadas gastado vs límite.
 * Color de la barra "Gastado" según porcentaje:
 *   < 60%  → verde
 *   60-80% → amarillo
 *   >= 80% → rojo
 * @param {string[]} categorias
 * @param {number[]} gastado   Monto gastado por categoría
 * @param {number[]} limites   Límite presupuestado por categoría
 * @param {string}   titulo
 * @returns {string} URL
 */
function generarGraficoPresupuesto(categorias, gastado, limites, titulo) {
  const coloresGastado = gastado.map((g, i) => {
    const limite = limites[i];
    if (!limite) return 'rgba(199, 199, 199, 0.85)';
    const pct = g / limite;
    if (pct >= 0.8) return 'rgba(255, 99, 132, 0.85)';   // rojo
    if (pct >= 0.6) return 'rgba(255, 206, 86, 0.85)';   // amarillo
    return 'rgba(75, 192, 100, 0.85)';                    // verde
  });

  const config = {
    type: 'bar',
    data: {
      labels: categorias,
      datasets: [
        {
          label: 'Gastado',
          data: gastado,
          backgroundColor: coloresGastado,
          borderColor: coloresGastado.map((c) => c.replace('0.85', '1')),
          borderWidth: 1,
        },
        {
          label: 'Límite',
          data: limites,
          backgroundColor: 'rgba(180, 180, 180, 0.4)',
          borderColor: 'rgba(180, 180, 180, 0.9)',
          borderWidth: 1,
        },
      ],
    },
    options: {
      title: { display: true, text: titulo, fontSize: 14 },
      legend: { position: 'top' },
      scales: {
        yAxes: [{ ticks: { beginAtZero: true } }],
      },
    },
  };

  return buildUrl(config, 540, Math.max(260, categorias.length * 50 + 100));
}

module.exports = {
  generarGraficoBarras,
  generarGraficoPastel,
  generarGraficoPresupuesto,
};
