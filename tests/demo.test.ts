import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { DemoEngine } from '../src/server/demo.js';
import type { Persona, Run } from '../src/shared/types.js';
const primary: Persona = {
  id: 'primary-profile',
  name: 'Orbit',
  purpose: 'Coordinate clearly.',
  role: 'coordinator',
  color: '#3a7d82',
  shape: 'orbit',
};
const agents: Persona[] = ['Ada', 'Bea', 'Cy'].map((name, index) => ({
  id: `agent-${index}`,
  name,
  purpose: `Help as ${name}.`,
  role: 'agent',
  color: '#3a7d82',
  shape: 'spark',
}));
async function until(fn: () => boolean) {
  for (let i = 0; i < 100 && !fn(); i++) await delay(5);
  assert.ok(fn());
}
async function finish(demo: DemoEngine, run: Run) {
  await until(() => run.status === 'awaiting_approval');
  const edit = run.approvals.at(-1)!;
  assert.equal(edit.action.kind, 'edit');
  demo.decide(run.id, edit.id, edit.digest, true);
  await until(() => run.approvals.length === 2);
  const command = run.approvals.at(-1)!;
  assert.equal(command.action.kind, 'command');
  demo.decide(run.id, command.id, command.digest, true);
  await until(() => run.status === 'completed');
}

test('demo requires two exact approvals and labels every output simulated', async () => {
  const demo = new DemoEngine(1);
  try {
    const run = demo.start('Fix the tiny project');
    await until(() => run.status === 'awaiting_approval');
    assert.equal(run.artifacts.length, 0);
    const edit = run.approvals[0];
    assert.throws(() => demo.decide(run.id, edit.id, 'wrong', true), /stale/);
    demo.decide(run.id, edit.id, edit.digest, true);
    assert.throws(() => demo.decide(run.id, edit.id, edit.digest, true), /stale/);
    await until(() => run.approvals.length === 2);
    const command = run.approvals[1];
    demo.decide(run.id, command.id, command.digest, true);
    await until(() => run.status === 'completed');
    assert.match(run.output, /SIMULATED DEMO OUTPUT/);
    assert.equal(run.artifacts.length, 1);
    assert.equal(run.artifacts[0].simulated, true);
    assert.deepEqual(
      run.approvals.map((a) => a.agent),
      ['maker', 'checker'],
    );
  } finally {
    demo.dispose();
  }
});
test('decline performs no edit and cannot be replayed', async () => {
  const demo = new DemoEngine(1);
  try {
    const run = demo.start('Fix');
    await until(() => run.status === 'awaiting_approval');
    const a = run.approvals[0];
    demo.decide(run.id, a.id, a.digest, false);
    assert.equal(run.status, 'denied');
    assert.equal(run.artifacts.length, 0);
    assert.throws(() => demo.decide(run.id, a.id, a.digest, true));
  } finally {
    demo.dispose();
  }
});
test('stop cancels queued callbacks and invalidates pending decisions', async () => {
  const demo = new DemoEngine(2);
  try {
    const run = demo.start('Fix');
    demo.cancel(run.id);
    await delay(15);
    assert.equal(run.status, 'cancelled');
    assert.equal(run.approvals.length, 0);
    const second = demo.start('Again');
    await until(() => second.status === 'awaiting_approval');
    const a = second.approvals[0];
    demo.cancel(second.id);
    assert.throws(() => demo.decide(second.id, a.id, a.digest, true));
  } finally {
    demo.dispose();
  }
});
test('new process-like engine cannot resume old approvals', async () => {
  const demo = new DemoEngine(1),
    restarted = new DemoEngine(1);
  try {
    const run = demo.start('Fix');
    await until(() => run.status === 'awaiting_approval');
    const a = run.approvals[0];
    assert.throws(() => restarted.decide(run.id, a.id, a.digest, true), /restart/);
  } finally {
    demo.dispose();
    restarted.dispose();
  }
});

