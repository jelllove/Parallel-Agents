import { useEffect, useRef, useState } from 'react';
import type { UpdateStatus } from '../../shared/types';

export function useUpdateStatus() {
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const active = useRef(false);
  const eventRevision = useRef(0);
  const requestId = useRef(0);
  const inFlight = useRef(false);

  async function runUpdateAction(action: 'getStatus' | 'check' | 'install') {
    if (!active.current || inFlight.current) return;
    const id = ++requestId.current;
    const revision = eventRevision.current;
    inFlight.current = true;
    setPending(true);
    setUpdateError(null);
    try {
      const status = await window.api.updates[action]();
      if (active.current && requestId.current === id && eventRevision.current === revision) {
        setUpdate(status);
      }
    } catch (error) {
      if (
        active.current &&
        requestId.current === id &&
        (action !== 'getStatus' || eventRevision.current === revision)
      ) {
        setUpdateError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (requestId.current === id) {
        inFlight.current = false;
        if (active.current) setPending(false);
      }
    }
  }

  useEffect(() => {
    active.current = true;
    const unsubscribe = window.api.updates.onStatus((status) => {
      eventRevision.current++;
      if (active.current) {
        setUpdate(status);
        setUpdateError(null);
      }
    });
    void runUpdateAction('getStatus');
    return () => {
      active.current = false;
      requestId.current++;
      inFlight.current = false;
      unsubscribe();
    };
  }, []);

  return { update, updateError, pending, runUpdateAction };
}
