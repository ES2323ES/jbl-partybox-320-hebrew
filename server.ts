import crypto from 'crypto';
import dotenv from 'dotenv';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { createServer as createViteServer } from 'vite';

dotenv.config();

const PORT = 3000;
const APK_FILENAME = 'JBL-PartyBox-320-HE.apk';
const ZIP_FILENAME = 'JBL-PartyBox-320-HE-APK.zip';

// In-memory store for OAuth tokens mapped by HttpOnly session ID
const oauthSessions = new Map<string, string>();

function parseCookies(cookieHeader?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      const k = part.slice(0, idx).trim();
      const v = decodeURIComponent(part.slice(idx + 1).trim());
      out[k] = v;
    }
  }
  return out;
}

function getEffectiveGithubToken(req: express.Request): {
  token: string | null;
  source: 'oauth' | 'env' | null;
} {
  const cookies = parseCookies(req.headers.cookie);
  const sid = cookies['gh_session_id'];
  if (sid && oauthSessions.has(sid)) {
    return { token: oauthSessions.get(sid)!, source: 'oauth' };
  }
  const envToken = process.env.GITHUB_TOKEN?.trim();
  if (envToken) {
    return { token: envToken, source: 'env' };
  }
  return { token: null, source: null };
}

function getCallbackUrl(req: express.Request): string {
  const queryOrigin =
    typeof req.query.origin === 'string' && req.query.origin.startsWith('http')
      ? req.query.origin.replace(/\/$/, '')
      : null;
  const appUrl = process.env.APP_URL?.trim()?.replace(/\/$/, '');
  const base =
    queryOrigin ||
    (appUrl && appUrl.startsWith('http') ? appUrl : `http://localhost:${PORT}`);
  return `${base}/auth/github/callback`;
}

function collectProjectFiles(rootDir: string): Array<{ relPath: string; absPath: string }> {
  const ignoreDirs = new Set([
    'node_modules',
    'dist',
    'build',
    '.git',
    'coverage',
  ]);
  const ignoreFiles = new Set([
    '.DS_Store',
    ZIP_FILENAME,
    APK_FILENAME, // Uploaded separately as GitHub Release binary assets to keep git tree fast
  ]);

  const results: Array<{ relPath: string; absPath: string }> = [];

  const walk = (dir: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.env') && entry.name !== '.env.example') {
        continue;
      }
      if (entry.isDirectory()) {
        if (!ignoreDirs.has(entry.name)) {
          walk(path.join(dir, entry.name));
        }
      } else if (entry.isFile()) {
        if (!ignoreFiles.has(entry.name) && !entry.name.endsWith('.log')) {
          const absPath = path.join(dir, entry.name);
          const relPath = path.relative(rootDir, absPath).split(path.sep).join('/');
          results.push({ relPath, absPath });
        }
      }
    }
  };

  walk(rootDir);
  return results;
}

async function ghFetch(
  url: string,
  token: string,
  init: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('Accept', 'application/vnd.github+json');
  headers.set('X-GitHub-Api-Version', '2022-11-28');
  headers.set('User-Agent', 'JBL-PartyBox-320-Studio-Publisher');
  return fetch(url, { ...init, headers });
}

