import { listProjects } from './projects.ts';
import { listSessionsForProject } from './sessions.ts';
import { groupProjectTrees, collectProjectSessions } from '../shared/project-tree.ts';
import {
  reconcileSessionOrder,
  moveSessionOrder,
  promoteSessionOrder,
  removeSessionOrder,
} from './config.ts';
import type { ManagedLaunch } from './managed-session-service.ts';
import type { ArrangementItem } from '../shared/sidebar-arrangement.ts';
import { preferences } from './preferences-store.ts';

const drafts = new Map<string, ManagedLaunch>();
const cancelledKeys = new Set<string>();
const promotions = new Map<string, Promise<Awaited<ReturnType<typeof promoteSessionOrder>>>>();
export function registerSessionDraft(launch: ManagedLaunch): void {
  drafts.set(launch.launchId, launch);
}
export function forgetSessionDraft(launchId: string): void {
  drafts.delete(launchId);
  cancelledKeys.add(`draft:${launchId}`);
  if (cancelledKeys.size > 512) cancelledKeys.delete(cancelledKeys.values().next().value!);
  void (async () => {
    try {
      await promotions.get(launchId);
    } catch {
      /* Failed promotion still needs cleanup. */
    }
    await removeSessionOrder(`draft:${launchId}`);
  })().catch(() => console.warn('Could not clear closed session ordering metadata.'));
}
async function groupFor(projectId: string) {
  if (typeof projectId !== 'string' || !projectId || projectId.length > 4096)
    throw new Error('Invalid project ordering request.');
  const tree = groupProjectTrees(await listProjects(), true).find((tree) =>
    tree.projects.some((project) => project.id === projectId),
  );
  if (!tree) throw new Error('The project group is no longer available.');
  return tree;
}
async function currentItems(projectId: string) {
  const tree = await groupFor(projectId);
  const histories = Object.fromEntries(
    await Promise.all(
      tree.projects.map(
        async (project) => [project.id, await listSessionsForProject(project.id)] as const,
      ),
    ),
  );
  const items: ArrangementItem[] = collectProjectSessions(tree.projects, histories).map(
    ({ session }) => ({ key: `${session.agent}:${session.id}`, createdAt: session.createdAt }),
  );
  for (const draft of drafts.values())
    if (tree.projects.some((project) => project.id === draft.projectId) && !draft.nativeSessionId)
      items.push({ key: `draft:${draft.launchId}`, createdAt: draft.createdAt });
  return { tree, items };
}
export async function inspectSessionOrder(projectId: string) {
  await Promise.all([...promotions.values()]);
  const { tree, items } = await currentItems(projectId);
  return reconcileSessionOrder(
    tree.id,
    items.filter((item) => !cancelledKeys.has(item.key)),
  );
}
export async function moveSessionRow(
  projectId: string,
  from: string,
  to: string,
  placement: 'before' | 'after',
) {
  const { tree, items } = await currentItems(projectId);
  return moveSessionOrder(
    tree.id,
    items.filter((item) => !cancelledKeys.has(item.key)),
    from,
    to,
    placement,
  );
}
export async function promoteSessionDraft(
  launchId: string,
  projectId: string,
  sessionId: string,
  explicit = false,
) {
  const existing = promotions.get(launchId);
  if (existing) return existing;
  const operation = (async () => {
    const draft = drafts.get(launchId);
    if (
      !draft ||
      draft.projectId !== projectId ||
      (!explicit && draft.nativeSessionId !== sessionId) ||
      (draft.nativeSessionId && draft.nativeSessionId !== sessionId)
    )
      throw new Error('The session launch identity is no longer available.');
    const { tree, items } = await currentItems(projectId);
    const key = `${draft.agent}:${sessionId}`;
    if (draft.nativeSessionId === sessionId) return reconcileSessionOrder(tree.id, items);
    if (!items.some((item) => item.key === key) || drafts.get(launchId) !== draft)
      throw new Error('The native session is no longer available.');
    await reconcileSessionOrder(tree.id, [
      ...items,
      { key: `draft:${launchId}`, createdAt: draft.createdAt },
    ]);
    if (drafts.get(launchId) !== draft) throw new Error('The managed session has closed.');
    const order = await promoteSessionOrder(tree.id, `draft:${launchId}`, key);
    if (draft.sessionTitle)
      await preferences.setInitialSessionName(
        draft.agent,
        sessionId,
        draft.sessionTitle,
        () => drafts.get(launchId) === draft,
      );
    if (drafts.get(launchId) !== draft) throw new Error('The managed session has closed.');
    draft.nativeSessionId = sessionId;
    return order;
  })();
  promotions.set(launchId, operation);
  try {
    return await operation;
  } finally {
    promotions.delete(launchId);
  }
}
