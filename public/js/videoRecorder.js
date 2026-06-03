/**
 * LiveStreamer — streams a live, continuous video feed to the server while
 * suspicious activity is occurring (no ffmpeg required; the browser's built-in
 * MediaRecorder does the encoding).
 *
 * Flow:
 *   1. notifyActivity() is called whenever an alert fires.
 *   2. If no session is active, a new MediaRecorder session starts. The very
 *      first chunk contains the WebM header, so streaming from the start of the
 *      recorder produces a valid, growing file on the server.
 *   3. Each ~1s chunk is emitted to the server and appended to the file.
 *   4. Recording continues as long as activity keeps arriving. After `idleMs`
 *      with no new activity, the session is finalized.
 */
class LiveStreamer {
  constructor(socket, options = {}) {
    this.socket = socket;
    this.idleMs = options.idleMs || 6000;        // stop after this much quiet
    this.timesliceMs = options.timesliceMs || 1000; // chunk size
    this.maxSessionMs = options.maxSessionMs || 120000; // hard cap per clip

    this.stream = null;
    this.recorder = null;
    this.mimeType = '';
    this.sessionId = null;
    this.idleTimer = null;
    this.maxTimer = null;
  }

  static _pickMimeType() {
    const candidates = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ];
    for (const t of candidates) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(t)) return t;
    }
    return '';
  }

  /** Provide the active camera MediaStream (call when camera starts). */
  setStream(stream) {
    this.stream = stream;
  }

  /** Signal that suspicious activity is happening right now. */
  notifyActivity(alert) {
    console.log(`[notifyActivity] Called with alert: alertId=${alert ? alert.alertId : 'null'}, alertType=${alert ? alert.alertType : 'null'}`);
    if (!this.stream || !window.MediaRecorder) return;

    if (!this.sessionId) {
      this._startSession(alert);
    }
    this._resetIdleTimer();
  }

  _startSession(alert) {
    this.mimeType = LiveStreamer._pickMimeType();
    try {
      this.recorder = this.mimeType
        ? new MediaRecorder(this.stream, { mimeType: this.mimeType })
        : new MediaRecorder(this.stream);
    } catch (err) {
      console.error('LiveStreamer: failed to create MediaRecorder', err);
      return;
    }

    this.sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    console.log(`[VideoRecorder] videoStart emitted: sessionId=${this.sessionId}, alertId=${alert ? alert.alertId : null}`);
    this.socket.emit('videoStart', {
      sessionId: this.sessionId,
      alertId: alert ? alert.alertId : null,
      alertType: alert ? alert.alertType : 'UNKNOWN',
      severity: alert ? alert.severity : null,
      mimeType: this.mimeType || 'video/webm',
    });

    this.recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0 && this.sessionId) {
        // Send the Blob as binary; Socket.IO transfers ArrayBuffers natively.
        e.data.arrayBuffer().then((buf) => {
          if (this.sessionId) {
            this.socket.emit('videoChunk', { sessionId: this.sessionId, data: buf });
          }
        });
      }
    };

    this.recorder.onstop = () => {
      const ended = this.sessionId;
      this.sessionId = null;
      this.recorder = null;
      if (ended) {
        console.log(`[VideoRecorder] videoEnd emitted: sessionId=${ended}`);
        this.socket.emit('videoEnd', { sessionId: ended });
      }
    };

    this.recorder.start(this.timesliceMs);
    console.log(`LiveStreamer: session ${this.sessionId} started`);

    // Hard cap so a session can't grow forever.
    this.maxTimer = setTimeout(() => this._stopSession(), this.maxSessionMs);
  }

  _resetIdleTimer() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this._stopSession(), this.idleMs);
  }

  _stopSession() {
    clearTimeout(this.idleTimer);
    clearTimeout(this.maxTimer);
    if (this.recorder && this.recorder.state !== 'inactive') {
      try { this.recorder.stop(); } catch { /* ignore */ }
    } else if (this.sessionId) {
      const ended = this.sessionId;
      this.sessionId = null;
      this.socket.emit('videoEnd', { sessionId: ended });
    }
  }

  /** Stop everything (call when camera stops / on disconnect). */
  stop() {
    this._stopSession();
    this.stream = null;
  }
}

window.LiveStreamer = LiveStreamer;
