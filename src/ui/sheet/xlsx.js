// .xlsx import and export in the UI, with SheetJS (Community Edition, mini
// build, vendored in vendor/). The conversion itself is in src/sheet/xlsxMap.js.
// On phones the shell does the file handling (share sheet, file picker).
import * as XLSX from 'xlsx/dist/xlsx.mini.min.js'
import * as fflate from 'fflate'
import { workbookToTabs, workbookBytes, odsBytes, fromFile, freezeFromXlsx, validationsFromXlsx, condFormatsFromXlsx, READ_OPTIONS, MAX_IMPORT_CELLS } from '../../sheet/xlsxMap.js'
import { stylesFromXlsx } from '../../sheet/xlsxStyles.js'
import { fixOdsWorkbook } from '../../sheet/odsFormula.js'
import { chartsFromOdsBytes } from '../../sheet/odsCharts.js'
import { stylesFromOdsBytes } from '../../sheet/odsStyles.js'
import { rulesFromOdsBytes } from '../../sheet/odsRules.js'
import { chartsFromXlsx } from '../../sheet/xlsxChartsRead.js'
import { jsonFileToTabs } from '../../sheet/jsonImport.js'
import { csvBytesToTabs } from '../../sheet/csvImport.js'
import { sheetToJson } from '../../sheet/jsonExport.js'
import { isMediaFile, importMedia } from '../media/mediaFiles.js'
import { call } from '../bridge.js'
import { writePref } from '../prefs.js'
import { isMobile, fileName, saveFile } from '../save.js'
import { isDocFile, importDocument } from '../doc/docFiles.js'
import { isPptxFile, importPresentation } from '../slides/pptxImport.js'
import { isOdpFile, readOdp } from '../slides/odp.js'
import { checkZip } from '../slides/importOoxml.js'
import { borderCss, fontPx, FONTS, BASE_FONT_PX } from './cellStyle.js'
import { linkOf } from './links.jsx'
import { chipsOf, ruleFor, CHIP_COLORS } from '../../sheet/validation.js'

// The printed page draws the default text at 11px.
const PRINT = 11 / BASE_FONT_PX

const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
export { isMobile }

// ods: a .ods file's charts and looks per tab (its bytes are not an .xlsx).
function importWorkbook (wb, name, bytes, ods) {
  const { tabs, names } = workbookToTabs(XLSX, wb)
  if (ods) {
    ods.charts.forEach((v, i) => { if (tabs[i] && v.length) tabs[i].charts = v })
    ods.looks.forEach((x, i) => {
      if (!tabs[i] || !x) return
      tabs[i].styles = x.styles
      tabs[i].heights = x.heights
      tabs[i].widths = { ...tabs[i].widths, ...x.widths }
      tabs[i].hidden = x.hidden
      if (x.freeze) tabs[i].freeze = x.freeze
    })
    ods.rules.forEach((x, i) => {
      if (!tabs[i] || !x) return
      if (x.condFormats.length) tabs[i].condFormats = x.condFormats.map((r) => (r.formula ? { ...r, formula: fromFile(r.formula) } : r))
      if (x.validations.length) tabs[i].validations = x.validations
    })
  }
  // Frozen panes come from the raw file (SheetJS does not report them).
  if (bytes) freezeFromXlsx(bytes, fflate).forEach((f, i) => { if (f && tabs[i]) tabs[i].freeze = f })
  // So are cell styles and row heights.
  if (bytes) stylesFromXlsx(bytes, fflate, MAX_IMPORT_CELLS).forEach((x, i) => { if (tabs[i]) { tabs[i].styles = x.styles; tabs[i].heights = x.heights } })
  if (bytes) validationsFromXlsx(bytes, fflate).forEach((v, i) => { if (tabs[i] && v.length) tabs[i].validations = v })
  if (bytes) condFormatsFromXlsx(bytes, fflate).forEach((v, i) => { if (tabs[i] && v.length) tabs[i].condFormats = v })
  if (bytes) chartsFromXlsx(bytes, fflate, wb.SheetNames).forEach((v, i) => { if (tabs[i] && v.length) tabs[i].charts = v })
  const title = String(name || '').replace(/\.[^.]+$/, '') || 'Imported sheet'
  return call('sheet:import', { title, tabs, names }).then(async (r) => {
    // A filter in the file becomes this device's filter, with nothing hidden
    // (proposals/2026-10-04-freeze-filter.md).
    const ranges = wb.SheetNames.map((n) => { const f = wb.Sheets[n]['!autofilter']; return f && f.ref ? XLSX.utils.decode_range(f.ref) : null })
    if (r && r.sheetId && ranges.some(Boolean)) {
      try {
        const v = await call('sheet:view', { sheetId: r.sheetId })
        ranges.forEach((box, i) => {
          if (box && v.tabs[i]) writePref('pearoffice:filter:' + r.sheetId + ':' + v.tabs[i].id, JSON.stringify({ r1: box.s.r + 1, c1: box.s.c + 1, c2: box.e.c + 1, cols: {} }))
        })
      } catch {}
    }
    return r
  })
}

