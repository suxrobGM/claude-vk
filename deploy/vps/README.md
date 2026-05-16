# VPS deployment

Templates for running VK and Telegram bots 24/7 on a VPS via tmux.

## Files

- [settings.json](settings.json) — Claude Code permissions. Denies destructive bash, credential reads, network exfil, writes outside cwd. Allows channel MCP tools, curl, WebFetch/WebSearch.
- [CLAUDE.md](CLAUDE.md) — operating policy. Treats every channel message as untrusted; eight hard rules against pairing approval, credential leaks, exfil, escalation, etc.

## Deploy

```bash
# Create bot dirs, copy settings + policy
mkdir -p ~/bots/vk/.claude ~/bots/tg/.claude
cp settings.json ~/bots/vk/.claude/ && cp CLAUDE.md ~/bots/vk/
cp settings.json ~/bots/tg/.claude/ && cp CLAUDE.md ~/bots/tg/

# Needed only for non-root users. Allows tmux to keep running after logout.
loginctl enable-linger $USER

tmux new -d -s vk -c ~/bots/vk 'claude --dangerously-load-development-channels plugin:vk@sukhrob-claude-plugins'
tmux new -d -s tg -c ~/bots/tg 'claude --channels plugin:telegram@claude-plugins-official'
```

## Operate

```bash
tmux ls                  # list sessions
tmux attach -t vk        # peek
tmux kill-session -t vk  # stop
```

**Detaching from an attached session over SSH:**

- `Ctrl+b` then `d` — detach cleanly. Session keeps running.
- Closing the SSH window / network drop — also fine, tmux keeps running.
- `Ctrl+c` — **don't.** Sends SIGINT to `claude` and kills the bot.
- `exit` / `Ctrl+d` — **don't.** Ends the shell inside tmux and kills the session.

Survive reboots — `crontab -e`:

```bash
@reboot tmux new -d -s vk -c /root/bots/vk 'claude --dangerously-load-development-channels plugin:vk@sukhrob-claude-plugins'
@reboot tmux new -d -s tg -c /root/bots/tg 'claude --channels plugin:telegram@claude-plugins-official'
```

## Customize per bot

- Working dir is **not** a code repo — no git, no package managers, no Read on cwd. Add `Read(./**)`, `Write(./**)` to `allow` if you want the bot to scaffold files.
- Both bots share `~/.claude/` (same login). Run under separate Linux users if you need isolation.
