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
