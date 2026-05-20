# Suspicious Activity Detector

Real-time AI-powered surveillance system that detects suspicious activity from a live camera feed and raises alarms by calling an external API. All AI inference runs client-side in the browser via TensorFlow.js; the Node.js backend receives detection data, runs multi-stage analyzers, and dispatches alerts.

## Features

| # | Detection Type | Alert Type | Severity | How it Works |
|---|---|---|---|---|
| 1 | **Fire** | `FIRE` | HIGH | Red/orange pixel ratio + brightness + flicker pattern across consecutive frames |
| 2 | **Fighting / Crowd** | `FIGHTING_CROWD` | HIGH | MoveNet pose-based aggression (wrist-to-head proximity between 2+ people) OR crowd gathering (≥N people, configurable) |
| 3 | **Intrusion** | `INTRUSION` | MEDIUM | Person bbox center inside a restricted zone polygon for N consecutive frames |
| 4 | **Gunfire** | `GUNFIRE` | CRITICAL | Sudden brightness spike (muzzle flash) + optional audio impulse detection |

All detections require **consecutive-frame confirmation** (default 5–6 frames) before an alert fires, reducing false positives.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser                                                        │
│  ┌────────────┐  ┌──────────────────────┐  ┌────────────────┐  │
│  │ Camera +   │→ │ DetectionEngine      │→ │ Socket.IO      │  │
│  │ Microphone │  │ (COCO-SSD, MoveNet,  │  │ emit detection │  │
│  │            │  │  frame analysis)      │  │                │  │
│  └────────────┘  └──────────────────────┘  └───────┬────────┘  │
└────────────────────────────────────────────────────┼────────────┘
                                                     │
                                                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  Node.js Server (Express + Socket.IO)                           │
│  ┌───────────────┐  ┌───────────────┐  ┌─────────────────────┐ │
│  │ FireAnalyzer  │  │ BehaviorAnal. │  │ IntrusionAnalyzer   │ │
│  │ GunfireAnal.  │  │               │  │                     │ │
│  └───────┬───────┘  └───────┬───────┘  └──────────┬──────────┘ │
│          └──────────────────┼─────────────────────┘            │
│                             ▼                                   │
│                      AlertManager                               │
│                    (cooldown + history)                          │
│                             │                                   │
│                             ▼                                   │
│                      AlertService                               │
│                  (HTTP POST with retry)                          │
│                             │                                   │
└─────────────────────────────┼───────────────────────────────────┘
                              ▼
                    External Alert API
```

- **Frontend** (`public/`): Opens camera via `getUserMedia`, runs COCO-SSD + MoveNet pose detection client-side, performs per-frame color/brightness/motion analysis, and streams results over Socket.IO
- **Backend** (`src/`): Receives detection data, runs four analyzers with consecutive-frame confirmation, manages alert cooldowns, and POSTs alert payloads to your external API with automatic retry
- **UI**: Live bounding boxes, pose skeleton overlay, restricted zone visualization, real-time alert log with API delivery status, FPS counter, and confidence slider

## Project Structure

```
suspicious-activity-detector/
├── public/
│   ├── index.html              # Single-page surveillance dashboard
│   ├── css/styles.css          # Dashboard styling
│   └── js/
│       ├── app.js              # Main app — socket events, detection loop, controls
│       ├── cameraManager.js    # Camera + microphone access, snapshot capture
│       ├── detectionEngine.js  # COCO-SSD + MoveNet + frame analysis (runs in browser)
│       └── uiManager.js        # Canvas overlays, alert log, stats display
├── src/
│   ├── server.js               # Express + Socket.IO server, REST endpoints, detection pipeline
│   ├── config.js               # Environment variable configuration
│   ├── logger.js               # Winston logger (console + file transports)
│   ├── alertManager.js         # Alert creation, cooldown, history, broadcasting
│   ├── alertService.js         # HTTP POST to external API with retry (3 attempts)
│   └── analyzers/
│       ├── fireAnalyzer.js     # Red/orange ratio + flicker + brightness
│       ├── behaviorAnalyzer.js # Crowd counting + pose-based fighting
│       ├── intrusionAnalyzer.js# Point-in-polygon zone detection
│       └── gunfireAnalyzer.js  # Muzzle flash + audio impulse
├── zones/
│   └── zones.json              # Restricted zone polygon definitions
├── logs/                       # Winston log output (gitignored)
├── test-api.js                 # Standalone test server to receive alerts
├── package.json
└── .env                        # Environment configuration (gitignored)
```

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Create a .env file (see Configuration section below)

# 3. Start the server
npm start
# or with auto-reload during development:
npm run dev

# 4. Open in browser
#    http://localhost:3000
```

The camera auto-starts when the page loads. Grant camera and microphone permissions when prompted.

### Testing Alerts Locally

A bundled test API server lets you receive and inspect alerts without an external service:

