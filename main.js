'use strict';

/**
 * Saoirse — anime-inspired Electron desktop companion for DeepSeek Harness.
 *
 * Architecture:
 *   1. Find a free localhost port.
 *   2. Spawn the bundled `@deepseek-ai/dsh` CLI in "web" profile as a child
 *      process (this is the same backend that `dsh web` runs).
 *   3. Wait until the backend responds on 127.0.0.1:<port>.
 *   4. Open a native BrowserWindow pointing at that local URL.
 *
 * Desktop-product extras (on top of the plain web shell):
 *   - system tray + global shortcut to summon the window
 *   - minimize-to-tray (closing the window keeps the app alive)
 *   - completion notifications (heuristic: backend writes then goes idle)
 *   - desktop pet (transparent floating window)
 *   - launch at login, and a Windows "Open with Saoirse" context menu
 */

const {
  app, BrowserWindow, shell, dialog, Tray, Menu, globalShortcut,
  nativeImage, Notification, ipcMain, screen,
} = require('electron');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');

const APP_NAME = 'Saoirse';
const HOST = '127.0.0.1';
const READY_TIMEOUT_MS = 90 * 1000;
const IDLE_NOTIFY_MS = 30 * 1000; // backend quiet for this long after activity => "done"

// Configure this in release builds after Saoirse has its own update repository.
// Keeping it empty prevents derivative builds from linking to Bigfish releases.
const UPDATE_JSON_URL = process.env.SAOIRSE_UPDATE_JSON_URL || '';

/** @type {import('node:child_process').ChildProcess | null} */
let dshProcess = null;
/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {BrowserWindow | null} */
let petWindow = null;
/** @type {BrowserWindow | null} */
let welcomeWindow = null;
/** @type {Tray | null} */
let tray = null;
/** @type {number | null} */
let port = null;
let quitting = false;
let completionWatcherTimer = null;
let lastBusyAt = 0;
let notifiedForCycle = false;
let backendRestartPromise = null;
/** @type {import('node:child_process').ChildProcess | null} */
let terminalProcess = null;
let terminalCwd = null;
/** @type {import('electron').WebContents | null} */
let harnessGuest = null;
let harnessBgCssKey = null;

// ---------------------------------------------------------------------------
// Settings (persisted to userData/settings.json)
// ---------------------------------------------------------------------------
const DEFAULT_SETTINGS = {
  notifyOnComplete: true,
  launchAtLogin: false,
  petEnabled: true,
  onboardingDone: false,
  projects: [],
  activeProjectId: null,
  permissionMode: 'workspace-write',
  mcpServers: [],
  appearance: {
    enabled: true,
    fit: 'cover',
    position: 'center',
    overlay: 0.28,
    blur: 0,
    backgroundName: '',
  },
};
let settings = { ...DEFAULT_SETTINGS };

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}
function loadSettings() {
  try {
    settings = { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) };
  } catch {
    settings = { ...DEFAULT_SETTINGS };
  }
  settings.projects = Array.isArray(settings.projects)
    ? settings.projects.filter((project) => project && typeof project.path === 'string')
    : [];
  if (!settings.projects.some((project) => project.id === settings.activeProjectId)) {
    settings.activeProjectId = null;
  }
  if (!['read-only', 'workspace-write', 'danger-full-access'].includes(settings.permissionMode)) {
    settings.permissionMode = 'workspace-write';
  }
  settings.mcpServers = (Array.isArray(settings.mcpServers) ? settings.mcpServers : [])
    .map((server) => {
      try { return normalizeMcpServer(server, String(server?.id || crypto.randomUUID())); } catch { return null; }
    })
    .filter(Boolean)
    .filter((server, index, all) => all.findIndex((item) => item.serverName === server.serverName) === index);
  settings.appearance = normalizeAppearance(settings.appearance);
}
function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error('[saoirse] failed to save settings:', err);
  }
}

// ---------------------------------------------------------------------------
// Backend lifecycle
// ---------------------------------------------------------------------------
function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.once('error', reject);
    srv.listen(0, HOST, () => {
      const addr = srv.address();
      const p = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(p));
    });
  });
}

function dshBinPath() {
  if (app.isPackaged) {
    // The production-only dsh node_modules are bundled via extraResources.
    return path.join(process.resourcesPath, 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
  }
  return path.join(app.getAppPath(), 'dsh-bundle', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
}

/** Directory of bundled skills shipped with the app (loaded via DSH_BUNDLED_SKILL_DIR). */
function bundledSkillDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'bundled-skills')
    : path.join(app.getAppPath(), 'bundled-skills');
}

// ---------------------------------------------------------------------------
// Project workspaces
// ---------------------------------------------------------------------------
const TREE_IGNORED_NAMES = new Set(['.git', 'node_modules', '.electron-cache']);

function projectId(projectPath) {
  return crypto.createHash('sha256').update(path.resolve(projectPath).toLowerCase()).digest('hex').slice(0, 16);
}

function activeProject() {
  return settings.projects.find((project) => project.id === settings.activeProjectId) || null;
}

function scratchWorkspace() {
  const dir = path.join(app.getPath('userData'), 'scratch-workspace');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function backendWorkspace() {
  const project = activeProject();
  return project && fs.existsSync(project.path) ? project.path : scratchWorkspace();
}

function publicWorkspaceState() {
  const project = activeProject();
  return {
    projects: settings.projects.map((item) => ({ ...item })),
    activeProject: project ? { ...project } : null,
    backendUrl: port ? `http://${HOST}:${port}` : null,
    terminalCwd: terminalCwd || (project ? project.path : null),
    permissionMode: settings.permissionMode,
    mcpServers: settings.mcpServers.map(publicMcpServer),
    appearance: publicAppearanceState(false),
  };
}

function upsertProject(folderPath) {
  const resolved = path.resolve(folderPath);
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) throw new Error('只能将文件夹添加为项目');
  const id = projectId(resolved);
  const existing = settings.projects.find((project) => project.id === id);
  const project = {
    id,
    name: path.basename(resolved) || resolved,
    path: resolved,
    lastOpenedAt: Date.now(),
  };
  if (existing) Object.assign(existing, project);
  else settings.projects.unshift(project);
  settings.projects = settings.projects
    .sort((a, b) => Number(b.lastOpenedAt || 0) - Number(a.lastOpenedAt || 0))
    .slice(0, 16);
  settings.activeProjectId = id;
  terminalCwd = resolved;
  saveSettings();
  return project;
}

function resolveProjectPath(project, relativePath = '') {
  if (!project) throw new Error('请先选择项目');
  const root = path.resolve(project.path);
  const target = path.resolve(root, String(relativePath || '.'));
  const rootPrefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (target !== root && !target.startsWith(rootPrefix)) throw new Error('路径超出当前项目范围');
  return target;
}

function listProjectDirectory(project, relativePath = '') {
  const target = resolveProjectPath(project, relativePath);
  const entries = fs.readdirSync(target, { withFileTypes: true });
  return entries
    .filter((entry) => !TREE_IGNORED_NAMES.has(entry.name))
    .slice(0, 500)
    .map((entry) => {
      const childRelative = path.relative(project.path, path.join(target, entry.name));
      const fullPath = path.join(target, entry.name);
      let kind = entry.isDirectory() ? 'directory' : 'file';
      if (entry.isSymbolicLink()) kind = 'symlink';
      let size = 0;
      try { if (kind === 'file') size = fs.statSync(fullPath).size; } catch { /* unreadable */ }
      return { name: entry.name, path: childRelative, kind, size };
    })
    .sort((a, b) => {
      if (a.kind === 'directory' && b.kind !== 'directory') return -1;
      if (a.kind !== 'directory' && b.kind === 'directory') return 1;
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });
}

function resolveRuntime() {
  const bin = dshBinPath();
  const env = {
    ...process.env,
    DSH_BUNDLED_SKILL_DIR: bundledSkillDir(),
    DSH_PERMISSION_MODE: settings.permissionMode,
  };
  if (!app.isPackaged) {
    return { command: process.env.DSH_NODE || 'node', args: [bin], env };
  }
  const nodeBin = process.platform === 'win32' ? 'node.exe' : 'node';
  const nodeExe = path.join(process.resourcesPath, 'node-runtime', nodeBin);
  return { command: nodeExe, args: [bin], env };
}

function waitForReady(p, timeoutMs = READY_TIMEOUT_MS) {
  const base = `http://${HOST}:${p}`;
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(`${base}/`, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) resolve();
        else retry();
      });
      req.once('error', retry);
      req.setTimeout(3000, () => { req.destroy(); retry(); });
    };
    const retry = () => {
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error(`Timed out waiting for the backend at ${base}`));
        return;
      }
      setTimeout(attempt, 500);
    };
    attempt();
  });
}

function backendPidPath() {
  return path.join(app.getPath('userData'), 'backend.pid.json');
}

function mcpPatchPath() {
  return path.join(app.getPath('userData'), 'saoirse-mcp.cordis.yml');
}

