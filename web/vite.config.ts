import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Демо-сборка для GitHub Pages: `npm run build:demo` (BASE_PATH=/crm/)
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === 'demo' ? process.env.BASE_PATH ?? './' : '/',
  server: { proxy: { '/api': 'http://localhost:3000', '/t': 'http://localhost:3000' } },
}));
