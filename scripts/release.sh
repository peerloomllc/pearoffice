#!/usr/bin/env bash
# Local release script (app-specific config in scripts/app.conf)
# Usage: ./scripts/release.sh [vX.Y.Z] [--retag] [--check-versions]
#
# Canonical shape: /home/tim/peerloomllc/RELEASE-PIPELINE.md, enforced by
# ./check-release-pipeline.sh pearoffice. Step numbers are the contract: a
# capability PearOffice does not have leaves its number UNUSED rather than
# renumbering what follows. PearOffice has no step 4 (the Android build names
# its files inline in step 3) and no 5b2 (one desktop/ project builds every
# desktop target in step 5b).
#
# Every platform in one run: Android (APK and app bundle), iOS, the desktop
# app for Mac (Apple silicon and Intel, signed and notarized), Linux and
# Windows. The PearOffice seeder is now PeerLoom Seeder, which has its own
# release.sh (peerloom-seeder/), so PearOffice has no seeder steps (5c, 5d,
# 7b, 13c; DECISIONS.md 2026-10-14).
# The downloads go on this repo's releases (RELEASES_REPO).
#
# Flags:
#   vX.Y.Z             Override the auto-detected version
#   --retag            Delete and recreate a stranded local tag from a failed run
#   --check-versions   Query every published channel and exit (no build)
#   --skip-github      Skip the GitHub release
#   --skip-zapstore    Skip Zapstore publish
#   --skip-play        Skip Google Play upload even if credentials are configured
#   --skip-appstore    Skip iOS App Store build (alias: --skip-ios)
#   --skip-nostr       Skip Nostr announcement even if selected
#   --skip-desktop     Skip building all desktop installers
#   --skip-linux       Skip Linux desktop build (.AppImage + .deb)
#   --skip-windows     Skip Windows desktop build (.exe)
#   --skip-macos       Skip macOS desktop builds (.dmg + .zip, both chips)
#   --skip-android     Skip Android APK/AAB build (auto-disables Play + Zapstore;
#                      the GitHub release re-attaches the previous APK)
#   --skip-mobile      Skip both Android and iOS builds (shorthand)
#
# Required env vars (or set in scripts/.env):
#   KEYSTORE_PASSWORD            - release keystore password
#   KEY_PASSWORD                 - release key password
#   KEYSTORE_FILE                - path to the keystore
#   KEY_ALIAS                    - key alias (pearoffice)
#   SIGN_WITH                    - Zapstore NSEC for signing
#
# Optional env vars:
#   GITHUB_TOKEN                 - GitHub PAT (falls back to gh auth token)
#   GITHUB_REMOTE                - git remote name (default: github, then origin)
#   PLAY_SERVICE_ACCOUNT_JSON    - path to GCP service account JSON for Play upload
#   PLAY_TRACK                   - Play track: internal / alpha / beta / production
#                                  (default: alpha, the closed test)
#   PLAY_QUOTA_PROJECT           - GCP project ID for Play API quota when using ADC
#   ASC_KEY_ID                   - App Store Connect API key ID
#   ASC_ISSUER_ID                - App Store Connect API issuer ID
#   ASC_PRIVATE_KEY_PATH         - Path to .p8 private key file
#   WINDOWS_VM_HOST              - ssh target of the win11-pearguard VM
#   NOSTR_NOTE_BUDGET            - characters of notes in the Nostr note (900)
#
# Needs: gh, asc and the Mac Mini.

set -euo pipefail

# Abort cleanly on Ctrl-C. Several best-effort build steps run as the
# condition of an `if` (so a failed build never blocks the release), which
# also means a SIGINT during one of them is otherwise swallowed and the
# script marches on past the interrupted build.
trap 'echo; echo "Interrupted (SIGINT) - aborting release."; exit 130' INT

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Shared release helpers, one copy for every PeerLoom app, in the sibling repo
# peerloomllc/peerloom-release (proposals/2026-09-17-shared-release-library.md).
RELEASE_LIB="$REPO_ROOT/../peerloom-release/release-lib.sh"
if [ ! -f "$RELEASE_LIB" ]; then
  echo "error: $RELEASE_LIB not found - clone peerloomllc/peerloom-release beside this repo" >&2
  exit 1
fi
# shellcheck source=/dev/null
source "$RELEASE_LIB"

# Pin JDK 21 for the Android build, as the other apps do. RN's Gradle plugin
# does not support JDK 25 (Fedora 44's default). Export JAVA_HOME to override.
if [ -z "${JAVA_HOME:-}" ] && [ -x "$HOME/.jdks/jdk-21.0.11+10/bin/java" ]; then
  export JAVA_HOME="$HOME/.jdks/jdk-21.0.11+10"
  export PATH="$JAVA_HOME/bin:$PATH"
fi

# Load app config and env
if [ -f "$SCRIPT_DIR/app.conf" ]; then
  set -a; source "$SCRIPT_DIR/app.conf"; set +a
fi
if [ -f "$SCRIPT_DIR/.env" ]; then
  set -a; source "$SCRIPT_DIR/.env"; set +a
fi

# Required app.conf keys, checked once, up front. No hard-coded defaults: a
# copied default is how PearGuard once announced itself as PearCal.
for _k in APP_NAME ARTIFACT_PREFIX BUNDLE_ID RELEASES_REPO ASC_APP_ID; do
  if [ -z "${!_k:-}" ]; then
    echo "error: $_k is not set — check $SCRIPT_DIR/app.conf" >&2
    exit 1
  fi
done

