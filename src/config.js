require('dotenv').config();

const config = {
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',

  alert: {
    endpoint: process.env.ALERT_ENDPOINT || '',
    apiKey: process.env.ALERT_API_KEY || '',
    cooldownMs: parseInt(process.env.ALERT_COOLDOWN_MS, 10) || 30000,
    gunfireCooldownMs: parseInt(process.env.GUNFIRE_COOLDOWN_MS, 10) || 5000,
    // How alerts are delivered to external systems:
    //   api    → POST to the external HTTP endpoint only
    //   socket → send to the external TCP listener only
    //   both   → use both channels (default)
    //   none   → do not forward externally (UI/socket.io events still fire)
    channel: (process.env.ALERT_CHANNEL || 'both').toLowerCase(),
  },

  detection: {
    motionThreshold: parseFloat(process.env.MOTION_THRESHOLD) || 5,
    confidenceThreshold: parseFloat(process.env.CONFIDENCE_THRESHOLD) || 0.6,
    fireConfidenceThreshold: parseFloat(process.env.FIRE_CONFIDENCE_THRESHOLD) || 0.5,
    crowdThreshold: parseInt(process.env.CROWD_THRESHOLD, 10) || 5,
    enableZoneDetection: process.env.ENABLE_ZONE_DETECTION === 'true',
  },

  // Tunable fire-detection thresholds.
  //
  // FIRE_MODE selects a preset profile:
  //   normal → realistic detection for production (default)
  //   demo   → very sensitive, so a lighter / phone fire video triggers it
  //
  // Any individual FIRE_* variable, if set, overrides the chosen profile.
  fire: (() => {
    const profiles = {
      normal: {
        redThreshold: 0.25,
        brightnessThreshold: 0.7,
        flickerSensitivity: 0.05,
        consecutiveFrames: 6,
      },
      demo: {
        redThreshold: 0.01,
        brightnessThreshold: 0.2,
        flickerSensitivity: 0.003,
        consecutiveFrames: 3,
      },
    };

    const mode = (process.env.FIRE_MODE || 'normal').toLowerCase();
    const base = profiles[mode] || profiles.normal;

    const num = (envVal, fallback) => {
      const v = parseFloat(envVal);
      return Number.isNaN(v) ? fallback : v;
    };
    const int = (envVal, fallback) => {
      const v = parseInt(envVal, 10);
      return Number.isNaN(v) ? fallback : v;
    };

    return {
      mode,
      redThreshold: num(process.env.FIRE_RED_THRESHOLD, base.redThreshold),
      brightnessThreshold: num(process.env.FIRE_BRIGHTNESS_THRESHOLD, base.brightnessThreshold),
      flickerSensitivity: num(process.env.FIRE_FLICKER_SENSITIVITY, base.flickerSensitivity),
      consecutiveFrames: int(process.env.FIRE_CONSECUTIVE_FRAMES, base.consecutiveFrames),
    };
  })(),

  camera: {
    id: process.env.CAMERA_ID || 'cam-01',
  },

  // External TCP alert listener. When an alert fires, the detector connects to
  // this host:port and sends the raw command strings (send-alert / send-text).
  tcp: {
    enabled: process.env.TCP_ALERT_ENABLED === 'true',
    host: process.env.TCP_ALERT_HOST || '127.0.0.1',
    port: parseInt(process.env.TCP_ALERT_PORT, 10) || 5555,
  },

  feed: {
    // When enabled, suspicious activity is written to disk for an external
    // process (e.g. a script running in WSL) to consume.
    enabled: process.env.FEED_OUTPUT_ENABLED === 'true',
    // What to capture on each alert:
    //   image → save a snapshot JPEG only
    //   video → stream a live video clip only
    //   both  → save both a snapshot and a video clip
    mode: (process.env.FEED_MODE || 'video').toLowerCase(),
    outputDir: process.env.FEED_OUTPUT_DIR
      ? require('path').resolve(process.env.FEED_OUTPUT_DIR)
      : require('path').join(__dirname, '..', 'captures'),
    // Video capture duration (seconds) when alert is triggered
    videoDurationSec: parseInt(process.env.VIDEO_DURATION_SEC, 10) || 10,
    // Client-side idle timeout (milliseconds) — how long to keep recording after activity stops
    clientVideoIdleMs: parseInt(process.env.CLIENT_VIDEO_IDLE_MS, 10) || 6000,
    // Video output format: webm (browser native) or mp4 (requires ffmpeg)
    videoFormat: (process.env.VIDEO_FORMAT || 'webm').toLowerCase(),
    // Path to ffmpeg executable for MP4 conversion (optional)
    ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
  },
};

module.exports = config;
