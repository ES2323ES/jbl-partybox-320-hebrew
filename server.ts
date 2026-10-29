import { execFileSync } from 'child_process';
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

interface PersistedDeviceSession {
  status:
    | 'idle'
    | 'awaiting_user'
    | 'publishing'
    | 'completed'
    | 'expired'
    | 'error';
  deviceCode: string | null;
  userCode: string | null;
  verificationUri: string;
  repoName: string;
  isPrivate: boolean;
  intervalSec: number;
  expiresAt: number | null;
  accessToken: string | null;
  username: string | null;
  repoUrl: string | null;
  releaseUrl: string | null;
  latestReleaseTag: string | null;
  deployKeyInstalled: boolean;
  error: string | null;
}

const DEFAULT_SESSION: PersistedDeviceSession = {
  status: 'idle',
  deviceCode: null,
  userCode: null,
  verificationUri: 'https://github.com/login/device',
  repoName: 'jbl-partybox-320-hebrew',
  isPrivate: false,
  intervalSec: 5,
  expiresAt: null,
  accessToken: null,
  username: 'ES2323ES',
  repoUrl: 'https://github.com/ES2323ES/jbl-partybox-320-hebrew',
  releaseUrl: null,
  latestReleaseTag: null,
  deployKeyInstalled: false,
  error: null,
};

function getSessionFilePath(rootDir: string): string {
  const gitDir = path.resolve(rootDir, '.git');
  if (fs.existsSync(gitDir)) {
    return path.join(gitDir, 'gh_device_session.json');
  }
  return '/tmp/gh_device_session.json';
}

