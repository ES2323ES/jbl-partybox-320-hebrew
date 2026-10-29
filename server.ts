import { execFileSync } from 'child_process';
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
const GH_DEVICE_CLIENT_ID = '178c6fc778ccc68e1d6a';
const PUBLISHED_RESULT_FILE = '/tmp/gh_published_repo.json';

interface DeviceFlowSession {
  status:
    | 'idle'
    | 'awaiting_user'
    | 'publishing'
    | 'completed'
    | 'expired'
    | 'error';
  userCode: string | null;
  verificationUri: string;
  repoName: string;
  isPrivate: boolean;
  expiresAt: number | null;
  username: string | null;
  repoUrl: string | null;
  releaseUrl: string | null;
  error: string | null;
}

let deviceSession: DeviceFlowSession = {
  status: 'idle',
  userCode: null,
  verificationUri: 'https://github.com/login/device',
  repoName: 'jbl-partybox-320-hebrew',
  isPrivate: false,
  expiresAt: null,
  username: null,
  repoUrl: null,
  releaseUrl: null,
  error: null,
};

let activePollTimer: ReturnType<typeof setTimeout> | null = null;
let connectedGithubToken: string | null = null;

// Restore previous completed state if server restarted after publish
try {
  if (fs.existsSync(PUBLISHED_RESULT_FILE)) {
    const saved = JSON.parse(fs.readFileSync(PUBLISHED_RESULT_FILE, 'utf-8'));
    if (saved?.repoUrl) {
      deviceSession = { ...deviceSession, ...saved, status: 'completed' };
    }
  }
} catch {
  // ignore
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

async function createAndPushGithubRepo(
  rootDir: string,
  token: string,
  requestedName: string,
  isPrivate: boolean,
  resolveStaticBinary: (name: string) => string | null
): Promise<{ username: string; repoUrl: string; releaseUrl: string | null }> {
  // 1. Identify authenticated GitHub user
  const userRes = await ghFetch('https://api.github.com/user', token);
  if (!userRes.ok) {
    throw new Error(`אימות משתמש ב-GitHub נכשל (HTTP ${userRes.status})`);
  }
  const userData = (await userRes.json()) as { login: string };
  const username = userData.login;

  const cleanBaseName =
    requestedName.trim().replace(/[^a-zA-Z0-9._-]/g, '-') ||
    'jbl-partybox-320-hebrew';
  const description =
    'אפליקציית שליטה ייעודית בעברית לרמקול JBL PartyBox Stage 320 כולל תאורת מופע, איקוולייזר 7 ערוצים וקובץ APK לאנדרואיד';

  // 2. Create brand-new GitHub repository (fallback with suffix if name already exists)
  let repoInfo: { full_name: string; html_url: string } | null = null;
  const candidateNames = [
    cleanBaseName,
    `${cleanBaseName}-app`,
    `${cleanBaseName}-${Math.floor(100 + Math.random() * 900)}`,
  ];

  let lastErr = '';
  for (const candidate of candidateNames) {
    const createRes = await ghFetch('https://api.github.com/user/repos', token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: candidate,
        description,
        private: isPrivate,
        auto_init: false,
      }),
    });

    if (createRes.ok) {
      repoInfo = (await createRes.json()) as {
        full_name: string;
        html_url: string;
      };
      break;
    } else {
      const errJson = (await createRes.json().catch(() => ({}))) as {
        message?: string;
        errors?: Array<{ message?: string }>;
      };
      lastErr = errJson.errors?.[0]?.message || errJson.message || `HTTP ${createRes.status}`;
      if (createRes.status !== 422) {
        break;
      }
    }
  }

  if (!repoInfo) {
    throw new Error(`יצירת המאגר נכשלה: ${lastErr}`);
  }

  const fullName = repoInfo.full_name;

  // 3. Ensure local git commit is up to date and push full repo to main
  try {
    execFileSync('git', ['add', '-A'], { cwd: rootDir, stdio: 'ignore' });
    execFileSync(
      'git',
      ['commit', '-m', 'chore: sync latest JBL PartyBox 320 build'],
      { cwd: rootDir, stdio: 'ignore' }
    );
  } catch {
    // Working tree already clean — proceed to push
  }

  const pushUrl = `https://x-access-token:${encodeURIComponent(token)}@github.com/${fullName}.git`;
  execFileSync('git', ['push', '--force', pushUrl, 'HEAD:refs/heads/main'], {
    cwd: rootDir,
    stdio: 'pipe',
  });

  // 4. Create GitHub Release v1.0.0 with signed APK & ZIP assets
  let releaseUrl: string | null = null;
  const releaseRes = await ghFetch(
    `https://api.github.com/repos/${fullName}/releases`,
    token,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tag_name: 'v1.0.0',
        target_commitish: 'main',
        name: 'JBL PartyBox 320 Hebrew Control v1.0.0 (Android APK + ZIP)',
        body: 'גרסה ראשונה ומוכנה להתקנה של אפליקציית השליטה בעברית לרמקול **JBL PartyBox Stage 320**.\n\n### קבצים מצורפים להורדה:\n- `JBL-PartyBox-320-HE-APK.zip` — ארכיון ZIP הכולל את ה-APK והוראות התקנה\n- `JBL-PartyBox-320-HE.apk` — קובץ התקנה ישיר וחתום לאנדרואיד',
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

  return {
    username,
    repoUrl: repoInfo.html_url,
    releaseUrl,
  };
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

  // --- GitHub Device Flow Automatic Repo Creator & Pusher ---

  app.get('/api/github/device/state', (_req, res) => {
    if (
      deviceSession.status === 'awaiting_user' &&
      deviceSession.expiresAt &&
      Date.now() > deviceSession.expiresAt
    ) {
      deviceSession.status = 'expired';
    }
    res.json(deviceSession);
  });

  app.post('/api/github/device/start', async (req, res) => {
    const repoName =
      typeof req.body?.repoName === 'string' && req.body.repoName.trim()
        ? req.body.repoName.trim()
        : 'jbl-partybox-320-hebrew';
    const isPrivate = Boolean(req.body?.isPrivate);

    // If already authenticated via previous session or GITHUB_TOKEN env, publish immediately!
    const existingToken = connectedGithubToken || process.env.GITHUB_TOKEN?.trim() || null;
    if (existingToken && req.body?.forceNewAuth !== true) {
      deviceSession = {
        status: 'publishing',
        userCode: null,
        verificationUri: 'https://github.com/login/device',
        repoName,
        isPrivate,
        expiresAt: null,
        username: deviceSession.username,
        repoUrl: null,
        releaseUrl: null,
        error: null,
      };
      res.json(deviceSession);

      createAndPushGithubRepo(
        rootDir,
        existingToken,
        repoName,
        isPrivate,
        resolveStaticBinary
      )
        .then((out) => {
          deviceSession = {
            ...deviceSession,
            status: 'completed',
            username: out.username,
            repoUrl: out.repoUrl,
            releaseUrl: out.releaseUrl,
            error: null,
          };
          fs.writeFileSync(PUBLISHED_RESULT_FILE, JSON.stringify(deviceSession, null, 2));
        })
        .catch((err) => {
          deviceSession = {
            ...deviceSession,
            status: 'error',
            error: err instanceof Error ? err.message : 'שגיאה בהעלאה ל-GitHub',
          };
        });
      return;
    }

    if (activePollTimer) {
      clearTimeout(activePollTimer);
      activePollTimer = null;
    }

    try {
      const codeRes = await fetch('https://github.com/login/device/code', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: GH_DEVICE_CLIENT_ID,
          scope: 'repo workflow',
        }).toString(),
      });

      if (!codeRes.ok) {
        res.status(502).json({ error: 'שגיאה בקבלת קוד אימות מ-GitHub' });
        return;
      }

      const codeData = (await codeRes.json()) as {
        device_code: string;
        user_code: string;
        verification_uri: string;
        expires_in: number;
        interval: number;
      };

      const expiresAt = Date.now() + codeData.expires_in * 1000;
      let pollIntervalMs = Math.max(5500, (codeData.interval || 5) * 1000 + 500);

      deviceSession = {
        status: 'awaiting_user',
        userCode: codeData.user_code,
        verificationUri: codeData.verification_uri || 'https://github.com/login/device',
        repoName,
        isPrivate,
        expiresAt,
        username: null,
        repoUrl: null,
        releaseUrl: null,
        error: null,
      };

      const pollOnce = async () => {
        if (deviceSession.status !== 'awaiting_user') return;
        if (Date.now() > expiresAt) {
          deviceSession.status = 'expired';
          return;
        }

        try {
          const tokenRes = await fetch(
            'https://github.com/login/oauth/access_token',
            {
              method: 'POST',
              headers: {
                Accept: 'application/json',
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: new URLSearchParams({
                client_id: GH_DEVICE_CLIENT_ID,
                device_code: codeData.device_code,
                grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
              }).toString(),
            }
          );

          const tokenData = (await tokenRes.json()) as {
            access_token?: string;
            error?: string;
          };

          if (tokenData.access_token) {
            connectedGithubToken = tokenData.access_token;
            deviceSession.status = 'publishing';

            try {
              const out = await createAndPushGithubRepo(
                rootDir,
                tokenData.access_token,
                deviceSession.repoName,
                deviceSession.isPrivate,
                resolveStaticBinary
              );
              deviceSession = {
                ...deviceSession,
                status: 'completed',
                username: out.username,
                repoUrl: out.repoUrl,
                releaseUrl: out.releaseUrl,
                error: null,
              };
              fs.writeFileSync(
                PUBLISHED_RESULT_FILE,
                JSON.stringify(deviceSession, null, 2)
              );
            } catch (pubErr) {
              deviceSession = {
                ...deviceSession,
                status: 'error',
                error:
                  pubErr instanceof Error
                    ? pubErr.message
                    : 'שגיאה ביצירת המאגר ב-GitHub',
              };
            }
            return;
          }

          if (tokenData.error === 'slow_down') {
            pollIntervalMs += 5000;
          } else if (
            tokenData.error === 'expired_token' ||
            tokenData.error === 'access_denied'
          ) {
            deviceSession = {
              ...deviceSession,
              status: 'expired',
              error:
                tokenData.error === 'access_denied'
                  ? 'האישור בוטל על ידי המשתמש.'
                  : 'פג תוקף הקוד — לחץ ליצירת קוד חדש.',
            };
            return;
          }
        } catch {
          // transient network error, continue polling
        }

        activePollTimer = setTimeout(pollOnce, pollIntervalMs);
      };

      activePollTimer = setTimeout(pollOnce, pollIntervalMs);
      res.json(deviceSession);
    } catch {
      res.status(500).json({ error: 'שגיאה ביצירת חיבור מול GitHub' });
    }
  });

  // Also keep /api/github/status for compatibility
  app.get('/api/github/status', (_req, res) => {
    res.json({
      connected: Boolean(connectedGithubToken || process.env.GITHUB_TOKEN?.trim()),
      username: deviceSession.username,
      deviceSession,
    });
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
