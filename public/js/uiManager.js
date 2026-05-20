class UIManager {
  constructor(overlayCanvas) {
    this.canvas = overlayCanvas;
    this.ctx = overlayCanvas.getContext('2d');
    this.zones = [];
    this.showZones = false;
    this.alertCount = 0;

    this.COLORS = {
      person: '#3b82f6',
      knife: '#ef4444',
      scissors: '#ef4444',
      'baseball bat': '#ef4444',
      backpack: '#eab308',
      suitcase: '#eab308',
      handbag: '#eab308',
      default: '#22c55e',
    };

    this.SEVERITY_COLORS = {
      CRITICAL: '#dc2626',
      HIGH: '#ef4444',
      MEDIUM: '#f97316',
      LOW: '#eab308',
    };
  }

  resizeCanvas(video) {
    this.canvas.width = video.videoWidth;
    this.canvas.height = video.videoHeight;
  }

  drawDetections(detections, poses) {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    if (this.showZones) {
      this._drawZones();
    }

    for (const det of detections) {
      this._drawBoundingBox(det);
    }

    if (poses && poses.length > 0) {
      for (const pose of poses) {
        this._drawPose(pose);
      }
    }
  }

  _drawBoundingBox(detection) {
    const [x, y, width, height] = detection.bbox;
    const color = this.COLORS[detection.class] || this.COLORS.default;
    const label = `${detection.class} ${Math.round(detection.score * 100)}%`;

    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(x, y, width, height);

    this.ctx.fillStyle = color;
    const textWidth = this.ctx.measureText(label).width;
    this.ctx.fillRect(x, y - 22, textWidth + 12, 22);

    this.ctx.fillStyle = '#fff';
    this.ctx.font = 'bold 13px Segoe UI, sans-serif';
    this.ctx.fillText(label, x + 6, y - 6);
  }

  _drawPose(pose) {
    if (!pose.keypoints) return;

    const connections = [
      ['nose', 'left_eye'], ['nose', 'right_eye'],
      ['left_eye', 'left_ear'], ['right_eye', 'right_ear'],
      ['left_shoulder', 'right_shoulder'],
      ['left_shoulder', 'left_elbow'], ['right_shoulder', 'right_elbow'],
      ['left_elbow', 'left_wrist'], ['right_elbow', 'right_wrist'],
      ['left_shoulder', 'left_hip'], ['right_shoulder', 'right_hip'],
      ['left_hip', 'right_hip'],
      ['left_hip', 'left_knee'], ['right_hip', 'right_knee'],
      ['left_knee', 'left_ankle'], ['right_knee', 'right_ankle'],
    ];

    const kpMap = {};
    for (const kp of pose.keypoints) {
      if (kp.score > 0.3) kpMap[kp.name] = kp;
    }

    this.ctx.strokeStyle = 'rgba(59, 130, 246, 0.6)';
    this.ctx.lineWidth = 2;
    for (const [a, b] of connections) {
      if (kpMap[a] && kpMap[b]) {
        this.ctx.beginPath();
        this.ctx.moveTo(kpMap[a].x, kpMap[a].y);
        this.ctx.lineTo(kpMap[b].x, kpMap[b].y);
        this.ctx.stroke();
      }
    }

    for (const kp of Object.values(kpMap)) {
      this.ctx.beginPath();
      this.ctx.arc(kp.x, kp.y, 4, 0, 2 * Math.PI);
      this.ctx.fillStyle = '#3b82f6';
      this.ctx.fill();
    }
  }

  _drawZones() {
    for (const zone of this.zones) {
      const polygon = zone.polygon;
      if (!polygon || polygon.length < 3) continue;

      this.ctx.beginPath();
      this.ctx.moveTo(polygon[0][0], polygon[0][1]);
      for (let i = 1; i < polygon.length; i++) {
        this.ctx.lineTo(polygon[i][0], polygon[i][1]);
      }
      this.ctx.closePath();

      this.ctx.fillStyle = (zone.color || '#FF0000') + '20';
      this.ctx.fill();
      this.ctx.strokeStyle = zone.color || '#FF0000';
      this.ctx.lineWidth = 2;
      this.ctx.setLineDash([8, 4]);
      this.ctx.stroke();
      this.ctx.setLineDash([]);

      const cx = polygon.reduce((s, p) => s + p[0], 0) / polygon.length;
      const cy = polygon.reduce((s, p) => s + p[1], 0) / polygon.length;
      this.ctx.fillStyle = '#fff';
      this.ctx.font = 'bold 12px Segoe UI, sans-serif';
      this.ctx.textAlign = 'center';
      this.ctx.fillText(zone.name, cx, cy);
      this.ctx.textAlign = 'left';
    }
  }

  setZones(zones) {
    this.zones = zones;
  }

  toggleZones() {
    this.showZones = !this.showZones;
    return this.showZones;
  }

  updateDetectionList(detections) {
    const container = document.getElementById('activeDetections');
    if (!detections || detections.length === 0) {
      container.innerHTML = '<p class="placeholder-text">No detections</p>';
      return;
    }

    container.innerHTML = detections.map(d => `
      <div class="detection-item">
        <span class="detection-label">${d.class}</span>
        <span class="detection-score">${Math.round(d.score * 100)}%</span>
      </div>
    `).join('');
  }

  addAlert(alert) {
    const container = document.getElementById('alertLog');
    if (container.querySelector('.placeholder-text')) {
      container.innerHTML = '';
    }

    this.alertCount++;
    document.getElementById('alertCount').textContent = this.alertCount;

    const time = new Date(alert.timestamp).toLocaleTimeString();
    const el = document.createElement('div');
    el.className = `alert-item severity-${alert.severity}`;
    el.innerHTML = `
      <div class="alert-type">${alert.alertType.replace(/_/g, ' ')}</div>
      <div class="alert-time">${time} — ${alert.severity}</div>
      <div class="alert-status" id="alert-${alert.alertId}">Sending to API...</div>
    `;

    container.insertBefore(el, container.firstChild);

    if (container.children.length > 50) {
      container.removeChild(container.lastChild);
    }
  }

  updateAlertStatus(alertId, delivered) {
    const el = document.getElementById(`alert-${alertId}`);
    if (el) {
      el.className = delivered ? 'alert-status delivered' : 'alert-status failed';
      el.textContent = delivered ? 'API notified — alarm raised' : 'API call failed';
    }
  }

  clearAlerts() {
    document.getElementById('alertLog').innerHTML = '<p class="placeholder-text">No alerts triggered</p>';
    this.alertCount = 0;
    document.getElementById('alertCount').textContent = '0';
  }

  updateFPS(fps) {
    document.getElementById('fpsCounter').textContent = fps;
  }

  updateObjectCount(count) {
    document.getElementById('objectCount').textContent = count;
  }

  updateStatus(status, type) {
    const badge = document.getElementById('statusBadge');
    badge.textContent = status;
    badge.className = `badge badge-${type}`;
  }

  updateSystemStat(id, text, colorClass) {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = text;
      el.className = colorClass;
    }
  }

  updateTimestamp() {
    const el = document.getElementById('timestamp');
    if (el) {
      el.textContent = new Date().toLocaleTimeString();
    }
  }
}
