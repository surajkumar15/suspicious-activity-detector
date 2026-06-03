const fs = require('fs');
const path = require('path');
const config = require('./config');
const logger = require('./logger');

/**
 * Writes snapshots of suspicious frames to a watched directory so an external
 * process (e.g. a script running in WSL) can pick them up.
 *
 * Files are written atomically: data is first written to a `.tmp` file and then
 * renamed into place. Because rename() is atomic on the same filesystem, a
 * watcher that reacts to file-create events will never observe a partial file.
 *
 * For each suspicious frame two files are produced:
 *   <name>.jpg   — the captured frame
 *   <name>.json  — alert metadata (alertId, type, severity, timestamp, ...)
 */
class FeedWriter {
  constructor() {
    this.enabled = config.feed.enabled;
    this.outputDir = config.feed.outputDir;
    this.mode = config.feed.mode;
    this.videoDurationSec = config.feed.videoDurationSec;
    this.videoFormat = config.feed.videoFormat;
    this.ffmpegPath = config.feed.ffmpegPath;
    this.imageEnabled = this.mode === 'image' || this.mode === 'both';
    this.videoEnabled = this.mode === 'video' || this.mode === 'both';

    // FEED_MODE=off (or none) disables all capture even if FEED_OUTPUT_ENABLED is true.
    if (this.mode === 'off' || this.mode === 'none') {
      this.enabled = false;
    }

    if (!this.enabled) {
      logger.info(`Feed writer disabled (FEED_OUTPUT_ENABLED=false or FEED_MODE=${this.mode})`);
      return;
    }

    try {
      fs.mkdirSync(this.outputDir, { recursive: true });
      logger.info(`Feed writer enabled [mode=${this.mode}] → ${this.outputDir}`);
    } catch (err) {
      this.enabled = false;
      logger.error('Failed to create feed output dir, disabling feed writer', {
        dir: this.outputDir,
        error: err.message,
      });
    }

    // Active live-video streams keyed by sessionId.
    this.streams = new Map();
  }

  // ─── Live video streaming ───────────────────────────
  // A "session" represents one continuous recording triggered by suspicious
  // activity. The browser streams encoded video chunks which are appended to a
  // single growing file. An external process can tail this file live.

  /**
   * Open a new live-video file for a session.
   * @param {object} info { sessionId, alertType, severity, mimeType }
   * @returns {string|null} The video file path, or null if disabled/failed.
   */
  startStream(info) {
    if (!this.enabled || !this.videoEnabled || config.feed.recordingEnabled === false) return null;
    if (!info || !info.sessionId) return null;
    if (this.streams.has(info.sessionId)) {
      return this.streams.get(info.sessionId).videoPath;
    }

    // Use the incoming container extension (usually .webm) for the
    // live stream file. If the configured `videoFormat` is 'mp4' we will
    // convert the resulting WebM file to MP4 in `_convertToMp4` after the
    // stream is finalized. This avoids ffmpeg trying to convert a file
    // in-place when input and output paths are identical.
    const incomingExt = this._extForMime(info.mimeType) || 'webm';
    const baseName = this._buildBaseName({
      timestamp: new Date().toISOString(),
      alertType: info.alertType,
      alertId: info.sessionId,
    });
    const videoPath = path.join(this.outputDir, `${baseName}.${incomingExt}`);

    try {
      const ws = fs.createWriteStream(videoPath);
      const session = {
        ws,
        videoPath,
        baseName,
        bytes: 0,
        chunks: 0,
        startedAt: new Date().toISOString(),
        alertType: info.alertType,
        severity: info.severity,
        mimeType: info.mimeType || 'video/webm',
        autoCloseTimer: null,
      };
      this.streams.set(info.sessionId, session);

      // Auto-close stream after configured duration
      session.autoCloseTimer = setTimeout(() => {
        logger.info('Feed writer: auto-closing video stream after timeout', {
          sessionId: info.sessionId,
          durationSec: this.videoDurationSec,
        });
        this.endStream(info.sessionId);
      }, this.videoDurationSec * 1000);

      logger.info('Feed writer: live video stream started', {
        sessionId: info.sessionId,
        file: path.basename(videoPath),
        durationSec: this.videoDurationSec,
      });
      return videoPath;
    } catch (err) {
      logger.error('Feed writer: failed to start video stream', {
        sessionId: info.sessionId,
        error: err.message,
      });
      return null;
    }
  }

  /**
   * Append one encoded video chunk to an open session file.
   * @param {string} sessionId
   * @param {Buffer|ArrayBuffer|TypedArray} data
   */
  appendChunk(sessionId, data) {
    const session = this.streams.get(sessionId);
    if (!session) return false;

    const buffer = this._toBuffer(data);
    if (!buffer || buffer.length === 0) return false;

    session.ws.write(buffer);
    session.bytes += buffer.length;
    session.chunks += 1;
    return true;
  }

  /**
   * Finalize a session: close the file and write a `.json` sidecar so the
   * watcher knows the clip is complete.
   * @param {string} sessionId
   * @returns {Promise<string|null>} Video path, or null.
   */
  async endStream(sessionId) {
    const session = this.streams.get(sessionId);
    if (!session) return null;
    this.streams.delete(sessionId);

    // Cancel auto-close timer if still pending
    if (session.autoCloseTimer) {
      clearTimeout(session.autoCloseTimer);
    }

    await new Promise((resolve) => session.ws.end(resolve));

    try {
      // If MP4 format is requested, always transcode to H.264/AAC MP4 so the
      // final file matches the codec/container combination from the screenshot.
      if (this.videoFormat === 'mp4') {
        await this._convertToMp4(session);
      }

      logger.info('Feed writer: live video stream finalized', {
        sessionId,
        file: path.basename(session.videoPath),
        bytes: session.bytes,
        format: path.extname(session.videoPath),
      });
      return session.videoPath;
    } catch (err) {
      logger.error('Feed writer: failed to finalize video stream', {
        sessionId,
        error: err.message,
      });
      return null;
    }
  }

