#!/usr/bin/env node
/**
 * Example WSL-side consumer.
 *
 * Watches the captures directory and reacts to what the detector writes:
 *   - <name>.webm           a live video clip (grows while activity is ongoing)
 *   - <name>.video.json     metadata sidecar, written when the clip is finalized
 *   - <name>.jpg / .json    snapshot image + metadata (if image capture is on)
 *
 * The `.webm` file appears as soon as activity starts and you can begin reading
 * it live (e.g. `ffplay`, `vlc`, or a tail-and-pipe). The `.video.json` sidecar
 * is written once the clip is complete.
 *
 * Usage:
 *   node scripts/watch-captures.js [captures-dir]
 */
const fs = require('fs');
const path = require('path');

const dir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'captures'));
fs.mkdirSync(dir, { recursive: true });

console.log(`[watcher] watching ${dir}`);

const seenVideos = new Set();
const finalized = new Set();
const seenImages = new Set();

function onNewVideo(file) {
  if (seenVideos.has(file)) return;
  seenVideos.add(file);
  const videoPath = path.join(dir, file);
  console.log(`[watcher] LIVE video started → ${videoPath}`);
  // TODO: start reading/streaming this file live if you want real-time playback.
}

function onVideoFinalized(jsonFile) {
  if (finalized.has(jsonFile)) return;
  finalized.add(jsonFile);

  const jsonPath = path.join(dir, jsonFile);
  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch {
    finalized.delete(jsonFile); // not fully written yet; retry on next event
    return;
  }

  const videoPath = path.join(dir, meta.video);
  console.log(
    `[watcher] video COMPLETE: ${meta.alertType} (${meta.severity}) ` +
    `${meta.bytes} bytes, ${meta.chunks} chunks → ${videoPath}`
  );
  // TODO: hand the completed `videoPath` / `meta` to your pipeline here.
}

function onImageMeta(jsonFile) {
  if (seenImages.has(jsonFile)) return;
  seenImages.add(jsonFile);

  const jsonPath = path.join(dir, jsonFile);
  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch {
    seenImages.delete(jsonFile);
    return;
  }
  if (!meta.image) return;
  console.log(
    `[watcher] snapshot: ${meta.alertType} (${meta.severity}) @ ${meta.timestamp} ` +
    `→ ${path.join(dir, meta.image)}`
  );
}

function inspect(filename) {
  if (!filename) return;
  if (filename.endsWith('.video.json')) {
    onVideoFinalized(filename);
  } else if (filename.endsWith('.webm') || filename.endsWith('.mp4')) {
    onNewVideo(filename);
  } else if (filename.endsWith('.json')) {
    onImageMeta(filename);
  }
}

// React to changes as they arrive...
fs.watch(dir, (_event, filename) => inspect(filename));

// ...and process anything already present at startup.
for (const f of fs.readdirSync(dir)) inspect(f);
