export function noticeCanExpire(operation: { status: string; warning?: boolean }): boolean {
  return operation.status === 'succeeded' || operation.status === 'failed';
}

export const NOTICE_DISMISS_MS = 15_000;

export function createNoticeExpiry(dismiss: () => void) {
  const timer = setTimeout(dismiss, NOTICE_DISMISS_MS);
  return { dispose: () => clearTimeout(timer) };
}
