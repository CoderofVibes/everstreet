#!/bin/sh
# Job 002e1: a FINITE fake-root harness for setup.sh (Astra's WorkerImplementationReview). It runs
# setup.sh against a temporary directory (EVERSTREET_SYSROOT) with EVERY privileged or system
# command replaced by a stateful logging shim (users, ACLs, units, packages, netns), so nothing on
# this machine changes and nothing leaves the temp dir, which is removed on exit. It proves
# setup.sh's bookkeeping (conflicts, interruption, confirmed rollback, repeat safety, the
# lifecycle lock), NOT that the real commands work.
#   sh scripts/worker-host/setup-harness.sh
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
SYS=$T/sys; BIN=$T/shims; IN=$T/inputs
fail() { echo "HARNESS FAIL: $*" >&2; exit 1; }
pass() { echo "ok  $*"; }
case "$T" in /tmp/*|/var/tmp/*|*/Temp/*|*/tmp/*) ;; *) fail "unexpected temp location $T";; esac

reset_sys() {
  # The standard directories every Ubuntu host already has (setup creates only its own below them).
  rm -rf "$SYS"; mkdir -p "$SYS/dev" "$SYS/sys/fs/cgroup" "$SYS/state" "$SYS/var/lib" "$SYS/opt" \
    "$SYS/srv" "$SYS/etc/systemd/system" "$SYS/etc/sudoers.d"
  : > "$SYS/dev/kvm"; echo "cpu memory pids" > "$SYS/sys/fs/cgroup/cgroup.controllers"
  for f in users acl netns units packages log; do : > "$SYS/state/$f"; done
}
snapshot() { (cd "$SYS" && find . -path ./state -prune -o -print | sort; for f in users acl netns units packages; do echo "[$f]"; sort "state/$f"; done); }

mkdir -p "$BIN" "$IN"
shim() { printf '#!/bin/sh\nST="$EVERSTREET_SYSROOT/state"\n%s\n' "$2" > "$BIN/$1"; chmod +x "$BIN/$1"; }
# Every shim logs; FAIL_AT=<name> makes that command fail (an interrupted step).
L='echo "$(basename "$0") $*" >> "$ST/log"; [ "${FAIL_AT:-}" != "$(basename "$0")" ] || exit 1'
del() { echo "grep -vx \"\$1\" \"\$ST/$1\" > \"\$ST/$1.n\" || true; mv \"\$ST/$1.n\" \"\$ST/$1\""; }
shim id "$L
case \"\${1:-}\" in -u) echo 0 ;; *) grep -qx \"\$1\" \"\$ST/users\" ;; esac"
shim useradd "$L
for a; do u=\$a; done; echo \"\$u\" >> \"\$ST/users\""
shim userdel "$L
$(del users)"
shim setfacl "$L
case \"\$1\" in -m) echo \"\${2#u:} \$3\" >> \"\$ST/acl\" ;; -x) grep -v \"^\${2#u:}:\" \"\$ST/acl\" > \"\$ST/acl.n\" || true; mv \"\$ST/acl.n\" \"\$ST/acl\" ;; esac"
shim getfacl "$L
sed 's/^\([^:]*\):\([^ ]*\) .*/user:\1:\2/' \"\$ST/acl\""
shim systemctl "$L
case \"\$1\" in
  enable) echo \"\$3\" >> \"\$ST/units\" ;;
  disable) set -- \"\$3\"; $(del units) ;;
  is-enabled|is-active) grep -qx \"\$3\" \"\$ST/units\" ;;
esac"
shim ip "$L
case \"\$2\" in
  list) sed 's/\$/ (id: 0)/' \"\$ST/netns\" ;;
  add) echo \"\$3\" >> \"\$ST/netns\" ;;
  delete) set -- \"\$3\"; $(del netns) ;;
