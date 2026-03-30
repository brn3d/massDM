# MassDM

A web-based Discord mass DM tool. Tokens, messages, and all data are stored locally in your browser — nothing is sent anywhere except Discord's API directly.

## Tabs

| Tab | Description |
|-----|-------------|
| mass dm | Run DM campaigns with live output, progress bar, and per-token stats |
| tokens | Add, bulk import, copy, and remove bot tokens |
| message | Write your DM, set delay, save message templates, variable reference |
| checker | Validate tokens + bulk check every server each bot is in |
| embed | Build and preview Discord embeds, send to a channel or mass DM |
| webhook | Send messages and embeds to a webhook URL with live preview |
| log | Full activity log with timestamps |

## Features

- Multi-token support with bulk import
- Token validation with avatar/username display
- Single server or global DM mode
- Concurrent sending — each token runs its own loop in parallel
- Configurable delay between messages per token
- Message variables: `{username}`, `{mention}`, `{userid}`, `<@userid>`
- Message templates — save, load, rename, delete
- Embed builder with live Discord-style preview and JSON payload
- Webhook sender with live preview, optional embed attach
- Token checker with server checker — deduplicates by guild ID
- Collapsible sidebar with volume control for background music
- Friendly error messages for Discord API codes (50007, 50278, etc.)
- All data persisted in `localStorage`

## Usage

1. **Tokens** — add tokens one by one or bulk import (one per line)
2. **Message** — write your DM, set delay, optionally save as a template
3. **Checker** — validate tokens, check all servers bots are in
4. **Mass DM**:
   - *Single server*: enter a Guild ID and hit start
   - *Global*: iterates all guilds across all tokens, DMs unique members

## Variables

Use these in your message to personalise each DM:

| Variable | Output |
|----------|--------|
| `{username}` | recipient's username |
| `{mention}` | pings them inline |
| `{userid}` | their Discord ID |
| `<@userid>` | same as `{mention}`, raw Discord syntax |

## Notes

- All data (tokens, message, logs, templates, server cache) is saved in `localStorage` — clearing your browser will wipe it
- Token statuses persist across reloads
- Concurrent DM sending scales with token count — 5 tokens at 1s delay = ~5 DMs/sec
- Per-token sent/failed breakdown shown in log after each run
