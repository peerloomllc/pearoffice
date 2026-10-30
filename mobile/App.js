// PearOffice mobile shell. Starts the Bare worklet (the same engine as the
// desktop), loads the same web UI into a WebView and relays calls and events
// between them. The UI talks to window.pearoffice, set up by
// src/ui/mobile-entry.js on top of the WebView bridge.

import React, { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, AppState, BackHandler, Keyboard, Linking, NativeModules, PermissionsAndroid, Platform, Share, StatusBar, StyleSheet, Text, View, useColorScheme } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { WebView } from 'react-native-webview'
import { Worklet } from 'react-native-bare-kit'
import { Asset } from 'expo-asset'
import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import * as Print from 'expo-print'
import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import b4a from 'b4a'
import { requestLocalNetworkPermission } from '../modules/local-network'
import { isPearcalLink } from '../src/shared/pearcal'

const ALLOWED = /^(sheet|file|doc|slides|media|app|seeder|link|donation):[A-Za-z]+$/
// The UI's own page. The WebView must never show anything else: any page it
// shows can talk to the worklet (the recovery phrase included), so a link
// tapped in a document opens in the browser instead (onShouldStartLoad).
const PAGE_URL = 'https://localhost/'
// Android reports a message's sender as an origin, with no trailing slash.
const isOwnPage = (url) => url === 'about:blank' || /^https:\/\/localhost(\/|$)/.test(String(url))
// The same rules as the desktop page (src/ui/index.html), except that the
// bundle is inline here.
const CSP = "default-src 'self'; script-src 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' data: blob:"
// iOS file types for the share sheet, by MIME type.
const UTIS = {
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'org.openxmlformats.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'org.openxmlformats.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'org.openxmlformats.presentationml.presentation',
  'text/markdown': 'net.daringfireball.markdown',
  'text/plain': 'public.plain-text',
  'text/html': 'public.html',
  'image/jpeg': 'public.jpeg',
  'text/csv': 'public.comma-separated-values-text',
  'application/json': 'public.json',
  'image/png': 'public.png',
  'image/svg+xml': 'public.svg-image',
  'application/pdf': 'com.adobe.pdf'
}

