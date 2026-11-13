/** Renderer/provider text may open web pages, never arbitrary OS protocol handlers. */
export function isExternalWebUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) return false;
  if ([...value].some((char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127))
    return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export async function openExternalWebUrl(
  url: unknown,
  open: (url: string) => Promise<void>,
): Promise<void> {
  if (!isExternalWebUrl(url)) throw new Error('Only HTTP and HTTPS links can be opened.');
  await open(url);
}
