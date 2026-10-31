// PearOffice desktop: Electron main process. Starts the shared Bare worklet
// (the same bundle the phones will run), opens the window and relays calls and
// events between the UI and the worklet. See proposal section 9.

const { app, BrowserWindow, Tray, Menu, ipcMain, shell, clipboard, dialog, nativeImage, screen, session } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { Worklet } = require('./worklet')
const { SeederProcess } = require('./seeder-process')
const { resolvePaths } = require('./paths')
const { createLoginItem } = require('./login')
const { startUpdates } = require('./updates')
const { installMenuEntry } = require('./appimage')
const { createFileWindows } = require('./file-windows')
const { urlKind, openUrl } = require('./open-url')

const SMOKE = !!process.env.PEAROFFICE_SMOKE

// A copy given its own data folder (npm run desktop, the smoke test) keeps
// Electron's files there too: the page's storage (zoom, theme), so one smoke
// run cannot leave settings for the next, and the single-instance lock, so
// a dev copy runs beside an installed PearOffice instead of handing over to
// it.
if (process.env.PEAROFFICE_DATA) app.setPath('userData', path.join(process.env.PEAROFFICE_DATA, 'electron'))

// One running copy per data folder: the worklet holds a lock on its store.
if (!SMOKE && !app.requestSingleInstanceLock()) app.exit(0)

// pearoffice:// invite links open the app. Registration only makes sense for an
// installed copy; a dev checkout still handles links passed on the command line.
// An AppImage first adds its own menu entry, which the link handler and the
// taskbar icon both need.
const ICON = path.join(__dirname, 'build', 'icon.png')
// The macOS menu bar wants a one-colour template image, which it draws
// black or white to match the bar; @2x is picked up beside it.
const TRAY_MAC = path.join(__dirname, 'build', 'trayTemplate.png')
if (!SMOKE && process.platform === 'linux' && process.env.APPIMAGE) {
  try { installMenuEntry({ appImage: process.env.APPIMAGE, image: nativeImage.createFromPath(ICON) }) } catch (err) { console.error('[pearoffice] menu entry', err.message) }
}
if (app.isPackaged) app.setAsDefaultProtocolClient('pearoffice')

let pendingLink = linkIn(process.argv)

function linkIn (argv) {
  return (argv || []).find((a) => typeof a === 'string' && a.startsWith('pearoffice://')) || null
}

function sendLink (url) {
  if (!url) return
  pendingLink = url
  if (win && !win.isDestroyed() && !win.webContents.isLoading()) win.webContents.send('worklet:event', { name: 'app:deeplink', data: { url } })
}

const paths = resolvePaths({ packaged: app.isPackaged, resourcesPath: process.resourcesPath })
const dataDir = process.env.PEAROFFICE_DATA || path.join(app.getPath('userData'), 'data')

let win = null
let worklet = null
let quitting = false
let tray = null
// A smoke run must not touch the real login items.
const loginItem = createLoginItem({ app, autostartDir: SMOKE ? path.join(dataDir, 'autostart') : null, fake: SMOKE })

// Desktop-only settings, kept next to the data (not in the sheets).
const settingsFile = path.join(dataDir, 'desktop-settings.json')
const DEFAULTS = { keepOnline: false, runSeeder: false, startAtLogin: false }
function readSettings () {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile, 'utf8')) } } catch { return { ...DEFAULTS } }
}
// The tray (and hide-on-close) is on while either keeps the app running.
const stayRunning = () => settings.keepOnline || settings.runSeeder
let settings = readSettings()
// Make the system's login entry match the setting. Runs on every start too,
// so a reinstalled or moved app points the entry at itself again.
function syncLoginItem () {
  // Starting at login only makes sense while PearOffice stays running.
  if (!stayRunning()) settings.startAtLogin = false
  try {
    if (settings.startAtLogin) loginItem.setEnabled(true)
    else if (loginItem.isEnabled()) loginItem.setEnabled(false)
  } catch (err) {
    log('login item failed:', err.message)
    settings.startAtLogin = loginItem.isEnabled()
  }
}
function writeSettings (patch) {
  settings = { ...settings, ...patch }
  syncLoginItem()
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true })
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2))
  if (stayRunning()) createTray()
  else if (tray) { tray.destroy(); tray = null }
  if (settings.runSeeder) startSeeder().catch((err) => log('seeder failed to start:', err.message))
  else stopSeeder()
}

