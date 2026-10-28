/** The browser's only route to the local server: JSON over fetch, with the CSRF header. */
let csrf = '';

/** Remember the session's CSRF token; every mutating request must send it. */
export function setCsrf(token: string) {
  csrf = token;
}

export async function api<T>(path: string, body?: unknown, method?: 'DELETE'): Promise<T> {
  const r = await fetch(`/api${path}`, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers:
      body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Tinkerfleet-CSRF': csrf },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? 'Request failed.');
  return data;
}

/** A GET's raw JSON text, so polling can skip a response that has not changed. */
export async function apiText(path: string): Promise<string> {
  const r = await fetch(`/api${path}`);
  const text = await r.text();
  if (!r.ok) {
    let message = 'Request failed.';
    try {
      message = (JSON.parse(text) as { error?: string }).error ?? message;
    } catch {}
    throw new Error(message);
  }
  return text;
}