// A .json file becomes one tab per list of records plus a Summary tab
// (src/sheet/jsonImport.js).
// CSV and tab-separated files have their own reader (src/sheet/csvImport.js):
// UTF-8, leading zeros kept, dates shown as dates.
const isJson = (name) => /\.json$/i.test(String(name || ''))
const isCsv = (name) => /\.(csv|tsv)$/i.test(String(name || ''))
function importText (bytes, name) {
  const { tabs, names } = isJson(name) ? jsonFileToTabs(new TextDecoder().decode(bytes)) : csvBytesToTabs(bytes)
  const title = String(name || '').replace(/\.[^.]+$/, '') || 'Imported sheet'
  return call('sheet:import', { title, tabs, names })
}

// Desktop: a File from an <input type=file>. Word, Markdown, text and HTML
// files become documents (src/ui/doc/docFiles.js), PowerPoint files slide
// decks (src/ui/slides/pptxImport.js), the rest sheets.
export async function importFile (file) {
  const data = new Uint8Array(await file.arrayBuffer())
  if (isMediaFile(file.name)) return importMedia(data, file.name)
  if (isPptxFile(file.name)) return importPresentation(data, file.name)
  if (isOdpFile(file.name)) return importPresentation(data, file.name, { read: readOdp })
  if (isDocFile(file.name)) return importDocument(data, file.name)
  if (isJson(file.name) || isCsv(file.name)) return importText(data, file.name)
  return readWorkbook(data, file.name)
}