function loadSession(rootDir: string): PersistedDeviceSession {
  const file = getSessionFilePath(rootDir);
  try {
    if (fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
      return { ...DEFAULT_SESSION, ...raw };
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_SESSION };
}

function saveSession(rootDir: string, session: PersistedDeviceSession): void {
  const file = getSessionFilePath(rootDir);
  try {
    fs.writeFileSync(file, JSON.stringify(session, null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
    });
  } catch {
    // ignore
  }
}

function publicSessionView(s: PersistedDeviceSession) {
  return {
    status: s.status,
    userCode: s.userCode,
    verificationUri: s.verificationUri,
    repoName: s.repoName,
    isPrivate: s.isPrivate,
    expiresAt: s.expiresAt,
    username: s.username,
    repoUrl: s.repoUrl,
    releaseUrl: s.releaseUrl,
    latestReleaseTag: s.latestReleaseTag,
    hasPermanentKey: Boolean(s.accessToken || process.env.GITHUB_TOKEN?.trim()),
    deployKeyInstalled: Boolean(s.deployKeyInstalled),
    error: s.error,
  };
}

function getAppVersion(rootDir: string): string {
  try {
    const pkgPath = path.resolve(rootDir, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as {
      version?: string;
    };
    return pkg.version || '0.2.2';
  } catch {
    return '0.2.2';
  }
}

function ensureLocalSshDeployKey(rootDir: string): {
  privateKeyPath: string;
  publicKey: string | null;
} {
  const gitDir = path.resolve(rootDir, '.git');
  const keyPath = path.join(gitDir, 'jbl_deploy_ed25519');
  const pubPath = `${keyPath}.pub`;
  try {
    if (!fs.existsSync(pubPath)) {
      execFileSync(
        'ssh-keygen',
        [
          '-t',
          'ed25519',
          '-C',
          'jbl-partybox-320-permanent-key',
          '-f',
          keyPath,
          '-N',
          '',
        ],
        { stdio: 'ignore' }
      );
      fs.chmodSync(keyPath, 0o600);
    }
    const pub = fs.readFileSync(pubPath, 'utf-8').trim();
    return { privateKeyPath: keyPath, publicKey: pub };
  } catch {
    return { privateKeyPath: keyPath, publicKey: null };
  }
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

async function computeNextSequentialReleaseTag(
  fullName: string,
  token: string
): Promise<string> {
  let maxNum = 0;

  try {
    const relRes = await ghFetch(
      `https://api.github.com/repos/${fullName}/releases?per_page=100`,
      token
    );
    if (relRes.ok) {
      const releases = (await relRes.json()) as Array<{ tag_name?: string }>;
      for (const r of releases) {
        const m = /^v(\d+)/i.exec(r.tag_name || '');
        if (m) {
          const n = Number(m[1]);
          if (n > maxNum) maxNum = n;
        }
      }
    }
  } catch {
    // ignore
  }

  try {
    const tagRes = await ghFetch(
      `https://api.github.com/repos/${fullName}/tags?per_page=100`,
      token
    );
    if (tagRes.ok) {
      const tags = (await tagRes.json()) as Array<{ name?: string }>;
      for (const t of tags) {
        const m = /^v(\d+)/i.exec(t.name || '');
        if (m) {
          const n = Number(m[1]);
          if (n > maxNum) maxNum = n;
        }
      }
    }
  } catch {
    // ignore
  }

  if (maxNum === 0) {
    return 'v1';
  }
  return `v${maxNum + 1}`;
}

async function registerPermanentDeployKey(
  rootDir: string,
  fullName: string,
  token: string
): Promise<boolean> {
  const { privateKeyPath, publicKey } = ensureLocalSshDeployKey(rootDir);
  if (!publicKey) return false;

  let installed = false;
  try {
    const existingKeysRes = await ghFetch(
      `https://api.github.com/repos/${fullName}/keys?per_page=100`,
      token
    );
    if (existingKeysRes.ok) {
      const keys = (await existingKeysRes.json()) as Array<{ key?: string }>;
      const rawKeyPart = publicKey.split(' ').slice(0, 2).join(' ');
      if (keys.some((k) => (k.key || '').startsWith(rawKeyPart))) {
        installed = true;
      }
    }

    if (!installed) {
      const addRes = await ghFetch(
        `https://api.github.com/repos/${fullName}/keys`,
        token,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'JBL PartyBox 320 App — Permanent Deploy Key',
            key: publicKey,
            read_only: false,
          }),
        }
      );
      if (addRes.ok || addRes.status === 422) {
        installed = true;
      }
    }

    if (installed) {
      try {
        execFileSync(
          'git',
          [
            'config',
            'core.sshCommand',
            `ssh -i ${privateKeyPath} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`,
          ],
          { cwd: rootDir, stdio: 'ignore' }
        );
        try {
          execFileSync(
            'git',
            ['remote', 'set-url', 'origin', `git@github.com:${fullName}.git`],
            { cwd: rootDir, stdio: 'ignore' }
          );
        } catch {
          execFileSync(
            'git',
            ['remote', 'add', 'origin', `git@github.com:${fullName}.git`],
            { cwd: rootDir, stdio: 'ignore' }
          );
        }
      } catch {
        // ignore git config warning
      }
    }
  } catch {
    // ignore deploy key registration errors
  }

  return installed;
}

