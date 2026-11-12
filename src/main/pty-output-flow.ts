export interface OutputPacket {
  generation: string;
  sequence: number;
}
interface OutputSink {
  send(data: string, packet: OutputPacket): void;
  pause(): void;
  resume(): void;
}
const BATCH = 32768;
const HIGH = 262144;
const LOW = 65536;

/** Lossless bounded-in-flight delivery. Native pause controls the upstream producer. */
export class PtyOutputFlow {
  private chunks: string[] = [];
  private queued = 0;
  private inFlight = new Map<number, number>();
  private outstanding = 0;
  private sequence = 0;
  private paused = false;
  private closed = false;
  private ending = false;
  private onFinished?: () => void;
  private tail = '';
  private timer?: ReturnType<typeof setTimeout>;
  private sink: OutputSink;
  private generation: string;
  constructor(sink: OutputSink, generation: string) {
    this.sink = sink;
    this.generation = generation;
  }
  push(data: string): void {
    if (this.closed || this.ending || !data) return;
    data = this.tail + data;
    this.tail = '';
    if (/[\uD800-\uDBFF]$/.test(data)) {
      this.tail = data.slice(-1);
      data = data.slice(0, -1);
    }
    this.chunks.push(data);
    this.queued += data.length;
    this.pressure();
    if (!this.timer)
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.flush();
      }, 8);
  }
  private pressure(): void {
    const pending = this.queued + this.outstanding;
    if (!this.paused && pending >= HIGH) {
      this.paused = true;
      this.sink.pause();
    } else if (this.paused && pending <= LOW) {
      this.paused = false;
      this.sink.resume();
    }
  }
  private flush(): void {
    if (this.closed) return;
    let data = this.chunks.join('');
    this.chunks = [];
    this.queued = 0;
    while (data && this.outstanding < HIGH) {
      let size = Math.min(BATCH, data.length, HIGH - this.outstanding);
      // Do not split a UTF-16 surrogate pair between IPC messages.
      if (size < data.length && /[\uD800-\uDBFF]/.test(data[size - 1])) size--;
      if (!size) break;
      const chunk = data.slice(0, size);
      data = data.slice(size);
      const sequence = ++this.sequence;
      this.inFlight.set(sequence, chunk.length);
      this.outstanding += chunk.length;
      this.sink.send(chunk, { generation: this.generation, sequence });
    }
    if (data) {
      this.chunks.push(data);
      this.queued = data.length;
    }
    this.pressure();
    if (this.ending && !this.queued) {
      const finished = this.onFinished;
      this.onFinished = undefined;
      finished?.();
    }
  }
  acknowledge(generation: string, sequence: number): void {
    if (this.closed || generation !== this.generation || !Number.isSafeInteger(sequence)) return;
    const size = this.inFlight.get(sequence);
    if (size === undefined) return;
    this.inFlight.delete(sequence);
    this.outstanding -= size;
    // Normal acknowledgements must not defeat the batching timer. Only pressure-blocked
    // batches need immediate draining; otherwise high-volume output reverts to one IPC/chunk.
    if (!this.timer) this.flush();
    this.pressure();
  }
  finish(onFinished?: () => void): void {
    if (this.closed || this.ending) return;
    this.ending = true;
    this.onFinished = onFinished;
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.tail) {
      this.chunks.push(this.tail);
      this.queued += this.tail.length;
      this.tail = '';
    }
    this.flush();
  }
  dispose(): void {
    this.closed = true;
    clearTimeout(this.timer);
    this.chunks = [];
    this.tail = '';
    this.inFlight.clear();
    this.queued = 0;
    this.outstanding = 0;
    this.onFinished = undefined;
    if (this.paused) {
      this.paused = false;
      this.sink.resume();
    }
  }
}
