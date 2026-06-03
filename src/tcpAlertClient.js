const net = require('net');
const config = require('./config');
const logger = require('./logger');

/**
 * TcpAlertClient — maintains a persistent TCP connection to an external alert
 * listener (default localhost:5555) and sends raw command strings when an alert
 * is triggered.
 *
 * On each alert the following raw strings are written to the socket (each
 * terminated by a newline so the listener can frame them):
 *   send-alert
 *   send-text
 *
 * The client auto-reconnects with a capped backoff if the listener is down, and
 * silently no-ops (without crashing the detector) while disconnected.
 */
class TcpAlertClient {
  constructor() {
    this.enabled = config.tcp.enabled;
    this.host = config.tcp.host;
    this.port = config.tcp.port;
    this.socket = null;
    this.connected = false;
    this.reconnectDelay = 1000;
    this.maxReconnectDelay = 15000;
    this.reconnectTimer = null;
    this.stopped = false;

    if (!this.enabled) {
      logger.info('TCP alert client disabled (set TCP_ALERT_ENABLED=true to enable)');
      return;
    }

    this._connect();
  }

  _connect() {
    if (this.stopped) return;

    this.socket = new net.Socket();

    this.socket.connect(this.port, this.host, () => {
      this.connected = true;
      this.reconnectDelay = 1000;
      logger.info(`TCP alert client connected → ${this.host}:${this.port}`);
    });

    this.socket.on('error', (err) => {
      // Connection problems are expected when the listener is down; log quietly.
      logger.debug(`TCP alert client error: ${err.message}`);
    });

    this.socket.on('close', () => {
      if (this.connected) {
        logger.warn('TCP alert client connection closed');
      }
      this.connected = false;
      this._scheduleReconnect();
    });
  }

  _scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
      this._connect();
    }, this.reconnectDelay);
  }

  /**
   * Send the alert command string to the listener.
   * Called whenever an alert is triggered.
   */
  sendAlert() {
    logger.debug(`[TcpAlert] sendAlert called - enabled: ${this.enabled}`);
    if (!this.enabled) {
      logger.warn('[TcpAlert] TCP alert client disabled (TCP_ALERT_ENABLED not set to true)');
      return;
    }
    if (!this.connected || !this.socket) {
      logger.warn(`[TcpAlert] TCP alert client not connected (connected: ${this.connected}, socket: ${!!this.socket}); alert not forwarded`);
      return;
    }

    try {
      this.socket.write('send-alert\n');
      logger.info('[TcpAlert] Successfully sent send-alert command');
    } catch (err) {
      logger.error('[TcpAlert] Failed to send', { error: err.message });
    }
  }

  /**
   * Send a 'send-file' command with the provided file path to the listener.
   * The listener is expected to handle the path and transfer or ingest the
   * file as appropriate.
   * @param {string} filePath
   */
  sendFile(filePath) {
    logger.debug(`[TcpAlert] sendFile called - enabled: ${this.enabled}, file: ${filePath}`);
    if (!this.enabled) {
      logger.warn('[TcpAlert] TCP alert client disabled (TCP_ALERT_ENABLED not set to true)');
      return;
    }
    if (!this.connected || !this.socket) {
      logger.warn(`[TcpAlert] TCP alert client not connected (connected: ${this.connected}, socket: ${!!this.socket}); send-file not forwarded`);
      return;
    }

    try {
      // Send command with file path on the same line so the listener can parse it.
      this.socket.write(`send-file ${filePath}\n`);
      logger.info('[TcpAlert] Successfully sent send-file command');
    } catch (err) {
      logger.error('[TcpAlert] Failed to send send-file', { error: err.message });
    }
  }

  /**
   * Send a 'send-text' command to the listener.
   * The listener is expected to handle alert type metadata from the text file.
   */
  sendText() {
    logger.debug(`[TcpAlert] sendText called - enabled: ${this.enabled}`);
    if (!this.enabled) {
      logger.warn('[TcpAlert] TCP alert client disabled (TCP_ALERT_ENABLED not set to true)');
      return;
    }
    if (!this.connected || !this.socket) {
      logger.warn(`[TcpAlert] TCP alert client not connected (connected: ${this.connected}, socket: ${!!this.socket}); send-text not forwarded`);
      return;
    }

    try {
      this.socket.write('send-text\n');
      logger.info('[TcpAlert] Successfully sent send-text command');
    } catch (err) {
      logger.error('[TcpAlert] Failed to send send-text', { error: err.message });
    }
  }

  /**
   * Send a 'send-location' command to the listener.
   * The listener is expected to handle geolocation data from the location file.
   */
  sendLocation() {
    logger.debug(`[TcpAlert] sendLocation called - enabled: ${this.enabled}`);
    if (!this.enabled) {
      logger.warn('[TcpAlert] TCP alert client disabled (TCP_ALERT_ENABLED not set to true)');
      return;
    }
    if (!this.connected || !this.socket) {
      logger.warn(`[TcpAlert] TCP alert client not connected (connected: ${this.connected}, socket: ${!!this.socket}); send-location not forwarded`);
      return;
    }

    try {
      this.socket.write('send-location\n');
      logger.info('[TcpAlert] Successfully sent send-location command');
    } catch (err) {
      logger.error('[TcpAlert] Failed to send send-location', { error: err.message });
    }
  }

  stop() {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
  }
}

module.exports = TcpAlertClient;
