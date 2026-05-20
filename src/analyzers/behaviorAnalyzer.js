const logger = require('../logger');

class BehaviorAnalyzer {
  constructor(options = {}) {
    this.crowdThreshold = options.crowdThreshold || 5;
    this.consecutiveFramesRequired = 5;
    this.fightingFrameCount = 0;
    this.crowdFrameCount = 0;
    this.minPersonConfidence = 0.7;
  }

  analyze(detections, poses) {
    const alerts = [];
    const persons = detections.filter(d => d.class === 'person' && d.score >= this.minPersonConfidence);

    const crowdDetected = this._detectCrowd(persons);
    const fightingDetected = this._detectFighting(poses);

    if (fightingDetected) {
      this.fightingFrameCount++;
    } else {
      this.fightingFrameCount = Math.max(0, this.fightingFrameCount - 1);
    }

    if (crowdDetected) {
      this.crowdFrameCount++;
    } else {
      this.crowdFrameCount = Math.max(0, this.crowdFrameCount - 1);
    }

    const fightingConfirmed = this.fightingFrameCount >= this.consecutiveFramesRequired;
    const crowdConfirmed = this.crowdFrameCount >= this.consecutiveFramesRequired;

    if (fightingConfirmed || crowdConfirmed) {
      const confidence = fightingConfirmed && crowdConfirmed
        ? 0.95
        : fightingConfirmed ? 0.80 : Math.min(persons.length / (this.crowdThreshold * 2), 0.85);

      alerts.push({
        alertType: 'FIGHTING_CROWD',
        confidence: { behavior: confidence },
        detections: persons,
        metadata: {
          fightingDetected: fightingConfirmed,
          crowdDetected: crowdConfirmed,
          personCount: persons.length,
          crowdThreshold: this.crowdThreshold,
          poseCount: (poses || []).length,
          fightingFrames: this.fightingFrameCount,
          crowdFrames: this.crowdFrameCount,
        },
      });

      logger.debug('FIGHTING_CROWD confirmed', {
        fighting: fightingConfirmed,
        crowd: crowdConfirmed,
        persons: persons.length,
      });

      if (fightingConfirmed) this.fightingFrameCount = 0;
      if (crowdConfirmed) this.crowdFrameCount = 0;
    }

    return alerts;
  }

  _detectCrowd(persons) {
    return persons.length >= this.crowdThreshold;
  }

  _detectFighting(poses) {
    if (!poses || poses.length < 2) return false;

    for (let i = 0; i < poses.length; i++) {
      for (let j = i + 1; j < poses.length; j++) {
        const poseA = poses[i];
        const poseB = poses[j];

        if (!poseA.keypoints || !poseB.keypoints) continue;

        const wristA = this._getKeypoint(poseA, 'left_wrist') || this._getKeypoint(poseA, 'right_wrist');
        const wristB = this._getKeypoint(poseB, 'left_wrist') || this._getKeypoint(poseB, 'right_wrist');
        const noseA = this._getKeypoint(poseA, 'nose');
        const noseB = this._getKeypoint(poseB, 'nose');

        if (!wristA || !wristB || !noseA || !noseB) continue;

        const personDistance = Math.sqrt(
          Math.pow(noseA.x - noseB.x, 2) + Math.pow(noseA.y - noseB.y, 2)
        );

        const wristToOtherHead1 = Math.sqrt(
          Math.pow(wristA.x - noseB.x, 2) + Math.pow(wristA.y - noseB.y, 2)
        );
        const wristToOtherHead2 = Math.sqrt(
          Math.pow(wristB.x - noseA.x, 2) + Math.pow(wristB.y - noseA.y, 2)
        );

        if (personDistance < 120 && (wristToOtherHead1 < 60 || wristToOtherHead2 < 60)) {
          return true;
        }
      }
    }

    return false;
  }

  _getKeypoint(pose, name) {
    const kp = pose.keypoints.find(k => k.name === name);
    return (kp && kp.score > 0.5) ? kp : null;
  }
}

module.exports = BehaviorAnalyzer;
