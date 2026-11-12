import { useCallback, useEffect, useRef, useState } from 'react';
import type { Project } from '../../shared/types';
import type { SidebarSessionRow } from '../../shared/managed-session';
import type { SessionArrangement } from '../../shared/sidebar-arrangement';
import { compareCreated } from '../../shared/sidebar-arrangement';
import { useAppStore } from '../store/app-store';

export const sessionRowKey = (
  row: SidebarSessionRow,
  launches: Record<string, { launchId: string }>,
) =>
  row.kind === 'history'
    ? `${row.session.agent}:${row.session.id}`
    : `draft:${launches[row.tabId].launchId}`;

export function useSessionOrder(
  projects: Project[],
  rows: SidebarSessionRow[],
  launches: Record<string, { launchId: string }>,
) {
  const [saved, setSaved] = useState<SessionArrangement | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const version = useRef(0);
  const busy = useRef(false);
  const projectId = projects[0]?.id;
  const signature = JSON.stringify(rows.map((row) => sessionRowKey(row, launches)).sort());
  const reload = useCallback(async () => {
    if (!projectId) return;
    const request = ++version.current;
    try {
      const order = await window.api.sessions.order(projectId);
      if (request === version.current) {
        setSaved(order);
        setError('');
      }
    } catch (error) {
      if (request === version.current)
        setError(
          `Could not load session positions: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
  }, [projectId]);
  useEffect(() => {
    setSaved(null);
  }, [projectId]);
  useEffect(() => {
    void reload();
    return () => {
      version.current++;
    };
  }, [reload, signature]);
  useEffect(() => {
    if (!saved || error || !rows.some((row) => !saved.ids.includes(sessionRowKey(row, launches))))
      return;
    const timer = window.setTimeout(() => {
      void reload();
    }, 500);
    return () => window.clearTimeout(timer);
  }, [saved, signature, error, reload, rows, launches]);
  const move = async (from: string, to: string, placement: 'before' | 'after') => {
    if (!projectId || busy.current) return;
    busy.current = true;
    setSaving(true);
    const request = ++version.current;
    try {
      const order = await window.api.sessions.move(projectId, from, to, placement);
      if (request === version.current) {
        setSaved(order);
        setError('');
      } else void reload();
    } catch (error) {
      setError(
        `Could not save session positions: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };
  const ranks = new Map(saved?.ids.map((key, index) => [key, index]) ?? []);
  const tab = useAppStore.getState();
  for (const [tabId, launch] of Object.entries(launches)) {
    const sessionId = tab.tabSessionId[tabId];
    const rank = ranks.get(`draft:${launch.launchId}`);
    const key = `${tab.tabAgent[tabId]}:${sessionId}`;
    if (sessionId && rank !== undefined && !ranks.has(key)) ranks.set(key, rank);
  }
  const ordered = [...rows].sort((a, b) => {
    const ak = sessionRowKey(a, launches),
      bk = sessionRowKey(b, launches);
    const ai = ranks.get(ak) ?? -1,
      bi = ranks.get(bk) ?? -1;
    if (ai >= 0 || bi >= 0) return (ai < 0 ? Infinity : ai) - (bi < 0 ? Infinity : bi);
    return compareCreated(
      {
        key: ak,
        createdAt: a.kind === 'draft' ? a.createdAt : (a.session.createdAt ?? a.session.timestamp),
      },
      {
        key: bk,
        createdAt: b.kind === 'draft' ? b.createdAt : (b.session.createdAt ?? b.session.timestamp),
      },
    );
  });
  return { ordered, move, error, reload, saving, loaded: saved !== null };
}
