#!/usr/bin/env bash
# `npm run dev`: the app's page in a normal browser, with HMR, driving the real
# app, against the local zen, with Storybook. In this order:
#
#   1. Builds dist-app/ when it's missing (the app crate compiles against it;
#      `npm run app:build-ui`, before the link, so against the zen node_modules holds).
#   2. Links the local zen (`app/dev-zen.sh`'s `link_zen`):
#      `npm install --no-save "$ZEN_SOURCE"`, ZEN_SOURCE ~/Code/satoramoto/zen by
#      default, exported so vite and Storybook resolve zen to its source and
#      hot-reload it. With no checkout (or `ZEN_SOURCE=`) it says so and the run
#      uses the pinned zen.
#   3. The Storybooks (`app/dev-zen.sh`): zen's own launcher, unless a Storybook
#      already answers on `ZEN_STORYBOOK_PORT` (6022; its app on `ZEN_PREVIEW_PORT`,
#      4191), and this repo's Storybook on `STORYBOOK_PORT` (6006, or a free port)
#      with zen's composed in under "zen".
#   4. The app headless with its dev bridge (`--features dev-bridge`,
#      `app/src-tauri/src/bridge.rs`) and vite with `vite.dev.config.ts`, which
#      proxies `/__bridge` to it, on `PORT` (a free one otherwise).
#
# Then it prints what runs and the URLs to open (the page's carries the bridge's
# token) and opens the page when run from a terminal (`VISUALS_DEV_OPEN=0`
# doesn't). `npm run dev:lab` passes `--features lab` and `VITE_LAB=1`.
#
# As `app/run.sh`: what it started (the app with the cargo that builds it, vite,
# Storybook, zen's launcher) each runs in a process group of its own, and every
# one of those groups is stopped when this script ends, is stopped (Ctrl-C,
# SIGTERM, hangup) or its parent goes away; nothing it didn't start is stopped.
# When the app or vite ends by itself (the app fails to build, or quits), this
# script says so, stops the rest and exits 1; either Storybook ending by itself
# is reported and the rest keeps running. The zen link stays afterwards.
set -u
cd "$(dirname "$0")/.." || exit 1
ZEN_ME=app/dev.sh
. app/dev-zen.sh

features=dev-bridge
if [ "${1:-}" = "--features" ] && [ -n "${2:-}" ]; then
	features="$2,dev-bridge"
fi

# Written with process.stdout.write and colour off, so FORCE_COLOR (the desktop
# launcher sets it) can never wrap the value in colour codes.
plain_node() { NO_COLOR=1 FORCE_COLOR=0 node -e "$1"; }
need() {
	if ! [[ "$2" =~ $3 ]]; then
		echo "app/dev.sh: $1 is not valid: '$2'" >&2
		exit 1
	fi
}

# The app crate compiles against dist-app/ (`tauri.conf.json`'s frontendDist).
if [ ! -f dist-app/index.html ]; then
	npm run app:build-ui || exit 1
fi

link_zen

PORT=${PORT:-$(zen_free_port)}
BRIDGE_PORT=$(zen_free_port)
need PORT "$PORT" '^[0-9]+$'
need "the bridge's port" "$BRIDGE_PORT" '^[0-9]+$'
plan_storybooks
VISUALS_BRIDGE="127.0.0.1:$BRIDGE_PORT"
VISUALS_BRIDGE_TOKEN=$(plain_node "process.stdout.write(require('crypto').randomBytes(16).toString('hex'))")
need "the bridge's token" "$VISUALS_BRIDGE_TOKEN" '^[0-9a-f]{32}$'
# The app's own window is never shown: the browser is the window.
VISUALS_HEADLESS=1
export PORT VISUALS_BRIDGE VISUALS_BRIDGE_TOKEN VISUALS_HEADLESS

app=
vite=
stop() {
	trap - EXIT INT TERM HUP
	stop_group "$app"
	stop_group "$vite"
	stop_storybooks
	return 0
}
trap stop EXIT
trap 'stop; exit 130' INT
trap 'stop; exit 143' TERM
trap 'stop; exit 129' HUP

# Job control: each background job gets a process group of its own, whose id is
# its pid. Their input is /dev/null, so nothing in them waits on the terminal.
set -m
start_storybooks
node_modules/.bin/vite --config vite.dev.config.ts --port "$PORT" --strictPort </dev/null &
vite=$!
cargo run -p visuals-app --features "$features" </dev/null &
app=$!

ancestry() {
	ps -axo pid=,ppid= | awk -v p="$PPID" '{ up[$1] = $2 } END { while (p > 1 && (p in up)) { printf "%s:%s ", p, up[p]; p = up[p] } }'
}

# Exit 1, saying why, when the app or vite has ended, or whoever started this
# script has gone away; the EXIT trap stops the rest.
started=$(ancestry)
check() {
	if ! kill -0 "$app" 2>/dev/null; then
		wait "$app"
		echo "app/dev.sh: the app ended (cargo run exited with $?: a failed build, or the app quit; see above), stopping" >&2
		app=
		exit 1
	fi
	if ! kill -0 "$vite" 2>/dev/null; then
		wait "$vite"
		echo "app/dev.sh: vite ended (exit $?; see above), stopping" >&2
		vite=
		exit 1
	fi
	check_storybooks
	if [ "$(ancestry)" != "$started" ]; then
		echo "app/dev.sh: what started it went away, stopping" >&2
		exit 1
	fi
}

# Wait for the bridge (the first run builds the app, which takes a while).
until zen_port_taken "$BRIDGE_PORT"; do
	check
	sleep 1
done

url="http://127.0.0.1:$PORT/?token=$VISUALS_BRIDGE_TOKEN"
echo
echo "  visual[flow] dev: $url  (the app headless, the page in your browser)"
print_storybooks
echo
if [ -t 1 ] && [ "${VISUALS_DEV_OPEN:-1}" != 0 ]; then
	open "$url"
fi

while true; do
	check
	sleep 1
done
