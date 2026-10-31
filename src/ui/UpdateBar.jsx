import React, { useEffect, useState } from 'react'
import { X } from '@phosphor-icons/react'
import { call, on } from './bridge.js'

// "PearOffice 0.2.0 is out" on desktop (proposals/2026-10-05-update-checker.md).
// The desktop shell checks for releases; this shows what it found and asks it
// to install. Closing the bar hides it until the next version.
const DISMISSED = 'pearoffice.update.dismissed'

function dismissedVersion () {
  try { return localStorage.getItem(DISMISSED) } catch { return null }
}

export function UpdateBar () {
  const [update, setUpdate] = useState(null)
  const [apply, setApply] = useState({ status: 'idle' })
  const [dismissed, setDismissed] = useState(dismissedVersion)

  useEffect(() => {
    let stop = false
    const load = async () => {
      try {
        const r = await call('app:update')
        if (!stop) { setUpdate(r.update); setApply(r.apply) }
      } catch {}
    }
    load()
    // Faster while an update is downloading, so its progress shows.
    const t = setInterval(load, apply.status === 'running' ? 2000 : 10 * 60 * 1000)
    // Main says when a check finds something, about a minute after launch.
    const off = on('app:updateChanged', load)
    return () => { stop = true; clearInterval(t); off() }
  }, [apply.status])

  if (!update || !update.available) return null
  const version = update.latest
  const busy = apply.status === 'running' || apply.status === 'restarting'
  if (dismissed === version && !busy) return null

  const open = (url) => url && call('app:openUrl', { url }).catch(() => {})
  const download = (
    <button className='link-button' onClick={() => open(apply.htmlUrl || update.htmlUrl)}>Download it</button>
  )
  let body
  if (apply.status === 'running') body = <>Downloading PearOffice {version}...</>
  else if (apply.status === 'restarting') body = <>Installing PearOffice {version}. It will restart by itself.</>
  else if (apply.status === 'needs-manual') body = <>PearOffice cannot update itself here. {download}</>
  else if (apply.status === 'error') body = <>The update did not work. {download}</>
  else {
    body = (
      <>
        PearOffice {version} is out.{' '}
        {update.htmlUrl && <button className='link-button' onClick={() => open(update.htmlUrl)}>See what changed</button>}
        <button className='link-button' onClick={async () => { try { setApply(await call('app:updateApply')) } catch {} }}>Update now</button>
      </>
    )
  }
  return (
    <div className='banner info update-bar' role='status'>
      <span>{body}</span>
      {!busy && (
        <button
          className='icon-button'
          aria-label='Hide until the next version'
          onClick={() => { try { localStorage.setItem(DISMISSED, version) } catch {} setDismissed(version) }}
        >
          <X size={14} />
        </button>
      )}
    </div>
  )
}
