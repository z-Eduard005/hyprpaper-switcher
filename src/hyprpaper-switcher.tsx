import {
  Action,
  ActionPanel,
  Grid,
  getPreferenceValues,
  openExtensionPreferences,
  showToast,
  Toast,
} from "@vicinae/api";
import { useState } from "react";
import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join, extname, isAbsolute } from "path";
import { homedir } from "os";
import { execSync } from "child_process";

const HOME = homedir();
const DEFAULT_WALLPAPERS_DIR = join(HOME, ".local", "share", "backgrounds");
const HYPRPAPER_CONF = join(HOME, ".config", "hypr", "hyprpaper.conf");
const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".avif"];

const expandPath = (p: string): string => {
  if (p.startsWith("~/")) return join(HOME, p.slice(2));
  if (p === "~") return HOME;
  if (p.startsWith("$HOME/")) return join(HOME, p.slice(6));
  if (!isAbsolute(p)) return join(HOME, p);
  return p;
};

const resolveWallpapersDir = (): string => {
  try {
    const prefs = getPreferenceValues<{ wallpaperDir?: string }>();
    const configured = prefs.wallpaperDir?.trim();
    if (configured) return expandPath(configured);
  } catch {
    // fall through to default
  }
  return DEFAULT_WALLPAPERS_DIR;
};

const WALLPAPERS_DIR = resolveWallpapersDir();

const loadWallpapers = (): string[] => {
  try {
    return readdirSync(WALLPAPERS_DIR)
      .filter((f) => IMAGE_EXTS.includes(extname(f).toLowerCase()))
      .sort();
  } catch {
    return [];
  }
};

type Backend = "hyprpaper" | "gnome";

const detectBackend = (): Backend => {
  const desktops = [
    process.env.XDG_CURRENT_DESKTOP,
    process.env.XDG_SESSION_DESKTOP,
    process.env.DESKTOP_SESSION,
  ]
    .filter(Boolean)
    .join(":")
    .toLowerCase();

  if (desktops.includes("gnome")) return "gnome";
  if (desktops.includes("hyprland")) return "hyprpaper";

  try {
    execSync("command -v hyprctl");
    return "hyprpaper";
  } catch {
    // no hyprctl — fall through
  }

  try {
    execSync("command -v gsettings");
    return "gnome";
  } catch {
    // neither tool found — default to hyprpaper, error toasts will guide
  }

  return "hyprpaper";
};

const BACKEND: Backend = detectBackend();

const applyHyprpaperWallpaper = (filename: string): void => {
  const tildePath = `~${WALLPAPERS_DIR.replace(HOME, "")}/${filename}`;

  try {
    let conf = readFileSync(HYPRPAPER_CONF, "utf-8");
    conf = conf.replace(/^(\s*path\s*=\s*).*$/m, `$1${tildePath}`);

    writeFileSync(HYPRPAPER_CONF, conf, "utf-8");

    execSync("systemctl --user restart hyprpaper.service");

    showToast({
      style: Toast.Style.Success,
      title: "Hyprpaper allpaper updated",
      message: tildePath,
    });
  } catch (err) {
    showToast({
      style: Toast.Style.Failure,
      title: "Failed to update config",
      message: String(err),
    });
  }
};

const applyGnomeWallpaper = (fullPath: string): void => {
  const uri = `file://${fullPath}`;

  try {
    execSync("command -v gsettings");
  } catch {
    showToast({
      style: Toast.Style.Failure,
      title: "gsettings not found",
      message: "Install GNOME / gsettings to use GNOME wallpaper mode.",
    });
    return;
  }

  try {
    execSync(`gsettings set org.gnome.desktop.background picture-uri "${uri}"`);
    execSync(
      `gsettings set org.gnome.desktop.background picture-uri-dark "${uri}"`,
    );

    showToast({
      style: Toast.Style.Success,
      title: "GNOME wallpaper updated",
      message: uri,
    });
  } catch (err) {
    showToast({
      style: Toast.Style.Failure,
      title: "Failed to set GNOME wallpaper",
      message: String(err),
    });
  }
};

const applyWallpaper = (filename: string, fullPath: string): void => {
  if (BACKEND === "gnome") {
    applyGnomeWallpaper(fullPath);
  } else {
    applyHyprpaperWallpaper(filename);
  }
};

export default function WallpaperChooser() {
  const [wallpapers] = useState<string[]>(loadWallpapers);

  return (
    <Grid
      columns={4}
      aspectRatio="16/9"
      fit={Grid.Fit.Fill}
      inset={Grid.Inset.Small}
      searchBarPlaceholder="Search wallpapers…"
    >
      {wallpapers.length === 0 ? (
        <Grid.EmptyView
          title="No wallpapers found"
          description={`Add images to ${WALLPAPERS_DIR} or change the folder in extension preferences.`}
          actions={
            <ActionPanel>
              <Action.Open
                title="Open Wallpapers Folder"
                target={WALLPAPERS_DIR}
              />
              <Action
                title="Configure Wallpaper Folder"
                onAction={() => openExtensionPreferences()}
              />
            </ActionPanel>
          }
        />
      ) : (
        wallpapers.map((filename) => {
          const fullPath = join(WALLPAPERS_DIR, filename);

          return (
            <Grid.Item
              key={filename}
              id={filename}
              subtitle={filename}
              keywords={[filename]}
              content={{ value: fullPath, tooltip: filename }}
              actions={
                <ActionPanel>
                  <Action
                    title="Set as Wallpaper"
                    onAction={() => applyWallpaper(filename, fullPath)}
                  />
                  <Action.Open title="Open Image" target={fullPath} />
                  <Action.Open
                    title="Open Wallpapers Folder"
                    target={WALLPAPERS_DIR}
                  />
                  <Action
                    title="Configure Wallpaper Folder"
                    onAction={() => openExtensionPreferences()}
                  />
                </ActionPanel>
              }
            />
          );
        })
      )}
    </Grid>
  );
}