test('greetings and explanations from any selected identity stay read-only', async () => {
  const demo = new DemoEngine(1);
  try {
    for (const profile of [primary, ...agents])
      for (const prompt of ['Hello', 'Teach me this fixture']) {
        const run = demo.start(prompt, [profile]);
        await until(() => run.status === 'completed');
        const id = profile.role === 'coordinator' ? 'coordinator' : profile.id;
        assert.ok(run.messages.every((m) => m.author === 'user' || m.author === id));
        assert.ok(run.events.every((e) => e.agent === id));
        assert.equal(run.approvals.length, 0);
        assert.equal(run.artifacts.length, 0);
      }
  } finally {
    demo.dispose();
  }
});
test('every direct ordinary agent can inspect, edit and check the complete fixture', async () => {
  const demo = new DemoEngine(1);
  try {
    for (const profile of agents) {
      const run = demo.start('Fix tiny-project', [profile]);
      await finish(demo, run);
      assert.deepEqual(
        run.approvals.map((a) => a.agent),
        [profile.id, profile.id],
      );
      assert.ok(run.events.every((e) => e.agent === profile.id));
      assert.ok(run.messages.every((m) => m.author === 'user' || m.author === profile.id));
      assert.match(run.output, /pass 3/);
    }
  } finally {
    demo.dispose();
  }
});
test('legacy role labels do not restrict individual capabilities', async () => {
  const { customTeam } = await import('./personas.fixture.js');
  const demo = new DemoEngine(1);
  try {
    for (const profile of customTeam().filter((p) => p.role !== 'coordinator')) {
      const run = demo.start('Fix tiny-project', [profile]);
      await finish(demo, run);
      assert.deepEqual(
        run.approvals.map((a) => a.agent),
        [profile.id, profile.id],
      );
      assert.ok(run.messages.every((m) => m.author === 'user' || m.author === profile.id));
    }
  } finally {
    demo.dispose();
  }
});
test('parallel direct demos keep approvals and artifacts separate', async () => {
  const demo = new DemoEngine(1);
  try {
    const first = demo.start('Fix tiny-project', [agents[0]]),
      second = demo.start('Fix tiny-project', [agents[1]]);
    await until(
      () => first.status === 'awaiting_approval' && second.status === 'awaiting_approval',
    );
    const edit = first.approvals[0];
    assert.throws(() => demo.decide(second.id, edit.id, edit.digest, true));
    await finish(demo, first);
    assert.equal(second.status, 'awaiting_approval');
    assert.equal(second.artifacts.length, 0);
    assert.equal(second.output, '');
    await finish(demo, second);
    assert.notEqual(first.artifacts[0], second.artifacts[0]);
  } finally {
    demo.dispose();
  }
});
test('same-role group stage assignments follow selected individual order', async () => {
  const demo = new DemoEngine(1);
  try {
    const run = demo.start('Build and check', agents);
    await finish(demo, run);
    assert.equal(run.events.find((e) => e.title === 'Read sum.js')?.agent, agents[0].id);
    assert.deepEqual(
      run.approvals.map((a) => a.agent),
      [agents[1].id, agents[2].id],
    );
    assert.ok(
      run.messages.every((m) => m.author === 'user' || agents.some((p) => p.id === m.author)),
    );
    const pair = demo.start('Fix the fixture', [agents[2], agents[0]]);
    await finish(demo, pair);
    assert.equal(pair.events.find((e) => e.title === 'Read sum.js')?.agent, agents[2].id);
    assert.deepEqual(
      pair.approvals.map((a) => a.agent),
      [agents[0].id, agents[0].id],
    );
  } finally {
    demo.dispose();
  }
});
test('primary starts a group by selected identities without requiring distinct roles', async () => {
  const requests: { runId: string; botIds: string[]; brief: string }[] = [];
  const demo = new DemoEngine(1, async (runId, request) => {
    requests.push({ runId, ...request });
    return { conversationId: 'child-group', title: request.title };
  });
  try {
    const parent = demo.start('Help me fix the failing tests in tiny-project.', [primary], {
      availableBots: agents,
    });
    await until(() => parent.status === 'completed');
    assert.equal(requests.length, 1);
    assert.deepEqual(
      requests[0].botIds,
      agents.map((p) => p.id),
    );
    assert.ok(parent.messages.every((m) => m.author === 'user' || m.author === 'coordinator'));
    assert.equal(parent.approvals.length, 0);
    const group = demo.start(requests[0].brief, [primary, ...agents], {
      promptAuthor: 'coordinator',
    });
    await finish(demo, group);
    assert.equal(group.messages[0].author, 'coordinator');
    assert.deepEqual(
      group.approvals.map((a) => a.agent),
      [agents[1].id, agents[2].id],
    );
    assert.equal(requests.length, 1);
  } finally {
    demo.dispose();
  }
});
test('primary can complete the fixture directly while greetings never start a group', async () => {
  let groups = 0;
  const demo = new DemoEngine(1, async () => {
    groups++;
    return { conversationId: 'unexpected', title: 'Unexpected' };
  });
  try {
    for (const prompt of ['Hello', 'Explain the test; do not start a group.']) {
      const run = demo.start(prompt, [primary], { availableBots: agents });
      await until(() => run.status === 'completed');
      assert.equal(run.approvals.length, 0);
    }
    const direct = demo.start('Fix tiny-project without a group', [primary], {
      availableBots: agents,
    });
    await finish(demo, direct);
    assert.deepEqual(
      direct.approvals.map((a) => a.agent),
      ['coordinator', 'coordinator'],
    );
    assert.equal(groups, 0);
  } finally {
    demo.dispose();
  }
});
test('stopping a primary before its scripted decision cannot start a group', async () => {
  let groups = 0;
  const demo = new DemoEngine(2, async () => {
    groups++;
    return { conversationId: 'unexpected', title: 'Unexpected' };
  });
  try {
    const run = demo.start('Fix the tests', [primary], { availableBots: agents });
    demo.cancel(run.id);
    await delay(15);
    assert.equal(groups, 0);
    assert.equal(run.status, 'cancelled');
  } finally {
    demo.dispose();
  }
});
test('group failure does not claim success or leak callback errors', async () => {
  const demo = new DemoEngine(1, async () => {
    throw new Error('private failure detail');
  });
  try {
    const run = demo.start('Fix the tests', [primary], { availableBots: agents });
    await until(() => run.status === 'failed');
    assert.equal(run.approvals.length, 0);
    assert.doesNotMatch(
      JSON.stringify(run),
      /private failure detail|shared conversation has started/,
    );
  } finally {
    demo.dispose();
  }
});