# ---------------------------------------------------------------------------
# Helper: stop the background Mac build (step 5b) if the run ends early.
# ---------------------------------------------------------------------------
_on_exit() {
  if [ -n "${_MAC_PID:-}" ] && kill -0 "$_MAC_PID" 2>/dev/null; then _kill_tree "$_MAC_PID"; fi
  return 0
}
_kill_tree() {
  local _c
  for _c in $(pgrep -P "$1" 2>/dev/null); do _kill_tree "$_c"; done
  kill "$1" 2>/dev/null || true
}
trap _on_exit EXIT

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
RELEASE_TAG=""
EXPLICIT_TAG=""
RETAG=false
CHECK_VERSIONS_ONLY=false
SKIP_GITHUB=false
SKIP_ZAPSTORE=false
SKIP_PLAY=false
SKIP_IOS=false
SKIP_NOSTR=false
SKIP_DESKTOP=false
SKIP_LINUX=false
SKIP_WINDOWS=false
SKIP_MACOS=false
SKIP_ANDROID=false

for arg in "$@"; do
  case "$arg" in
    --retag) RETAG=true ;;
    --check-versions) CHECK_VERSIONS_ONLY=true ;;
    --skip-github) SKIP_GITHUB=true ;;
    --skip-zapstore) SKIP_ZAPSTORE=true ;;
    --skip-play) SKIP_PLAY=true ;;
    --skip-appstore|--skip-ios) SKIP_IOS=true ;;
    --skip-nostr) SKIP_NOSTR=true ;;
    --skip-desktop) SKIP_DESKTOP=true ;;
    --skip-linux) SKIP_LINUX=true ;;
    --skip-windows) SKIP_WINDOWS=true ;;
    --skip-macos) SKIP_MACOS=true ;;
    --skip-android) SKIP_ANDROID=true ;;
    --skip-mobile) SKIP_ANDROID=true; SKIP_IOS=true ;;
    v[0-9]*.[0-9]*.[0-9]*)
      if [[ ! "$arg" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        echo "Error: tag must be in format vX.Y.Z (got: $arg)"
        exit 1
      fi
      RELEASE_TAG="$arg"
      EXPLICIT_TAG="$arg"
      ;;
    -h|--help) sed -n '2,57p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown argument: $arg (see --help)"; exit 1 ;;
  esac
done

# A real release must run the reviewed, current shared library (release-lib.sh).
if ! $CHECK_VERSIONS_ONLY; then release_lib_require_current; fi

cd "$REPO_ROOT"

# ---------------------------------------------------------------------------
# Determine release tag — entirely local via git tags
# ---------------------------------------------------------------------------
if [ -z "$RELEASE_TAG" ]; then
  LATEST=$(git tag --sort=-version:refname \
    | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1 || echo "")
  if [ -z "$LATEST" ]; then
    LATEST="v$(node -p "require('./package.json').version")"
    echo "==> No prior tags found, counting from package.json ($LATEST)"
  fi
  IFS='.' read -r MAJOR MINOR PATCH <<< "${LATEST#v}"
  RELEASE_TAG="v${MAJOR}.${MINOR}.$((PATCH + 1))"
  echo "==> Auto-detected next version: $RELEASE_TAG  (latest tag was $LATEST)"
fi
APP_VERSION="${RELEASE_TAG#v}"

# ---------------------------------------------------------------------------
# Handle --retag: clean up a stranded local tag from a failed previous run
# ---------------------------------------------------------------------------
if $RETAG; then
  if git tag | grep -q "^${RELEASE_TAG}$"; then
    echo "==> --retag: deleting stranded local tag $RELEASE_TAG..."
    git tag -d "$RELEASE_TAG"
    echo "    Done. Proceeding with fresh run for $RELEASE_TAG."
  else
    echo "==> --retag: local tag $RELEASE_TAG not found, nothing to clean up."
  fi
fi

if ! $CHECK_VERSIONS_ONLY; then
  _confirm "Release tag will be $RELEASE_TAG — proceed with build?"
fi

# ---------------------------------------------------------------------------
# Required credentials (skipped for --check-versions)
# ---------------------------------------------------------------------------
if ! $CHECK_VERSIONS_ONLY; then
  : "${KEYSTORE_PASSWORD:?Set KEYSTORE_PASSWORD or add it to scripts/.env}"
  : "${KEY_PASSWORD:?Set KEY_PASSWORD or add it to scripts/.env}"
  : "${KEYSTORE_FILE:?Set KEYSTORE_FILE or add it to scripts/.env}"
  : "${KEY_ALIAS:?Set KEY_ALIAS or add it to scripts/.env}"
  : "${SIGN_WITH:?Set SIGN_WITH (Zapstore NSEC) or add it to scripts/.env}"
  if [ ! -f "$KEYSTORE_FILE" ]; then
    echo "Error: keystore not found at $KEYSTORE_FILE"
    exit 1
  fi
fi

# ---------------------------------------------------------------------------
# Pre-flight: what each channel has published
#
# Outcomes:
#   ZAPSTORE_ONLY=true   GitHub is ahead — skip build, publish existing release
#   ZAPSTORE_ONLY=false  Versions match (or both unknown) — full build + publish
#   exit 1               GitHub is behind Zapstore — something is wrong
# ---------------------------------------------------------------------------
ZAPSTORE_ONLY=false
REPO_SLUG=$(_remote_slug)
GH_TOKEN=$(_github_token)
ZSP_IDENTIFIER="$BUNDLE_ID"

echo "==> Checking published versions..."
GH_VERSION=$(_github_latest_version "$GH_TOKEN" "$RELEASES_REPO")
ZSP_VERSION_CURRENT=$(_zapstore_latest_version "$ZSP_IDENTIFIER")
PLAY_VERSION_CURRENT=$(_play_latest_version "$ZSP_IDENTIFIER" "${PLAY_SERVICE_ACCOUNT_JSON:-}" "${PLAY_TRACK:-alpha}")
ASC_VERSION_CURRENT=$(_appstore_latest_version)

echo "    GitHub       : ${GH_VERSION:-unknown} ($RELEASES_REPO)"
echo "    Zapstore     : ${ZSP_VERSION_CURRENT:-unknown}"
if _play_configured; then
  echo "    Google Play  : ${PLAY_VERSION_CURRENT:-unknown} (${PLAY_TRACK:-alpha} track)"
else
  echo "    Google Play  : (not configured — uploaded by hand, step 10 prints how)"
fi
echo "    App Store    : ${ASC_VERSION_CURRENT:-unknown}"

if $CHECK_VERSIONS_ONLY; then
  echo ""
  [ -z "$ZSP_VERSION_CURRENT" ] && echo "    Zapstore returned nothing for $ZSP_IDENTIFIER (not listed yet, relay unreachable or websocat missing)."
  exit 0
fi

if [ -n "$EXPLICIT_TAG" ]; then
  if [ "$GH_VERSION" = "$APP_VERSION" ] && [ "$ZSP_VERSION_CURRENT" != "$APP_VERSION" ]; then
    echo ""
    echo "    $RELEASE_TAG exists on GitHub but not on Zapstore — Zapstore can publish it without a fresh build."
    ZAPSTORE_ONLY=true
  elif [ "$GH_VERSION" != "$APP_VERSION" ]; then
    echo ""
    echo "    $RELEASE_TAG does not exist on GitHub yet — a build will be required."
  fi
elif [ -n "$GH_VERSION" ] && [ -n "$ZSP_VERSION_CURRENT" ]; then
  case "$(_ver_cmp "$GH_VERSION" "$ZSP_VERSION_CURRENT")" in
    gt)
      echo ""
      echo "==> GitHub ($GH_VERSION) is ahead of Zapstore ($ZSP_VERSION_CURRENT)."
      echo "    Skipping build — will publish existing GitHub release to Zapstore only."
      RELEASE_TAG="v${GH_VERSION}"
      APP_VERSION="$GH_VERSION"
      ZAPSTORE_ONLY=true
      ;;
    lt)
      echo ""
      echo "ERROR: Zapstore ($ZSP_VERSION_CURRENT) is ahead of GitHub ($GH_VERSION)."
      echo "       This should not happen. Check both platforms before proceeding."
      echo "       To override, pass the version explicitly: ./scripts/release.sh v${ZSP_VERSION_CURRENT}"
      exit 1
      ;;
    eq) echo "    Versions match ($GH_VERSION) — proceeding with full build for next version." ;;
  esac
