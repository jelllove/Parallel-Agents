import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';

interface Props {
  projectId: string;
  cwd: string;
  visible: boolean;
  initialCommand?: string;
}

export function TerminalPane({ projectId, cwd, visible, initialCommand }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const spawnedRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      fontFamily: 'Cascadia Code, Consolas, monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: {
        background: '#1e1e1e',
        foreground: '#cccccc',
        cursor: '#ffffff',
        selectionBackground: '#264f78',
      },
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;

    const { cols, rows } = term;
    const offData = window.api.pty.onData((pid, data) => {
      if (pid === projectId) term.write(data);
    });
    const offExit = window.api.pty.onExit((pid) => {
      if (pid === projectId) {
        term.write('\r\n\x1b[33m[process exited]\x1b[0m\r\n');
        spawnedRef.current = false;
      }
    });

    term.onData((data) => {
      window.api.pty.write(projectId, data);
    });

    window.api.pty.spawn({ projectId, cwd, cols, rows, initialCommand }).then(() => {
      spawnedRef.current = true;
    });

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        const { cols, rows } = term;
        window.api.pty.resize(projectId, cols, rows);
      } catch {}
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      offData();
      offExit();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [projectId, cwd]);

  useEffect(() => {
    if (visible && fitRef.current && termRef.current) {
      // Defer to next frame so layout settles after class toggle.
      requestAnimationFrame(() => {
        try {
          fitRef.current!.fit();
          const t = termRef.current!;
          window.api.pty.resize(projectId, t.cols, t.rows);
          t.focus();
        } catch {}
      });
    }
  }, [visible, projectId]);

  return <div ref={containerRef} className={`terminal-instance ${visible ? '' : 'hidden'}`} />;
}
