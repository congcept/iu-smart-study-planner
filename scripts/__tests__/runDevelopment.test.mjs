import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

import { runDevelopment } from '../runDevelopment.mjs';

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'iu-development-test-'));
  const eventsPath = join(directory, 'events.jsonl');
  const scriptPath = join(directory, 'npm-fixture.mjs');
  const settings = JSON.stringify({ eventsPath, ...options });
  await writeFile(
    scriptPath,
    `import { appendFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
const settings = ${settings};
const args = process.argv.slice(2);
const name = args.includes('build:shared') ? 'build' : args.find(a => a.startsWith('--workspace=')).slice(12);
const record = kind => appendFileSync(settings.eventsPath, JSON.stringify({kind, name, pid:process.pid, args})+'\\n');
record('start');
if (name === 'build') {
  setTimeout(() => { record('build-finished'); process.exit(settings.buildExit || 0); }, settings.buildDelay || 75);
} else {
  if (settings.withGrandchild) {
    spawn(process.execPath, ['-e', 
      "const fs=require('node:fs'); const file=" + JSON.stringify(settings.eventsPath) + ";" +
      "fs.appendFileSync(file,JSON.stringify({kind:'grandchild',name:'"+name+"',pid:process.pid})+'\\\\n');" +
      (settings.stubbornGrandchild ? "process.on('SIGTERM',()=>{});process.on('SIGINT',()=>{});" : "") +
      "setInterval(()=>{},1000);"
    ], {stdio:'inherit'});
  }
  if (settings.failWatcher === name) {
    setTimeout(() => process.exit(settings.watcherExit ?? 7), 200);
  }
  setInterval(() => {}, 1000);
}
process.on('SIGTERM', () => { record('SIGTERM'); process.exit(0); });
process.on('SIGINT', () => { record('SIGINT'); process.exit(0); });
`,
  );
  const signals = new EventEmitter();
  const logs = [];
  const done = runDevelopment({
    mode: options.mode || 'all',
    cwd: directory,
    invocation: { command: process.execPath, prefix: [scriptPath] },
    signalSource: signals,
    shutdownGraceMs: 150,
    log: (message) => logs.push(message),
  });
  t.after(async () => {
    signals.emit('SIGTERM');
    await done;
    await rm(directory, { recursive: true, force: true });
  });
  const events = async () => {
    try {
      return (await readFile(eventsPath, 'utf8')).trim().split('\n').map(JSON.parse);
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  };
  return { signals, logs, done, events };
}

async function until(read, predicate) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const value = await read();
    if (predicate(value)) return value;
    await delay(20);
  }
  throw new Error('Timed out waiting for fixture process state.');
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

for (const [mode, names] of [
  ['all', ['client', 'server', 'shared']],
  ['backend', ['server', 'shared']],
  ['frontend', ['client', 'shared']],
]) {
  test(`${mode} builds shared first, starts only requested watchers and cleans up`, async (t) => {
    const state = await fixture(t, { mode, withGrandchild: true });
    const started = await until(
      state.events,
      (events) => events.filter((event) => event.kind === 'grandchild').length === names.length,
    );
    const watchers = started.filter((event) => event.kind === 'start' && event.name !== 'build');
    assert.deepEqual(watchers.map((event) => event.name).sort(), names);
    const finishedIndex = started.findIndex((event) => event.kind === 'build-finished');
    assert.ok(finishedIndex >= 0);
    for (const watcher of watchers) assert.ok(started.indexOf(watcher) > finishedIndex);
    const client = watchers.find((event) => event.name === 'client');
    if (client) assert.equal(client.args.includes('--host'), mode === 'frontend');
    state.signals.emit('SIGINT');
    assert.equal(await state.done, 130);
    await until(
      async () =>
        started
          .filter((event) => event.kind !== 'build-finished')
          .some((event) => alive(event.pid)),
      (value) => !value,
    );
    assert.equal(state.signals.listenerCount('SIGINT'), 0);
    assert.equal(state.signals.listenerCount('SIGTERM'), 0);
  });
}

test('a failed shared build propagates its status without starting any watcher', async (t) => {
  const state = await fixture(t, { buildExit: 9 });
  assert.equal(await state.done, 9);
  assert.deepEqual(
    (await state.events()).filter((event) => event.kind === 'start').map((event) => event.name),
    ['build'],
  );
});

for (const watcherExit of [0, 7]) {
  test(`watcher exit ${watcherExit} stops sibling watchers and reports failure`, async (t) => {
    const state = await fixture(t, { failWatcher: 'server', watcherExit, withGrandchild: true });
    assert.equal(await state.done, watcherExit || 1);
    const started = await state.events();
    await until(
      async () => started.some((event) => alive(event.pid)),
      (value) => !value,
    );
    assert.ok(state.logs.some((message) => message.includes('server watcher stopped')));
  });
}

test('interrupting the initial build stops it without an unresolved startup promise', async (t) => {
  const state = await fixture(t, { buildDelay: 10000 });
  await until(state.events, (events) => events.some((event) => event.name === 'build'));
  state.signals.emit('SIGTERM');
  assert.equal(await state.done, 143);
  assert.ok((await state.events()).every((event) => event.name === 'build'));
});

test(
  'a descendant ignoring graceful signals is forcibly stopped after the grace period',
  { skip: process.platform === 'win32' },
  async (t) => {
    const state = await fixture(t, {
      mode: 'backend',
      withGrandchild: true,
      stubbornGrandchild: true,
    });
    const started = await until(
      state.events,
      (events) => events.filter((event) => event.kind === 'grandchild').length === 2,
    );
    state.signals.emit('SIGTERM');
    assert.equal(await state.done, 143);
    await until(
      async () => started.some((event) => alive(event.pid)),
      (value) => !value,
    );
  },
);

test('missing npm executable fails promptly and removes signal handlers', async () => {
  const signals = new EventEmitter();
  const logs = [];
  const result = await runDevelopment({
    invocation: { command: join(tmpdir(), 'iu-no-such-npm-executable'), prefix: [] },
    signalSource: signals,
    log: (message) => logs.push(message),
  });
  assert.equal(result, 1);
  assert.ok(logs.some((message) => message.includes('Could not start shared build')));
  assert.equal(signals.listenerCount('SIGINT'), 0);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
});

test('unknown mode starts no child and registers no signal handlers', async () => {
  const signals = new EventEmitter();
  assert.equal(await runDevelopment({ mode: 'invalid', signalSource: signals, log: () => {} }), 1);
  assert.equal(
    await runDevelopment({ mode: 'constructor', signalSource: signals, log: () => {} }),
    1,
  );
  assert.equal(signals.eventNames().length, 0);
});
