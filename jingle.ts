import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve, dirname } from "node:path";

type SoundConfig = Record<string, string>;

let sounds: SoundConfig = {};

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

async function playSound(soundPath: string, pi: ExtensionAPI): Promise<void> {
  const expandedPath = expandPath(soundPath);

  // Try different players based on platform
  const commands = [
    // macOS
    { cmd: "afplay", args: [expandedPath] },
    // Linux (PulseAudio)
    { cmd: "paplay", args: [expandedPath] },
    // Linux (ALSA)
    { cmd: "aplay", args: [expandedPath] },
    // Linux/FFmpeg
    { cmd: "ffplay", args: ["-nodisp", "-autoexit", "-loglevel", "quiet", expandedPath] },
    // Windows (PowerShell)
    {
      cmd: "powershell",
      args: [
        "-NoProfile",
        "-Command",
        `(New-Object System.Media.SoundPlayer '${expandedPath.replace(/'/g, "''")}').PlaySync()`
      ],
    },
  ];

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

  // Register sound handlers for each supported event
  for (const eventName of supportedEvents) {
    pi.on(eventName as any, async (_event: any, _ctx: any) => {
      const soundPath = sounds[eventName];
      if (!soundPath) return;

      // Play sound asynchronously without blocking
      playSound(soundPath, pi).catch(() => {
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
            entries.map(([k, v]) => `${k}: ${v}`).join(", "),
            "info"
          );
        }
        return;
      }

      const soundPath = sounds[args];
      if (!soundPath) {
        ctx.ui.notify(`No sound for event: ${args}`, "warning");
        return;
      }

      ctx.ui.notify(`Playing: ${soundPath}`, "info");
      await playSound(soundPath, pi);
      ctx.ui.notify("Done!", "success");
    },
  });
}
