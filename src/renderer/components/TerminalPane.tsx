import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { useAppStore } from '../store/app-store';
import type { ThemeMode } from '../../shared/types';

interface Props {
  projectId: string;
  cwd: string;
  visible: boolean;
}

function xtermThemeFor(mode: ThemeMode) {
  return mode === 'light'
    ? {
        background: '#ffffff',
        foreground: '#333333',
        cursor: '#000000',
        selectionBackground: '#add6ff',
      }
    : {
        background: '#1e1e1e',
        foreground: '#cccccc',
        cursor: '#ffffff',
        selectionBackground: '#264f78',
      };
}

export function TerminalPane({ projectId, cwd, visible }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const spawnedRef = useRef(false);
  const themeMode = useAppStore((s) => s.theme);
  const multilineEnter = useAppStore((s) => s.terminalMultilineEnter);
  const copyPaste = useAppStore((s) => s.terminalCopyPaste);
  const multilineRef = useRef(multilineEnter);
  const copyPasteRef = useRef(copyPaste);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    multilineRef.current = multilineEnter;
  }, [multilineEnter]);
  useEffect(() => {
    copyPasteRef.current = copyPaste;
  }, [copyPaste]);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      fontFamily: 'Cascadia Code, Consolas, monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: xtermThemeFor(useAppStore.getState().theme),
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);
    fit.fit();

    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;

      if (multilineRef.current && e.key === 'Enter' && (e.shiftKey || e.ctrlKey)) {
        window.api.pty.write(projectId, '\n');
        return false;
      }

      if (copyPasteRef.current && e.ctrlKey && !e.shiftKey && !e.altKey) {
        if (e.key === 'c' || e.key === 'C') {
          if (term.hasSelection()) {
            const sel = term.getSelection();
            if (sel) void navigator.clipboard.writeText(sel);
            term.clearSelection();
            return false;
          }
          return true;
        }
        if (e.key === 'v' || e.key === 'V') {
          void navigator.clipboard.readText().then((txt) => {
            if (txt) window.api.pty.write(projectId, txt);
          });
          return false;
        }
      }
      return true;
    });

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

    const pending = useAppStore.getState().consumePendingCommand(projectId);
    window.api.pty
      .spawn({
        projectId,
        cwd,
        cols,
        rows,
        initialCommand: pending?.command,
        extraPath: pending?.extraPath,
      })
      .then(() => {
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

  useEffect(() => {
    const t = termRef.current;
    if (!t) return;
    t.options.theme = xtermThemeFor(themeMode);
  }, [themeMode]);

  function onContextMenu(e: React.MouseEvent) {
    if (!copyPasteRef.current) return;
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  }

  async function doCopy() {
    const sel = termRef.current?.getSelection();
    if (sel) await navigator.clipboard.writeText(sel);
    termRef.current?.clearSelection();
    setMenu(null);
  }

  async function doPaste() {
    const txt = await navigator.clipboard.readText();
    if (txt) window.api.pty.write(projectId, txt);
    setMenu(null);
  }

  return (
    <div
      ref={containerRef}
      className={`terminal-instance ${visible ? '' : 'hidden'}`}
      onContextMenu={onContextMenu}
      onClick={() => {
        if (menu) setMenu(null);
      }}
    >
      {menu && (
        <div
          className="ctx-menu"
          style={{ left: menu.x, top: menu.y, position: 'fixed' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="ctx-menu-item" onClick={() => void doCopy()}>
            Copy
          </div>
          <div className="ctx-menu-item" onClick={() => void doPaste()}>
            Paste
          </div>
        </div>
      )}
    </div>
  );
}
