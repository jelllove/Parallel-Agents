import { create } from 'zustand';

export interface OperationResult {
  message?: string;
  projectId?: string;
  warning?: boolean;
}

export interface Operation {
  id: number;
  key: string;
  title: string;
  resources: string[];
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  warning?: boolean;
  message?: string;
  projectId?: string;
}

interface Request {
  key: string;
  title: string;
  resources?: string[];
  run: () => Promise<OperationResult | void>;
}

interface OperationState {
  operations: Operation[];
  enqueue: (request: Request) => number | null;
  dismiss: (id: number) => void;
}

export function createBackgroundOperations() {
  let nextId = 0;
  let tail = Promise.resolve();
  return create<OperationState>((set, get) => ({
    operations: [],
    enqueue({ key, title, run, resources = [key] }) {
      if (
        get().operations.some(
          (job) =>
            ['queued', 'running'].includes(job.status) &&
            (job.key === key || job.resources.some((resource) => resources.includes(resource))),
        )
      ) {
        return null;
      }
      const id = ++nextId;
      const update = (patch: Partial<Operation>) =>
        set((state) => ({
          operations: state.operations.map((job) => (job.id === id ? { ...job, ...patch } : job)),
        }));
      set((state) => ({
        operations: [
          ...state.operations,
          { id, key, title, resources: [...resources], status: 'queued' },
        ],
      }));
      tail = tail.then(async () => {
        update({ status: 'running' });
        try {
          const result = await run();
          update({ ...result, status: 'succeeded' });
        } catch (error) {
          update({
            status: 'failed',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      });
      return id;
    },
    dismiss(id) {
      set((state) => ({
        operations: state.operations.filter(
          (job) => job.id !== id || job.status === 'queued' || job.status === 'running',
        ),
      }));
    },
  }));
}

export const useBackgroundOperations = createBackgroundOperations();
