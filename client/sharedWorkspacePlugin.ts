import path from 'node:path';
import type { Plugin } from 'vite';

/** Linked CommonJS exports must be re-bundled when the shared compiler emits new runtime code. */
export function sharedWorkspacePlugin(): Plugin {
  const sharedDist = path.resolve(__dirname, '../shared/dist');
  return {
    name: 'shared-workspace-reload',
    apply: 'serve',
    configureServer(server) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      server.watcher.add(sharedDist);
      const onChange = (file: string) => {
        if (!file.startsWith(`${sharedDist}${path.sep}`) || !file.endsWith('.js')) return;
        clearTimeout(timer);
        timer = setTimeout(() => {
          timer = undefined;
          void server.restart(true).catch((error: unknown) => {
            server.config.logger.error(`Shared workspace reload failed: ${String(error)}`);
          });
        }, 500);
      };
      server.watcher.on('change', onChange);
      server.watcher.on('add', onChange);
      server.httpServer?.once('close', () => {
        clearTimeout(timer);
        server.watcher.off('change', onChange);
        server.watcher.off('add', onChange);
      });
    },
  };
}
