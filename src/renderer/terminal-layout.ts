interface LayoutOptions {
  frame(callback: () => void): number;
  cancel(id: number): void;
  visible(): boolean;
  fit(): { cols: number; rows: number };
  resize(cols: number, rows: number): void;
}
export function createTerminalLayout(options: LayoutOptions) {
  let frame: number | null = null;
  let size = '';
  let closed = false;
  return {
    schedule() {
      if (closed || frame !== null || !options.visible()) return;
      frame = options.frame(() => {
        frame = null;
        if (closed || !options.visible()) return;
        const { cols, rows } = options.fit();
        const next = `${cols}:${rows}`;
        if (next !== size) {
          size = next;
          options.resize(cols, rows);
        }
      });
    },
    dispose() {
      closed = true;
      if (frame !== null) options.cancel(frame);
    },
  };
}
