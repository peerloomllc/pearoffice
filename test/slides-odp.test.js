// Slide decks in OpenDocument (.odp, src/ui/slides/odp.js). A deck with every
// kind of element (the one scripts/check-slides-export.js makes for .pptx) is
// saved as .odp and opened again: by our reader; when LibreOffice is
// installed, by LibreOffice (saved as .pptx and read with our .pptx reader);
// and a .pptx of it that LibreOffice saves as .odp, by our reader. Each time
// the elements must come back in place with their look, text, charts and notes.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')
const { execFileSync } = require('node:child_process')
const { Window } = require('happy-dom')
const esbuild = require('esbuild')

globalThis.window = new Window()
globalThis.document = window.document
const root = path.join(__dirname, '..')
const soffice = (() => { try { execFileSync('soffice', ['--version'], { stdio: 'ignore' }); return true } catch { return false } })()

// The reader and writers with the model and Yjs, bundled once so that all use
// the same copy of Yjs.
let bundle
async function load () {
  if (bundle) return bundle
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pearoffice-odp-bundle-'))
  const file = path.join(dir, 'odp-bundle.mjs')
  await esbuild.build({
    stdin: {
      contents: [
        "export * as Y from 'yjs'",
        "export { default as slidesModel } from './src/slides/slidesModel.js'",
        "export { prosemirrorJSONToYXmlFragment } from '@tiptap/y-tiptap'",
        "export { slideSchema } from './src/ui/slides/text.js'",
        "export { themeFor } from './src/ui/slides/themes.js'",
        "export { deckToOdp, readOdp } from './src/ui/slides/odp.js'",
        "export { deckToPptx } from './src/ui/slides/pptxExport.js'",
        "export { readPresentation, buildDeck } from './src/ui/slides/pptxImport.js'"
      ].join('\n'),
      resolveDir: root,
      loader: 'js'
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    mainFields: ['module', 'main'],
    conditions: ['module'],
    outfile: file,
    banner: { js: "import { createRequire as pearofficeCreateRequire } from 'node:module'; const require = pearofficeCreateRequire(import.meta.url);" },
    logLevel: 'error'
  })
  bundle = await import(file)
  return bundle
}

// A w x h PNG: green with a yellow box in the middle.
function png (w, h) {
  const table = []
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0 }
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = table[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td))
    return Buffer.concat([len, td, c])
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * (w * 3 + 1) + 1 + x * 3
      const inner = x > w / 4 && x < w * 3 / 4 && y > h / 4 && y < h * 3 / 4
      raw[i] = inner ? 250 : 40; raw[i + 1] = inner ? 204 : 160; raw[i + 2] = inner ? 21 : 70
    }
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

const t = (text, marks) => (marks ? { type: 'text', text, marks } : { type: 'text', text })
const p = (content, attrs) => ({ type: 'paragraph', attrs, content })
const li = (...content) => ({ type: 'listItem', content })
const PIC_REF = 'core0:blob0'
const PIC = png(320, 160)

