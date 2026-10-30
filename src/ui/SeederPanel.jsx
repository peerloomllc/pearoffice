import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowSquareOut, CaretLeft, CircleNotch, QrCode as QrIcon, X } from '@phosphor-icons/react'
import { call } from './bridge.js'
import { scanQr } from './scanQr.js'
import { toSvg } from '../shared/qr.js'
import { isMobile } from './sheet/xlsx.js'
import { openUrl } from './About.jsx'

// "Run a seeder on this computer" (desktop): a separate blind process the
// desktop app starts and stops. Shows its pairing QR and what it holds.
function LocalSeeder ({ onPaired, onError }) {
  const [settings, setSettings] = useState(null)
  const [host, setHost] = useState(null)
  const [pairing, setPairing] = useState(null)
  const [busy, setBusy] = useState(false)

  async function refresh () {
    try {
      setSettings(await call('app:settings'))
      setHost(await call('app:seederHost'))
    } catch (err) { onError(err.message) }
  }
  useEffect(() => { refresh(); const t = setInterval(refresh, 3000); return () => clearInterval(t) }, [])

  if (!settings) return null
  return (
    <>
      <label className='setting-switch'>
        <span>Run this computer as a seeder?</span>
        <input
          type='checkbox'
          checked={settings.runSeeder}
          onChange={async (e) => { setPairing(null); await call('app:setSetting', { runSeeder: e.target.checked }); refresh() }}
        />
      </label>
      {settings.runSeeder && host && !host.running && <p className='muted'>Starting the seeder...</p>}
      {host && host.running && (
        <>
          <p className='muted small'>Holding {host.sheets} file{host.sheets === 1 ? '' : 's'} for {host.pairedDevices} paired device{host.pairedDevices === 1 ? '' : 's'}. It runs in the background while PearOffice is open or in the tray.</p>
          <div className='row'>
            <button type='button' onClick={async () => { try { setPairing(await call('app:seederHostPair')) } catch (err) { onError(err.message) } }}><QrIcon size={16} /> Show pairing code</button>
            <button
              type='button'
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  const p = await call('app:seederHostPair')
                  await call('seeder:pair', { link: p.link })
                  onPaired()
                  refresh()
                } catch (err) { onError(err.message) }
                setBusy(false)
              }}
            >
              {busy ? 'Pairing...' : 'Pair this device with it'}
            </button>
          </div>
          <HostDevices onError={onError} />
          {pairing && (
            <div className='pairing'>
              <div className='qr' dangerouslySetInnerHTML={{ __html: toSvg(pairing.link, 200) }} />
              <p className='muted small'>Scan on a phone, or paste this link in another device's Seeder panel. Works for 5 minutes.</p>
              <input readOnly value={pairing.link} onFocus={(e) => e.target.select()} aria-label='Seeder pairing link' />
            </div>
          )}
        </>
      )}
    </>
  )
}

// Devices paired with the seeder on this computer, each with Forget.
function HostDevices ({ onError }) {
  const [devices, setDevices] = useState(null)
  const [confirming, setConfirming] = useState(null)
  async function load () {
    try { setDevices(await call('app:seederHostDevices')) } catch (err) { onError(err.message) }
  }
  useEffect(() => { load() }, [])
  if (!devices || !devices.length) return null
  return (
    <ul className='people host-devices'>
      {devices.map((d) => (
        <li key={d.deviceKey}>
          <span className='who'><span className='mono'>{d.deviceKey.slice(0, 12)}...</span> <span className='muted'>{d.sheets} file{d.sheets === 1 ? '' : 's'}</span></span>
          {confirming === d.deviceKey
            ? (
              <span className='confirm'>
                <button
                  type='button'
                  className='danger'
                  onClick={async () => {
                    try { await call('app:seederHostForget', { deviceKey: d.deviceKey }) } catch (err) { onError(err.message) }
                    setConfirming(null)
                    load()
                  }}
                >
                  Forget
                </button>
                <button type='button' onClick={() => setConfirming(null)}>Keep</button>
              </span>
              )
            : <button type='button' className='link-button' onClick={() => setConfirming(d.deviceKey)}>Forget</button>}
        </li>
      ))}
      {confirming && <li className='muted small'>The seeder stops accepting that device. Files no other paired device backs up are deleted from it after 7 days.</li>}
    </ul>
  )
}

