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

const SOURCE_ZIP_FILENAME = 'JBL-PartyBox-320-Native-Source.zip';

function getSessionFilePaths(rootDir: string): string[] {
  return [
    path.resolve(rootDir, '.gh_device_session.json'),
    '/tmp/gh_device_session.json',
  ];
}

function loadSession(rootDir: string): PersistedDeviceSession {
  for (const file of getSessionFilePaths(rootDir)) {
    try {
      if (fs.existsSync(file)) {
        const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
        return { ...DEFAULT_SESSION, ...raw };
      }
    } catch {
      // ignore
    }
  }
  return { ...DEFAULT_SESSION };
}

function saveSession(rootDir: string, session: PersistedDeviceSession): void {
  const payload = JSON.stringify(session, null, 2);
  for (const file of getSessionFilePaths(rootDir)) {
    try {
      fs.writeFileSync(file, payload, {
        encoding: 'utf-8',
        mode: 0o600,
      });
    } catch {
      // ignore
    }
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
    return pkg.version || '0.3.0';
  } catch {
    return '0.3.0';
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
  headers.set('User-Agent', 'JBL-PartyBox-320-Native-Publisher');
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

  return maxNum === 0 ? 'v1' : `v${maxNum + 1}`;
}

function ensureGitRepoInitialized(rootDir: string): void {
  const gitDir = path.resolve(rootDir, '.git');
  if (!fs.existsSync(gitDir)) {
    execFileSync('git', ['init', '-b', 'main'], { cwd: rootDir, stdio: 'ignore' });
  }
  try {
    execFileSync('git', ['config', 'user.name', 'Ash HaTorah'], {
      cwd: rootDir,
      stdio: 'ignore',
    });
    execFileSync('git', ['config', 'user.email', 'ES2323ES@users.noreply.github.com'], {
      cwd: rootDir,
      stdio: 'ignore',
    });
  } catch {
    // ignore
  }
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
  const description = `אפליקציית שליטה נייטיב בעברית לרמקול JBL PartyBox Stage 320 (גרסה ${appVersion}) — 100% Native Android (Java), אייקוני SVG, איקוולייזר חומרתי ועדכון אוטומטי מ-GitHub Releases`;

  let repoInfo: { full_name: string; html_url: string } | null = null;
  const existingRepoRes = await ghFetch(
    `https://api.github.com/repos/${username}/${cleanBaseName}`,
    token
  );
  if (existingRepoRes.ok) {
    repoInfo = (await existingRepoRes.json()) as {
      full_name: string;
      html_url: string;
    };
    await ghFetch(`https://api.github.com/repos/${repoInfo.full_name}`, token, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description }),
    }).catch(() => {});
  } else {
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
  ensureGitRepoInitialized(rootDir);
  const nextTag = await computeNextSequentialReleaseTag(fullName, token);

  try {
    execFileSync('git', ['add', '-A'], { cwd: rootDir, stdio: 'ignore' });
    execFileSync(
      'git',
      [
        'commit',
        '-m',
        `release(${nextTag}): JBL PartyBox 320 Hebrew v${appVersion} — 100% Native Android App, SVG UI, GitHub Auto-Update & CI`,
      ],
      { cwd: rootDir, stdio: 'ignore' }
    );
  } catch {
    // Working tree clean
  }

  try {
    execFileSync('git', ['tag', '-f', nextTag, 'HEAD'], {
      cwd: rootDir,
      stdio: 'ignore',
    });
  } catch {
    // ignore
  }

  const pushUrl = `https://x-access-token:${encodeURIComponent(token)}@github.com/${fullName}.git`;
  execFileSync(
    'git',
    ['push', '--force', pushUrl, 'HEAD:refs/heads/main', `refs/tags/${nextTag}`],
    { cwd: rootDir, stdio: 'pipe' }
  );

  const apkPath = resolveStaticBinary(APK_FILENAME);
  const zipPath = resolveStaticBinary(ZIP_FILENAME);
  const apkSha = apkPath
    ? crypto.createHash('sha256').update(fs.readFileSync(apkPath)).digest('hex')
    : '—';
  const zipSha = zipPath
    ? crypto.createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex')
    : '—';
  const apkKb = apkPath ? `${Math.round(fs.statSync(apkPath).size / 1024)} KB` : '—';
  const zipKb = zipPath ? `${Math.round(fs.statSync(zipPath).size / 1024)} KB` : '—';

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
        name: `JBL PartyBox 320 Hebrew ${nextTag} — Native Android v${appVersion}`,
        body: [
          `## JBL PartyBox Stage 320 — אפליקציית שליטה Native בעברית (${nextTag})`,
          '',
          `שחרור רשמי **${nextTag}** (גרסת אפליקציה \`${appVersion}\`) עבור הרמקול **JBL PartyBox Stage 320**.`,
          'אפליקציה זו כתובה ב-**100% Native Android (Java)** ללא WebView וללא HTML — לביצועים מיידיים, אמינות מרבית ומשקל קובץ מזערי.',
          '',
          '### עיקרי היכולות והממשק:',
          '- **ביצועי Native מלאים וכל האייקונים ב-Vector SVG**: הזנקה מיידית ותגובה חלקה ללא ריצודים.',
          '- **מסך הגדרות (צד ימין למעלה)**: מצב בהיר / כהה / מערכת, מדריך שימוש מפורט, ו**עדכון אוטומטי מ-GitHub Releases** (לפי תג).',
          '- **מסך אודות (צד שמאל למעלה)**: קרדיט למפתח **״אש התורה״** עם קישורים ישירים לפרופיל ב-[GitHub](https://github.com/ES2323ES) וב-[מתמחים טופ](https://mitmachim.top/user/%D7%90%D7%A9-%D7%94%D7%AA%D7%95%D7%A8%D7%94), פירוט גרסה ו״מה חדש״.',
          '- **שורה תחתונה קבועה למעבר מהיר (מימין לשמאל)**:',
          '  1. **חיבור ופרטי בוקסה**: סריקה וחיבור (BLE GATT + SPP + A2DP), שם הבוקסה, אחוז סוללה, גרסת קושחה ועוצמת קליטה.',
          '  2. **שליטה ותאורה**: עוצמה ראשית, Bass Boost, תאורת מופע (כולל ניאון), צבעים, 5 אזורי תאורה וכניסת מיקרופון.',
          '  3. **איקוולייזר חומרתי**: 7 ערוצי תדר (`63Hz`–`12kHz`), פרופילים מובנים ושמירת פרופילים אישיים.',
          '  4. **בחירת שירים ונגן**: סריקת שירי המכשיר (`MediaStore` / בחירת קבצים), חיפוש, נגן מובנה ושליטה בנגן המערכת.',
          '  5. **הגדרות הבוקסה**: צלילי חיווי מערכת בבוקסה, Playtime Boost, מצב פנים/חוץ, סטריאו/Auracast ופרוטוקול שידור.',
          '',
          '### קבצים מצורפים ואימות SHA-256:',
          '| קובץ | תיאור | גודל | SHA-256 |',
          '| :--- | :--- | :--- | :--- |',
          `| \`${APK_FILENAME}\` | קובץ התקנה ישיר וחתום לאנדרואיד (Native Android) | ${apkKb} | \`${apkSha}\` |`,
          `| \`${ZIP_FILENAME}\` | ארכיון ZIP עם ה-APK ומדריך התקנה בעברית | ${zipKb} | \`${zipSha}\` |`,
          '',
          '---',
          'פותח על ידי **״אש התורה״** · [GitHub](https://github.com/ES2323ES) · [מתמחים טופ](https://mitmachim.top/user/%D7%90%D7%A9-%D7%94%D7%AA%D7%95%D7%A8%D7%94)',
        ].join('\n'),
        draft: false,
        prerelease: false,
      }),
    }
  );

  let relData: { html_url: string; upload_url: string } | null = null;
  if (releaseRes.ok) {
    relData = (await releaseRes.json()) as {
      html_url: string;
      upload_url: string;
    };
  } else {
    const existingRel = await ghFetch(
      `https://api.github.com/repos/${fullName}/releases/tags/${nextTag}`,
      token
    );
    if (existingRel.ok) {
      relData = (await existingRel.json()) as {
        html_url: string;
        upload_url: string;
      };
    }
  }

  if (relData) {
    releaseUrl = relData.html_url;
    const uploadBase = relData.upload_url.split('{')[0];

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
    deployKeyInstalled: true,
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
      // retry next tick
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

  const ensureSourceArchive = (): string | null => {
    const outZip = path.join('/tmp', SOURCE_ZIP_FILENAME);
    try {
      execFileSync(
        'python3',
        [
          '-c',
          `
import os, zipfile
root = ${JSON.stringify(rootDir)}
out = ${JSON.stringify(outZip)}
skip_dirs = {'node_modules', '.git', 'dist', 'build', '.gradle', 'coverage'}
with zipfile.ZipFile(out, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in skip_dirs]
        rel_dir = os.path.relpath(dirpath, root)
        if rel_dir.startswith('app/build'):
            continue
        for fn in filenames:
            if (fn.startswith('.env') and fn != '.env.example') or fn == '.gh_device_session.json':
                continue
            full = os.path.join(dirpath, fn)
            arc = os.path.relpath(full, root)
            zf.write(full, arc)
`,
        ],
        { cwd: rootDir, stdio: 'ignore' }
      );
      if (fs.existsSync(outZip)) return outZip;
    } catch {
      // ignore
    }
    return null;
  };

  const serveSourceZip: express.RequestHandler = (req, res) => {
    const filePath = ensureSourceArchive();
    if (!filePath) {
      res.status(500).json({ error: 'Failed to package Native source archive' });
      return;
    }
    const stat = fs.statSync(filePath);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${SOURCE_ZIP_FILENAME}"`);
    res.setHeader('Content-Length', String(stat.size));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'HEAD') {
      res.status(200).end();
      return;
    }
    fs.createReadStream(filePath).pipe(res);
  };

  app.get('/api/download-zip', serveZip);
  app.head('/api/download-zip', serveZip);
  app.get(`/${ZIP_FILENAME}`, serveZip);
  app.head(`/${ZIP_FILENAME}`, serveZip);

  app.get('/api/download-apk', serveApk);
  app.head('/api/download-apk', serveApk);
  app.get(`/${APK_FILENAME}`, serveApk);
  app.head(`/${APK_FILENAME}`, serveApk);

  app.get('/api/download-source-zip', serveSourceZip);
  app.head('/api/download-source-zip', serveSourceZip);
  app.get(`/${SOURCE_ZIP_FILENAME}`, serveSourceZip);
  app.head(`/${SOURCE_ZIP_FILENAME}`, serveSourceZip);

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

    deviceSession = { ...deviceSession, status: 'publishing', error: null };
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
