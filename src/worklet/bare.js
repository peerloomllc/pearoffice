// PearOffice Bare worklet entry. The same bundle runs on the desktop (spawned by
// Electron, IPC over stdin/stdout) and later on phones (BareKit IPC).
// @peerloom/core owns the P2P plumbing; this file wires in PearOffice's apply
// rules and IPC methods. See proposals/2026-10-03-wire-protocol.md.

const Hypercore = require('hypercore')
const b4a = require('b4a')
const { applyEncryptionReloadFix } = require('./hypercoreEncryptionPatch')

// Must run before any core opens: hypercore 11.37.1 still has the
// DefaultEncryption._reload bug that turns encrypted blocks into noise.
applyEncryptionReloadFix(Hypercore, b4a)
require('./hypercoreSnapshotPatch').applySnapshotFlushFix(require('hypercore/lib/session-state'))

const { createSheetEngine } = require('./engine')

const engine = createSheetEngine()
engine.start()

// On the desktop the worklet is a child of Electron, talking over stdin. When
// Electron goes away for any reason (a crash, a kill, a normal quit that never
// sent app:close) the pipe closes. Without this the worklet ran on by itself,
// kept the data folder locked, and the next launch could not open it
// ("Cannot read properties of null (reading 'list')", found 2026-11-15).
// Phones talk over BareKit IPC and never get here.
if (typeof BareKit === 'undefined') {
  let closing = false
  const shutdown = () => {
    if (closing) return
    closing = true
    // Give the stores a few seconds to close, then go regardless.
    setTimeout(() => Bare.exit(0), 5000)
    engine.close().catch(() => {}).then(() => Bare.exit(0))
  }
  const stdin = require('bare-process').stdin
  stdin.on('end', shutdown)
  stdin.on('close', shutdown)
}
