#!/usr/bin/env bash
# `npm run app`: runs `cargo tauri dev` in app/src-tauri, which starts vite (the
# editor page) and then the app, with vite on PORT or a free port, against the
# zen node_modules holds (the pinned one after a plain `npm install`).
#
# `npm run dev:app` is the same with `VISUALS_DEV_APP=1`, which first, as
# `npm run dev` does (`app/dev-zen.sh`), links the local zen
# (`npm install --no-save "$ZEN_SOURCE"`, ZEN_SOURCE ~/Code/satoramoto/zen by
# default), so vite resolves zen to its source and hot-reloads it in the app's
# window, and starts the Storybooks: zen's launcher unless a Storybook already
# answers on `ZEN_STORYBOOK_PORT` (6022), and this repo's on `STORYBOOK_PORT`
# (6006, or a free port) with zen's composed in under "zen". It prints what runs
# and the Storybook URL. Storybook ending by itself is reported; the app keeps
# running.
#
# Each runs in a process group of its own, and every group it started is stopped
# when this script ends (the app quits), is stopped (Ctrl-C, SIGTERM, hangup) or
# its parent goes away, so killing this script never leaves vite, cargo-tauri,
# the app or a Storybook running.
set -u
cd "$(dirname "$0")/.." || exit 1
ZEN_ME=app/run.sh
. app/dev-zen.sh

PORT=${PORT:-$(zen_free_port)}
export PORT

dev_app=
if [ "${VISUALS_DEV_APP:-}" = 1 ]; then
	dev_app=1
	link_zen
	plan_storybooks
fi

group=
stop() {
	trap - EXIT INT TERM HUP
	stop_group "$group"
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
if [ -n "$dev_app" ]; then
	start_storybooks
fi
(cd app/src-tauri && exec cargo tauri dev --config "{\"build\":{\"devUrl\":\"http://127.0.0.1:$PORT\"}}" "$@") </dev/null &
group=$!

if [ -n "$dev_app" ]; then
	echo
	echo "  visual[flow] dev:app: the app's window (cargo tauri dev), its page on http://127.0.0.1:$PORT/, hot-reloaded"
	print_storybooks
	echo
fi

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
	check_storybooks
	sleep 1
done
wait "$group"
