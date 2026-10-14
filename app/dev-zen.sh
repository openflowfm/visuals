# Sourced, from the repo's root, by `app/dev.sh` (`npm run dev`, `dev:lab`) and
# by `app/run.sh` when `VISUALS_DEV_APP=1` (`npm run dev:app`, `dev:app:lab`):
# the local zen, linked so its source hot-reloads, and the two Storybooks.
# `ZEN_ME` names the script in what these print.
#
# `link_zen` reads `ZEN_SOURCE`, the zen checkout. Unset, it is
# ~/Code/satoramoto/zen when that checkout exists; set empty (`ZEN_SOURCE=`), or
# unset with no checkout there, the run uses the pinned zen and says so. With a
# checkout it runs `npm install --no-save "$ZEN_SOURCE"` (node_modules/@satoramoto/zen
# becomes a link to it; skipped when it already is) and exports `ZEN_SOURCE`, which
# `vite.app.config.ts` and `.storybook/main.ts` read (zen's `zen-source` export
# condition). Without one it unsets `ZEN_SOURCE`. The link stays after the run;
# a plain `npm install` puts the pinned build back. Exits 2 when `ZEN_SOURCE`
# names something that isn't a zen checkout, 1 when the install fails.
#
# `plan_storybooks` (after `link_zen`, before starting anything) picks the ports:
# with a local zen, zen's Storybook on `ZEN_STORYBOOK_PORT` (6022) is reused when a
# Storybook already answers `/index.json` there, and otherwise zen's launcher will
# start it (its app on `ZEN_PREVIEW_PORT`, 4191); it exits 1 when one of those is
# taken by something else. A run that finds another starting zen's launcher on
# the same port (a lock in $TMPDIR) waits for that Storybook and reuses it. This
# repo's Storybook goes on `STORYBOOK_PORT` (6006, or
# a free port when that one is taken or is one of the others, `PORT` among them).
#
# `start_storybooks` (with `set -m` on and `stop_storybooks` in the caller's
# traps) starts zen's launcher when planned,
# `PREVIEW_LABEL=Zen PREVIEW_PORT=$ZEN_PREVIEW_PORT STORYBOOK_PORT=$ZEN_STORYBOOK_PORT npm --prefix "$ZEN_SOURCE" run dev`,
# and this repo's Storybook, composing zen's in under "zen" (`ZEN_STORYBOOK_URL`),
# each in a process group of its own. `stop_storybooks` stops only those groups.
# `check_storybooks` reports either one's leader ending by itself and stops what
# is left of its group (a group's id stays its own while any member lives); the
# rest keeps running. This repo's Storybook listens on
# 127.0.0.1 only.

zen_free_port() { NO_COLOR=1 FORCE_COLOR=0 node -e "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close()})"; }
zen_port_taken() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
zen_is_storybook() { curl -fs -o /dev/null --max-time 2 "http://127.0.0.1:$1/index.json"; }
zen_need_port() {
	if ! [[ "$2" =~ ^[0-9]+$ ]]; then
		echo "$ZEN_ME: $1 is not valid: '$2'" >&2
		exit 1
	fi
}

