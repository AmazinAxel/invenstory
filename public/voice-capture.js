// AudioWorklet for voice mode: collects mono microphone samples into ~100 ms blocks and posts
// them to the page (src/lib/voice/capture.ts). A same-origin file because the CSP allows
// script-src 'self' only (no blob: modules).

class VoiceCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const size = (options && options.processorOptions && options.processorOptions.blockSize) || 1600;
    this.buf = new Float32Array(size);
    this.n = 0;
    this.port.onmessage = (e) => {
      if (e.data === 'flush') {
        this.port.postMessage({ last: this.buf.slice(0, this.n) });
        this.n = 0;
      }
    };
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.buf.length) {
          this.port.postMessage(this.buf.slice(0));
          this.n = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('voice-capture', VoiceCapture);
