import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

// The commit this client was built from, so every playtest reaction says which version it was about.
function build() {
  try {
    const sha = execSync('git rev-parse --short HEAD').toString().trim();
    return execSync('git status --porcelain').toString().trim() ? `${sha}+dirty` : sha;
  } catch { return 'unknown'; }
}

export default defineConfig(({ command }) => {
  // A bare `vite` dev server would play against Krishna's database on :3000. Dev servers stay off :5173 too.
  if (command === 'serve' && !process.env.VITE_STDB_URI) {
    throw new Error('Use your sandbox instead: ./sandbox up (or set VITE_STDB_URI to a sandbox, see ./sandbox env).');
  }
  return {
    server: { port: 5300, host: '127.0.0.1', fs: { allow: ['..'] } },
    build: { target: 'es2022' },
    define: { __BUILD__: JSON.stringify(build()) },
  };
});
