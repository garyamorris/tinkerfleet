import type { MessageSource } from '../shared/types.js';
import { redactSdkText } from './safety.js';
/** Model/provider annotations are data, never executable links. */
export function safeSources(input: unknown, text?: string): MessageSource[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>(),
    sources: MessageSource[] = [];
  for (const value of input) {
    if (!value || typeof value !== 'object') continue;
    const { url, title, startIndex, endIndex } = value as Record<string, unknown>;
    if (
      typeof url !== 'string' ||
      url.length > 2048 ||
      /[\u0000-\u0020\u007f]/.test(url) ||
      redactSdkText(url) !== url
    )
      continue;
    try {
      const parsed = new URL(url);
      if (
        parsed.href.length > 2048 ||
        !['http:', 'https:'].includes(parsed.protocol) ||
        !parsed.hostname ||
        parsed.username ||
        parsed.password
      )
        continue;
      const ranged =
        Number.isSafeInteger(startIndex) &&
        Number.isSafeInteger(endIndex) &&
        (startIndex as number) >= 0 &&
        (endIndex as number) > (startIndex as number) &&
        (endIndex as number) <= (text?.length ?? 256000);
      const key = parsed.href + (ranged ? `:${startIndex}:${endIndex}` : '');
      if (seen.has(key)) continue;
      seen.add(key);
      sources.push({
        url: parsed.href,
        ...(ranged ? { startIndex: startIndex as number, endIndex: endIndex as number } : {}),
        title:
          redactSdkText(typeof title === 'string' ? title : parsed.hostname)
            .replace(/[\u0000-\u001f\u007f]/g, ' ')
            .trim()
            .slice(0, 300) || parsed.hostname,
      });
    } catch {
      continue;
    }
    if (sources.length === 20) break;
  }
  return sources;
}
