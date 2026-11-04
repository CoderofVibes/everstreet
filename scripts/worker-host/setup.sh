#!/bin/sh
# Job 002e: PROPOSED host setup for the isolated check worker. NOT RUN on any real host. It needs
# Tony's explicit approval after Astra's review, on a chosen WSL2 distribution (a dedicated one is
# recommended). Design: docs/design/EXECUTABLE_PRODUCTS.md §8. Revised after Astra's
# WorkerImplementationReview: every target is checked for conflicts before any change; each
# resource is recorded in the manifest BEFORE it is created (a failed install is recoverable);
# uninstall refuses while a run is live, removes entries one by one and is safe to repeat.
# Exercised only in a fake root by setup-harness.sh (EVERSTREET_SYSROOT); never by tests.
#
#   setup.sh check              read-only: what is present, what install would add or refuse
#   setup.sh fetch <dir>        downloads ONLY into <dir>, verifies official checksums and the
#                               lock's sizes/ETags, prints sha256 values for the reviewer
#   setup.sh install <dir>      root; requires every lock digest; refuses any conflict
#   setup.sh uninstall          root; reverses ONLY the manifest's entries, newest first
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
S=${EVERSTREET_SYSROOT:-}            # a fake root for the harness; empty on a real host
LOCK="$HERE/worker.lock.json"
MANIFEST_DIR=$S/var/lib/everstreet-worker
MANIFEST=$MANIFEST_DIR/manifest
ROOT=$S/opt/everstreet-worker
JAILS=$S/srv/everstreet-jail
UNIT=$S/etc/systemd/system/everstreet-worker-host.service
SUDOERS=$S/etc/sudoers.d/everstreet-worker
CGROUP=$S/sys/fs/cgroup/everstreet-worker
KVM=$S/dev/kvm

# Pinned values (must match worker.lock.json; checked below).
FC_TGZ=firecracker-v1.17.0-x86_64.tgz
FC_URL=https://github.com/firecracker-microvm/firecracker/releases/download/v1.17.0/$FC_TGZ
FC_SHA=06094a1108ae9e82aa4c23a775aa92758f53f1175d422270d9d6162cb9ade558
FC_BIN=release-v1.17.0-x86_64/firecracker-v1.17.0-x86_64
JL_BIN=release-v1.17.0-x86_64/jailer-v1.17.0-x86_64
K_URL=https://s3.amazonaws.com/spec.ccfc.min/firecracker-ci/20261028-84df49062576-0/x86_64/vmlinux-6.1.188
K_SIZE=45064368
K_ETAG=a1be6c8d192c2e816fb841e49fcfd70e-6
R_URL=https://s3.amazonaws.com/spec.ccfc.min/firecracker-ci/20261028-84df49062576-0/x86_64/ubuntu-24.04.squashfs
R_SIZE=108503040
R_ETAG=6e31666e67adbee77a60d49d04d93aea-13
N_TAR=node-v24.22.2-linux-x64.tar.xz
N_URL=https://nodejs.org/dist/v24.22.2/$N_TAR
N_SUMS=https://nodejs.org/dist/v24.22.2/SHASUMS256.txt
N_SHA=48cc0e21e048790e54c0cf5749c2725005313d652651c40b7a21feb9697aaf75

for v in "$FC_SHA" "$K_ETAG" "$R_ETAG" "$N_SHA" "$K_URL" "$R_URL" "$N_URL" "$FC_URL"; do
  grep -qF "$v" "$LOCK" || { echo "worker.lock.json and setup.sh disagree on $v" >&2; exit 1; }
done

# Every command any phase uses, and the Ubuntu package that provides it.
NEEDS="curl:curl sha256sum:coreutils tar:tar xz:xz-utils unsquashfs:squashfs-tools mkfs.ext4:e2fsprogs \
setfacl:acl getfacl:acl ip:iproute2 sudo:sudo visudo:sudo useradd:passwd userdel:passwd \
setpriv:util-linux prlimit:util-linux flock:util-linux install:coreutils timeout:coreutils truncate:coreutils \
systemctl:systemd dpkg:dpkg"

