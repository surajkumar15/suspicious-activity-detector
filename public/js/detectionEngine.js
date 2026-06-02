class DetectionEngine {
  constructor() {
    this.objectModel = null;
    this.poseDetector = null;
    this.isReady = false;
    this.poseEnabled = false;
    this.confidenceThreshold = 0.6;

    this.previousFrame = null;
    this.motionThreshold = 5;
  }

  async loadModels(onProgress) {
    try {
      onProgress('Loading COCO-SSD object detection model...');
      this.objectModel = await cocoSsd.load({
        base: 'lite_mobilenet_v2',
      });
      onProgress('COCO-SSD loaded. Loading pose detection...');

      try {
        const model = poseDetection.SupportedModels.MoveNet;
        this.poseDetector = await poseDetection.createDetector(model, {
          modelType: poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING,
          enableTracking: true,
          trackerType: poseDetection.TrackerType.BoundingBox,
        });
        onProgress('All models loaded successfully');
      } catch (poseError) {
        console.warn('Pose detection model failed to load, continuing without it:', poseError);
        onProgress('Object detection ready (pose detection unavailable)');
      }

      this.isReady = true;
      return true;
    } catch (error) {
      console.error('Model loading failed:', error);
      onProgress('ERROR: Failed to load models — ' + error.message);
      return false;
    }
  }

  async detect(videoElement) {
    if (!this.isReady || !this.objectModel) return null;

    const results = {
      objects: [],
      poses: [],
      motionDetected: false,
      frameAnalysis: {},
    };

    try {
      const predictions = await this.objectModel.detect(videoElement);
      results.objects = predictions
        .filter(p => p.score >= this.confidenceThreshold)
        .map(p => ({
          class: p.class,
          score: Math.round(p.score * 100) / 100,
          bbox: p.bbox,
        }));

      if (this.poseEnabled && this.poseDetector) {
        try {
          const poses = await this.poseDetector.estimatePoses(videoElement);
          results.poses = poses;
        } catch (e) {
          // Pose detection can occasionally fail, don't break the loop
        }
      }

      results.frameAnalysis = this._analyzeFrame(videoElement);
      results.motionDetected = results.frameAnalysis.motionPercent > this.motionThreshold;
    } catch (error) {
      console.error('Detection error:', error);
    }

    return results;
  }

  _analyzeFrame(videoElement) {
    const tempCanvas = document.createElement('canvas');
    const w = 160;
    const h = 120;
    tempCanvas.width = w;
    tempCanvas.height = h;
    const ctx = tempCanvas.getContext('2d');
    ctx.drawImage(videoElement, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;

    let redOrangePixels = 0;
    let totalBrightness = 0;
    let peakBrightness = 0;
    let brightPixels = 0;
    let motionPixels = 0;
    const totalPixels = w * h;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const brightness = (r + g + b) / (3 * 255);
      totalBrightness += brightness;

      if (brightness > peakBrightness) peakBrightness = brightness;
      if (brightness > 0.95) brightPixels++;

      // Flame colors only. Flames are bright, red-dominant, and carry little
      // blue relative to red. The blue limit rejects skin/wood/beige walls
      // (warm but blue-rich) while still matching red, orange and yellow flames.
      if (r > 150 && g < r * 0.95 && b < r * 0.6) redOrangePixels++;
    }

    if (this.previousFrame) {
      for (let i = 0; i < data.length; i += 4) {
        const diff = Math.abs(data[i] - this.previousFrame[i])
          + Math.abs(data[i + 1] - this.previousFrame[i + 1])
          + Math.abs(data[i + 2] - this.previousFrame[i + 2]);
        if (diff > 75) motionPixels++;
      }
    }

    this.previousFrame = new Uint8ClampedArray(data);

    return {
      motionPercent: (motionPixels / totalPixels) * 100,
      colorData: {
        redOrangeRatio: redOrangePixels / totalPixels,
        brightness: totalBrightness / totalPixels,
        flickerDetected: false,
      },
      brightnessData: {
        peakBrightness,
        brightAreaRatio: brightPixels / totalPixels,
        brightRegion: null,
      },
    };
  }

  setConfidenceThreshold(value) {
    this.confidenceThreshold = value;
  }

  togglePose() {
    this.poseEnabled = !this.poseEnabled;
    return this.poseEnabled;
  }
}
