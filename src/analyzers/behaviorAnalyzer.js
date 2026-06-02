const logger = require('../logger');

class BehaviorAnalyzer {
  constructor(options = {}) {
    this.crowdThreshold = options.crowdThreshold || 5;
    this.consecutiveFramesRequired = options.consecutiveFramesRequired || 1;
    this.fightDistanceThreshold = options.fightDistanceThreshold || 240;
    this.handToHeadThreshold = options.handToHeadThreshold || 140;
    this.fightingFrameCount = 0;
    this.crowdFrameCount = 0;
    this.minPersonConfidence = 0.6;
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

        const headA = this._getHeadPoint(poseA);
        const headB = this._getHeadPoint(poseB);
        const handA = this._getContactPoint(poseA);
        const handB = this._getContactPoint(poseB);

        const headAValid = !!headA;
        const headBValid = !!headB;
        const contactAValid = !!handA;
        const contactBValid = !!handB;

        if (!headAValid || !headBValid || (!contactAValid && !contactBValid)) continue;

        const personDistance = headAValid && headBValid ? this._distance(headA, headB) : Number.POSITIVE_INFINITY;
        const handToHeadA = contactBValid && headAValid ? this._distance(handB, headA) : Number.POSITIVE_INFINITY;
        const handToHeadB = contactAValid && headBValid ? this._distance(handA, headB) : Number.POSITIVE_INFINITY;

        if (personDistance < this.fightDistanceThreshold
          && (handToHeadA < this.handToHeadThreshold || handToHeadB < this.handToHeadThreshold)) {
          return true;
        }
      }
    }

    return false;
  }

  _getContactPoint(pose) {
    return this._getKeypoint(pose, 'left_wrist')
      || this._getKeypoint(pose, 'right_wrist')
      || this._getKeypoint(pose, 'left_elbow')
      || this._getKeypoint(pose, 'right_elbow')
      || this._getKeypoint(pose, 'left_shoulder')
      || this._getKeypoint(pose, 'right_shoulder')
      || this._getKeypoint(pose, 'left_hip')
      || this._getKeypoint(pose, 'right_hip');
  }

  _getHeadPoint(pose) {
    return this._getKeypoint(pose, 'nose')
      || this._getKeypoint(pose, 'left_eye')
      || this._getKeypoint(pose, 'right_eye')
      || this._getKeypoint(pose, 'left_ear')
      || this._getKeypoint(pose, 'right_ear')
      || this._getKeypoint(pose, 'left_shoulder')
      || this._getKeypoint(pose, 'right_shoulder');
  }

  _distance(a, b) {
    return Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2));
  }

  _getKeypoint(pose, name) {
    if (!pose.keypoints) return null;
    const kp = pose.keypoints.find(k => k.name === name || k.part === name);
    return (kp && kp.score > 0.3) ? kp : null;
  }
}

module.exports = BehaviorAnalyzer;