// "Run a seeder on this computer": the blind seeder as its own process.
let seeder = null
function startSeeder () {
  if (seeder && seeder.running) return Promise.resolve()
  seeder = new SeederProcess({
    barePath: paths.bare,
    bundlePath: paths.seeder,
    dataDir: path.join(dataDir, 'seeder'),
    onLog: (kind, text) => log(kind, text)
  })
  return seeder.start()
}
function stopSeeder () {
  if (seeder) { const s = seeder; seeder = null; return s.stop() }
}

function showWindow () {
  if (!win || win.isDestroyed()) return
  win.show()
  win.focus()
}

// "Keep my sheets online" (proposal section 8): with it on, closing the
// window hides it and PearOffice keeps syncing from the tray.
function createTray () {
  if (tray && !tray.isDestroyed()) return
  try {
    tray = new Tray(process.platform === 'darwin' ? TRAY_MAC : ICON)
  } catch (err) {
    log('tray failed:', err.message)
    return
  }
  tray.setToolTip('PearOffice is running')
  setTrayMenu()
  tray.on('click', showWindow)
}

// "Update to 0.2.0" appears when a newer release is out.
function setTrayMenu () {
  if (!tray || tray.isDestroyed()) return
  const u = updates && updates.state().update
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open PearOffice', click: showWindow },
    ...(u && u.available ? [{ label: 'Update to ' + u.latest, click: () => { updates.apply(); showWindow() } }] : []),
    { type: 'separator' },
    { label: 'Quit PearOffice', click: () => app.quit() }
  ]))
}

let updates = null

function log (...args) {
  if (!app.isPackaged || SMOKE || process.env.PEAROFFICE_DEBUG) console.log('[pearoffice]', ...args)
}

function startWorklet () {
  worklet = new Worklet({
    barePath: paths.bare,
    bundlePath: paths.bundle,
    dataDir,
    onLog: (kind, text) => log(kind, text.trimEnd())
  })
  // Events go to every window: the audience window of a slide show keeps
  // its own copy of the deck too.
  worklet.on('event', (msg) => sendAll(msg))
  worklet.on('exit', ({ code, signal }) => {
    log('worklet exited', code, signal)
    if (!quitting) sendAll({ name: 'worklet:exit', data: { code, signal } })
  })
  return worklet.start()
}

function sendTo (w, msg) {
  if (w && !w.isDestroyed()) w.webContents.send('worklet:event', msg)
}
function sendAll (msg) {
  sendTo(win, msg)
  sendTo(audience, msg)
  for (const w of fileWindows.all()) sendTo(w, msg)
}

// Files in their own windows (proposals/2026-10-26-file-windows.md). The
// main window is told which files have one, so it brings that window
// forward instead of opening the file itself.
const fileWindows = createFileWindows({
  BrowserWindow,
  screen,
  uiFile: paths.ui,
  dataDir,
  preload: path.join(__dirname, 'preload.js'),
  icon: process.platform === 'linux' ? ICON : undefined,
  smoke: SMOKE,
  guard: (w) => guard(w),
  mainWindow: () => win,
  isQuitting: () => quitting,
  onChange: () => sendTo(win, { name: 'app:windows', data: { ids: fileWindows.ids() } }),
  log
})

// --- slide shows (src/ui/slides/Present.jsx) ---------------------------------
// With one display the main window goes full screen. With two or more, a
// second window shows the slides full screen on another display and the main
// window becomes the presenter view; the presenter sends app:presentGo and
// this relays it to the audience window, which sends its keys and clicks
// back as app:presentInput. Ending the show in either window, or closing
// either, closes the audience window and tells the main window
// (app:presentEnded). PEAROFFICE_FAKE_DISPLAYS=1 or 2 pretends there are
// that many displays, for the smoke test.

let audience = null
let presenting = false
let wasFullScreen = false
let presenter = null // the window the show was started from

function otherDisplay () {
  const here = screen.getDisplayMatching(presenter.getBounds())
  const fake = SMOKE && Number(process.env.PEAROFFICE_FAKE_DISPLAYS)
  if (fake) return fake >= 2 ? { bounds: { ...here.bounds, x: here.bounds.x + here.bounds.width } } : null
  return screen.getAllDisplays().find((d) => d.id !== here.id) || null
}

