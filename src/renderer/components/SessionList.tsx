import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../store/app-store';
import { resumeCommandFor } from '../icons/agentIcons';
import { ConfirmDialog } from './ConfirmDialog';
import type { Session } from '../../shared/types';
import { RenameSessionDialog } from './RenameSessionDialog';
import { ActionIcon } from './ActionIcon';
import { sortBy } from '../../shared/sorting';
import { ActivityBadge } from './ActivityBadge';
import { sessionActivity } from '../../shared/activity-rollup';

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diff = (now.getTime() - ts) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString();
}

export function SessionList() {
  const selectedId = useAppStore((s) => s.selectedProjectId);
  const rawSessions = useAppStore((s) => (selectedId ? s.sessions[selectedId] : undefined));
  const sortKey = useAppStore((s) => s.sortOrders.sessions);
  const sessions = useMemo(
    () =>
      sortBy(rawSessions ?? [], sortKey, {
        name: (x) => x.title,
        created: (x) => x.timestamp,
        modified: (x) => x.modifiedAt ?? x.timestamp,
      }),
    [rawSessions, sortKey],
  );
  const openSessionTab = useAppStore((s) => s.openSessionTab);
  const project = useAppStore((s) => s.projects.find((p) => p.id === selectedId));
  const deleteSession = useAppStore((s) => s.deleteSession);
  const tabActivity = useAppStore((s) => s.tabActivity);
  const tabProjectId = useAppStore((s) => s.tabProjectId);
  const tabSessionId = useAppStore((s) => s.tabSessionId);

  // A session belongs to a worktree when its cwd is inside one of the project's worktree folders.
  function worktreeFolderOf(s: Session): { name: string; path: string } | null {
    if (!s.cwd || !project?.worktrees?.length) return null;
    const norm = (p: string) =>
      p
        .replace(/[\\/]+/g, '/')
        .replace(/\/$/, '')
        .toLowerCase();
    const cwd = norm(s.cwd);
    const match = project.worktrees.find((wt) => {
      const root = norm(wt.realPath);
      return cwd === root || cwd.startsWith(`${root}/`);
    });
    if (!match) return null;
    const name = match.realPath.split(/[\\/]/).filter(Boolean).pop() ?? match.realPath;
    return { name, path: match.realPath };
  }

  function sessionFolder(s: Session): string | null {
    return s.cwd || project?.realPath || null;
  }

  const [confirmDelete, setConfirmDelete] = useState<Session | null>(null);
  const [rename, setRename] = useState<Session | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; session: Session } | null>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('click', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', onKey);
    document.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', close, true);
    };
  }, [menu]);

  if (!selectedId) {
    return (
      <div className="list-item-sub" style={{ padding: '4px 12px' }}>
        Select a project to view its sessions.
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="list-item-sub" style={{ padding: '4px 12px' }}>
        No sessions yet.
      </div>
    );
  }

  async function resume(s: Session) {
    if (!project || !project.exists) return;
    const cmd = resumeCommandFor(s.agent, s.id);
    if (!cmd) return;
    await openSessionTab(project.id, s);
  }

  return (
    <div>
      {sessions.map((s) => {
        const cmd = resumeCommandFor(s.agent, s.id);
        const worktree = worktreeFolderOf(s);
        const folder = sessionFolder(s);
        return (
          <div
            key={s.id}
            className={`list-item session-item${cmd ? '' : ' disabled'}`}
            onClick={() => resume(s)}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setMenu({ x: e.clientX, y: e.clientY, session: s });
            }}
            title={cmd ? `${s.title}\n${cmd}` : `${s.title}\n(no resume available for ${s.agent})`}
          >
            <span className="session-marker" aria-hidden="true" />
            <div className="session-text">
              <div className="list-item-title">
                {s.title || '(empty)'}
                <ActivityBadge
                  state={sessionActivity(
                    s.projectId,
                    s.id,
                    tabProjectId,
                    tabSessionId,
                    tabActivity,
                  )}
                />
              </div>
              <div className="list-item-sub">
                {formatTime(s.timestamp)}
                {worktree && (
                  <span className="session-worktree" title={`Worktree: ${worktree.path}`}>
                    ↳ {worktree.name}
                  </span>
                )}
              </div>
              {folder && (
                <div className="list-item-sub session-folder" title={folder}>
                  {folder}
                </div>
              )}
            </div>
            <div className="session-actions">
              <button
                className="session-rename"
                title="Rename session"
                aria-label={`Rename ${s.title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setRename(s);
                }}
              >
                <ActionIcon name="rename" />
              </button>
              <button
                className="session-delete"
                title="Delete this session"
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmDelete(s);
                }}
              >
                ×
              </button>
            </div>
          </div>
        );
      })}
      {menu && (
        <div
          className="ctx-menu"
          role="menu"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="ctx-menu-item"
            role="menuitem"
            onClick={() => {
              setRename(menu.session);
              setMenu(null);
            }}
          >
            Rename...
          </div>
          {sessionFolder(menu.session) && (
            <>
              <div className="ctx-menu-divider" />
              <div
                className="ctx-menu-item"
                role="menuitem"
                onClick={() => {
                  void navigator.clipboard.writeText(sessionFolder(menu.session)!);
                  setMenu(null);
                }}
              >
                Copy folder path
              </div>
              <div
                className="ctx-menu-item"
                role="menuitem"
                onClick={() => {
                  void window.api.fs.openDefault(sessionFolder(menu.session)!);
                  setMenu(null);
                }}
              >
                Open folder in File Explorer
              </div>
            </>
          )}
          <div className="ctx-menu-divider" />
          <div
            className="ctx-menu-item danger"
            role="menuitem"
            onClick={() => {
              setConfirmDelete(menu.session);
              setMenu(null);
            }}
          >
            Delete...
          </div>
        </div>
      )}
      {rename && (
        <RenameSessionDialog
          projectId={rename.projectId}
          sessionId={rename.id}
          title={rename.title}
          onClose={() => setRename(null)}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title="Delete session?"
          message={`This will permanently delete the session file for "${confirmDelete.title || '(empty)'}". This cannot be undone.`}
          confirmText="Delete forever"
          destructive
          onConfirm={async () => {
            const s = confirmDelete;
            setConfirmDelete(null);
            if (selectedId) await deleteSession(selectedId, s.id);
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