link_zen() {
	local linked pinned
	if [ -z "${ZEN_SOURCE+set}" ]; then
		if [ -f "$HOME/Code/satoramoto/zen/package.json" ]; then
			ZEN_SOURCE=$HOME/Code/satoramoto/zen
		else
			ZEN_SOURCE=
		fi
	fi
	if [ -z "$ZEN_SOURCE" ]; then
		unset ZEN_SOURCE
		echo "$ZEN_ME: no local zen (ZEN_SOURCE empty, or no ~/Code/satoramoto/zen): using the pinned zen"
		if [ -L node_modules/@satoramoto/zen ]; then
			echo "$ZEN_ME: node_modules/@satoramoto/zen still links $(cd node_modules/@satoramoto/zen && pwd -P) from an earlier run; a plain \`npm install\` puts the pinned build back" >&2
		fi
		return 0
	fi
	ZEN_SOURCE=${ZEN_SOURCE/#\~/$HOME}
	if [ ! -f "$ZEN_SOURCE/package.json" ] || ! grep -q '"name": "@satoramoto/zen"' "$ZEN_SOURCE/package.json"; then
		echo "$ZEN_ME: ZEN_SOURCE is not a zen checkout: '$ZEN_SOURCE' (ZEN_SOURCE= runs against the pinned zen)" >&2
		exit 2
	fi
	ZEN_SOURCE=$(cd "$ZEN_SOURCE" && pwd -P)
	export ZEN_SOURCE
	linked=
	if [ -L node_modules/@satoramoto/zen ]; then
		linked=$(cd node_modules/@satoramoto/zen 2>/dev/null && pwd -P)
	fi
	if [ "$linked" != "$ZEN_SOURCE" ]; then
		echo "$ZEN_ME: npm install --no-save $ZEN_SOURCE"
		npm install --no-save "$ZEN_SOURCE" >/dev/null || exit 1
	fi
	echo "$ZEN_ME: zen is the local checkout $ZEN_SOURCE, hot-reloaded. The link stays after this run; a plain \`npm install\` puts the pinned zen back."
	# The app is written against the pinned zen: say so when the checkout doesn't have it yet.
	pinned=$(sed -n 's|.*"@satoramoto/zen": "github:satoramoto/zen#\([0-9a-f]*\)".*|\1|p' package.json)
	if [ -n "$pinned" ] && ! git -C "$ZEN_SOURCE" merge-base --is-ancestor "$pinned" HEAD 2>/dev/null; then
		echo "$ZEN_ME: the zen checkout's HEAD doesn't contain the pinned zen ($pinned); pull it, or parts the app uses may be missing" >&2
	fi
}

start_zen=
zen_launcher=
storybook=
zen_lock=

# Another run may be starting zen's launcher on the same port, its Storybook not
# answering yet: a lock (a symlink naming the starting run's pid, so taking it is
# one atomic step) makes the later run wait for that Storybook and reuse it,
# instead of starting a second launcher that finds the ports occupied. A lock
# whose run is gone is stale and taken over. Returns with the lock held, or once
# a Storybook answers; exits 1 after two minutes of neither.
zen_take_lock() {
	local lock owner waited=0
	lock="${TMPDIR:-/tmp}/visuals-zen-storybook-$ZEN_STORYBOOK_PORT.lock"
	while :; do
		if ln -s "$$" "$lock" 2>/dev/null; then
			zen_lock=$lock
			return 0
		fi
		owner=$(readlink "$lock" 2>/dev/null) || continue
		if ! kill -0 "$owner" 2>/dev/null; then
			rm -f "$lock"
			continue
		fi
		zen_is_storybook "$ZEN_STORYBOOK_PORT" && return 0
		if [ "$waited" = 0 ]; then
			echo "$ZEN_ME: another run (pid $owner) is starting zen's Storybook on $ZEN_STORYBOOK_PORT; waiting for it"
		fi
		if [ "$waited" -ge 120 ]; then
			echo "$ZEN_ME: zen's Storybook on $ZEN_STORYBOOK_PORT didn't answer within two minutes of another run (pid $owner) starting it; stop that run or pick another ZEN_STORYBOOK_PORT" >&2
			exit 1
		fi
		sleep 1
		waited=$((waited + 1))
	done
}
# Lets the lock go, when this run holds it.
zen_release_lock() {
	[ -n "$zen_lock" ] || return 0
	[ "$(readlink "$zen_lock" 2>/dev/null)" = "$$" ] && rm -f "$zen_lock"
	zen_lock=
	return 0
}

plan_storybooks() {
	if [ -n "${ZEN_SOURCE:-}" ]; then
		ZEN_STORYBOOK_PORT=${ZEN_STORYBOOK_PORT:-6022}
		ZEN_PREVIEW_PORT=${ZEN_PREVIEW_PORT:-4191}
		zen_need_port ZEN_STORYBOOK_PORT "$ZEN_STORYBOOK_PORT"
		zen_need_port ZEN_PREVIEW_PORT "$ZEN_PREVIEW_PORT"
		zen_take_lock
		if zen_is_storybook "$ZEN_STORYBOOK_PORT"; then
			zen_release_lock
			echo "$ZEN_ME: a Storybook already answers on $ZEN_STORYBOOK_PORT; composing it in as zen's"
		elif zen_port_taken "$ZEN_STORYBOOK_PORT"; then
			zen_release_lock
			echo "$ZEN_ME: port $ZEN_STORYBOOK_PORT (ZEN_STORYBOOK_PORT) is taken by something that isn't a Storybook; free it or pick another" >&2
			exit 1
		elif zen_port_taken "$ZEN_PREVIEW_PORT"; then
			zen_release_lock
			echo "$ZEN_ME: port $ZEN_PREVIEW_PORT (ZEN_PREVIEW_PORT) is taken; free it or pick another" >&2
			exit 1
		else
			start_zen=1
		fi
		ZEN_STORYBOOK_URL="http://localhost:$ZEN_STORYBOOK_PORT"
		export ZEN_STORYBOOK_URL
	fi
	STORYBOOK_PORT=${STORYBOOK_PORT:-6006}
	zen_need_port STORYBOOK_PORT "$STORYBOOK_PORT"
	if zen_port_taken "$STORYBOOK_PORT" || [ "$STORYBOOK_PORT" = "${PORT:-}" ] || [ "$STORYBOOK_PORT" = "${ZEN_STORYBOOK_PORT:-}" ] || [ "$STORYBOOK_PORT" = "${ZEN_PREVIEW_PORT:-}" ]; then
		STORYBOOK_PORT=$(zen_free_port)
		zen_need_port "Storybook's port" "$STORYBOOK_PORT"
	fi
}

start_storybooks() {
	if [ -n "$start_zen" ]; then
		echo "$ZEN_ME: PREVIEW_LABEL=Zen PREVIEW_PORT=$ZEN_PREVIEW_PORT STORYBOOK_PORT=$ZEN_STORYBOOK_PORT npm --prefix $ZEN_SOURCE run dev"
		PREVIEW_LABEL=Zen PREVIEW_PORT=$ZEN_PREVIEW_PORT STORYBOOK_PORT=$ZEN_STORYBOOK_PORT npm --prefix "$ZEN_SOURCE" run dev </dev/null &
		zen_launcher=$!
	fi
	echo "$ZEN_ME: storybook dev --ci --no-open --host 127.0.0.1 -p $STORYBOOK_PORT"
	PORT="$STORYBOOK_PORT" node_modules/.bin/storybook dev --ci --no-open --host 127.0.0.1 -p "$STORYBOOK_PORT" </dev/null &
	storybook=$!
}

# Stops one process group (TERM, then KILL after five seconds); nothing for an empty id.
stop_group() {
	[ -n "$1" ] || return 0
	kill -TERM -- "-$1" 2>/dev/null || return 0
	for _ in 1 2 3 4 5 6 7 8 9 10; do
		kill -0 -- "-$1" 2>/dev/null || return 0
		sleep 0.5
	done
	kill -KILL -- "-$1" 2>/dev/null
	return 0
}
stop_storybooks() {
	stop_group "$storybook"
	stop_group "$zen_launcher"
	zen_release_lock
}

check_storybooks() {
	if [ -n "$storybook" ] && ! kill -0 "$storybook" 2>/dev/null; then
		stop_group "$storybook"
		wait "$storybook"
		echo "$ZEN_ME: Storybook ended (exit $?; see above); the rest keeps running" >&2
		storybook=
	fi
	if [ -n "$zen_launcher" ] && ! kill -0 "$zen_launcher" 2>/dev/null; then
		stop_group "$zen_launcher"
		wait "$zen_launcher"
		echo "$ZEN_ME: zen's launcher ended (exit $?; see above); the rest keeps running, without zen's stories" >&2
		zen_launcher=
		zen_release_lock
	fi
}

print_storybooks() {
	if [ -n "${ZEN_SOURCE:-}" ]; then
		echo "  Storybook:        http://127.0.0.1:$STORYBOOK_PORT/  (zen's stories under \"zen\", from $ZEN_STORYBOOK_URL)"
		echo "  zen:              $ZEN_SOURCE, hot-reloaded"
	else
		echo "  Storybook:        http://127.0.0.1:$STORYBOOK_PORT/  (pinned zen)"
	fi
}
