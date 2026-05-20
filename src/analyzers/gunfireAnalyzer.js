const logger = require('../logger');

class GunfireAnalyzer {
  constructor(options = {}) {
    this.flashBrightnessThreshold = options.flashBrightnessThreshold || 0.9;
    this.flashMinArea = options.flashMinArea || 0.001;
    this.flashMaxArea = options.flashMaxArea || 0.05;
    this.audioImpulseThreshold = options.audioImpulseThreshold || 0.85;

    this.previousFrameBrightness = [];
    this.maxFrameHistory = 5;
  }

  analyze(frameAnalysis, audioAnalysis) {
    const alerts = [];

    const visualResult = this._detectMuzzleFlash(frameAnalysis);
    const audioResult = this._detectGunshot(audioAnalysis);

    if (visualResult.detected || audioResult.detected) {
      const combined = this._combinedConfidence(visualResult, audioResult);

      alerts.push({
        alertType: 'GUNFIRE',
        confidence: {
          visual: visualResult.confidence,
          audio: audioResult.confidence,
          combined,
        },
        detections: visualResult.flashRegion ? [visualResult.flashRegion] : [],
        metadata: {
          visualDetected: visualResult.detected,
          audioDetected: audioResult.detected,
          flashDuration: visualResult.flashDuration,
        },
      });

      logger.warn('GUNFIRE DETECTED', {
        visual: visualResult.detected,
        audio: audioResult.detected,
        combined,
      });
    }

    return alerts;
  }

  _detectMuzzleFlash(frameAnalysis) {
    const result = { detected: false, confidence: 0, flashRegion: null, flashDuration: 0 };

    if (!frameAnalysis || !frameAnalysis.brightnessData) return result;

    const { peakBrightness, brightAreaRatio, brightRegion } = frameAnalysis.brightnessData;

    this.previousFrameBrightness.push(peakBrightness);
    if (this.previousFrameBrightness.length > this.maxFrameHistory) {
      this.previousFrameBrightness.shift();
    }

    const isHighBrightness = peakBrightness > this.flashBrightnessThreshold;
    const isSmallArea = brightAreaRatio > this.flashMinArea && brightAreaRatio < this.flashMaxArea;

    const isSuddenSpike = this._isSuddenBrightnessSpike();

    if (isHighBrightness && isSmallArea && isSuddenSpike) {
      result.detected = true;
      result.confidence = Math.min(0.5 + peakBrightness * 0.3 + (isSuddenSpike ? 0.2 : 0), 0.95);
      result.flashRegion = brightRegion;
    }

    return result;
  }

  _isSuddenBrightnessSpike() {
    if (this.previousFrameBrightness.length < 4) return false;

    const history = this.previousFrameBrightness;
    const current = history[history.length - 1];
    const previous = history[history.length - 2];
    const avgBaseline = history.slice(0, -2).reduce((a, b) => a + b, 0) / (history.length - 2);

    const spikeFromBaseline = (current - avgBaseline) > 0.6;
    const spikeFalloff = previous < avgBaseline + 0.15;

    return spikeFromBaseline && spikeFalloff;
  }

  _detectGunshot(audioAnalysis) {
    const result = { detected: false, confidence: 0 };

    if (!audioAnalysis) return result;

    const { impulseStrength, frequencyMatch, duration } = audioAnalysis;

    if (!impulseStrength) return result;

    const isImpulse = impulseStrength > this.audioImpulseThreshold;
    const isShortDuration = duration < 200;
    const hasMatchingFrequency = frequencyMatch > 0.6;

    if (isImpulse && isShortDuration) {
      result.detected = true;
      result.confidence = Math.min(
        0.4 + impulseStrength * 0.3 + (hasMatchingFrequency ? 0.25 : 0),
        0.95
      );
    }

    return result;
  }

  _combinedConfidence(visual, audio) {
    if (visual.detected && audio.detected) {
      return Math.min(0.97, 0.5 + visual.confidence * 0.3 + audio.confidence * 0.3);
    }
    return Math.max(visual.confidence, audio.confidence);
  }
}

module.exports = GunfireAnalyzer;