test('primary saves a reusable personality without role fields or project actions', async () => {
  const requests: unknown[] = [];
  const demo = new DemoEngine(1, undefined, async (runId, request) => {
    requests.push({ runId, ...request });
    return { ...agents[0], id: 'new-ada', ...request };
  });
  try {
    const run = demo.start('Create a patient Python tutor called Ada.', [primary], {
      availableBots: [],
    });
    await until(() => run.status === 'completed');
    assert.deepEqual(requests, [
      { runId: run.id, name: 'Ada', purpose: 'Act as a patient Python tutor.' },
    ]);
    assert.equal(run.approvals.length, 0);
    assert.equal(run.artifacts.length, 0);
    assert.match(run.messages.at(-1)!.text, /scripted example saved Ada/);
    const ordinary = demo.start('Create a tutor called Extra.', [agents[0]]);
    await until(() => ordinary.status === 'completed');
    assert.equal(requests.length, 1);
  } finally {
    demo.dispose();
  }
});
test('stopped and failed creations cannot claim a saved agent', async () => {
  let calls = 0;
  const demo = new DemoEngine(2, undefined, async () => {
    calls++;
    throw new Error('private creation failure');
  });
  try {
    const stopped = demo.start('Create a tutor called Ada.', [primary]);
    demo.cancel(stopped.id);
    await delay(15);
    assert.equal(calls, 0);
    const failed = demo.start('Create a tutor called Ada.', [primary]);
    await until(() => failed.status === 'failed');
    assert.equal(calls, 1);
    assert.doesNotMatch(JSON.stringify(failed), /private creation failure|scripted example saved/);
  } finally {
    demo.dispose();
  }
});

