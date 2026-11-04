#!/bin/sh
# Job 002e: a FINITE fake-root harness for setup.sh (Astra's WorkerImplementationReview). It runs
# setup.sh against a temporary directory (EVERSTREET_SYSROOT) with every privileged or system
# command replaced by a logging shim, so nothing on this machine changes. It checks: a conflict
# is refused before any change; an install interrupted mid-way is removed exactly by uninstall;
# uninstall is safe to repeat and refuses under a run lock; a full install/uninstall leaves the
# fake root as it started. It proves setup.sh's bookkeeping, NOT that the real commands work.
#   sh scripts/worker-host/setup-harness.sh
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
SYS=$T/sys; BIN=$T/shims; IN=$T/inputs
fail() { echo "HARNESS FAIL: $*" >&2; exit 1; }
pass() { echo "ok  $*"; }

reset_sys() {
  rm -rf "$SYS"; mkdir -p "$SYS/dev" "$SYS/sys/fs/cgroup" "$SYS/state"
  : > "$SYS/dev/kvm"; echo "cpu memory pids" > "$SYS/sys/fs/cgroup/cgroup.controllers"
  : > "$SYS/state/users"; : > "$SYS/state/acl"; : > "$SYS/state/netns"; : > "$SYS/state/log"
}
snapshot() { (cd "$SYS" && find . -path ./state -prune -o -print | sort; cat state/users state/acl state/netns); }

