(function () {
  'use strict';

  const video = document.getElementById('videoFeed');
  const overlayCanvas = document.getElementById('overlayCanvas');
  const modelLoadingEl = document.getElementById('modelLoading');
  const loadingDetailEl = document.getElementById('loadingDetail');

  const camera = new CameraManager(video);
  const engine = new DetectionEngine();
  const ui = new UIManager(overlayCanvas);

  const socket = io();

  let liveStreamer = new LiveStreamer(socket, { idleMs: 6000, maxSessionMs: 120000 });

  // Whether the server wants live video streamed on alerts (set via feedConfig).
  let videoStreamingEnabled = false;

  let isDetecting = false;
  let frameCount = 0;
  let lastFpsTime = Date.now();
  let currentLocation = null;

  function initGeolocation() {
    if (!navigator.geolocation) {
      console.warn('Browser does not support geolocation');
      return;
    }

    navigator.geolocation.watchPosition(
      (position) => {
        currentLocation = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        console.log('Geolocation acquired', currentLocation);
      },
      (error) => {
        console.warn('Geolocation error', error);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 10000,
        timeout: 10000,
      }
    );
  }

  // ─── Socket Connection ──────────────────────────────
  socket.on('connect', () => {
    ui.updateSystemStat('serverStatus', 'Connected', 'text-green');
    console.log('Connected to server');
    btnStartStop.disabled = false;
    showDisconnectedOverlay(false);
    socket.emit('getZones');
  });

  socket.on('disconnect', () => {
    ui.updateSystemStat('serverStatus', 'Disconnected', 'text-red');
    stopDetection();
    liveStreamer.stop();
    camera.stop();
    ui.updateStatus('SERVER OFFLINE', 'offline');
    ui.updateFPS(0);
    ui.updateObjectCount(0);
    btnStartStop.textContent = 'Start Camera';
    btnStartStop.disabled = true;
    showDisconnectedOverlay(true);
  });

  socket.on('zones', (zones) => {
    ui.setZones(zones);
  });

  socket.on('feedConfig', (cfg) => {
    videoStreamingEnabled = !!(cfg && cfg.enabled && cfg.recordingEnabled && (cfg.mode === 'video' || cfg.mode === 'both'));
    // Apply server-configured idle timeout to the live streamer
    if (cfg && cfg.clientVideoIdleMs) {
      liveStreamer.idleMs = cfg.clientVideoIdleMs;
      console.log(`Feed config: enabled=${cfg.enabled}, recordingEnabled=${cfg.recordingEnabled}, sendFileEnabled=${cfg.sendFileEnabled}, mode=${cfg.mode}, video streaming=${videoStreamingEnabled}, idleMs=${cfg.clientVideoIdleMs}`);
    } else {
      console.log(`Feed config: enabled=${cfg && cfg.enabled}, recordingEnabled=${cfg && cfg.recordingEnabled}, sendFileEnabled=${cfg && cfg.sendFileEnabled}, mode=${cfg && cfg.mode}, video streaming=${videoStreamingEnabled}`);
    }
  });

  socket.on('alert', (alert) => {
    console.log(`[Alert Received] alertId=${alert.alertId}, alertType=${alert.alertType}, videoStreamingEnabled=${videoStreamingEnabled}`);
    ui.addAlert(alert);
    flashScreen(alert.severity);
    // Stream a live video feed while the activity is ongoing (if enabled).
    if (videoStreamingEnabled) {
      console.log(`[Alert] Calling notifyActivity with alertId=${alert.alertId}`);
      liveStreamer.notifyActivity(alert);
    }
  });

  socket.on('alertStatus', ({ alertId, delivered }) => {
    ui.updateAlertStatus(alertId, delivered);
    ui.updateSystemStat('apiStatus', delivered ? 'Alarm raised' : 'Delivery Failed',
      delivered ? 'text-green' : 'text-red');

    setTimeout(() => {
      ui.updateSystemStat('apiStatus', 'Idle', 'text-gray');
    }, 5000);
  });

  // ─── Model Loading ──────────────────────────────────
  async function initModels() {
    const success = await engine.loadModels((msg) => {
      loadingDetailEl.textContent = msg;
    });

    if (success) {
      ui.updateSystemStat('modelStatus', 'Ready', 'text-green');
    } else {
      ui.updateSystemStat('modelStatus', 'Failed', 'text-red');
    }

    return success;
  }

  // ─── Camera Start/Stop ──────────────────────────────
  const btnStartStop = document.getElementById('btnStartStop');
  btnStartStop.addEventListener('click', async () => {
    if (camera.isRunning) {
      stopDetection();
      liveStreamer.stop();
      camera.stop();
      btnStartStop.textContent = 'Start Camera';
      ui.updateStatus('OFFLINE', 'offline');
    } else {
      btnStartStop.textContent = 'Starting...';
      btnStartStop.disabled = true;

      const result = await camera.start();
      if (result.success) {
        ui.resizeCanvas(video);
        btnStartStop.textContent = 'Stop Camera';
        ui.updateStatus('LIVE', 'live');

        // Give the live streamer access to the camera stream.
        liveStreamer.setStream(camera.stream);

        if (!engine.isReady) {
          const modelsOk = await initModels();
          if (!modelsOk) {
            btnStartStop.textContent = 'Start Camera';
            ui.updateStatus('MODEL ERROR', 'offline');
            btnStartStop.disabled = false;
            return;
          }
        }

        modelLoadingEl.classList.add('hidden');
        startDetection();
      } else {
        alert('Camera access denied or unavailable: ' + result.error);
        btnStartStop.textContent = 'Start Camera';
        ui.updateStatus('NO CAMERA', 'offline');
      }

      btnStartStop.disabled = false;
    }
  });

  // ─── Detection Loop ─────────────────────────────────
  function startDetection() {
    isDetecting = true;
    detectLoop();
  }

  function stopDetection() {
    isDetecting = false;
  }

  async function detectLoop() {
    if (!isDetecting) return;

    try {
      const results = await engine.detect(video);

      if (results) {
        ui.drawDetections(results.objects, results.poses);
        ui.updateDetectionList(results.objects);
        ui.updateObjectCount(results.objects.length);
        ui.updateTimestamp();

        if (results.objects.length > 0 || results.motionDetected) {
          const detectionPayload = {
            objects: results.objects,
            poses: results.poses.map(p => ({
              keypoints: p.keypoints,
              score: p.score,
            })),
            frameAnalysis: results.frameAnalysis,
            motionDetected: results.motionDetected,
            snapshot: results.objects.length > 0 ? camera.captureSnapshot() : null,
          };

          if (currentLocation) {
            detectionPayload.metadata = { location: currentLocation };
          }

          socket.emit('detection', detectionPayload);
        }

        frameCount++;
        const now = Date.now();
        if (now - lastFpsTime >= 1000) {
          ui.updateFPS(frameCount);
          frameCount = 0;
          lastFpsTime = now;
        }
      }
    } catch (error) {
      console.error('Detection loop error:', error);
    }

    requestAnimationFrame(detectLoop);
  }

  // ─── Controls ───────────────────────────────────────
  document.getElementById('btnToggleZones').addEventListener('click', function () {
    const active = ui.toggleZones();
    this.textContent = active ? 'Hide Zones' : 'Show Zones';
    this.classList.toggle('active', active);
  });

  document.getElementById('btnTogglePose').addEventListener('click', function () {
    const active = engine.togglePose();
    this.textContent = `Pose Detection: ${active ? 'ON' : 'OFF'}`;
    this.classList.toggle('active', active);
  });

  document.getElementById('confidenceSlider').addEventListener('input', function () {
    const val = parseFloat(this.value);
    engine.setConfidenceThreshold(val);
    document.getElementById('thresholdValue').textContent = val.toFixed(2);
  });

  document.getElementById('btnClearAlerts').addEventListener('click', () => {
    ui.clearAlerts();
  });

  // ─── Screen Flash for Alerts ────────────────────────
  function flashScreen(severity) {
    const colors = {
      CRITICAL: 'rgba(220, 38, 38, 0.3)',
      HIGH: 'rgba(239, 68, 68, 0.2)',
      MEDIUM: 'rgba(249, 115, 22, 0.15)',
      LOW: 'rgba(234, 179, 8, 0.1)',
    };

    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: ${colors[severity] || colors.LOW};
      pointer-events: none; z-index: 9999;
      animation: fadeOut 1s forwards;
    `;

    const style = document.createElement('style');
    style.textContent = '@keyframes fadeOut { to { opacity: 0; } }';
    document.head.appendChild(style);
    document.body.appendChild(overlay);

    setTimeout(() => {
      overlay.remove();
      style.remove();
    }, 1000);
  }

  // ─── Disconnected Overlay ──────────────────────────
  let disconnectedOverlay = null;

  function showDisconnectedOverlay(show) {
    if (show && !disconnectedOverlay) {
      disconnectedOverlay = document.createElement('div');
      disconnectedOverlay.id = 'disconnectedOverlay';
      disconnectedOverlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0, 0, 0, 0.85); z-index: 10000;
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        color: #fff; font-family: inherit;
      `;
      disconnectedOverlay.innerHTML = `
        <div style="font-size: 48px; margin-bottom: 16px;">&#9888;</div>
        <div style="font-size: 24px; font-weight: bold; margin-bottom: 8px;">Server Offline</div>
        <div style="font-size: 14px; color: #aaa;">Waiting for server to restart...</div>
        <div style="font-size: 12px; color: #666; margin-top: 16px;">The system will reconnect automatically</div>
      `;
      document.body.appendChild(disconnectedOverlay);
    } else if (!show && disconnectedOverlay) {
      disconnectedOverlay.remove();
      disconnectedOverlay = null;
    }
  }

  // ─── Auto-start camera on load ──────────────────────
  window.addEventListener('load', () => {
    ui.updateStatus('READY', 'loading');
    initGeolocation();

    // Auto-start: click the button programmatically
    setTimeout(() => {
      btnStartStop.click();
    }, 500);
  });
})();
