import { defineConfig } from 'vite';

const frontendUrl = process.env.VITE_FRONTEND_URL;
const base = frontendUrl ? `${frontendUrl.replace(/\/+$/, '')}/` : '/';

export default defineConfig({ base });