function publicMcpServer(server) {
  return {
    id: String(server.id || ''),
    serverName: String(server.serverName || ''),
    transport: server.transport === 'streamable-http' ? 'streamable-http' : 'stdio',
    enabled: server.enabled !== false,
    command: String(server.command || ''),
    args: Array.isArray(server.args) ? server.args.map(String) : [],
    cwd: String(server.cwd || ''),
    url: String(server.url || ''),
    env: Array.isArray(server.env) ? server.env.map((item) => ({ key: String(item.key || ''), envVar: String(item.envVar || '') })) : [],
    headers: Array.isArray(server.headers) ? server.headers.map((item) => ({
      key: String(item.key || ''), envVar: String(item.envVar || ''), prefix: String(item.prefix || ''),
    })) : [],
  };
}

function yamlString(value) {
  return JSON.stringify(String(value));
}

function validateEnvVar(name) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(name || ''));
}

function normalizeMcpServer(input, existingId = '') {
  const serverName = String(input?.serverName || '').trim();
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(serverName)) {
    throw new Error('MCP 名称只能包含字母、数字、下划线和连字符，长度 1–32');
  }
  const transport = input?.transport === 'streamable-http' ? 'streamable-http' : 'stdio';
  const server = {
    id: existingId || crypto.randomUUID(),
    serverName,
    transport,
    enabled: input?.enabled !== false,
    command: String(input?.command || '').trim(),
    args: Array.isArray(input?.args) ? input.args.map(String).filter(Boolean).slice(0, 64) : [],
    cwd: String(input?.cwd || '').trim(),
    url: String(input?.url || '').trim(),
    env: Array.isArray(input?.env) ? input.env.slice(0, 32) : [],
    headers: Array.isArray(input?.headers) ? input.headers.slice(0, 32) : [],
  };
  if (transport === 'stdio' && !server.command) throw new Error('stdio MCP 需要填写启动命令');
  if (transport === 'streamable-http') {
    let parsed;
    try { parsed = new URL(server.url); } catch { throw new Error('MCP URL 无效'); }
    if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('MCP URL 只支持 HTTP/HTTPS');
    if (parsed.protocol === 'http:' && !['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) {
      throw new Error('远程 MCP 必须使用 HTTPS；HTTP 仅允许 localhost');
    }
  }
  for (const item of [...server.env, ...server.headers]) {
    item.key = String(item.key || '').trim();
    item.envVar = String(item.envVar || '').trim();
    if (!item.key || !validateEnvVar(item.envVar)) throw new Error('MCP 环境变量映射格式无效');
    if ('prefix' in item) item.prefix = String(item.prefix || '').slice(0, 80);
  }
  return server;
}

function writeMcpPatch() {
  const file = mcpPatchPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const enabled = settings.mcpServers.filter((server) => server.enabled !== false);
  if (!enabled.length) {
    fs.writeFileSync(file, '[]\n', 'utf8');
    return file;
  }
  const lines = ['- insert:'];
  for (const server of enabled) {
    lines.push(`    - id: ${yamlString(`saoirse-mcp-${server.serverName}`)}`);
    lines.push(`      name: ${yamlString('@deepseek-ai/dsh-mcp-client')}`);
    lines.push('      config:');
    lines.push(`        serverName: ${yamlString(server.serverName)}`);
    lines.push(`        transport: ${yamlString(server.transport)}`);
    if (server.transport === 'stdio') {
      lines.push(`        command: ${yamlString(server.command)}`);
      if (server.args.length) lines.push(`        args: [${server.args.map(yamlString).join(', ')}]`);
      if (server.cwd) lines.push(`        cwd: ${yamlString(server.cwd)}`);
      if (server.env.length) {
        lines.push('        env:');
        for (const item of server.env) lines.push(`          ${yamlString(item.key)}: !!js process.env.${item.envVar}`);
      }
    } else {
      lines.push(`        url: ${yamlString(server.url)}`);
      if (server.headers.length) {
        lines.push('        headers:');
        for (const item of server.headers) {
          const variable = `process.env.${item.envVar}`;
          const expression = item.prefix
            ? `${variable} ? ${JSON.stringify(item.prefix)} + ${variable} : ''`
            : `${variable} || ''`;
          lines.push(`          ${yamlString(item.key)}: !!js ${yamlString(expression)}`);
        }
      }
    }
    lines.push('        failOnStartupError: false');
    lines.push('        reconnect:');
    lines.push('          enabled: true');
  }
  fs.writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');
  return file;
}

function removeBackendPidFile(expectedPid) {
  if (expectedPid) {
    try {
      const record = JSON.parse(fs.readFileSync(backendPidPath(), 'utf8'));
      if (Number(record && record.pid) !== expectedPid) return;
    } catch { return; }
  }
  try { fs.unlinkSync(backendPidPath()); } catch { /* already absent */ }
}

function queryProcessCommandLine(pid) {
  if (process.platform !== 'win32') {
    try { return Promise.resolve(fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8')); } catch { return Promise.resolve(''); }
  }
  return new Promise((resolve) => {
    const script = `$p = Get-CimInstance Win32_Process -Filter \"ProcessId = ${pid}\"; if ($p) { $p.CommandLine }`;
    const child = spawn('powershell', ['-NoProfile', '-Command', script], { windowsHide: true });
    let output = '';
    child.stdout?.on('data', (chunk) => { output += chunk; });
    child.once('error', () => resolve(''));
    child.once('close', () => resolve(output));
  });
}

/** Stop only the backend PID previously recorded by this Saoirse installation. */
async function cleanupStaleDsh() {
  let record;
  try { record = JSON.parse(fs.readFileSync(backendPidPath(), 'utf8')); } catch { return; }
  const pid = Number(record && record.pid);
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid) {
    removeBackendPidFile();
    return;
  }
  const commandLine = (await queryProcessCommandLine(pid)).replaceAll('\\', '/').toLowerCase();
  const expectedBin = dshBinPath().replaceAll('\\', '/').toLowerCase();
  if (!commandLine.includes(expectedBin)) {
    removeBackendPidFile();
    return;
  }
  try {
    if (process.platform === 'win32') {
      await new Promise((resolve) => {
        const child = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
        child.once('error', resolve);
        child.once('close', resolve);
      });
    } else {
      process.kill(pid, 'SIGTERM');
    }
  } catch { /* stale process already exited */ }
  removeBackendPidFile();
}

async function startDsh(workspacePath = backendWorkspace()) {
  await cleanupStaleDsh();
  port = await findFreePort();
  const rt = resolveRuntime();
  const patchFile = writeMcpPatch();
  const args = [...rt.args, '--profile', 'web', '--patch', patchFile, '--host', HOST, '--port', String(port)];
  console.log(`[saoirse] starting backend on http://${HOST}:${port} for ${workspacePath}`);
  dshProcess = spawn(rt.command, args, {
    env: rt.env,
    cwd: workspacePath,
    stdio: ['ignore', 'inherit', 'inherit'],
    windowsHide: true,
  });
  const spawnedPid = dshProcess.pid;
  if (spawnedPid) {
    fs.mkdirSync(path.dirname(backendPidPath()), { recursive: true });
    fs.writeFileSync(backendPidPath(), JSON.stringify({ pid: spawnedPid, startedAt: Date.now() }));
  }
  dshProcess.once('error', (err) => console.error('[saoirse] failed to spawn backend:', err));
  dshProcess.once('exit', () => removeBackendPidFile(spawnedPid));
  await waitForReady(port);
}

function stopDsh() {
  const child = dshProcess;
  dshProcess = null;
  removeBackendPidFile();
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
      child.kill('SIGTERM');
      setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, 3000);
    }
  } catch { /* best effort */ }
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
function notify(title, body) {
  if (!Notification.isSupported()) return;
  try {
    new Notification({ title, body, icon: appIconPath() }).show();
  } catch (err) {
    console.error('[saoirse] notification failed:', err);
  }
}

const PET_QUOTES = [
  // 人设·打招呼
  '我是 Saoirse 的鲸灵导航员，很高兴见到你~',
  '欢迎回来，我的小伙伴！',
  '鲸灵导航员上线，今天也一起加油！',
  '深海那么大，但我只想陪你~',
  // 人设·撒娇/互动
  '哼，都不理我，我要吐泡泡了~',
  '摸摸我的小鲸尾，灵感马上浮上来~',
  '你忙的时候，我会乖乖在旁边看着你~',
  '我的尾巴会发光，但只有你才看得到哦~',
  // 趣味·小知识（鲸鱼相关）
  '小知识：蓝鲸的心跳每分钟只有 6 次哦~',
  '你知道吗？鲸鱼其实是哺乳动物，不是鱼！',
  '鲸鱼唱歌能传 1600 公里远，我的歌声呢~',
  '座头鲸会跳出海面，像是在跳芭蕾~',
  '小知识：抹香鲸可以潜水 90 分钟不上来！',
  // 趣味·日常生活
  '要不要我帮你把今天的任务列个清单？',
  '查资料、写报告、做 PPT，说一声就行~',
  '记得喝口水休息一下，别太累啦！',
  '作业写完记得检查一遍哦~',
  // 加油打气
  '今天也要元气满满！',
  '你已经很棒了，剩下的事交给我！',
  '别怕麻烦，我一直都在~',
];

function petSay(msg) {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send('pet-say', msg);
  }
}