mkdir -p "$BIN" "$IN"
shim() { printf '#!/bin/sh\n%s\n' "$2" > "$BIN/$1"; chmod +x "$BIN/$1"; }
# Every shim logs; FAIL_AT=<name> makes that command fail (an interrupted install).
L='echo "$(basename "$0") $*" >> "$EVERSTREET_SYSROOT/state/log"; [ "${FAIL_AT:-}" != "$(basename "$0")" ] || exit 1'
shim id "$L
case \"\${1:-}\" in -u) echo 0 ;; *) grep -qx \"\$1\" \"\$EVERSTREET_SYSROOT/state/users\" ;; esac"
shim useradd "$L
for a; do u=\$a; done; echo \"\$u\" >> \"\$EVERSTREET_SYSROOT/state/users\""
shim userdel "$L
grep -vx \"\$1\" \"\$EVERSTREET_SYSROOT/state/users\" > \"\$EVERSTREET_SYSROOT/state/u2\" || true; mv \"\$EVERSTREET_SYSROOT/state/u2\" \"\$EVERSTREET_SYSROOT/state/users\""
shim setfacl "$L
case \"\$1\" in -m) echo \"\$3 \$2\" >> \"\$EVERSTREET_SYSROOT/state/acl\" ;; -x) grep -v \" \$2:\" \"\$EVERSTREET_SYSROOT/state/acl\" > \"\$EVERSTREET_SYSROOT/state/a2\" || true; mv \"\$EVERSTREET_SYSROOT/state/a2\" \"\$EVERSTREET_SYSROOT/state/acl\" ;; esac"
shim getfacl "$L
sed 's/^[^ ]* u:\([^:]*\):\(.*\)/user:\1:\2/' \"\$EVERSTREET_SYSROOT/state/acl\""
shim systemctl "$L"
shim ip "$L
case \"\$2\" in list) cat \"\$EVERSTREET_SYSROOT/state/netns\" ;; add) echo \"\$3\" >> \"\$EVERSTREET_SYSROOT/state/netns\" ;; delete) : > \"\$EVERSTREET_SYSROOT/state/netns\" ;; esac"
shim visudo "$L"
shim apt-get "$L"
shim dpkg "$L
exit 0"
shim unsquashfs "$L
for a; do [ \"\$prev\" = -d ] && mkdir -p \"\$a/etc\"; prev=\$a; done"
shim mkfs.ext4 "$L
for a; do f=\$a; done; : > \"\$f\""
shim truncate "$L
for a; do f=\$a; done; : > \"\$f\""
shim tar "$L
case \"\$1\" in -xzf) echo \"fake \$4\" ;; -xJf) mkdir -p \"\$4/bin\" ;; esac"
shim curl "$L
exit 1"

# Fake inputs and their pins (the harness never touches real downloads or the real lock pins).
for f in firecracker-v1.17.0-x86_64.tgz node-v24.22.2-linux-x64.tar.xz vmlinux rootfs.squashfs; do echo "fake $f" > "$IN/$f"; done
PINS=$T/pins
{
  echo "fc=$(sha256sum "$IN/firecracker-v1.17.0-x86_64.tgz" | cut -d' ' -f1)"
  echo "node=$(sha256sum "$IN/node-v24.22.2-linux-x64.tar.xz" | cut -d' ' -f1)"
  echo "kernel=$(sha256sum "$IN/vmlinux" | cut -d' ' -f1)"
  echo "rootfs=$(sha256sum "$IN/rootfs.squashfs" | cut -d' ' -f1)"
} > "$PINS"

run() { PATH="$BIN:$PATH" EVERSTREET_SYSROOT="$SYS" EVERSTREET_TEST_PINS="$PINS" sh "$HERE/setup.sh" "$@"; }

# 1. check changes nothing and sees no conflicts.
reset_sys; before=$(snapshot)
run check > "$T/out" 2>&1 || fail "check failed: $(cat "$T/out")"
grep -q "no conflicts" "$T/out" || fail "check should see no conflicts"
[ "$before" = "$(snapshot)" ] || fail "check changed the fake root"
pass "check is read-only"

# 2. A pre-existing target is refused before any change.
reset_sys; mkdir -p "$SYS/opt/everstreet-worker"; before=$(snapshot)
if run install "$IN" > "$T/out" 2>&1; then fail "install adopted an existing /opt/everstreet-worker"; fi
grep -q "refusing" "$T/out" || fail "no refusal message: $(cat "$T/out")"
[ "$before" = "$(snapshot)" ] || fail "a refused install changed the fake root"
echo everstreet-vm >> "$SYS/state/users"; rmdir "$SYS/opt/everstreet-worker"
if run install "$IN" > "$T/out" 2>&1; then fail "install adopted an existing user"; fi
pass "conflicts refused before any change"

# 3. An install interrupted at systemctl is removed exactly; uninstall is safe to repeat.
reset_sys; before=$(snapshot)
if FAIL_AT=systemctl run install "$IN" > "$T/out" 2>&1; then fail "the interrupted install reported success"; fi
[ -s "$SYS/var/lib/everstreet-worker/manifest" ] || fail "no manifest after an interrupted install"
grep -q everstreet-runner "$SYS/state/users" || fail "the harness didn't reach user creation"
run uninstall > "$T/out" 2>&1 || fail "uninstall after interruption failed: $(cat "$T/out")"
[ "$before" = "$(snapshot)" ] || { snapshot > "$T/after"; fail "leftovers after uninstall: $(diff "$T/after" /dev/null | head -5)"; }
run uninstall > "$T/out" 2>&1 || fail "a second uninstall failed"
grep -q "nothing recorded" "$T/out" || fail "a second uninstall should find nothing"
pass "interrupted install removed exactly; repeat uninstall safe"

# 4. Uninstall refuses while a run lock exists.
reset_sys
run install "$IN" > "$T/out" 2>&1 || fail "full install failed: $(cat "$T/out")"
[ -f "$SYS/opt/everstreet-worker/conformance.mjs" ] || fail "conformance suite not installed"
grep -q "conformance.mjs" "$T/out" || fail "install names the wrong conformance command"
: > "$SYS/var/lib/everstreet-worker/run.lock"
if run uninstall > "$T/out" 2>&1; then fail "uninstall ran under a run lock"; fi
[ -s "$SYS/var/lib/everstreet-worker/manifest" ] || fail "the refused uninstall touched the manifest"
rm "$SYS/var/lib/everstreet-worker/run.lock"
pass "uninstall refused under a run lock"

# 5. A full install then uninstall leaves the fake root as it started.
before=$( (reset_sys; snapshot) )
run uninstall > "$T/out" 2>&1 || fail "uninstall failed: $(cat "$T/out")"
[ "$before" = "$(snapshot)" ] || fail "leftovers after a full install/uninstall"
pass "full install and uninstall leave nothing"
echo "setup-harness: all checks passed (bookkeeping only; real commands unverified)"
