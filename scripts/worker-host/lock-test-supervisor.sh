#!/bin/sh
# Job 002e2: a HARMLESS stand-in for host-launch.mjs, used only by lock-primitive-harness.sh. The
# real `launch` script execs into it (test mode, non-root only), exactly as it execs into the
# launcher, so this process holds the lifecycle lock on fd 9. It records its PID, optionally
# starts a "daemon" (a plain sleep, standing for a daemonized Firecracker) either INHERITING fd 9
# or with fd 9 closed the way host-launch.mjs starts the jailer, then sleeps. Nothing else.
#   lock-test-supervisor.sh <dir> <verb>   (reads <dir>/supervisor.conf: SLEEP=<s> DAEMON=none|inherit|closed)
set -eu
DIR=$1
SLEEP=5; DAEMON=none
. "$DIR/supervisor.conf"
echo $$ > "$DIR/sup.pid"
case "$DAEMON" in
  inherit) setsid sleep 30 & echo $! > "$DIR/daemon.pid" ;;
  # The same descriptor-closing form as host-launch.mjs's CLOSE_LOCK_FD.
  closed) sh -c 'exec 9>&-; exec "$@"' sh setsid sleep 30 & echo $! > "$DIR/daemon.pid" ;;
esac
exec sleep "$SLEEP"