lock_sha() { # kernel|rootfs -> the reviewer-filled sha256 (empty if not yet)
  if [ -n "$S" ] && [ -n "${EVERSTREET_TEST_PINS:-}" ]; then
    # Harness only (fake root): its fake inputs' digests. A real host never takes this path.
    sed -n "s/^$1=//p" "$EVERSTREET_TEST_PINS"; return
  fi
  tr -d '\n' < "$LOCK" | sed -n "s/.*\"$1\": *{[^}]*\"sha256\": *\"\\([0-9a-f]*\\)\".*/\\1/p"
}
pin() { # fc|node -> the pinned sha256 (the harness's fake inputs have their own)
  if [ -n "$S" ] && [ -n "${EVERSTREET_TEST_PINS:-}" ]; then sed -n "s/^$1=//p" "$EVERSTREET_TEST_PINS"; return; fi
  case "$1" in fc) echo "$FC_SHA" ;; node) echo "$N_SHA" ;; esac
}

record() { echo "$*" >> "$MANIFEST"; }

netns_present() { ip netns list 2>/dev/null | awk '{print $1}' | grep -qx everstreet-none; }

# 002e2: the launcher's lifecycle lock, the kernel's flock(2) on lifecycle.flock (see `launch`).
# Uninstall holds it on fd 9 in THIS shell until it exits (no separate holder process); the
# kernel releases it however this shell ends. The lock file is created once per installation
# (install, before the manifest) and unlinked only by a completed uninstall while it holds the
# lock, so its inode IS the installation's identity. Uninstall never creates it.
# Fence (after Astra's U2/U1/reinstall reproduction): an uninstall that opened the file and was
# then delayed may lock an inode a completed uninstall already removed, while a reinstall's NEW
# lock is held by someone else. Locking alone excludes nothing then. So after locking, the inode
# held must still be the current lock file and the manifest must still exist; otherwise this
# uninstall refuses and removes nothing (it can simply be run again).
take_lock() {
  [ -f "$MANIFEST_DIR/lifecycle.flock" ] || {
    echo "the lifecycle lock file is missing; nothing removed (no lock, no fence)" >&2; return 1; }
  exec 9<"$MANIFEST_DIR/lifecycle.flock"
  flock -n 9 || { echo "a lifecycle operation is in progress; try again when it ends" >&2; return 1; }
  held=$(stat -L -c '%d:%i' "/proc/$$/fd/9" 2>/dev/null || echo held-unknown)
  now=$(stat -c '%d:%i' "$MANIFEST_DIR/lifecycle.flock" 2>/dev/null || echo gone)
  [ "$held" = "$now" ] && [ -e "$MANIFEST" ] || {
    echo "the worker host was removed or reinstalled while this uninstall waited; nothing removed" >&2; return 1; }
}

# Confirms a recorded resource is really gone (or no longer enabled/installed).
gone() {
  kind=$1; what=$2; who=${3:-}
  case "$kind" in
    file|dir) [ ! -e "$what" ] && [ ! -L "$what" ] ;;
    unit) ! systemctl is-enabled --quiet "$what" 2>/dev/null && ! systemctl is-active --quiet "$what" 2>/dev/null ;;
    netns) ! netns_present ;;
    cgroup) [ ! -d "$what" ] ;;
    acl) ! getfacl -p "$what" 2>/dev/null | grep -q "^user:$who:" ;;
    user) ! id "$what" >/dev/null 2>&1 ;;
    package) ! dpkg -s "$what" 2>/dev/null | grep -q '^Status: install ok installed' ;;
    *) return 1 ;;
  esac
}

# Everything install would create; any that exists is a conflict (nothing is adopted).
conflicts() {
  c=""
  for u in everstreet-runner everstreet-vm; do id "$u" >/dev/null 2>&1 && c="$c user:$u"; done
  # A dangling symlink is a conflict too (002e1): `[ -e ]` alone misses it.
  for p in "$ROOT" "$JAILS" "$UNIT" "$SUDOERS" "$CGROUP" "$MANIFEST_DIR"; do
    if [ -e "$p" ] || [ -L "$p" ]; then c="$c path:$p"; fi
  done
  # `ip netns list` may annotate names ("everstreet-none (id: 0)"): compare the name field only.
  netns_present && c="$c netns:everstreet-none"
  getfacl -p "$KVM" 2>/dev/null | grep -q "^user:everstreet-vm:" && c="$c acl:$KVM"
  echo "$c"
}