function schedulePetChatter() {
  clearTimeout(chatterTimer);
  chatterTimer = setTimeout(() => {
    if (petWindow && !petWindow.isDestroyed() && petState === 'idle') {
      petSay(PET_QUOTES[Math.floor(Math.random() * PET_QUOTES.length)]);
    }
    schedulePetChatter();
  }, 90000); // 固定 1.5 分钟说一句
}

function uninstall() {
  if (!app.isPackaged) {
    dialog.showMessageBox({ type: 'info', title: APP_NAME, message: '卸载功能只在安装版可用', detail: '请安装打包好的 Saoirse 后再使用卸载。' });
    return;
  }
  const uninstaller = path.join(path.dirname(process.execPath), 'Uninstall Saoirse.exe');
  if (fs.existsSync(uninstaller)) {
    quitting = true;
    spawn(uninstaller, [], { detached: true, stdio: 'ignore' });
    setTimeout(() => app.quit(), 800);
  } else {
    shell.openExternal('ms-settings:appsfeatures');
  }
}

// ---------------------------------------------------------------------------
// 检查更新（方法二）：启动时拉取 latest.json，发现新版本就提示下载
// ---------------------------------------------------------------------------
function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

function checkForUpdates() {
  if (!app.isPackaged || !UPDATE_JSON_URL) return;
  const req = https.get(UPDATE_JSON_URL, { timeout: 10000 }, (res) => {
    if (res.statusCode !== 200) {
      res.resume();
      return;
    }
    let body = '';
    res.on('data', (c) => { body += c; });
    res.on('end', () => {
      try {
        const info = JSON.parse(body);
        const latest = String(info.version || '');
        const current = app.getVersion();
        if (latest && compareVersions(latest, current) > 0) {
          const url = (info.urls && info.urls[process.platform]) || info.url;
          const choice = dialog.showMessageBoxSync({
            type: 'info',
            title: APP_NAME,
            message: `发现新版本 v${latest}`,
            detail: info.note || '有新版本可用，是否去下载？',
            buttons: ['去下载', '以后再说'],
            defaultId: 0,
          });
          if (choice === 0 && url) shell.openExternal(url);
        }
      } catch { /* JSON 解析失败就忽略 */ }
    });
  });
  req.on('error', () => { /* 网络失败就静默 */ });
  req.setTimeout(10000, () => { req.destroy(); });
}

// Heuristic "task completed" detector: watch DSH_HOME (excluding the static
// profiles/ tree) for writes; after a burst of activity followed by idle, notify.
function dshHome() {
  return process.env.DSH_HOME && process.env.DSH_HOME.trim() !== ''
    ? process.env.DSH_HOME
    : path.join(os.homedir(), '.dsh');
}

// ---------------------------------------------------------------------------
// Onboarding wizard
// ---------------------------------------------------------------------------
function createWelcomeWindow() {
  if (welcomeWindow && !welcomeWindow.isDestroyed()) {
    welcomeWindow.show();
    welcomeWindow.focus();
    return;
  }
  welcomeWindow = new BrowserWindow({
    width: 760,
    height: 570,
    parent: mainWindow || undefined,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'Saoirse 初次航行',
    autoHideMenuBar: true,
    icon: appIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'welcome-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  welcomeWindow.once('ready-to-show', () => {
    if (welcomeWindow && !welcomeWindow.isDestroyed()) {
      welcomeWindow.show();
      welcomeWindow.focus();
    }
  });
  welcomeWindow.loadFile(path.join(__dirname, 'welcome.html'));
  welcomeWindow.on('closed', () => { welcomeWindow = null; });
}

function latestMtime(dir, skipNames, out) {
  out = out || { t: 0 };
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (skipNames && skipNames.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      latestMtime(full, skipNames, out);
    } else if (e.isFile()) {
      try {
        const t = fs.statSync(full).mtimeMs;
        if (t > out.t) out.t = t;
      } catch { /* ignore */ }
    }
  }
  return out;
}

function startCompletionWatcher() {
  stopCompletionWatcher();
  const skip = new Set(['profiles', 'node_modules']);
  completionWatcherTimer = setInterval(() => {
    if (!settings.notifyOnComplete) return;
    const { t } = latestMtime(dshHome(), skip);
    const now = Date.now();
    if (t > lastBusyAt + 2000 && now - t < 2000) {
      // fresh write => busy
      lastBusyAt = now;
      notifiedForCycle = false;
    } else if (lastBusyAt > 0 && now - lastBusyAt > IDLE_NOTIFY_MS && !notifiedForCycle) {
      notifiedForCycle = true;
      const msg = 'Saoirse 任务已完成';
      notify(msg, '后端已空闲，可以回来看看结果了');
      petSay('任务完成啦！');
    }
  }, 5000);
}

function stopCompletionWatcher() {
  if (completionWatcherTimer) {
    clearInterval(completionWatcherTimer);
    completionWatcherTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------
function appIconPath() {
  const candidates = [
    path.join(__dirname, 'assets', 'icon.png'),
    path.join(__dirname, 'build', 'icon.png'),
    path.join(__dirname, 'build', 'icon.ico'),
  ];
  for (const p of candidates) if (fs.existsSync(p)) return p;
  return undefined;
}
function trayIconPath() {
  const candidates = [
    path.join(__dirname, 'assets', 'tray.png'),
    path.join(__dirname, 'assets', 'icon.png'),
    path.join(__dirname, 'build', 'tray.png'),
    path.join(__dirname, 'build', 'icon.png'),
  ];
  for (const p of candidates) if (fs.existsSync(p)) return p;
  return undefined;
}

// ---------------------------------------------------------------------------
// Main window
// ---------------------------------------------------------------------------
function createWindow() {
  mainWindow = new BrowserWindow({
    title: APP_NAME,
    icon: appIconPath(),
    width: 1480,
    height: 920,
    minWidth: 1040,
    minHeight: 680,
    backgroundColor: '#07101f',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'workspace-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    if (welcomeWindow && !welcomeWindow.isDestroyed()) {
      welcomeWindow.show();
      welcomeWindow.focus();
    }
  });

  // Close hides to tray (keeps the backend alive); real quit goes through the tray.
  mainWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    let protocol;
    try { protocol = new URL(url).protocol; } catch { event.preventDefault(); return; }
    if (protocol !== 'file:') {
      event.preventDefault();
      if (url.startsWith('http://') || url.startsWith('https://')) shell.openExternal(url);
    }
  });

  mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    let origin = '';
    try { origin = new URL(params.src).origin; } catch { /* rejected below */ }
    if (params.src !== 'about:blank' && origin !== `http://${HOST}:${port}`) {
      event.preventDefault();
      return;
    }
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
  });
  mainWindow.webContents.on('did-attach-webview', (_event, guest) => {
    harnessGuest = guest;
    guest.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('http://') || url.startsWith('https://')) shell.openExternal(url);
      return { action: 'deny' };
    });
    guest.on('will-navigate', (event, url) => {
      let origin = '';
      try { origin = new URL(url).origin; } catch { event.preventDefault(); return; }
      if (origin !== `http://${HOST}:${port}`) {
        event.preventDefault();
        if (url.startsWith('http://') || url.startsWith('https://')) shell.openExternal(url);
      }
    });
    guest.on('did-finish-load', () => applyBackground());
    guest.once('destroyed', () => {
      if (harnessGuest === guest) harnessGuest = null;
      harnessBgCssKey = null;
    });
  });

  // 工作台和 Harness 加载完成后注入用户选择的背景。
  mainWindow.webContents.on('did-finish-load', () => applyBackground());

  mainWindow.loadFile(path.join(__dirname, 'workspace.html'));
}

function toggleMainWindow() {
  ensurePet();
  if (!mainWindow) { createWindow(); return; }
  if (mainWindow.isVisible()) mainWindow.hide();
  else { mainWindow.show(); mainWindow.focus(); }
}