function presentStart ({ sheetId, slideId }, from = win) {
  presentEnd({ quiet: true })
  presenter = from && !from.isDestroyed() ? from : win
  if (!presenter || presenter.isDestroyed()) return { mode: 'single' }
  presenting = true
  const other = otherDisplay()
  if (!other) {
    wasFullScreen = presenter.isFullScreen()
    if (!SMOKE && !wasFullScreen) presenter.setFullScreen(true)
    return { mode: 'single' }
  }
  const b = other.bounds
  const show = audience = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    show: false,
    frame: false,
    title: 'PearOffice slide show',
    icon: process.platform === 'linux' ? ICON : undefined,
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      offscreen: SMOKE
    }
  })
  show.removeMenu()
  show.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  show.webContents.on('will-navigate', (e) => e.preventDefault())
  show.once('ready-to-show', () => {
    if (SMOKE || show.isDestroyed()) return
    show.show()
    show.setFullScreen(true)
    // Keys stay with the presenter view.
    if (presenter && !presenter.isDestroyed()) presenter.focus()
  })
  show.on('closed', () => {
    if (audience === show) audience = null
    if (presenting) presentEnd()
  })
  show.loadFile(paths.ui, { query: { audience: String(sheetId || ''), slide: String(slideId || '') } })
  return { mode: 'presenter' }
}

function presentEnd ({ quiet = false } = {}) {
  const was = presenting
  presenting = false
  const show = audience
  audience = null
  if (show && !show.isDestroyed()) show.close()
  const p = presenter || win
  if (p && !p.isDestroyed() && p.isFullScreen() && !wasFullScreen) p.setFullScreen(false)
  wasFullScreen = false
  if (was && !quiet) sendTo(p, { name: 'app:presentEnded', data: {} })
  return { ok: true }
}