// Phones: the shell's file picker, or with `photo` the photo picker.
// Resolves to null if cancelled.
export async function pickAndImport ({ photo = false } = {}) {
  const picked = await call('app:pickFile', photo ? { images: true, source: 'photos' } : {})
  if (!picked || picked.canceled) return null
  // Android's photo picker gives a number for a name (30 or 30.jpg): call
  // it Photo and the day, with the extension from its type.
  if (photo && (!isMediaFile(picked.name) || /^\d*(\.[a-z0-9]+)?$/i.test(String(picked.name || '')))) {
    const d = new Date()
    const day = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
    picked.name = 'Photo ' + day + '.' + ({ 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic' }[picked.mime] || 'jpg')
  }
  return importPicked(picked)
}

// A file from the shell as { name, base64 }: picked, or handed over by
// another app ("Open with" on Android, mobile/App.js app:takeFile).
export async function importPicked (picked) {
  const bytes = Uint8Array.from(atob(picked.base64), (ch) => ch.charCodeAt(0))
  if (isMediaFile(picked.name)) return importMedia(bytes, picked.name)
  if (isPptxFile(picked.name)) return importPresentation(bytes, picked.name)
  if (isOdpFile(picked.name)) return importPresentation(bytes, picked.name, { read: readOdp })
  if (isDocFile(picked.name)) return importDocument(bytes, picked.name)
  if (isJson(picked.name) || isCsv(picked.name)) return importText(bytes, picked.name)
  return readWorkbook(bytes, picked.name)
}

// A spreadsheet file. A zip (.xlsx, .ods) is checked for size first; an
// older .xls is not a zip. A .ods file's formulas and tab names are read by
// src/sheet/odsFormula.js; the .xlsx-only parts (styles, frozen panes, rules,
// charts) are not looked for in it.
async function readWorkbook (bytes, name) {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) await checkZip(bytes, 'This is not a spreadsheet PearOffice can read.')
  const wb = XLSX.read(bytes, { type: 'array', ...READ_OPTIONS })
  if (isOds(name)) {
    fixOdsWorkbook(XLSX, fflate, wb, bytes)
    const rules = rulesFromOdsBytes(bytes, fflate, wb.SheetNames)
    // A filter in the file becomes this device's filter, as from .xlsx.
    rules.forEach((x, i) => { if (x && x.filter) wb.Sheets[wb.SheetNames[i]]['!autofilter'] = { ref: x.filter } })
    return importWorkbook(wb, name, null, { charts: chartsFromOdsBytes(bytes, fflate, wb.SheetNames), looks: stylesFromOdsBytes(bytes, fflate, wb.SheetNames), rules })
  }
  return importWorkbook(wb, name, bytes)
}
const isOds = (name) => /\.ods$/i.test(String(name || ''))

export async function exportSheet (sheetId) {
  const dump = await call('sheet:dump', { sheetId })
  const bytes = workbookBytes(XLSX, fflate, dump)
  return saveFile(fileName(dump.title) + '.xlsx', MIME, bytes)
}

// For LibreOffice and OpenOffice: values, formulas, tabs, charts, cell
// looks, widths, heights, hidden rows and columns, frozen panes, colour rules
// and validation.
export async function exportOds (sheetId) {
  const dump = await call('sheet:dump', { sheetId })
  return saveFile(fileName(dump.title) + '.ods', 'application/vnd.oasis.opendocument.spreadsheet', odsBytes(XLSX, fflate, dump))
}

// --- one tab as .csv, and as a printable page (PDF, print) -------------------

// The used part of a tab: up to the last row and column with something shown.
function usedBlock (view) {
  let rows = 0
  let cols = 0
  for (const c of view.cells) if (c.display !== '') { rows = Math.max(rows, c.row); cols = Math.max(cols, c.col) }
  const at = new Map(view.cells.map((c) => [c.row + ',' + c.col, c]))
  return { rows, cols, at }
}

// What the cells show, comma-separated, with a byte order mark so Excel
// reads it as UTF-8.
export function tabCsv (view) {
  const { rows, cols, at } = usedBlock(view)
  const quote = (s) => (/[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s)
  const lines = []
  for (let r = 1; r <= rows; r++) {
    const line = []
    for (let c = 1; c <= cols; c++) { const x = at.get(r + ',' + c); line.push(quote(x ? x.display : '')) }
    lines.push(line.join(','))
  }
  return '\ufeff' + lines.join('\r\n') + '\r\n'
}

export async function exportCsv (view) {
  const tab = (view.tabs.find((t) => t.id === view.tabId) || {}).name
  return saveFile(fileName(view.title + (view.tabs.length > 1 ? ' - ' + tab : '')) + '.csv', 'text/csv', tabCsv(view))
}

// The whole sheet as JSON, values only (src/sheet/jsonExport.js).
export async function exportJson (sheetId) {
  const dump = await call('sheet:dump', { sheetId })
  return saveFile(fileName(dump.title) + '.json', 'application/json', JSON.stringify(sheetToJson(dump), null, 2) + '\n')
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// A tab as a printable HTML page: the used block with widths, bold, italic
// and colours.
export function tabHtml (view, chartSvgs = []) {
  const { rows, cols, at } = usedBlock(view)
  const tab = (view.tabs.find((t) => t.id === view.tabId) || {}).name
  const width = (c) => (view.widths && view.widths[c]) || 100
  // Merged cells: one table cell spanning the block; the cells it covers are left out.
  const spans = new Map()
  const covered = new Set()
  for (const m of view.merges || []) {
    spans.set(m.r1 + ',' + m.c1, m)
    for (let r = m.r1; r <= m.r2; r++) for (let c = m.c1; c <= m.c2; c++) if (r !== m.r1 || c !== m.c1) covered.add(r + ',' + c)
  }
  let body = ''
  for (let r = 1; r <= rows; r++) {
    const rh = view.heights && view.heights[r]
    body += rh ? '<tr style="height:' + Math.round(rh * PRINT) + 'px">' : '<tr>'
    for (let c = 1; c <= cols; c++) {
      if (covered.has(r + ',' + c)) continue
      const x = at.get(r + ',' + c)
      const f = (x && x.fmt) || {}
      const m = spans.get(r + ',' + c)
      const style = [
        f.align ? 'text-align:' + f.align : x && (x.kind === 'number' || x.kind === 'bool') ? 'text-align:right' : '',
        'vertical-align:' + (f.valign || 'bottom'),
        f.wrap ? 'white-space:pre-wrap' : '',
        f.size ? 'font-size:' + Math.round(fontPx(f) * PRINT * 10) / 10 + 'px' : '',
        f.font ? 'font-family:' + FONTS[f.font].replace(/"/g, "'") : '',
        f.u || f.s ? 'text-decoration:' + [f.u && 'underline', f.s && 'line-through'].filter(Boolean).join(' ') : '',
        f.b ? 'font-weight:bold' : '',
        f.i ? 'font-style:italic' : '',
        f.color ? 'color:' + f.color : '',
        f.fill ? 'background:' + f.fill : '',
        f.bt ? 'border-top:' + borderCss(f.bt) : '',
        f.br ? 'border-right:' + borderCss(f.br) : '',
        f.bb ? 'border-bottom:' + borderCss(f.bb) : '',
        f.bl ? 'border-left:' + borderCss(f.bl) : ''
      ].filter(Boolean).join(';')
      const spanAttrs = m ? (m.c2 > m.c1 ? ' colspan="' + (Math.min(m.c2, cols) - m.c1 + 1) + '"' : '') + (m.r2 > m.r1 ? ' rowspan="' + (Math.min(m.r2, rows) - m.r1 + 1) + '"' : '') : ''
      // A web or email link stays clickable in the PDF.
      const link = linkOf(x)
      // A chip (proposals/2026-10-22-dropdown-chips.md) prints as its pill.
      const chips = chipsOf(ruleFor(view.validations || [], r, c), x)
      // @ chips print as a grey pill with their text.
      const smart = !chips && x && x.display !== '' && x.fmt && (x.fmt.person || x.fmt.datechip || /^pearoffice:\/\//.test(x.fmt.link || ''))
      const text = smart ? '<span style="background:#e8eaed;color:#3c4043;border-radius:999px;padding:0 6px">' + esc(x.display) + '</span>' : chips ? chips.map((p) => '<span style="background:' + CHIP_COLORS[p.color][0] + ';color:' + CHIP_COLORS[p.color][1] + ';border-radius:999px;padding:0 6px;margin-right:2px">' + esc(p.text) + '</span>').join('') : esc(x ? x.display : '')
      body += '<td' + spanAttrs + (style ? ' style="' + style + '"' : '') + '>' + (link && link.url ? '<a href="' + esc(link.url).replace(/"/g, '&quot;') + '">' + text + '</a>' : text) + '</td>'
    }
    body += '</tr>'
  }
  const colgroup = Array.from({ length: cols }, (_, i) => '<col style="width:' + width(i + 1) + 'px">').join('')
  return '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(view.title) + '</title><style>' +
    'body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:11px;margin:0}' +
    'h1{font-size:14px;margin:0 0 8px}table{border-collapse:collapse;table-layout:fixed}' +
    'td{border:1px solid #ccc;padding:2px 4px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}td a{color:#44702a}' +
    '.chart{margin-top:16px;break-inside:avoid;page-break-inside:avoid}.chart svg{max-width:100%;height:auto}' +
    '</style></head><body><h1>' + esc(view.title) + (view.tabs.length > 1 ? ' - ' + esc(tab) : '') + '</h1>' +
    '<table><colgroup>' + colgroup + '</colgroup>' + body + '</table>' +
    chartSvgs.map((svg) => '<div class="chart">' + svg + '</div>').join('') + '</body></html>'
}

// Save the tab as a PDF, or open the print dialog (desktop only).
export function printTab (view, how, chartSvgs = []) {
  const tab = (view.tabs.find((t) => t.id === view.tabId) || {}).name
  const name = fileName(view.title + (view.tabs.length > 1 ? ' - ' + tab : '')) + '.pdf'
  return call(how === 'pdf' ? 'app:savePdf' : 'app:print', { html: tabHtml(view, chartSvgs), name })
}
