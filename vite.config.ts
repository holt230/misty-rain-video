import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
import { createApiContext, handleApiRequest } from './server/api.js';
import { handleMobileConfigRequest } from './server/mobileConfig.js';

function localApiPlugin(): Plugin {
  const context = createApiContext({ dataDir: path.resolve(__dirname, 'data') });
  return {
    name: 'misty-rain-local-api',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (handleMobileConfigRequest(request, response, { distDir: path.resolve(__dirname, 'public') })) return;
        handleApiRequest(request, response, context)
          .then(handled => {
            if (!handled) next();
          })
          .catch(next);
      });
    }
  };
}

export default defineConfig({
  base: process.env.APP_BASE_PATH || '/',
  plugins: [vue(), localApiPlugin()],
  server: {
    port: 5173,
    host: '0.0.0.0',
    open: false
  }
});
