#!/usr/bin/env bash
# `npm run dev`: the app's page in a normal browser, with HMR, driving the real
# app. Starts the app headless with its dev bridge (`--features dev-bridge`,
# `app/src-tauri/src/bridge.rs`) and vite with `vite.dev.config.ts`, which
# proxies `/__bridge` to it, then prints the URL to open (it carries the
# bridge's token) and opens it when run from a terminal (`VISUALS_DEV_OPEN=0`
# doesn't). `npm run dev:lab` passes `--features lab` and `VITE_LAB=1`.
#
# As `app/run.sh`: both run in a process group of their own, and the whole group
# is stopped when this script ends, is stopped (Ctrl-C, SIGTERM, hangup) or its
# parent goes away.
set -u
cd "$(dirname "$0")/.." || exit 1

features=dev-bridge
if [ "${1:-}" = "--features" ] && [ -n "${2:-}" ]; then
	features="$2,dev-bridge"
fi

free_port() { node -e "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})"; }
PORT=${PORT:-$(free_port)}
BRIDGE_PORT=$(free_port)
VISUALS_BRIDGE="127.0.0.1:$BRIDGE_PORT"
VISUALS_BRIDGE_TOKEN=$(node -e "console.log(require('crypto').randomBytes(16).toString('hex'))")
# The app's own window is never shown: the browser is the window.
VISUALS_HEADLESS=1
export PORT VISUALS_BRIDGE VISUALS_BRIDGE_TOKEN VISUALS_HEADLESS

# The app crate compiles against dist-app/ (`tauri.conf.json`'s frontendDist).
if [ ! -f dist-app/index.html ]; then
	npm run app:build-ui || exit 1
fi

set -m
(
	node_modules/.bin/vite --config vite.dev.config.ts --port "$PORT" --strictPort &
	cargo run -p visuals-app --features "$features" &
	wait
) </dev/null &
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

ancestry() {
	ps -axo pid=,ppid= | awk -v p="$PPID" '{ up[$1] = $2 } END { while (p > 1 && (p in up)) { printf "%s:%s ", p, up[p]; p = up[p] } }'
}
up() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

# Wait for the bridge (the first run builds the app, which takes a while), each
# second checking that the group and whoever started this script are still there.
started=$(ancestry)
until up "$BRIDGE_PORT"; do
	kill -0 "$group" 2>/dev/null || { wait "$group"; exit 1; }
	[ "$(ancestry)" = "$started" ] || { echo "app/dev.sh: what started it went away, stopping" >&2; exit 1; }
	sleep 1
done

url="http://127.0.0.1:$PORT/?token=$VISUALS_BRIDGE_TOKEN"
echo
echo "  visual[flow] dev: $url"
echo
if [ -t 1 ] && [ "${VISUALS_DEV_OPEN:-1}" != 0 ]; then
	open "$url"
fi

while kill -0 "$group" 2>/dev/null; do
	if [ "$(ancestry)" != "$started" ]; then
		echo "app/dev.sh: what started it went away, stopping" >&2
		exit 1
	fi
	sleep 1
done
wait "$group"
