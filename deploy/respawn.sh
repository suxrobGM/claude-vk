#!/usr/bin/env bash
# Respawn a Claude Code channel bot in tmux if its session has died.
# Run from cron. Copy one per bot dir and edit the three vars below.
#
# Two non-obvious things this gets right:
#   - Logs via `tmux pipe-pane`. Redirecting Claude's
#     stdout makes it think it has no terminal, so it drops into --print mode and
#     exits immediately. pipe-pane taps the pane without touching Claude's stdio.
#   - Presses Enter for the --dangerously-load-development-channels confirm prompt
#     that appears on every launch. Harmless no-op when launching with --channels.
set -u
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/root/.local/bin

session=vk
workdir=/root/bots/vk
launch='exec claude --dangerously-load-development-channels plugin:vk@sukhrob-claude-plugins'

# Already running -> nothing to do. On a crash the pane process (Claude) exits,
# tmux destroys the session, this test fails, and we relaunch below.
tmux has-session -t "$session" 2>/dev/null && exit 0

tmux new -d -s "$session" -c "$workdir" "$launch"
tmux pipe-pane -t "$session" -o "cat >> $workdir/bot.log"

for _ in $(seq 1 20); do
  if tmux capture-pane -p -t "$session" 2>/dev/null | grep -q "local development"; then
    tmux send-keys -t "$session" Enter
    break
  fi
  sleep 1
done