async function startServer() {
  const app = express();
  app.use(express.json());
  const rootDir = import.meta.dirname;

  const resolveStaticBinary = (fileName: string): string | null => {
    const publicFile = path.resolve(rootDir, 'public', fileName);
    if (fs.existsSync(publicFile)) return publicFile;
    const distFile = path.resolve(rootDir, 'dist', fileName);
    if (fs.existsSync(distFile)) return distFile;
    return null;
  };

  const makeBinaryHandler = (
    fileName: string,
    contentType: string
  ): express.RequestHandler => {
    return (req, res) => {
      const filePath = resolveStaticBinary(fileName);
      if (!filePath) {
        res.status(404).json({ error: `${fileName} not found` });
        return;
      }

      const stat = fs.statSync(filePath);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.setHeader('Content-Length', String(stat.size));
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');

      if (req.method === 'HEAD') {
        res.status(200).end();
        return;
      }

      fs.createReadStream(filePath).pipe(res);
    };
  };

  const serveZip = makeBinaryHandler(ZIP_FILENAME, 'application/zip');
  const serveApk = makeBinaryHandler(
    APK_FILENAME,
    'application/vnd.android.package-archive'
  );

  // Direct ZIP & APK download endpoints
  app.get('/api/download-zip', serveZip);
  app.head('/api/download-zip', serveZip);
  app.get(`/${ZIP_FILENAME}`, serveZip);
  app.head(`/${ZIP_FILENAME}`, serveZip);

  app.get('/api/download-apk', serveApk);
  app.head('/api/download-apk', serveApk);
  app.get(`/${APK_FILENAME}`, serveApk);
  app.head(`/${APK_FILENAME}`, serveApk);

  app.get('/api/apk-info', (_req, res) => {
    const metaPath = fs.existsSync(path.resolve(rootDir, 'public', 'apk-metadata.json'))
      ? path.resolve(rootDir, 'public', 'apk-metadata.json')
      : path.resolve(rootDir, 'dist', 'apk-metadata.json');

    if (fs.existsSync(metaPath)) {
      res.type('application/json').send(fs.readFileSync(metaPath, 'utf-8'));
      return;
    }
    res.status(404).json({ error: 'Metadata not found' });
  });

  // --- GitHub OAuth & Repository Publisher Routes ---

  app.get('/api/github/status', async (req, res) => {
    const { token, source } = getEffectiveGithubToken(req);
    const oauthConfigured = Boolean(
      process.env.GITHUB_CLIENT_ID?.trim() &&
        process.env.GITHUB_CLIENT_SECRET?.trim()
    );

    if (!token) {
      res.json({
        connected: false,
        source: null,
        username: null,
        oauthConfigured,
      });
      return;
    }

    try {
      const userRes = await ghFetch('https://api.github.com/user', token);
      if (!userRes.ok) {
        res.json({
          connected: false,
          source: null,
          username: null,
          oauthConfigured,
        });
        return;
      }
      const userData = (await userRes.json()) as { login: string; html_url: string };
      res.json({
        connected: true,
        source,
        username: userData.login,
        profileUrl: userData.html_url,
        oauthConfigured,
      });
    } catch {
      res.json({
        connected: false,
        source: null,
        username: null,
        oauthConfigured,
      });
    }
  });

  app.get('/api/github/auth-url', (req, res) => {
    const clientId = process.env.GITHUB_CLIENT_ID?.trim();
    if (!clientId) {
      res.status(400).json({
        error: 'GITHUB_CLIENT_ID is not configured in Secrets.',
      });
      return;
    }
    const redirectUri = getCallbackUrl(req);
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: 'repo',
    });
    res.json({
      url: `https://github.com/login/oauth/authorize?${params.toString()}`,
    });
  });

  const githubCallbackHandler: express.RequestHandler = async (req, res) => {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const clientId = process.env.GITHUB_CLIENT_ID?.trim();
    const clientSecret = process.env.GITHUB_CLIENT_SECRET?.trim();

    if (!code || !clientId || !clientSecret) {
      res.status(400).send('Missing GitHub OAuth code or client credentials.');
      return;
    }

    try {
      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
        }),
      });
      const tokenData = (await tokenRes.json()) as { access_token?: string };
      if (!tokenData.access_token) {
        res.status(400).send('Failed to obtain GitHub access token.');
        return;
      }

      const sid = crypto.randomBytes(24).toString('hex');
      oauthSessions.set(sid, tokenData.access_token);

      res.setHeader(
        'Set-Cookie',
        `gh_session_id=${sid}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=86400`
      );

      res.send(`<!doctype html>
<html lang="he" dir="rtl">
  <body style="background:#0B0D11;color:#F3F5F8;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
    <script>
      if (window.opener) {
        window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
        window.close();
      } else {
        window.location.href = '/';
      }
    </script>
    <p>ההתחברות ל-GitHub הצליחה. החלון ייסגר אוטומטית...</p>
  </body>
</html>`);
    } catch {
      res.status(500).send('GitHub OAuth exchange error.');
    }
  };

  app.get(['/auth/github/callback', '/auth/github/callback/'], githubCallbackHandler);

  app.post('/api/github/publish', async (req, res) => {
    const { token } = getEffectiveGithubToken(req);
    if (!token) {
      res.status(401).json({
        error:
          'לא נמצא חיבור פעיל ל-GitHub. הגדר GITHUB_TOKEN בחלונית ה-Secrets או התחבר דרך OAuth.',
      });
      return;
    }

    const rawName =
      typeof req.body?.repoName === 'string' && req.body.repoName.trim()
        ? req.body.repoName.trim()
        : 'jbl-partybox-320-hebrew';
    const repoName = rawName.replace(/[^a-zA-Z0-9._-]/g, '-');
    const isPrivate = Boolean(req.body?.isPrivate);
    const description =
      typeof req.body?.description === 'string' && req.body.description.trim()
        ? req.body.description.trim()
        : 'אפליקציית שליטה ייעודית בעברית לרמקול JBL PartyBox Stage 320 כולל תאורת מופע, איקוולייזר 7 ערוצים וקובץ APK לאנדרואיד';

    try {
      // 1. Create the new repository with auto_init: true so Git Data API works immediately
      const createRes = await ghFetch('https://api.github.com/user/repos', token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: repoName,
          description,
          private: isPrivate,
          auto_init: true,
        }),
      });

      if (!createRes.ok) {
        const errBody = (await createRes.json().catch(() => ({}))) as {
          message?: string;
          errors?: Array<{ message?: string }>;
        };
        const detail =
          errBody.errors?.[0]?.message || errBody.message || `HTTP ${createRes.status}`;
        res.status(createRes.status).json({
          error: `יצירת המאגר ב-GitHub נכשלה: ${detail}`,
        });
        return;
      }

      const repoInfo = (await createRes.json()) as {
        full_name: string;
        html_url: string;
        default_branch: string;
        owner: { login: string };
      };
      const fullName = repoInfo.full_name;
      const branch = repoInfo.default_branch || 'main';

      // 2. Fetch current HEAD commit & base tree
      const refRes = await ghFetch(
        `https://api.github.com/repos/${fullName}/git/ref/heads/${branch}`,
        token
      );
      const refData = (await refRes.json()) as { object: { sha: string } };
      const parentSha = refData.object.sha;

      // 3. Upload all source & asset files as Git Blobs
      const files = collectProjectFiles(rootDir);
      const treeEntries: Array<{
        path: string;
        mode: '100644';
        type: 'blob';
        sha: string;
      }> = [];

      for (const file of files) {
        const contentBase64 = fs.readFileSync(file.absPath).toString('base64');
        const blobRes = await ghFetch(
          `https://api.github.com/repos/${fullName}/git/blobs`,
          token,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: contentBase64,
              encoding: 'base64',
            }),
          }
        );
        if (blobRes.ok) {
          const blobData = (await blobRes.json()) as { sha: string };
          treeEntries.push({
            path: file.relPath,
            mode: '100644',
            type: 'blob',
            sha: blobData.sha,
          });
        }
      }

      // 4. Create Git Tree & Commit
      const treeRes = await ghFetch(
        `https://api.github.com/repos/${fullName}/git/trees`,
        token,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tree: treeEntries }),
        }
      );
      const treeData = (await treeRes.json()) as { sha: string };

      const commitRes = await ghFetch(
        `https://api.github.com/repos/${fullName}/git/commits`,
        token,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message:
              'feat: JBL PartyBox Stage 320 Hebrew control app with Lightshow & 7-band EQ',
            tree: treeData.sha,
            parents: [parentSha],
          }),
        }
      );
      const commitData = (await commitRes.json()) as { sha: string };

      await ghFetch(
        `https://api.github.com/repos/${fullName}/git/refs/heads/${branch}`,
        token,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sha: commitData.sha, force: true }),
        }
      );

      // 5. Create GitHub Release v1.0.0 and attach both signed APK and ZIP binary assets
      let releaseUrl: string | null = null;
      const releaseRes = await ghFetch(
        `https://api.github.com/repos/${fullName}/releases`,
        token,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tag_name: 'v1.0.0',
            name: 'JBL PartyBox 320 Hebrew Control v1.0.0 (Android APK)',
            body: 'גרסה ראשונה של אפליקציית השליטה בעברית ל-JBL PartyBox Stage 320 כולל קובץ APK חתום לאנדרואיד וארכיון ZIP.',
            draft: false,
            prerelease: false,
          }),
        }
      );

      if (releaseRes.ok) {
        const relData = (await releaseRes.json()) as {
          html_url: string;
          upload_url: string;
        };
        releaseUrl = relData.html_url;
        const uploadBase = relData.upload_url.split('{')[0];

        const apkPath = resolveStaticBinary(APK_FILENAME);
        if (apkPath) {
          const apkBytes = fs.readFileSync(apkPath);
          await ghFetch(
            `${uploadBase}?name=${encodeURIComponent(APK_FILENAME)}`,
            token,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/vnd.android.package-archive',
                'Content-Length': String(apkBytes.byteLength),
              },
              body: apkBytes,
            }
          );
        }

        const zipPath = resolveStaticBinary(ZIP_FILENAME);
        if (zipPath) {
          const zipBytes = fs.readFileSync(zipPath);
          await ghFetch(
            `${uploadBase}?name=${encodeURIComponent(ZIP_FILENAME)}`,
            token,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/zip',
                'Content-Length': String(zipBytes.byteLength),
              },
              body: zipBytes,
            }
          );
        }
      }

      res.json({
        ok: true,
        repoUrl: repoInfo.html_url,
        releaseUrl,
        filesCount: treeEntries.length,
      });
    } catch (err) {
      res.status(500).json({
        error:
          err instanceof Error
            ? err.message
            : 'שגיאה בלתי צפויה בהעלאת הפרויקט ל-GitHub',
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(rootDir, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
