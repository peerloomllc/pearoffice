import React from 'react'
import { QrCode as QrIcon } from '@phosphor-icons/react'
import { scanQr } from './scanQr.js'
import { toSvg } from '../shared/qr.js'
import { isMobile } from './sheet/xlsx.js'

// A link as a QR code, for another device's camera.
export function QrCode ({ value, size = 220, label = 'QR code' }) {
  return <div className='qr' role='img' aria-label={label} dangerouslySetInnerHTML={{ __html: toSvg(value, size) }} />
}

// "Scan QR code" on phones: opens the camera (scanQr.js) and hands back a
// link that starts with `prefix` (or one of a list). Renders nothing elsewhere.
export function ScanButton ({ prefix, what, onLink, onError }) {
  if (!isMobile()) return null
  return (
    <button
      type='button'
      className='scan-button'
      onClick={async () => {
        try {
          const text = await scanQr()
          if (!text) return
          if (![].concat(prefix).some((p) => String(text).startsWith(p))) return onError('That QR code is not ' + what + '.')
          onLink(String(text))
        } catch (err) { onError(err.message) }
      }}
    >
      <QrIcon size={16} /> Scan QR code
    </button>
  )
}
