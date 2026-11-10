// Función de Vercel: atiende /api/* y /firmas/* (vercel.json reescribe esas rutas a /api/index?ruta=...).
// Los archivos de public/ los sirve directamente la CDN de Vercel.
// Tiempo real por sondeo (/api/version): en serverless las instancias no comparten memoria para SSE.
const { crearApp } = require('../lib/app');

const app = crearApp({ tiempoReal: 'sondeo' });

module.exports = async (req, res) => {
  if (!(await app.handler(req, res))) { res.statusCode = 404; res.end('No encontrado'); }
};
