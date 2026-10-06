# PearSheet - Decisions

Append-only, newest on top. Per Constitution §4.

## 2026-10-05 - Presence: a members-only channel, nothing stored
Tier: T2
Context: show who has a sheet open and which cell they are on
(proposals/2026-10-05-presence.md).
Choice: a Protomux channel `pearsheet/presence/1` per sheet, open only
while both devices have the sheet on screen. Each side signs a hello with
its identity key for its own swarm key; the other checks the connection
key, the signature, the age and current membership before sending or
accepting anything. State lives in memory and drops after 60 s of silence.
Alternatives: Yjs awareness inside the sync (would reach the seeder's
relay path and the Autobase), presence ops in the log (stored forever).
Consequences: the seeder never sees presence; older builds see none. The
hide setting is mutual: with it off you see nobody either.

## 2026-10-05 - Histogram and waterfall .xlsx: as Excel writes them
Tier: T1
Context: PR #73's export, first opened in real Excel (Excel for the web).
Choice: Excel repaired the file and dropped both charts. They now go out
the way Excel itself writes them (test/fixtures/excel-histogram-waterfall.xlsx):
no `dir` on the data references, a chart style and colour part per chart,
and a text box as the fallback instead of a plain column chart. Checked in
Excel for the web: A (dir only) still failed, B (all three) worked, and
the code's own output worked.
Alternatives: keep the column-chart fallback (rejected - Excel refused that
version; LibreOffice reads the chartex part either way).
Consequences: programs that read neither format show the text box.

## 2026-10-05 - Shared compaction: a move that keeps everyone
Tier: T2
Context: proposals/2026-10-05-shared-compaction.md.
Choice: tidying up is the removal move with nobody removed; `move` gains
`reason: 'compact' | 'remove'`. After any move, each writer device sends
the new sheet what only its old copy holds, so offline edits are no longer
lost (they were, on removals). The owner's device tidies up by itself at
50,000 updates, never while an invite link is unused, and the owner has
"Tidy up this sheet". The frozen copy stays until every member has a device
in the new sheet (then a week) or 90 days; the seeder is asked to drop it
only then, since it caps drops at 30 days and keeps the earliest date.
Alternatives: a fresh Yjs document (rejected - offline edits could no longer
merge; the Yjs record is about 26 bytes per edit); manual only (rejected -
owners would not find it).
Consequences: at 50,000 edits a new device joins in 0.7 s instead of 19 s
and keeps 5 MB instead of 70 MB (`bench/RESULTS.md`). Undo history restarts
after a tidy-up. Older builds follow a tidy-up as a plain move.

## 2026-10-05 - No StartOS seeder for now
Tier: T1
Context: proposals/2026-10-05-start9-seeder.md.
Choice: hold the native StartOS 0.4 package (built in `start9/seeder/`).
On Tim's Start9 a desktop on the same LAN could not pair (stalled 180 s)
while the Pixel on cellular paired in about 1 s: StartOS 0.4 puts every
package behind a second NAT the SDK cannot turn off.
Alternatives: ship it for away-from-home use (rejected - a home server's
devices are mostly at home); have the seeder announce the box's LAN address
and a forwarded port, or a relay (both need their own proposal).
Consequences: Umbrel, the desktop app and the Linux download are the
always-on seeders.

## 2026-10-05 - Umbrel seeder: host networking and its own login
Tier: T1 (packaging), login as PearTune's approved design
Context: proposals/2026-10-05-umbrel-seeder.md.
Choice: the Umbrel app runs the seeder with `network_mode: host`. On Tim's
Umbrel a member could not pair through Docker's bridge (stalled 150 s);
with host networking it paired in 955 ms. Umbrel's app proxy cannot front
a host-networked app, so the dashboard uses `@peerloom/host/dashboard-auth`
with the app password umbrelOS shows (`deterministicPassword`).
Alternatives: bridge plus app proxy, as the PearCal and PearCircle seeders
(rejected - devices could not reach the seeder).
Consequences: the dashboard port (8761) is open on the Umbrel's LAN and
tailnet, behind the password.

