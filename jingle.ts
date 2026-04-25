import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { existsSync } from "node:fs";
import process from "node:process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve, dirname } from "node:path";

// Sound entry can be a simple path string or an object with path and optional volume
type SoundEntry = string | { path: string; volume?: number };
type SoundConfig = Record<string, SoundEntry>;

let sounds: SoundConfig = {};

// Track if a song is currently playing
let isPlaying = false;
let songPid: number | null = null;

async function loadConfig(): Promise<SoundConfig> {
  try {
    const settingsPath = resolve(homedir(), ".pi/agent", "settings.json");
    const content = await readFile(settingsPath, "utf-8");
    const settings = JSON.parse(content);
    return settings.sounds ?? {};
  } catch {
    return {};
  }
}

function getDefaultSoundPath(): string | undefined {
  // Try to find the sound file relative to this extension
  // When installed via npm, it's in node_modules/pi-jingle/sounds/
  const possiblePaths = [
    resolve(dirname(typeof __filename === 'undefined' ? import.meta.url : __filename), "sounds", "done.mp3"),
    resolve(homedir(), ".pi/agent/sounds/done.mp3"),
    resolve(homedir(), ".pi/npm/pi-jingle/sounds/done.mp3"),
  ];

  for (const p of possiblePaths) {
    if (existsSync(p)) return p;
  }
  return undefined;
}

function expandPath(path: string): string {
  if (path.startsWith("~/")) {
    return resolve(homedir(), path.slice(2));
  }
  if (path.startsWith("./")) {
    return resolve(homedir(), ".pi", path.slice(2));
  }
  return path;
}

// Extract path and volume from a sound entry
function getSoundInfo(entry: SoundEntry): { path: string; volume: number | undefined } {
  if (typeof entry === "string") {
    return { path: entry, volume: undefined };
  }
  return { path: entry.path, volume: entry.volume };
}

async function startLoopingSong(soundPath: string, pi: ExtensionAPI, volume?: number): Promise<void> {
  // Stop any currently playing song first
  await stopSong(pi);
  isPlaying = true;
  songPid = null;

  const expandedPath = expandPath(soundPath);

  try {
    if (process.platform === "darwin") {
      // macOS: use nohup to detach afplay or ffplay, capture PID
      let cmd: string;
      if (volume !== undefined && volume !== null) {
        // Use ffplay for volume control
        cmd = `nohup ffplay -nodisp -loop 0 -loglevel quiet -af volume=${volume} "${expandedPath}" > /dev/null 2>&1 &\necho $!`;
      } else {
        // Use afplay for better quality
        cmd = `nohup afplay "${expandedPath}" > /dev/null 2>&1 &\necho $!`;
      }
      const result = await pi.exec("sh", ["-c", cmd], { timeout: 5000 });
      if (result?.stdout) {
        songPid = parseInt(result.stdout.trim(), 10);
      }
    } else if (process.platform === "linux") {
      // Linux: use ffplay with loop option
      const volArg = volume !== undefined && volume !== null ? `-af volume=${volume}` : "";
      await pi.exec("sh", ["-c", `ffplay -nodisp -loop 0 -loglevel quiet ${volArg} "${expandedPath}" > /dev/null 2>&1 &`], { timeout: 5000 });
    } else {
      // Windows: use start /B
      await pi.exec("cmd", ["/C", "start", "/B", "", `"${expandedPath}"`], { timeout: 5000 });
    }
  } catch {
    isPlaying = false;
    songPid = null;
    // Failed to start - silently ignore
  }
}

async function stopSong(pi: ExtensionAPI): Promise<void> {
  if (!isPlaying) return;
  isPlaying = false;

  try {
    if (process.platform === "darwin") {
      // Kill the specific song PID first, then any stragglers
      if (songPid) {
        await pi.exec("kill", ["-9", songPid.toString()], { timeout: 2000 }).catch(() => { });
        songPid = null;
      }
      // Also kill any remaining afplay/ffplay processes (cleanup)
      await pi.exec("pkill", ["-9", "afplay"], { timeout: 2000 }).catch(() => { });
      await pi.exec("pkill", ["-9", "ffplay"], { timeout: 2000 }).catch(() => { });
    } else if (process.platform === "linux") {
      // Kill any ffplay processes
      await pi.exec("pkill", ["-9", "ffplay"], { timeout: 2000 }).catch(() => { });
    } else {
      // Windows: use taskkill to kill any audio player
      await pi.exec("taskkill", ["/F", "/IM", "wmplayer.exe"], { timeout: 2000 }).catch(() => { });
    }
  } catch {
    // Ignore errors when stopping
  }
}