// ---------------------------------------------------------------------------
// Desktop pet
// ---------------------------------------------------------------------------
function createPetWindow() {
  if (petWindow && !petWindow.isDestroyed()) { petWindow.show(); return; }
  petWindow = new BrowserWindow({
    width: 220,
    height: 210,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    hasShadow: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'pet-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  petWindow.setAlwaysOnTop(true, 'floating');
  // 点击穿透只在 Windows 上可靠；Linux 上开启会导致桌宠点不到
  if (process.platform === 'win32') {
    petWindow.setIgnoreMouseEvents(true, { forward: true });
  }
  petWindow.loadFile(path.join(__dirname, 'pet.html'));
  petWindow.on('closed', () => { petWindow = null; });
}

/** 桌宠启用但窗口没了时，重建它（解决关窗后桌宠消失）。 */
function ensurePet() {
  if (settings.petEnabled && (!petWindow || petWindow.isDestroyed())) {
    createPetWindow();
  }
}

function destroyPetWindow() {
  clearPetTimers();
  if (petWindow && !petWindow.isDestroyed()) petWindow.destroy();
  petWindow = null;
}

// ---------------------------------------------------------------------------
// Pet state machine (idle / eat / sleep / walk-left / walk-right)
// ---------------------------------------------------------------------------
let petState = 'idle';
let wanderTimer = null;
let sleepTimer = null;
let eatTimer = null;
let moveTimer = null;
let chatterTimer = null;

function clearPetTimers() {
  clearTimeout(wanderTimer);
  clearTimeout(sleepTimer);
  clearTimeout(eatTimer);
  clearTimeout(chatterTimer);
  clearInterval(moveTimer);
  wanderTimer = sleepTimer = eatTimer = moveTimer = chatterTimer = null;
}

function setPetState(state) {
  petState = state;
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send('pet-state', state);
  }
}

function scheduleSleep() {
  clearTimeout(sleepTimer);
  sleepTimer = setTimeout(() => {
    if (petState === 'idle') setPetState('sleep');
  }, 120 * 1000); // 2 min idle -> sleep
}

function wakePet() {
  clearTimeout(sleepTimer);
  if (petState === 'sleep') setPetState('idle');
  scheduleSleep();
}

function scheduleWander() {
  clearTimeout(wanderTimer);
  wanderTimer = setTimeout(() => {
    if (petState === 'idle') doWander();
    else scheduleWander();
  }, 15000 + Math.random() * 20000);
}

function doWander() {
  if (!petWindow || petWindow.isDestroyed() || petState !== 'idle') {
    scheduleWander();
    return;
  }
  const dir = Math.random() < 0.5 ? 'left' : 'right';
  const [x, y] = petWindow.getPosition();
  const { workAreaSize } = screen.getPrimaryDisplay();
  const distance = 100 + Math.random() * 180;
  const targetX = dir === 'left' ? x - distance : x + distance;
  const clamped = Math.max(0, Math.min(targetX, workAreaSize.width - 220));
  setPetState('walk-' + dir);
  const startX = x;
  const startTime = Date.now();
  const duration = 1400;
  clearInterval(moveTimer);
  moveTimer = setInterval(() => {
    const t = Math.min(1, (Date.now() - startTime) / duration);
    petWindow.setPosition(Math.round(startX + (clamped - startX) * t), y);
    if (t >= 1) {
      clearInterval(moveTimer);
      moveTimer = null;
      setPetState('idle');
      scheduleWander();
    }
  }, 16);
}

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------
function createTray() {
  const icon = trayIconPath();
  if (icon) {
    tray = new Tray(nativeImage.createFromPath(icon));
  } else {
    tray = new Tray(nativeImage.createEmpty());
  }
  tray.setToolTip(APP_NAME);
  tray.on('click', () => toggleMainWindow());
  rebuildTrayMenu();
}

// ---------------------------------------------------------------------------
// 背景图（默认 + 用户自定义）
// ---------------------------------------------------------------------------
let bgCssKey = null;

function customBackgroundPaths() {
  return ['jpg', 'jpeg', 'png', 'webp'].map((ext) => path.join(app.getPath('userData'), `custom-background.${ext}`));
}

// ---------------------------------------------------------------------------
// Project-scoped terminal (commands are entered explicitly by the user)
// ---------------------------------------------------------------------------
function sendTerminal(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function terminalRoot() {
  const project = activeProject();
  return project ? project.path : scratchWorkspace();
}

function ensureTerminalCwd() {
  const root = terminalRoot();
  if (!terminalCwd || !fs.existsSync(terminalCwd)) terminalCwd = root;
  return terminalCwd;
}

function changeTerminalDirectory(rawTarget) {
  const root = path.resolve(terminalRoot());
  const cleaned = String(rawTarget || '').trim().replace(/^['"]|['"]$/g, '');
  const next = path.resolve(ensureTerminalCwd(), cleaned || root);
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (next !== root && !next.startsWith(prefix)) throw new Error('终端目录不能离开当前项目');
  if (!fs.existsSync(next) || !fs.statSync(next).isDirectory()) throw new Error(`目录不存在：${cleaned}`);
  terminalCwd = next;
  sendTerminal('terminal:cwd', { cwd: terminalCwd });
  return terminalCwd;
}

function runTerminalCommand(commandText) {
  const command = String(commandText || '').trim();
  if (!command) return { started: false, cwd: ensureTerminalCwd() };
  if (terminalProcess) throw new Error('已有命令正在执行，请等待或先停止');

  const cdMatch = command.match(/^cd(?:\s+(.+))?$/i);
  if (cdMatch) {
    const cwd = changeTerminalDirectory(cdMatch[1] || terminalRoot());
    sendTerminal('terminal:data', { text: `\r\n${cwd}\r\n`, stream: 'system' });
    return { started: false, cwd };
  }

  const cwd = ensureTerminalCwd();
  let executable;
  let args;
  if (process.platform === 'win32') {
    executable = 'powershell.exe';
    const utf8Prefix = '$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::UTF8; ';
    args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', `${utf8Prefix}${command}`];
  } else {
    executable = process.env.SHELL || '/bin/sh';
    args = ['-lc', command];
  }

  sendTerminal('terminal:data', { text: `\r\n❯ ${command}\r\n`, stream: 'command' });
  sendTerminal('terminal:state', { running: true, command, cwd });
  const child = spawn(executable, args, {
    cwd,
    env: { ...process.env, TERM: 'xterm-256color' },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  terminalProcess = child;
  child.stdout.on('data', (chunk) => sendTerminal('terminal:data', { text: chunk.toString('utf8'), stream: 'stdout' }));
  child.stderr.on('data', (chunk) => sendTerminal('terminal:data', { text: chunk.toString('utf8'), stream: 'stderr' }));
  child.once('error', (error) => {
    sendTerminal('terminal:data', { text: `\r\n${error.message}\r\n`, stream: 'stderr' });
  });
  child.once('close', (code, signal) => {
    if (terminalProcess === child) terminalProcess = null;
    sendTerminal('terminal:data', {
      text: `\r\n[命令结束：${signal ? `signal ${signal}` : `exit ${code ?? 0}`}]\r\n`,
      stream: Number(code) === 0 ? 'system' : 'stderr',
    });
    sendTerminal('terminal:state', { running: false, code, signal, cwd: ensureTerminalCwd() });
  });
  return { started: true, cwd };
}

function stopTerminal() {
  const child = terminalProcess;
  terminalProcess = null;
  if (!child || !child.pid || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
      child.kill('SIGTERM');
    }
  } catch { /* best effort */ }
  sendTerminal('terminal:state', { running: false, stopped: true, cwd: ensureTerminalCwd() });
}

// ---------------------------------------------------------------------------
// Saoirse 0.3/0.4 project controls: Git, checkpoints, skills and validation
// ---------------------------------------------------------------------------
function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env || {}), GIT_OPTIONAL_LOCKS: '0' },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const maxBytes = options.maxBytes || 2 * 1024 * 1024;
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* gone */ }
      reject(new Error(`${command} 执行超时`));
    }, options.timeoutMs || 30000);
    child.stdout.on('data', (chunk) => { if (stdout.length < maxBytes) stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { if (stderr.length < maxBytes) stderr += chunk.toString('utf8'); });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code) => {
      clearTimeout(timer);
      const result = { code: Number(code ?? 0), stdout, stderr };
      if (code === 0 || options.allowFailure) resolve(result);
      else reject(new Error((stderr || stdout || `${command} 执行失败`).trim()));
    });
  });
}

async function gitCommand(args, options = {}) {
  const project = activeProject();
  if (!project) throw new Error('请先选择项目');
  return runProcess('git', ['-c', 'core.quotepath=false', '--no-pager', ...args], {
    cwd: project.path,
    ...options,
  });
}