## 2026-10-05 - Formula rules and icon sets in colour rules
Tier: T2
Context: proposals/2026-10-05-formula-rules-icon-sets.md.
Choice: two more kinds in `cf:<tabId>`. A formula rule's formula is stored
like a formula reference, written for the range's top-left cell and moved
for each cell; the worklet's formula engine works out the matches from the
merged values and sends them with the sheet view. Icon sets use Excel's
percent thresholds (67/33, or even splits for 4 and 5 icons).
Alternatives: editable thresholds (deferred).
Consequences: older builds show no colours or icons from these rules.

## 2026-10-05 - Radar, bubble, stock, histogram and waterfall charts
Tier: T2
Context: proposals/2026-10-05-more-chart-types.md.
Choice: five new values of a chart's shared `type`, plus `binWidth` and
`totals`. Each reads the chart's one data range (bubble: X then Y and size
per series; stock: label then Open, High, Low, Close). Histogram bins and
waterfall running totals are worked out on each device. In .xlsx, radar,
bubble and stock are classic chart parts; histogram and waterfall use
Excel's newer chart format with a plain column chart as the fallback.
Alternatives: plain column charts only in files (rejected - not real
histograms in Excel).
Consequences: older builds draw these as column charts.

## 2026-10-04 - Hiding, conditional formatting, validation, names, comments
Tier: T2
Context: the rest of the everyday gaps against Calc
(proposals/2026-10-04-sheet-tools.md).
Choice: each is a new shared map keyed by row and column ids
(`hidden:<tabId>`, `cf:<tabId>`, `valid:<tabId>`, `comments:<tabId>`) or,
for names, one `names` map per sheet. Conditional colours and validation
marks are worked out on each device from the merged values. SUBTOTAL
101-111 skips hidden rows but not filtered ones, because filters are
personal. Comments come from editors and the owner only.
Alternatives: per-person hiding (rejected - hiding is layout, as in
Excel); viewer comments (deferred - needs a membership change, T3);
formula rules for conditional formatting (deferred).
Consequences: older builds show hidden rows, no colours or comments, and
`#NAME?` for formulas that use names.

## 2026-10-04 - Freeze panes shared, filters each person's own
Tier: T2 (freeze); T1 (filters)
Context: proposals/2026-10-04-freeze-filter.md.
Choice: frozen rows and columns are stored per tab in `view:<tabId>` as the
last frozen row and column ids, seen by everyone and written to .xlsx.
Filters stay on the device that set them and hide rows only there.
Alternatives: shared filters as in Excel (rejected - one person filtering
would hide rows from others mid-edit); per-person freeze (rejected - the
header is part of the sheet's layout).
Consequences: .xlsx exports carry no filter.

## 2026-10-04 - More cell formats, merged cells, row heights
Tier: T2
Context: the everyday formatting gaps against Calc
(proposals/2026-10-04-cell-formats.md).
Choice: new per-attribute keys in `fmt` (align, valign, wrap, size, u, s,
font, four borders); merges in a root map `merges:<tabId>` keyed by the
top-left cell's ids, the earliest in reading order winning an overlap; row
heights in `heights:<tabId>`, with rows that hold wrapped or larger text
growing on each device without storing it. Styles go into .xlsx exports,
written after SheetJS like charts.
Alternatives: one style object per cell (rejected - concurrent changes to
different attributes would clash); stored auto heights (rejected - devices
measure text differently).
Consequences: older builds show plain, unmerged cells; a spill is blocked by
a merge.

## 2026-10-04 - Charts: shared descriptions drawn with ECharts
Tier: T2
Context: charts were the biggest gap against Calc
(proposals/2026-10-04-charts.md).
Choice: each tab has a `charts` Y.Map of chart descriptions (one key per
setting, data range stored with cell ids like a formula), drawn on every
device with ECharts as SVG. Charts float over the grid anchored to a cell.
.xlsx exports carry them as DrawingML chart parts PearSheet writes itself.
Alternatives: Chart.js (rejected - fewer types, no SVG, add-ons for labels);
charts as images (rejected - would not follow the data); a chart per tab
(rejected - charts belong next to their data).
Consequences: about 620 KB more interface code. Older builds show no charts.
Charts in imported .xlsx files are not read.

## 2026-10-04 - Single-value functions run per value over a range
Tier: T2
Context: =UPPER(A1:A3) and =IF(A1:A3>1, ...) should fill three cells as in
Excel 365 (proposals/2026-10-04-functions-over-ranges.md).
Choice: `src/shared/formula/lift.js` lists each function's single-value
argument positions, built from the catalog's argument names with hand
corrections; the parser's function call runs the function once per
position when a block arrives there. Checked against LibreOffice for every
function in the corpus.
Alternatives: per-function wrappers (rejected - 280 functions); lifting
every argument (rejected - SUM and lookups would break).
Consequences: formulas giving a range where one value goes now spill.
Database functions are left out. Excel's `@` (implicit intersection) is not
supported.

## 2026-10-04 - A2# is ANCHORARRAY, rewritten before parsing
Tier: T2
Context: "the whole spill from A2" (proposals/2026-10-04-spill-reference.md).
Choice: `ref#` is rewritten to Excel's ANCHORARRAY(ref) before a formula is
parsed. ANCHORARRAY returns a reference to the block, as OFFSET does. Stored
formulas keep `#` as typed; .xlsx uses `_xlfn.ANCHORARRAY`.
Alternatives: a `#` token in the vendored parser's grammar (rejected - a
bigger change to code we keep in step with upstream, for the same result).
Consequences: older builds show #ERROR! in cells using `#`. LibreOffice 26.2
does not read ANCHORARRAY from .xlsx, so those corpus cases use Excel values.

