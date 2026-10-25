import { defineConfig } from 'vite';

export default defineConfig(({ command }) => {
  // A bare `vite` dev server would play against Krishna's database on :3000. Dev servers stay off :5173 too.
  if (command === 'serve' && !process.env.VITE_STDB_URI) {
    throw new Error('Use your sandbox instead: ./sandbox up (or set VITE_STDB_URI to a sandbox, see ./sandbox env).');
  }
  return {
    server: { port: 5300, host: '127.0.0.1', fs: { allow: ['..'] } },
    build: { target: 'es2022' },
  };
});
