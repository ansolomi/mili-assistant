// Transparent always-on-top window that shows the VRM stage (?overlay=1) and lets it walk along the taskbar.
const { app, BrowserWindow, Tray, Menu, nativeImage, screen, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const W = 360, H = 640;
const url = process.env.STAGE_URL ?? 'http://localhost:8765/?overlay=1';
let win, tray;

// 16x16 pink square so the tray entry has an icon without shipping a file
const iconPng = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAFklEQVR42mP8z8Dwn4ECwDhqwKgBAIkHBAHqUbQRAAAAAElFTkSuQmCC';

// project root = the folder holding start-vtuber.ps1 (the exe lives in <root>/Mili, dev runs from <root>/Documentation/app/overlay)
const findRoot = () => {
  for (let d = process.env.VTUBER_ROOT ?? path.dirname(app.getAppPath()), i = 0; i < 8; d = path.dirname(d), i++) if (fs.existsSync(path.join(d, 'start-vtuber.ps1'))) return d;
  return null;
};
const alive = (u) => fetch(u, { signal: AbortSignal.timeout(2500) }).then((r) => r.ok, () => false);

// Starts Ollama, the brain and the stage server through start-vtuber.ps1 when they are not up yet
const log = (m) => fs.appendFileSync(path.join(findRoot() ?? require('os').tmpdir(), 'Documentation', 'logs', 'overlay.log'), `${new Date().toISOString()} ${m}${require('os').EOL}`);
async function ensureServices() {
  log(`ensureServices root=${findRoot()} appPath=${app.getAppPath()}`);
  if (await alive('http://localhost:8765/api/models') && await alive('http://localhost:12393/')) return true;
  log('services down, spawning');
  const root = findRoot();
  if (!root) return false;
  tray?.setToolTip('Mili: starting services...');
  spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'start-vtuber.ps1'), '-NoWindow'], { stdio: 'ignore', windowsHide: true }).on('error', (e) => log(`spawn error ${e.message}`)).on('exit', (c) => log(`start script exit ${c}`)).unref();
  for (let i = 0; i < 90; i++) { // up to ~4.5 min: the brain loads speech models
    await new Promise((ok) => setTimeout(ok, 3000));
    if (await alive('http://localhost:8765/api/models') && await alive('http://localhost:12393/')) return true;
  }
  return false;
}

if (!app.requestSingleInstanceLock()) app.quit();
else app.whenReady().then(async () => {
  const area = screen.getPrimaryDisplay().workArea;
  win = new BrowserWindow({
    width: W, height: H, x: area.x + area.width - W - 40, y: area.y + area.height - H + 6,
    transparent: true, frame: false, resizable: false, hasShadow: false, skipTaskbar: true, alwaysOnTop: true, focusable: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), autoplayPolicy: 'no-user-gesture-required', backgroundThrottling: false },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true });
  win.webContents.on('did-fail-load', () => setTimeout(() => win.loadURL(url), 3000)); // services may still be starting

  ipcMain.handle('bounds', () => ({ ...win.getBounds(), area: screen.getPrimaryDisplay().workArea }));
  ipcMain.on('pos', (_e, x, y) => {
    // clamp: a wild value (e.g. a minimised window's rect) must never reach setPosition
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    try { win.setPosition(Math.max(-20000, Math.min(20000, Math.round(x))), Math.max(-20000, Math.min(20000, Math.round(y)))); } catch (e) { console.error('setPosition', x, y, e.message); }
  });
  ipcMain.on('ignore', (_e, on) => win.setIgnoreMouseEvents(on, { forward: true }));
  ipcMain.on('focus', () => { win.focus(); win.webContents.focus(); });
  // cursor position at 10 Hz so she can look at it even though the window is click-through
  const send = (ch) => () => win.webContents.send(ch);
  setInterval(() => win.webContents.send('cursor', screen.getCursorScreenPoint()), 100);

  // foreground window frame (for perching on its top edge); fg.ps1 prints one line per 400 ms
  const fg = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'fg.ps1')], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  let buf = '';
  fg.stdout.on('data', (d) => {
    buf += d;
    const lines = buf.split(/\r?\n/);
    buf = lines.pop();
    const [l, t, r, bt, z, pid, cls] = (lines.pop() ?? '').split(',');
    const ok = cls && Number(pid) !== process.pid && !/^(Progman|WorkerW|Shell_TrayWnd|Shell_SecondaryTrayWnd)$/.test(cls.trim());
    win.webContents.send('fg', ok ? { x: +l, y: +t, w: r - l, h: bt - t, max: z === '1' } : null);
  });
  app.on('quit', () => fg.kill());

  tray = new Tray(nativeImage.createFromDataURL(`data:image/png;base64,${iconPng}`));
  tray.setToolTip('Mili');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Walk / stay put', click: send('toggle-walk') },
    { label: 'Explore my files now', click: send('learn') },
    { label: 'Quit (leave services running)', click: () => app.quit() },
    { label: 'Quit and stop all services', click: () => { const r = findRoot(); if (r) spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(r, 'stop-vtuber.ps1')], { stdio: 'ignore', windowsHide: true }).unref(); app.quit(); } },
  ]));
  if (await ensureServices()) { tray.setToolTip('Mili'); win.loadURL(url); } else tray.setToolTip('Mili: services did not start (see Documentation/logs)');
});

app.on('window-all-closed', () => app.quit());