// The seeder panel's modal: a question with two buttons, a spinner while
// something runs, or a result with one button. On document.body, above the
// panel.
function SeederModal ({ title, text, busy = false, confirmLabel, danger = false, onConfirm, onClose, closeLabel = 'Cancel' }) {
  return createPortal(
    <div className='seeder-modal-backdrop'>
      <div className='seeder-modal' role='alertdialog' aria-label={title}>
        {busy && <CircleNotch className='join-spinner' size={32} aria-hidden='true' />}
        <h3>{title}</h3>
        {text && <p className='muted'>{text}</p>}
        {!busy && (onConfirm || onClose) && (
          <div className='actions'>
            {onConfirm && <button type='button' className={danger ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</button>}
            {onClose && <button type='button' onClick={onClose}>{closeLabel}</button>}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}

const PREFIXES = ['pearoffice://seeder?', 'peerloom://seeder?']
const names = (list) => list.map((x) => x.title || 'Untitled file').join(', ')
const files = (n) => n + ' file' + (n === 1 ? '' : 's')

export function SeederPanel ({ initialLink = '', onBack = null, onClose, onError }) {
  const desktop = !isMobile()
  const [link, setLink] = useState(initialLink)
  const [pasting, setPasting] = useState(desktop || !!initialLink)
  const [busy, setBusy] = useState(false)
  const [seeders, setSeeders] = useState(null)
  const [msg, setMsg] = useState(null)
  const [modal, setModal] = useState(null) // SeederModal's props, or null
  const close = () => setModal(null)

  async function load () {
    try { setSeeders(await call('seeder:list')) } catch (err) { onError(err.message) }
  }
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t) }, [])

  async function pair (text) {
    const clean = String(text || '').trim()
    if (!clean) return
    setBusy(true)
    setMsg(null)
    setModal({ busy: true, title: 'Pairing...', text: 'This can take up to a minute.' })
    try {
      await call('seeder:pair', { link: clean })
      setLink('')
      if (!desktop) setPasting(false)
      close()
      setMsg('Paired. Your files are backing up to it.')
    } catch (err) {
      setModal({ title: 'Could not pair', text: err.message, onClose: close, closeLabel: 'OK' })
    }
    setBusy(false)
    load()
  }

  async function scan () {
    try {
      const text = await scanQr()
      if (!text) return
      if (!PREFIXES.some((p) => String(text).startsWith(p))) return setModal({ title: 'Could not pair', text: 'That QR code is not a seeder code.', onClose: close, closeLabel: 'OK' })
      pair(String(text))
    } catch (err) { onError(err.message) }
  }

  async function stop (seederKey) {
    setModal({ busy: true, title: 'Stopping...' })
    try {
      const r = await call('seeder:stopUsing', { seederKey })
      await load()
      const kept = r.kept || []
      if (kept.length) {
        const list = kept.map((x) => (x.title || 'Untitled file') + (x.addedByName ? ' (added by ' + x.addedByName + ')' : '')).join(', ')
        setModal({ title: 'Stopped on this device', text: (kept.length === 1 ? 'This file still backs up to it: ' : 'These files still back up to it: ') + list + '. Only the file\'s owner or whoever added it there can stop that.', onClose: close, closeLabel: 'OK' })
      } else {
        close()
        setMsg('Stopped using this seeder.')
      }
    } catch (err) {
      await load()
      setModal({ title: 'Could not stop', text: err.message, onClose: close, closeLabel: 'OK' })
    }
  }

  async function askStop (seederKey) {
    let preview = null
    try { preview = await call('seeder:stopPreview', { seederKey }) } catch {}
    const parts = []
    if (preview && preview.stop.length) parts.push('Stops backing up ' + names(preview.stop) + '.')
    if (preview && preview.keep.length) parts.push('Others still back up ' + names(preview.keep) + ' there.')
    setModal({
      title: 'Stop using this seeder?',
      text: parts.join(' ') || 'No files back up to it.',
      confirmLabel: 'Stop using',
      danger: true,
      onConfirm: () => stop(seederKey),
      onClose: close
    })
  }

  return (
    <div className='panel-backdrop' onMouseDown={(e) => { if (e.target === e.currentTarget && !modal) onClose() }}>
      <form className='panel seeder-panel' role='dialog' aria-label='Seeder' onSubmit={(e) => { e.preventDefault(); pair(link) }}>
        <header>
          {onBack && <button type='button' className='link-button back' onClick={onBack}><CaretLeft size={14} /> Settings</button>}
          <h2>Seeder</h2>
          <button type='button' className='close' aria-label='Close' onClick={onClose}><X size={18} /></button>
        </header>
        <p className='muted'>
          A seeder is an always-on computer that keeps your files in sync while phones sleep.
          It stores them scrambled and cannot read them.
        </p>
        {!desktop && <button type='button' className='primary' disabled={busy} onClick={scan}><QrIcon size={16} /> Scan seeder QR</button>}
        {pasting && (
          <div className='row'>
            <input
              aria-label='Seeder pairing link'
              placeholder='Paste the seeder link'
              value={link}
              autoCapitalize='none'
              autoCorrect='off'
              spellCheck={false}
              onChange={(e) => setLink(e.target.value)}
            />
            <button className='primary' type='submit' disabled={busy || !link.trim()}>Pair</button>
          </div>
        )}
        <div className='row seeder-links'>
          {!desktop && <button type='button' className='link-button' onClick={() => setPasting((v) => !v)}>{pasting ? 'Cancel' : 'Paste a link instead'}</button>}
          <button type='button' className='link-button' onClick={() => openUrl('https://peerloomllc.com/seeder')}>Get PeerLoom Seeder <ArrowSquareOut size={13} /></button>
        </div>
        {msg && <p className='muted small'>{msg}</p>}
        {desktop && window.pearoffice && window.pearoffice.platform === 'desktop' && <LocalSeeder onPaired={() => { setMsg('Paired. Your files are backing up to it.'); load() }} onError={onError} />}
        {seeders && seeders.length > 0 && (
          <ul className='people'>
            {seeders.map((s) => (
              <li key={s.seederKey} className='seeder-row'>
                <span className='who'><span className='mono'>{s.seederKey.slice(0, 16)}...</span> <span className='muted small'>{files(s.sheets || 0)}</span></span>
                <button type='button' className='danger' onClick={() => askStop(s.seederKey)}>Stop using</button>
              </li>
            ))}
          </ul>
        )}
        {modal && <SeederModal {...modal} />}
      </form>
    </div>
  )
}
