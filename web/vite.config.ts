import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Панель живёт по адресу /app/ (на главной — лендинг).
// Демо-сборка для GitHub Pages: `npm run build:demo` с BASE_PATH=/crm/app/
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === 'demo' ? process.env.BASE_PATH ?? './' : '/app/',
  server: { proxy: { '/api': 'http://localhost:3000', '/t': 'http://localhost:3000' } },
}));
