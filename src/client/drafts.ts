/** Unsent message drafts, cached in the browser until the server has saved them. */
export type ChatDraft = { text: string; version: number; dirty: boolean };
export function loadDrafts(): Record<string, ChatDraft> {
  try {
    const saved = JSON.parse(localStorage.getItem('tinkerfleet.chat-drafts.v1') ?? '{}');
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {};
    return Object.fromEntries(
      Object.entries(saved).filter(([, v]) => {
        const d = v as ChatDraft;
        return (
          d &&
          typeof d.text === 'string' &&
          d.text.length <= 8000 &&
          Number.isSafeInteger(d.version) &&
          d.version >= 0 &&
          d.dirty === true
        );
      }),
    ) as Record<string, ChatDraft>;
  } catch {
    return {};
  }
}
