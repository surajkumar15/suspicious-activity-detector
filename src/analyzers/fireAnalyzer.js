const logger = require('../logger');
const config = require('../config');

class FireAnalyzer {
  constructor(options = {}) {
    this.redThreshold = options.redThreshold || config.fire.redThreshold;
    this.brightnessThreshold = options.brightnessThreshold || config.fire.brightnessThreshold;
    this.flickerFrameCount = options.flickerFrameCount || 8;
    this.flickerSensitivity = options.flickerSensitivity || config.fire.flickerSensitivity;
    this.consecutiveFramesRequired = options.consecutiveFramesRequired || config.fire.consecutiveFrames;
    this.previousRedRatios = [];
    this.fireFrameCount = 0;
    this.fireConfirmed = false;
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
    const hasHighBrightness = brightness > this.brightnessThreshold;

    // logger.info('Fire check', {
    //   redOrangeRatio: redOrangeRatio.toFixed(4),
    //   brightness: brightness.toFixed(3),
    //   hasFireColors,
    //   hasFlicker,
    //   hasHighBrightness,
    //   fireFrameCount: this.fireFrameCount,
    // });

    const isFireLikely = hasFireColors && hasFlicker && hasHighBrightness;

    if (isFireLikely) {
      this.fireFrameCount++;

      // Confirm only while conditions actually hold, and only once per episode
      // (latched until the streak resets), so decaying counts can't re-trigger.
      if (this.fireFrameCount >= this.consecutiveFramesRequired && !this.fireConfirmed) {
        this.fireConfirmed = true;
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
    } else {
      this.fireFrameCount = Math.max(0, this.fireFrameCount - 1);
      if (this.fireFrameCount === 0) {
        this.fireConfirmed = false; // streak ended; allow a future re-confirm
      }
    }

    return alerts;
  }

  _detectFlicker() {
    if (this.previousRedRatios.length < this.flickerFrameCount) return false;

    let changes = 0;
    for (let i = 1; i < this.previousRedRatios.length; i++) {
      const diff = Math.abs(this.previousRedRatios[i] - this.previousRedRatios[i - 1]);
      if (diff > this.flickerSensitivity) changes++;
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
