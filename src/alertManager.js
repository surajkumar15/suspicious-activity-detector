const { v4: uuidv4 } = require('uuid');
const config = require('./config');
const logger = require('./logger');
const alertService = require('./alertService');

const SEVERITY_MAP = {
  GUNFIRE: 'CRITICAL',
  FIRE: 'HIGH',
  FIGHTING_CROWD: 'HIGH',
  INTRUSION: 'MEDIUM',
};

class AlertManager {
  constructor(io) {
    this.io = io;
    this.lastAlertTimes = new Map();
    this.alertHistory = [];
    this.maxHistorySize = 200;
  }

  async processDetection(detectionData) {
    const { alertType, detections, snapshot, confidence, metadata } = detectionData;

    if (!this._checkCooldown(alertType)) {
      logger.debug(`Alert suppressed (cooldown): ${alertType}`);
      return null;
    }

    const severity = SEVERITY_MAP[alertType] || 'LOW';

    const alertPayload = {
      alertId: uuidv4(),
      timestamp: new Date().toISOString(),
      cameraId: config.camera.id,
      alertType,
      severity,
      confidence: confidence || null,
      detections: detections || [],
      metadata: metadata || {},
      snapshot: snapshot || null,
    };

    this.lastAlertTimes.set(alertType, Date.now());

    this._addToHistory(alertPayload);

    this.io.emit('alert', alertPayload);

    logger.info(`ALERT: ${alertType} [${severity}]`, {
      alertId: alertPayload.alertId,
      detectionCount: (detections || []).length,
    });

    const result = await alertService.sendAlert(alertPayload);

    alertPayload.apiResponse = result;
    this.io.emit('alertStatus', {
      alertId: alertPayload.alertId,
      delivered: result.success,
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
}

module.exports = AlertManager;
