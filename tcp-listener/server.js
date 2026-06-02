#!/usr/bin/env node
/**
 * Standalone TCP alert listener.
 *
 * Listens on TCP port 5555 (configurable via PORT/HOST env vars). When the
 * suspicious-activity-detector triggers an alert, it connects and sends raw,
 * newline-delimited command strings:
 *
 *   send-alert
 *   send-text
 *
 * This server simply logs every received message to the console.
 *
 * Run:  node server.js   (or: npm start)
 */
const net = require('net');

const PORT = parseInt(process.env.PORT, 10) || 5555;
const HOST = process.env.HOST || '0.0.0.0';

const server = net.createServer((socket) => {
  const peer = `${socket.remoteAddress}:${socket.remotePort}`;
  console.log(`[listener] client connected: ${peer}`);

  let buffer = '';

  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');

    // Messages are newline-delimited; process each complete line.
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line.length > 0) {
        console.log(`[listener] received from ${peer}: "${line}"`);
      }
    }
  });

  socket.on('close', () => {
    console.log(`[listener] client disconnected: ${peer}`);
  });

  socket.on('error', (err) => {
    console.error(`[listener] socket error (${peer}): ${err.message}`);
  });
});

server.on('error', (err) => {
  console.error(`[listener] server error: ${err.message}`);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`[listener] TCP alert listener running on ${HOST}:${PORT}`);
  console.log('[listener] waiting for alert messages (send-alert / send-text)...');
});

function shutdown(signal) {
  console.log(`\n[listener] ${signal} received, shutting down`);
  server.close(() => process.exit(0));
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