## 2026-10-04 - Formulas spill, computed on every device
Tier: T2
Context: FILTER, SORT, UNIQUE and SEQUENCE fill a block of cells; the v1
wire protocol said no spill (proposals/2026-10-04-spilling-formulas.md).
Choice: every array result spills, as in Excel 365. Spilled values are
computed from the merged cells, never stored. A spill is blocked (`#SPILL!`)
by typed cells, by an earlier anchor's spill in reading order, by the tab's
edge or past 100,000 cells. Evaluation starts in reading order so cycles
resolve the same on every device.
Alternatives: store spilled values (rejected - two devices could store
different ones); spill only the new functions (rejected - unlike Excel).
Consequences: old builds show the first value and see spilled cells as
empty. The `A2#` operator is a follow-up.

## 2026-10-04 - Profile pictures live inside each sheet's encrypted log
Tier: T2
Context: profiles with avatars, as in the other suite apps
(proposals/2026-10-04-profiles-with-avatars.md).
Choice: a signed `avatar` op carries a 128 x 128 JPEG (16 KB cap) in each
sheet the person is in. Any writer may append a member's signed `name` or
`avatar` op, so viewers can change theirs by handing it to a writer.
Alternatives: a per-device Hyperblobs core with a reference on the member
record, as in PearList and PearPetal (rejected - not encrypted with the sheet
key and not held by the blind seeder, so a picture would only load while its
owner is online).
Consequences: one copy of each picture per sheet per change, about 5 to 10 KB.
Old builds skip the op and show no pictures, and keep a viewer's old name.

## 2026-10-03 - Desktop first, as an Electron app running the Bare worklet
Tier: T0 (product scope and build order)
Context: Tim asked to start with desktop, then mobile (Android first).
Choice: an Electron app for Linux, macOS and Windows. Electron starts the same
Bare worklet bundle the phones will run, and the renderer hosts the same web UI
the mobile WebView will load.
Alternatives: a helper program plus a browser tab (two pieces to install);
pure browser (needs a bridge server); Node inside Electron as in PearGuard
(rejected - a second copy of the P2P code for mobile).
Consequences: spikes ran on the desktop; the emulator run moves to the start of
the mobile phase.

## 2026-10-03 - .xlsx library = SheetJS CE from its CDN, pinned in the repo
Tier: T1
Context: v1 needs .xlsx import and export, not perfect round-trips.
Choice: SheetJS Community Edition 0.20.3 (Apache-2.0), tarball checked into the
repo with its checksum. Values and formulas only, no formatting in v1.
Alternatives: ExcelJS (MIT, writes styles, but does not run under Bare);
npm `xlsx` 0.18.5 (rejected - abandoned there, known advisories).
Consequences: formatting is lost on export. See `spikes/xlsx/RESULTS.md`.

