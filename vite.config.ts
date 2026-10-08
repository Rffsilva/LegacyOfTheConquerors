import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * Writes dist/sw.js listing every built file, so the service worker can precache the whole
 * game for offline play. The version is a hash of all file contents and the worker itself, so
 * any change ships as an update.
 */
function serviceWorker(): Plugin {
  let outDir = 'dist';
  let root = '.';
  return {
    name: 'lotc-service-worker',
    apply: 'build',
    configResolved(config) {
      root = config.root;
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const path = join(dir, name);
          if (statSync(path).isDirectory()) walk(path);
          else files.push(relative(outDir, path).split('\\').join('/'));
        }
      };
      walk(outDir);
      const precache = files.filter((f) => f !== 'sw.js' && !f.endsWith('.map')).sort();
      const template = readFileSync(resolve(root, 'tools/sw-template.js'), 'utf8');
      const hash = createHash('sha256').update(template);
      for (const f of precache) hash.update(f).update(readFileSync(join(outDir, f)));
      writeFileSync(
        join(outDir, 'sw.js'),
        template.replace('__VERSION__', hash.digest('hex').slice(0, 12)).replace('__FILES__', JSON.stringify(precache)),
      );
    },
  };
}

export default defineConfig({
  // Relative base so the build works from any static host and inside a Capacitor shell.
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
  plugins: [serviceWorker()],
});
