const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const logger = require('./logger');
const AlertManager = require('./alertManager');
const IntrusionAnalyzer = require('./analyzers/intrusionAnalyzer');
const BehaviorAnalyzer = require('./analyzers/behaviorAnalyzer');
const FireAnalyzer = require('./analyzers/fireAnalyzer');
const GunfireAnalyzer = require('./analyzers/gunfireAnalyzer');

// ─── Express + Socket.IO Setup ────────────────────────
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 5e6,
});

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// ─── Load Zones ───────────────────────────────────────
let zones = [];
try {
  const zonesPath = path.join(__dirname, '..', 'zones', 'zones.json');
  const zonesData = JSON.parse(fs.readFileSync(zonesPath, 'utf8'));
  zones = zonesData.zones || [];
  logger.info(`Loaded ${zones.length} intrusion zones`);
} catch (err) {
  logger.warn('No zones config found, intrusion detection disabled');
}

// ─── Initialize Analyzers ─────────────────────────────
const alertManager = new AlertManager(io);
const intrusionAnalyzer = new IntrusionAnalyzer(zones);
const behaviorAnalyzer = new BehaviorAnalyzer();
const fireAnalyzer = new FireAnalyzer();
const gunfireAnalyzer = new GunfireAnalyzer();

// ─── REST API Endpoints ───────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    alertEndpoint: config.alert.endpoint ? 'configured' : 'NOT SET',
    zones: zones.length,
  });
});

app.get('/api/alerts', (req, res) => {
  res.json(alertManager.getHistory());
});

app.get('/api/stats', (req, res) => {
  res.json(alertManager.getStats());
});

app.get('/api/zones', (req, res) => {
  res.json(zones);
});

app.put('/api/zones', (req, res) => {
  try {
    zones = req.body.zones || [];
    intrusionAnalyzer.setZones(zones);

    const zonesPath = path.join(__dirname, '..', 'zones', 'zones.json');
    fs.writeFileSync(zonesPath, JSON.stringify({ zones }, null, 2));

    io.emit('zones', zones);
    res.json({ success: true, count: zones.length });
  } catch (err) {
    logger.error('Failed to update zones', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ─── Socket.IO — Real-time Detection Pipeline ────────
io.on('connection', (socket) => {
  logger.info(`Client connected: ${socket.id}`);

  // Tell the client what to capture so it only streams video when needed.
  socket.emit('feedConfig', {
    enabled: config.feed.enabled,
    mode: config.feed.mode,
    videoDurationSec: config.feed.videoDurationSec,
    clientVideoIdleMs: config.feed.clientVideoIdleMs,
  });

  socket.on('getZones', () => {
    socket.emit('zones', zones);
  });

  socket.on('detection', async (data) => {
    try {
      const { objects, poses, frameAnalysis, motionDetected, snapshot, metadata } = data;
      const allAlerts = [];

      // 1. Fire detection — red/orange color + flicker
      if (frameAnalysis) {
        const fireAlerts = fireAnalyzer.analyze(frameAnalysis);
        allAlerts.push(...fireAlerts);
      }

      // 2. Fighting + Crowd detection (combined)
      const behaviorAlerts = behaviorAnalyzer.analyze(objects, poses);
      allAlerts.push(...behaviorAlerts);

      // 3. Intrusion — person in restricted zone
      if (config.detection.enableZoneDetection && objects.length > 0) {
        const intrusionAlerts = intrusionAnalyzer.analyze(objects);
        allAlerts.push(...intrusionAlerts);
      }

      // 4. Gunfire — muzzle flash + audio impulse
      if (frameAnalysis) {
        const gunfireAlerts = gunfireAnalyzer.analyze(frameAnalysis, data.audioAnalysis || null);
        allAlerts.push(...gunfireAlerts);
      }

      // Process each alert → send to external API
      for (const alert of allAlerts) {
        alert.snapshot = snapshot;
        alert.metadata = {
          ...(metadata || {}),
          ...(alert.metadata || {}),
        };
        await alertManager.processDetection(alert);
      }
    } catch (error) {
      logger.error('Detection processing error', { error: error.message, stack: error.stack });
    }
  });

  // ─── Live Video Streaming ──────────────────────────
  // When the client detects suspicious activity it opens a video session and
  // streams encoded chunks here, which are appended to a growing file on disk.
  const feedWriter = alertManager.feedWriter;
  const clientSessions = new Set();
  const sessionAlertMap = new Map();

  socket.on('videoStart', (info) => {
    if (!info || !info.sessionId) return;
    logger.info(`[VideoStart] Received: sessionId=${info.sessionId}, alertId=${info.alertId}, alertType=${info.alertType}`);
    const p = feedWriter.startStream(info);
    if (p) clientSessions.add(info.sessionId);
    if (info.alertId) {
      logger.info(`[VideoStart] Storing alertId mapping: sessionId=${info.sessionId} -> alertId=${info.alertId}`);
      sessionAlertMap.set(info.sessionId, info.alertId);
    } else {
      logger.warn(`[VideoStart] No alertId in videoStart payload for sessionId=${info.sessionId}`);
    }
  });

  socket.on('videoChunk', (payload) => {
    if (!payload || !payload.sessionId) return;
    feedWriter.appendChunk(payload.sessionId, payload.data);
  });

  socket.on('videoEnd', async (payload) => {
    if (!payload || !payload.sessionId) return;
    const alertId = sessionAlertMap.get(payload.sessionId);
    logger.info(`[VideoEnd] sessionId: ${payload.sessionId}, alertId: ${alertId}`);
    clientSessions.delete(payload.sessionId);
    sessionAlertMap.delete(payload.sessionId);
    const videoPath = await feedWriter.endStream(payload.sessionId);

    // Send a 'send-file' command via TCP now that the video file is finalized.
    if (alertId) {
      logger.info(`[VideoEnd] Triggering send-file for alertId: ${alertId}, file=${videoPath}`);
      if (videoPath) {
        alertManager.sendFileViaSocket(alertId, videoPath);
      } else {
        logger.warn(`[VideoEnd] No videoPath returned for sessionId: ${payload.sessionId}`);
      }
    } else {
      logger.warn(`[VideoEnd] No alertId found for sessionId: ${payload.sessionId}`);
    }
  });

  socket.on('disconnect', () => {
    logger.info(`Client disconnected: ${socket.id}`);
    // Finalize any video sessions left open by this client.
    for (const sessionId of clientSessions) {
      feedWriter.endStream(sessionId).catch(() => {});
    }
    clientSessions.clear();
  });
});

// ─── Graceful Shutdown ────────────────────────────────
function shutdown(signal) {
  logger.info(`${signal} received. Shutting down gracefully...`);
  io.close();
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });

  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ─── Start Server ─────────────────────────────────────
const PORT = config.port;
server.listen(PORT, () => {
  logger.info('='.repeat(55));
  logger.info('  Suspicious Activity Detector — Server Started');
  logger.info(`  URL:            http://localhost:${PORT}`);
  logger.info(`  Environment:    ${config.nodeEnv}`);
  logger.info(`  Alert Endpoint: ${config.alert.endpoint || 'NOT CONFIGURED'}`);
  logger.info(`  Zones Loaded:   ${zones.length}`);
  logger.info('='.repeat(55));
  logger.info('Open the URL above in your browser to start the camera.');
});

module.exports = { app, server };
