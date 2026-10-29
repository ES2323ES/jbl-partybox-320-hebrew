import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { defineConfig, Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

function binaryArchiveServePlugin(): Plugin {
  return {
    name: 'serve-apk-and-zip-binary',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const cleanUrl = req.url?.split('?')[0] ?? '';
        if (cleanUrl.endsWith('.apk') || cleanUrl.endsWith('.zip')) {
          const targetFile = path.resolve(
            import.meta.dirname,
            'public',
            path.basename(cleanUrl)
          );
          if (fs.existsSync(targetFile)) {
            const stat = fs.statSync(targetFile);
            const mime = cleanUrl.endsWith('.zip')
              ? 'application/zip'
              : 'application/vnd.android.package-archive';
            res.setHeader('Content-Type', mime);
            res.setHeader(
              'Content-Disposition',
              `attachment; filename="${path.basename(targetFile)}"`
            );
            res.setHeader('Content-Length', String(stat.size));
            res.setHeader('Cache-Control', 'no-store');
            if (req.method === 'HEAD') {
              res.statusCode = 200;
              res.end();
              return;
            }
            fs.createReadStream(targetFile).pipe(res);
            return;
          }
        }
        next();
      });
    },
  };
}

export default defineConfig(() => {
  const isApkBuild = process.env.APK_BUILD === 'true';

  return {
    base: isApkBuild ? './' : '/',
    plugins: [
      binaryArchiveServePlugin(),
      react(),
      tailwindcss(),
      ...(!isApkBuild
        ? [
            VitePWA({
              registerType: 'autoUpdate',
              includeAssets: ['icon.svg', 'apple-touch-icon.png'],
              manifest: {
                id: '/',
                name: 'JBL PartyBox 320 — מרכז שליטה',
                short_name: 'PartyBox 320',
                description:
                  'אפליקציית שליטה ייעודית בעברית לרמקול הנייד JBL PartyBox Stage 320 עם תאורת מופע ואיקוולייזר 7 ערוצים.',
                dir: 'rtl',
                lang: 'he',
                theme_color: '#F4F6FA',
                background_color: '#F4F6FA',
                display: 'standalone',
                orientation: 'portrait-primary',
                start_url: '/',
                scope: '/',
                icons: [
                  {
                    src: '/pwa-192x192.png',
                    sizes: '192x192',
                    type: 'image/png',
                    purpose: 'any',
                  },
                  {
                    src: '/pwa-512x512.png',
                    sizes: '512x512',
                    type: 'image/png',
                    purpose: 'any',
                  },
                  {
                    src: '/pwa-maskable-512x512.png',
                    sizes: '512x512',
                    type: 'image/png',
                    purpose: 'maskable',
                  },
                ],
              },
              workbox: {
                globPatterns: ['**/*.{js,css,html,ico,png,svg,jpg,woff,woff2}'],
                globIgnores: ['**/*.apk', '**/*.zip'],
                navigateFallbackDenylist: [
                  /\.(apk|zip)$/i,
                  /^\/api\//i,
                  /\/apk-metadata\.json$/i,
                ],
                runtimeCaching: [
                  {
                    urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
                    handler: 'CacheFirst',
                    options: {
                      cacheName: 'google-fonts-cache',
                      expiration: {
                        maxEntries: 10,
                        maxAgeSeconds: 60 * 60 * 24 * 365,
                      },
                      cacheableResponse: {
                        statuses: [0, 200],
                      },
                    },
                  },
                  {
                    urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
                    handler: 'CacheFirst',
                    options: {
                      cacheName: 'gstatic-fonts-cache',
                      expiration: {
                        maxEntries: 10,
                        maxAgeSeconds: 60 * 60 * 24 * 365,
                      },
                      cacheableResponse: {
                        statuses: [0, 200],
                      },
                    },
                  },
                ],
              },
              devOptions: {
                enabled: true,
                type: 'module',
                navigateFallbackAllowlist: [/^\/$/],
              },
            }),
          ]
        : []),
    ],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
