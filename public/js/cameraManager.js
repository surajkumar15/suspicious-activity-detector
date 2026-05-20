class CameraManager {
  constructor(videoElement) {
    this.video = videoElement;
    this.stream = null;
    this.isRunning = false;
  }

  async start() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'environment',
        },
        audio: true,
      });

      this.video.srcObject = this.stream;
      await this.video.play();
      this.isRunning = true;

      return {
        success: true,
        width: this.video.videoWidth,
        height: this.video.videoHeight,
      };
    } catch (error) {
      console.error('Camera access failed:', error);
      return { success: false, error: error.message };
    }
  }

  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    this.video.srcObject = null;
    this.isRunning = false;
  }

  getFrame(canvas) {
    if (!this.isRunning) return null;

    const ctx = canvas.getContext('2d');
    canvas.width = this.video.videoWidth;
    canvas.height = this.video.videoHeight;
    ctx.drawImage(this.video, 0, 0);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }

  captureSnapshot() {
    if (!this.isRunning) return null;

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = this.video.videoWidth;
    tempCanvas.height = this.video.videoHeight;
    const ctx = tempCanvas.getContext('2d');
    ctx.drawImage(this.video, 0, 0);
    return tempCanvas.toDataURL('image/jpeg', 0.7);
  }

  getAudioStream() {
    if (!this.stream) return null;
    const audioTracks = this.stream.getAudioTracks();
    if (audioTracks.length === 0) return null;
    return new MediaStream(audioTracks);
  }
}
