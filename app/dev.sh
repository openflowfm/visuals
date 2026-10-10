#!/usr/bin/env bash
# `npm run dev`: the app's page in a normal browser, with HMR, driving the real
# app. Starts the app headless with its dev bridge (`--features dev-bridge`,
# `app/src-tauri/src/bridge.rs`) and vite with `vite.dev.config.ts`, which
# proxies `/__bridge` to it, then prints the URL to open (it carries the
# bridge's token) and opens it when run from a terminal (`VISUALS_DEV_OPEN=0`
# doesn't). It also starts Storybook on `STORYBOOK_PORT` (6006 by default, or
# a free port when that one is taken); Storybook ending by itself is reported
# but doesn't stop the rest. The page's port is `PORT` (a free one otherwise).
# `npm run dev:lab` passes `--features lab` and `VITE_LAB=1`.
#
# As `app/run.sh`: the app (with the cargo that builds it) and vite each run in
# a process group of their own, and both groups are stopped when this script
# ends, is stopped (Ctrl-C, SIGTERM, hangup) or its parent goes away. When
# either of them ends by itself (the app fails to build, or quits), this script
# says so, stops the other and exits 1.
set -u
cd "$(dirname "$0")/.." || exit 1

features=dev-bridge
if [ "${1:-}" = "--features" ] && [ -n "${2:-}" ]; then
	features="$2,dev-bridge"
fi

# Written with process.stdout.write and colour off, so FORCE_COLOR (the desktop
# launcher sets it) can never wrap the value in colour codes.
plain_node() { NO_COLOR=1 FORCE_COLOR=0 node -e "$1"; }
free_port() { plain_node "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close()})"; }
need() {
	if ! [[ "$2" =~ $3 ]]; then
		echo "app/dev.sh: $1 is not valid: '$2'" >&2
		exit 1
	fi
}
PORT=${PORT:-$(free_port)}
BRIDGE_PORT=$(free_port)
port_taken() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
STORYBOOK_PORT=${STORYBOOK_PORT:-6006}
need STORYBOOK_PORT "$STORYBOOK_PORT" '^[0-9]+$'
if port_taken "$STORYBOOK_PORT" || [ "$STORYBOOK_PORT" = "$PORT" ]; then
	STORYBOOK_PORT=$(free_port)
fi
need PORT "$PORT" '^[0-9]+$'
need "the bridge's port" "$BRIDGE_PORT" '^[0-9]+$'
need "Storybook's port" "$STORYBOOK_PORT" '^[0-9]+$'
VISUALS_BRIDGE="127.0.0.1:$BRIDGE_PORT"
VISUALS_BRIDGE_TOKEN=$(plain_node "process.stdout.write(require('crypto').randomBytes(16).toString('hex'))")
need "the bridge's token" "$VISUALS_BRIDGE_TOKEN" '^[0-9a-f]{32}$'
# The app's own window is never shown: the browser is the window.
VISUALS_HEADLESS=1
export PORT VISUALS_BRIDGE VISUALS_BRIDGE_TOKEN VISUALS_HEADLESS

# The app crate compiles against dist-app/ (`tauri.conf.json`'s frontendDist).
if [ ! -f dist-app/index.html ]; then
	npm run app:build-ui || exit 1
fi

# Job control: each background job gets a process group of its own, whose id is
# its pid. Their input is /dev/null, so nothing in them waits on the terminal.
set -m
node_modules/.bin/vite --config vite.dev.config.ts --port "$PORT" --strictPort </dev/null &
vite=$!
cargo run -p visuals-app --features "$features" </dev/null &
app=$!
PORT="$STORYBOOK_PORT" node_modules/.bin/storybook dev --ci --no-open -p "$STORYBOOK_PORT" </dev/null &
storybook=$!

stop_group() {
	kill -TERM -- "-$1" 2>/dev/null || return 0
	for _ in 1 2 3 4 5 6 7 8 9 10; do
		kill -0 -- "-$1" 2>/dev/null || return 0
		sleep 0.5
	done
	kill -KILL -- "-$1" 2>/dev/null
	return 0
}
stop() {
	trap - EXIT INT TERM HUP
	stop_group "$app"
	stop_group "$vite"
	[ -n "$storybook" ] && stop_group "$storybook"
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

# Exit 1, saying why, when the app or vite has ended, or whoever started this
# script has gone away; the EXIT trap stops the rest.
started=$(ancestry)
check() {
	if ! kill -0 "$app" 2>/dev/null; then
		wait "$app"
		echo "app/dev.sh: the app ended (cargo run exited with $?: a failed build, or the app quit; see above), stopping" >&2
		exit 1
	fi
	if ! kill -0 "$vite" 2>/dev/null; then
		wait "$vite"
		echo "app/dev.sh: vite ended (exit $?; see above), stopping" >&2
		exit 1
	fi
	if [ -n "$storybook" ] && ! kill -0 "$storybook" 2>/dev/null; then
		wait "$storybook"
		echo "app/dev.sh: Storybook ended (exit $?; see above); the app and the page keep running" >&2
		storybook=
	fi
	if [ "$(ancestry)" != "$started" ]; then
		echo "app/dev.sh: what started it went away, stopping" >&2
		exit 1
	fi
}

# Wait for the bridge (the first run builds the app, which takes a while).
until up "$BRIDGE_PORT"; do
	check
	sleep 1
done

url="http://127.0.0.1:$PORT/?token=$VISUALS_BRIDGE_TOKEN"
echo
echo "  visual[flow] dev: $url"
echo "  Storybook:        http://127.0.0.1:$STORYBOOK_PORT/"
echo
if [ -t 1 ] && [ "${VISUALS_DEV_OPEN:-1}" != 0 ]; then
	open "$url"
fi

while true; do
	check
	sleep 1
done