else
  echo "    Could not determine one or both versions — proceeding with normal flow."
fi
echo ""

# ---------------------------------------------------------------------------
# Destination selection — ask which targets to publish to before any build
# work starts.
# ---------------------------------------------------------------------------
PUBLISH_GITHUB=true
PUBLISH_ZAPSTORE=true
PUBLISH_NOSTR=true
PUBLISH_PLAY=false
PUBLISH_APP_STORE=false
PUBLISH_FAILED=false   # set to true if any selected publish step fails
APP_STORE_DEFERRED=false
NEEDS_BUILD=false
WINDOWS_ON_VM=false
# Artifacts, declared before the build fences (set -u, read later).
APK_NAME=""
APK_SIZE=""
AAB_NAME=""
AAB_SIZE=""
DESKTOP_ARTIFACTS=()
DESKTOP_MISSING=() # desktop builds that failed, shown again before the GitHub upload
_MAC_PID=""

_ask() { # _ask <question> <default y|n> -> 0 for yes
  local _r
  while true; do
    # No answer at all (input closed) stops the release, never a default yes.
    read -rp "    $1 $([ "$2" = y ] && echo '[Y/n]' || echo '[y/N]') " _r || { echo; echo "Aborted."; exit 0; }
    _r="${_r:-$2}"
    case "$_r" in [Yy]) return 0 ;; [Nn]) return 1 ;; *) echo "    Please enter y or n." ;; esac
  done
}

$SKIP_GITHUB && PUBLISH_GITHUB=false
$SKIP_ZAPSTORE && PUBLISH_ZAPSTORE=false
$SKIP_NOSTR && PUBLISH_NOSTR=false
if $SKIP_ANDROID; then PUBLISH_ZAPSTORE=false; fi

echo "==> Select publish destinations for $RELEASE_TAG:"
$ZAPSTORE_ONLY && echo "    (FYI: GitHub release for $RELEASE_TAG already exists -- Zapstore can publish from that without a fresh build.)"
echo ""

if $SKIP_GITHUB; then echo "    - GitHub (skipped via --skip-github)"
elif _ask "Publish to GitHub Releases ($RELEASES_REPO)?" y; then PUBLISH_GITHUB=true; echo "    ✓ GitHub"
else PUBLISH_GITHUB=false; echo "    ✗ GitHub (skipped)"; fi

if $SKIP_ANDROID; then echo "    - Zapstore (skipped via --skip-android)"
elif $SKIP_ZAPSTORE; then echo "    - Zapstore (skipped via --skip-zapstore)"
elif _ask "Publish to Zapstore?" y; then PUBLISH_ZAPSTORE=true; echo "    ✓ Zapstore"
else PUBLISH_ZAPSTORE=false; echo "    ✗ Zapstore (skipped)"; fi

if $SKIP_ANDROID || $SKIP_PLAY; then echo "    - Google Play (skipped via flag)"
elif _play_configured; then
  if _ask "Publish to Google Play (${PLAY_TRACK:-alpha} track)?" y; then PUBLISH_PLAY=true; echo "    ✓ Google Play"
  else echo "    ✗ Google Play (skipped)"; fi
