# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

Constitution applies. See `/home/tim/peerloomllc/CONSTITUTION.md` for risk tiers,
proposal gate, DECISIONS convention, verify gate and wiki-sync rules.

## Project Overview

PearOffice is a peer-to-peer office app (formerly PearSheet) for Android,
iOS and desktop. No accounts. No servers. No cloud. A file is shared with a
small group who co-edit it live, device to device. Spreadsheets ship first;
documents are phase 2 (absorbing the former PearNote idea) and slides may
follow, all in this one app (DECISIONS.md 2026-10-06,
proposals/2026-10-06-rename-to-pearoffice.md).

It uses the same three-layer architecture as the rest of the suite:
- React Native (Expo) shell
- WebView React UI
- Bare worklet (P2P backend)

Builds on `@peerloom/core` (`/home/tim/peerloomllc/peerloom-core/`)
for identity, pairing and sync rather than copy-forking (confirmed in the wire
protocol proposal).

`.npmrc` sets `install-links=true`, so `npm install` copies `../peerloom-core`
into `node_modules` instead of linking it. The bundles then carry one copy of each
library. With the link, core's own `node_modules` put a second set into them
(an older hypercore and a second copy of each native addon). After changing core,
run `npm install` here to pick it up. npm alone does not copy a package again
while its version is unchanged (even `npm ci` can hand back an old copy), so a
postinstall step, `scripts/sync-peerloom-packages.js`, copies the sibling's
current files over it.

Origin, competitor survey and open hard parts: the PearSheet entry in
`/home/tim/peerloomllc/APP-IDEAS.md`.

## Status

v1 wire protocol approved: `proposals/2026-10-03-wire-protocol.md`. Desktop
first (Electron), then mobile (Android first). The engine is scaffolded: the
Bare worklet, the Yjs sheet model, the vendored formula engine and sync over
`@peerloom/core`. The Electron shell and grid UI work on Linux. Sharing works: single-use
invites, owner, editor and viewer roles, renames. The blind seeder works:
pair by link, every member backs up to it, a member can catch up from it
alone. Removing someone moves the sheet to fresh keys. Desktop installers build for
Linux, macOS and Windows. The Android app runs on the emulator and the TCL.
A person can link their devices (one-time link) and keep a 12-word recovery
phrase (proposals/2026-10-03-device-linking.md). With a seeder, the phrase
brings files back too (proposals/2026-10-07-phrase-recovers-files.md). The seeder ships inside the
desktop app and as a Linux server download. iOS runs on the Simulator and
the iPhone SE. Mac builds are signed and notarized. Anyone can remove a sheet
from their device and the owner can delete it for everyone, seeder included
(proposals/2026-10-04-deleting-sheets.md). The owner's device tidies up a long sheet by moving it to a fresh copy
(proposals/2026-10-05-shared-compaction.md), and any move now carries
edits made offline. A seeder can be taken off a sheet,
a device can stop using one and a seeder can forget a device
(proposals/2026-10-04-stop-backing-up.md). Members see who else has a sheet open and which cell they are on
(proposals/2026-10-05-presence.md). People have profile pictures,
stored inside each sheet (proposals/2026-10-04-profiles-with-avatars.md).
Settings > Devices lists your linked devices; each has a name you can
change on any of them, kept in every file like your name
(proposals/2026-10-07-device-names.md).
A person's linked devices keep the same files: one made, joined or moved
on one device appears on the others (proposals/2026-10-07-own-devices-files.md).
Files can go in folders, one level, yours alone, the same on all your devices
and back with the phrase (proposals/2026-10-10-folders.md).
On desktop, PearOffice can start hidden in the tray at login
(`desktop/login.js`; XDG autostart on Linux, a LaunchAgent on macOS, login
items on Windows). `PEAROFFICE_DEBUG=1` turns on logging in an installed copy.
Slides part 1 is built (proposals/2026-10-06-slides.md): decks with a slide
list, layouts, text boxes, moving, resizing, rotating and snapping, one
theme and presence. Part 2 presents: full screen with keys and clickers, a
presenter view on a second display (an audience window opened by
`desktop/main.js`) and phones (landscape fills the screen, portrait shows
notes). Part 3 adds shapes, pictures and four themes; part 4 PDF and .pptx export and .pptx import.
A first launch shows a welcome, asks your name and gives a short tour
(`src/ui/Onboarding.jsx`; once per device, `app:onboarding` and
`app:onboarded`; a device with a file or a name counts as done). Settings
and About replay the tour.
Sheet cells can hold links to web pages, email addresses or another tab or
cell (proposals/2026-10-18-sheet-links.md). Any file can be marked as a
template, private or shared with the people in it, and New makes a file of
your own from it or from a built-in one (proposals/2026-10-18-templates.md).
See `TODO.md`.

## Layout

Code that works for any kind of file sits apart from each editor's own
(proposals/2026-10-06-rename-to-pearoffice.md, step 3). Documents have
`src/doc/` and `src/ui/doc/` the same way, and slides `src/slides/` and
`src/ui/slides/`.

- `src/shared/` - runs anywhere, for any file: `ids.js`, `links.js`
  (`okLink`: what a link on a picture or shape may be, web, email, file,
  folder or PearCal; proposals/2026-10-26-picture-links.md), `pearcal.js`
  (links to a PearCal event, `pearcal://event/<calendarId>/<eventId>`, or
  day, `pearcal://day/<YYYY-MM-DD>`, checked with exact patterns; a copy is in
  `desktop/open-url.js`, which `app:openUrl` uses; when PearCal is not
  installed `app:openUrl` returns `notInstalled` and `src/ui/AppMissing.jsx`
  says so; date chips have Open in PearCal;
  ../proposals/2026-10-26-pearcal-pearoffice-links.md), `phrase.js`
  (12-word recovery phrase: a 16-byte root, `phrase:root` in localDb, the
  identity seed a keyed hash of it), `qr.js`, Bare shims.