function makeDeck (m) {
  const { Y, slidesModel: S } = m
  const doc = new Y.Doc()
  const schema = m.slideSchema()
  const fill = (map, json) => m.prosemirrorJSONToYXmlFragment(schema, json, map.get('text'))
  doc.transact(() => {
    const s1 = S.initDeck(doc, { title: 'ODP check' })
    S.setTheme(doc, 'paper')
    const [titleEl, subEl] = S.elements(doc, s1)
    fill(titleEl.map, { type: 'doc', content: [p([t('Quarterly review')])] })
    fill(subEl.map, { type: 'doc', content: [p([t('Prepared by Ana')])] })
    const tilted = S.addText(doc, s1, { x: 1300, y: 860, w: 500, h: 120, rot: 15 })
    fill(S.element(doc, s1, tilted), { type: 'doc', content: [p([t('Tilted note')])] })
    const notes = S.slide(doc, s1).get('notes')
    const para = (text) => { const e = new Y.XmlElement('paragraph'); e.insert(0, [new Y.XmlText(text)]); return e }
    notes.insert(0, [para('Speak slowly'), para('Mention the budget')])

    const s2 = S.addSlide(doc, { after: s1, layout: 'blank' })
    const box = S.addText(doc, s2, { x: 100, y: 60, w: 900, h: 460, rot: 0 })
    fill(S.element(doc, s2, box), {
      type: 'doc',
      content: [
        p([t('Formatted ', [{ type: 'bold' }]), t('words ', [{ type: 'italic' }, { type: 'underline' }]), t('struck ', [{ type: 'strike' }]), t('big blue ', [{ type: 'textStyle', attrs: { color: '#1d4ed8', fontSize: '36pt' } }]), t('link', [{ type: 'link', attrs: { href: 'https://example.com/deck' } }])]),
        { type: 'bulletList', content: [li(p([t('First point')])), li(p([t('Second point')]), { type: 'bulletList', content: [li(p([t('Nested point')]))] })] },
        { type: 'orderedList', attrs: { start: 1 }, content: [li(p([t('Step one')])), li(p([t('Step two')]))] },
        p([t('Right side')], { textAlign: 'right' })
      ]
    })
    const spots = {
      rect: { x: 1100, y: 80, w: 300, h: 200, rot: 0 },
      roundRect: { x: 1450, y: 80, w: 300, h: 200, rot: 0 },
      ellipse: { x: 1100, y: 330, w: 300, h: 200, rot: 0 },
      triangle: { x: 1450, y: 330, w: 300, h: 200, rot: 0 },
      arrow: { x: 1100, y: 600, w: 300, h: 200, rot: 30 },
      line: { x: 1450, y: 680, w: 300, h: 40, rot: 0 }
    }
    for (const [shape, f] of Object.entries(spots)) {
      const id = S.addShape(doc, s2, shape, f)
      if (shape === 'rect') fill(S.element(doc, s2, id), { type: 'doc', content: [p([t('Box text')])] })
      if (shape === 'rect') S.setLink(doc, s2, id, 'https://example.com/box')
      if (shape === 'roundRect') S.setStyle(doc, s2, id, { fill: '#fef08a', line: '#2f7d8c', lineW: 8, radius: 0.25 })
      if (shape === 'line') S.setStyle(doc, s2, id, { lineW: 8 })
    }
    S.setLink(doc, s2, S.addPicture(doc, s2, { ref: PIC_REF, hash: 'h', mime: 'image/png', w: 320, h: 160, alt: 'Green box' }, { x: 100, y: 640, w: 400, h: 200, rot: 0 }), 'https://example.com/pic')

    const s3 = S.addSlide(doc, { after: s2, layout: 'blank' })
    const see = S.addShape(doc, s3, 'rect', { x: 80, y: 80, w: 300, h: 200, rot: 0 })
    S.setStyle(doc, s3, see, { fill: '#d32f2f', line: '#1976d2', lineW: 8 })
    S.setOpacity(doc, s3, see, { fill: 0.5, line: 0.75 })
    const bottom = S.addText(doc, s3, { x: 450, y: 80, w: 600, h: 500, rot: 0 })
    fill(S.element(doc, s3, bottom), { type: 'doc', content: [p([t('Bottom words')])] })
    S.setAnchor(doc, s3, bottom, 'bottom')
    const unwrapped = S.addText(doc, s3, { x: 80, y: 640, w: 160, h: 80, rot: 0 })
    fill(S.element(doc, s3, unwrapped), { type: 'doc', content: [p([t('One long line that never wraps')])] })
    S.setWrap(doc, s3, unwrapped, false)
    const cropped = S.addPicture(doc, s3, { ref: PIC_REF, hash: 'h', mime: 'image/png', w: 320, h: 160, alt: 'Cropped box' }, { x: 1150, y: 80, w: 200, h: 200, rot: 0 })
    S.setCrop(doc, s3, cropped, { l: 0.25, t: 0, r: 0.25, b: 0 })
    const arrow = S.addShape(doc, s3, 'line', { x: 1150, y: 360, w: 500, h: 40, rot: 0 })
    S.setStyle(doc, s3, arrow, { lineW: 6 })
    S.setArrows(doc, s3, arrow, { head: 'arrow', tail: 'arrow' })
    S.addShape(doc, s3, 'custom', { x: 1150, y: 560, w: 300, h: 300, rot: 0 }, { path: 'M500 0L1000 1000L0 1000Z' })
    const curve = S.addShape(doc, s3, 'custom', { x: 1500, y: 560, w: 300, h: 300, rot: 0 }, { path: 'M0 1000C0 0 1000 0 1000 1000Z' })
    fill(S.element(doc, s3, curve), { type: 'doc', content: [p([t('Curved')])] })

    const s4 = S.addSlide(doc, { after: s3, layout: 'blank' })
    S.addChart(doc, s4, { chart: { type: 'column', title: 'Sales by region', stacked: true, legend: 'right' }, data: { categories: ['North', 'South', 'East'], series: [{ name: 'Apples', values: [42, 17, 23] }, { name: 'Pears', values: [11, 29, null] }] } }, { x: 60, y: 60, w: 880, h: 460, rot: 0 })
    S.addChart(doc, s4, { chart: { type: 'line', title: 'Visits' }, data: { categories: ['Mon', 'Tue', 'Wed', 'Thu'], series: [{ name: 'Web', values: [5, 6, 7, 8] }, { name: 'App', values: [2, 3, 4, 5] }] } }, { x: 980, y: 60, w: 880, h: 460, rot: 0 })
    S.addChart(doc, s4, { chart: { type: 'pie', title: 'Share of time', dataLabels: true }, data: { categories: ['Work', 'Play', 'Sleep'], series: [{ name: 'Hours', values: [8, 6, 10] }] } }, { x: 60, y: 560, w: 880, h: 460, rot: 0 })
    S.addChart(doc, s4, { chart: { type: 'bar', title: 'Bars', legend: 'none' }, data: { categories: ['A', 'B'], series: [{ name: 'N', values: [3, 4] }] } }, { x: 980, y: 560, w: 880, h: 460, rot: 0 })

    const gone = S.addSlide(doc, { after: s4, layout: 'blank' })
    const g = S.addText(doc, gone)
    fill(S.element(doc, gone, g), { type: 'doc', content: [p([t('Deleted slide')])] })
    S.deleteSlide(doc, gone)
  })
  return doc
}

