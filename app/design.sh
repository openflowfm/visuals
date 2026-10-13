#!/usr/bin/env bash
# `npm run design`: work on the app's UI (`app/src/ui/`) and zen together, in
# one Storybook window, with zen's source hot-reloaded. Needs `ZEN_SOURCE`, the
# zen checkout (e.g. `ZEN_SOURCE=~/Code/satoramoto/zen npm run design`). It runs,
# in this order:
#
#   1. `npm install --no-save "$ZEN_SOURCE"`: node_modules/@satoramoto/zen
#      becomes a link to the checkout (the next plain `npm install` puts the
#      pinned GitHub build back).
#   2. Unless something already answers on 6022 (zen's Storybook, run by its
#      owner, is reused and never stopped here):
#      `PREVIEW_LABEL=Zen PREVIEW_PORT=4191 STORYBOOK_PORT=6022 npm --prefix "$ZEN_SOURCE" run dev`,
#      zen's own launcher (its app on 4191, its Storybook on 6022).
#   3. `ZEN_SOURCE=… storybook dev --ci --no-open --host 127.0.0.1 -p 6006`:
#      this repo's Storybook, which with `ZEN_SOURCE` set resolves zen to the
#      checkout's source (`zen-source`, `vite.app.config.ts`) and composes zen's
#      Storybook in from http://localhost:6022 (`.storybook/main.ts`'s `refs`).
#      `STORYBOOK_PORT` picks another port than 6006; it exits 1, before
#      starting anything, when that port is taken.
#
# Then it prints the one URL to open. What it started (2 and 3) runs in process
# groups of its own and is stopped when this script ends, is stopped (Ctrl-C,
# SIGTERM, hangup), or either of them ends by itself (exit 1).
set -u
cd "$(dirname "$0")/.." || exit 1

if [ -z "${ZEN_SOURCE:-}" ]; then
	echo 'usage: ZEN_SOURCE=<zen checkout> npm run design   (e.g. ZEN_SOURCE=~/Code/satoramoto/zen)' >&2
	exit 2
fi
ZEN_SOURCE=${ZEN_SOURCE/#\~/$HOME}
if [ ! -f "$ZEN_SOURCE/package.json" ] || ! grep -q '"name": "@satoramoto/zen"' "$ZEN_SOURCE/package.json"; then
	echo "app/design.sh: ZEN_SOURCE is not a zen checkout: '$ZEN_SOURCE'" >&2
	exit 2
fi
ZEN_SOURCE=$(cd "$ZEN_SOURCE" && pwd -P)
export ZEN_SOURCE

ZEN_STORYBOOK_PORT=6022
STORYBOOK_PORT=${STORYBOOK_PORT:-6006}
if ! [[ "$STORYBOOK_PORT" =~ ^[0-9]+$ ]]; then
	echo "app/design.sh: STORYBOOK_PORT is not valid: '$STORYBOOK_PORT'" >&2
	exit 2
fi
up() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

if up "$STORYBOOK_PORT"; then
	echo "app/design.sh: port $STORYBOOK_PORT is taken (another Storybook?); stop it first" >&2
	exit 1
fi

echo "app/design.sh: npm install --no-save $ZEN_SOURCE"
npm install --no-save "$ZEN_SOURCE" >/dev/null || exit 1

# Job control: each background job gets a process group of its own, whose id is
# its pid. Their input is /dev/null, so nothing in them waits on the terminal.
set -m
zen=
storybook=
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
	[ -n "$storybook" ] && stop_group "$storybook"
	[ -n "$zen" ] && stop_group "$zen"
	return 0
}
trap stop EXIT
trap 'stop; exit 130' INT
trap 'stop; exit 143' TERM
trap 'stop; exit 129' HUP

if up "$ZEN_STORYBOOK_PORT"; then
	echo "app/design.sh: zen's Storybook is already on $ZEN_STORYBOOK_PORT; using it"
else
	echo "app/design.sh: PREVIEW_LABEL=Zen PREVIEW_PORT=4191 STORYBOOK_PORT=$ZEN_STORYBOOK_PORT npm --prefix $ZEN_SOURCE run dev"
	PREVIEW_LABEL=Zen PREVIEW_PORT=4191 STORYBOOK_PORT=$ZEN_STORYBOOK_PORT npm --prefix "$ZEN_SOURCE" run dev </dev/null &
	zen=$!
fi

echo "app/design.sh: storybook dev --ci --no-open --host 127.0.0.1 -p $STORYBOOK_PORT"
PORT=$STORYBOOK_PORT node_modules/.bin/storybook dev --ci --no-open --host 127.0.0.1 -p "$STORYBOOK_PORT" </dev/null &
storybook=$!

# Exit 1, saying why, when something this script started has ended by itself.
check() {
	if [ -n "$zen" ] && ! kill -0 "$zen" 2>/dev/null; then
		wait "$zen"
		echo "app/design.sh: zen's launcher ended (exit $?; see above), stopping" >&2
		zen=
		exit 1
	fi
	if ! kill -0 "$storybook" 2>/dev/null; then
		wait "$storybook"
		echo "app/design.sh: Storybook ended (exit $?; see above), stopping" >&2
		storybook=
		exit 1
	fi
}

until up "$STORYBOOK_PORT" && up "$ZEN_STORYBOOK_PORT"; do
	check
	sleep 1
done
echo
echo "  Open http://127.0.0.1:$STORYBOOK_PORT  (visual[flow]'s stories, with zen's under \"zen\" from http://localhost:$ZEN_STORYBOOK_PORT)"
echo "  Ctrl-C stops what this started. A plain \`npm install\` afterwards puts the pinned zen back."
echo
while true; do
	check
	sleep 1
done
