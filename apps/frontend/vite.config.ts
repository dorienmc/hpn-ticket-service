import { defineConfig, type Plugin } from 'vite';

const frontendUrl = process.env.VITE_FRONTEND_URL;
const base = frontendUrl ? `${frontendUrl.replace(/\/+$/, '')}/` : '/';

// Vite's dev server only auto-redirects requests for "/" to the configured
// base path. Visiting the base path itself without a trailing slash (e.g.
// "/hpn-ticket-service" instead of "/hpn-ticket-service/") otherwise shows a
// 404 page suggesting the correct URL. This plugin redirects that request
// automatically instead of requiring a manual visit.
function redirectBareBasePath(): Plugin | null {
  const basePathname = new URL(base, 'http://localhost').pathname;
  const bareBasePathname = basePathname.replace(/\/+$/, '');

  if (!bareBasePathname) return null;

  return {
    name: 'redirect-bare-base-path',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';
        if (url === bareBasePathname || url.startsWith(`${bareBasePathname}?`)) {
          res.writeHead(302, { Location: `${basePathname}${url.slice(bareBasePathname.length)}` });
          res.end();
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({ base, plugins: [redirectBareBasePath()] });