- `src/doc/` and `src/ui/doc/` - documents (proposals/2026-10-06-documents.md): `docModel.js` (the Yjs doc: `meta`, `body`), `docMethods.js` (`doc:create`, `doc:state`, `doc:update`), `DocView.jsx` (TipTap 3 editor), `docFiles.js` (import .docx/.odt/.md/.txt/.html, export .docx/.odt/.md/.txt/PDF, pictures included; `odt.js` writes .odt from the editor's JSON and turns an .odt into HTML for the same import path; `node scripts/check-doc-export.js [dir]` has LibreOffice read an exported .docx), `pictures.js` (shrinking before upload, the per-document picture cache, the picture node view). Pictures are `image` nodes (`extensions.js`, `Picture`) and move a document to schema version 2 (`docModel.js`); @ chips are `chip` nodes (`extensions.js`, `Chip`; the pill, the @ menu's trigger and picking in `ChipView.jsx`, using the sheet's `AtMenu` and `SmartChip`), move a document to version 3 through `doc:useChips` and go out as text (`flattenChips`) (proposals/2026-10-26-document-chips.md); dropdowns are `dropdown` nodes (`extensions.js`, `Dropdown`; the pill, its choices, Edit choices and Enter carrying it to the next list item in `DropdownView.jsx`) naming one of the document's lists of choices (`lists.js`, root map `lists`), move a document to version 4 through `doc:useDropdowns` and go out as their text in the item's colours (proposals/2026-10-29-document-dropdowns.md); version history (proposals/2026-10-26-version-history.md): each `y` op carries `at` and the view keeps it (`yOps.js`, `sheetWire.js`; a moved file's first edit carries `start`), `src/doc/history.js` groups edits into versions and replays one (`file:versions`, `file:version`), `src/ui/History.jsx` shows them (documents with the changes from `versionDiff.js`, Restore by `setContent` in the editor; sheets as a grid from `sheet:versionCells` and decks as slides, Restore by `file:restore`, which uses `history.restoreInto`; `src/worklet/historyMethods.js`); `doc:addPicture` and `doc:picture` are in `docMethods.js`. The editor keeps a Yjs replica and sends batched updates; `doc:updated` brings others' edits.
- `src/media/` and `src/ui/media/` - PDFs and pictures as files
  (proposals/2026-10-29-pdf-and-picture-files.md): kinds `pdf` and
  `picture`, 25 MB at most, nothing else. `mediaModel.js` (`meta` and a
  `media` map pointing at the bytes in the file's picture cores,
  `src/worklet/pictures.js`, which allows 25 MB references in these
  kinds), `mediaMethods.js` (`media:begin`, `media:part`, `media:end`
  to add one in 1 MB parts, `media:info`, `media:read` a part at a
  time). `mediaFiles.js` (Import: a JPEG or HEIC is drawn again, which
  drops EXIF and location; `pdf.js` runs pdf.js 6 on the page, its
  worker bundled, since the phone's page only runs bundled scripts) and
  `MediaView.jsx` (pictures with zoom and pan, PDF pages drawn as they
  come on screen, links, Save a copy, Print). Builds that do not know
  these kinds say "Update PearOffice to open this file".
- `src/slides/` and `src/ui/slides/` - slide decks (proposals/2026-10-06-slides.md): `slidesModel.js` (the Yjs doc: `meta`, `deck`, `slides`; order by fractional index keys; every change goes through its functions), `layouts.js`, `slidesMethods.js` (`slides:create`, `slides:state`, `slides:update`). `SlidesView.jsx` (the replica, toolbar, notes, presence and one Y.UndoManager over `slides` and `deck`, shared with TipTap's undo plugin through `text.js`, so text and moves undo in one history), `SlideList.jsx` (thumbnails as static DOM, reorder by drag, Ctrl+Up/Down or the slide menu), `Stage.jsx` (the slide scaled with a CSS transform; selection, our own move, resize and rotate handles, snapping with guides in `geometry.js`; a drag writes the frame once, on release), `TextBox.jsx` (a live TipTap editor only in the box being edited, static DOM for the rest; text is drawn 1.5 times larger so sizes are PowerPoint points), `TextTools.jsx`, `Notes.jsx`, `themes.js` (four themes: `plain`, `midnight`, `paper`, `vivid`; colours and fonts as CSS variables on the slide), `objects.jsx` (shapes as inline SVG filling the frame, a line across the middle of its frame with SVG arrowheads, a custom shape's path from its 1000 x 1000 box (`svgPath.js`), fill and outline opacity; pictures cropped by drawing the whole picture larger inside a clipping box; pictures as `<img>` from a per-deck cache fetched with `slides:picture`, grey with the alt text until they arrive; `PicturesContext`, which the editor and the audience window each provide; a theme colour slot is drawn as the slide's CSS variable, so a new theme recolours shapes), `ShapeTools.jsx` (Insert shape menu; fill, outline colour, width, their opacity, a rounded rectangle's corners and arrowheads for the selected shapes; top, middle and bottom for text; desktop only; Crop and Wrap text are in `Stage.jsx`), `SlideChart.jsx` (chart elements drawn with the sheet's `chartOption.js` as ECharts SVG text, in the theme's accents, the chart's text colour (else the theme's) and font; horizontal bars run from the bottom up as in PowerPoint and small pies keep labels inside; kept per data, theme and size so thumbnails reuse it), `ChartTools.jsx` (the tools of a selected chart: type, title, legend, values, stacked, smooth lines and text colour; the Edit data panel writes `slidesModel.setChart` once typing pauses; desktop only), `deck.js` (the deck as drawn from a replica), `StaticSlide.jsx` (a slide as static DOM, for thumbnails and the show), `Present.jsx` (presenting: Present or F5 from the first slide, Shift+F5 from this one, for viewers too; PowerPoint's keys; one display goes full screen; with two, `desktop/main.js` opens an audience window on the other display, which loads the UI with `?audience=<id>` and keeps its own replica, and the main window becomes the presenter view with notes, next slide and a timer; `app:presentStart`, `app:presentGo`, `app:presentInput` and `app:presentEnd` are handled in main; on phones, tap halves or swipe in landscape, notes under the slide in portrait; `mobile/App.js` hides the status bar and ends the show on Back). Pictures are added with `slides:addPicture` after the same shrinking as documents (`src/ui/doc/pictures.js`), then `slidesModel.addPicture`; a corner handle keeps a picture's shape (Shift frees it). The schema is `slideExtensions()` in `src/ui/doc/extensions.js`. Phones edit text (in boxes and shapes), notes and slide order only; they and viewers draw shapes and pictures. Export: `pptxExport.js` (pptxgenjs, fixed up after writing; charts as PowerPoint charts) and `pdfExport.jsx` (one page per slide through `app:savePdf`/`app:print`, which take a `pageSize` in inches); `node scripts/check-slides-export.js [dir]` has LibreOffice read an exported .pptx (needs `soffice` and `pdftotext`). Import: `pptxImport.js` (our own reader: layout and master inheritance, theme colours and fonts, groups, notes, opacity, text anchor and wrap, crops, line ends, SmartArt from its saved drawing, charts from their cached values in `importChart.js`; a notice lists what was lost), `customGeom.js` (custGeom paths into the 1000 box), `importOoxml.js` (the zip with size limits, theme, colours) and `importText.js`; the deck goes in with `slides:import` and its pictures after. OpenDocument: `odp.js` writes .odp from the deck (titles and bodies as Impress placeholders, rounded rectangles, triangles and arrows as Impress's own shapes, line ends with Impress's PowerPoint marker names, charts as embedded chart documents with a local table, notes on the master's notes style) and `readOdp` reads one into the same plain data as `readPresentation`, so `buildDeck` makes the deck; `test/slides-odp.test.js` checks both against LibreOffice.
- `src/sheet/` - the spreadsheet, runs anywhere (Bare, Node, browser):
  `sheetModel.js` (the Yjs document), `refs.js` (A1 <-> id formula
  references), `formula/` (evaluator, deterministic maths, formulajs fills,
  vendored fast-formula-parser), charts, fill, filter, validation (a list
  can show as coloured chips: `chips` and `colors` on the rule, exported as
  colour rules; `multi` allows more than one choice, joined by ", ";
  proposals/2026-10-22-dropdown-chips.md and 2026-10-23-multi-select-and-smart-chips.md), colour
  rules, .xlsx/.csv/.json import and export, .ods import and export
  (`odsFormula.js`: SheetJS for the values and tabs, our own formula
  conversion and tab names, since SheetJS gets both wrong; `odsCharts.js`:
  charts as embedded chart documents in their anchor cells; bubble goes out
  as scatter, stock as line, histogram and waterfall as columns;
  `odsStyles.js`: cell looks, widths, heights, hidden rows and columns,
  frozen panes in settings.xml; `python3 scripts/check-ods-view.py f.ods`
  shows LibreOffice's frozen panes, which a headless conversion drops;
  `odsRules.js`: colour rules in LibreOffice's calcext:conditional-formats,
  validation in table:content-validations, a saved filter read on import), and `sheetMethods.js` (the
  sheet's IPC methods, run in the worklet).
- `src/worklet/` - the Bare program: `bare.js` entry, `engine.js` (core
  wiring), `sheetWire.js` (apply rules), `yOps.js` (edits over 1 MB split into parts), `membership.js` (signed membership
  ops, built and checked), `join.js` (the `pearoffice/join/1` handshake),
  `moves.js` (removal by moving to fresh keys), `seeding.js` (seeder client),
  `linking.js` (linking a person's devices, recovery phrase),
  `presence.js` (who has a sheet open, and their cell),
  `ownDevices.js` (a person's devices tell each other about their files:
  a topic from the identity seed, signed hellos on `pearoffice/own-devices/1`,
  then the file list and each new file; a file removed on a device is not
  added back to it),
  `keyring.js` (your encrypted file list: keys from the identity seed,
  sealing, merging), `keyringSync.js` (each device keeps it on your seeders,
  once a minute at most; `app:keyring`), `restoring.js` (after a restore
  from the phrase: find the keyring on its topic, claim the seeders, open
  the files; `app:restoreStatus`; `moves.recoverCopy` and `file:recoverCopy`
  for a file nobody else can let you into),
  `profiles.js` (your name and picture in every sheet),
  templates (proposals/2026-10-18-templates.md): `meta.template` in any
  file (`sheetModel.setTemplate`, `templateState` drops the mark and
  comments), `file:setTemplate` and `file:fromTemplate` in
  `fileMethods.js`, which copies the content into a new file with fresh
  keys and pictures under its key; `file:list` gives `template` and
  `myRole`,
  `folders.js` (your folders, yours alone and one level: localDb
  `folder:<id>` and `place:<sheetId>`, later wins; sent to your other
  devices as `folders` on the own-devices channel, kept in the keyring's
  `folders` and `places`, carried when a file moves; `file:folders`,
  `file:newFolder`, `file:renameFolder`, `file:deleteFolder`, `file:place`,
  event `folders:changed`; proposals/2026-10-10-folders.md),
  `tags.js` (your tags, yours alone, many per file: localDb `tag:<id>`
  (name, colour from the dropdown chip set) and `tagged:<sheetId>:<tagId>`
  (`on`), one record per file and tag so adds made apart both stay; same
  names made apart show as one; sent as `tags` on the own-devices channel,
  kept in the keyring's `tags` and `tagged`, carried when a file moves;
  `file:tags`, `file:newTag`, `file:renameTag`, `file:deleteTag`,
  `file:tag`, event `tags:changed`; proposals/2026-10-28-file-tags.md;
  shared tags: `meta.tags` in the file (`sheetModel.setSharedTags`), set
  by `file:shareTags` from Share and kept up to date while localDb
  `shareTags:<sheetId>` is on; each device puts a new shared name on the
  file as its own tag once (`applyShared`, seen names in
  `sharedTags:<sheetId>`); proposals/2026-10-29-shared-tags.md),
  `devices.js` (your linked devices and their names: localDb
  `devices:<deviceKey>`, the signed `deviceName` op on each file's
  `device/<writerKey>` record, a first name from the platform; `app:devices`,
  `app:renameDevice`, event `devices:changed`), `fileMethods.js` (`file:*` IPC for any kind of file; `sheet:*` names kept as aliases),
  `pictures.js` (pictures in documents: a Hyperblobs picture core per
  writer device per file, `pictures/<fileId>`, encrypted with a keyed
  BLAKE2b of `pearoffice/pictures/1` under the file key; the document holds
  only `<core key>:<blob id>` and the bytes' hash; every member fetches
  every referenced picture; `seeding.js` registers the cores with the
  file's seeders, referrer the base key; moves copy the live ones under
  the new key; proposals/2026-10-06-document-images.md),
  `sheets.js` (live documents).
- Charts (proposals/2026-10-04-charts.md): `src/sheet/charts.js` (data
  ranges, series, first guess), stored per tab in the root map
  `charts:<tabId>` (`sheetModel.js`), drawn with ECharts as SVG
  (`src/ui/sheet/Chart.jsx`, `chartOption.js`, `ChartFrame.jsx`, `ChartPanel.jsx`).
  .xlsx exports get DrawingML charts from `src/sheet/xlsxCharts.js`;
  `node scripts/check-chart-export.js [dir]` has LibreOffice open one with
  every chart type (needs `soffice`). Cell styles go into exports through
  `src/sheet/xlsxStyles.js` (SheetJS CE writes none).
- `src/sheet/jsonImport.js` turns a .json file into the same import payload
  as an .xlsx (a tab per list of records, the rest on a Summary tab).
- `src/ui/` - the React UI: the app shell, file list with folders
  (`Files.jsx`, `Folders.jsx`: folder cards, inside a folder, Move to
  folder, drag onto a folder on desktop, folders in the side list; search
  by name and tags above the files, picked tags meaning all of them, every
  file at the top level and one folder inside it; `Tags.jsx`: the pills,
  Tags... and Manage tags), sharing, seeder,
  devices and settings panels, About and donations (`About.jsx`), the phrase entry
  (`PhraseInput.jsx`: one word at a time on phones, 12 boxes on desktop,
  suggestions from the word list), the first-run welcome and tour (`Onboarding.jsx`), Ctrl+P (Cmd+P on a Mac)
  printing the open file on desktop (`printKey.js`; only the tab on screen); tabs on desktop
  (`tabs.jsx`: every open file keeps its editor, hidden when not shown;
  `useOnScreen` and `useActiveRef` limit presence and window-wide keys to
  the shown tab; the list comes back after a restart from `pearoffice:tabs`;
  proposals/2026-10-26-tabs.md; in a smoke run `app:print`
  writes `printed.html` to the data folder). On phones a tap on any button or menu item buzzes
  (`haptic.js`, the shell's `app:haptic` with expo-haptics; `danger` controls
  buzz a warning, `data-haptic` picks another kind). On desktop each editor's
  toolbar keeps to one row (`toolOverflow.jsx`: tools that do not fit get
  `data-tool-hidden`, More tools shows them all; `tool-keep` items stay).
  New lists templates under the kinds (`Files.jsx`); the built-in ones are
  `templates.js`, made through `sheet:import`, `doc:import` and
  `slides:import`.
  Menus (`Menu.jsx`: the ⋯ menu, the grid's right-click menus, a file
  card's and a tab's menu) take a list of items, `items` making a submenu
  (Save as ▸, Data ▸, File ▸); a menu fits inside the window (flips up,
  scrolls) and on a phone a submenu opens in place with a way back. The
  smoke helpers `more(label)` and `menuPick(label)` open the submenu an
  item is in.
  `src/ui/sheet/` is the spreadsheet editor
  (grid, toolbar, its panels, charts, `xlsx.js` file handling, `links.jsx`
  for links in cells: the link bar and the card under a linked cell;
  `chips.jsx` for @ chips: the @ menu and the person, file and date pills,
  format attributes `person` and `datechip`;
  proposals/2026-10-18-sheet-links.md; links to another file or a folder,
  `pearoffice://file/<id>` and `pearoffice://folder/<id>`, named from the
  file list and followed through moves with `file:follow`,
  proposals/2026-10-22-links-to-files.md; the same links from outside the
  app open the file or folder, and a card's menu has Copy link;
  `src/ui/pearLinks.js` names and opens file and folder links for all
  three editors). Talks only to
  `window.pearoffice` (`call`, `on`), which the desktop preload and the mobile
  WebView provide. Built to `dist/ui` by `scripts/build-ui.mjs`.
- `desktop/` - the Electron shell: `main.js` starts the worklet bundle with
  the bare-runtime binary and relays IPC to every window, `file-windows.js`
  opens a file in a window of its own (one per file, `?file=<id>` drawn by
  `src/ui/FileWindow.jsx`, reopened after a restart from `windows.json` in
  the data folder; `app:openWindow`, `app:windowFor`, `app:openInMain`;
  proposals/2026-10-26-file-windows.md), `preload.js` is the bridge,
  `smoke.js`, `smoke-run.js` and `smoke/` are the offscreen smoke test. Has its own
  `package.json` (Electron): `npm install --prefix desktop`.
- `src/seeder/` - the blind seeder, which is the suite's shared seeder
  `@peerloom/seeder` (`../peerloom-seeder`), copied into `src/seeder/vendor/`
  by `node scripts/vendor-peerloom-seeder.js` (run it after changing the
  package; `test/vendor.test.js` fails when the copy is stale). Never edit
  the copy. `seeder.js` starts it with PearOffice's state folder and
  `pearoffice://` links, `protocol.js` and `keyringRecord.js` re-export its
  PearOffice names and keyring checks, `bare.js` is the CLI entry. The app
  side is `src/worklet/seeding.js`, on the package's client (DECISIONS.md
  2026-10-12).
- The repo root is also the Expo app (as in PearPetal): BareKit links the
  native addons it finds in the root's dependencies. `mobile/App.js` is the
  shell (starts the worklet, hosts the UI in a WebView, relays IPC),
  `src/ui/mobile-entry.js` builds `window.pearoffice` on the WebView bridge,
  Android's Open with: `app.json` lists the office types under `intentFilters`, a VIEW intent's `content://` address reaches `mobile/App.js` through `Linking`, `modules/open-with` (Android only) gives its name and copies it to the cache, and the page takes it with `app:takeFile` and imports it (`importPicked` in `src/ui/sheet/xlsx.js`). Share to PearOffice is a SEND filter with the same types: the module's `takeShared` and `onShared` give its address. On iOS the same types are `CFBundleDocumentTypes` in `app.json`; iOS copies the file into `Documents/Inbox` and opens a `file://` URL.
  `plugins/` holds the config plugins (standalone `.debug` debug build,
  arm64-only release, Gradle memory). `android/` is generated by
  `expo prebuild` and ignored.
- `spikes/` - the 2026-10-03 research spikes and their `RESULTS.md`.

## Running

`npm run desktop` builds the UI and worklet and opens the app, using
`~/.pearoffice-dev` for data (override with `PEAROFFICE_DATA`).

`npm run seeder` builds and runs the seeder with data in `~/.pearoffice-seeder`
(override with `PEAROFFICE_SEEDER_DATA`). It prints a pairing link and QR code;
type `pair` for a new one, `status` for counts, `devices` and
`forget <key>` to unpair a device. With `--ipc` it speaks
newline JSON instead; the desktop app uses that for "Run a seeder on this
computer" (`desktop/seeder-process.js`, a separate process from the member
worklet).

The PearOffice seeder is now PeerLoom Seeder (`../peerloom-seeder`), and its
packages are retired (2026-10-14). Their last releases run PeerLoom Seeder on
the old data folder: the Umbrel store entry 1.0.1 and StartOS 1.1.1 (made by
hand; `release.sh` no longer builds either). The Linux download that moves an
install to PeerLoom Seeder (`npm run dist:seeder`) was never published:
releases no longer carry a seeder download, so an install from 1.0.0 or
1.1.0 is told an update is out but cannot download it (decided 2026-10-14).
What follows is the history.

The Umbrel app (proposals/2026-10-05-umbrel-seeder.md) is the seeder plus
a web dashboard: `seeder-dist/umbrel/server.js` (login from
`@peerloom/host/dashboard-auth`, copied from the sibling `../peerloom-host`)
and `index.html`. `node scripts/stage-umbrel.js` stages it per arch in
`dist/umbrel/`; `scripts/build-umbrel-image.sh` builds amd64 and arm64 and
pushes `ghcr.io/peerloomllc/pearoffice-seeder` (`PUSH=0` to only build). It
must run with host networking: through Docker's bridge, devices cannot pair.
The store entry is `peerloom-umbrel-app-store/peerloom-pearoffice-seeder/`;
the official one is `pearoffice-seeder` in getumbrel/umbrel-apps (first
listing PR #6172, from PeerLoom's fork `../umbrel-apps`).

Releasing: `./scripts/release.sh` on main, the same script and steps as the
other apps (`/home/tim/peerloomllc/RELEASE-PIPELINE.md`, checked by
`../check-release-pipeline.sh pearoffice`; settings in `scripts/app.conf`,
helpers from `../peerloom-release`). It takes the next version from the
latest `vX.Y.Z` tag (or `vX.Y.Z` as an argument), asks which places to
publish to, sets the version everywhere (`scripts/release/bump.js`), runs
`npm run verify`, builds Android (`scripts/build-android-release.sh`),
writes the release notes from the merged PRs (or starts from
`notes/release-<v>.md` if it exists, suite rule 13) and opens them in
vi, builds the desktop apps (seeder packages are released from
`../peerloom-seeder`), then commits the version, pushes
the tag and publishes, asking before each step: the GitHub release on
this repo (made as a draft, files uploaded several at a time with one progress line, then
published; a `.sha256` for every file; `peerloomllc/pearoffice-releases`
had the releases up to 1.1.2 and gets no more),
Zapstore, Google Play (the API when gcloud is set up, else the
Console steps), the App Store (app 6820799007; `scripts/ios-appstore.sh`)
and a Nostr note. `--check-versions` shows what each place has; `--retag`
redoes a failed release; `--skip-<target>` leaves one out (`--help`).

Updates (proposals/2026-10-05-update-checker.md): the desktop
app checks it through `desktop/updates.js` and shows `src/ui/UpdateBar.jsx`;
the checking and installing code is `@peerloom/host`'s, copied into
`desktop/vendor/peerloom-host/` by `node scripts/vendor-peerloom-host.js`.
The seeder download's launcher checks daily and has `pearoffice-seeder
update`. Test against a fake release with `scripts/serve-local-release.js`
and `PEAROFFICE_UPDATE_LATEST_URL`; `node scripts/check-update.js`
runs Update now on a real AppImage. `PEAROFFICE_NO_UPDATE_CHECK=1` turns it
off.

`npm run dist:seeder` builds the last Linux seeder download for x64 and arm64
(`dist/seeder-pkg/*.tar.gz`: the published PeerLoom Seeder build in
`seeder/peerloom-seeder`, the launcher, unit and README from `seeder-dist/`).
It then updates the previous PearOffice seeder download to it from a fake
release and checks PeerLoom Seeder starts with the same seeder key.

## Android

`npm run build:android` (or `scripts/build-android.sh arm64-v8a` for a phone)
builds the standalone debug APK, `com.pearoffice.debug`. Emulator first (suite
rule 15): the dedicated AVD `PearOffice_Pixel_9` has a 12 GB data partition
(the shared `Pixel_9` AVD ran out of space). Boot it with
`../pearlist/scripts/emu.sh PearOffice_Pixel_9 5572`, then
`adb -s emulator-5572 install -r android/app/build/outputs/apk/debug/app-debug.apk`.
`scripts/adb-ui.sh <serial> texts|tap|bounds|all` reads and taps the UI by text
(`all` lists every node with a text, to pick one by position).
On this emulator `adb shell input text` knocks adb offline; send
`input keyevent` codes instead.
If a boot dies with a Vulkan error (`VK_ERROR_INITIALIZATION_FAILED`),
`emu.sh` boots again with Vulkan off; `EMU_NO_VULKAN=1` starts that way.
The UI text dump can lag behind the WebView here: when a tap seems to do
nothing, screenshot before tapping again.

Two traps, both hit on 2026-10-03:

- **Native addon versions must match react-native-bare-kit.** The root
  `overrides` pin every addon to the versions PearPetal ships with BareKit
  0.12. A newer addon crashes at launch with `ADDON_NOT_FOUND` (dlopen: cannot
  locate symbol). Check `grep -aoE "linked:lib[a-z-]+\.[0-9.]+so"
  assets/bare-universal.bundle` against
  `node_modules/react-native-bare-kit/android/src/main/addons/`.
- The mobile bundle defers `bare-process` (core's desktop-only IPC fallback),
  which would otherwise pull in `bare-posix`, an addon BareKit never links.

## iOS

Simulator first (suite rule 7). `scripts/build-ios-sim.sh` syncs to the Mac
Mini (`~/peerloomllc/pearoffice-build`), builds the iOS worklet bundle
(`npm run build:bare:ios`, `--preset ios`: one bundle for devices and the
Simulator) and the WebView UI, runs `expo prebuild` and CocoaPods, builds an
unsigned Release Simulator app and launches it on the `PearOfficeBench`
simulator. Drive it with
`SIM_NAME=PearOfficeBench BUNDLE_ID=com.pearoffice ../pearlist/scripts/sim-drive.sh dump|tap|type|enter|shot`.
The `dump` output does not show what a text field contains: screenshot to
check, and do not type twice. `plugins/with-ios-pod-deployment-target` and
`plugins/with-ios-scene-lifecycle` come from PearPetal; the second keeps apps
built with the iOS 27 SDK from being killed at launch.

The iPhone SE: `scripts/ios-dev-install.sh` builds and signs on the Mac (build
keychain, development signing) and installs over USB from this machine. The
Mac must be logged in. `modules/local-network` (from PearPetal) plus the
`NSLocalNetworkUsageDescription` and `NSBonjourServices` entries in `app.json`
make iOS show the Local Network prompt; without them iOS never asks and can
block connections to devices on the same Wi-Fi.

## Packaging

Installers land in `desktop/dist/`. Each build ends with the packaged smoke
test (`scripts/smoke-packaged.js`) run against the installed-layout app.

- `npm run dist:linux` - AppImage and deb, built here.
- `npm run dist:mac` (Apple silicon) and `npm run dist:mac:intel` - dmg and
  zip, built on the Mac Mini over SSH in `~/peerloomllc/pearoffice-build`
  (Intel in `~/peerloomllc/pearoffice-build-x64`, so a release builds both at once)
  (`scripts/build-desktop-mac.sh` drives `scripts/mac-build-desktop.sh` on the
  Mac). Signed with the Developer ID Application certificate and notarized
  with a notarytool profile, both in the Mac's build keychain (empty
  password, works over SSH; `NOTARY_PROFILE` defaults to
  `pearcircle-seeder-notary`). Checked with codesign, stapler and Gatekeeper,
  then the packaged smoke. Hardened runtime entitlements are in
  `desktop/build/entitlements.mac.plist` (V8 JIT for Electron and Bare, Bare's
  addons, network). The Intel build is smoke-tested under Rosetta, with four parts
  (sheet-links, docs, slides, app; `SMOKE_PARTS=all` for every one).
  The packaged smoke runs a failed part once more before it counts as
  failed; a release drops a build whose smoke fails.
- `npm run dist:windows` - NSIS installer, built here with Wine (about a
  minute). Staging fails if an addon the bundles load has no Windows file
  (`scripts/check-addons.js`, run for every platform). Before a release,
  `npm run dist:windows:vm` builds on the local libvirt VM `win11-pearguard`
  and runs the packaged smoke there (start it with `virsh -c qemu:///system
  start win11-pearguard`, shut it down after). The app installs per user to
  `%LOCALAPPDATA%\Programs\pearoffice-desktop\`.

`scripts/stage-desktop.js` gathers the Bare runtime, the worklet bundle with
the target's addons and the minified UI into `desktop/build/resources`, which
electron-builder copies into the app (`desktop/paths.js` finds them). Mac
builds are signed and notarized; Linux and Windows builds are unsigned
(no Windows code-signing certificate).

## Store screenshots

`scripts/store-shots/all.sh` takes every store and website screenshot into
`metadata/store/` (desktop 1440x900, Android 1080x2160 without alpha, iPhone
17 Pro Max 1320x2868, iPad Pro 13-inch 2064x2752; light, clean status bars).
`demo.js` runs Nick, Satoshi and Hal as real engines here with the community
garden files; each device links to Nick through `GET http://127.0.0.1:8799/link`
(so it is the owner), then `desktop.sh` (the `store-shots` smoke part, not in
the default parts), `android.sh` (adb, the emulator) and `ios.sh` (sim-drive on
the `PearOfficeShotsPhone` and `PearOfficeShotsPad` Simulators, erased each run)
take five scenes: files, sheet, document, slides, sharing.

## Verify

`npm run verify` is the merge gate (Constitution §5). It runs:

- `npm test`: `node --test test/*.test.js`. Formula corpus against Excel and a
  golden file, the same corpus in four timezones, formula reference
  translation, Yjs merging, bad-update handling, a two-engine sync test and
  the invite and role rules (single use, expiry, viewers cannot write, forged
  and replayed ops skipped), device names (`test/device-names.test.js`:
  the `deviceName` op's checks, renames reaching linked devices and every
  file, a viewer's rename appended by a writer), the seeder (pairing, sync from the seeder
  alone, no readable data on it, strangers refused) and removal (others
  follow, including one who was offline; the removed person cannot open the
  new sheet; the old one freezes), all over a local DHT testnet.
- `npm run test:bare`: bundles for this machine and runs the real Bare binary.
  The formula corpus must match the golden file bit for bit, and the worklet
  bundle must create, edit and read a sheet over stdin/stdout, and the seeder
  bundle must start and print a pairing link.
- `npm run smoke:desktop`: drives the real UI in Electron with an offscreen
  window and real key and mouse events, in twenty-five parts. Each part is its own
  launch with a throwaway data folder and a 60 s limit, and prints one
  `ok`/`not ok` line, then a summary line. `sheets` is the grid editor
  (typing, formulas, pointing at cells while typing one, spilling, fill,
  charts, copy and paste, undo, zoom; about
  21 s). `sheet-files` is cell formats, filters, comments, validation, dropdown
  chips, colour rules and names, then .xlsx, .ods, .csv, .json and PDF out, tabs, tidy up and
  .json, .csv, .xlsx and .ods in (a chart, the formats, colour rules and
  validation included) (about 32 s). `sheet-links` is links in cells: from
  the toolbar and the cell menu, the card's Open and Remove, Ctrl+click to
  a cell, a typed web address, a HYPERLINK formula, a link to a block and the .xlsx round trip (about 9 s; a smoke
  run writes what Open would open to `opened.txt` in the data folder).
  `sheet-chips` is @ chips: a person whose pill follows a rename, a
  document, Tomorrow with the calendar button, Esc and typing over (about
  5 s).
  `templates` is a sheet marked from its card's menu, New listing it, a
  file made from it and from the card, a long list (search, kind buttons,
  the built-in ones folded), unmarking and each built-in template
  (about 5 s; `PEAROFFICE_SMOKE_TEMPLATES_SHOTS=<folder>` saves New and the
  built-ins).
  `docs` is documents, an .odt out and back in included (about 11 s).
  `doc-links` is links in a document: a typed web address, the card under
  the caret (Open, Copy link), Ctrl+click, and links to a file and a folder
  picked from the link bar and opened, and a link on a picture from its
  bubble (about 5 s). `doc-chips` is @ chips in a document: a person
  whose pill follows a rename, a file opened from its pill, Tomorrow
  changed with the calendar, Esc, version 3 and reopening (about 4 s;
  `PEAROFFICE_SMOKE_DOC_CHIPS_SHOT=<png>` saves the pills). `doc-dropdowns`
  is dropdowns in a document: a new list from the toolbar in a checklist,
  renamed, a choice added in orange, picking, Enter carrying the dropdown
  and leaving the list, a choice renamed on its pill and reopening (about
  3 s; `PEAROFFICE_SMOKE_DOC_DROPDOWNS_SHOT` and `_PANEL_SHOT=<png>`).
  `media-files` is PDFs and pictures as files: a two-page PDF with a link
  and a PNG through Import a file, pages drawn, Page 1 of 2, the link,
  zoom, Save a copy giving back the same bytes, a tag, the cards and
  reopening (about 3 s; `PEAROFFICE_SMOKE_MEDIA_SHOTS=<folder>`).
  `doc-history`
  is version history: two versions (a 1.5 s pause through
  `window.__historyPauseMs`), the changes marked, Copy and Restore, then a
  sheet and a deck (about 14 s; `PEAROFFICE_SMOKE_HISTORY_SHOT`,
  `_SHEET_SHOT`, `_DECK_SHOT=<png>`).
  `slides` is a deck: two layouts, typing a title, undo and redo, moving,
  resizing and rotating a box with the mouse, nudging, a text box added and
  deleted, someone else's selection, reordering by keys and by drag,
  duplicate, delete, speaker notes and reopening (about 6 s).
  `slides-present` is presenting: F5, the slide filling the screen, keys,
  click and right-click, black and white screens, a number and Enter, an
  edit and a deleted slide during the show, the cursor hiding and Esc; then
  the presenter view with a pretend second display
  (`PEAROFFICE_FAKE_DISPLAYS=2`): the audience window follows, notes, timer,
  black screen, keys from the audience window and Esc closing both (about
  7 s). With `PEAROFFICE_SMOKE_PHONE_SHOT=<png>` it also saves the phone
  show in portrait and landscape (`desktop/smoke/phone-preload.js`).
  `slides-objects` is shapes and pictures: each of the six shapes inserted,
  resized and moved, a fill, outline and outline width, text in a
  rectangle, a picture from a generated PNG (the pixels match the stored
  bytes), resized keeping its shape, moved and given alt text and a link (opened by a click in the show), the four
  themes in the stage and a thumbnail, the slide duplicated with its
  picture, the show and reopening (about 8 s). With
  `PEAROFFICE_SMOKE_OBJECTS_SHOTS=<folder>` it saves a screenshot per theme
  and one of the colour menu.
  `slides-style` is the follow-ups (proposals/2026-10-06-slides-followups.md):
  fill and outline opacity, text at the bottom of a shape and of a text box
  (also while typing), Wrap text off, a centred box that does not wrap
  growing both ways, rounded corners, arrowheads on lines, a picture cropped
  with its handles (undone and redone) and reopening (about 5 s); with
  `PEAROFFICE_SMOKE_STYLE_SHOTS=<folder>` it saves the slide.
  `slides-export` saves a deck as PDF (one page per slide, read with
  `pdfinfo`), as .pptx (read back with jszip) and as .odp, imported back
  (about 7 s); with
  `PEAROFFICE_SMOKE_EXPORT_SHOTS=<folder>` it saves comparison images.
  `slides-import` imports a hand-built .pptx through Import a file and checks
  the slides, text, bullets, shapes, a see-through custom shape, the picture,
  a chart in the editor and the show and the notice (about 1 s).
  `slides-charts` is charts (proposals/2026-10-06-slides-followups.md):
  Insert chart, every type, Edit data (a value, a series name, a row), title,
  stacked, values and legend, the thumbnail, the slide duplicated, the show
  and reopening, then smooth lines and white text kept after reopening
  (about 5 s); with `PEAROFFICE_SMOKE_CHART_SHOTS=<folder>` it
  saves each type in Plain and Midnight, the tools and the data panel.
  `folders` is folders: New folder, Move to folder from a card and from
  the file's menu, New inside a folder, dragging a file in and out, the
  side list, renaming, reopening and deleting (the files stay) (about
  5 s); with `PEAROFFICE_SMOKE_FOLDERS_SHOTS=<folder>` it saves the
  screens.
  `tags` is tags and search: Tags... from the file menu and a card, a new
  tag, Send my tags in Share and the shared mark in Tags... and the same name in another case, coloured pills, search by name, one
  tag and two (all of them), a file in a folder found from the top level and
  a search inside the folder, reopening, rename and delete in Manage tags
  (about 7 s; `PEAROFFICE_SMOKE_TAGS_SHOT=<png>` saves the start screen and
  `-panel.png` the panel).
  `windows` is files in windows of their own: Open in new window from a
  card and from the file menu, the main window bringing that window
  forward, a rename reaching both, a folder link opening in the main
  window, closing one and a restart reopening the rest where they were
  (`app:smokeReopenWindows`; about 5 s; `PEAROFFICE_SMOKE_WINDOWS_SHOT=<png>`
  saves the file window).
  `tabs` is files in tabs: three opened, switching by click, Ctrl+Tab and
  Ctrl+number, a sheet keeping its cell and undo while hidden, Ctrl+W and a
  middle click, All files and back, a tab to its own window, a removed
  file's tab closing and the tabs back after a reload (about 4 s;
  `PEAROFFICE_SMOKE_TABS_SHOT=<png>`). The smoke helpers' lookups skip
  hidden tabs (`desktop/smoke/common.js`), as a person would.
  `app` is the shell: the New picker, theme, Seeder and Devices panels
  (Linked devices: this device's default name, renaming, kept after
  reopening and a reload; `PEAROFFICE_SMOKE_DEVICES_SHOT=<png>` saves the
  list with a made-up second device, light and `-dark`), the
  local seeder, keep online, start at login, profile picture, About, sharing,
  backups, removing a file and the file list (about 16 s). `onboarding` is
  the first-run welcome, name and tour, Show my phrase, finishing with New
  file, a started tour coming back, "I already use PearOffice" (link and
  restore steps, errors, waiting and Cancel) and the tour from Settings and
  About (about 6 s; `PEAROFFICE_SMOKE_ONBOARDING_SHOTS=<folder>` saves
  every step, light, dark and phone). `onboarding-restore` restores from a
  phrase through the real restart and the welcome back note (about 2 s). The other parts start with it done
  (`PEAROFFICE_NO_ONBOARDING=1`, honoured only in a smoke run). The parts are in
  `desktop/smoke/<part>.js`, `desktop/smoke-run.js` picks one from
  `PEAROFFICE_SMOKE_PART` and `desktop/smoke/launch.js` runs them in turn.
  Run one with `node desktop/smoke.js --part docs` (a comma list works).
  `node scripts/smoke-packaged.js <app executable>` runs the same parts
  against an installed app (120 s limit each). Skipped (with a message) when
  there is no display.

`test/functions.test.js` checks 411 cases covering 374 of the engine's 390
functions (`test/fixtures/function-corpus.js`) against LibreOffice's answers in
`test/fixtures/function-expected.json`, with Excel's value recorded by hand
where the two differ. After adding cases, run `node scripts/function-expectations.js`
(needs `soffice`): it recalculates them in LibreOffice and lists where PearOffice
differs. Many upstream fast-formula-parser functions are empty stubs; they are
filled in `src/sheet/formula/fills.js`; newer Excel functions (XLOOKUP,
XMATCH, TEXTBEFORE/AFTER, OFFSET, INDIRECT, XNPV, XIRR, DSUM and the other
database functions) are in `src/sheet/formula/newer.js`.

HYPERLINK is defined in `src/sheet/formula/index.js`: it returns the label
and records the address for its own cell, which comes out as `link` on the
cell's value and `formulaLink` in `sheet:view` (proposals/2026-10-18-sheet-links.md).

Formulas spill (proposals/2026-10-04-spilling-formulas.md): any array result
fills the cells below and to the right, computed on each device and never
stored; `src/sheet/formula/index.js` has the four blocking rules
(`#SPILL!`) and evaluates in reading order. The array functions (FILTER,
SORT, UNIQUE, SEQUENCE, TEXTSPLIT, TAKE, DROP, VSTACK and the rest) are in
`src/sheet/formula/arrays.js`. `A2#` (the whole spill from A2) is rewritten
to ANCHORARRAY(A2) before parsing (proposals/2026-10-04-spill-reference.md).
A single-value function given a range runs once per value
(`src/sheet/formula/lift.js`, proposals/2026-10-04-functions-over-ranges.md);
`test/lift-corpus.test.js` checks each one against LibreOffice: run
`node scripts/spill-expectations.js lift` after changing the table. `test/spill.test.js` covers the rules;
`test/spill-corpus.test.js` checks whole blocks
(`test/fixtures/spill-corpus.js`) against LibreOffice: after adding cases,
run `node scripts/spill-expectations.js`.

Formula suggestions come from `src/sheet/formula/catalog.js` (name, arguments
and one line for each of the 400 working functions); `test/catalog.test.js`
fails if a function is added to the engine without an entry.

After a deliberate formula change, regenerate the golden file with
`UPDATE_GOLDEN=1 node --test test/formula.test.js test/functions.test.js test/spill-corpus.test.js test/lift-corpus.test.js` and say why in the commit.

jstat's gamma, log-gamma and incomplete beta functions are replaced at
start-up by @stdlib's (`src/sheet/formula/precise.js`), so the distributions
match Excel to about 15 digits; `test/functions.test.js` holds them to 13.
Under Bare, `debug` (pulled in by @stdlib) is swapped for a no-op
(`scripts/bare-imports.js`).

Formula code must never use `**`, and `Math.pow`, `Math.sin` and `Math.cos`
are replaced at start-up (`src/sheet/formula/detmath.js`). A test fails if a
`**` appears under `src/sheet/formula/`.

## The things to get right

- **Blind seeder.** The seeder stores and relays only encrypted blocks and is
  never given the sheet's encryption key. Nothing the seeder receives at
  pairing may let it decrypt. PearOffice's seeder is the suite's shared one
  (`../peerloom-seeder`). See `DECISIONS.md`.
- **Deterministic merge and formulas.** Every device must reach the same cell
  values whatever order edits arrive in. Yjs does the merging. Formula
  evaluation is a pure function of the merged cells, so the seeder never needs
  to compute anything.
- **File compatibility.** .xlsx import and export, not perfect round-trips, in v1.

## Prior art in this repo family

- PearCal already uses `blind-peering` (`pearcal-native/src/bare.js`,
  `pearcal-native/src/seed.js`).
- Wiki: `p2p-wiki/wiki/concepts/blind-peers.md`, `seeder-qr-pairing.md`,
  `blind-relay-off-lan-backstop.md`.
- PearTune's blind relay: `peartune/DECISIONS.md`.

## Branch Strategy

Always branch before work. Never commit directly to main (the initial repo
scaffold commit and `scripts/release.sh`'s version commit excepted).
- Feature branches: `feature/description`
- Bug fix branches: `bugfix/description`
- Merge via GitHub PR