ipcMain.handle('worklet:call', async (e, method, args) => {
  const sender = BrowserWindow.fromWebContents(e.sender) || win
  if (method === 'app:presentStart') return presentStart(args || {}, sender)
  if (method === 'app:presentEnd') return presentEnd()
  if (method === 'app:presentGo') { sendTo(audience, { name: 'app:presentGo', data: { slideId: String((args && args.slideId) || ''), blank: (args && args.blank) || null } }); return { ok: true } }
  if (method === 'app:presentInput') { sendTo(presenter || win, { name: 'app:presentInput', data: { key: String((args && args.key) || '') } }); return { ok: true } }
  // Is a show on, and in which window (the smoke test asks).
  if (method === 'app:presentState') return { presenting, audience: !!(audience && !audience.isDestroyed()), fullScreen: !!((presenter || win) && !(presenter || win).isDestroyed() && (presenter || win).isFullScreen()) }
  // Files in their own windows (proposals/2026-10-26-file-windows.md).
  if (method === 'app:openWindow') { const w = fileWindows.openWindow(String((args && args.sheetId) || '')); return { ok: !!w } }
  if (method === 'app:windows') return { ids: fileWindows.ids() }
  // Does this file have a window? Then bring it forward.
  if (method === 'app:windowFor') { const id = String((args && args.sheetId) || ''); const has = fileWindows.ids().includes(id); if (has) fileWindows.openWindow(id); return { open: has } }
  // From a file window: open a file or folder in the main window.
  if (method === 'app:openInMain') {
    if (!win || win.isDestroyed()) return { ok: false }
    const id = String((args && (args.sheetId || args.folderId)) || '')
    if (args && args.sheetId && fileWindows.ids().includes(id)) { fileWindows.openWindow(id); return { ok: true } }
    sendTo(win, { name: args && args.sheetId ? 'app:openFile' : 'app:openFolder', data: { id } })
    showWindow()
    return { ok: true }
  }
  if (method === 'app:windowMoved') { fileWindows.moved(String((args && args.from) || ''), String((args && args.to) || '')); return { ok: true } }
  // The smoke test's restart; offScreen puts the first window off every screen.
  if (SMOKE && method === 'app:smokeReopenWindows') {
    await fileWindows.reopen(args && args.offScreen ? (list) => list.map((x, i) => (i === 0 ? { ...x, bounds: { ...x.bounds, x: -20000, y: -20000 } } : x)) : undefined)
    return { ids: fileWindows.ids() }
  }
  if (method === 'app:windowGone') { const id = fileWindows.idOf(sender); if (id) fileWindows.gone(id); return { ok: true } }
  // The UI asks for a link that arrived before it was listening.
  if (method === 'app:takeLink') { const url = pendingLink; pendingLink = null; return { url } }
  // The cell menu's Cut, Copy and Paste.
  // This Electron's clipboard calls return promises.
  if (method === 'app:setClipboard') { await clipboard.writeText(String((args && args.text) || '')); return { ok: true } }
  if (method === 'app:getClipboard') return { text: String((await clipboard.readText()) || '') }
  if (method === 'app:clipboardPicture') return clipboardPicture()
  // A tab as PDF or on paper: the UI sends a printable page. A4 unless it
  // sends pageSize ({ width, height } in inches, no margins: a deck's slides).
  if (method === 'app:savePdf' || method === 'app:print') {
    const page = new BrowserWindow({ show: false, webPreferences: { javascript: false } })
    const ps = args && args.pageSize
    const size = ps && [ps.width, ps.height].every((n) => Number.isFinite(n) && n >= 1 && n <= 100) ? { width: ps.width, height: ps.height } : null
    try {
      await page.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(String((args && args.html) || '')))
      if (method === 'app:print') {
        // The smoke test cannot answer a print dialog: it keeps the page.
        if (SMOKE) { fs.writeFileSync(path.join(dataDir, 'printed.html'), String(args.html)); return { ok: true } }
        const opts = size ? { pageSize: { width: Math.round(size.width * 25400), height: Math.round(size.height * 25400) }, margins: { marginType: 'none' } } : {}
        await new Promise((resolve) => page.webContents.print({ printBackground: true, ...opts }, () => resolve()))
        return { ok: true }
      }
      const pdf = await page.webContents.printToPDF(size
        ? { printBackground: true, pageSize: size, margins: { top: 0, bottom: 0, left: 0, right: 0 } }
        : { printBackground: true, pageSize: 'A4' })
      const name = String((args && args.name) || 'PearOffice.pdf').replace(/[\\/:*?"<>|]/g, ' ')
      // The smoke test saves without asking.
      const file = SMOKE
        ? path.join(dataDir, name)
        : (await dialog.showSaveDialog(sender, { defaultPath: path.join(app.getPath('documents'), name), filters: [{ name: 'PDF', extensions: ['pdf'] }] })).filePath
      if (!file) return { ok: false }
      fs.writeFileSync(file, pdf)
      return { ok: true, file }
    } finally {
      page.destroy()
    }
  }
  // About: web and email links open outside the app.
  if (method === 'app:openUrl') {
    const url = String((args && args.url) || '')
    // The smoke test notes what would open instead of starting a browser.
    if (SMOKE) {
      fs.appendFileSync(path.join(dataDir, 'opened.txt'), url + '\n')
      // A smoke run can ask for the "PearCal isn't installed" answer.
      if (urlKind(url) === 'pearcal' && process.env.PEAROFFICE_SMOKE_NO_PEARCAL === '1') return { ok: false, notInstalled: true }
      return { ok: true }
    }
    // macOS and Windows say which app handles a scheme; Linux's xdg-open
    // fails instead when nothing does.
    const hasApp = (u) => process.platform === 'linux' || !!app.getApplicationNameForProtocol(u)
    return openUrl(url, { open: (u) => shell.openExternal(u), hasApp })
  }
  // After a device link or a phrase restore the identity changed: start a
  // fresh worklet and reload the UI.
  if (method === 'app:update') return updates ? updates.state() : { update: null, apply: { status: 'idle' } }
  if (method === 'app:updateApply') {
    if (!updates) throw new Error('Updates are off in this copy')
    return updates.apply()
  }
  // The smoke parts other than onboarding start with the tour already done.
  if (method === 'app:onboarding' && SMOKE && process.env.PEAROFFICE_NO_ONBOARDING === '1') return { done: true }
  if (method === 'app:settings') return { ...settings, startAtLogin: settings.startAtLogin && loginItem.isEnabled() }
  if (method === 'app:setSetting') {
    const patch = {}
    for (const k of Object.keys(DEFAULTS)) if (args && typeof args[k] === 'boolean') patch[k] = args[k]
    writeSettings(patch)
    return settings
  }
  if (method === 'app:seederHost') {
    if (!seeder || !seeder.running) return { running: false }
    return { running: true, ...(await seeder.call('status')) }
  }
  if (method === 'app:seederHostPair') {
    if (!seeder || !seeder.running) throw new Error('The seeder on this computer is not running')
    return seeder.call('pair')
  }
  if (method === 'app:seederHostDevices') {
    if (!seeder || !seeder.running) throw new Error('The seeder on this computer is not running')
    return seeder.call('devices')
  }
  if (method === 'app:seederHostForget') {
    if (!seeder || !seeder.running) throw new Error('The seeder on this computer is not running')
    return seeder.call('forget', { deviceKey: String((args && args.deviceKey) || '') })
  }
  // About > Open-source software: this app's licence and the bundled ones.
  if (method === 'app:licenses') {
    const read = (f) => fs.promises.readFile(f, 'utf8').then((s) => s.trim(), () => '')
    const [own, others] = await Promise.all([read(paths.licence), read(paths.notices)])
    return { text: [own, others].filter(Boolean).join('\n\n') || null }
  }
  if (method === 'app:restart') {
    await worklet.stop()
    await startWorklet()
    fileWindows.closeAll() // another identity: other files
    if (win && !win.isDestroyed()) win.webContents.reload()
    return { ok: true }
  }
  if (typeof method !== 'string' || !/^(sheet|file|doc|slides|media|app|seeder|link|donation):[A-Za-z]+$/.test(method)) throw new Error('bad method')
  await worklet.ready()
  return worklet.call(method, args || {}, { timeoutMs: CALL_TIMEOUTS[method] || 15000 })
})

// Calls that wait on another device or do heavy work get longer than the
// default 15 s: linking waits up to 2 minutes for the other device, pairing with a
// seeder up to its 5 minute window (src/seeder/protocol.js).
const CALL_TIMEOUTS = {
  'link:join': 135000,
  'seeder:pair': 330000,
  'file:compact': 180000,
  'sheet:compact': 180000,
  'sheet:import': 120000,
  'doc:import': 120000,
  'slides:import': 120000
}

// A picture on the system clipboard, for pasting into a document or slide
// when the page itself gets none: a picture copied in a browser or photo
// viewer often reaches the page only as HTML with a link, and a picture file
// copied in a file manager only as its path. { data (base64), mime, name }
// or null. At most 20 MB.
const PICTURE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' }
const CLIPBOARD_PICTURE_MAX = 20 * 1024 * 1024
async function clipboardPicture () {
  // This Electron's clipboard is the asynchronous one: items, each with
  // MIME types and their data as Blobs.
  let items = []
  try { items = await clipboard.read() } catch { return null }
  for (const item of items) {
    const type = item.types.find((t) => Object.values(PICTURE_TYPES).includes(t))
    if (!type) continue
    try {
      const buf = Buffer.from(await (await item.getType(type)).arrayBuffer())
      if (buf.length && buf.length <= CLIPBOARD_PICTURE_MAX) return { data: buf.toString('base64'), mime: type, name: 'Pasted picture.' + (type.split('/')[1] === 'jpeg' ? 'jpg' : type.split('/')[1]) }
    } catch {}
  }
  for (const item of items) {
    if (!item.types.includes('text/uri-list')) continue
    let uris = ''
    try { uris = await (await item.getType('text/uri-list')).text() } catch { continue }
    for (const line of uris.split(/\r?\n/)) {
      if (!line.startsWith('file://')) continue
      let file
      try { file = require('node:url').fileURLToPath(line.trim()) } catch { continue }
      const mime = PICTURE_TYPES[(path.extname(file).slice(1) || '').toLowerCase()]
      if (!mime) continue
      try {
        const st = await fs.promises.stat(file)
        if (!st.isFile() || st.size > CLIPBOARD_PICTURE_MAX) continue
        return { data: (await fs.promises.readFile(file)).toString('base64'), mime, name: path.basename(file) }
      } catch {}
    }
  }
  return null
}

// The right-click menu for text: spelling suggestions, cut, copy, paste and
// select all. Pages that show their own menu (the sheet grid, slides) stop
// the browser's, so this never appears over theirs.
function editMenu (contents, params) {
  const items = []
  for (const word of (params.dictionarySuggestions || []).slice(0, 5)) items.push({ label: word, click: () => contents.replaceMisspelling(word) })
  if (params.misspelledWord) items.push({ label: 'Add to dictionary', click: () => contents.session.addWordToSpellCheckerDictionary(params.misspelledWord) })
  if (items.length) items.push({ type: 'separator' })
  const f = params.editFlags || {}
  if (params.isEditable) {
    items.push({ label: 'Cut', role: 'cut', enabled: !!f.canCut })
    items.push({ label: 'Copy', role: 'copy', enabled: !!f.canCopy })
    items.push({ label: 'Paste', role: 'paste', enabled: !!f.canPaste })
    items.push({ type: 'separator' })
    items.push({ label: 'Select all', role: 'selectAll' })
  } else if (params.selectionText && params.selectionText.trim()) {
    items.push({ label: 'Copy', role: 'copy' })
  }
  while (items.length && items[items.length - 1].type === 'separator') items.pop()
  if (!items.length) return null
  return Menu.buildFromTemplate(items)
}

// What every window of the UI gets: no menu bar, links in the system
// browser, no navigation, the text menu.
function guard (w) {
  w.removeMenu()
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  w.webContents.on('will-navigate', (e) => e.preventDefault())
  // A show ends with the window it was started from.
  w.on('closed', () => { if (presenting && presenter === w) presentEnd() })
  w.webContents.on('context-menu', (e, params) => {
    const menu = editMenu(w.webContents, params)
    if (menu) menu.popup({ window: w })
  })
}

function createWindow () {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 640,
    minHeight: 400,
    title: 'PearOffice',
    icon: process.platform === 'linux' ? ICON : undefined,
    // Started at login with the tray on: stay hidden until opened.
    show: !SMOKE && !(stayRunning() && loginItem.launchedAtLogin()),
    backgroundColor: '#f7f7f4',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      offscreen: SMOKE
    }
  })
  guard(win)
  win.on('close', (e) => {
    if (presenting && presenter === win) presentEnd()
    if (!quitting && stayRunning()) {
      e.preventDefault()
      win.hide()
    }
  })
  // Closing the main window closes PearOffice, file windows too (they open
  // again next time).
  win.on('closed', () => { if (!quitting) app.quit() })
  // The file windows open again once the main window shows.
  if (win.isVisible() || SMOKE) win.webContents.once('did-finish-load', () => fileWindows.restore())
  else win.once('show', () => fileWindows.restore())
  win.loadFile(paths.ui)
  return win
}

