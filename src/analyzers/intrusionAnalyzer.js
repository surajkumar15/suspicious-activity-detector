const logger = require('../logger');

class IntrusionAnalyzer {
  constructor(zones) {
    this.zones = zones || [];
    this.minPersonConfidence = 0.75;
    this.consecutiveFramesRequired = 5;
    this.zoneHitCounters = new Map();
  }

  setZones(zones) {
    this.zones = zones;
    this.zoneHitCounters.clear();
    logger.info(`Intrusion zones updated: ${zones.length} zones loaded`);
  }

  analyze(detections) {
    const alerts = [];

    const persons = detections.filter(d => d.class === 'person' && d.score >= this.minPersonConfidence);

    const activeZones = new Set();

    for (const person of persons) {
      for (const zone of this.zones) {
        if (this._isInsideZone(person.bbox, zone.polygon)) {
          activeZones.add(zone.id);
          const count = (this.zoneHitCounters.get(zone.id) || 0) + 1;
          this.zoneHitCounters.set(zone.id, count);

          if (count === this.consecutiveFramesRequired) {
            alerts.push({
              alertType: 'INTRUSION',
              confidence: { detection: person.score },
              detections: [person],
              metadata: {
                zoneName: zone.name,
                zoneId: zone.id,
                consecutiveFrames: count,
              },
            });

            logger.debug(`Intrusion confirmed in zone: ${zone.name}`, {
              personScore: person.score,
              consecutiveFrames: count,
            });
          }
        }
      }
    }

    for (const zone of this.zones) {
      if (!activeZones.has(zone.id)) {
        this.zoneHitCounters.set(zone.id, 0);
      }
    }

    return alerts;
  }

  _isInsideZone(bbox, polygon) {
    const [x, y, width, height] = bbox;
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    return this._pointInPolygon(centerX, centerY, polygon);
  }

  _pointInPolygon(px, py, polygon) {
    let inside = false;
    const n = polygon.length;

    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = polygon[i][0], yi = polygon[i][1];
      const xj = polygon[j][0], yj = polygon[j][1];

      const intersect = ((yi > py) !== (yj > py))
        && (px < (xj - xi) * (py - yi) / (yj - yi) + xi);

      if (intersect) inside = !inside;
    }

    return inside;
  }
}

module.exports = IntrusionAnalyzer;
