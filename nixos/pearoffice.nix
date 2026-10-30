{
  lib,
  alsa-lib,
  at-spi2-atk,
  at-spi2-core,
  atk,
  autoPatchelfHook,
  cairo,
  cups,
  dbus,
  dpkg,
  expat,
  fetchurl,
  glib,
  gtk3,
  libGL,
  libappindicator-gtk3,
  libdrm,
  libnotify,
  libsecret,
  libuuid,
  libx11,
  libxcb,
  libxcomposite,
  libxdamage,
  libxext,
  libxfixes,
  libxkbcommon,
  libxrandr,
  libxscrnsaver,
  libxtst,
  makeWrapper,
  mesa,
  nspr,
  nss,
  pango,
  stdenv,
  systemd,
  wrapGAppsHook3,
  xdg-utils,
}:

stdenv.mkDerivation rec {
  pname = "pearoffice";
  version = "1.1.6";

  src = fetchurl {
    url = "https://github.com/peerloomllc/pearoffice/releases/download/v${version}/pearoffice-${version}-linux-amd64.deb";
    hash = "sha256-VL+gqo44VsbYh7LMI/gY4Hr3OF0VwdwGVaTJpajjw90=";
  };

  nativeBuildInputs = [
    dpkg
    autoPatchelfHook
    makeWrapper
    wrapGAppsHook3
  ];

  buildInputs = [
    alsa-lib
    at-spi2-atk
    at-spi2-core
    atk
    cairo
    cups
    dbus
    expat
    glib
    gtk3
    libdrm
    libnotify
    libsecret
    libuuid
    libxkbcommon
    mesa
    nspr
    nss
    pango
    stdenv.cc.cc.lib
    systemd
    libx11
    libxcomposite
    libxdamage
    libxext
    libxfixes
    libxrandr
    libxcb
    libxscrnsaver
    libxtst
  ];

  # dlopen'd at runtime
  runtimeDependencies = [
    libGL
    libnotify
    libsecret
    libappindicator-gtk3
    systemd
  ];

  unpackPhase = "dpkg-deb -x $src .";

  # wrapGAppsHook3 + makeWrapper: we wrap manually below
  dontWrapGApps = true;

  installPhase = ''
    runHook preInstall

    mkdir -p $out/opt $out/bin $out/share
    cp -r opt/PearOffice $out/opt/PearOffice
    cp -r usr/share/icons $out/share/icons
    install -Dm444 usr/share/applications/pearoffice-desktop.desktop \
      $out/share/applications/pearoffice.desktop

    # SUID sandbox can't work in the store; Chromium falls back to userns
    rm -f $out/opt/PearOffice/chrome-sandbox

    substituteInPlace $out/share/applications/pearoffice.desktop \
      --replace-fail "/opt/PearOffice/pearoffice-desktop" "pearoffice"

    runHook postInstall
  '';

  postFixup = ''
    # Bypass the vendor launcher script, wrap the real binary
    makeWrapper $out/opt/PearOffice/pearoffice-desktop.bin $out/bin/pearoffice \
      "''${gappsWrapperArgs[@]}" \
      --prefix PATH : ${lib.makeBinPath [ xdg-utils ]} \
      --set PEAROFFICE_NO_UPDATE_CHECK 1 \
      --add-flags "\''${NIXOS_OZONE_WL:+\''${WAYLAND_DISPLAY:+--ozone-platform-hint=auto --enable-features=WaylandWindowDecorations}}"
  '';

  meta = {
    description = "Peer-to-peer spreadsheets, documents and slides";
    homepage = "https://github.com/peerloomllc/pearoffice";
    license = lib.licenses.mit;
    platforms = [ "x86_64-linux" ];
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
    mainProgram = "pearoffice";
  };
}
