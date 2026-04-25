# pi-jingle

Play sounds on pi events (agent_start, agent_end, etc.)

## Install

```bash
pi install npm:pi-jingle
```

## Usage

The extension auto-detects and plays the included `done.mp3` sound on `agent_end` by default. No configuration needed!

### Custom Sounds

Add sounds to your `~/.pi/agent/settings.json`:

```json
{
  "sounds": {
    "agent_end": "/path/to/end-sound.mp3",
    "agent_start": "/path/to/start-sound.mp3",
    "turn_end": "/path/to/turn-sound.mp3"
  }
}
```

Path formats:
- `~/sounds/ding.mp3` → `~/.pi/sounds/ding.mp3`
- `/absolute/path/ding.mp3` → works directly
- `./sounds/ding.mp3` → `~/.pi/sounds/ding.mp3`

### Commands

- `/sounds list` - Show configured sounds
- `/sounds agent_end` - Test playing a sound
- `/sounds reload` - Reload config from settings.json

### Supported Events

- `session_start`
- `session_shutdown`
- `agent_start`
- `agent_end`
- `turn_start`
- `turn_end`
- `tool_call`
- `tool_result`

## Requirements

A sound player for your platform:
- **macOS**: afplay (built-in)
- **Linux**: paplay, aplay, or ffplay
- **Windows**: PowerShell (built-in)