async function playSound(soundPath: string, pi: ExtensionAPI, volume?: number): Promise<void> {
  const expandedPath = expandPath(soundPath);

  // Build command list based on whether volume is specified
  const commands: { cmd: string; args: string[] }[] = [];

  if (volume !== undefined && volume !== null) {
    // Volume specified: use ffplay with volume filter (cross-platform)
    commands.push({
      cmd: "ffplay",
      args: ["-nodisp", "-autoexit", "-loglevel", "quiet", "-af", `volume=${volume}`, expandedPath]
    });
  }

  // Add players without volume support (fallback)
  if (process.platform === "darwin") {
    commands.push({ cmd: "afplay", args: [expandedPath] });
  } else if (process.platform === "linux") {
    commands.push({ cmd: "paplay", args: [expandedPath] });
    commands.push({ cmd: "aplay", args: [expandedPath] });
  }

  // Always add ffplay as fallback (works but without volume)
  commands.push({
    cmd: "ffplay",
    args: ["-nodisp", "-autoexit", "-loglevel", "quiet", expandedPath]
  });

  // Windows fallback
  if (process.platform === "win32") {
    commands.push({
      cmd: "powershell",
      args: [
        "-NoProfile",
        "-Command",
        `(New-Object System.Media.SoundPlayer '${expandedPath.replace(/'/g, "''")}').PlaySync()`
      ],
    });
  }

  for (const { cmd, args } of commands) {
    try {
      const result = await pi.exec(cmd, args, { timeout: 5000 });
      if (result?.code === 0) return;
    } catch {
      continue;
    }
  }
}

export default async function(pi_: ExtensionAPI) {
  const pi = pi_;

  // Supported events that can have sounds
  const supportedEvents = [
    "agent_end",
    "agent_start",
    "turn_start",
    "turn_end",
    "session_start",
    "session_shutdown",
    "tool_call",
    "tool_result",
  ];

  // Load config on startup
  pi.on("session_start", async () => {
    sounds = await loadConfig();

    // Auto-enable default sound if nothing configured
    if (Object.keys(sounds).length === 0) {
      const defaultSound = getDefaultSoundPath();
      if (defaultSound) {
        sounds = { agent_end: defaultSound };
      }
    }
  });

  // Special handler for when_coding - start song on agent_start, stop on agent_end
  pi.on("agent_start", async (_event: any, _ctx: any) => {
    const songEntry = sounds["when_coding"];
    if (songEntry) {
      const { path, volume } = getSoundInfo(songEntry);
      await startLoopingSong(path, pi, volume).catch(() => {
        // Silently ignore playback failures
      });
    }
  });

  pi.on("agent_end", async (_event: any, _ctx: any) => {
    await stopSong(pi);
  });

  // Register sound handlers for each supported event
  for (const eventName of supportedEvents) {
    pi.on(eventName as any, async (_event: any, _ctx: any) => {
      const soundEntry = sounds[eventName];
      if (!soundEntry) return;

      const { path, volume } = getSoundInfo(soundEntry);

      // Play sound asynchronously without blocking
      playSound(path, pi, volume).catch(() => {
        // Silently ignore playback failures
      });
    });
  }

  // Command to test sounds
  pi.registerCommand("sounds", {
    description: "Play a configured sound or list sounds",
    getArgumentCompletions: (prefix: string) => {
      const available = Object.keys(sounds);
      const items = available.map((e) => ({ label: e, value: e }));
      return items.filter((i) => i.label.startsWith(prefix));
    },
    handler: async (args, ctx) => {
      if (args === "reload" || args === "config") {
        sounds = await loadConfig();
        ctx.ui.notify("Sounds config reloaded", "info");
        return;
      }

      if (args === "list" || !args) {
        const entries = Object.entries(sounds);
        if (entries.length === 0) {
          ctx.ui.notify("No sounds configured", "info");
        } else {
          ctx.ui.notify(
            entries.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", "),
            "info"
          );
        }
        return;
      }

      const soundEntry = sounds[args];
      if (!soundEntry) {
        ctx.ui.notify(`No sound for event: ${args}`, "warning");
        return;
      }

      const { path, volume } = getSoundInfo(soundEntry);
      ctx.ui.notify(`Playing: ${path}${volume !== undefined ? ` (volume: ${volume})` : ""}`, "info");
      await playSound(path, pi, volume);
      ctx.ui.notify("Done!", "success");
    },
  });
}
