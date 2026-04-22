import { Action, ActionPanel, List, showToast, Toast } from "@vicinae/api";
import { useState } from "react";
import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join, extname } from "path";
import { homedir } from "os";
import { execSync } from "child_process";

const HOME = homedir();
const WALLPAPERS_DIR = join(HOME, "Pictures", "Wallpapers");
const HYPRPAPER_CONF = join(HOME, ".config", "hypr", "hyprpaper.conf");
const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".avif"];

const loadWallpapers = (): string[] => {
  try {
    return readdirSync(WALLPAPERS_DIR)
      .filter((f) => IMAGE_EXTS.includes(extname(f).toLowerCase()))
      .sort();
  } catch {
    return [];
  }
};

const applyWallpaper = (filename: string): void => {
  const tildePath = `~/Pictures/Wallpapers/${filename}`;

  try {
    let conf = readFileSync(HYPRPAPER_CONF, "utf-8");
    conf = conf.replace(/^(\s*path\s*=\s*).*$/m, `$1${tildePath}`);

    writeFileSync(HYPRPAPER_CONF, conf, "utf-8");

    execSync(
      "systemctl --user disable --now hyprpaper.service && systemctl --user enable --now hyprpaper.service",
    );

    showToast({
      style: Toast.Style.Success,
      title: "Wallpaper updated",
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

export default function WallpaperChooser() {
  const [wallpapers] = useState<string[]>(loadWallpapers);

  return (
    <List isShowingDetail searchBarPlaceholder="Search wallpapers…">
      {wallpapers.length === 0 ? (
        <List.EmptyView
          title="No wallpapers found"
          description={`Add images to ${WALLPAPERS_DIR}`}
        />
      ) : (
        wallpapers.map((filename) => {
          const fullPath = join(WALLPAPERS_DIR, filename);

          return (
            <List.Item
              key={filename}
              id={filename}
              title={filename}
              detail={
                <List.Item.Detail
                  markdown={`![${filename}](file://${fullPath})`}
                />
              }
              actions={
                <ActionPanel>
                  <Action
                    title="Set as Wallpaper"
                    onAction={() => applyWallpaper(filename)}
                  />
                </ActionPanel>
              }
            />
          );
        })
      )}
    </List>
  );
}