check() {
  echo "kernel: $(uname -r)"
  missing=""
  for pair in $NEEDS; do
    cmd=${pair%%:*}; pkg=${pair#*:}
    if command -v "$cmd" >/dev/null 2>&1; then echo "present: $cmd"; else echo "MISSING: $cmd (package $pkg)"; missing="$missing $pkg"; fi
  done
  echo "packages install would add:$(echo "$missing" | tr ' ' '\n' | sort -u | tr '\n' ' ')"
  [ -e "$KVM" ] && ls -l "$KVM" || echo "MISSING: $KVM"
  echo "cgroup2 controllers: $(cat "$S/sys/fs/cgroup/cgroup.controllers" 2>/dev/null || echo none)"
  c=$(conflicts); [ -n "$c" ] && echo "CONFLICTS (install would refuse):$c" || echo "no conflicts"
  echo "check made no changes."
}

fetch() {
  dir=$1; mkdir -p "$dir"; cd "$dir"
  curl -fsSL --proto '=https' -o "$FC_TGZ" "$FC_URL"
  curl -fsSL --proto '=https' -o "$FC_TGZ.sha256.txt" "$FC_URL.sha256.txt"
  grep -q "^$FC_SHA  $FC_TGZ\$" "$FC_TGZ.sha256.txt" || { echo "official firecracker checksum differs from the lock" >&2; exit 1; }
  echo "$FC_SHA  $FC_TGZ" | sha256sum -c -
  tar -tzf "$FC_TGZ" | grep -qx "$FC_BIN" || { echo "archive lacks $FC_BIN" >&2; exit 1; }
  tar -tzf "$FC_TGZ" | grep -qx "$JL_BIN" || { echo "archive lacks $JL_BIN" >&2; exit 1; }
  curl -fsSL --proto '=https' -o "$N_TAR" "$N_URL"
  curl -fsSL --proto '=https' -o SHASUMS256.txt "$N_SUMS"
  grep -q "^$N_SHA  $N_TAR\$" SHASUMS256.txt || { echo "official node checksum differs from the lock" >&2; exit 1; }
  echo "$N_SHA  $N_TAR" | sha256sum -c -
  for spec in "vmlinux|$K_URL|$K_SIZE|$K_ETAG" "rootfs.squashfs|$R_URL|$R_SIZE|$R_ETAG"; do
    name=$(echo "$spec" | cut -d'|' -f1); url=$(echo "$spec" | cut -d'|' -f2)
    size=$(echo "$spec" | cut -d'|' -f3); etag=$(echo "$spec" | cut -d'|' -f4)
    head=$(curl -fsSI --proto '=https' "$url")
    echo "$head" | grep -qi "^content-length: $size" || { echo "$name size differs from the lock" >&2; exit 1; }
    echo "$head" | grep -qi "^etag: \"$etag\"" || { echo "$name ETag differs from the lock" >&2; exit 1; }
    curl -fsSL --proto '=https' -o "$name" "$url"
    [ "$(stat -c %s "$name")" = "$size" ] || { echo "$name downloaded size differs" >&2; exit 1; }
  done
  echo "Verified. For the reviewer to copy into worker.lock.json (kernel.sha256, rootfs.sha256):"
  sha256sum vmlinux rootfs.squashfs
}

install_all() {
  dir=$1
  [ -n "$S" ] || [ "$(id -u)" = 0 ] || { echo "install must run as root" >&2; exit 1; }
  ks=$(lock_sha kernel); rs=$(lock_sha rootfs)
  [ -n "$ks" ] && [ -n "$rs" ] || { echo "fill kernel.sha256 and rootfs.sha256 in the lock first" >&2; exit 1; }
  c=$(conflicts)
  [ -z "$c" ] || { echo "refusing: these already exist and are not adopted:$c" >&2; exit 1; }
  cd "$dir"
  echo "$(pin fc)  $FC_TGZ" | sha256sum -c -
  echo "$(pin node)  $N_TAR" | sha256sum -c -
  echo "$ks  vmlinux" | sha256sum -c -
  echo "$rs  rootfs.squashfs" | sha256sum -c -
  # 002e2: the lifecycle lock file, created once here BEFORE the manifest (so a manifest always
  # has its lock) and never recreated while installed: `launch` and uninstall only open it, and
  # its inode identifies this installation. `mkdir` without -p fails if the directory appeared
  # since the conflict check.
  mkdir "$MANIFEST_DIR"
  : > "$MANIFEST_DIR/lifecycle.flock"; chmod 0600 "$MANIFEST_DIR/lifecycle.flock"
  : > "$MANIFEST"
  # Each line is written BEFORE its resource is created: a failure leaves a removable record.

  # 1. Only the missing packages, by name, so uninstall removes only those.
  for pair in $NEEDS; do
    cmd=${pair%%:*}; pkg=${pair#*:}
    if ! command -v "$cmd" >/dev/null 2>&1 && ! dpkg -s "$pkg" >/dev/null 2>&1; then
      record "package $pkg"; DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$pkg"
    fi
  done
  # 2. Two service accounts, no login, no home.
  for u in everstreet-runner everstreet-vm; do
    record "user $u"; useradd --system --no-create-home --shell /usr/sbin/nologin "$u"
  done
  # 3. KVM access for everstreet-vm only (ACL).
  record "acl $KVM everstreet-vm"; setfacl -m u:everstreet-vm:rw "$KVM"
  # 4. Files, then the boot unit (re-applies the ACL, creates the cgroup parent and empty netns).
  record "dir $ROOT"; install -d -m 0755 "$ROOT"
  record "dir $JAILS"; install -d -m 0700 "$JAILS"
  record "file $UNIT"
  mkdir -p "$(dirname "$UNIT")"
  cat > "$UNIT" <<'UNITFILE'
[Unit]
Description=Everstreet check worker: KVM ACL, cgroup parent, empty netns
[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/bin/setfacl -m u:everstreet-vm:rw /dev/kvm
ExecStart=/bin/sh -c 'mkdir -p /sys/fs/cgroup/everstreet-worker && echo "+cpu +memory +pids" > /sys/fs/cgroup/everstreet-worker/cgroup.subtree_control'
ExecStart=/bin/sh -c 'ip netns list | grep -qx everstreet-none || ip netns add everstreet-none'
[Install]
WantedBy=multi-user.target
UNITFILE
  record "cgroup $CGROUP"; record "netns everstreet-none"; record "unit everstreet-worker-host.service"
  systemctl daemon-reload; systemctl enable --now everstreet-worker-host.service
  # 5. Binaries, host node, guest kernel, guest image, launcher, conformance suite; root-owned.
  install -d -m 0755 "$ROOT/bin" "$ROOT/guest" "$ROOT/node"
  tar -xzf "$FC_TGZ" -O "$FC_BIN" > "$ROOT/bin/firecracker"; tar -xzf "$FC_TGZ" -O "$JL_BIN" > "$ROOT/bin/jailer"
  chmod 0755 "$ROOT/bin/firecracker" "$ROOT/bin/jailer"
  tar -xJf "$N_TAR" -C "$ROOT/node" --strip-components=1
  install -m 0755 "$HERE/launch" "$ROOT/bin/launch"
  install -m 0644 "$HERE/host-launch.mjs" "$ROOT/host-launch.mjs"
  install -m 0644 "$HERE/conformance.mjs" "$ROOT/conformance.mjs"
  install -m 0644 "$HERE/conformance-lib.mjs" "$ROOT/conformance-lib.mjs"
  install -m 0644 "$LOCK" "$ROOT/worker.lock.json"
  install -m 0644 "$HERE/guest/wire.mjs" "$ROOT/guest/wire.mjs"
  install -m 0644 vmlinux "$ROOT/guest/vmlinux"
  work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
  unsquashfs -q -d "$work/rootfs" rootfs.squashfs
  install -d "$work/rootfs/opt/node" "$work/rootfs/opt/everstreet" "$work/rootfs/work"
  tar -xJf "$N_TAR" -C "$work/rootfs/opt/node" --strip-components=1
  for f in init supervisor.mjs case-runner.mjs wire.mjs; do install -m 0755 "$HERE/guest/$f" "$work/rootfs/opt/everstreet/$f"; done
  mkdir -p "$work/rootfs/etc"; touch "$work/rootfs/etc/passwd" "$work/rootfs/etc/group"
  grep -q '^app:' "$work/rootfs/etc/passwd" || echo 'app:x:1000:1000::/work:/usr/sbin/nologin' >> "$work/rootfs/etc/passwd"
  grep -q '^app:' "$work/rootfs/etc/group" || echo 'app:x:1000:' >> "$work/rootfs/etc/group"
  truncate -s 1G "$ROOT/guest/guest.ext4"
  mkfs.ext4 -q -F -d "$work/rootfs" "$ROOT/guest/guest.ext4"
  chmod 0644 "$ROOT/guest/guest.ext4"
  cat > "$MANIFEST_DIR/installed.json" <<JSON
{"firecracker_sha256":"$(sha256sum "$ROOT/bin/firecracker" | cut -d' ' -f1)","jailer_sha256":"$(sha256sum "$ROOT/bin/jailer" | cut -d' ' -f1)","guest_image_sha256":"$(sha256sum "$ROOT/guest/guest.ext4" | cut -d' ' -f1)"}
JSON
  # 6. One sudoers line, validated before it is placed.
  tmp=$(mktemp); echo 'everstreet-runner ALL=(root) NOPASSWD: /opt/everstreet-worker/bin/launch' > "$tmp"
  visudo -cf "$tmp"
  record "file $SUDOERS"; mkdir -p "$(dirname "$SUDOERS")"; install -m 0440 "$tmp" "$SUDOERS"; rm -f "$tmp"
  echo "Installed. Next, as everstreet-runner: /opt/everstreet-worker/node/bin/node /opt/everstreet-worker/conformance.mjs"
}

uninstall_all() {
  [ -n "$S" ] || [ "$(id -u)" = 0 ] || { echo "uninstall must run as root" >&2; exit 1; }
  [ -e "$MANIFEST" ] || { echo "nothing recorded; nothing to remove"; exit 0; }
  # The same lifecycle lock as run/preflight/cleanup (002e1): never under a live operation.
  take_lock || exit 1
  for d in "$CGROUP"/es-*; do
    if [ -d "$d" ] && [ -n "$(cat "$d/cgroup.procs" 2>/dev/null)" ]; then
      echo "a job is still running ($d)" >&2; exit 1
    fi
  done
  while [ -s "$MANIFEST" ]; do
    line=$(tail -n 1 "$MANIFEST"); kind=${line%% *}; rest=${line#* }; what=${rest%% *}; who=${rest#* }
    [ "$who" = "$rest" ] && who=""
    case "$kind" in
      file) rm -f "$what" ;;
      unit) systemctl disable --now "$what" || true; systemctl daemon-reload || true ;;
      netns) ! netns_present || ip netns delete "$what" || true ;;
      cgroup) [ ! -d "$what" ] || rmdir "$what" || true ;;
      acl) setfacl -x "u:$who" "$what" || true ;;
      user) ! id "$what" >/dev/null 2>&1 || userdel "$what" || true ;;
      package) DEBIAN_FRONTEND=noninteractive apt-get remove -y "$what" || true ;;
      dir) [ "$what" = "$MANIFEST_DIR" ] || rm -rf "$what" ;;
      *) echo "unknown manifest entry: $line" >&2; exit 1 ;;
    esac
    # 002e1: the record leaves the manifest only once removal is CONFIRMED; otherwise it stays
    # (with everything older) and uninstall fails, to be repeated after the cause is fixed.
    if [ "$kind" != dir ] || [ "$what" != "$MANIFEST_DIR" ]; then
      if ! gone "$kind" "$what" "$who"; then
        echo "could not confirm removal of: $line (kept in the manifest)" >&2; exit 1
      fi
    fi
    sed -i '$d' "$MANIFEST"
  done
  # Everything recorded is gone. The lock file is unlinked while we STILL hold it (fd 9): an
  # entrant that opened it earlier then locks a removed inode, and `launch` refuses it. The lock
  # is released only when this shell exits.
  rm -f "$MANIFEST" "$MANIFEST_DIR/installed.json" "$MANIFEST_DIR/lifecycle.flock"; rmdir "$MANIFEST_DIR"
  echo "Removed exactly what the manifest recorded."
}

case "${1:-}" in
  check) check ;;
  fetch) [ -n "${2:-}" ] || { echo "usage: setup.sh fetch <dir>" >&2; exit 2; }; fetch "$2" ;;
  install) [ -n "${2:-}" ] || { echo "usage: setup.sh install <dir>" >&2; exit 2; }; install_all "$2" ;;
  uninstall) uninstall_all ;;
  *) sed -n '2,16p' "$0"; exit 2 ;;
esac
