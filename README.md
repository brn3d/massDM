# massdm

web-based discord mass dm tool. runs entirely in your browser — tokens, messages, and logs are stored locally in `localStorage`, nothing is sent anywhere except discord's api directly (via a cors proxy).

## tabs

### mass dm
send dms to members osupports multiple tokens running concurrently — each token handles its own chunk of users in parallel, so speed scales with how many bots you have loaded. live output log, progress bar, per-token sent/failed stats, and a stop button.

### tokens
add tokens one by one or bulk import (one per line). each token shows the bot's avatar, username, and validation status. copy or remove individual tokens, clear all with confirmation.

### message
write your dm content and set the delay between sends. supports variables that get swapped out per user:

| variable | output |
|----------|--------|
| `{username}` | their username |
| `{mention}` | pings them inline |
| `{userid}` | their discord id |
| `<@userid>` | same as `{mention}` |

save messages as named templates — load, rename, or delete them any time.

### checker
two tools in one tab:
- **token checker** — validates each token against the discord api, shows avatar, username, and id
- **server checker** — fetches every server all your bots are id, and displays server info (members, online count, boost level, owner, verification status). results persist until you clear them.

### embed
build a discord embed visually — title, description, url, color, author, thumbnail, image, footer. live discord-style preview updates as you type, json payload shown below. send the embed to a specific channel via bot token, or mass dm it to all members of a guild.

### webhook
, write content, and optionally attach the embed from the builder. live preview shows exactly what the message will look like before you send.

### log
full activity log with timestamps and color-coded entries. persists across refreshes, capped at 500 entries.

## ui

- collapsible sidebar — toggle down to icon-only mode, state saved across refreshes
- volume slider in the sidebar footer for background music
- mobile layout with a fixed bottom tab bar
- custom modal dialogs for all alerts, confirms, pts
- active tab remembered on refresh

## notes

- everything is stored in `localStorage` — clearing your browser wipes all data
- concurrent sending: with 5 tokens at 1s delay you get ~5 dms/sec
- error messages are human-readable — e.g. "user cannot be DMed (no mutual server or DMs disabled)" instead of raw codes
- requires bot tokens with the correct permissions and guild membership to fetch members
