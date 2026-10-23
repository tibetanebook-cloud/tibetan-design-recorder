// Noise removal as an AudioWorklet (our own adaptive spectral gate).
//
// STFT: 512-point frames, hop 256, sqrt-Hann analysis and synthesis windows
// (perfect reconstruction at 50 % overlap). Per bin, a noise floor is tracked as
// the slowly-rising minimum of the smoothed power; bins near the floor are
// attenuated (down to -20 dB at amount 1). Gains open fast and close slowly so
// speech onsets are not clipped. Latency is a constant 512 samples, also at
// amount 0 (then every gain is 1 and the output equals the input).
const N = 512;
const HOP = 256;
const BINS = N / 2 + 1;

const win = new Float32Array(N);
for (let i = 0; i < N; i++) win[i] = Math.sqrt(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));

const rev = new Uint16Array(N);
for (let i = 0, bits = Math.log2(N); i < N; i++) {
  let r = 0;
  for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
  rev[i] = r;
}
const cosT = new Float32Array(N / 2);
const sinT = new Float32Array(N / 2);
for (let i = 0; i < N / 2; i++) {
  cosT[i] = Math.cos((2 * Math.PI * i) / N);
  sinT[i] = Math.sin((2 * Math.PI * i) / N);
}

/** In-place radix-2 FFT; inverse when sign = 1 (unscaled). */
function fft(re, im, sign) {
  for (let i = 0; i < N; i++) {
    const j = rev[i];
    if (j > i) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1, step = N / size;
    for (let start = 0; start < N; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = cosT[k * step], wi = sign * -sinT[k * step];
        const a = start + k, b = a + half;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
      }
    }
  }
}

class Channel {
  constructor() {
    this.inBuf = new Float32Array(N);
    this.outBuf = new Float32Array(N);
    this.fill = N - HOP; // first frame after HOP new samples
    this.outQueue = new Float32Array(N);
    this.re = new Float32Array(N);
    this.im = new Float32Array(N);
    this.smooth = new Float32Array(BINS);
    this.noise = new Float32Array(BINS).fill(1e-9);
    this.gain = new Float32Array(BINS).fill(1);
    this.frames = 0;
    this.readPos = 0;
    this.ready = new Float32Array(HOP);
    this.haveReady = false;
  }

  frame(amount) {
    const { re, im, smooth, noise, gain } = this;
    for (let i = 0; i < N; i++) {
      re[i] = this.inBuf[i] * win[i];
      im[i] = 0;
    }
    fft(re, im, -1);
    const floor = 1 - 0.9 * amount;
    this.frames++;
    for (let k = 0; k < BINS; k++) {
      const p = re[k] * re[k] + im[k] * im[k] + 1e-12;
      smooth[k] = this.frames === 1 ? p : 0.8 * smooth[k] + 0.2 * p;
      // Minimum tracking: follow drops at once, rise slowly (~1.6 dB/s).
      noise[k] = this.frames === 1 ? smooth[k] : smooth[k] < noise[k] ? smooth[k] : noise[k] * 1.002;
    }
    for (let k = 0; k < BINS; k++) {
      // Decide on a 3-bin neighbourhood: less variance, so fewer "musical noise" blips.
      const a = k > 0 ? k - 1 : k, b = k < BINS - 1 ? k + 1 : k;
      const s3 = smooth[a] + smooth[k] + smooth[b];
      const n3 = noise[a] + noise[k] + noise[b];
      // The minimum of a fluctuating power estimate sits well below its mean, hence the over-subtraction factor.
      let g = amount > 0 ? 1 - (amount * 4 * n3) / s3 : 1;
      if (g < floor) g = floor;
      if (g > 1) g = 1;
      gain[k] = g > gain[k] ? g : 0.55 * gain[k] + 0.45 * g;
      const gg = gain[k];
      re[k] *= gg; im[k] *= gg;
      if (k > 0 && k < N / 2) {
        re[N - k] = re[k];
        im[N - k] = -im[k];
      }
    }
    fft(re, im, 1);
    // Overlap-add.
    const out = this.outBuf;
    for (let i = 0; i < N; i++) out[i] += (re[i] / N) * win[i];
    this.ready.set(out.subarray(0, HOP));
    out.copyWithin(0, HOP);
    out.fill(0, N - HOP);
    this.inBuf.copyWithin(0, HOP);
  }
}

class DenoiseProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: "amount", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" }];
  }

  constructor() {
    super();
    this.channels = [];
    // Output FIFO per channel: HOP samples become available per frame.
    this.fifo = [];
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    const amount = parameters.amount[0];
    if (!input || input.length === 0) {
      for (const ch of output) ch.fill(0);
      return true;
    }
    for (let c = 0; c < output.length; c++) {
      const src = input[c] ?? input[0];
      const dst = output[c];
      if (!this.channels[c]) {
        this.channels[c] = new Channel();
        this.fifo[c] = { buf: new Float32Array(N * 2), r: 0, w: HOP }; // pre-filled silence: total latency = N
      }
      const ch = this.channels[c];
      const q = this.fifo[c];
      for (let i = 0; i < src.length; i++) {
        ch.inBuf[ch.fill++] = src[i];
        if (ch.fill === N) {
          ch.frame(amount);
          ch.fill = N - HOP;
          for (let j = 0; j < HOP; j++) {
            q.buf[q.w % q.buf.length] = ch.ready[j];
            q.w++;
          }
        }
      }
      for (let i = 0; i < dst.length; i++) {
        dst[i] = q.r < q.w ? q.buf[q.r % q.buf.length] : 0;
        if (q.r < q.w) q.r++;
      }
    }
    return true;
  }
}

registerProcessor("tdr-denoise", DenoiseProcessor);