function normalizeGitPath(value) {
  let item = String(value || '').trim();
  if (item.includes(' -> ')) item = item.split(' -> ').at(-1);
  if (item.startsWith('"') && item.endsWith('"')) item = item.slice(1, -1).replace(/\\"/g, '"');
  return item.replaceAll('\\', '/');
}

async function gitStatus() {
  const check = await gitCommand(['rev-parse', '--is-inside-work-tree'], { allowFailure: true });
  if (check.code !== 0 || check.stdout.trim() !== 'true') {
    return { isRepo: false, branch: '', entries: [], stagedCount: 0, changedCount: 0 };
  }
  const result = await gitCommand(['status', '--porcelain=v1', '--branch']);
  const lines = result.stdout.replace(/\r/g, '').split('\n').filter(Boolean);
  const header = lines[0]?.startsWith('## ') ? lines.shift().slice(3) : '';
  const branch = header.split('...')[0].trim();
  const entries = lines.map((line) => {
    const x = line[0] || ' ';
    const y = line[1] || ' ';
    const filePath = normalizeGitPath(line.slice(3));
    return {
      path: filePath,
      x,
      y,
      status: `${x}${y}`,
      staged: x !== ' ' && x !== '?',
      untracked: x === '?' && y === '?',
      deleted: x === 'D' || y === 'D',
    };
  });
  return {
    isRepo: true,
    branch,
    entries,
    stagedCount: entries.filter((entry) => entry.staged).length,
    changedCount: entries.length,
  };
}

async function gitDiff(relativePath, staged = false) {
  const project = activeProject();
  const target = resolveProjectPath(project, relativePath);
  const status = await gitStatus();
  const entry = status.entries.find((item) => item.path === String(relativePath).replaceAll('\\', '/'));
  if (entry?.untracked) {
    const stat = fs.statSync(target);
    if (!stat.isFile()) return '未跟踪目录（请选择其中的文件查看）';
    if (stat.size > 1024 * 1024) return '文件超过 1 MB，Saoirse 不在面板中预览。';
    return `--- /dev/null\n+++ b/${entry.path}\n@@ 新文件 @@\n${fs.readFileSync(target, 'utf8')}`;
  }
  const args = ['diff', '--no-ext-diff', '--unified=3'];
  if (staged) args.push('--cached');
  args.push('--', relativePath);
  const result = await gitCommand(args, { maxBytes: 3 * 1024 * 1024 });
  return result.stdout || '当前范围没有差异。';
}

async function gitHistory() {
  const result = await gitCommand([
    'log', '-n', '24', '--pretty=format:%H%x1f%h%x1f%an%x1f%ad%x1f%s', '--date=iso-strict',
  ], { allowFailure: true });
  if (result.code !== 0) return [];
  return result.stdout.split('\n').filter(Boolean).map((line) => {
    const [hash, shortHash, author, date, ...subject] = line.split('\x1f');
    return { hash, shortHash, author, date, subject: subject.join('\x1f') };
  });
}

function checkpointRoot(project = activeProject()) {
  if (!project) throw new Error('请先选择项目');
  return path.join(app.getPath('userData'), 'checkpoints', project.id);
}

async function createCheckpoint(label = '手动检查点', selectedPaths = null) {
  const project = activeProject();
  const status = await gitStatus();
  if (!status.isRepo) throw new Error('检查点目前需要 Git 项目');
  const wanted = Array.isArray(selectedPaths) && selectedPaths.length
    ? new Set(selectedPaths.map((item) => String(item).replaceAll('\\', '/')))
    : null;
  const entries = status.entries.filter((entry) => !wanted || wanted.has(entry.path));
  if (!entries.length) throw new Error('当前没有可保存的变更');
  const id = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const root = path.join(checkpointRoot(project), id);
  const filesRoot = path.join(root, 'files');
  fs.mkdirSync(filesRoot, { recursive: true });
  const manifest = { id, label: String(label || '检查点').slice(0, 80), createdAt: Date.now(), files: [] };
  let totalBytes = 0;
  for (const entry of entries) {
    const target = resolveProjectPath(project, entry.path);
    let exists = false;
    let size = 0;
    try {
      const stat = fs.lstatSync(target);
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      exists = true;
      size = stat.size;
    } catch { /* deleted file */ }
    if (size > 8 * 1024 * 1024 || totalBytes + size > 96 * 1024 * 1024) continue;
    const record = { path: entry.path, exists, status: entry.status, size };
    manifest.files.push(record);
    if (exists) {
      const backup = path.join(filesRoot, ...entry.path.split('/'));
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      fs.copyFileSync(target, backup);
      totalBytes += size;
    }
  }
  if (!manifest.files.length) throw new Error('变更文件过大或不受支持，无法创建检查点');
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  return manifest;
}

function listCheckpoints() {
  const root = checkpointRoot();
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      try { return JSON.parse(fs.readFileSync(path.join(root, entry.name, 'manifest.json'), 'utf8')); } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 30)
    .map((item) => ({ id: item.id, label: item.label, createdAt: item.createdAt, fileCount: item.files.length }));
}

function restoreCheckpoint(id) {
  const project = activeProject();
  const safeId = String(id || '');
  if (!/^[0-9]+-[a-f0-9]+$/.test(safeId)) throw new Error('检查点编号无效');
  const root = path.join(checkpointRoot(project), safeId);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  for (const record of manifest.files) {
    const target = resolveProjectPath(project, record.path);
    if (record.exists) {
      const backup = path.join(root, 'files', ...record.path.split('/'));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(backup, target);
    } else if (fs.existsSync(target)) {
      const stat = fs.lstatSync(target);
      if (!stat.isFile() && !stat.isSymbolicLink()) throw new Error(`不会删除目录：${record.path}`);
      fs.unlinkSync(target);
    }
  }
  return { restored: manifest.files.length };
}

async function undoGitFile(relativePath) {
  const status = await gitStatus();
  const normalized = String(relativePath || '').replaceAll('\\', '/');
  const entry = status.entries.find((item) => item.path === normalized);
  if (!entry) throw new Error('该文件当前没有变更');
  await createCheckpoint(`撤销前备份 · ${normalized}`, [normalized]);
  const target = resolveProjectPath(activeProject(), normalized);
  if (entry.untracked) {
    const stat = fs.lstatSync(target);
    if (!stat.isFile() && !stat.isSymbolicLink()) throw new Error('不会自动删除未跟踪目录');
    fs.unlinkSync(target);
  } else {
    await gitCommand(['restore', '--staged', '--worktree', '--', normalized], { allowFailure: true });
    await gitCommand(['restore', '--worktree', '--', normalized]);
  }
  return gitStatus();
}

function parseSkillFrontmatter(content, fallbackName) {
  const match = String(content).match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  const data = {};
  if (match) {
    for (const line of match[1].split(/\r?\n/)) {
      const found = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (found) data[found[1]] = found[2].replace(/^['"]|['"]$/g, '');
    }
  }
  return {
    name: data.name || fallbackName,
    description: data.description || '暂无描述',
    autoInvoke: String(data['disable-model-invocation'] || 'false') !== 'true',
  };
}

function findSkillFiles(root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) files.push(target);
    if (entry.isDirectory()) {
      const skillFile = path.join(target, 'SKILL.md');
      if (fs.existsSync(skillFile)) files.push(skillFile);
    }
  }
  return files;
}

function userSkillRoot() {
  const root = path.join(dshHome(), 'skills');
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function listSkills() {
  const groups = [
    { source: 'bundled', root: bundledSkillDir(), readonly: true },
    { source: 'user', root: userSkillRoot(), readonly: false },
  ];
  return groups.flatMap((group) => findSkillFiles(group.root).map((file) => {
    const relativePath = path.relative(group.root, file).replaceAll('\\', '/');
    const content = fs.readFileSync(file, 'utf8');
    const meta = parseSkillFrontmatter(content, path.basename(file, '.md'));
    return {
      id: `${group.source}:${relativePath}`,
      source: group.source,
      relativePath,
      readonly: group.readonly,
      ...meta,
    };
  }));
}

function resolveSkillFile(id, requireUser = false) {
  const [source, ...rest] = String(id || '').split(':');
  const relativePath = rest.join(':');
  if (!['bundled', 'user'].includes(source) || !relativePath) throw new Error('技能编号无效');
  if (requireUser && source !== 'user') throw new Error('内置技能是只读的');
  const root = source === 'user' ? userSkillRoot() : bundledSkillDir();
  const target = path.resolve(root, relativePath);
  const prefix = `${path.resolve(root)}${path.sep}`;
  if (!target.startsWith(prefix)) throw new Error('技能路径越界');
  return { source, root, target, relativePath };
}

function validateSkillContent(content) {
  const text = String(content || '');
  if (!text.trim() || Buffer.byteLength(text) > 256 * 1024) throw new Error('技能内容为空或超过 256 KB');
  const meta = parseSkillFrontmatter(text, '');
  if (!meta.name || meta.description === '暂无描述') throw new Error('技能需要 YAML 头部中的 name 和 description');
  return text;
}

function saveSkill(payload) {
  const content = validateSkillContent(payload?.content);
  let target;
  if (payload?.id) {
    target = resolveSkillFile(payload.id, true).target;
  } else {
    const slug = String(payload?.slug || parseSkillFrontmatter(content, '').name || '')
      .trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug)) throw new Error('新技能名称需要使用英文、数字或连字符');
    const dir = path.join(userSkillRoot(), slug);
    fs.mkdirSync(dir, { recursive: true });
    target = path.join(dir, 'SKILL.md');
    if (fs.existsSync(target)) throw new Error('同名技能已经存在');
  }
  fs.writeFileSync(target, content, 'utf8');
  return listSkills();
}

function setSkillAutoInvoke(id, enabled) {
  const skill = resolveSkillFile(id, true);
  let content = fs.readFileSync(skill.target, 'utf8');
  if (!/^---\s*\r?\n/.test(content)) throw new Error('技能缺少 YAML 头部');
  if (/^disable-model-invocation:/m.test(content)) {
    content = content.replace(/^disable-model-invocation:.*$/m, `disable-model-invocation: ${enabled ? 'false' : 'true'}`);
  } else {
    content = content.replace(/^---\s*\r?\n/, `---\ndisable-model-invocation: ${enabled ? 'false' : 'true'}\n`);
  }
  fs.writeFileSync(skill.target, content, 'utf8');
  return listSkills();
}

function deleteSkill(id) {
  const skill = resolveSkillFile(id, true);
  const trash = path.join(app.getPath('userData'), 'skill-trash', `${Date.now()}-${path.basename(path.dirname(skill.target))}`);
  fs.mkdirSync(path.dirname(trash), { recursive: true });
  const skillDir = path.basename(skill.target).toLowerCase() === 'skill.md' ? path.dirname(skill.target) : skill.target;
  fs.renameSync(skillDir, trash);
  return listSkills();
}

function validationSuggestions() {
  const project = activeProject();
  if (!project) return [];
  const packageFile = path.join(project.path, 'package.json');
  if (!fs.existsSync(packageFile)) return [];
  try {
    const pkg = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
    const names = ['lint', 'typecheck', 'test', 'test:run', 'build'];
    return names.filter((name) => pkg.scripts?.[name]).map((name) => ({ name, command: `npm run ${name}` }));
  } catch { return []; }
}

