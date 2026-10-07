// Cấu hình đọc từ biến môi trường (xem README → "Biến môi trường").
'use strict';

function fromEnv(env = process.env) {
  const num = (k, d) => (env[k] !== undefined && env[k] !== '' && Number.isFinite(+env[k]) ? +env[k] : d);
  const bool = (k) => env[k] === '1' || String(env[k]).toLowerCase() === 'true';
  return {
    port: num('PORT', 3000),
    host: env.HOST || '0.0.0.0',
    trustProxy: bool('TRUST_PROXY'),
    allowedOrigins: String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
    maxRooms: num('MAX_ROOMS', 1000),
    maxConnPerIp: num('MAX_CONN_PER_IP', 40),
    logLevel: env.LOG_LEVEL || 'info',
    openBrowser: bool('OPEN_BROWSER'),
    timeScale: num('TIME_SCALE', 1),
  };
}

module.exports = { fromEnv };