// Each slide's elements as comparable facts, keyed by what they show.
function summary (m, doc) {
  const S = m.slidesModel
  const theme = m.themeFor(S.theme(doc))
  const slot = (c) => (c === 'none' || !c ? 'none' : c === 'text' ? theme.text : c === 'background' ? theme.background : /^accent[1-6]$/.test(c) ? theme.accents[Number(c.slice(6)) - 1] : c).toLowerCase()
  return S.slides(doc).map((s) => {
    const out = {}
    for (const e of S.elements(doc, s.id)) {
      const type = e.map.get('type')
      const f = S.frame(e.map)
      const text = e.map.get('text') && e.map.get('text').toArray ? S.plainOf(e.map.get('text')).trim() : ''
      let key
      const facts = { type, frame: f }
      if (type === 'shape') {
        const st = S.style(e.map)
        const tl = S.textLayout(e.map)
        // A custom shape drawn as a triangle may come back as one.
        if (st.shape === 'custom' && /^M\s*500\s+0\s*L\s*1000\s+1000\s*L\s*0\s+1000\s*Z$/i.test(String(st.path).trim())) st.shape = 'triangle'
        key = 'shape:' + st.shape + ':' + (text || Math.round(f.x / 50))
        Object.assign(facts, { shape: st.shape, fill: slot(st.fill), line: st.lineW ? slot(st.line) : 'none', lineW: st.lineW, fillOpacity: st.fillOpacity, lineOpacity: st.lineOpacity, head: st.head, tail: st.tail, anchor: tl.anchor, text })
        if (st.shape === 'roundRect') facts.radius = st.radius
      } else if (type === 'picture') {
        key = 'picture:' + e.map.get('alt')
        facts.crop = S.crop(e.map)
      } else if (type === 'chart') {
        const c = S.chartOf(e.map)
        key = 'chart:' + c.chart.title
        // No legend set means one at the bottom for several series or a pie.
        const legend = c.chart.legend || (c.data.series.length > 1 || c.chart.type === 'pie' || c.chart.type === 'doughnut' ? 'bottom' : 'none')
        facts.chart = { type: c.chart.type, stacked: !!c.chart.stacked, legend, dataLabels: !!c.chart.dataLabels, categories: c.data.categories.map(String).join(','), series: c.data.series.map((x) => x.name + '=' + x.values.join(',')).join('|') }
      } else {
        const tl = S.textLayout(e.map)
        if (!text) continue
        key = 'text:' + text.split('\n')[0]
        Object.assign(facts, { text, anchor: tl.anchor, wrap: tl.wrap, role: e.map.get('role') || null })
      }
      out[key] = facts
    }
    const notes = s.map.get('notes')
    return { layout: s.map.get('layout'), els: out, notes: notes && notes.toArray ? S.plainOf(notes).trim() : '' }
  })
}