async function stopDshAndWait() {
  const child = dshProcess;
  dshProcess = null;
  port = null;
  removeBackendPidFile();
  if (!child || child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  await new Promise((resolve) => {
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.once('error', resolve);
      killer.once('close', resolve);
      return;
    }
    child.once('exit', resolve);
    try { child.kill('SIGTERM'); } catch { resolve(); }
    setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      resolve();
    }, 3000);
  });
}

async function restartBackendForWorkspace() {
  if (backendRestartPromise) return backendRestartPromise;
  backendRestartPromise = (async () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('workspace:backend-state', { status: 'restarting' });
    }
    stopTerminal();
    await stopDshAndWait();
    await startDsh(backendWorkspace());
    const state = publicWorkspaceState();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('workspace:backend-state', {
        status: 'ready',
        backendUrl: state.backendUrl,
      });
      mainWindow.webContents.send('workspace:changed', state);
    }
    return state;
  })().finally(() => { backendRestartPromise = null; });
  return backendRestartPromise;
}

function backgroundImagePath() {
  const custom = customBackgroundPaths().find((candidate) => fs.existsSync(candidate));
  return custom || path.join(__dirname, 'assets', 'saoirse-girl-observatory-skirt.png');
}

function normalizeAppearance(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const fit = ['cover', 'contain', 'fill'].includes(source.fit) ? source.fit : 'cover';
  const position = ['center', 'left center', 'right center', 'center top'].includes(source.position)
    ? source.position
    : 'center';
  const zoom = [0.9, 1, 1.1, 1.25].includes(Number(source.zoom)) ? Number(source.zoom) : 1;
  return {
    enabled: source.enabled !== false,
    fit,
    position,
    overlay: Math.min(0.8, Math.max(0, Number(source.overlay ?? 0.28))),
    blur: Math.min(16, Math.max(0, Number(source.blur ?? 0))),
    zoom,
    backgroundName: String(source.backgroundName || '').slice(0, 160),
  };
}

function backgroundMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

function backgroundDataUrl() {
  try {
    const imagePath = backgroundImagePath();
    const b64 = fs.readFileSync(imagePath).toString('base64');
    return `data:${backgroundMime(imagePath)};base64,${b64}`;
  } catch { return ''; }
}

function publicAppearanceState(withPreview = true) {
  const custom = customBackgroundPaths().some((candidate) => fs.existsSync(candidate));
  return {
    ...normalizeAppearance(settings.appearance),
    custom,
    label: custom ? (settings.appearance.backgroundName || '自定义背景') : '鲸灵海底观测站 · 裙装全身版',
    previewDataUrl: withPreview ? backgroundDataUrl() : '',
  };
}

function sendAppearanceChanged() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('appearance:changed', publicAppearanceState(true));
  }
}

function buildHarnessBackgroundCss(dataUrl) {
  const appearance = normalizeAppearance(settings.appearance);
  const fontCss = `
    :root {
      --dsw-font-family: "Segoe UI Variable Text", "Microsoft YaHei UI", "Segoe UI", sans-serif !important;
      --ds-font-family: "Segoe UI Variable Text", "Microsoft YaHei UI", "Segoe UI", sans-serif !important;
    }
    body { font-family: "Segoe UI Variable Text", "Microsoft YaHei UI", "Segoe UI", sans-serif !important; }
  `;
  if (!appearance.enabled || !dataUrl) return fontCss;
  const blurScale = 1 + appearance.blur / 260;
  return `${fontCss}
    html { background: #061427 !important; }
    body {
      isolation: isolate;
      position: relative;
      background: transparent !important;
    }
    body::before,
    body::after {
      content: "";
      position: fixed;
      pointer-events: none;
      inset: 0;
    }
    body::before {
      z-index: 0;
      inset: -18px;
      background-image: url('${dataUrl}');
      background-size: ${appearance.fit};
      background-position: ${appearance.position};
      background-repeat: no-repeat;
      filter: blur(${appearance.blur}px);
      transform: scale(${blurScale});
    }
    body::after { z-index: 0; background: rgba(235, 246, 255, ${appearance.overlay}); }
    body[data-ds-dark-theme]::after { background: rgba(3, 13, 29, ${appearance.overlay}); }
    body > [class*="_frame"] { position: relative; z-index: 1; }

    [class*="_frame"],
    [class*="_centerCol"],
    [class*="_centerCol"] > [class*="_root"],
    [class*="_centerCol"] [class*="_root"][data-phase],
    [class*="_scrollBody"] { background-color: transparent !important; }

    [class*="_sidebarCol"] {
      background: rgba(242, 248, 255, .72) !important;
      backdrop-filter: blur(18px) saturate(115%);
    }
    body[data-ds-dark-theme] [class*="_sidebarCol"] {
      background: rgba(5, 19, 38, .78) !important;
    }
    [class*="_detailsCol"] > [class*="_root"] {
      background: rgba(246, 250, 255, .76) !important;
      backdrop-filter: blur(18px) saturate(110%);
    }
    body[data-ds-dark-theme] [class*="_detailsCol"] > [class*="_root"] {
      background: rgba(6, 20, 39, .80) !important;
    }
    [class*="_composerHero"] [class*="_card"] {
      background: rgba(255, 255, 255, .78) !important;
      backdrop-filter: blur(20px) saturate(118%);
      box-shadow: 0 18px 55px rgba(9, 32, 65, .18) !important;
    }
    body[data-ds-dark-theme] [class*="_composerHero"] [class*="_card"] {
      background: rgba(7, 25, 48, .78) !important;
      box-shadow: 0 18px 60px rgba(0, 0, 0, .30) !important;
    }
    [class*="_root"][data-phase="active"] [class*="_composerSeat"] {
      background: linear-gradient(180deg, transparent 0, rgba(244, 250, 255, .78) 42px) !important;
    }
    body[data-ds-dark-theme] [class*="_root"][data-phase="active"] [class*="_composerSeat"] {
      background: linear-gradient(180deg, transparent 0, rgba(4, 17, 34, .82) 42px) !important;
    }
    [class*="_heroGlow"] { opacity: .18 !important; }
    [class*="_headline"], [class*="_workspaceRow"] { text-shadow: 0 1px 10px rgba(255, 255, 255, .24); }
    body[data-ds-dark-theme] [class*="_headline"],
    body[data-ds-dark-theme] [class*="_workspaceRow"] { text-shadow: 0 1px 12px rgba(0, 0, 0, .55); }
    @media (min-width: 1000px) {
      [class*="_root"][data-phase="hero"] { --dsh-chat-content-width: 640px !important; }
      [class*="_root"][data-phase="hero"] [class*="_composerHero"] {
        position: relative;
        left: -160px;
      }
    }
    @media (min-width: 1200px) {
      [class*="_root"][data-phase="hero"] [class*="_composerHero"] { left: -220px; }
    }
    @media (min-width: 1500px) {
      [class*="_root"][data-phase="hero"] [class*="_composerHero"] { left: -256px; }
    }
  `;
}

/** 往工作台与 Harness WebView 注入背景；滤镜永远只作用于背景伪元素。 */
async function applyBackground() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (bgCssKey) {
    try { await mainWindow.webContents.removeInsertedCSS(bgCssKey); } catch { /* ignore */ }
    bgCssKey = null;
  }
  const dataUrl = backgroundDataUrl();
  const hostAppearance = normalizeAppearance(settings.appearance);
  const hostCss = hostAppearance.enabled && dataUrl ? `
    .conversation-deck {
      background-image: linear-gradient(rgba(5, 15, 29, ${Math.max(.18, hostAppearance.overlay)}), rgba(5, 15, 29, ${Math.max(.18, hostAppearance.overlay)})), url('${dataUrl}') !important;
      background-size: ${hostAppearance.fit} !important;
      background-position: ${hostAppearance.position} !important;
      background-repeat: no-repeat !important;
    }
  ` : '';
  try { bgCssKey = await mainWindow.webContents.insertCSS(hostCss); } catch { /* window reloading */ }

  const guest = harnessGuest;
  if (!guest || guest.isDestroyed()) return;
  if (harnessBgCssKey) {
    try { await guest.removeInsertedCSS(harnessBgCssKey); } catch { /* page changed */ }
    harnessBgCssKey = null;
  }
  try {
    guest.setZoomFactor(hostAppearance.zoom);
    harnessBgCssKey = await guest.insertCSS(buildHarnessBackgroundCss(dataUrl));
  } catch (error) {
    console.error('[saoirse] Harness 背景注入失败:', error);
  }
}

/** 让用户选一张图作为自定义背景。 */
async function chooseBackground() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择背景图片',
    filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths[0]) return;
  try {
    const source = result.filePaths[0];
    const stat = fs.statSync(source);
    if (!stat.isFile() || stat.size > 24 * 1024 * 1024) throw new Error('背景图片必须小于 24 MB');
    for (const candidate of customBackgroundPaths()) {
      try { fs.unlinkSync(candidate); } catch { /* absent */ }
    }
    const ext = path.extname(source).slice(1).toLowerCase() || 'jpg';
    fs.copyFileSync(source, path.join(app.getPath('userData'), `custom-background.${ext}`));
    settings.appearance = normalizeAppearance({
      ...settings.appearance,
      enabled: true,
      backgroundName: path.basename(source),
    });
    saveSettings();
    await applyBackground();
    sendAppearanceChanged();
    notify(APP_NAME, '背景已更换');
    return publicAppearanceState(true);
  } catch (err) {
    console.error('[saoirse] 更换背景失败:', err);
    throw err;
  }
}

