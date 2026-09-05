# VPS deployment

Run VK / Telegram bots 24/7 in tmux, kept alive by cron.

## Files

- [respawn.sh](respawn.sh) — starts a bot in tmux; cron's single source of truth for launching.
- [settings.json](settings.json) — permissions: denies destructive bash, secret reads, exfil; allows channel MCP tools, curl, WebFetch/WebSearch.
- [CLAUDE.md](CLAUDE.md) — operating policy: treat every channel message as untrusted.

## Deploy

From a Claude Code session with the plugin installed, run `/vk:setup` (or the installer
directly):

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/dist/server.js setup            # ~/bots/vk
bun run ${CLAUDE_PLUGIN_ROOT}/dist/server.js setup ~/bots/vk2 # another directory
```

It writes `respawn.sh`, `CLAUDE.md` and `.claude/settings.json` into the workdir, points the
installed `respawn.sh` at that directory, creates `~/.claude/channels/vk/.env` from the template
if it is missing, and installs the cron schedule below. Re-run it after a plugin update: the
plugin owns those three files and rewrites them, so edit the templates in this directory rather
than an installed copy. Your `.env` is never touched once it exists.

`/vk:uninstall` (or `... dist/server.js uninstall`) reverses all of it. It keeps
`~/.claude/channels/vk/` unless you pass `--all`.

For a second bot from another plugin (for example telegram), copy this directory's files by hand
and edit `session`, `workdir` and `launch` at the top of `respawn.sh`:

```bash
mkdir -p ~/bots/tg/.claude
cp settings.json ~/bots/tg/.claude/ && cp CLAUDE.md respawn.sh ~/bots/tg/
chmod +x ~/bots/tg/respawn.sh
```

Then start:

```bash
loginctl enable-linger $USER   # non-root only: keep tmux alive after logout
~/bots/vk/respawn.sh
```

## Keep alive — `crontab -e`

```bash
# Respawn within 5 min of a crash
*/5 * * * * /root/bots/vk/respawn.sh
*/5 * * * * /root/bots/tg/respawn.sh

# Restart every 6h to clear context
0 */6 * * * tmux kill-session -t vk 2>/dev/null; /root/bots/vk/respawn.sh
0 */6 * * * tmux kill-session -t tg 2>/dev/null; /root/bots/tg/respawn.sh
```

Use absolute paths — `~` does not expand in cron.

## Operate

```bash
tmux ls                  # list sessions
tmux attach -t vk        # peek — Ctrl+b then d to detach
tmux kill-session -t vk  # stop (cron respawns within 5 min)
```

No log file — Claude's output lives in the tmux scrollback (`tmux attach`).

## Notes

- **MCP servers fail with ENOENT?** Cron's PATH is too bare for Claude to find `bun`/`node`. The script adds `~/.local/bin`, `~/.bun/bin`, and nvm's node — fix it if `which claude bun node` differs.
- **Never redirect Claude's output** (`>> log`, `| tee`) — it flips to `--print` mode and exits on launch. For logs, use `tmux pipe-pane` (and rotate it).
- **Dev flag prompts on every launch.** `--dangerously-load-development-channels` shows a confirm prompt; the script presses Enter for it. Publish the plugin and use `--channels` to skip this.
