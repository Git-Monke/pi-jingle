# pi-jingle

Play sounds on pi events.

```bash
pi install npm:pi-jingle
```

## Configuration

Add to `~/.pi/agent/settings.json`:

```json
{
  "sounds": {
    "agent_end": "/path/to/done.mp3",
    "when_coding": "/path/to/music.mp3"
  }
}
```

**Path formats:**
- `/absolute/path.mp3` - absolute path
- `~/sounds/file.mp3` - resolves to `~/.pi/sounds/file.mp3`
- `./sounds/file.mp3` - resolves to `~/.pi/sounds/file.mp3`

**Volume:** Use an object for volume control (0.0 - 1.0):
```json
{
  "sounds": {
    "agent_end": { "path": "/path/to/sound.mp3", "volume": 0.5 }
  }
}
```

## Supported Events

| Event | Description |
|-------|-------------|
| `agent_start` | Task begins |
| `agent_end` | Task completes |
| `session_start` | pi starts |
| `session_shutdown` | pi closes |
| `turn_start` | User message received |
| `turn_end` | Response sent |
| `tool_call` | Tool execution |
| `tool_result` | Tool result received |

**Default:** Plays `done.mp3` on `agent_end` if no config exists.

**`when_coding`:** Loops a song from `agent_start` until `agent_end`.

## Commands

- `/sounds list` - Show configured sounds
- `/sounds reload` - Reload config

## Requirements

Sound player for your platform:
- **macOS**: afplay (built-in) or ffplay
- **Linux**: paplay, aplay, or ffplay
- **Windows**: PowerShell (built-in)

Install ffplay for volume control: `brew install ffplay`