async function updateAppearance(patch) {
  settings.appearance = normalizeAppearance({ ...settings.appearance, ...(patch || {}) });
  saveSettings();
  await applyBackground();
  sendAppearanceChanged();
  return publicAppearanceState(true);
}

/** 恢复默认背景。 */
async function resetBackground() {
  for (const candidate of customBackgroundPaths()) {
    try { fs.unlinkSync(candidate); } catch { /* absent */ }
  }
  settings.appearance = normalizeAppearance(DEFAULT_SETTINGS.appearance);
  saveSettings();
  await applyBackground();
  sendAppearanceChanged();
  notify(APP_NAME, '已恢复默认背景');
  return publicAppearanceState(true);
}

function rebuildTrayMenu() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: '显示 / 隐藏 Saoirse', click: () => toggleMainWindow() },
    { label: '新手向导（设置 API Key）', click: () => createWelcomeWindow() },
    { type: 'separator' },
    { label: '更换背景', click: () => chooseBackground() },
    { label: '恢复默认背景', click: () => resetBackground() },
    { type: 'separator' },
    { label: '桌面萌宠', type: 'checkbox', checked: settings.petEnabled, click: (item) => setPetEnabled(item.checked) },
    { label: '任务完成时通知', type: 'checkbox', checked: settings.notifyOnComplete, click: (item) => setNotify(item.checked) },
    { label: '开机自启', type: 'checkbox', checked: settings.launchAtLogin, click: (item) => setAutoStart(item.checked) },
    { type: 'separator' },
    {
      label: 'Windows 右键菜单',
      submenu: [
        { label: '安装「用 Saoirse 打开」', click: () => installContextMenu() },
        { label: '卸载', click: () => uninstallContextMenu() },
      ],
    },
    { type: 'separator' },
    { label: '卸载 Saoirse', click: () => uninstall() },
    { label: '退出', click: () => { quitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
}

function setNotify(enabled) {
  settings.notifyOnComplete = enabled;
  saveSettings();
  if (!enabled) { lastBusyAt = 0; notifiedForCycle = false; }
}

function setAutoStart(enabled) {
  settings.launchAtLogin = enabled;
  saveSettings();
  app.setLoginItemSettings({ openAtLogin: enabled });
}

function setPetEnabled(enabled) {
  settings.petEnabled = enabled;
  saveSettings();
  if (enabled) createPetWindow();
  else destroyPetWindow();
}

// ---------------------------------------------------------------------------
// Global shortcut
// ---------------------------------------------------------------------------
function registerShortcuts() {
  const accel = 'CommandOrControl+Shift+D';
  try {
    globalShortcut.register(accel, () => toggleMainWindow());
    console.log(`[saoirse] global shortcut registered: ${accel}`);
  } catch (err) {
    console.error('[saoirse] shortcut register failed:', err);
  }
}

// ---------------------------------------------------------------------------
// Windows "Open with Saoirse" context menu
// ---------------------------------------------------------------------------
function runReg(args) {
  return new Promise((resolve) => {
    const child = spawn('reg', args, { stdio: 'ignore', windowsHide: true });
    child.on('exit', () => resolve());
    child.on('error', () => resolve());
  });
}

async function installContextMenu() {
  if (!app.isPackaged) {
    dialog.showMessageBox({ type: 'info', title: APP_NAME, message: '右键菜单只在安装后的版本可用', detail: '请安装打包好的 Saoirse 后再设置右键菜单。' });
    return;
  }
  const exe = process.execPath;
  const cmd = `"${exe}" --open "%1"`;
  const roots = ['HKCU\\Software\\Classes\\*\\shell\\Saoirse', 'HKCU\\Software\\Classes\\Directory\\shell\\Saoirse'];
  for (const r of roots) {
    await runReg(['add', r, '/ve', '/t', 'REG_SZ', '/d', '用 Saoirse 打开', '/f']);
    await runReg(['add', `${r}\\command`, '/ve', '/t', 'REG_SZ', '/d', cmd, '/f']);
    await runReg(['add', r, '/v', 'Icon', '/t', 'REG_SZ', '/d', `${exe},0`, '/f']);
  }
  notify(APP_NAME, '已添加右键「用 Saoirse 打开」');
}

async function uninstallContextMenu() {
  await runReg(['delete', 'HKCU\\Software\\Classes\\*\\shell\\Saoirse', '/f']);
  await runReg(['delete', 'HKCU\\Software\\Classes\\Directory\\shell\\Saoirse', '/f']);
  notify(APP_NAME, '已移除右键菜单');
}

// ---------------------------------------------------------------------------
// --open <path> handling
// ---------------------------------------------------------------------------
async function handleOpenArg(argv) {
  const i = argv.indexOf('--open');
  if (i === -1 || !argv[i + 1]) return;
  try {
    const target = path.resolve(argv[i + 1]);
    const stat = fs.statSync(target);
    const folder = stat.isDirectory() ? target : path.dirname(target);
    upsertProject(folder);
    if (dshProcess) await restartBackendForWorkspace();
  } catch (error) {
    notify(APP_NAME, `无法打开项目：${error.message}`);
  }
  if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
const gotLock = (!app.isPackaged && process.env.SAOIRSE_DEV_MULTI_INSTANCE === '1')
  ? true
  : app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); }
    handleOpenArg(argv);
  });

  app.whenReady().then(async () => {
    loadSettings();
    try {
      await startDsh();
      console.log(`[saoirse] backend ready at http://${HOST}:${port}`);
      createWindow();
      console.log('[saoirse] window created');
    } catch (err) {
      // 第一次失败：清理残留后重试一次（常见于上次异常退出导致端口/进程残留）
      try {
        stopDsh();
        await cleanupStaleDsh();
        await startDsh();
        console.log(`[saoirse] backend ready (retry) at http://${HOST}:${port}`);
        createWindow();
        console.log('[saoirse] window created (retry)');
      } catch (err2) {
        const message = err2 && err2.message ? err2.message : String(err2);
        dialog.showErrorBox(
          APP_NAME,
          `DeepSeek Harness 后端启动失败：\n\n${message}\n\n请退出 Saoirse 后重试；若问题持续，请检查本机 Node 与安全软件设置。`,
        );
        app.quit();
        return;
      }
    }

    createTray();
    registerShortcuts();
    startCompletionWatcher();
    setTimeout(checkForUpdates, 5000);
    if (settings.petEnabled) {
      createPetWindow();
      scheduleWander();
      scheduleSleep();
      schedulePetChatter();
    }
    if (settings.launchAtLogin) setAutoStart(true);
    if (!settings.onboardingDone) createWelcomeWindow();

    handleOpenArg(process.argv).catch((error) => console.error('[saoirse] --open failed:', error));

    app.on('activate', () => {
      ensurePet();
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    // Live in the tray; do not quit.
  });

  app.on('before-quit', () => {
    quitting = true;
    globalShortcut.unregisterAll();
    stopCompletionWatcher();
    stopTerminal();
    stopDsh();
  });

  app.on('will-quit', () => {
    stopDsh();
  });

  // Welcome wizard IPC
  ipcMain.on('welcome-open-url', (_e, url) => {
    if (typeof url === 'string' && /^https:\/\//.test(url)) shell.openExternal(url);
  });
  ipcMain.on('welcome-done', () => {
    settings.onboardingDone = true;
    saveSettings();
    if (welcomeWindow && !welcomeWindow.isDestroyed()) welcomeWindow.close();
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });

  // Saoirse 0.2 workspace shell IPC. Only the trusted local shell owns a preload,
  // while the embedded Harness webview remains isolated without Node access.
  function assertWorkspaceSender(event) {
    if (!mainWindow || mainWindow.isDestroyed() || event.sender.id !== mainWindow.webContents.id) {
      throw new Error('不受信任的工作台请求');
    }
  }

  ipcMain.handle('workspace:bootstrap', (event) => {
    assertWorkspaceSender(event);
    return publicWorkspaceState();
  });

  ipcMain.handle('workspace:choose', async (event) => {
    assertWorkspaceSender(event);
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择 Saoirse 项目文件夹',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    upsertProject(result.filePaths[0]);
    return restartBackendForWorkspace();
  });

  ipcMain.handle('workspace:activate', async (event, id) => {
    assertWorkspaceSender(event);
    const project = settings.projects.find((item) => item.id === String(id));
    if (!project) throw new Error('项目不存在或已被移除');
    if (!fs.existsSync(project.path)) throw new Error('项目文件夹已不存在');
    if (settings.activeProjectId === project.id) return publicWorkspaceState();
    settings.activeProjectId = project.id;
    project.lastOpenedAt = Date.now();
    terminalCwd = project.path;
    saveSettings();
    return restartBackendForWorkspace();
  });

  ipcMain.handle('workspace:remove', async (event, id) => {
    assertWorkspaceSender(event);
    const removingActive = settings.activeProjectId === String(id);
    settings.projects = settings.projects.filter((item) => item.id !== String(id));
    if (removingActive) {
      settings.activeProjectId = settings.projects[0]?.id || null;
      terminalCwd = activeProject()?.path || null;
    }
    saveSettings();
    return removingActive ? restartBackendForWorkspace() : publicWorkspaceState();
  });

  ipcMain.handle('workspace:list-directory', (event, relativePath = '') => {
    assertWorkspaceSender(event);
    return listProjectDirectory(activeProject(), relativePath);
  });

  ipcMain.handle('workspace:open-path', async (event, relativePath) => {
    assertWorkspaceSender(event);
    const target = resolveProjectPath(activeProject(), relativePath);
    const error = await shell.openPath(target);
    if (error) throw new Error(error);
    return true;
  });

  ipcMain.handle('workspace:reveal-path', (event, relativePath) => {
    assertWorkspaceSender(event);
    const target = resolveProjectPath(activeProject(), relativePath);
    shell.showItemInFolder(target);
    return true;
  });

  ipcMain.handle('git:status', async (event) => {
    assertWorkspaceSender(event);
    return gitStatus();
  });

  ipcMain.handle('git:diff', async (event, relativePath, staged = false) => {
    assertWorkspaceSender(event);
    return gitDiff(relativePath, Boolean(staged));
  });

  ipcMain.handle('git:history', async (event) => {
    assertWorkspaceSender(event);
    return gitHistory();
  });

  ipcMain.handle('git:stage', async (event, paths) => {
    assertWorkspaceSender(event);
    const items = Array.isArray(paths) ? paths.slice(0, 200) : [];
    if (!items.length) throw new Error('请选择要暂存的文件');
    for (const item of items) resolveProjectPath(activeProject(), item);
    await gitCommand(['add', '--', ...items]);
    return gitStatus();
  });

  ipcMain.handle('git:unstage', async (event, paths) => {
    assertWorkspaceSender(event);
    const items = Array.isArray(paths) ? paths.slice(0, 200) : [];
    if (!items.length) throw new Error('请选择要取消暂存的文件');
    for (const item of items) resolveProjectPath(activeProject(), item);
    await gitCommand(['restore', '--staged', '--', ...items]);
    return gitStatus();
  });

  ipcMain.handle('git:commit', async (event, message) => {
    assertWorkspaceSender(event);
    const cleanMessage = String(message || '').trim().slice(0, 240);
    if (!cleanMessage) throw new Error('请输入提交说明');
    const result = await gitCommand(['commit', '-m', cleanMessage]);
    return { output: (result.stdout || result.stderr).trim(), status: await gitStatus() };
  });

  ipcMain.handle('git:undo-file', async (event, relativePath) => {
    assertWorkspaceSender(event);
    return undoGitFile(relativePath);
  });

  ipcMain.handle('checkpoint:create', async (event, label) => {
    assertWorkspaceSender(event);
    return createCheckpoint(label);
  });

  ipcMain.handle('checkpoint:list', (event) => {
    assertWorkspaceSender(event);
    return listCheckpoints();
  });

  ipcMain.handle('checkpoint:restore', (event, id) => {
    assertWorkspaceSender(event);
    return restoreCheckpoint(id);
  });

  ipcMain.handle('validation:suggest', (event) => {
    assertWorkspaceSender(event);
    return validationSuggestions();
  });

  ipcMain.handle('skills:list', (event) => {
    assertWorkspaceSender(event);
    return listSkills();
  });

  ipcMain.handle('skills:read', (event, id) => {
    assertWorkspaceSender(event);
    const skill = resolveSkillFile(id);
    return { id, content: fs.readFileSync(skill.target, 'utf8'), readonly: skill.source === 'bundled' };
  });

  ipcMain.handle('skills:save', async (event, payload) => {
    assertWorkspaceSender(event);
    const skills = saveSkill(payload);
    await restartBackendForWorkspace();
    return skills;
  });

  ipcMain.handle('skills:toggle', async (event, id, enabled) => {
    assertWorkspaceSender(event);
    const skills = setSkillAutoInvoke(id, Boolean(enabled));
    await restartBackendForWorkspace();
    return skills;
  });

  ipcMain.handle('skills:delete', async (event, id) => {
    assertWorkspaceSender(event);
    const skills = deleteSkill(id);
    await restartBackendForWorkspace();
    return skills;
  });

  ipcMain.handle('skills:import', async (event) => {
    assertWorkspaceSender(event);
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '导入 Saoirse 技能 Markdown',
      properties: ['openFile'],
      filters: [{ name: 'Markdown 技能', extensions: ['md'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const source = result.filePaths[0];
    const content = validateSkillContent(fs.readFileSync(source, 'utf8'));
    const meta = parseSkillFrontmatter(content, path.basename(source, '.md'));
    const skills = saveSkill({ slug: meta.name, content });
    await restartBackendForWorkspace();
    return skills;
  });

  ipcMain.handle('settings:set-permission', async (event, mode) => {
    assertWorkspaceSender(event);
    const next = String(mode || '');
    if (!['read-only', 'workspace-write', 'danger-full-access'].includes(next)) throw new Error('权限模式无效');
    settings.permissionMode = next;
    saveSettings();
    return restartBackendForWorkspace();
  });

  ipcMain.handle('appearance:get', (event) => {
    assertWorkspaceSender(event);
    return publicAppearanceState(true);
  });

  ipcMain.handle('appearance:choose', async (event) => {
    assertWorkspaceSender(event);
    return chooseBackground();
  });

  ipcMain.handle('appearance:update', async (event, patch) => {
    assertWorkspaceSender(event);
    return updateAppearance(patch);
  });

  ipcMain.handle('appearance:reset', async (event) => {
    assertWorkspaceSender(event);
    return resetBackground();
  });

  ipcMain.handle('mcp:save', async (event, payload) => {
    assertWorkspaceSender(event);
    const input = payload || {};
    const existing = settings.mcpServers.find((item) => item.id === String(input.id || ''));
    const server = normalizeMcpServer(input, existing?.id || '');
    if (settings.mcpServers.some((item) => item.id !== server.id && item.serverName === server.serverName)) {
      throw new Error('MCP 名称必须唯一');
    }
    if (existing) Object.assign(existing, server);
    else settings.mcpServers.push(server);
    saveSettings();
    writeMcpPatch();
    return restartBackendForWorkspace();
  });

  ipcMain.handle('mcp:toggle', async (event, id, enabled) => {
    assertWorkspaceSender(event);
    const server = settings.mcpServers.find((item) => item.id === String(id));
    if (!server) throw new Error('MCP 服务器不存在');
    server.enabled = Boolean(enabled);
    saveSettings();
    writeMcpPatch();
    return restartBackendForWorkspace();
  });

  ipcMain.handle('mcp:delete', async (event, id) => {
    assertWorkspaceSender(event);
    settings.mcpServers = settings.mcpServers.filter((item) => item.id !== String(id));
    saveSettings();
    writeMcpPatch();
    return restartBackendForWorkspace();
  });

  ipcMain.handle('terminal:run', (event, command) => {
    assertWorkspaceSender(event);
    return runTerminalCommand(command);
  });

  ipcMain.handle('terminal:stop', (event) => {
    assertWorkspaceSender(event);
    stopTerminal();
    return true;
  });

  ipcMain.handle('terminal:reset-cwd', (event) => {
    assertWorkspaceSender(event);
    terminalCwd = terminalRoot();
    sendTerminal('terminal:cwd', { cwd: terminalCwd });
    return terminalCwd;
  });

  // Pet drag + click
  let petDragStartScreen = null;
  let petDragStartPos = null;
  ipcMain.on('pet-drag-start', (_e, { x, y }) => {
    if (!petWindow) return;
    // 用户开始拖动：立即停掉走动动画，避免瞬移
    if (moveTimer) { clearInterval(moveTimer); moveTimer = null; }
    if (petState === 'walk-left' || petState === 'walk-right') setPetState('idle');
    // 停下后重新安排下一次散步（不阻断后续走动）
    scheduleWander();
    petDragStartScreen = { x, y };
    petDragStartPos = petWindow.getPosition();
  });
  ipcMain.on('pet-drag-move', (_e, { x, y }) => {
    if (!petWindow || !petDragStartScreen || !petDragStartPos) return;
    petWindow.setPosition(
      petDragStartPos[0] + (x - petDragStartScreen.x),
      petDragStartPos[1] + (y - petDragStartScreen.y),
    );
  });
  ipcMain.on('pet-clicked', () => {
    wakePet();
    toggleMainWindow();
    petSay('要我帮忙吗？');
    setPetState('eat');
    clearTimeout(eatTimer);
    eatTimer = setTimeout(() => {
      if (petState === 'eat') setPetState('idle');
    }, 1500);
  });
  ipcMain.on('pet-set-ignore-mouse', (_e, ignore) => {
    // 点击穿透只在 Windows 上可靠；Linux 上一旦开启整条鱼都点不到
    if (process.platform !== 'win32') return;
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.setIgnoreMouseEvents(ignore, { forward: true });
    }
  });
}
