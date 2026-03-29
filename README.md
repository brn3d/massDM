# MassDM

A web-based Discord mass DM tool hosted on GitHub Pages. Tokens, messages, and logs are stored locally in your browser — nothing is ever sent anywhere except Discord's API directly.

## Features

- Multi-token support with bulk import
- Token validation against the Discord API (with avatar/username display)
- Single server or global DM mode
- Configurable delay between messages
- Real-time output log with per-token stats
- Background music player (looped)
- All data persisted in `localStorage`

## Usage

1. Go to the **Tokens** tab — add tokens one by one or bulk import (one per line)
2. Go to the **Message** tab — write your DM and set the delay (seconds between sends)
3. Go to the **Checker** tab — optionally validate tokens before running
4. Go to the **Mass DM** tab:
   - **Single server**: enter a Guild ID and hit start
   - **Global**: iterates all guilds across all tokens and DMs unique members

## Tabs

| Tab | Description |
|-----|-------------|
| mass dm | Run DM campaigns, view live output and progress |
| tokens | Add, import, and manage bot tokens |
| message | Set the DM content and send delay |
| checker | Validate tokens against the Discord API |
| log | Full activity log with timestamps |

## Notes

- All data (tokens, message, logs) is saved in `localStorage` — clearing your browser will wipe it
- Token statuses (`valid` / `invalid` / `pending`) persist across page reloads
- Per-token sent/failed counts are shown in the log after each run
