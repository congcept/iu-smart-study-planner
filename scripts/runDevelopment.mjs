import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const modes = {
  all: ['shared', 'server', 'client'],
  backend: ['shared', 'server'],
  frontend: ['shared', 'client'],
};

function npmInvocation() {
  // npm supplies its own CLI path when it invokes this script. This also avoids
  // relying on npm.cmd being directly executable on Windows.
  if (process.env.npm_execpath) {
    return { command: process.execPath, prefix: [process.env.npm_execpath] };
  }
  if (process.platform === 'win32') {
    return {
      command: process.env.ComSpec || 'cmd.exe',
      prefix: ['/d', '/s', '/c', 'npm'],
    };
  }
  return { command: 'npm', prefix: [] };
}

/** Build shared once, then supervise the requested development process trees. */
export async function runDevelopment({
  mode = 'all',
  cwd = rootDirectory,
  invocation = npmInvocation(),
  signalSource = process,
  shutdownGraceMs = 5000,
  log = (message) => console.error(message),
} = {}) {
  const workspaces = Object.hasOwn(modes, mode) ? modes[mode] : null;
  if (!workspaces) {
    log('Development mode must be all, backend or frontend.');
    return 1;
  }

  const children = new Set();
  let stopping = false;
  let finish;
  const finished = new Promise((resolveFinished) => {
    finish = resolveFinished;
  });

  function groupExists(child) {
    if (!child.pid) return false;
    if (process.platform === 'win32') {
      return child.exitCode === null && child.signalCode === null;
    }
    try {
      process.kill(-child.pid, 0);
      return true;
    } catch (error) {
      return error.code !== 'ESRCH';
    }
  }

  async function signalTree(child, signal, force = false) {
    if (!child.pid) return;
    if (process.platform === 'win32') {
      // Node cannot signal Windows process groups. taskkill's /T includes npm's
      // child watchers; killing only the npm wrapper would leave them running.
      await new Promise((resolveKilled) => {
        const killer = spawn(
          'taskkill',
          ['/PID', String(child.pid), '/T', ...(force ? ['/F'] : [])],
          { stdio: 'ignore', windowsHide: true },
        );
        killer.once('error', resolveKilled);
        killer.once('exit', resolveKilled);
      });
      return;
    }
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== 'ESRCH') {
        log(`Could not stop development process tree ${child.pid}: ${error.message}`);
      }
    }
  }

  async function stop(code, signal = 'SIGTERM') {
    if (stopping) return;
    stopping = true;
    const running = [...children];
    await Promise.all(running.map((child) => signalTree(child, signal)));
    const deadline = Date.now() + shutdownGraceMs;
    while (running.some(groupExists) && Date.now() < deadline) {
      await delay(25);
    }
    await Promise.all(
      running.filter(groupExists).map((child) => signalTree(child, 'SIGKILL', true)),
    );
    signalSource.removeListener('SIGINT', interrupt);
    signalSource.removeListener('SIGTERM', terminate);
    finish(code);
  }

  const interrupt = () => void stop(130, 'SIGINT');
  const terminate = () => void stop(143);
  signalSource.on('SIGINT', interrupt);
  signalSource.on('SIGTERM', terminate);

  function launch(label, args, onExit) {
    let child;
    try {
      child = spawn(invocation.command, [...invocation.prefix, ...args], {
        cwd,
        stdio: 'inherit',
        detached: process.platform !== 'win32',
        windowsHide: true,
      });
    } catch (error) {
      log(`Could not start ${label}: ${error.message}`);
      onExit?.(false);
      void stop(1);
      return;
    }
    children.add(child);
    child.once('error', (error) => {
      log(`Could not start ${label}: ${error.message}`);
      onExit?.(false);
      void stop(1);
    });
    child.once('exit', (code, signal) => {
      if (stopping) return;
      if (onExit && code === 0) {
        children.delete(child);
        onExit(true);
        return;
      }
      log(`${label} stopped (${signal || `exit ${code ?? 1}`}); stopping development.`);
      onExit?.(false);
      // A watcher ending successfully is still an unexpected loss of service.
      void stop(typeof code === 'number' && code !== 0 ? code : 1);
    });
  }

  log('Building shared before starting development watchers.');
  const built = await Promise.race([
    new Promise((resolveBuilt) => {
      launch('shared build', ['run', 'build:shared'], resolveBuilt);
    }),
    finished.then(() => false),
  ]);
  if (built && !stopping) {
    for (const workspace of workspaces) {
      if (stopping) break;
      const args = ['run', 'dev', `--workspace=${workspace}`];
      if (mode === 'frontend' && workspace === 'client') args.push('--', '--host');
      log(`Starting ${workspace} development watcher.`);
      launch(`${workspace} watcher`, args);
    }
  }
  return finished;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await runDevelopment({ mode: process.argv[2] || 'all' });
}
