#!/bin/sh
# Job 002e: PROPOSED host setup for the isolated check worker. NOT RUN. Nothing in this
# repository runs it; it needs Tony's explicit approval after Astra's review, on a chosen WSL2
# distribution (a dedicated one is recommended). Design: docs/design/EXECUTABLE_PRODUCTS.md §8.
#
#   setup.sh check              read-only: lists what is present and what install would change
#   setup.sh fetch <dir>        downloads ONLY into <dir>, verifies official checksums and the
#                               lock's sizes/ETags, prints sha256 values for the reviewer
#   setup.sh install <dir>      root; requires every lock digest filled; records each change in
#                               /var/lib/everstreet-worker/manifest
#   setup.sh uninstall          root; reverses ONLY the manifest's entries, newest first
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
LOCK="$HERE/worker.lock.json"
MANIFEST_DIR=/var/lib/everstreet-worker
MANIFEST=$MANIFEST_DIR/manifest
ROOT=/opt/everstreet-worker

# Pinned values (must match worker.lock.json; checked below).
FC_VER=v1.17.0
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
setpriv:util-linux prlimit:util-linux install:coreutils timeout:coreutils truncate:coreutils \
systemctl:systemd"

lock_sha() { # lock_sha kernel|rootfs -> the reviewer-filled sha256 (empty if not yet)
  tr -d '\n' < "$LOCK" | sed -n "s/.*\"$1\": *{[^}]*\"sha256\": *\"\\([0-9a-f]*\\)\".*/\\1/p"
}

record() { echo "$*" >> "$MANIFEST"; }

