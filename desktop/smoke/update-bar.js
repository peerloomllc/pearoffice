// Smoke test part "update-bar" (extra, not in the default parts): the update
// bar shows as soon as the first check finds a release, not at the bar's next
// 10-minute poll. Needs a fake release and a short first delay:
//   node scripts/serve-local-release.js 9.9.9 <empty folder> 8798
//   PEAROFFICE_UPDATE_LATEST_URL=http://127.0.0.1:8798/latest PEAROFFICE_UPDATE_DELAY_MS=3000 node desktop/smoke.js --part update-bar

module.exports = async function updateBar (t) {
  const { waitFor, js, result } = t
  await waitFor('update bar', '/Update now/.test(document.body.innerText)', 20000)
  result.text = await js("(document.body.innerText.match(/.*9\\.9\\.9.*/) || [''])[0]")
  return true
}
