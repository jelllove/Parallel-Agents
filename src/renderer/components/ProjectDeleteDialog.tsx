import { useEffect, useRef, useState } from 'react';
import type { Project } from '../../shared/types';
import { deleteMessageFor } from '../../shared/project-delete';
import './ProjectDeleteDialog.css';

export function ProjectDeleteDialog({
  projects,
  onConfirm,
  onCancel,
}: {
  projects: Project[];
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [snapshot] = useState(projects);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const ready = snapshot.length > 0;
  return (
    <dialog
      ref={dialog}
      className="workflow-dialog project-delete-dialog"
      aria-labelledby="delete-project-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (!ready || !armed || busy) return;
          setBusy(true);
          setError('');
          try {
            await onConfirm();
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            setArmed(false);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2 id="delete-project-title">
          Delete{' '}
          {snapshot.length === 1 ? 'project history' : `${snapshot.length} project histories`}?
        </h2>
        <p>Review the highlighted projects. Working folders are not deleted.</p>
        <div className="project-delete-summary">
          {snapshot.map((project) => (
            <section key={project.id}>
              <div className="project-delete-name">{project.displayName}</div>
              <div className="project-delete-path">{project.realPath}</div>
              <div className="project-delete-path">
                {project.sessionCount} session{project.sessionCount === 1 ? '' : 's'}
              </div>
              <p>{deleteMessageFor(project)}</p>
            </section>
          ))}
        </div>
        <label className="modal-check">
          <input
            type="checkbox"
            autoFocus
            checked={armed}
            disabled={!ready || busy}
            onChange={(event) => setArmed(event.target.checked)}
          />
          <span>I have reviewed these projects and understand deletion cannot be undone.</span>
        </label>
        {error && (
          <p className="inventory-error" role="alert">
            {error}
          </p>
        )}
        <div className="workflow-actions">
          <button type="button" className="btn-secondary" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn-danger" disabled={!ready || !armed || busy}>
            {busy ? 'Deleting...' : 'Delete forever'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