const near = (a, b, span) => Math.abs(a - b) <= span * 0.02

// Every element of `want` in `got`, in place, with its look.
function sameDeck (want, got, { exactText = true, label = '', loose = false } = {}) {
  assert.equal(got.length, want.length, label + ' slides')
  want.forEach((ws, i) => {
    const gs = got[i]
    for (const [key, w] of Object.entries(ws.els)) {
      const g = gs.els[key]
      assert.ok(g, label + ' slide ' + (i + 1) + ' has ' + key + ' (has ' + Object.keys(gs.els).join(', ') + ')')
      const where = label + ' slide ' + (i + 1) + ' ' + key
      // LibreOffice fits a custom shape's box to its curves (which stay where
      // they were): only our own reader keeps the box as drawn.
      const fitted = loose && /^shape:custom:/.test(key)
      if (!fitted) for (const k of ['x', 'y', 'w', 'h']) assert.ok(near(g.frame[k], w.frame[k], 1920), where + ' ' + k + ' ' + g.frame[k] + ' vs ' + w.frame[k])
      const dr = Math.abs(((g.frame.rot - w.frame.rot) % 360 + 540) % 360 - 180)
      assert.ok(dr < 1, where + ' rot ' + g.frame.rot + ' vs ' + w.frame.rot)
      // LibreOffice 26.8 saves shape colours to .pptx as its own theme's accent
      // 1, whatever colour the shape had: #18a303 for a fill, 75% of it
      // (#127a02) for a line. Its bug, not ours.
      const loTheme = { fill: '#18a303', line: '#127a02' }
      for (const k of ['shape', 'fill', 'line', 'head', 'tail', 'chart']) if (k in w && !(loose && loTheme[k] && g[k] === loTheme[k])) assert.deepEqual(g[k], w[k], where + ' ' + k)
      if ('lineW' in w) assert.ok(Math.abs(g.lineW - w.lineW) <= 1, where + ' lineW ' + g.lineW + ' vs ' + w.lineW)
      for (const k of ['fillOpacity', 'lineOpacity']) if (k in w) assert.ok(Math.abs(g[k] - w[k]) < 0.02, where + ' ' + k)
      if ('radius' in w) assert.ok(Math.abs(g.radius - w.radius) < 0.02, where + ' radius ' + g.radius)
      if ('crop' in w) for (const k of ['l', 't', 'r', 'b']) assert.ok(Math.abs(g.crop[k] - w.crop[k]) < 0.02, where + ' crop ' + k)
      if (w.type === 'text' && w.anchor !== 'middle') assert.equal(g.anchor, w.anchor, where + ' anchor')
      if (w.type === 'text' && w.wrap === false) assert.equal(g.wrap, false, where + ' wrap')
      if ('text' in w && exactText) assert.equal(g.text, w.text, where + ' text')
    }
    assert.equal(gs.notes, ws.notes, label + ' slide ' + (i + 1) + ' notes')
  })
}

async function readBack (m, bytes, reader) {
  const parsed = await reader(new Uint8Array(bytes))
  const ready = new Map()
  for (const [p, mime] of parsed.media) {
    const b = Buffer.from(await parsed.readMedia(p))
    ready.set(p, { bytes: new Uint8Array(b), mime, w: b.readUInt32BE(16), h: b.readUInt32BE(20) })
  }
  const built = m.buildDeck(parsed, { Y: m.Y, pictures: ready, title: 'Back' })
  const doc = new m.Y.Doc()
  m.Y.applyUpdate(doc, built.update)
  return { doc, built }
}

const pictures = () => new Map([[PIC_REF, { bytes: new Uint8Array(PIC), mime: 'image/png' }]])

