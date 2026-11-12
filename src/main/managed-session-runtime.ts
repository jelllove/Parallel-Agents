import { realpath } from 'node:fs/promises';
import { activityRuntime } from './activity-service.ts';
import { listSessionsForProject } from './sessions.ts';
import { ManagedSessionService } from './managed-session-service.ts';
import {
  registerSessionDraft,
  forgetSessionDraft,
  promoteSessionDraft,
} from './session-arrangement-service.ts';

export const managedSessions = new ManagedSessionService({
  onRegister: registerSessionDraft,
  onCancel: forgetSessionDraft,
  onBound: async (launchId, projectId, sessionId) => {
    await promoteSessionDraft(launchId, projectId, sessionId, true);
  },
  activity: () => activityRuntime.snapshot().records,
  list: (projectId) => listSessionsForProject(projectId, true),
  async samePath(left, right) {
    const paths = await Promise.all([realpath(left), realpath(right)]);
    return process.platform === 'win32'
      ? paths[0].toLowerCase() === paths[1].toLowerCase()
      : paths[0] === paths[1];
  },
});
