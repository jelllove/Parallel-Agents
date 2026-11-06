import { useBackgroundOperations } from '../store/background-operations';
import { useAppStore } from '../store/app-store';

export function OperationNotices() {
  const operations = useBackgroundOperations((state) => state.operations);
  const dismiss = useBackgroundOperations((state) => state.dismiss);
  return (
    <aside className="operation-notices" aria-label="Background operations">
      {operations.map((operation) => {
        const pending = operation.status === 'queued' || operation.status === 'running';
        return (
          <section
            key={operation.id}
            className={`operation-notice ${operation.status}${operation.warning ? ' warning' : ''}`}
          >
            <div role={operation.status === 'failed' || operation.warning ? 'alert' : 'status'}>
              <strong>{operation.title}</strong>
              <p>
                {operation.status === 'queued'
                  ? 'Queued…'
                  : operation.status === 'running'
                    ? 'Working in the background…'
                    : operation.message || 'Completed.'}
              </p>
            </div>
            {!pending && (
              <div className="operation-actions">
                {operation.projectId && (
                  <button
                    className="btn-secondary"
                    onClick={() => {
                      const projectId = operation.projectId!;
                      useBackgroundOperations.getState().enqueue({
                        key: `open:${projectId}`,
                        title: 'Open project',
                        run: async () => {
                          await useAppStore.getState().openProjectFromList(projectId);
                        },
                      });
                    }}
                  >
                    Open project
                  </button>
                )}
                <button
                  className="btn-secondary"
                  aria-label={`Dismiss ${operation.title}`}
                  onClick={() => dismiss(operation.id)}
                >
                  Dismiss
                </button>
              </div>
            )}
          </section>
        );
      })}
    </aside>
  );
}