test('a deck goes out to .odp and comes back', async () => {
  const m = await load()
  const doc = makeDeck(m)
  const bytes = m.deckToOdp(doc, { title: 'ODP check', pictures: pictures() })
  const { doc: back, built } = await readBack(m, bytes, m.readOdp)
  sameDeck(summary(m, doc), summary(m, back), { label: 'ours' })
  assert.equal(built.theme, 'paper')
  assert.deepEqual(m.slidesModel.slides(back).map((s) => s.map.get('layout')), ['title', 'blank', 'blank', 'blank'])
})

// Links on pictures and shapes (proposals/2026-10-26-picture-links.md).
test('links on a picture and a shape go out to .odp and .pptx and come back', async () => {
  const m = await load()
  const S = m.slidesModel
  const doc = new m.Y.Doc()
  doc.transact(() => {
    const s1 = S.initDeck(doc, { title: 'Links' })
    const pic = S.addPicture(doc, s1, { ref: PIC_REF, hash: 'h', mime: 'image/png', w: 320, h: 160, alt: 'Green box' }, { x: 100, y: 600, w: 400, h: 200, rot: 0 })
    const rect = S.addShape(doc, s1, 'rect', { x: 600, y: 600, w: 300, h: 200, rot: 0 })
    m.prosemirrorJSONToYXmlFragment(m.slideSchema(), { type: 'doc', content: [p([t('Open the folder')])] }, S.element(doc, s1, rect).get('text'))
    S.addShape(doc, s1, 'ellipse', { x: 1000, y: 600, w: 300, h: 200, rot: 0 })
    assert.equal(S.setLink(doc, s1, pic, 'https://example.com/pic'), true)
    assert.equal(S.setLink(doc, s1, rect, 'pearoffice://folder/abc123'), true)
    assert.equal(S.setLink(doc, s1, rect, 'javascript:alert(1)'), false)
  })
  const links = (d) => S.elements(d, S.slideIds(d)[0]).filter((e) => e.map.get('type') !== 'text').map((e) => e.map.get('type') + ' ' + (S.linkOf(e.map) || '-'))
  const want = ['picture https://example.com/pic', 'shape pearoffice://folder/abc123', 'shape -']
  assert.deepEqual(links(doc), want)
  assert.deepEqual(links((await readBack(m, m.deckToOdp(doc, { title: 'Links', pictures: pictures() }), m.readOdp)).doc), want)
  assert.deepEqual(links((await readBack(m, await m.deckToPptx(doc, { title: 'Links', pictures: pictures() }), m.readPresentation)).doc), want)
})

test('LibreOffice reads our .odp, and we read the .odp it makes', { skip: !soffice && 'needs soffice' }, async () => {
  const m = await load()
  const doc = makeDeck(m)
  const want = summary(m, doc)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pearoffice-odp-'))
  const lo = (file, to, out) => execFileSync('soffice', ['--headless', '-env:UserInstallation=file://' + path.join(dir, 'profile'), '--convert-to', to, '--outdir', out, file], { stdio: 'ignore', timeout: 180000 })
  try {
    // Ours, opened and saved as .pptx by LibreOffice, read with our .pptx reader.
    const odp = path.join(dir, 'deck.odp')
    fs.writeFileSync(odp, m.deckToOdp(doc, { title: 'ODP check', pictures: pictures() }))
    lo(odp, 'pptx', path.join(dir, 'lo'))
    const viaLo = await readBack(m, fs.readFileSync(path.join(dir, 'lo', 'deck.pptx')), m.readPresentation)
    sameDeck(want, summary(m, viaLo.doc), { label: 'LibreOffice from our .odp', loose: true })
    // Our .pptx, saved as .odp by LibreOffice, read with our .odp reader.
    const pptx = path.join(dir, 'deck2.pptx')
    fs.writeFileSync(pptx, await m.deckToPptx(doc, { title: 'ODP check', pictures: pictures() }))
    lo(pptx, 'odp', path.join(dir, 'lo'))
    const fromLo = await readBack(m, fs.readFileSync(path.join(dir, 'lo', 'deck2.odp')), m.readOdp)
    sameDeck(want, summary(m, fromLo.doc), { label: 'our reader on LibreOffice\'s .odp', loose: true })
  } finally {
    // PEAROFFICE_ODP_KEEP=<folder> keeps the files for a look.
    if (process.env.PEAROFFICE_ODP_KEEP) fs.cpSync(dir, process.env.PEAROFFICE_ODP_KEEP, { recursive: true, filter: (f) => !f.includes('profile') })
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