else
  echo "    - Google Play (not configured — the app bundle is still built; step 10 prints the Console steps)"
fi

if $SKIP_IOS; then echo "    - Apple App Store (skipped via --skip-appstore)"
elif _appstore_configured; then
  if _ask "Publish to Apple App Store?" y; then PUBLISH_APP_STORE=true; echo "    ✓ Apple App Store"
  else echo "    ✗ Apple App Store (skipped)"; fi
else
  echo "    - Apple App Store (not configured - set ASC_KEY_ID + ASC_ISSUER_ID in scripts/.env; ensure ${MAC_MINI_HOST:-Tims-Mac-mini.local} is reachable)"
fi

if $SKIP_DESKTOP; then echo "    - Desktop apps (skipped via --skip-desktop)"
elif _ask "Build the desktop apps (Mac, Linux, Windows)?" y; then
  echo "    ✓ Desktop apps"
  if ! $SKIP_WINDOWS; then
    if _ask "Build and test Windows on the win11-pearguard VM (8 GB of RAM)? (No: Wine, untested)" y; then WINDOWS_ON_VM=true; fi
  fi
else SKIP_DESKTOP=true; echo "    ✗ Desktop apps (skipped)"; fi


if $SKIP_NOSTR; then echo "    - Nostr (skipped via --skip-nostr)"
elif _ask "Post release announcement to Nostr?" y; then PUBLISH_NOSTR=true; echo "    ✓ Nostr"
else PUBLISH_NOSTR=false; echo "    ✗ Nostr (skipped)"; fi
echo ""

if ! $PUBLISH_GITHUB && ! $PUBLISH_ZAPSTORE && ! $PUBLISH_NOSTR && ! $PUBLISH_PLAY && ! $PUBLISH_APP_STORE; then
  echo "No destinations selected. Aborted."
  exit 0
fi

# Zapstore alone does not need a build when GitHub already has this version.
if $PUBLISH_GITHUB || $PUBLISH_PLAY || $PUBLISH_APP_STORE; then
  NEEDS_BUILD=true
fi
if [ "${GH_VERSION:-}" != "$APP_VERSION" ] && ! $NEEDS_BUILD; then
  NEEDS_BUILD=true
  echo "    Note: $RELEASE_TAG is not published on GitHub, so there is no"
  echo "    existing artifact to republish — building it."
fi

if $NEEDS_BUILD; then

# ---------------------------------------------------------------------------
# 0. Update app.json version and versionCode
#
# scripts/release/bump.js sets the version everywhere PearOffice writes it:
# package.json, desktop/package.json, both lock files, app.json (Android
# versionCode and iOS buildNumber go up by one). At the same version
# (--retag) it changes nothing.
# ---------------------------------------------------------------------------
echo "==> Updating the version to $APP_VERSION..."
node scripts/release/bump.js "$APP_VERSION"
echo "    Version     : $(node -p "require('./app.json').expo.version")"
echo "    versionCode : $(node -p "require('./app.json').expo.android.versionCode")"
echo "    iOS build   : $(node -p "require('./app.json').expo.ios.buildNumber")"
echo "    Desktop     : $(node -p "require('./desktop/package.json').version")"
_confirm "app.json version looks correct — proceed with bundle builds?"

# ---------------------------------------------------------------------------
# 1. Canonical verify gate (tests + all bundles)
#
# `npm run verify` is PearOffice's merge gate: the unit tests, the real Bare
# binary with every bundle, and the desktop smoke test. A red suite aborts
# here. The output is also kept in dist/release/verify.log, so a test that
# fails only now and then can be looked into afterwards. The mobile bundles
# that ship are rebuilt by step 3's build-android-release.sh and by
# ios-appstore.sh on the Mac.
# ---------------------------------------------------------------------------
echo "==> Running the verify gate (tests, Bare bundles, desktop smoke)..."
VERIFY_LOG="dist/release/verify.log"
mkdir -p dist/release
if ! npm run verify 2>&1 | tee "$VERIFY_LOG"; then
  echo
  echo "==> The verify gate failed. The full output is in $VERIFY_LOG"
  grep -nE '^not ok|^# (pass|fail)' "$VERIFY_LOG" | tail -20 || true
  exit 1
fi

# ---------------------------------------------------------------------------
# 2. Native project preparation
#
# android/ is generated and gitignored here, so prebuild regenerates it with
# the release-signing config plugin. ios/ is prebuilt on the Mac Mini by
# scripts/ios-appstore.sh in step 11.
# ---------------------------------------------------------------------------
if $SKIP_ANDROID; then
  echo "==> Native project: no Android build, no prebuild."
else
  echo "==> Native project: expo prebuild (android)..."
  npx expo prebuild --clean --platform android --no-install
fi

# ---------------------------------------------------------------------------
# 3. Build signed release APK (and AAB if publishing to Google Play)
#
# scripts/build-android-release.sh builds both every time (the AAB is what
# Google Play takes, uploaded here or by hand) into dist/android/, named
# inline (pearoffice-<version>.apk), and refuses a build not signed with the
# PearOffice key.
# ---------------------------------------------------------------------------
if $SKIP_ANDROID; then
  echo "==> Skipping Android APK/AAB build (--skip-android)."
else
  echo "==> Building signed release APK and AAB (arm64)..."
  PREBUILT=1 scripts/build-android-release.sh
  APK_NAME="dist/android/${ARTIFACT_PREFIX}-${APP_VERSION}.apk"
  AAB_NAME="dist/android/${ARTIFACT_PREFIX}-${APP_VERSION}.aab"
  APK_SIZE=$(du -sh "$APK_NAME" | cut -f1)
  AAB_SIZE=$(du -sh "$AAB_NAME" | cut -f1)
  echo "==> Built APK: $APK_NAME  ($APK_SIZE)"
  echo "==> Built AAB: $AAB_NAME  ($AAB_SIZE)"