// Phone features the web UI cannot reach on its own, answered by the shell.
async function shellMethod (method, args) {
  if (method === 'app:shareFile') {
    // Export: write the file to the cache and open the share sheet (save to
    // Files or Drive, send it, ...). A WebView cannot download a blob itself.
    const safe = String(args.name || 'PearOffice.xlsx').replace(/[\\/:*?"<>|]/g, ' ')
    const uri = FileSystem.cacheDirectory + safe
    await FileSystem.writeAsStringAsync(uri, args.base64, { encoding: FileSystem.EncodingType.Base64 })
    await Sharing.shareAsync(uri, { mimeType: args.mime, dialogTitle: safe, UTI: UTIS[args.mime] || 'public.data' })
    return { ok: true }
  }
  if (method === 'app:savePdf') {
    // The UI sends a printable page, as on desktop. A4 (or pageSize, in
    // inches, with no margins: a deck's slides), then the share sheet.
    const safe = String(args.name || 'PearOffice.pdf').replace(/[\\/:*?"<>|]/g, ' ')
    const ps = args.pageSize
    const size = ps && [ps.width, ps.height].every((n) => Number.isFinite(n) && n >= 1 && n <= 100)
      ? { width: Math.round(ps.width * 72), height: Math.round(ps.height * 72), margins: { left: 0, top: 0, right: 0, bottom: 0 } }
      : { width: 595, height: 842 }
    const { uri: tmp } = await Print.printToFileAsync({ html: String(args.html || ''), ...size })
    const uri = FileSystem.cacheDirectory + safe
    await FileSystem.deleteAsync(uri, { idempotent: true })
    await FileSystem.moveAsync({ from: tmp, to: uri })
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: safe, UTI: UTIS['application/pdf'] })
    return { ok: true }
  }
  if (method === 'app:pickFile' && args && args.images && args.source === 'photos') {
    // A photo from the library: the system photo picker, which needs no
    // permission. 'compatible' has iOS hand over JPEG in place of HEIC.
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      base64: true,
      exif: false,
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible
    })
    if (res.canceled || !res.assets || !res.assets[0]) return { canceled: true }
    const photo = res.assets[0]
    const base64 = photo.base64 || await FileSystem.readAsStringAsync(photo.uri, { encoding: FileSystem.EncodingType.Base64 })
    return { name: photo.fileName || String(photo.uri).split('/').pop(), mime: photo.mimeType || null, base64 }
  }
  if (method === 'app:pickFile') {
    // A picture file for a document (args.images) or a file to import.
    const res = await DocumentPicker.getDocumentAsync({
      type: args && args.images ? ['image/*'] : ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.oasis.opendocument.spreadsheet', 'text/csv', 'text/comma-separated-values', 'text/tab-separated-values', 'application/json', 'text/json', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.oasis.opendocument.text', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/vnd.oasis.opendocument.presentation', 'text/markdown', 'text/x-markdown', 'text/plain', 'text/html', 'application/pdf', 'image/*', 'application/octet-stream'],
      copyToCacheDirectory: true
    })
    if (res.canceled || !res.assets || !res.assets[0]) return { canceled: true }
    const file = res.assets[0]
    const base64 = await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.Base64 })
    return { name: file.name, mime: file.mimeType || null, base64 }
  }
  // The licences of everything in the app (scripts/build-ui.mjs --mobile).
  if (method === 'app:licenses') {
    const asset = Asset.fromModule(require('../assets/third-party-notices.txt'))
    await asset.downloadAsync()
    return { text: await FileSystem.readAsStringAsync(asset.localUri, { encoding: FileSystem.EncodingType.UTF8 }) }
  }
  if (method === 'app:openUrl') {
    const url = String(args.url || '')
    if (/^(https?:|mailto:|lightning:)/.test(url)) await Linking.openURL(url)
    // A PearCal event or day (proposals/2026-10-26-pearcal-pearoffice-links.md
    // in the suite folder). openURL rejects when no app takes it: Android has
    // no activity for the scheme, iOS's open reports false.
    else if (isPearcalLink(url)) {
      try { await Linking.openURL(url) } catch { return { ok: false, notInstalled: true } }
    }
    return { ok: true }
  }
  // Is a Lightning wallet installed (the donation sheet offers it)?
  if (method === 'app:canOpenUrl') {
    const url = String(args.url || '')
    return { can: /^lightning:/.test(url) ? await Linking.canOpenURL(url).catch(() => false) : false }
  }
  if (method === 'app:share') {
    await Share.share({ message: String(args.text || '') }).catch(() => {})
    return { ok: true }
  }
  if (method === 'app:setClipboard') { await Clipboard.setStringAsync(String(args.text || '')); return { ok: true } }
  if (method === 'app:getClipboard') return { text: await Clipboard.getStringAsync() }
  if (method === 'app:haptic') {
    const k = args.kind
    try {
      if (k === 'success') await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      else if (k === 'warn') await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
      else if (k === 'select') await Haptics.selectionAsync()
      else await Haptics.impactAsync(k === 'medium' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light)
    } catch {}
    return { ok: true }
  }
  return null
}

// The most recent pearoffice:// link, kept until the UI asks for it
// (app:takeLink), so a link that arrives before the UI is listening is not lost.
let pendingLink = null

let worklet = null
let started = null
const pending = new Map()
const listeners = new Set()
let nextId = 1

function startWorklet () {
  if (started) return started
  started = (async () => {
    // iOS links its addons per framework, so it has its own bundle (covers
    // devices and the Simulator).
    const asset = Asset.fromModule(Platform.OS === 'ios' ? require('../assets/bare-ios.bundle') : require('../assets/bare-universal.bundle'))
    await asset.downloadAsync()
    const bundle = await FileSystem.readAsStringAsync(asset.localUri, { encoding: FileSystem.EncodingType.Base64 })
    worklet = new Worklet()
    await worklet.start('/app.bundle', b4a.from(bundle, 'base64'))
    let buf = ''
    worklet.IPC.on('data', (chunk) => {
      buf += b4a.toString(chunk)
      let nl
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        if (!line) continue
        let msg
        try { msg = JSON.parse(line) } catch { continue }
        if (msg.id != null && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) } else if (msg.event) for (const fn of listeners) fn(msg.event, msg.data)
      }
    })
    const dataDir = FileSystem.documentDirectory.replace(/^file:\/\//, '').replace(/\/$/, '')
    const init = await callWorklet('init', { dataDir })
    if (init.error) throw new Error(init.error)
  })()
  return started
}

// After a device link or a phrase restore the identity changed: throw the
// worklet away and start a fresh one.
async function restartWorklet () {
  try { if (worklet) worklet.terminate() } catch {}
  worklet = null
  started = null
  for (const resolve of pending.values()) resolve({ error: 'restarting' })
  pending.clear()
  await startWorklet()
}

function callWorklet (method, args) {
  return new Promise((resolve) => {
    const id = nextId++
    pending.set(id, resolve)
    worklet.IPC.write(b4a.from(JSON.stringify({ id, method, args }) + '\n'))
  })
}

async function loadHtml (dark) {
  const asset = Asset.fromModule(require('../assets/app-ui.bundle'))
  await asset.downloadAsync()
  const js = await FileSystem.readAsStringAsync(asset.localUri, { encoding: FileSystem.EncodingType.UTF8 })
  const bg = dark ? '#171a17' : '#f7f7f4'
  return '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' + CSP + '"><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover">' +
    '<style>html,body,#root{height:100%;margin:0;background:' + bg + '}</style></head>' +
    '<body><div id="root"></div><script>' + js + '</script></body></html>'
}

export default function App () {
  const dark = useColorScheme() === 'dark'
  const [html, setHtml] = useState(null)
  // Bumped to load the page again. A WebView reload() would fetch the base
  // URL, https://localhost/, which iOS cannot reach (NSURLErrorDomain -1004,
  // a white error page after a restore); a new WebView loads the html.
  const [page, setPage] = useState(0)
  const reloadPage = () => { loaded.current = false; setPage((n) => n + 1) }
  const [error, setError] = useState(null)
  const web = useRef(null)
  const loaded = useRef(false)
  const queued = useRef([])
  // A slide show is on (src/ui/slides/Present.jsx): no status bar, the page
  // edge to edge and Back ends the show.
  const [presenting, setPresenting] = useState(false)

  const inject = (code) => {
    if (loaded.current && web.current) web.current.injectJavaScript(code + ';true;')
    else queued.current.push(code)
  }

  // Android draws the app edge to edge, so the keyboard covers the WebView
  // instead of shrinking it. Tell the page how much of it is covered (--kb),
  // and bottom sheets move up by that much (src/ui/app.css).
  useEffect(() => {
    if (Platform.OS !== 'android') return
    const setKb = (px) => inject("document.documentElement.style.setProperty('--kb', '" + Math.max(0, Math.round(px)) + "px')")
    // The keyboard and the WebView both end just above the navigation bar,
    // so the keyboard's height is how much of the page it covers.
    const show = Keyboard.addListener('keyboardDidShow', (e) => setKb(e.endCoordinates.height))
    const hide = Keyboard.addListener('keyboardDidHide', () => setKb(0))
    return () => { show.remove(); hide.remove() }
  }, [])

  useEffect(() => {
    let alive = true
    // iOS: ask for Local Network access up front, so people on the same Wi-Fi
    // can connect directly (modules/local-network). No-op elsewhere.
    requestLocalNetworkPermission()
    Promise.all([startWorklet(), loadHtml(dark)])
      .then(([, h]) => { if (alive) setHtml(h) })
      .catch((err) => { if (alive) setError(String(err && err.message ? err.message : err)) })
    const onEvent = (name, data) => inject('window.__psEvent && window.__psEvent(' + JSON.stringify(name) + ',' + JSON.stringify(data ?? null) + ')')
    listeners.add(onEvent)
    // pearoffice:// links (invites, seeder pairing) go to the UI.
    const sendLink = (url) => {
      if (!url || !url.startsWith('pearoffice://')) return
      console.log('[pearoffice] link ' + url.slice(0, 40))
      pendingLink = url
      onEvent('app:deeplink', { url })
    }
    Linking.getInitialURL().then(sendLink).catch(() => {})
    const sub = Linking.addEventListener('url', ({ url }) => sendLink(url))
    return () => { alive = false; listeners.delete(onEvent); sub.remove() }
  }, [])

  // GrapheneOS: Vanadium's renderer, frozen while the app is in the
  // background, does not paint again after a resume (PearPetal, 2026-07-19).
  // After 20 s away, end it and let onRenderProcessGone load a fresh one
  // (plugins/with-android-webview-recovery.js; it does nothing on other
  // WebViews). Short trips to the share sheet or a picker stay under 20 s.
  useEffect(() => {
    if (Platform.OS !== 'android' || !NativeModules.WebViewRecovery) return
    let leftAt = 0
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') { if (!leftAt) leftAt = Date.now(); return }
      const away = leftAt ? Date.now() - leftAt : 0
      leftAt = 0
      if (away >= 20000) NativeModules.WebViewRecovery.terminateRenderer().catch(() => {})
    })
    return () => sub.remove()
  }, [])

  // Back goes to the UI, which closes what is on top or leaves the file,
  // and asks for app:exit on the file list (src/ui/App.jsx). The show's
  // handler below is added later, so it runs first while presenting.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!loaded.current) return false
      inject("window.__psEvent && window.__psEvent('app:back', null)")
      return true
    })
    return () => sub.remove()
  }, [])

  useEffect(() => {
    if (!presenting) return
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      inject("window.__psEvent && window.__psEvent('app:presentBack', null)")
      return true
    })
    return () => sub.remove()
  }, [presenting])

  // Only the UI's own page loads. A link opens in the browser (https and
  // mailto only); anything else is dropped.
  const onShouldStartLoad = (req) => {
    if (isOwnPage(req.url)) return true
    if (req.isTopFrame !== false && /^(https:|mailto:)/.test(req.url)) Linking.openURL(req.url).catch(() => {})
    return false
  }

  const onMessage = async (e) => {
    // A message from any other page is ignored (see onShouldStartLoad).
    if (!isOwnPage(e.nativeEvent.url)) return
    let msg
    try { msg = JSON.parse(e.nativeEvent.data) } catch { return }
    const { id, method, args } = msg
    const reply = (body) => inject('window.__psResponse(' + JSON.stringify({ id, ...body }) + ')')
    if (method === 'app:takeLink') { const url = pendingLink; pendingLink = null; return reply({ result: { url } }) }
    if (method === 'app:cameraPermission') {
      // The QR scanner runs in the page (src/ui/scanQr.js). Android's WebView
      // gives it no camera without the app's CAMERA permission; iOS asks by
      // itself when the page opens the camera.
      let granted = true
      if (Platform.OS === 'android') {
        const perm = PermissionsAndroid.PERMISSIONS.CAMERA
        granted = (await PermissionsAndroid.check(perm)) || (await PermissionsAndroid.request(perm)) === PermissionsAndroid.RESULTS.GRANTED
      }
      return reply({ result: { granted } })
    }
    if (method === 'app:presentStart') { setPresenting(true); return reply({ result: { mode: 'single' } }) }
    if (method === 'app:presentEnd') { setPresenting(false); return reply({ result: { ok: true } }) }
    if (method === 'app:exit') { BackHandler.exitApp(); return reply({ result: { ok: true } }) }
    if (method === 'app:restart') {
      try { await restartWorklet() } catch (err) { return reply({ error: String(err && err.message ? err.message : err) }) }
      reply({ result: { ok: true } })
      reloadPage()
      return
    }
    try {
      const own = await shellMethod(method, args || {})
      if (own) return reply({ result: own })
    } catch (err) {
      return reply({ error: String(err && err.message ? err.message : err) })
    }
    if (typeof method !== 'string' || !ALLOWED.test(method)) return reply({ error: 'bad method' })
    // Wait for init: a method called earlier finds no local database yet.
    await startWorklet().catch(() => {})
    const res = await callWorklet(method, args || {})
    reply(res.error ? { error: res.error } : { result: res.result ?? null })
  }

  const bg = dark ? '#171a17' : '#f7f7f4'
  if (error) {
    return (
      <View style={[styles.center, { backgroundColor: bg }]}>
        <Text style={{ color: dark ? '#e6e8e3' : '#1f2420', padding: 24 }}>PearOffice could not start: {error}</Text>
      </View>
    )
  }
  if (!html) {
    return (
      <View style={[styles.center, { backgroundColor: bg }]}>
        <ActivityIndicator color='#5b8c3a' />
      </View>
    )
  }
  return (
    <SafeAreaProvider>
      <StatusBar hidden={presenting} barStyle={dark ? 'light-content' : 'dark-content'} backgroundColor={bg} />
      <SafeAreaView style={{ flex: 1, backgroundColor: presenting ? '#000' : bg }} edges={presenting ? [] : ['top', 'bottom']}>
        <WebView
          key={page}
          ref={web}
          source={{ html, baseUrl: PAGE_URL }}
          originWhitelist={['*']}
          onShouldStartLoadWithRequest={onShouldStartLoad}
          setSupportMultipleWindows={false}
          injectedJavaScriptBeforeContentLoaded={'window.__pearPlatform = ' + JSON.stringify(Platform.OS) + ';window.__pearReloaded = ' + (page > 0) + ';true;'}
          onMessage={onMessage}
          onLoad={() => {
            loaded.current = true
            for (const code of queued.current.splice(0)) web.current.injectJavaScript(code + ';true;')
          }}
          onRenderProcessGone={reloadPage}
          onContentProcessDidTerminate={reloadPage}
          keyboardDisplayRequiresUserAction={false}
          // The QR scanner's camera (src/ui/scanQr.js, getUserMedia on the
          // https://localhost/ page).
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          mediaCapturePermissionGrantType='grant'
          style={{ flex: 1, backgroundColor: bg }}
        />
      </SafeAreaView>
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' }
})