```bash
# Terminal 1 — start the test alert receiver
node test-api.js
# Listening on http://localhost:4000

# Terminal 2 — start the main app (set ALERT_ENDPOINT=http://localhost:4000/api/alerts in .env)
npm start
```

Alerts will be logged to the test server console with type, severity, confidence, metadata, and snapshot size.

## Configuration (.env)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server port |
| `NODE_ENV` | `development` | `production` sets log level to `info` |
| `ALERT_ENDPOINT` | *(empty)* | External API URL that receives alert POSTs |
| `ALERT_API_KEY` | *(empty)* | Sent as `X-API-Key` header on alert requests |
| `CAMERA_ID` | `cam-01` | Camera identifier included in alert payloads |
| `MOTION_THRESHOLD` | `5` | Frame motion % required to trigger server-side analysis |
| `CONFIDENCE_THRESHOLD` | `0.6` | Minimum COCO-SSD confidence to keep a detection |
| `FIRE_CONFIDENCE_THRESHOLD` | `0.5` | Minimum confidence for fire detection |
| `ALERT_COOLDOWN_MS` | `30000` | Cooldown between repeated alerts of the same type |
| `GUNFIRE_COOLDOWN_MS` | `5000` | Shorter cooldown for gunfire alerts |
| `CROWD_THRESHOLD` | `5` | Number of people to trigger a crowd alert |
| `ENABLE_ZONE_DETECTION` | `false` | Set to `true` to enable restricted zone intrusion alerts |

## Alert Payload (sent to your API)

```json
{
  "alertId": "uuid-v4",
  "timestamp": "2026-05-18T10:42:00.000Z",
  "cameraId": "cam-01",
  "alertType": "INTRUSION",
  "severity": "MEDIUM",
  "confidence": { "detection": 0.92 },
  "detections": [
    { "class": "person", "score": 0.92, "bbox": [100, 200, 50, 120] }
  ],
  "metadata": { "zoneName": "Restricted Area - Main Entrance", "zoneId": "zone-01", "consecutiveFrames": 5 },
  "snapshot": "data:image/jpeg;base64,..."
}
```

The `confidence` and `metadata` fields vary by alert type:

| Alert Type | `confidence` keys | `metadata` keys |
|---|---|---|
| `FIRE` | `visual` | `redOrangeRatio`, `brightness`, `flickerDetected`, `consecutiveFrames` |
| `FIGHTING_CROWD` | `behavior` | `fightingDetected`, `crowdDetected`, `personCount`, `crowdThreshold`, `poseCount` |
| `INTRUSION` | `detection` | `zoneName`, `zoneId`, `consecutiveFrames` |
| `GUNFIRE` | `visual`, `audio`, `combined` | `visualDetected`, `audioDetected`, `flashDuration` |

## Restricted Zones

Edit `zones/zones.json` to define restricted areas as polygons (pixel coordinates matching your camera resolution). Zones can also be updated at runtime via the `PUT /api/zones` endpoint.

```json
{
  "zones": [
    {
      "id": "zone-01",
      "name": "Restricted Area - Main Entrance",
      "polygon": [[100,100],[400,100],[400,350],[100,350]],
      "color": "#FF0000"
    }
  ]
}
```

## REST API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Health check — uptime, alert endpoint status, zone count |
| `GET` | `/api/alerts` | Alert history (last 200 alerts) |
| `GET` | `/api/stats` | Alert statistics — total count and breakdown by type |
| `GET` | `/api/zones` | Get current restricted zones |
| `PUT` | `/api/zones` | Update restricted zones (persists to `zones/zones.json`) |

## Socket.IO Events

| Direction | Event | Description |
|---|---|---|
| Client → Server | `detection` | Frame detection data (objects, poses, frame analysis, snapshot) |
| Client → Server | `getZones` | Request current zone configuration |
| Server → Client | `zones` | Zone polygon data |
| Server → Client | `alert` | New alert triggered |
| Server → Client | `alertStatus` | External API delivery result (`delivered: true/false`) |

## UI Controls

- **Start/Stop Camera** — toggle camera feed and detection loop
- **Show/Hide Zones** — overlay restricted zone polygons on the video feed
- **Pose Detection ON/OFF** — toggle MoveNet skeleton overlay (off by default for performance)
- **Confidence Slider** — adjust minimum detection confidence (0.10–0.95) in real time

## Tech Stack

- **TensorFlow.js** — COCO-SSD (`lite_mobilenet_v2`) object detection + MoveNet (`MULTIPOSE_LIGHTNING`) pose estimation, all in-browser
- **Express + Socket.IO** — Real-time bidirectional server
- **Axios** — External API calls with 3-attempt exponential backoff retry
- **Winston** — Structured logging to console + rotating file transports (`logs/`)
- **uuid** — v4 UUIDs for alert IDs

## License

MIT
