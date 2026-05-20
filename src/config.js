require('dotenv').config();

const config = {
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',

  alert: {
    endpoint: process.env.ALERT_ENDPOINT || '',
    apiKey: process.env.ALERT_API_KEY || '',
    cooldownMs: parseInt(process.env.ALERT_COOLDOWN_MS, 10) || 30000,
    gunfireCooldownMs: parseInt(process.env.GUNFIRE_COOLDOWN_MS, 10) || 5000,
  },

  detection: {
    motionThreshold: parseFloat(process.env.MOTION_THRESHOLD) || 5,
    confidenceThreshold: parseFloat(process.env.CONFIDENCE_THRESHOLD) || 0.6,
    fireConfidenceThreshold: parseFloat(process.env.FIRE_CONFIDENCE_THRESHOLD) || 0.5,
    crowdThreshold: parseInt(process.env.CROWD_THRESHOLD, 10) || 5,
    enableZoneDetection: process.env.ENABLE_ZONE_DETECTION === 'true',
  },

  camera: {
    id: process.env.CAMERA_ID || 'cam-01',
  },
};

module.exports = config;