async function syncRepoAndPublishNextRelease(
  rootDir: string,
  token: string,
  requestedName: string,
  isPrivate: boolean,
  resolveStaticBinary: (name: string) => string | null
): Promise<{
  username: string;
  repoUrl: string;
  releaseUrl: string | null;
  latestReleaseTag: string;
  deployKeyInstalled: boolean;
}> {
  const userRes = await ghFetch('https://api.github.com/user', token);
  if (!userRes.ok) {
    throw new Error(`אימות משתמש ב-GitHub נכשל (HTTP ${userRes.status})`);
  }
  const userData = (await userRes.json()) as { login: string };
  const username = userData.login;

  const cleanBaseName =
    requestedName.trim().replace(/[^a-zA-Z0-9._-]/g, '-') ||
    'jbl-partybox-320-hebrew';
  const appVersion = getAppVersion(rootDir);
  const description = `אפליקציית שליטה ייעודית בעברית לרמקול JBL PartyBox Stage 320 (גרסה ${appVersion}) — תאורת מופע, איקוולייזר 7 ערוצים, חיבור Bluetooth וקובץ APK`;

  let repoInfo: { full_name: string; html_url: string } | null = null;

  // 1. Check if the target repository already exists so we update it in place!
  const existingRepoRes = await ghFetch(
    `https://api.github.com/repos/${username}/${cleanBaseName}`,
    token
  );
  if (existingRepoRes.ok) {
    repoInfo = (await existingRepoRes.json()) as {
      full_name: string;
      html_url: string;
    };
    // Update repo description to reflect current version
    await ghFetch(`https://api.github.com/repos/${repoInfo.full_name}`, token, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description }),
    }).catch(() => {});
  } else {
    // Create the repository if it does not exist yet
    const createRes = await ghFetch('https://api.github.com/user/repos', token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: cleanBaseName,
        description,
        private: isPrivate,
        auto_init: false,
      }),
    });
    if (!createRes.ok) {
      const errJson = (await createRes.json().catch(() => ({}))) as {
        message?: string;
      };
      throw new Error(
        `יצירת או פתיחת המאגר נכשלה: ${errJson.message || createRes.status}`
      );
    }
    repoInfo = (await createRes.json()) as {
      full_name: string;
      html_url: string;
    };
  }

  const fullName = repoInfo.full_name;

  // 2. Register permanent Ed25519 SSH Deploy Key on the repository
  const deployKeyInstalled = await registerPermanentDeployKey(
    rootDir,
    fullName,
    token
  );

  // 3. Determine next sequential release tag (v2, v3, v4...) BEFORE pushing so we can tag HEAD cleanly!
  const nextTag = await computeNextSequentialReleaseTag(fullName, token);

  // 4. Commit any pending changes and tag HEAD with nextTag (so GitHub Actions sees HEAD is already tagged and won't double-release)
  try {
    execFileSync('git', ['add', '-A'], { cwd: rootDir, stdio: 'ignore' });
    execFileSync(
      'git',
      [
        'commit',
        '-m',
        `release(${nextTag}): JBL PartyBox 320 Hebrew v${appVersion} — soothing UI, Bluetooth permissions & permanent key`,
      ],
      { cwd: rootDir, stdio: 'ignore' }
    );
  } catch {
    // Working tree already clean
  }

  try {
    execFileSync('git', ['tag', '-f', nextTag, 'HEAD'], {
      cwd: rootDir,
      stdio: 'ignore',
    });
  } catch {
    // ignore tag warning
  }

  // 5. Push main branch + new sequential tag to GitHub
  const pushUrl = `https://x-access-token:${encodeURIComponent(token)}@github.com/${fullName}.git`;
  execFileSync(
    'git',
    ['push', '--force', pushUrl, 'HEAD:refs/heads/main', `refs/tags/${nextTag}`],
    {
      cwd: rootDir,
      stdio: 'pipe',
    }
  );

  // 6. Create GitHub Release (v2, v3, v4...) and attach compiled APK + ZIP
  let releaseUrl: string | null = null;
  const releaseRes = await ghFetch(
    `https://api.github.com/repos/${fullName}/releases`,
    token,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tag_name: nextTag,
        target_commitish: 'main',
        name: `JBL PartyBox 320 Hebrew ${nextTag} — גרסה ${appVersion}`,
        body: [
          `שחרור אוטומטי **${nextTag}** (גרסת אפליקציה \`${appVersion}\`) עבור הרמקול **JBL PartyBox Stage 320**.`,
          '',
          '### מה התחדש בעדכון זה:',
          `- **גרסת אפליקציה**: \`${appVersion}\``,
          '- **עיצוב נעים לעין**: פלטת Soft Daylight Studio רכה ומאוזנת כברירת מחדל + מצב ערב רך (Soft Evening Slate).',
          '- **הרשאות ואינטגרציית Bluetooth מלאה**: הרשאות סריקה וחיבור Bluetooth באנדרואיד, זיהוי רמקולי JBL מזווגים, שליטה בווליום חומרתי וסנכרון איקוולייזר.',
          '- **מפתח GitHub קבוע וגרסאות רצות (`v2`, `v3`, `v4`...)**: כל עדכון מעלה אוטומטית גרסה ממוספרת חדשה.',
          '',
          '### קבצים מצורפים להורדה ישירה:',
          '- `JBL-PartyBox-320-HE-APK.zip` — ארכיון ZIP הכולל את ה-APK המעודכן והוראות התקנה',
          '- `JBL-PartyBox-320-HE.apk` — קובץ התקנה ישיר וחתום לאנדרואיד',
        ].join('\n'),
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
    latestReleaseTag: nextTag,
    deployKeyInstalled,
  };
}