esac"
shim visudo "$L"
shim apt-get "$L
for a; do p=\$a; done
case \" \$* \" in *\" install \"*) echo \"\$p\" >> \"\$ST/packages\" ;; *\" remove \"*) set -- \"\$p\"; $(del packages) ;; esac"
shim dpkg "$L
grep -qx \"\$2\" \"\$ST/packages\" && echo 'Status: install ok installed'"
shim unsquashfs "$L
for a; do [ \"\${prev:-}\" = -d ] && mkdir -p \"\$a/etc\"; prev=\$a; done"
shim mkfs.ext4 "$L
for a; do f=\$a; done; : > \"\$f\""
shim truncate "$L
for a; do f=\$a; done; : > \"\$f\""
shim tar "$L
case \"\$1\" in -xzf) echo \"fake \$4\" ;; -xJf) mkdir -p \"\$4/bin\" ;; esac"
shim curl "$L
exit 1"
# flock(1): the kernel lock, modelled: held by another operation while state/flock_busy exists.
shim flock "$L
[ ! -e \"\$ST/flock_busy\" ]"
# install(1): same creation and copies, the requested mode logged but not applied (this fake root
# may be on a filesystem that can't hold Linux modes; modes are verified on the real host only).
shim install "$L
dirs=0; mode=''
while [ \$# -gt 0 ]; do case \"\$1\" in -d) dirs=1; shift ;; -m) mode=\$2; shift 2 ;; *) break ;; esac; done
if [ \$dirs = 1 ]; then mkdir -p \"\$@\"; else cp \"\$1\" \"\$2\"; fi
echo \"install mode \$mode \$*\" >> \"\$ST/log\""

# Fake inputs and their pins (never the real downloads or the real lock pins).
for f in firecracker-v1.17.0-x86_64.tgz node-v24.22.2-linux-x64.tar.xz vmlinux rootfs.squashfs; do echo "fake $f" > "$IN/$f"; done
PINS=$T/pins
{
  echo "fc=$(sha256sum "$IN/firecracker-v1.17.0-x86_64.tgz" | cut -d' ' -f1)"
  echo "node=$(sha256sum "$IN/node-v24.22.2-linux-x64.tar.xz" | cut -d' ' -f1)"
  echo "kernel=$(sha256sum "$IN/vmlinux" | cut -d' ' -f1)"
  echo "rootfs=$(sha256sum "$IN/rootfs.squashfs" | cut -d' ' -f1)"
} > "$PINS"

run() { PATH="$BIN:$PATH" EVERSTREET_SYSROOT="$SYS" EVERSTREET_TEST_PINS="$PINS" sh "$HERE/setup.sh" "$@"; }
M=$SYS/var/lib/everstreet-worker

# 1. check changes nothing.
reset_sys; base=$(snapshot)
run check > "$T/out" 2>&1 || fail "check failed: $(cat "$T/out")"
grep -q "no conflicts" "$T/out" || fail "check should see no conflicts"
[ "$base" = "$(snapshot)" ] || fail "check changed the fake root"
pass "check is read-only"

# 2. Conflicts are refused before any change: a path, a user, an annotated netns, a dangling link.
reset_sys; mkdir -p "$SYS/opt/everstreet-worker"; base=$(snapshot)
if run install "$IN" > "$T/out" 2>&1; then fail "install adopted an existing path"; fi
[ "$base" = "$(snapshot)" ] || fail "a refused install changed the fake root"
reset_sys; echo everstreet-vm >> "$SYS/state/users"
if run install "$IN" > "$T/out" 2>&1; then fail "install adopted an existing user"; fi
reset_sys; echo everstreet-none >> "$SYS/state/netns"   # listed as "everstreet-none (id: 0)"
if run install "$IN" > "$T/out" 2>&1; then fail "install missed an annotated netns"; fi
grep -q "netns:everstreet-none" "$T/out" || fail "no netns conflict named"
reset_sys; mkdir -p "$SYS/etc/sudoers.d"
if ln -s "$SYS/nowhere" "$SYS/etc/sudoers.d/everstreet-worker" 2>/dev/null && [ -L "$SYS/etc/sudoers.d/everstreet-worker" ]; then
  if run install "$IN" > "$T/out" 2>&1; then fail "install missed a dangling symlink"; fi
  pass "conflicts refused before any change (path, user, annotated netns, dangling symlink)"
else
  pass "conflicts refused before any change (path, user, annotated netns); SKIPPED dangling symlink: no symlinks here"
fi

# 3. An install interrupted at each privileged stage is removed exactly; uninstall repeats safely.
for stage in useradd setfacl systemctl visudo; do
  reset_sys; base=$(snapshot)
  if FAIL_AT=$stage run install "$IN" > "$T/out" 2>&1; then fail "install interrupted at $stage reported success"; fi
  [ -s "$M/manifest" ] || fail "no manifest after an install interrupted at $stage"
  run uninstall > "$T/out" 2>&1 || fail "uninstall after $stage interruption failed: $(cat "$T/out")"
  if [ "$base" != "$(snapshot)" ]; then
    echo "$base" > "$T/before"; snapshot > "$T/after"
    fail "leftovers after uninstalling an install interrupted at $stage: $(diff "$T/before" "$T/after" | head -8 | tr '\n' ' ')"
  fi
  run uninstall > "$T/out" 2>&1 || fail "a second uninstall failed"
  grep -q "nothing recorded" "$T/out" || fail "a second uninstall should find nothing"
done
pass "installs interrupted at useradd, setfacl, systemctl and visudo are removed exactly; repeat uninstall safe"

# 4. A full install, with the clean baseline saved BEFORE it (Astra: the old step 5 reset first).
reset_sys; base=$(snapshot)
run install "$IN" > "$T/out" 2>&1 || fail "full install failed: $(cat "$T/out")"
for f in conformance.mjs conformance-lib.mjs host-launch.mjs; do
  [ -f "$SYS/opt/everstreet-worker/$f" ] || fail "$f not installed"
done
grep -q "conformance.mjs" "$T/out" || fail "install names the wrong conformance command"
grep -qx everstreet-worker-host.service "$SYS/state/units" || fail "the unit wasn't enabled"
pass "full install placed every file and enabled the unit"

# 5. A removal that can't be confirmed keeps its record and fails; fixing it and repeating finishes.
if FAIL_AT=userdel run uninstall > "$T/out" 2>&1; then fail "uninstall ignored a failed userdel"; fi
grep -q "^user " "$M/manifest" || fail "the unconfirmed user removal wasn't kept in the manifest"
grep -q "could not confirm removal" "$T/out" || fail "no unconfirmed-removal message"
pass "an unconfirmed removal keeps its record and fails"

# 6. Uninstall refuses while another lifecycle operation holds the kernel lock, and proceeds
#    once it is free (the kernel releases it when its holder ends: there is no stale lock).
: > "$SYS/state/flock_busy"
if run uninstall > "$T/out" 2>&1; then fail "uninstall ran while the lifecycle lock was held"; fi
grep -q "in progress" "$T/out" || fail "no busy message"
grep -q "^user " "$M/manifest" || fail "a refused uninstall touched the manifest"
rm "$SYS/state/flock_busy"
run uninstall > "$T/out" 2>&1 || fail "uninstall failed once the lock was free: $(cat "$T/out")"
pass "uninstall refuses while the lifecycle lock is held and proceeds once it is free"

# 7. The install from step 4 is gone exactly: the fake root equals its pre-install baseline.
[ "$base" = "$(snapshot)" ] || { snapshot > "$T/after"; fail "leftovers after uninstall"; }
pass "the full install and uninstall leave the fake root exactly as before"
[ -s "$SYS/state/log" ] && echo "shim calls logged: $(wc -l < "$SYS/state/log")"
echo "setup-harness: all checks passed (fake root and shims only; real commands unverified)"