  async _convertToMp4(session) {
    const { execFile } = require('child_process');
    const inputPath = session.videoPath;
    const finalMp4Path = inputPath.replace(/\.[^.]+$/, '.mp4');
    const tempMp4Path = finalMp4Path === inputPath ? `${finalMp4Path}.tmp.mp4` : finalMp4Path;

    return new Promise((resolve) => {
      execFile(this.ffmpegPath, [
        '-i', inputPath,
        '-map', '0:v:0',
        '-map', '0:a:0?',
        '-c:v', 'libx264',
        '-profile:v', 'high',
        '-level', '4.0',
        '-pix_fmt', 'yuv420p',
        '-tag:v', 'avc1',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-ar', '48000',
        '-ac', '2',
        '-movflags', '+faststart',
        '-preset', 'veryfast',
        '-y',
        tempMp4Path,
      ], (error) => {
        if (error) {
          if (error.code === 'ENOENT') {
            logger.warn('Feed writer: ffmpeg not found in PATH', {
              expected: this.ffmpegPath,
              advice: 'Install ffmpeg: sudo apt install ffmpeg (Ubuntu) or brew install ffmpeg (macOS)',
              keeping: 'WebM format',
            });
          } else {
            logger.warn('Feed writer: ffmpeg conversion failed', {
              input: path.basename(inputPath),
              error: error.message,
            });
          }
          resolve();
        } else {
          try {
            if (tempMp4Path !== finalMp4Path) {
              fs.renameSync(tempMp4Path, finalMp4Path);
            }
            if (inputPath !== finalMp4Path && fs.existsSync(inputPath)) {
              fs.unlinkSync(inputPath);
            }
            logger.info('Feed writer: converted video to H.264/AAC MP4', {
              input: path.basename(inputPath),
              mp4: path.basename(finalMp4Path),
            });
            session.videoPath = finalMp4Path;
          } catch (err) {
            logger.warn('Feed writer: failed to finalize MP4 output', {
              file: inputPath,
              error: err.message,
            });
          }
          resolve();
        }
      });
    });
  }

  _extForMime(mimeType) {
    if (mimeType && mimeType.includes('mp4')) return 'mp4';
    return 'webm';
  }

  _toBuffer(data) {
    if (!data) return null;
    if (Buffer.isBuffer(data)) return data;
    if (data instanceof ArrayBuffer) return Buffer.from(data);
    if (ArrayBuffer.isView(data)) {
      return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    }
    return null;
  }

  /**
   * Persist the snapshot for a processed alert.
   * @param {object} alert Alert payload produced by AlertManager.
   * @returns {Promise<string|null>} Path to the written image, or null.
   */
  async write(alert) {
    if (!this.enabled || !this.imageEnabled) return null;

    const buffer = this._decodeSnapshot(alert.snapshot);
    if (!buffer) {
      logger.debug('Feed writer: alert has no decodable snapshot, skipping', {
        alertId: alert.alertId,
      });
      return null;
    }

    const baseName = this._buildBaseName(alert);
    const imagePath = path.join(this.outputDir, `${baseName}.jpg`);
    const metaPath = path.join(this.outputDir, `${baseName}.json`);

    const meta = {
      alertId: alert.alertId,
      timestamp: alert.timestamp,
      cameraId: alert.cameraId,
      alertType: alert.alertType,
      severity: alert.severity,
      confidence: alert.confidence,
      detections: alert.detections,
      metadata: alert.metadata,
      image: path.basename(imagePath),
    };

    try {
      // Write the image first, then the metadata. The metadata file appearing
      // is the signal that the (larger) image is fully on disk.
      await this._atomicWrite(imagePath, buffer);
      await this._atomicWrite(metaPath, JSON.stringify(meta, null, 2));

      logger.info('Feed writer: suspicious frame saved', {
        alertId: alert.alertId,
        file: path.basename(imagePath),
      });
      return imagePath;
    } catch (err) {
      logger.error('Feed writer: failed to save frame', {
        alertId: alert.alertId,
        error: err.message,
      });
      return null;
    }
  }

  _decodeSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'string') return null;

    // Accept either a data URL ("data:image/jpeg;base64,....") or raw base64.
    const match = snapshot.match(/^data:image\/\w+;base64,(.+)$/);
    const base64 = match ? match[1] : snapshot;

    try {
      const buffer = Buffer.from(base64, 'base64');
      return buffer.length > 0 ? buffer : null;
    } catch {
      return null;
    }
  }

  _buildBaseName(alert) {
    // Filesystem-safe, sortable name: 2026-06-02T07-41-26-788Z_FIRE_<id8>
    const ts = (alert.timestamp || new Date().toISOString()).replace(/[:.]/g, '-');
    const type = (alert.alertType || 'UNKNOWN').replace(/[^A-Z0-9_]/gi, '');
    const id = (alert.alertId || '').split('-')[0] || 'noid';
    return `${ts}_${type}_${id}`;
  }

  async _atomicWrite(targetPath, data) {
    const tmpPath = `${targetPath}.${process.pid}.tmp`;
    await fs.promises.writeFile(tmpPath, data);
    await fs.promises.rename(tmpPath, targetPath);
  }
}

module.exports = FeedWriter;
