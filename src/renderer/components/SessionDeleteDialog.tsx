import { useEffect, useRef, useState } from 'react';
import type { ProjectSession } from '../../shared/project-tree';
import type { SessionDeletionPreview } from '../../shared/session-deletion';
import { ConfirmDialog } from './ConfirmDialog';
import { queueReviewedSessionDeletion } from '../store/session-deletion';

export function SessionDeleteDialog({
  targets,
  onAccepted,
  onCancel,
}: {
  targets: ProjectSession[];
  onAccepted: () => void;
  onCancel: () => void;
}) {
  const [snapshot] = useState(targets);
  const [preview, setPreview] = useState<SessionDeletionPreview | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const accepted = useRef(false);
  useEffect(() => {
    let active = true;
    let token: string | undefined;
    void window.api.sessions
      .previewDeletion(
        snapshot.map(({ project, session }) => ({ projectId: project.id, sessionId: session.id })),
      )
      .then((result) => {
        token = result.token;
        if (active) setPreview(result);
        else void window.api.sessions.cancelDeletion(token).catch(() => {});
      })
      .catch((error) => {
        if (active) setError(String(error));
      });
    return () => {
      active = false;
      if (token && !accepted.current)
        void window.api.sessions.cancelDeletion(token).catch(() => {});
    };
  }, [snapshot]);
  const included = [
    ...(preview?.sessions ?? []),
    ...(preview?.worktrees
      .filter((item) => selected.includes(item.key))
      .flatMap((item) => item.additional) ?? []),
  ];
  const unique = included.filter(
    (item, index, list) =>
      list.findIndex(
        (other) => other.agent === item.agent && other.sessionId === item.sessionId,
      ) === index,
  );
  return (
    <ConfirmDialog
      key={revision}
      title={
        targets.length === 1
          ? 'Delete session?'
          : `Delete ${unique.length || targets.length} sessions?`
      }
      message={
        <>
          <p>
            This permanently deletes the reviewed session histories. Their open tabs and terminals
            will close. Working folders are kept unless explicitly selected below.
          </p>
          {!preview && !error && <p role="status">Loading deletion review…</p>}
          {preview?.cleanupWarning && (
            <p role="alert">{preview.cleanupWarning} Session history can still be deleted.</p>
          )}
          <ul className="session-delete-review" aria-label="Sessions to delete">
            {unique.map((item) => (
              <li key={`${item.agent}:${item.sessionId}`}>
                <strong>{item.title || '(empty)'}</strong>
                <div>
                  {item.agent} · {item.cwd}
                </div>
              </li>
            ))}
          </ul>
          {preview?.worktrees.map((worktree) => (
            <section key={worktree.key}>
              <label className="modal-check">
                <input
                  type="checkbox"
                  checked={selected.includes(worktree.key)}
                  disabled={Boolean(worktree.blocked)}
                  onChange={(event) => {
                    setSelected((keys) =>
                      event.target.checked
                        ? [...keys, worktree.key]
                        : keys.filter((key) => key !== worktree.key),
                    );
                    setRevision((value) => value + 1);
                  }}
                />
                <span>
                  Also remove Git worktree: {worktree.path} ({worktree.branch ?? 'detached HEAD'})
                </span>
              </label>
              {worktree.blocked && <p>{worktree.blocked}</p>}
              {worktree.additional.length > 0 && (
                <div>
                  <p>
                    This checkout also contains the sessions below. Checking this option explicitly
                    agrees to delete them too; leave it unchecked to delete only the original
                    selection and keep the worktree.
                  </p>
                  <ul>
                    {worktree.additional.map((item) => (
                      <li key={`${item.agent}:${item.sessionId}`}>
                        {item.title} · {item.agent} · {item.cwd}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          ))}
          {preview?.worktrees.length ? (
            <p>
              Branches are retained. Dirty/locked worktrees or other open terminals prevent removal.
              External terminals cannot be detected reliably; close them first.
            </p>
          ) : null}
        </>
      }
      confirmText="Delete forever"
      destructive
      confirmDisabled={!preview || Boolean(error)}
      warning={error}
      onConfirm={() => {
        if (!preview) return;
        if (queueReviewedSessionDeletion(preview, selected) === null) {
          setError('A selected session or worktree already has a pending deletion.');
          return;
        }
        accepted.current = true;
        onAccepted();
      }}
      onCancel={onCancel}
    />
  );
}