check() {
  echo "distro: $(. /etc/os-release && echo "$PRETTY_NAME"); kernel: $(uname -r)"
  missing=""
  for pair in $NEEDS; do
    cmd=${pair%%:*}; pkg=${pair#*:}
    if command -v "$cmd" >/dev/null 2>&1; then echo "present: $cmd"; else echo "MISSING: $cmd (package $pkg)"; missing="$missing $pkg"; fi
  done
  echo "packages install would add:$(echo "$missing" | tr ' ' '\n' | sort -u | tr '\n' ' ')"
  [ -e /dev/kvm ] && ls -l /dev/kvm || echo "MISSING: /dev/kvm"
  echo "cgroup2 controllers: $(cat /sys/fs/cgroup/cgroup.controllers 2>/dev/null || echo none)"
  for u in everstreet-runner everstreet-vm; do id "$u" >/dev/null 2>&1 && echo "EXISTS already: user $u"; done
  [ -e "$ROOT" ] && echo "EXISTS already: $ROOT"
  [ -e "$MANIFEST" ] && echo "EXISTS already: $MANIFEST (a previous install)"
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
  for spec in "vmlinux:$K_URL:$K_SIZE:$K_ETAG" "rootfs.squashfs:$R_URL:$R_SIZE:$R_ETAG"; do
    name=${spec%%:*}; rest=${spec#*:}; url="${rest%:*:*}"; size=$(echo "$rest" | awk -F: '{print $(NF-1)}'); etag=${rest##*:}
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
  [ "$(id -u)" = 0 ] || { echo "install must run as root" >&2; exit 1; }
  ks=$(lock_sha kernel); rs=$(lock_sha rootfs)
  [ -n "$ks" ] && [ -n "$rs" ] || { echo "fill kernel.sha256 and rootfs.sha256 in the lock first" >&2; exit 1; }
  [ ! -e "$MANIFEST" ] || { echo "already installed (manifest exists); uninstall first" >&2; exit 1; }
  cd "$dir"
  echo "$FC_SHA  $FC_TGZ" | sha256sum -c -
  echo "$N_SHA  $N_TAR" | sha256sum -c -
  echo "$ks  vmlinux" | sha256sum -c -
  echo "$rs  rootfs.squashfs" | sha256sum -c -
  mkdir -p "$MANIFEST_DIR"; : > "$MANIFEST"; record "dir $MANIFEST_DIR"

  # 1. Only the missing packages, recorded by name so uninstall removes only those.
  for pair in $NEEDS; do
    cmd=${pair%%:*}; pkg=${pair#*:}
    if ! command -v "$cmd" >/dev/null 2>&1 && ! dpkg -s "$pkg" >/dev/null 2>&1; then
      DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$pkg"; record "package $pkg"
    fi
  done
  # 2. Two service accounts, no login, no home.
  for u in everstreet-runner everstreet-vm; do
    id "$u" >/dev/null 2>&1 && { echo "user $u already exists; refusing to adopt it" >&2; exit 1; }
    useradd --system --no-create-home --shell /usr/sbin/nologin "$u"; record "user $u"
  done
  # 3. KVM access for everstreet-vm only (ACL), re-applied at boot by a unit.
  setfacl -m u:everstreet-vm:rw /dev/kvm; record "acl /dev/kvm everstreet-vm"
  cat > /etc/systemd/system/everstreet-worker-host.service <<'UNIT'
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
UNIT
  record "file /etc/systemd/system/everstreet-worker-host.service"
  systemctl daemon-reload; systemctl enable --now everstreet-worker-host.service; record "unit everstreet-worker-host.service"
  # 4 and 5 are done by the unit just started: the cgroup parent and the empty netns.
  record "cgroup /sys/fs/cgroup/everstreet-worker"; record "netns everstreet-none"
  # 6. Binaries, host node, guest kernel and the built guest image; all root-owned.
  install -d -m 0755 "$ROOT" "$ROOT/bin" "$ROOT/guest" "$ROOT/node"; record "dir $ROOT"
  tar -xzf "$FC_TGZ" -O "$FC_BIN" > "$ROOT/bin/firecracker"; tar -xzf "$FC_TGZ" -O "$JL_BIN" > "$ROOT/bin/jailer"
  chmod 0755 "$ROOT/bin/firecracker" "$ROOT/bin/jailer"
  tar -xJf "$N_TAR" -C "$ROOT/node" --strip-components=1
  install -m 0755 "$HERE/launch" "$ROOT/bin/launch"
  install -m 0644 "$HERE/host-launch.mjs" "$ROOT/host-launch.mjs"
  install -m 0644 "$LOCK" "$ROOT/worker.lock.json"
  install -m 0644 "$HERE/guest/wire.mjs" "$ROOT/guest/wire.mjs"
  install -m 0644 vmlinux "$ROOT/guest/vmlinux"
  work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
  unsquashfs -q -d "$work/rootfs" rootfs.squashfs
  install -d "$work/rootfs/opt/node" "$work/rootfs/opt/everstreet" "$work/rootfs/work"
  tar -xJf "$N_TAR" -C "$work/rootfs/opt/node" --strip-components=1
  for f in init supervisor.mjs case-runner.mjs wire.mjs; do install -m 0755 "$HERE/guest/$f" "$work/rootfs/opt/everstreet/$f"; done
  grep -q '^app:' "$work/rootfs/etc/passwd" || echo 'app:x:1000:1000::/work:/usr/sbin/nologin' >> "$work/rootfs/etc/passwd"
  grep -q '^app:' "$work/rootfs/etc/group" || echo 'app:x:1000:' >> "$work/rootfs/etc/group"
  truncate -s 1G "$ROOT/guest/guest.ext4"
  mkfs.ext4 -q -F -d "$work/rootfs" "$ROOT/guest/guest.ext4"
  chmod 0644 "$ROOT/guest/guest.ext4"
  cat > "$MANIFEST_DIR/installed.json" <<JSON
{"firecracker_sha256":"$(sha256sum "$ROOT/bin/firecracker" | cut -d' ' -f1)","jailer_sha256":"$(sha256sum "$ROOT/bin/jailer" | cut -d' ' -f1)","guest_image_sha256":"$(sha256sum "$ROOT/guest/guest.ext4" | cut -d' ' -f1)"}
JSON
  install -d -m 0700 /srv/everstreet-jail; record "dir /srv/everstreet-jail"
  # 7. One sudoers line, validated before it is placed.
  tmp=$(mktemp); echo 'everstreet-runner ALL=(root) NOPASSWD: /opt/everstreet-worker/bin/launch' > "$tmp"
  visudo -cf "$tmp"; install -m 0440 "$tmp" /etc/sudoers.d/everstreet-worker; rm -f "$tmp"
  record "file /etc/sudoers.d/everstreet-worker"
  echo "Installed. Next: scripts/worker-host/conformance.sh (as everstreet-runner via the launcher)."
}

uninstall_all() {
  [ "$(id -u)" = 0 ] || { echo "uninstall must run as root" >&2; exit 1; }
  [ -e "$MANIFEST" ] || { echo "nothing recorded; nothing to remove" >&2; exit 0; }
  tac "$MANIFEST" | while read -r kind what rest; do
    case "$kind" in
      file) rm -f "$what" ;;
      unit) systemctl disable --now "$what" || true; systemctl daemon-reload ;;
      netns) ip netns delete "$what" 2>/dev/null || true ;;
      cgroup) rmdir "$what" 2>/dev/null || true ;;
      acl) setfacl -x "u:$rest" "$what" 2>/dev/null || true ;;
      user) userdel "$what" ;;
      package) DEBIAN_FRONTEND=noninteractive apt-get remove -y "$what" ;;
      dir) [ "$what" = "$MANIFEST_DIR" ] || rm -rf "$what" ;;
    esac
  done
  rm -rf "$MANIFEST_DIR"
  echo "Removed exactly what the manifest recorded."
}

case "${1:-}" in
  check) check ;;
  fetch) [ -n "${2:-}" ] || { echo "usage: setup.sh fetch <dir>" >&2; exit 2; }; fetch "$2" ;;
  install) [ -n "${2:-}" ] || { echo "usage: setup.sh install <dir>" >&2; exit 2; }; install_all "$2" ;;
  uninstall) uninstall_all ;;
  *) sed -n '2,13p' "$0"; exit 2 ;;
esac
