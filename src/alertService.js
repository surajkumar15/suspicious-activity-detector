const axios = require('axios');
const config = require('./config');
const logger = require('./logger');

class AlertService {
  constructor() {
    this.client = axios.create({
      baseURL: config.alert.endpoint,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        ...(config.alert.apiKey && { 'X-API-Key': config.alert.apiKey }),
      },
    });

    this.retryAttempts = 3;
    this.retryDelayMs = 1000;
  }

  async sendAlert(alertPayload) {
    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        const response = await this.client.post('', alertPayload);

        logger.info('Alert sent to external API successfully', {
          alertId: alertPayload.alertId,
          alertType: alertPayload.alertType,
          severity: alertPayload.severity,
          status: response.status,
        });

        return { success: true, status: response.status, data: response.data };
      } catch (error) {
        const isLastAttempt = attempt === this.retryAttempts;
        const status = error.response?.status;
        const isRetryable = !status || status >= 500;

        logger.warn(`Alert API call failed (attempt ${attempt}/${this.retryAttempts})`, {
          alertId: alertPayload.alertId,
          alertType: alertPayload.alertType,
          error: error.message,
          status,
          retryable: isRetryable,
        });

        if (isLastAttempt || !isRetryable) {
          logger.error('Alert delivery failed permanently', {
            alertId: alertPayload.alertId,
            alertType: alertPayload.alertType,
            error: error.message,
          });
          return { success: false, error: error.message, status };
        }

        await this._delay(this.retryDelayMs * attempt);
      }
    }
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new AlertService();
