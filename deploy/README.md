# VPS deployment

Run VK / Telegram bots 24/7 in tmux, kept alive by cron.

## Files

- [respawn.sh](respawn.sh) — starts a bot in tmux; cron's single source of truth for launching.
- [settings.json](settings.json) — permissions: denies destructive bash, secret reads, exfil; allows channel MCP tools, curl, WebFetch/WebSearch.
- [CLAUDE.md](CLAUDE.md) — operating policy: treat every channel message as untrusted.

## Deploy

```bash
mkdir -p ~/bots/vk/.claude ~/bots/tg/.claude
cp settings.json ~/bots/vk/.claude/ && cp CLAUDE.md respawn.sh ~/bots/vk/
cp settings.json ~/bots/tg/.claude/ && cp CLAUDE.md respawn.sh ~/bots/tg/
chmod +x ~/bots/vk/respawn.sh ~/bots/tg/respawn.sh
```

Edit the vars at the top of each `respawn.sh`:

```bash
# vk
session=vk; workdir=/root/bots/vk
launch='exec claude --dangerously-load-development-channels plugin:vk@sukhrob-claude-plugins'
# tg
session=tg; workdir=/root/bots/tg
launch='exec claude --channels plugin:telegram@claude-plugins-official'
```

Then start:

```bash
loginctl enable-linger $USER   # non-root only: keep tmux alive after logout
~/bots/vk/respawn.sh
~/bots/tg/respawn.sh
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
