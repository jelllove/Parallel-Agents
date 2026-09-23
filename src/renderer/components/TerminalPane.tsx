import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { useAppStore } from '../store/app-store';
import type { AgentId, ThemeMode } from '../../shared/types';
import { formatPastedPaths } from '../../shared/terminal-paste';
import { createActivityTracker, type SessionActivity } from '../../shared/session-activity';
import type { SessionShellProfile } from '../../shared/session-terminals';
import { resolveFontFamily } from '../../shared/typography';

interface Props {
  terminalKey: string;
  cwd: string;
  visible: boolean;
  initialCommand?: string;
  extraPath?: string[];
  shellProfile?: SessionShellProfile;
  agent?: AgentId;
  onActivity?: (state: SessionActivity | null) => void;
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

export function TerminalPane({
  terminalKey,
  cwd,
  visible,
  initialCommand,
  extraPath,
  shellProfile,
  agent,
  onActivity,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const spawnedRef = useRef(false);
  const themeMode = useAppStore((s) => s.theme);
  const multilineEnter = useAppStore((s) => s.terminalMultilineEnter);
  const copyPaste = useAppStore((s) => s.terminalCopyPaste);
  const fontSize = useAppStore((s) => s.fontSize);
  const fontFamily = useAppStore((s) => s.fontFamily);
  const fontBold = useAppStore((s) => s.fontBold);
  const multilineRef = useRef(multilineEnter);
  const copyPasteRef = useRef(copyPaste);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const agentRef = useRef(agent);
  agentRef.current = agent;
  const onActivityRef = useRef(onActivity);
  onActivityRef.current = onActivity;

  // Resolves to true when the key event should pass through to the agent unchanged.
  async function pasteClipboard(): Promise<boolean> {
    const current = agentRef.current;
    if (current) {
      const result = await window.api.clipboard.resolvePaste(current);
      if (result.kind === 'native') return true;
      if (result.kind === 'paths') {
        window.api.pty.write(terminalKey, formatPastedPaths(result.paths));
        return false;
      }
    }
    const txt = await navigator.clipboard.readText();
    if (txt) window.api.pty.write(terminalKey, txt);
    return false;
  }

  useEffect(() => {
    multilineRef.current = multilineEnter;
  }, [multilineEnter]);
  useEffect(() => {
    copyPasteRef.current = copyPaste;
  }, [copyPaste]);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      fontFamily: resolveFontFamily(useAppStore.getState().fontFamily),
      fontSize: useAppStore.getState().fontSize,
      fontWeight: useAppStore.getState().fontBold ? 700 : 400,
      fontWeightBold: 700,
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
        window.api.pty.write(terminalKey, '\n');
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
          void pasteClipboard().then((passThrough) => {
            // Copilot reads images itself on its own Ctrl+V byte.
            if (passThrough) window.api.pty.write(terminalKey, '');
          });
          return false;
        }
      }
      return true;
    });

    termRef.current = term;
    fitRef.current = fit;

    const activity = createActivityTracker<number>({
      now: () => Date.now(),
      setTimer: (fn, ms) => window.setTimeout(fn, ms),
      clearTimer: (timer) => window.clearTimeout(timer),
      onChange: (_key, state) => onActivityRef.current?.(state),
    });

    const { cols, rows } = term;
    const offData = window.api.pty.onData((pid, data) => {
      if (pid !== terminalKey) return;
      term.write(data);
      if (onActivityRef.current) activity.output(terminalKey, data);
    });
    const offExit = window.api.pty.onExit((pid) => {
      if (pid === terminalKey) {
        activity.exit(terminalKey);
        term.write('\r\n\x1b[33m[process exited]\x1b[0m\r\n');
        spawnedRef.current = false;
      }
    });

    term.onData((data) => {
      window.api.pty.write(terminalKey, data);
      if (data.includes('\r')) activity.input(terminalKey);
    });

    window.api.pty
      .spawn({
        projectId: terminalKey,
        cwd,
        cols,
        rows,
        initialCommand,
        extraPath,
        shellProfile,
      })
      .then(() => {
        spawnedRef.current = true;
      })
      .catch((error) => {
        term.write(
          `\r\n[Failed to start terminal: ${error instanceof Error ? error.message : String(error)}]\r\n`,
        );
      });

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        const { cols, rows } = term;
        window.api.pty.resize(terminalKey, cols, rows);
      } catch {}
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      offData();
      offExit();
      activity.exit(terminalKey);
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [terminalKey, cwd]);

  useEffect(() => {
    if (visible && fitRef.current && termRef.current) {
      requestAnimationFrame(() => {
        try {
          fitRef.current!.fit();
          const t = termRef.current!;
          window.api.pty.resize(terminalKey, t.cols, t.rows);
          t.focus();
        } catch {}
      });
    }
  }, [visible, terminalKey]);

  useEffect(() => {
    const t = termRef.current;
    if (!t) return;
    t.options.theme = xtermThemeFor(themeMode);
  }, [themeMode]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontSize = fontSize;
    term.options.fontFamily = resolveFontFamily(fontFamily);
    term.options.fontWeight = fontBold ? 700 : 400;
    if (visible) {
      fitRef.current?.fit();
      void window.api.pty.resize(terminalKey, term.cols, term.rows);
    }
  }, [fontSize, fontFamily, fontBold, visible, terminalKey]);

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
    setMenu(null);
    if (await pasteClipboard()) window.api.pty.write(terminalKey, '');
  }

  function onDrop(e: React.DragEvent) {
    const paths = [...e.dataTransfer.files]
      .map((f) => window.api.fs.pathForFile(f))
      .filter(Boolean);
    if (paths.length === 0) return;
    e.preventDefault();
    window.api.pty.write(terminalKey, formatPastedPaths(paths));
    termRef.current?.focus();
  }

  return (
    <div
      ref={containerRef}
      className={`terminal-instance ${visible ? '' : 'hidden'}`}
      onContextMenu={onContextMenu}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault();
      }}
      onDrop={onDrop}
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
