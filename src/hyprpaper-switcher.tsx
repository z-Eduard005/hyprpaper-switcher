import {
  Action,
  ActionPanel,
  Grid,
  Icon,
  List,
  getPreferenceValues,
  openExtensionPreferences,
  showHUD,
  showToast,
  Toast,
  useNavigation,
} from "@vicinae/api";
import { useState } from "react";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { dirname, join, extname, isAbsolute } from "path";
import { homedir } from "os";
import { execFileSync, execSync, spawn } from "child_process";

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

type Backend = "hyprpaper" | "gnome" | "awww";

const commandExists = (cmd: string): boolean => {
  try {
    execSync(`command -v ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

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
  if (commandExists("awww")) return "awww";
  if (desktops.includes("hyprland")) return "hyprpaper";

  if (commandExists("hyprctl")) return "hyprpaper";
  if (commandExists("gsettings")) return "gnome";

  return "hyprpaper";
};

const BACKEND: Backend = detectBackend();

const getCurrentWallpaperPath = (): string | null => {
  try {
    if (BACKEND === "awww") {
      const out = execFileSync(
        "sh",
        ["-c", "awww query 2>/dev/null | grep -oP 'image: \\K.*' | head -1"],
        { encoding: "utf-8" },
      ).trim();
      return out || null;
    }

    if (BACKEND === "gnome") {
      const out = execFileSync(
        "gsettings",
        ["get", "org.gnome.desktop.background", "picture-uri"],
        { encoding: "utf-8" },
      ).trim();
      // gsettings prints a quoted value: 'file:///path'
      const uri = out.replace(/^['"]|['"]$/g, "");
      if (!uri.startsWith("file://")) return null;
      return decodeURIComponent(uri.slice("file://".length));
    }

    const out = execFileSync("hyprctl", ["hyprpaper", "listactive"], {
      encoding: "utf-8",
    });
    // lines like "DP-1: /path" or "Monitor DP-1: /path"
    for (const line of out.split("\n")) {
      const idx = line.indexOf(": ");
      if (idx === -1) continue;
      const candidate = line.slice(idx + 2).trim();
      if (candidate.startsWith("/")) return candidate;
    }
    return null;
  } catch {
    return null;
  }
};

const applyHyprpaperWallpaper = (filename: string): boolean => {
  const tildePath = `~${WALLPAPERS_DIR.replace(HOME, "")}/${filename}`;

  try {
    let conf = readFileSync(HYPRPAPER_CONF, "utf-8");
    conf = conf.replace(/^(\s*path\s*=\s*).*$/m, `$1${tildePath}`);

    writeFileSync(HYPRPAPER_CONF, conf, "utf-8");

    execSync("systemctl --user restart hyprpaper.service");

    return true;
  } catch (err) {
    showToast({
      style: Toast.Style.Failure,
      title: "Failed to update config",
      message: String(err),
    });

    return false;
  }
};

const applyGnomeWallpaper = (fullPath: string): boolean => {
  const uri = `file://${fullPath}`;

  try {
    execSync("command -v gsettings");
  } catch {
    showToast({
      style: Toast.Style.Failure,
      title: "gsettings not found",
      message: "Install GNOME / gsettings to use GNOME wallpaper mode.",
    });
    return false;
  }

  try {
    execSync(`gsettings set org.gnome.desktop.background picture-uri "${uri}"`);
    execSync(
      `gsettings set org.gnome.desktop.background picture-uri-dark "${uri}"`,
    );
  } catch (err) {
    showToast({
      style: Toast.Style.Failure,
      title: "Failed to set GNOME wallpaper",
      message: String(err),
    });
    return false;
  }
};

const AWWW_TRANSITION_ARGS = [
  "--transition-type",
  "random",
  "--transition-step",
  "90",
  "--transition-fps",
  "60",
];

const isAwwwDaemonRunning = (): boolean => {
  try {
    execFileSync("awww", ["query"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

const ensureAwwwDaemon = (): boolean => {
  if (isAwwwDaemonRunning()) return true;

  try {
    spawn("awww-daemon", { detached: true, stdio: "ignore" }).unref();
  } catch {
    return false;
  }

  for (let i = 0; i < 10; i++) {
    execSync("sleep 0.3", { stdio: "ignore" });
    if (isAwwwDaemonRunning()) return true;
  }

  return false;
};

const applyAwwwWallpaper = (
  fullPath: string,
  forceRedraw = false,
  clearColor?: string,
): boolean => {
  if (!ensureAwwwDaemon()) {
    showToast({
      style: Toast.Style.Failure,
      title: "awww daemon not running",
      message:
        "Could not start awww-daemon. Launch it manually with: `awww-daemon &`",
    });
    return false;
  }

  try {
    if (forceRedraw) {
      // accent color in rrggbb format, no '#'; black when omitted
      execFileSync("awww", clearColor ? ["clear", clearColor] : ["clear"], {
        stdio: "ignore",
      });
    }

    execFileSync("awww", ["img", fullPath, ...AWWW_TRANSITION_ARGS], {
      stdio: "ignore",
    });

    return true;
  } catch (err) {
    showToast({
      style: Toast.Style.Failure,
      title: "Failed to set awww wallpaper",
      message: String(err),
    });

    return false;
  }
};

const HYPRLOCK_CONF = join(HOME, ".config", "hypr", "hyprlock.conf");

const syncHyprlockBackground = (fullPath: string): void => {
  let conf: string;
  try {
    conf = readFileSync(HYPRLOCK_CONF, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return;
    showToast({
      style: Toast.Style.Failure,
      title: "Failed to sync hyprlock background",
      message: String(err),
    });
    return;
  }

  if (/^\s*background\s*\{/m.test(conf)) {
    conf = conf.replace(/(^\s*background\s*\{[^}]*?^\s*\})/gm, (block) => {
      if (/^[ \t]*path[ \t]*=.*$/m.test(block)) {
        return block.replace(/^[ \t]*path[ \t]*=[ \t]*.*$/m, (m) => {
          const prefix = m.slice(0, m.indexOf("=") + 1);
          return `${prefix} ${fullPath}`;
        });
      }
      return block.replace(
        /(^\s*background\s*\{\s*$)/m,
        `$1\n    path = ${fullPath}`,
      );
    });
  } else {
    if (!conf.endsWith("\n") && conf.length > 0) conf += "\n";
    conf += `\nbackground {\n    monitor =\n    path = ${fullPath}\n    blur_passes = 3\n}\n`;
  }

  try {
    writeFileSync(HYPRLOCK_CONF, conf, "utf-8");
  } catch (err) {
    showToast({
      style: Toast.Style.Failure,
      title: "Failed to sync hyprlock background",
      message: String(err),
    });
  }
};

const applyWallpaper = (
  filename: string,
  fullPath: string,
  forceRedraw = false,
  clearColor?: string,
): void => {
  const ok =
    BACKEND === "gnome"
      ? applyGnomeWallpaper(fullPath)
      : BACKEND === "awww"
        ? applyAwwwWallpaper(fullPath, forceRedraw, clearColor)
        : applyHyprpaperWallpaper(filename);

  if (!ok) return;

  syncHyprlockBackground(fullPath);

  showHUD(`Wallpaper set to ${filename}`);
};

// Accent support is only offered when the hypr script that consumes the accent map is present on this machine.
const ACCENT_SCRIPT_PATH = join(
  HOME,
  ".config",
  "hypr",
  "scripts",
  "poll-wallpaper-accent.sh",
);
const ACCENT_MAP_PATH = join(HOME, ".config", "wallpaper-accent-map.txt");

const ACCENTS = [
  { name: "blue", hex: "#3584e4" },
  { name: "teal", hex: "#2190a4" },
  { name: "green", hex: "#3a944a" },
  { name: "yellow", hex: "#c88800" },
  { name: "orange", hex: "#ed5b00" },
  { name: "red", hex: "#e62d42" },
  { name: "pink", hex: "#d56199" },
  { name: "purple", hex: "#9141ac" },
  { name: "slate", hex: "#6f8396" },
];

const VALID_ACCENT_NAMES = new Set(ACCENTS.map((a) => a.name));
const HAS_ACCENT_SCRIPT = existsSync(ACCENT_SCRIPT_PATH);

const readAccentMapLines = (): string[] => {
  try {
    return readFileSync(ACCENT_MAP_PATH, "utf-8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw err;
  }
};

const formatAccentLine = (path: string, accent: string): string =>
  `"${path}" ${accent}`;

const parseAccentLine = (
  line: string,
): { path: string; accent: string } | null => {
  const m = line.match(/^"([^"]+)"\s+([^\s]+)$/);
  if (!m) return null;
  return { path: m[1], accent: m[2] };
};

const rewriteAccentMap = (lines: string[]): void => {
  if (lines.length === 0) {
    writeFileSync(ACCENT_MAP_PATH, "", "utf-8");
    return;
  }

  writeFileSync(ACCENT_MAP_PATH, `${lines.join("\n")}\n`, "utf-8");
};

const pruneAccentMap = (): void => {
  let content: string;
  try {
    content = readFileSync(ACCENT_MAP_PATH, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      try {
        mkdirSync(dirname(ACCENT_MAP_PATH), { recursive: true });
      } catch {}
      return;
    }
    showToast({
      style: Toast.Style.Failure,
      title: "Failed to read accent map",
      message: String(err),
    });
    return;
  }

  const kept: string[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const entry = parseAccentLine(trimmed);
    if (!entry) continue;
    if (!entry.path.startsWith("/")) continue;
    if (!VALID_ACCENT_NAMES.has(entry.accent)) continue;

    const existing = kept.findIndex((l) => {
      const parsed = parseAccentLine(l);
      return parsed?.path === entry.path;
    });
    const formatted = formatAccentLine(entry.path, entry.accent);
    if (existing !== -1) kept[existing] = formatted;
    else kept.push(formatted);
  }

  const next = kept.length > 0 ? `${kept.join("\n")}\n` : "";
  if (next === content) return;

  try {
    rewriteAccentMap(kept);
  } catch (err) {
    showToast({
      style: Toast.Style.Failure,
      title: "Failed to clean accent map",
      message: String(err),
    });
  }
};

const setWallpaperAccent = (
  filename: string,
  fullPath: string,
  accent: string,
): void => {
  try {
    pruneAccentMap();

    const kept = readAccentMapLines().filter((line) => {
      const parsed = parseAccentLine(line);
      return !parsed || parsed.path !== fullPath;
    });

    kept.push(formatAccentLine(fullPath, accent));
    mkdirSync(dirname(ACCENT_MAP_PATH), { recursive: true });
    writeFileSync(ACCENT_MAP_PATH, `${kept.join("\n")}\n`, "utf-8");
  } catch (err) {
    showToast({
      style: Toast.Style.Failure,
      title: "Failed to save accent mapping",
      message: String(err),
    });
    return;
  }

  const accentHex = ACCENTS.find((a) => a.name === accent)?.hex.slice(1);
  applyWallpaper(filename, fullPath, true, accentHex);
};

function AccentConfigScreen({
  filename,
  fullPath,
}: {
  filename: string;
  fullPath: string;
}) {
  const { pop } = useNavigation();

  return (
    <List
      isShowingDetail
      navigationTitle={`Accent — ${filename}`}
      searchBarPlaceholder="Search accent colors…"
    >
      {ACCENTS.map((accent) => {
        const swatch = { source: Icon.CircleFilled, tintColor: accent.hex };

        return (
          <List.Item
            key={accent.name}
            id={accent.name}
            title={accent.name}
            icon={swatch}
            detail={
              <List.Item.Detail
                markdown={`![${filename}](file://${encodeURI(fullPath)})`}
              />
            }
            actions={
              <ActionPanel>
                <Action
                  title={`Set ${accent.name} Accent`}
                  icon={swatch}
                  onAction={() => {
                    setWallpaperAccent(filename, fullPath, accent.name);
                    pop();
                  }}
                />
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}

export default function WallpaperChooser() {
  const [{ wallpapers, currentFilename }] = useState(() => {
    const list = loadWallpapers();
    const current = getCurrentWallpaperPath()?.split("/").pop() ?? null;

    if (current && list.includes(current)) {
      return {
        wallpapers: [current, ...list.filter((f) => f !== current)],
        currentFilename: current,
      };
    }

    return { wallpapers: list, currentFilename: null };
  });

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
              accessory={
                filename === currentFilename
                  ? { icon: Icon.CheckCircle, tooltip: "Current wallpaper" }
                  : undefined
              }
              actions={
                <ActionPanel>
                  <Action
                    title="Set as Wallpaper"
                    onAction={() => applyWallpaper(filename, fullPath)}
                  />
                  {HAS_ACCENT_SCRIPT ? (
                    <Action.Push
                      title="Configure Accent"
                      icon={Icon.Swatch}
                      shortcut={{ modifiers: ["shift"], key: "enter" }}
                      target={
                        <AccentConfigScreen
                          filename={filename}
                          fullPath={fullPath}
                        />
                      }
                    />
                  ) : null}
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
