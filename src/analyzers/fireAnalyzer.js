const logger = require('../logger');

class FireAnalyzer {
  constructor(options = {}) {
    this.redThreshold = options.redThreshold || 0.25;
    this.flickerFrameCount = options.flickerFrameCount || 8;
    this.consecutiveFramesRequired = options.consecutiveFramesRequired || 6;
    this.previousRedRatios = [];
    this.fireFrameCount = 0;
  }

  analyze(frameAnalysis) {
    const alerts = [];

    if (!frameAnalysis || !frameAnalysis.colorData) return alerts;

    const { redOrangeRatio, brightness } = frameAnalysis.colorData;

    this.previousRedRatios.push(redOrangeRatio);
    if (this.previousRedRatios.length > this.flickerFrameCount) {
      this.previousRedRatios.shift();
    }

    const hasFlicker = this._detectFlicker();
    const hasFireColors = redOrangeRatio > this.redThreshold;
    const hasHighBrightness = brightness > 0.7;

    const isFireLikely = hasFireColors && hasFlicker && hasHighBrightness;

    if (isFireLikely) {
      this.fireFrameCount++;
    } else {
      this.fireFrameCount = Math.max(0, this.fireFrameCount - 1);
    }

    if (this.fireFrameCount === this.consecutiveFramesRequired) {
      const confidence = this._calculateConfidence(redOrangeRatio, hasFlicker, hasHighBrightness);

      alerts.push({
        alertType: 'FIRE',
        confidence: { visual: confidence },
        detections: [],
        metadata: {
          redOrangeRatio,
          brightness,
          flickerDetected: hasFlicker,
          consecutiveFrames: this.fireFrameCount,
        },
      });

      logger.debug('Fire confirmed', { redOrangeRatio, brightness, flickerDetected: hasFlicker });
    }

    return alerts;
  }

  _detectFlicker() {
    if (this.previousRedRatios.length < this.flickerFrameCount) return false;

    let changes = 0;
    for (let i = 1; i < this.previousRedRatios.length; i++) {
      const diff = Math.abs(this.previousRedRatios[i] - this.previousRedRatios[i - 1]);
      if (diff > 0.05) changes++;
    }

    return changes >= Math.floor(this.flickerFrameCount * 0.6);
  }

  _calculateConfidence(redRatio, hasFlicker, hasBrightness) {
    let confidence = 0.5;
    if (redRatio > 0.35) confidence += 0.2;
    if (hasFlicker) confidence += 0.15;
    if (hasBrightness) confidence += 0.1;
    return Math.min(confidence, 0.95);
  }
}

module.exports = FireAnalyzer;
