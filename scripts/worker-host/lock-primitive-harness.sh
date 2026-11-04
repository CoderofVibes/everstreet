#!/bin/sh
# Job 002e2: a FINITE, UNPRIVILEGED harness for the worker's lifecycle lock, with REAL processes
# and the REAL kernel flock(2) on an existing Linux (WSL Ubuntu): the real `launch` script (its
# non-root test hooks) and the real `setup.sh uninstall` (in a fake root), a harmless stand-in
# supervisor (lock-test-supervisor.sh), plain `sleep` children, one temporary directory; every
# PID it starts is recorded and killed on exit (only if it is still one of ours). No sudo, root,
# package, ACL, netns, cgroup, systemd, download, generated code or VM. NOT engine conformance.
# Case 6 is Astra's stale-uninstaller sequence; EVERSTREET_OLD_SETUP=<dir with a pre-fix setup.sh
# and worker.lock.json> also runs it against that copy, which must violate the invariant.
#   timeout 150 sh scripts/worker-host/lock-primitive-harness.sh
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
[ "$(id -u)" != 0 ] || { echo "run as an ordinary user"; exit 2; }
D=$(mktemp -d /tmp/everstreet-lock-harness.XXXXXX)
PIDS=""
track() { PIDS="$PIDS $1"; }
ours() { case "$({ tr '\0' ' ' < "/proc/$1/cmdline"; } 2>/dev/null)" in *sleep*|*lock-test-supervisor*|*flock*|*launch*|*setup.sh*) return 0 ;; esac; return 1; }
cleanup() {
  for p in $PIDS $(cat "$D"/*.pid 2>/dev/null); do ours "$p" && kill -9 "$p" 2>/dev/null; done
  chmod -R u+w "$D" 2>/dev/null
  rm -rf "$D"
}
trap cleanup EXIT
trap 'exit 124' INT TERM
FAILS=0
pass() { echo "ok    $*"; }
fail() { echo "FAIL  $*"; FAILS=$((FAILS + 1)); }
waitfile() { i=0; while [ ! -s "$1" ] && [ $i -lt 50 ]; do sleep 0.1; i=$((i + 1)); done; [ -s "$1" ]; }
alive() { kill -0 "$1" 2>/dev/null; }

echo "flock: $(flock --version 2>&1 | head -1); kernel: $(uname -r); uid: $(id -u)"

# Every entrant is a SIMPLE command (so `$!` is its PID) through the real launch script.
export EVERSTREET_LOCK_TEST=1
export EVERSTREET_TEST_SUPERVISOR="sh $HERE/lock-test-supervisor.sh $D"
LAUNCH=$HERE/launch
LOCK=$D/lifecycle.flock
fresh() { rm -f "$D"/*.pid "$D/supervisor.conf"; : > "$LOCK"; echo '{}' > "$D/installed.json"; }
conf() { rm -f "$D/sup.pid" "$D/daemon.pid"; printf 'SLEEP=%s\nDAEMON=%s\n' "$1" "$2" > "$D/supervisor.conf"; }

# 1. Regression: the OLD `flock -o` pattern violates the invariant (Astra's reproduction).
fresh
flock -n -o -E 75 "$LOCK" sh -c 'echo $$ > "$1"; exec sleep 8' sh "$D/oldchild.pid" &
holder=$!; track "$holder"
waitfile "$D/oldchild.pid"; child=$(cat "$D/oldchild.pid"); track "$child"
flock -n -E 75 "$LOCK" true; before=$?
kill -9 "$holder"; wait "$holder" 2>/dev/null
flock -n -E 75 "$LOCK" true; after=$?
if [ "$before" = 75 ] && alive "$child" && [ "$after" = 0 ]; then
  pass "OLD -o pattern violates the invariant: flock parent killed, critical child alive, a second entrant acquired"
else fail "old-pattern reproduction didn't match (before=$before after=$after)"; fi
kill -9 "$child" 2>/dev/null; wait "$child" 2>/dev/null

# 2. New pattern: the holder IS the critical process; two entrants; SIGKILL releases.
fresh; conf 8 none
EVERSTREET_TEST_LOCKFILE=$LOCK sh "$LAUNCH" preflight > "$D/a.out" & a=$!; track "$a"
waitfile "$D/sup.pid"; sup=$(cat "$D/sup.pid")
[ "$sup" = "$a" ] && pass "the lock holder is the critical process itself (same PID $a; no separate holder)" \
  || fail "supervisor PID $sup differs from the entrant PID $a"
b_out=$(EVERSTREET_TEST_LOCKFILE=$LOCK sh "$LAUNCH" preflight); b=$?
case "$b_out" in *'"busy":true'*) busy=1 ;; *) busy=0 ;; esac
[ "$b" = 75 ] && [ "$busy" = 1 ] && pass "a second entrant is refused (75, busy) while the critical process lives" \
  || fail "second entrant not refused (rc=$b $b_out)"
kill -9 "$sup"; wait "$a" 2>/dev/null
conf 1 none
c_out=$(EVERSTREET_TEST_LOCKFILE=$LOCK sh "$LAUNCH" preflight); c=$?
[ "$c" = 0 ] && pass "SIGKILL of the critical process released the lock (a new entrant was admitted)" \
  || fail "lock not released after SIGKILL (rc=$c $c_out)"

# 3. Normal end releases. Wrapper failure (no lock file) is distinct from a critical child failing.
fresh; conf 1 none
EVERSTREET_TEST_LOCKFILE=$LOCK sh "$LAUNCH" preflight > /dev/null
conf 1 none
EVERSTREET_TEST_LOCKFILE=$LOCK sh "$LAUNCH" preflight > /dev/null; e=$?
[ "$e" = 0 ] && pass "a normally ended critical process releases the lock" || fail "no release after normal end (rc=$e)"
rm -f "$LOCK"; conf 5 none
w_out=$(EVERSTREET_TEST_LOCKFILE=$LOCK sh "$LAUNCH" preflight); w=$?
[ "$w" = 69 ] && [ ! -e "$D/sup.pid" ] && pass "wrapper failure (no lock file): 69, no critical process started, no lock taken" \
  || fail "wrapper failure handled wrongly (rc=$w $w_out)"
fresh; printf 'SLEEP=notanumber\nDAEMON=none\n' > "$D/supervisor.conf"; rm -f "$D/sup.pid"
EVERSTREET_TEST_LOCKFILE=$LOCK sh "$LAUNCH" preflight > /dev/null 2>&1; x=$?
conf 1 none
EVERSTREET_TEST_LOCKFILE=$LOCK sh "$LAUNCH" preflight > /dev/null; y=$?
[ "$x" != 0 ] && [ "$x" != 69 ] && [ "$x" != 75 ] && [ "$y" = 0 ] \
  && pass "critical child failure (rc=$x, after admission) is reported as its own exit status and releases the lock" \
  || fail "critical child failure handled wrongly (rc=$x, next=$y)"

# 4. Descendants: an INHERITING daemon keeps the lock (the hazard); a fd-9-closed daemon doesn't.
fresh; conf 8 inherit
EVERSTREET_TEST_LOCKFILE=$LOCK sh "$LAUNCH" preflight > /dev/null & a=$!; track "$a"
waitfile "$D/daemon.pid"; dpid=$(cat "$D/daemon.pid"); track "$dpid"
kill -9 "$a"; wait "$a" 2>/dev/null
conf 1 none
EVERSTREET_TEST_LOCKFILE=$LOCK sh "$LAUNCH" preflight > /dev/null; h=$?
[ "$h" = 75 ] && alive "$dpid" && pass "hazard shown: a daemon that INHERITS fd 9 keeps the lock after its supervisor is killed" \
  || fail "inheritance hazard not shown (rc=$h)"
kill -9 "$dpid" 2>/dev/null; sleep 0.2
fresh; conf 8 closed
EVERSTREET_TEST_LOCKFILE=$LOCK sh "$LAUNCH" preflight > /dev/null & a=$!; track "$a"
waitfile "$D/daemon.pid"; dpid=$(cat "$D/daemon.pid"); track "$dpid"
kill -9 "$a"; wait "$a" 2>/dev/null
conf 1 none
EVERSTREET_TEST_LOCKFILE=$LOCK sh "$LAUNCH" preflight > /dev/null; k=$?
[ "$k" = 0 ] && alive "$dpid" && pass "a daemon started with fd 9 closed (host-launch's jailer form) does NOT keep the lock; it remains an orphan for cleanup" \
  || fail "closed-fd daemon kept the lock (rc=$k)"
kill -9 "$dpid" 2>/dev/null

# 5. Uninstall (real setup.sh, fake root) shares the lock; pending entrants on a removed or
#    replaced inode refuse; an interrupted teardown keeps its record and holds nothing.
S=$D/root; M=$S/var/lib/everstreet-worker; RLOCK=$M/lifecycle.flock
mkroot() {
  rm -rf "$S"; mkdir -p "$M" "$S/opt/x"
  printf 'dir %s\n' "$S/opt/x" > "$M/manifest"
  : > "$RLOCK"; echo '{}' > "$M/installed.json"
}
uninst() { EVERSTREET_SYSROOT=$S sh "$HERE/setup.sh" uninstall; }

mkroot; conf 8 none
EVERSTREET_TEST_LOCKFILE=$RLOCK sh "$LAUNCH" preflight > /dev/null & a=$!; track "$a"; waitfile "$D/sup.pid"
uninst > "$D/u.out" 2>&1; u=$?
case "$(cat "$D/u.out")" in *"in progress"*) said=1 ;; *) said=0 ;; esac
[ "$u" != 0 ] && [ "$said" = 1 ] && [ -d "$S/opt/x" ] && [ -s "$M/manifest" ] \
  && pass "uninstall is refused while a critical process holds the lock; nothing removed" || fail "uninstall not excluded (rc=$u)"
kill -9 "$a"; wait "$a" 2>/dev/null
uninst > "$D/u.out" 2>&1; u=$?
[ "$u" = 0 ] && [ ! -e "$M" ] && [ ! -e "$S/opt/x" ] \
  && pass "uninstall proceeds once the lock is free and unlinks the lock file while holding it" \
  || fail "uninstall didn't complete (rc=$u $(cat "$D/u.out"))"
conf 1 none
EVERSTREET_TEST_LOCKFILE=$RLOCK sh "$LAUNCH" preflight > /dev/null; n=$?
[ "$n" = 69 ] && [ ! -e "$D/sup.pid" ] && pass "after uninstall an entrant is refused (69, not installed) and starts nothing" \
  || fail "entrant admitted after uninstall (rc=$n)"

mkroot; conf 5 none
EVERSTREET_TEST_PAUSE=2 EVERSTREET_TEST_LOCKFILE=$RLOCK sh "$LAUNCH" preflight > "$D/p.out" & p=$!; track "$p"
sleep 0.5; uninst > /dev/null 2>&1; pu=$?
wait "$p"; prc=$?
[ "$pu" = 0 ] && [ "$prc" = 69 ] && [ ! -e "$D/sup.pid" ] \
  && pass "an entrant that opened the lock file before uninstall unlinked it refuses on the stale inode (69)" \
  || fail "pending entrant vs uninstall wrong (uninstall rc=$pu, entrant rc=$prc $(cat "$D/p.out"))"

mkroot; conf 5 none
EVERSTREET_TEST_PAUSE=2 EVERSTREET_TEST_LOCKFILE=$RLOCK sh "$LAUNCH" preflight > "$D/q.out" & q=$!; track "$q"
sleep 0.5; uninst > /dev/null 2>&1; mkroot   # uninstall, then a reinstall: a NEW lock inode
wait "$q"; qrc=$?
[ "$qrc" = 69 ] && [ ! -e "$D/sup.pid" ] && pass "an entrant holding the pre-reinstall inode refuses (69)" \
  || fail "entrant on the old inode entered after reinstall (rc=$qrc $(cat "$D/q.out"))"
conf 1 none
EVERSTREET_TEST_LOCKFILE=$RLOCK sh "$LAUNCH" preflight > /dev/null; f=$?
[ "$f" = 0 ] && pass "a fresh entrant after reinstall is admitted" || fail "fresh entrant refused after reinstall (rc=$f)"

mkroot; mkdir -p "$S/opt/x/locked/inner"; chmod 0555 "$S/opt/x/locked"   # removal will fail
uninst > "$D/u.out" 2>&1; u=$?
chmod 0755 "$S/opt/x/locked"
conf 1 none
EVERSTREET_TEST_LOCKFILE=$RLOCK sh "$LAUNCH" preflight > /dev/null; g=$?
case "$(cat "$M/manifest" 2>/dev/null)" in "dir $S/opt/x") kept=1 ;; *) kept=0 ;; esac
[ "$u" != 0 ] && [ "$kept" = 1 ] && [ -e "$RLOCK" ] && [ "$g" = 0 ] \
  && pass "an interrupted teardown fails, keeps its record and the lock file, and leaves no lock held" \
  || fail "interrupted teardown handled wrongly (uninstall rc=$u, kept=$kept, entrant rc=$g)"
uninst > /dev/null 2>&1; r=$?
[ "$r" = 0 ] && [ ! -e "$M" ] && pass "repeating the interrupted uninstall completes it" || fail "repeat uninstall failed (rc=$r)"

mkroot; rm -f "$RLOCK"
uninst > "$D/u.out" 2>&1; u=$?
[ "$u" != 0 ] && [ -d "$S/opt/x" ] && [ -s "$M/manifest" ] && [ ! -e "$RLOCK" ] \
  && pass "uninstall refuses when the lock file is missing (it never creates one) and removes nothing" \
  || fail "uninstall without a lock file wrong (rc=$u $(cat "$D/u.out"))"

# 6. Astra's stale-uninstaller sequence (002e2 review, final section), deterministic:
#    U2 opens fd 9 and is held at a barrier BEFORE the real flock; U1 uninstalls completely; a
#    reinstall makes a NEW lock inode; a real launcher entrant holds that NEW lock; U2 resumes.
#    Required: U2 removes nothing of the new installation while the new holder lives.
REAL_FLOCK=$(command -v flock)
mkdir -p "$D/shim"
printf '%s\n' '#!/bin/sh' \
  ': > "$EVERSTREET_BARRIER/u2.opened"' \
  'i=0; while [ ! -e "$EVERSTREET_BARRIER/u2.go" ] && [ $i -lt 100 ]; do sleep 0.05; i=$((i + 1)); done' \
  "exec $REAL_FLOCK \"\$@\"" > "$D/shim/flock"
chmod +x "$D/shim/flock"
# stale_uninstaller <dir holding setup.sh and worker.lock.json>: prints "rc holder_alive dir manifest"
stale_uninstaller() {
  mkroot; rm -f "$D/u2.opened" "$D/u2.go"
  PATH=$D/shim:$PATH EVERSTREET_BARRIER=$D EVERSTREET_SYSROOT=$S sh "$1/setup.sh" uninstall > "$D/u2.out" 2>&1 &
  u2=$!; echo "$u2" > "$D/u2.pid"   # known to cleanup (this runs in a command substitution)
  waitfile_e "$D/u2.opened" || { echo "barrier-not-reached"; return; }
  EVERSTREET_SYSROOT=$S sh "$1/setup.sh" uninstall > "$D/u1.out" 2>&1 || { echo "u1-failed"; return; }
  mkroot                                   # the reinstall: same paths, a NEW lock inode
  conf 15 none
  EVERSTREET_TEST_LOCKFILE=$RLOCK sh "$LAUNCH" preflight > /dev/null & hold=$!
  waitfile "$D/sup.pid" || { echo "holder-not-admitted"; return; }
  : > "$D/u2.go"; wait "$u2"; rc=$?
  alive "$hold" && ha=alive || ha=dead
  [ -d "$S/opt/x" ] && dd=dir-survives || dd=dir-REMOVED
  [ -s "$M/manifest" ] && mm=manifest-survives || mm=manifest-REMOVED
  kill -9 "$hold" 2>/dev/null; wait "$hold" 2>/dev/null
  echo "$rc $ha $dd $mm"
}
waitfile_e() { i=0; while [ ! -e "$1" ] && [ $i -lt 50 ]; do sleep 0.1; i=$((i + 1)); done; [ -e "$1" ]; }

if [ -n "${EVERSTREET_OLD_SETUP:-}" ]; then
  set -- $(stale_uninstaller "$EVERSTREET_OLD_SETUP")
  [ "${1:-}" = 0 ] && [ "${2:-}" = alive ] && [ "${3:-}" = dir-REMOVED ] && [ "${4:-}" = manifest-REMOVED ] \
    && pass "OLD setup.sh ($EVERSTREET_OLD_SETUP) violates the invariant: stale U2 exit 0 removed the NEW installation while its lock holder lived" \
    || fail "old stale-uninstaller reproduction didn't match ($*)"
else
  echo "skip  OLD setup.sh stale-uninstaller reproduction (set EVERSTREET_OLD_SETUP to a pre-fix copy)"
fi
set -- $(stale_uninstaller "$HERE")
[ "${1:-}" != 0 ] && [ "${2:-}" = alive ] && [ "${3:-}" = dir-survives ] && [ "${4:-}" = manifest-survives ] \
  && case "$(cat "$D/u2.out")" in *"reinstalled while this uninstall waited"*) true ;; *) false ;; esac \
  && pass "fenced setup.sh: stale U2 refuses (rc=$1) and the NEW installation and its live holder are untouched" \
  || fail "stale uninstaller not fenced ($* / $(cat "$D/u2.out"))"
conf 1 none
uninst > /dev/null 2>&1; r=$?
[ "$r" = 0 ] && [ ! -e "$M" ] && pass "after the stale U2 refused, a fresh uninstall of the new installation completes" \
  || fail "fresh uninstall after stale refusal failed (rc=$r)"

echo "lock-primitive-harness: $FAILS failure(s); real flock(2) and real processes, unprivileged; NOT engine conformance"
[ "$FAILS" = 0 ]