async function startServer() {
  const app = express();
  app.use(express.json());
  const rootDir = import.meta.dirname;

  let deviceSession = loadSession(rootDir);
  let activePollTimer: ReturnType<typeof setTimeout> | null = null;
  let isCheckingNow = false;

  const resolveStaticBinary = (fileName: string): string | null => {
    const publicFile = path.resolve(rootDir, 'public', fileName);
    if (fs.existsSync(publicFile)) return publicFile;
    const distFile = path.resolve(rootDir, 'dist', fileName);
    if (fs.existsSync(distFile)) return distFile;
    return null;
  };

  const checkAndPublishOnce = async (): Promise<void> => {
    if (isCheckingNow) return;
    deviceSession = loadSession(rootDir);

    if (deviceSession.status !== 'awaiting_user' || !deviceSession.deviceCode) {
      return;
    }

    if (deviceSession.expiresAt && Date.now() > deviceSession.expiresAt) {
      deviceSession.status = 'expired';
      deviceSession.error = 'פג תוקף קוד האישור — לחץ להפקת קוד חדש.';
      saveSession(rootDir, deviceSession);
      return;
    }

    isCheckingNow = true;
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
            device_code: deviceSession.deviceCode,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          }).toString(),
        }
      );

      const tokenData = (await tokenRes.json()) as {
        access_token?: string;
        error?: string;
      };

      if (tokenData.access_token) {
        // Persist accessToken permanently in .git/gh_device_session.json (never committed to git)
        deviceSession.accessToken = tokenData.access_token;
        deviceSession.deviceCode = null;
        deviceSession.userCode = null;
        deviceSession.status = 'publishing';
        saveSession(rootDir, deviceSession);

        try {
          const out = await syncRepoAndPublishNextRelease(
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
            latestReleaseTag: out.latestReleaseTag,
            deployKeyInstalled: out.deployKeyInstalled,
            error: null,
          };
          saveSession(rootDir, deviceSession);
        } catch (pubErr) {
          deviceSession = {
            ...deviceSession,
            status: 'error',
            error:
              pubErr instanceof Error
                ? pubErr.message
                : 'שגיאה בעדכון המאגר ב-GitHub',
          };
          saveSession(rootDir, deviceSession);
        }
        return;
      }

      if (tokenData.error === 'slow_down') {
        deviceSession.intervalSec = (deviceSession.intervalSec || 5) + 5;
        saveSession(rootDir, deviceSession);
      } else if (
        tokenData.error === 'expired_token' ||
        tokenData.error === 'access_denied'
      ) {
        deviceSession.status = 'expired';
        deviceSession.error =
          tokenData.error === 'access_denied'
            ? 'האישור בוטל על ידי המשתמש.'
            : 'פג תוקף הקוד — לחץ ליצירת קוד חדש.';
        saveSession(rootDir, deviceSession);
        return;
      }
    } catch {
      // network hiccup, retry next tick
    } finally {
      isCheckingNow = false;
    }

    scheduleNextPoll();
  };

  const scheduleNextPoll = () => {
    if (activePollTimer) {
      clearTimeout(activePollTimer);
      activePollTimer = null;
    }
    if (deviceSession.status === 'awaiting_user') {
      const waitMs = Math.max(5500, (deviceSession.intervalSec || 5) * 1000 + 500);
      activePollTimer = setTimeout(() => {
        checkAndPublishOnce().catch(() => {});
      }, waitMs);
    }
  };

  if (deviceSession.status === 'awaiting_user' && deviceSession.deviceCode) {
    scheduleNextPoll();
  }

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

  app.get('/api/github/device/state', async (_req, res) => {
    deviceSession = loadSession(rootDir);
    res.json(publicSessionView(deviceSession));
  });

  app.post('/api/github/device/sync', async (_req, res) => {
    await checkAndPublishOnce();
    deviceSession = loadSession(rootDir);
    res.json(publicSessionView(deviceSession));
  });

  // Push a new update & automatically create next sequential release (v2, v3, v4...) using the permanent key!
  app.post('/api/github/push-update', async (_req, res) => {
    deviceSession = loadSession(rootDir);
    const savedToken =
      deviceSession.accessToken || process.env.GITHUB_TOKEN?.trim() || null;

    if (!savedToken) {
      res.status(401).json({
        ...publicSessionView(deviceSession),
        error: 'טרם נשמר מפתח קבוע — בצע אישור חד-פעמי לשמירת המפתח הקבוע.',
      });
      return;
    }

    deviceSession = {
      ...deviceSession,
      status: 'publishing',
      error: null,
    };
    saveSession(rootDir, deviceSession);

    try {
      const out = await syncRepoAndPublishNextRelease(
        rootDir,
        savedToken,
        deviceSession.repoName || 'jbl-partybox-320-hebrew',
        deviceSession.isPrivate,
        resolveStaticBinary
      );
      deviceSession = {
        ...deviceSession,
        status: 'completed',
        username: out.username,
        repoUrl: out.repoUrl,
        releaseUrl: out.releaseUrl,
        latestReleaseTag: out.latestReleaseTag,
        deployKeyInstalled: out.deployKeyInstalled,
        error: null,
      };
      saveSession(rootDir, deviceSession);
      res.json(publicSessionView(deviceSession));
    } catch (err) {
      deviceSession = {
        ...deviceSession,
        status: 'error',
        error: err instanceof Error ? err.message : 'שגיאה בפרסום עדכון ל-GitHub',
      };
      saveSession(rootDir, deviceSession);
      res.status(500).json(publicSessionView(deviceSession));
    }
  });

  app.post('/api/github/device/start', async (req, res) => {
    deviceSession = loadSession(rootDir);
    const repoName =
      typeof req.body?.repoName === 'string' && req.body.repoName.trim()
        ? req.body.repoName.trim()
        : 'jbl-partybox-320-hebrew';
    const isPrivate = Boolean(req.body?.isPrivate);

    const existingToken =
      deviceSession.accessToken || process.env.GITHUB_TOKEN?.trim() || null;

    if (existingToken && req.body?.forceNewAuth !== true) {
      deviceSession = {
        ...deviceSession,
        status: 'publishing',
        repoName,
        isPrivate,
        error: null,
      };
      saveSession(rootDir, deviceSession);
      res.json(publicSessionView(deviceSession));

      syncRepoAndPublishNextRelease(
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
            latestReleaseTag: out.latestReleaseTag,
            deployKeyInstalled: out.deployKeyInstalled,
            error: null,
          };
          saveSession(rootDir, deviceSession);
        })
        .catch((err) => {
          deviceSession = {
            ...deviceSession,
            status: 'error',
            error: err instanceof Error ? err.message : 'שגיאה בהעלאה ל-GitHub',
          };
          saveSession(rootDir, deviceSession);
        });
      return;
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
          scope: 'repo workflow admin:public_key',
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

      deviceSession = {
        status: 'awaiting_user',
        deviceCode: codeData.device_code,
        userCode: codeData.user_code,
        verificationUri:
          codeData.verification_uri || 'https://github.com/login/device',
        repoName,
        isPrivate,
        intervalSec: codeData.interval || 5,
        expiresAt: Date.now() + codeData.expires_in * 1000,
        accessToken: null,
        username: deviceSession.username || 'ES2323ES',
        repoUrl:
          deviceSession.repoUrl ||
          'https://github.com/ES2323ES/jbl-partybox-320-hebrew',
        releaseUrl: deviceSession.releaseUrl,
        latestReleaseTag: deviceSession.latestReleaseTag,
        deployKeyInstalled: deviceSession.deployKeyInstalled,
        error: null,
      };
      saveSession(rootDir, deviceSession);
      scheduleNextPoll();

      res.json(publicSessionView(deviceSession));
    } catch {
      res.status(500).json({ error: 'שגיאה ביצירת חיבור מול GitHub' });
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
