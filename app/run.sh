#!/usr/bin/env bash
# `npm run app`: runs `cargo tauri dev` in app/src-tauri, which starts vite (the
# editor page) and then the app, with vite on PORT or a free port.
#
# They run in a process group of their own, and the whole group is stopped when
# this script ends, is stopped (Ctrl-C, SIGTERM, hangup) or its parent goes away,
# so killing this script never leaves vite, cargo-tauri or the app running.
set -u
cd "$(dirname "$0")/src-tauri" || exit 1

PORT=${PORT:-$(node -e "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})")}
export PORT

# Job control: the background job below gets a process group of its own, whose
# id is its pid. Its input is /dev/null, so nothing in it waits on the terminal.
set -m
cargo tauri dev --config "{\"build\":{\"devUrl\":\"http://127.0.0.1:$PORT\"}}" </dev/null &
group=$!

stop() {
	trap - EXIT INT TERM HUP
	kill -TERM -- "-$group" 2>/dev/null || return 0
	for _ in 1 2 3 4 5 6 7 8 9 10; do
		kill -0 -- "-$group" 2>/dev/null || return 0
		sleep 0.5
	done
	kill -KILL -- "-$group" 2>/dev/null
	return 0
}
trap stop EXIT
trap 'stop; exit 130' INT
trap 'stop; exit 143' TERM
trap 'stop; exit 129' HUP

# The processes that started this script, each with its parent, up to launchd:
# when one of them dies, the chain changes (npm, say, outliving the shell that
# ran it is handed to launchd).
ancestry() {
	ps -axo pid=,ppid= | awk -v p="$PPID" '{ up[$1] = $2 } END { while (p > 1 && (p in up)) { printf "%s:%s ", p, up[p]; p = up[p] } }'
}

# Wait for cargo-tauri, checking each second that whoever started this script
# is still there (macOS has no way to be told when a parent dies).
started=$(ancestry)
while kill -0 "$group" 2>/dev/null; do
	if [ "$(ancestry)" != "$started" ]; then
		echo "app/run.sh: what started it went away, stopping" >&2
		exit 1
	fi
	sleep 1
done
wait "$group"
