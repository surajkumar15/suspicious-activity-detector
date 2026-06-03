const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const logger = require('./logger');
const alertService = require('./alertService');
const FeedWriter = require('./feedWriter');
const TcpAlertClient = require('./tcpAlertClient');

const SEVERITY_MAP = {
  GUNFIRE: 'CRITICAL',
  FIRE: 'HIGH',
  FIGHTING_CROWD: 'HIGH',
  INTRUSION: 'MEDIUM',
};

const ALERT_MESSAGE_MAP = {
  GUNFIRE: 'Gunfire detected. Immediate response required.',
  FIRE: 'Fire detected. Immediate attention required.',
  FIGHTING_CROWD: 'Violence or crowd disturbance detected. Security intervention recommended.',
  INTRUSION: 'Unauthorized intrusion detected in a restricted area.',
};

class AlertManager {
  constructor(io) {
    this.io = io;
    this.lastAlertTimes = new Map();
    this.alertHistory = [];
    this.maxHistorySize = 200;
    this.feedWriter = new FeedWriter();
    this.tcpClient = new TcpAlertClient();
    this.textOutputDir = config.textOutputDir;
    this.locationLogPath = path.join(this.textOutputDir, 'alert-locations.txt');
    this.messageLogPath = path.join(this.textOutputDir, 'alert-message.txt');
    fs.mkdirSync(this.textOutputDir, { recursive: true });
  }

  async processDetection(detectionData) {
    const { alertType, detections, snapshot, confidence, metadata } = detectionData;

    if (!this._checkCooldown(alertType)) {
      logger.debug(`Alert suppressed (cooldown): ${alertType}`);
      return null;
    }

    const severity = SEVERITY_MAP[alertType] || 'LOW';
    const metadataWithLocation = metadata || {};

    const alertPayload = {
      alertId: uuidv4(),
      timestamp: new Date().toISOString(),
      cameraId: config.camera.id,
      alertType,
      severity,
      confidence: confidence || null,
      detections: detections || [],
      metadata: metadataWithLocation,
      snapshot: snapshot || null,
    };

    this.lastAlertTimes.set(alertType, Date.now());

    this._addToHistory(alertPayload);

    logger.info(`[AlertEmit] Emitting alert to client: alertId=${alertPayload.alertId}, alertType=${alertPayload.alertType}`);
    this.io.emit('alert', alertPayload);

    // Persist the suspicious frame to disk for any external watcher process.
    this.feedWriter.write(alertPayload).catch((err) => {
      logger.error('Feed writer error', { error: err.message });
    });

    // Forward the alert to external systems based on the configured channel.
    const channel = config.alert.channel;
    const useApi = channel === 'api' || channel === 'both';
    const useSocket = channel === 'socket' || channel === 'both';

    if (useSocket) {
      // 1. Send the basic alert command immediately to the external TCP listener.
      try {
        this.tcpClient.sendAlert();
        logger.info(`TCP alert forwarded immediately for alertId=${alertPayload.alertId}`);
      } catch (err) {
        logger.warn('Failed to forward TCP alert immediately', { error: err.message });
      }

      // 2. Write message text, send send-text, wait 1 second, then
      //    write location and send send-location.
      (async () => {
        await this._writeAlertText(alertPayload);
        this.tcpClient.sendText();
        await this._delay(1000);
        await this._writeAlertLocation(alertPayload);
        this.tcpClient.sendLocation();
      })().catch((err) => {
        logger.error('Failed in send-text/send-location sequence', { error: err.message });
      });

      // 4. The 'send-file' command is sent later, when the video file is
      //    finalized by the feed writer (see sendFileViaSocket / videoEnd).
    }

    const deliveryMethod = useApi && useSocket
      ? 'api+socket'
      : useApi ? 'api' : useSocket ? 'socket' : 'none';

    logger.info(`ALERT: ${alertType} [${severity}]`, {
      alertId: alertPayload.alertId,
      detectionCount: (detections || []).length,
      deliveryMethod,
    });

    let result = { success: false, skipped: true };
    if (useApi) {
      result = await alertService.sendAlert(alertPayload);
    }

    alertPayload.apiResponse = result;

    let delivered;
    if (channel === 'none') {
      delivered = true;
    } else if (useApi && useSocket) {
      delivered = result.success;
    } else if (useApi) {
      delivered = result.success;
    } else {
      delivered = true;
    }

    this.io.emit('alertStatus', {
      alertId: alertPayload.alertId,
      delivered,
    });

    return alertPayload;
  }

  _checkCooldown(alertType) {
    const lastTime = this.lastAlertTimes.get(alertType);
    if (!lastTime) return true;

    const cooldown = alertType === 'GUNFIRE'
      ? config.alert.gunfireCooldownMs
      : config.alert.cooldownMs;

    return (Date.now() - lastTime) >= cooldown;
  }

  _addToHistory(alert) {
    this.alertHistory.unshift(alert);
    if (this.alertHistory.length > this.maxHistorySize) {
      this.alertHistory.pop();
    }
  }

  getHistory() {
    return this.alertHistory;
  }

  getStats() {
    const counts = {};
    for (const alert of this.alertHistory) {
      counts[alert.alertType] = (counts[alert.alertType] || 0) + 1;
    }
    return { totalAlerts: this.alertHistory.length, byType: counts };
  }

  _getAlertLocation(alertPayload) {
    const location = alertPayload.metadata && alertPayload.metadata.location;
    if (location) {
      if (typeof location === 'object' && location.latitude != null && location.longitude != null) {
        return `${location.latitude},${location.longitude}`;
      }
      return String(location);
    }

    if (alertPayload.metadata && alertPayload.metadata.zoneName) {
      return `Zone: ${alertPayload.metadata.zoneName}`;
    }

    if (alertPayload.metadata && alertPayload.metadata.zoneId) {
      return `Zone ID: ${alertPayload.metadata.zoneId}`;
    }

    if (alertPayload.cameraId) {
      return `Camera: ${alertPayload.cameraId}`;
    }

    return 'unknown';
  }

  async _writeAlertLocation(alertPayload) {
    const location = this._getAlertLocation(alertPayload);
    await fs.promises.writeFile(this.locationLogPath, `${location}\n`, 'utf8');
  }

  async _writeAlertText(alertPayload) {
    const message = ALERT_MESSAGE_MAP[alertPayload.alertType]
      || `Suspicious activity detected: ${alertPayload.alertType}`;
    const line = `${message}\n`;
    await fs.promises.writeFile(this.messageLogPath, line, 'utf8');
  }

  _delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  sendAlertViaSocket(alertId) {
    logger.info(`[AlertManager] sendAlertViaSocket called for alertId: ${alertId}, tcpClient.connected: ${this.tcpClient.connected}, tcpClient.enabled: ${this.tcpClient.enabled}`);
    this.tcpClient.sendAlert();
    logger.info(`[AlertManager] TCP alert triggered for alertId: ${alertId}`);
  }

  sendFileViaSocket(alertId, filePath) {
    logger.info(`[AlertManager] sendFileViaSocket called for alertId: ${alertId}, file=${filePath}`);
    try {
      this.tcpClient.sendFile(filePath);
      logger.info(`[AlertManager] send-file command sent for alertId: ${alertId}`);
    } catch (err) {
      logger.error('[AlertManager] Failed to send-file via TCP', { error: err.message, alertId, filePath });
    }
  }
}

module.exports = AlertManager;
