// Minimal H.264 (Annex B) player on WebCodecs: splits a raw byte stream into NAL units, feeds access units to a VideoDecoder
// and draws each decoded frame on a canvas. Built for `adb exec-out screenrecord --output-format=h264`, which writes one frame
// per write, starts with SPS/PPS and sends a key frame at the start and then on demand.

const H264_SUPPORTED = typeof VideoDecoder === 'function' && typeof EncodedVideoChunk === 'function';

class H264Player {
  constructor(canvas, { onFrame, onError } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onFrame = onFrame || (() => {});
    this.onError = onError || (() => {});
    this.buf = new Uint8Array(0);
    this.pending = []; // parameter sets and SEI waiting for the picture that follows them
    this.decoder = null;
    this.configured = false;
    this.needKey = true;
    this.t = 0;
    this.flushTimer = null;
    this.frames = 0;
    this.closed = false;
  }

  // Bytes of a NAL unit including its 4-byte start code.
  static unit(nal) {
    const out = new Uint8Array(nal.length + 4);
    out.set([0, 0, 0, 1]);
    out.set(nal, 4);
    return out;
  }

  push(chunk) {
    if (this.closed) return;
    const u8 = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    const merged = new Uint8Array(this.buf.length + u8.length);
    merged.set(this.buf);
    merged.set(u8, this.buf.length);
    this.buf = merged;
    this.scan(false);
    clearTimeout(this.flushTimer);
    // A picture is only known to be complete when the next start code shows up; on a still screen that can take a while,
    // so a short silence also counts as the end.
    this.flushTimer = setTimeout(() => this.scan(true), 40);
  }

  // Start offsets of 00 00 01 start codes in the buffer.
  starts() {
    const b = this.buf, out = [];
    for (let i = 0; i + 2 < b.length; i++) if (b[i] === 0 && b[i + 1] === 0 && b[i + 2] === 1) { out.push(i); i += 2; }
    return out;
  }

  scan(flushTail) {
    const starts = this.starts();
    if (!starts.length) { if (this.buf.length > 1 << 20) this.buf = new Uint8Array(0); return; }
    const nals = [];
    for (let i = 0; i < starts.length; i++) {
      const from = starts[i] + 3;
      const last = i + 1 === starts.length;
      if (last && !flushTail) break; // may still be growing
      let to = last ? this.buf.length : starts[i + 1];
      while (to > from && this.buf[to - 1] === 0) to--; // zero bytes belong to the next 4-byte start code
      if (to > from) nals.push(this.buf.subarray(from, to));
    }
    const consumed = flushTail ? this.buf.length : starts[starts.length - 1];
    const rest = this.buf.slice(consumed);
    for (const nal of nals) this.handle(nal);
    this.buf = rest;
  }

  handle(nal) {
    const type = nal[0] & 0x1f;
    if (type === 7 || type === 8 || type === 6 || type === 9) { // SPS, PPS, SEI, AUD
      if (type === 7) this.pending = this.pending.filter((p) => (p[0] & 0x1f) !== 7);
      if (type === 8) this.pending = this.pending.filter((p) => (p[0] & 0x1f) !== 8);
      if (type !== 9) this.pending.push(nal.slice());
      if (type === 7 && !this.configured) this.configure(nal);
      return;
    }
    if (type !== 1 && type !== 5) return;
    const key = type === 5;
    if (!this.decoder || this.decoder.state === 'closed') return;
    if (this.needKey && !key) return; // cannot start in the middle of a group of pictures
    const parts = [...this.pending, nal];
    this.pending = [];
    const total = parts.reduce((n, p) => n + p.length + 4, 0);
    const data = new Uint8Array(total);
    let at = 0;
    for (const p of parts) { data.set(H264Player.unit(p), at); at += p.length + 4; }
    try {
      this.decoder.decode(new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp: (this.t += 16667), data }));
      if (key) this.needKey = false;
    } catch (e) { this.fail(e); }
  }

  configure(sps) {
    const hex = (n) => n.toString(16).padStart(2, '0');
    const codec = `avc1.${hex(sps[1])}${hex(sps[2])}${hex(sps[3])}`;
    this.decoder = new VideoDecoder({
      output: (frame) => {
        if (this.closed) { frame.close(); return; }
        const w = frame.displayWidth, h = frame.displayHeight;
        if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
        this.ctx.drawImage(frame, 0, 0);
        frame.close();
        this.frames++;
        this.onFrame(w, h);
      },
      error: (e) => this.fail(e),
    });
    try {
      this.decoder.configure({ codec, optimizeForLatency: true, avc: { format: 'annexb' } });
      this.configured = true;
    } catch (e) { this.fail(e); }
  }

  fail(e) {
    this.onError(e);
    // A broken picture is not fatal: start over from the next key frame.
    try { this.decoder?.close(); } catch {}
    this.decoder = null; this.configured = false; this.needKey = true;
  }

  close() {
    this.closed = true;
    clearTimeout(this.flushTimer);
    try { this.decoder?.close(); } catch {}
    this.decoder = null;
  }
}
