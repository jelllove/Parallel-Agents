import { useEffect, useRef, useState } from 'react';
import type { ProjectSession } from '../../shared/project-tree';
import { pathKey } from '../../shared/project-tree';
import type { SessionDeletionPreview, WorktreeReview } from '../../shared/session-deletion';
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
  const [armed, setArmed] = useState(false);
  const [cleanupRequested, setCleanupRequested] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const accepted = useRef(false);
  const requestedPath = useRef('');
  useEffect(() => {
    let active = true;
    let token: string | undefined;
    void window.api.sessions
      .previewDeletion(
        snapshot.map(({ project, session }) => ({ projectId: project.id, sessionId: session.id })),
        cleanupRequested,
      )
      .then((result) => {
        token = result.token;
        if (active) {
          setPreview(result);
          setLoading(false);
          // A directory choice may be retained only if it adds no unreviewed histories.
          // Otherwise display the additional identities first and require a second explicit click.
          setSelected(
            result.worktrees
              .filter(
                (item) =>
                  pathKey(item.path) === requestedPath.current &&
                  !item.blocked &&
                  !item.additional.length,
              )
              .map((item) => item.key),
          );
        } else void window.api.sessions.cancelDeletion(token).catch(() => {});
      })
      .catch((error) => {
        if (active) {
          setError(String(error));
          setLoading(false);
        }
      });
    return () => {
      active = false;
      if (token && !accepted.current)
        void window.api.sessions.cancelDeletion(token).catch(() => {});
    };
  }, [snapshot, cleanupRequested]);
  const included = [
    ...(preview?.sessions ??
      snapshot.map(({ project, session }) => ({
        projectId: project.id,
        sessionId: session.id,
        agent: session.agent,
        title: session.title,
        cwd: session.cwd ?? project.realPath,
      }))),
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
  // Existing sidebar metadata is a display hint, never authorization to remove a checkout.
  const hints: WorktreeReview[] = snapshot
    .filter(({ project }) => project.worktree)
    .map(({ project }) => ({
      key: pathKey(project.realPath),
      path: project.realPath,
      branch: project.worktree!.branch,
      additional: [],
    }));
  const worktrees =
    cleanupRequested && !loading
      ? (preview?.worktrees ?? [])
      : hints.filter(
          (item, index, list) => list.findIndex((other) => other.key === item.key) === index,
        );
  return (
    <ConfirmDialog
      title={
        snapshot.length === 1
          ? 'Delete session?'
          : `Delete ${unique.length || snapshot.length} sessions?`
      }
      armed={armed}
      onArmedChange={setArmed}
      message={
        <>
          <p>
            This permanently deletes the reviewed session histories. Their open tabs and terminals
            will close. Working folders are kept unless explicitly selected below.
          </p>
          {loading && (
            <p role="status">
              {cleanupRequested ? 'Reviewing worktree removal…' : 'Verifying selected sessions…'}
            </p>
          )}
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
          {worktrees.map((worktree) => (
            <section key={worktree.key}>
              <label className="modal-check">
                <input
                  type="checkbox"
                  checked={selected.includes(worktree.key)}
                  disabled={!armed || loading || Boolean(error) || Boolean(worktree.blocked)}
                  onChange={(event) => {
                    if (!armed || loading) return;
                    if (!cleanupRequested) {
                      requestedPath.current = pathKey(worktree.path);
                      setLoading(true);
                      setCleanupRequested(true);
                      return;
                    }
                    setSelected((keys) =>
                      event.target.checked
                        ? [...keys, worktree.key]
                        : keys.filter((key) => key !== worktree.key),
                    );
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
          {worktrees.length ? (
            <p>
              Check “I understand” below to enable optional worktree removal. Branches are retained.
              Dirty/locked worktrees or other open terminals prevent removal. External terminals
              cannot be detected reliably; close them first.
            </p>
          ) : null}
          {cleanupRequested && error && (
            <button
              className="btn-secondary"
              onClick={() => {
                setSelected([]);
                setError('');
                setLoading(true);
                setCleanupRequested(false);
              }}
            >
              Keep folder and review history only
            </button>
          )}
        </>
      }
      confirmText="Delete forever"
      destructive
      confirmDisabled={!preview || loading || Boolean(error)}
      warning={error}
      onConfirm={() => {
        if (!armed || !preview || loading || error) return;
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
