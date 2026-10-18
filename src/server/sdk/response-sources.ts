/** Turn hosted web-search annotations into bounded, redacted citations for the UI. */
import type { MessageSource } from '../../shared/types.js';
import { safeSources } from '../sources.js';
import { redactSdkText } from '../safety.js';

/** Read only typed assistant annotations and hosted search sources, never arbitrary provider data. */
export function responseSources(output: unknown): { text: string; sources: MessageSource[] }[] {
  if (!Array.isArray(output)) return [];
  const consulted: unknown[] = [];
  for (const item of output) {
    if (item?.type !== 'hosted_tool_call' || item.name !== 'web_search_call') continue;
    const sources = item.providerData?.action?.sources;
    if (Array.isArray(sources))
      consulted.push(...sources.filter((source) => source?.type === 'url'));
  }
  const messages: { text: string; sources: MessageSource[] }[] = [];
  for (const item of output) {
    if (item?.type !== 'message' || item.role !== 'assistant' || !Array.isArray(item.content))
      continue;
    let text = '';
    const sources: unknown[] = [];
    for (const part of item.content) {
      if (part?.type !== 'output_text' || typeof part.text !== 'string') continue;
      const annotations = part.providerData?.annotations;
      if (Array.isArray(annotations))
        for (const citation of annotations) {
          if (citation?.type !== 'url_citation') continue;
          const { url, title, start_index: start, end_index: end } = citation;
          const valid =
            Number.isSafeInteger(start) &&
            Number.isSafeInteger(end) &&
            start >= 0 &&
            end > start &&
            end <= part.text.length;
          sources.push({
            url,
            title,
            ...(valid ? { startIndex: text.length + start, endIndex: text.length + end } : {}),
          });
        }
      text += part.text;
    }
    const cited = safeSources(sources, text);
    const urls = new Set(cited.map((source) => source.url));
    messages.push({
      text,
      sources: safeSources(
        [...cited, ...safeSources(consulted).filter((source) => !urls.has(source.url))],
        text,
      ),
    });
  }
  return messages;
}

/** Keep offsets only when redacting at both boundaries reproduces the complete emitted text. */
export function remapSources(raw: string, text: string, sources: MessageSource[]): MessageSource[] {
  return safeSources(
    sources.map(({ startIndex, endIndex, ...source }) => {
      if (startIndex === undefined || endIndex === undefined) return source;
      const before = redactSdkText(raw.slice(0, startIndex));
      const span = redactSdkText(raw.slice(startIndex, endIndex));
      const after = redactSdkText(raw.slice(endIndex));
      if (before + span + after !== text) return source;
      return { ...source, startIndex: before.length, endIndex: before.length + span.length };
    }),
    text,
  );
}