test('Ask Ada sends only the requested message to the exact roster identity', async () => {
  const requests: unknown[] = [];
  const demo = new DemoEngine(1, undefined, undefined, async (runId, request) => {
    requests.push({ runId, ...request });
    return { conversationId: 'ada-chat', agentId: request.agentId };
  });
  try {
    const run = demo.start('Ask Ada: Explain a Python loop.', [primary], { availableBots: agents });
    await until(() => run.status === 'completed');
    assert.deepEqual(requests, [
      { runId: run.id, agentId: agents[0].id, message: 'Explain a Python loop.' },
    ]);
    assert.match(run.messages.at(-1)!.text, /Sent your message to Ada/);
    assert.equal(run.approvals.length, 0);
    assert.ok(run.messages.every((m) => m.author === 'user' || m.author === 'coordinator'));
    const reply = demo.start('Explain a Python loop.', [agents[0]], {
      promptAuthor: 'coordinator',
    });
    await until(() => reply.status === 'completed');
    assert.equal(reply.messages.at(-1)!.author, agents[0].id);
  } finally {
    demo.dispose();
  }
});
test('unknown or ambiguous Ask targets do not message a guessed identity', async () => {
  let calls = 0;
  const demo = new DemoEngine(1, undefined, undefined, async (_id, request) => {
    calls++;
    return { conversationId: 'unexpected', agentId: request.agentId };
  });
  try {
    for (const [prompt, roster] of [
      ['Ask Missing: Hello', agents],
      ['Ask Ada: Hello', [agents[0], { ...agents[1], name: 'Ada' }]],
    ] as const) {
      const run = demo.start(prompt, [primary], { availableBots: [...roster] });
      await until(() => run.status === 'completed');
      assert.match(run.messages.at(-1)!.text, /No message was sent/);
    }
    assert.equal(calls, 0);
  } finally {
    demo.dispose();
  }
});
test('message cancellation and callback failure never report a successful handoff', async () => {
  let calls = 0;
  const demo = new DemoEngine(2, undefined, undefined, async () => {
    calls++;
    throw new Error('private message failure');
  });
  try {
    const stopped = demo.start('Ask Ada: Hello', [primary], { availableBots: agents });
    demo.cancel(stopped.id);
    await delay(15);
    assert.equal(calls, 0);
    const failed = demo.start('Ask Ada: Hello', [primary], { availableBots: agents });
    await until(() => failed.status === 'failed');
    assert.equal(calls, 1);
    assert.doesNotMatch(JSON.stringify(failed), /private message failure|Sent your message/);
  } finally {
    demo.dispose();
  }
});
test('cancellation while a message callback is pending suppresses its late confirmation', async () => {
  let resolve!: (value: { conversationId: string; agentId: string }) => void;
  let entered = false;
  const demo = new DemoEngine(1, undefined, undefined, async () => {
    entered = true;
    return new Promise((done) => {
      resolve = done;
    });
  });
  try {
    const run = demo.start('Ask Ada: Hello', [primary], { availableBots: agents });
    await until(() => entered);
    demo.cancel(run.id);
    resolve({ conversationId: 'ada-chat', agentId: agents[0].id });
    await delay(10);
    assert.equal(run.status, 'cancelled');
    assert.doesNotMatch(JSON.stringify(run), /Sent your message/);
  } finally {
    demo.dispose();
  }
});