## 2026-10-03 - Formula engine = vendored fast-formula-parser with fixes
Tier: T2
Context: every device must compute the same value for every cell. The spike
found that formulajs date functions follow the device timezone, and that
`Math.pow/sin/cos` and `**` differ in the last bits between V8 versions.
Choice: vendor fast-formula-parser (MIT) into the repo. Fill its stubbed
functions from @formulajs/formulajs (never its date functions). Replace `**`,
`Math.pow`, `Math.sin` and `Math.cos` with pure-JS fdlibm ports
(@stdlib, Apache-2.0) and lint against them. Replace `localeCompare` with a
fixed comparison. NOW, TODAY, RAND and RANDBETWEEN are device-local by design.
A golden-file corpus test runs under Node and Bare.
Alternatives: HyperFormula (GPL-3.0 or paid - rejected for licence, kept as
the fallback if paid); IronCalc (WebAssembly, blocked on iOS);
hot-formula-parser (wrong answers, timezone-dependent dates).
Consequences: we own and maintain the formula code. 50/50 on the spike corpus,
bit-identical across Node, Bare and four timezones. See
`spikes/formula/RESULTS.md`.

## 2026-10-03 - CRDT library = Yjs
Tier: T2
Context: merging must be deterministic whatever order edits arrive in, inside
an encrypted Autobase that a blind seeder can hold.
Choice: Yjs. Each Autobase entry carries one Yjs update; the view is every
update in log order, so the sheet is always rebuilt the same way.
Alternatives: Automerge (passed every check on desktop, but needs WebAssembly,
which jitless V8 on iOS does not have; also 5 MB and 4.5x larger updates).
Consequences: concurrent writes to one cell keep one value and drop the other,
with no record of the loser. Needs a small `node:crypto` shim under Bare. Not
yet run on an emulator or phone. See `spikes/crdt/RESULTS.md`.

## 2026-10-03 - PearSheet ships its own seeder
Tier: T2
Context: the suite-wide shared seeder proposal
(`/home/tim/peerloomllc/proposals/2026-07-21-shared-seeder.md`) is on hold.
Choice: PearSheet builds its own seeder and does not wait on that proposal.
Alternatives: wait for the shared seeder (rejected - no date, and it would block v1).
Consequences: a blind seeder runs no app engine, so it is a good first candidate
if the shared seeder proposal is revived.

## 2026-10-03 - The seeder is blind
Tier: T3
Context: with no server, a sheet only syncs while two collaborators are online
together. An always-on seeder fixes that.
Choice: the seeder stores and relays encrypted blocks only and never receives
the sheet's encryption key (holepunchto/blind-peer style).
Alternatives: a full-engine seeder that can read the data, as in PearCal and
PearCircle (rejected - sheets hold finances and other private data, and a
readable copy on a box breaks the pitch).
Consequences: the seeder cannot apply edits or evaluate formulas. Devices do all
merging and computing. The wire protocol must define what the seeder gets at
pairing and show it cannot decrypt.

## 2026-10-03 - Sheets first, docs later
Tier: T0 (product scope)
Context: a 2026-10-03 web search found partial P2P competitors for documents
(Anytype, Delta Chat editors, hobby projects) but no P2P spreadsheet with
formulas for regular users.
Choice: v1 is shared spreadsheets. Shared documents are phase 2 and absorb the
former PearNote idea.
Consequences: competitor list lives in `/home/tim/peerloomllc/APP-IDEAS.md`.

## 2026-10-03 - App name = PearSheet
Tier: T0 (branding, no wire effect)
Choice: PearSheet, kept from the APP-IDEAS placeholder. Repo
github.com/peerloomllc/pearsheet (private for now).

## 2026-10-06 - Sheets, docs and slides ship as one app
Tier: T0 (product scope)
Context: the suite could ship spreadsheets, documents and slides as one app or
as separate apps. Google splits them, but its account and Drive tie the apps
together. LibreOffice, Collabora, OnlyOffice and the Microsoft 365 mobile app
ship one app. In our apps the app itself holds pairing, the group, device keys
and the seeder.
Choice: one app. Documents (phase 2, absorbing PearNote) and any later slides
live inside it.
Consequences: one pairing, one seeder and one release pipeline. Separate apps
would have needed cross-app identity sharing first. Costs: one store listing
reaches fewer searches than three, and the name "PearSheet" only describes
spreadsheets, so it may need a broader name before documents ship.
