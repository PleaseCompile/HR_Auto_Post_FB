#!/usr/bin/env bash
# Daily backup of what cannot be recreated: the database (consistent online
# copy), Draft images and the team audit log. Keeps the last 14 days.
#
# Not included on purpose:
#   browser-profile/  the Facebook session; log in again instead of restoring
#                     it, and keep it off backup media (it equals the login)
#   evidence/         screenshots, large and already pruned by retention
#
#   sudo bash /opt/hr-auto/deploy/ubuntu/backup.sh      (also run by a timer)
set -euo pipefail
trap 'echo "!! backup.sh failed at line $LINENO: $BASH_COMMAND" >&2' ERR

DATA_DIR=/var/lib/hr-auto
BACKUP_DIR=/var/backups/hr-auto
KEEP_DAYS=14
STAMP="$(date +%Y%m%d-%H%M%S)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

# sqlite3 .backup takes a consistent snapshot even while HR Auto is writing.
sqlite3 "$DATA_DIR/hr-auto.sqlite" ".backup '$WORK/hr-auto.sqlite'"
[[ -d "$DATA_DIR/uploads" ]] && cp -a "$DATA_DIR/uploads" "$WORK/uploads"
for file in audit.jsonl audit.jsonl.previous; do
  [[ -f "$DATA_DIR/$file" ]] && cp -a "$DATA_DIR/$file" "$WORK/$file"
done
[[ -f /etc/hr-auto/hr-auto.env ]] && cp -a /etc/hr-auto/hr-auto.env "$WORK/hr-auto.env"

ARCHIVE="$BACKUP_DIR/hr-auto-$STAMP.tar.gz"
tar -C "$WORK" -czf "$ARCHIVE" .
chmod 600 "$ARCHIVE"
find "$BACKUP_DIR" -name 'hr-auto-*.tar.gz' -mtime +"$KEEP_DAYS" -delete

echo "Backup written: $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"
