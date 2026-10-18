import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../src/server/app.js';
import type { Persona } from '../src/shared/types.js';

const port = 45347,
  base = `http://127.0.0.1:${port}`;

async function open(statePath?: string) {
  const app = createApp({ port, mode: 'demo', demoDelayMs: 1, statePath });
  await new Promise<void>((resolve) => app.server.listen(port, '127.0.0.1', resolve));
  const session = await fetch(base + '/api/session', { headers: { Connection: 'close' } });
  const { csrf } = (await session.json()) as { csrf: string };
  const headers = {
    Cookie: session.headers.get('set-cookie')!.split(';')[0],
    Origin: base,
    'X-Tinkerfleet-CSRF': csrf,
    'Content-Type': 'application/json',
    Connection: 'close',
  };
  const send = (method: string, url: string, body?: unknown) =>
    fetch(base + url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { app, send };
}
const bot = (name: string, role?: string) => ({
  name,
  purpose: `Be ${name}.`,
  ...(role ? { role } : {}),
});

test('the bot library has at most one primary agent', async () => {
  const { app, send } = await open();
  try {
    const first = await send('POST', '/api/profiles', bot('Lead', 'coordinator'));
    assert.equal(first.status, 201);
    const lead = (await first.json()) as Persona;

    const second = await send('POST', '/api/profiles', bot('Lead two', 'coordinator'));
    assert.equal(second.status, 400);
    assert.match(((await second.json()) as { error: string }).error, /already a primary agent/);

    // The primary can still be edited, and ordinary agents are unaffected.
    assert.equal(
      (await send('POST', `/api/profiles/${lead.id}`, { purpose: 'Coordinate.' })).status,
      200,
    );
    const nova = (await (await send('POST', '/api/profiles', bot('Nova'))).json()) as Persona;
    assert.equal(nova.role, 'agent');

    // An ordinary agent cannot be promoted into a second primary.
    assert.equal(
      (await send('POST', `/api/profiles/${nova.id}`, { role: 'coordinator' })).status,
      400,
    );
    assert.equal(app.state().profiles.filter((p) => p.role === 'coordinator').length, 1);

    // Import follows the same rule.
    const extra = (name: string, role: string): Persona => ({
      id: name,
      name,
      purpose: 'x',
      role: role as Persona['role'],
      color: '#3a7d82',
      shape: 'orbit',
    });
    assert.equal(
      (
        await send('POST', '/api/profiles/import', {
          profiles: [extra('other-lead', 'coordinator')],
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await send('POST', '/api/profiles/import', {
          profiles: [extra('a-lead', 'coordinator'), extra('b-lead', 'coordinator')],
        })
      ).status,
      400,
    );
    assert.equal(
      (await send('POST', '/api/profiles/import', { profiles: [extra('helper', 'agent')] })).status,
      200,
    );
    // Re-importing the existing primary is not "another" primary.
    assert.equal(
      (await send('POST', '/api/profiles/import', { profiles: [{ ...lead, purpose: 'Updated.' }] }))
        .status,
      200,
    );
  } finally {
    await app.close();
  }
});

test('the first primary can arrive by import into an empty library, but only one', async () => {
  const { app, send } = await open();
  try {
    const primary = (id: string): Persona => ({
      id,
      name: id,
      purpose: 'x',
      role: 'coordinator',
      color: '#3a7d82',
      shape: 'orbit',
    });
    assert.equal(
      (await send('POST', '/api/profiles/import', { profiles: [primary('one'), primary('two')] }))
        .status,
      400,
    );
    assert.equal(
      (await send('POST', '/api/profiles/import', { profiles: [primary('one')] })).status,
      200,
    );
  } finally {
    await app.close();
  }
});

test('a library saved with several primaries still loads, and cannot gain another', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'tinkerfleet-primaries-')),
    statePath = path.join(dir, 'conversations.json');
  try {
    let session = await open(statePath);
    assert.equal(
      (await session.send('POST', '/api/profiles', bot('Lead', 'coordinator'))).status,
      201,
    );
    await session.app.close();

    // Older versions allowed this; edit the saved file to look like theirs.
    const saved = JSON.parse(await readFile(statePath, 'utf8')) as { profiles: Persona[] };
    saved.profiles.push({ ...saved.profiles[0], id: 'older-lead', name: 'Older lead' });
    await writeFile(statePath, JSON.stringify(saved));

    session = await open(statePath);
    try {
      assert.equal(session.app.state().profiles.filter((p) => p.role === 'coordinator').length, 2);
      assert.equal(
        (await session.send('POST', '/api/profiles', bot('Third', 'coordinator'))).status,
        400,
      );
      assert.equal((await session.send('POST', '/api/profiles', bot('Nova'))).status, 201);
    } finally {
      await session.app.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
