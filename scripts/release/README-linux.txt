VRift - Hacknet extension editor
================================

1. Unzip this folder anywhere.
2. Run ./vrift  (or double-click it in your file manager).

No installation needed, but VRift uses the system WebKitGTK library. Most desktops
already have it; if VRift does not start, install it:

  Debian/Ubuntu/Mint:  sudo apt install libwebkit2gtk-4.1-0
  Fedora:              sudo dnf install webkit2gtk4.1
  Arch:                sudo pacman -S webkit2gtk-4.1
  Steam Deck (desktop mode): use the Flatpak/Distrobox route or build from source.

If the file lost its executable flag: chmod +x vrift

Wayland: blank window or "Error 71 (Protocol error)"
----------------------------------------------------
VRift already applies the usual WebKitGTK workaround for this. If it still
happens (common with NVIDIA drivers), try these one at a time:

  WEBKIT_DISABLE_COMPOSITING_MODE=1 ./vrift
  GDK_BACKEND=x11 ./vrift          (runs through XWayland)

On Fedora Atomic / Silverblue / Bazzite / Kinoite, WebKitGTK is usually already
in the image. If it is missing, layer it (rpm-ostree install webkit2gtk4.1 and
reboot) or run VRift from a toolbox/distrobox container.

VRift is free software under the GNU GPL v3.0 (see LICENSE.txt).
