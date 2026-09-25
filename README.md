# Hyprpaper Switcher
**Browse and set wallpapers without leaving your launcher.**

A [Vicinae](https://docs.vicinae.com) extension that shows your wallpaper collection as a visual grid and applies the chosen image — automatically using the right backend for your session: **awww** or **Hyprpaper** on Hyprland, **gsettings** on GNOME.

![Wallpaper Switcher grid view](assets/ss.png)

## Install
```bash
git clone https://github.com/z-Eduard005/hyprpaper-switcher
cd hyprpaper-switcher
npm install
npm run build
```

## Supported Backends
- **awww** — animated transitions (`any / 90 / 60`), daemon auto-started if down. Preferred on Hyprland when installed.
- **Hyprpaper** — rewrites `path = …` in `hyprpaper.conf` and restarts the service.
- **GNOME** — `gsettings set … picture-uri[-dark] "file://…"`.

## Features
- 4-column wallpaper grid with search and full arrow-key navigation (wraps first ↔ last)
- Fully automatic backend: Hyprland → awww (if installed) or Hyprpaper config, GNOME → `picture-uri` + `picture-uri-dark`
- Configurable wallpaper folder (extension preferences, defaults to `~/.local/share/backgrounds`)
- Actions: **Set as Wallpaper**, **Open Image** (default viewer), **Open Wallpapers Folder**, **Configure Wallpaper Folder**