app.whenReady().then(async () => {
  // An invite link in argv is a secret: log only that there is one.
  log('data', dataDir, 'argv', process.argv.slice(1).map((a) => String(a).startsWith('pearoffice://') ? 'pearoffice://...' : a).join(' '), 'stayRunning', stayRunning())
  // The UI needs no camera, microphone, location, notifications or the like.
  // Only writing to the clipboard (the Copy buttons) is allowed.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, done) => done(permission === 'clipboard-sanitized-write'))
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'clipboard-sanitized-write')
  const ready = startWorklet().catch((err) => {
    log('worklet failed to start:', err.message)
    throw err
  })
  syncLoginItem()
  createWindow()
  if (stayRunning()) createTray()
  if (!SMOKE) log(win.isVisible() ? 'window shown' : 'started hidden in the tray')
  if (settings.runSeeder) startSeeder().catch((err) => log('seeder failed to start:', err.message))
  // Tell the windows too: the update bar otherwise asks only every 10 minutes.
  updates = startUpdates({ app, log, onChange: () => { setTrayMenu(); sendAll({ name: 'app:updateChanged', data: {} }) } })
  if (SMOKE) {
    // Downloads (Export) go straight to the smoke test's data folder.
    win.webContents.session.on('will-download', (_e, item) => {
      const target = path.join(dataDir, 'downloads', item.getFilename())
      require('node:fs').mkdirSync(path.dirname(target), { recursive: true })
      item.setSavePath(target)
    })
    require('./smoke-run').run({ app, win, ready, log, dataDir, getTray: () => tray })
  }
})

app.on('second-instance', (_e, argv) => {
  if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus() }
  sendLink(linkIn(argv))
})

app.on('open-url', (e, url) => { e.preventDefault(); sendLink(url) }) // macOS

app.on('window-all-closed', () => app.quit())

app.on('activate', showWindow) // macOS: clicking the dock icon

app.on('before-quit', async (e) => {
  if (quitting || !worklet) return
  e.preventDefault()
  quitting = true
  await Promise.all([worklet.stop(), stopSeeder()])
  app.quit()
})