fi

# ---------------------------------------------------------------------------
# 4e. Generate .sha256 sidecars for the mobile artifacts
# ---------------------------------------------------------------------------
release_write_checksums

fi # end NEEDS_BUILD

# ---------------------------------------------------------------------------
# 5. Generate release notes from git log / merge commits
#
# When notes/release-<version>.md exists (plain-language notes written by
# hand, suite rule 13), it is the starting point instead. Either way the file
# opens in vi (as in the other apps) and every destination reads release_notes.md afterwards.
#
# From git: each merge commit since the previous vX.Y.Z tag is a PR, titled
# from the GitHub API when a token works, else from its branch name.
# ---------------------------------------------------------------------------
release_write_notes

# What the stores show: everything above a "## Downloads" section (which only
# the GitHub release needs), and for the App Store without emoji.
MOBILE_NOTES="dist/release/notes-mobile.md"
mkdir -p dist/release
awk '/^##[[:space:]]+Downloads/{exit} {print}' release_notes.md \
  | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}' > "$MOBILE_NOTES"
WHATS_NEW=$(python3 -c "
import re, sys
t = open(sys.argv[1], encoding='utf-8').read()
t = re.sub('[\U0001F000-\U0001FAFF☀-➿️]', '', t)
t = re.sub(r'(?m)^#+[ \t]*', '', t)
print(re.sub(r'(?m)^[ \t]+$', '', t).strip())
" "$MOBILE_NOTES")

if $NEEDS_BUILD; then

# ---------------------------------------------------------------------------
# 5b. Build the desktop installers
#
# One desktop/ project builds every target, so 5b2 is absent and
# --skip-linux / --skip-windows / --skip-macos select inside this step.
# They run after the notes so the machine works unattended, and each ends
# with its packaged smoke test. The two Mac builds run on the Mac Mini in the
# background, at the same time (each chip has its own build folder), while Linux
# and Windows build here one after the other (they share the staged
# resources in desktop/build/resources). The Mac copy takes only the source,
# never the folders the local builds write, and every build names its own files, so they cannot collide.
# The Mac results are collected before 5e. Best-effort: a failed platform is
# logged and skipped, never blocking the rest of the release.
# ---------------------------------------------------------------------------
_desktop() { # _desktop <label> <log> <command...>
  local _label="$1" _log="$2"; shift 2
  echo "--> $_label"
  if "$@" > "$_log" 2>&1 < /dev/null; then
    echo "    $_label OK."
    return 0
  fi
  echo "    WARNING: $_label failed, skipping it. Log: $_log"
  return 1
}
_DV="$APP_VERSION"
_DD="$REPO_ROOT/desktop/dist"
if $SKIP_DESKTOP; then
  echo "==> Skipping the desktop installers (--skip-desktop)."
else
  echo ""
  echo "==> Building the desktop installers (Mac on the Mac Mini, Linux and Windows here)..."
  if $SKIP_MACOS; then
    echo "--> macOS    (skipped via --skip-macos)"
  else
    echo "--> macOS    (Apple silicon and Intel side by side, on the Mac Mini in the background)"
    _MAC_DONE="$(mktemp -d)"
    (
      ( _desktop "macOS, Apple silicon (signed, notarized)" /tmp/pearoffice-build-mac-arm64.log npm run dist:mac \
          && touch "$_MAC_DONE/arm64" ) > "$_MAC_DONE/report-arm64" 2>&1 &
      ( _desktop "macOS, Intel (signed, notarized)" /tmp/pearoffice-build-mac-x64.log npm run dist:mac:intel \
          && touch "$_MAC_DONE/x64" ) > "$_MAC_DONE/report-x64" 2>&1 &
      wait
    ) < /dev/null &
    _MAC_PID=$!
  fi
  if $SKIP_LINUX; then
    echo "--> Linux    (skipped via --skip-linux)"
  else
    _desktop "Linux (.AppImage + .deb)" /tmp/pearoffice-build-linux.log npm run dist:linux \
      && DESKTOP_ARTIFACTS+=("$_DD/pearoffice-$_DV-linux-x86_64.AppImage" "$_DD/pearoffice-$_DV-linux-amd64.deb") \
      || DESKTOP_MISSING+=("Linux (/tmp/pearoffice-build-linux.log)")
  fi
  if $SKIP_WINDOWS; then
    echo "--> Windows  (skipped via --skip-windows)"
  elif $WINDOWS_ON_VM; then
    _win_vm() {
      virsh -c qemu:///system start win11-pearguard 2>/dev/null || true
      local _i
      for _i in $(seq 1 60); do
        ssh -o BatchMode=yes -o ConnectTimeout=5 "${WINDOWS_VM_HOST:-ben@192.168.50.157}" exit 2>/dev/null && break
        sleep 5
      done
      local _s=0
      npm run dist:windows:vm || _s=$?
      virsh -c qemu:///system shutdown win11-pearguard >/dev/null 2>&1 || true
      return "$_s"
    }
    _desktop "Windows (.exe, built and tested on the VM)" /tmp/pearoffice-build-windows.log _win_vm \
      && DESKTOP_ARTIFACTS+=("$_DD/PearOffice-Setup-$_DV.exe") \
      || DESKTOP_MISSING+=("Windows (/tmp/pearoffice-build-windows.log)")
  else
    _desktop "Windows (.exe, built with Wine, untested)" /tmp/pearoffice-build-windows.log npm run dist:windows \
      && DESKTOP_ARTIFACTS+=("$_DD/PearOffice-Setup-$_DV.exe") \
      || DESKTOP_MISSING+=("Windows (/tmp/pearoffice-build-windows.log)")
  fi
fi

# The desktop installers from 5b: the Mac builds finish here.
if ! $SKIP_DESKTOP; then
  if [ -n "$_MAC_PID" ]; then
    echo ""
    echo "==> Waiting for the Mac builds on the Mac Mini..."
    wait "$_MAC_PID" || true
    _MAC_PID=""
    cat "$_MAC_DONE/report-arm64" "$_MAC_DONE/report-x64" 2>/dev/null
    [ -e "$_MAC_DONE/arm64" ] && DESKTOP_ARTIFACTS+=("$_DD/PearOffice-$_DV-mac-arm64.dmg" "$_DD/PearOffice-$_DV-mac-arm64.zip") \
      || DESKTOP_MISSING+=("macOS Apple silicon (/tmp/pearoffice-build-mac-arm64.log)")
    [ -e "$_MAC_DONE/x64" ] && DESKTOP_ARTIFACTS+=("$_DD/PearOffice-$_DV-mac-x64.dmg" "$_DD/PearOffice-$_DV-mac-x64.zip") \
      || DESKTOP_MISSING+=("macOS Intel (/tmp/pearoffice-build-mac-x64.log)")
  fi
  _have=()
  for _f in "${DESKTOP_ARTIFACTS[@]}"; do
    if [ -f "$_f" ]; then _have+=("$_f"); else echo "    WARNING: expected $_f, not found."; fi
  done
  DESKTOP_ARTIFACTS=("${_have[@]}")
  if [ ${#DESKTOP_ARTIFACTS[@]} -gt 0 ]; then
    echo "==> Desktop installers built (${#DESKTOP_ARTIFACTS[@]}):"
    for _f in "${DESKTOP_ARTIFACTS[@]}"; do echo "    - $(basename "$_f")  ($(du -sh "$_f" | cut -f1))"; done
  else
    echo "==> No desktop installers produced (all skipped or failed); the release continues."
  fi
fi

# ---------------------------------------------------------------------------
# 5e. Generate .sha256 sidecars for the desktop artifacts, then the final gate
#
# The last confirm before anything irreversible: step 6 commits and step 6b
# pushes the tag. See RELEASE-PIPELINE.md §2.
# ---------------------------------------------------------------------------
for _artifact in "${DESKTOP_ARTIFACTS[@]}"; do
  [ -z "$_artifact" ] && continue
  [ -f "$_artifact" ] || continue
  ( cd "$(dirname "$_artifact")" && sha256sum "$(basename "$_artifact")" > "$(basename "$_artifact").sha256" )
  echo "    sha256  $(cut -d' ' -f1 < "${_artifact}.sha256")  $(basename "$_artifact")"
done

# The NixOS package (nixos/pearoffice.nix, used by flake.nix) installs the
# released .deb, so it takes this version and the .deb's hash in Nix's SRI form.
# Step 6 commits it with the other bumps.
_NIX_DEB="$REPO_ROOT/desktop/dist/pearoffice-$APP_VERSION-linux-amd64.deb"
if [ -f nixos/pearoffice.nix ] && [ -f "${_NIX_DEB}.sha256" ]; then
  _nix_hash="sha256-$(cut -d' ' -f1 < "${_NIX_DEB}.sha256" | xxd -r -p | base64 -w0)"
  sed -i -E \
    -e "s|^(  version = )\"[^\"]*\";|\1\"$APP_VERSION\";|" \
    -e "s|^(    hash = )\"sha256-[^\"]*\";|\1\"$_nix_hash\";|" \
    nixos/pearoffice.nix
  echo "    nix     $_nix_hash  nixos/pearoffice.nix"
fi

fi # end NEEDS_BUILD (slow builds)

echo ""
_RELEASE_SUMMARY=""
[ -n "$APK_NAME" ] && _RELEASE_SUMMARY="APK ($APK_SIZE), AAB ($AAB_SIZE)"
[ ${#DESKTOP_ARTIFACTS[@]} -gt 0 ] && _RELEASE_SUMMARY="${_RELEASE_SUMMARY:+$_RELEASE_SUMMARY, }${#DESKTOP_ARTIFACTS[@]} desktop installer(s)"
[ -z "$_RELEASE_SUMMARY" ] && _RELEASE_SUMMARY="no new artifacts"
_confirm "$_RELEASE_SUMMARY ready to publish?"

# ---------------------------------------------------------------------------
# 5f. Generate the iOS version metadata BEFORE the bump commit
#
# metadata/ios/version/<version>/en-US.json: the listing text with this
# version's "What's New", so step 6 commits it and step 11 applies it.
# ---------------------------------------------------------------------------
if $PUBLISH_APP_STORE; then
  mkdir -p "metadata/ios/version/$APP_VERSION"
  node -e "
    const f = require('fs')
    const o = JSON.parse(f.readFileSync('metadata/ios/version/default/en-US.json', 'utf8'))
    o.whatsNew = process.argv[1]
    f.writeFileSync('metadata/ios/version/$APP_VERSION/en-US.json', JSON.stringify(o, null, 2) + '\n')
  " "$WHATS_NEW"
  echo "==> Wrote metadata/ios/version/$APP_VERSION/en-US.json"
fi

# ---------------------------------------------------------------------------
# Phase D — publishing starts here. Nothing below this line is undoable.
# ---------------------------------------------------------------------------
if $PUBLISH_GITHUB; then
  _have_upload=false
  [ -n "$APK_NAME" ] && [ -f "$APK_NAME" ] && _have_upload=true
  [ ${#DESKTOP_ARTIFACTS[@]} -gt 0 ] && _have_upload=true
  if ! $_have_upload; then
    echo ""
    echo "==> No artifacts to upload — skipping GitHub release step."
    PUBLISH_GITHUB=false
  fi
fi

GIT_REMOTE="${GITHUB_REMOTE:-}"
if [ -z "$GIT_REMOTE" ]; then
  if git remote | grep -q '^github$'; then GIT_REMOTE="github"; else GIT_REMOTE="origin"; fi
fi

if $NEEDS_BUILD; then

# ---------------------------------------------------------------------------
# 6. Commit the version bumps this run made, BEFORE tagging
#
# Explicit allowlist, never `git add -A`: a run leaves release_notes.md,
# dist/ and node_modules changes in the tree.
# ---------------------------------------------------------------------------
_bump_paths=(
  package.json
  package-lock.json
  desktop/package.json
  desktop/package-lock.json
  app.json
  nixos/pearoffice.nix
  "metadata/ios/version/$APP_VERSION"
  "$HAND_NOTES"
)
_bump_existing=()
for _p in "${_bump_paths[@]}"; do [ -e "$_p" ] && _bump_existing+=("$_p"); done
if [ ${#_bump_existing[@]} -gt 0 ] \
   && [ -n "$(git status --porcelain -- "${_bump_existing[@]}")" ]; then
  echo "==> Committing version bumps for $APP_VERSION..."
  git add -- "${_bump_existing[@]}"
  git commit -q -m "chore(release): $APP_VERSION" \
    && echo "    Committed $(git diff --name-only HEAD~1 HEAD | wc -l) file(s)" \
    || echo "    WARNING: version-bump commit failed - the tag will not contain them." >&2
else
  echo "==> No uncommitted version bumps to record (already committed)."
fi

# ---------------------------------------------------------------------------
# 6b. Push branch and tag
# ---------------------------------------------------------------------------
release_push_and_tag

fi # end NEEDS_BUILD (commit and tag)

# ---------------------------------------------------------------------------
# 7. Create GitHub release and upload assets
#
# On RELEASES_REPO, where the website and the desktop update check link.
# Every file with its .sha256 sidecar.
# ---------------------------------------------------------------------------
# Usage: _publish_release <repo>. Creates the release as a draft, uploads the
# files, then publishes it, so nobody sees it
# half filled. A release that exists (--retag) gets new notes and files.
_publish_release() {
  local repo="$1" id _of=${#RELEASE_ASSETS[@]} _new=false _ok=true
  if gh release view "$RELEASE_TAG" -R "$repo" >/dev/null 2>&1; then
    echo "    GitHub release $RELEASE_TAG already exists on $repo -- replacing its notes and assets."
    # A draft left by a failed upload is published once the files are in.
    [ "$(gh release view "$RELEASE_TAG" -R "$repo" --json isDraft --jq .isDraft 2>/dev/null)" = "true" ] && _new=true
    gh release edit "$RELEASE_TAG" -R "$repo" --notes-file release_notes.md >/dev/null || _ok=false
  elif gh release create "$RELEASE_TAG" -R "$repo" --title "$APP_NAME $APP_VERSION" \
         --notes-file release_notes.md --draft >/dev/null; then
    _new=true
  else
    PUBLISH_FAILED=true; GITHUB_FAILED=true
    echo "ERROR: creating the GitHub release on $repo failed. The tag is pushed; re-run with ./scripts/release.sh $RELEASE_TAG --retag"
    return
  fi
  id=$(gh release view "$RELEASE_TAG" -R "$repo" --json databaseId --jq .databaseId 2>/dev/null || true)
  [ -n "$id" ] || _ok=false
  if $_ok; then
    # Several at a time with one progress line (shared library); gh without a token.
    if [ -n "$GH_TOKEN" ]; then
      release_upload_assets "https://uploads.github.com/repos/$repo/releases/$id/assets" "${RELEASE_ASSETS[@]}" || _ok=false
    else
      gh release upload "$RELEASE_TAG" -R "$repo" --clobber "${RELEASE_ASSETS[@]}" || _ok=false
    fi
  fi
  if $_ok && $_new; then
    gh release edit "$RELEASE_TAG" -R "$repo" --draft=false >/dev/null || _ok=false
  fi
  if $_ok; then
    echo "==> All $_of assets uploaded to $repo."
  else
    PUBLISH_FAILED=true; GITHUB_FAILED=true
    if $_new; then
      echo "ERROR: uploading to $repo failed. The release is still a draft there; re-run with ./scripts/release.sh $RELEASE_TAG --retag"
    else
      echo "ERROR: updating the GitHub release on $repo failed. Fix and re-run with ./scripts/release.sh $RELEASE_TAG --retag"
    fi
  fi
}
if $PUBLISH_GITHUB; then
  echo "==> Creating GitHub release $RELEASE_TAG on $RELEASES_REPO..."
  RELEASE_ASSETS=()
  for _a in "$APK_NAME" "${DESKTOP_ARTIFACTS[@]}"; do
    [ -n "$_a" ] && [ -f "$_a" ] || continue
    RELEASE_ASSETS+=("$_a")
    [ -f "${_a}.sha256" ] && RELEASE_ASSETS+=("${_a}.sha256")
  done
  # A release without an Android build keeps the previous APK on
  # releases/latest, which the website links to.
  if $SKIP_ANDROID; then
    _CARRIED=$(_carry_forward_apk "$GH_TOKEN" "$RELEASES_REPO" "$(mktemp -d)")
    if [ -n "$_CARRIED" ]; then
      while IFS= read -r _c; do RELEASE_ASSETS+=("$_c"); done <<< "$_CARRIED"
      echo "==> Carrying forward $(basename "$(printf '%s\n' "$_CARRIED" | head -1)") from the previous release."
    else
      echo "==> WARNING: no APK carried forward - this release will have no Android download."
    fi
  fi
  echo ""
  echo "    Repo   : $RELEASES_REPO"
  echo "    Tag    : $RELEASE_TAG"
  echo "    Assets :"
  for _a in "${RELEASE_ASSETS[@]}"; do echo "             - $(basename "$_a") ($(du -sh "$_a" | cut -f1))"; done
  if [ ${#DESKTOP_MISSING[@]} -gt 0 ]; then
    echo ""
    echo "    !!! MISSING: these desktop builds failed and are not in this release:"
    for _m in "${DESKTOP_MISSING[@]}"; do echo "    !!!   - $_m"; done
    echo "    !!! Users of those builds get no update. Fix and add them with --retag, or answer no to stop here."
  fi
  _confirm "Create public GitHub release $RELEASE_TAG and upload ${#RELEASE_ASSETS[@]} assets?"
  _publish_release "$RELEASES_REPO"
else
  echo ""
  echo "==> Skipping GitHub release (not selected)."
fi

# ---------------------------------------------------------------------------
# 8. Install zsp if needed
# ---------------------------------------------------------------------------
release_install_zsp

# ---------------------------------------------------------------------------
# 9. Publish to Zapstore
#
# release_publish_zapstore (peerloom-release) checks the APK's version, links the
# signing key to the Nostr identity and runs `zsp publish`. A Zapstore-only run
# (GitHub already has this version) takes the APK from that release.
# ---------------------------------------------------------------------------
release_publish_zapstore "$REPO_ROOT/dist/android/${ARTIFACT_PREFIX}-${APP_VERSION}.apk" "$MOBILE_NOTES"

# ---------------------------------------------------------------------------
# 10. Upload to Google Play Store
#
# With credentials (gcloud ADC or PLAY_SERVICE_ACCOUNT_JSON): the Play
# Developer API, as the other apps do (edit, upload the AAB, assign it to the
# track with the notes, commit). Without: the steps to do it in the Console.
# Notes are cut to Play's 500 characters on a line boundary.
# ---------------------------------------------------------------------------
PLAY_AAB="$REPO_ROOT/dist/android/${ARTIFACT_PREFIX}-${APP_VERSION}.aab"
release_upload_play "$PLAY_AAB" "$MOBILE_NOTES"

# ---------------------------------------------------------------------------
# 11. Build, upload, and submit iOS App Store build
#
# The App Store version and its listing text (step 5f's metadata), then
# scripts/ios-appstore.sh builds, signs and uploads on the Mac Mini, then the
# build is attached and submitted for review once Apple has processed it.
# ---------------------------------------------------------------------------
if $PUBLISH_APP_STORE; then
  echo ""
  echo "==> App Store: $APP_VERSION"
  _vid=$(_asc_version_id "$APP_VERSION")
  if [ -z "$_vid" ]; then
    _vid=$(asc versions create --app "$ASC_APP_ID" --version "$APP_VERSION" --platform IOS --output json 2>/dev/null \
      | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])" 2>/dev/null || echo "")
  fi
  if [ -z "$_vid" ]; then
    PUBLISH_FAILED=true; APP_STORE_FAILED=true
    echo "    ERROR: could not find or create App Store version $APP_VERSION."
  else
    echo "    Version record: $_vid"
    if asc metadata apply --app "$ASC_APP_ID" --version "$APP_VERSION" --dir metadata/ios >/dev/null; then
      echo "    Listing text applied."
    else
      echo "    WARNING: could not apply the listing text; set What's New in App Store Connect."
    fi
    release_check_mac_space "${MAC_MINI_HOST:-Tims-Mac-mini.local}"
    _confirm "Archive, export, and upload to App Store Connect on ${MAC_MINI_HOST:-Tims-Mac-mini.local}?"
    if scripts/ios-appstore.sh; then
      _num=$(node -p "require('./app.json').expo.ios.buildNumber")
      echo "    Waiting for Apple to process build $_num..."
      read -r _bid _state < <(_asc_wait_for_build "$APP_VERSION" "$_num") || true
      if [ "${_state:-}" = VALID ] && _asc_attach_build "$_vid" "$_bid"; then
        if _ask "Submit $APP_VERSION for App Review?" y; then
          release_submit_for_review "$_vid" || true
        fi
      else
        APP_STORE_DEFERRED=true
        echo "    Build is ${_state:-not processed yet}; the submission is deferred (see the reminder at the end)."
      fi
    else
      PUBLISH_FAILED=true; APP_STORE_FAILED=true
      echo "    ERROR: the iOS build or upload failed."
    fi
  fi
else
  echo ""
  echo "==> Skipping App Store (not selected)."
fi

# ---------------------------------------------------------------------------
# 12. Post release announcement to Nostr
#
# Signs a kind:1 note with the Zapstore NSEC (SIGN_WITH) and broadcasts it.
# The body keeps the notes' sections and fills up to NOSTR_NOTE_BUDGET
# characters. See RELEASE-PIPELINE.md §4.
# ---------------------------------------------------------------------------
release_post_nostr "$MOBILE_NOTES"

# ---------------------------------------------------------------------------
# 13. Close-out summary and deferred-action reminders
# ---------------------------------------------------------------------------
release_summary
release_summary_end

# ---------------------------------------------------------------------------
# 13b. Deferred-action reminders
# ---------------------------------------------------------------------------
release_deferred_reminders
