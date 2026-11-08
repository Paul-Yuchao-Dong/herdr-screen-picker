#!/usr/bin/env bash
# Deploy the Screen picker mod into a Herdr app home and bind its key.
#
#   ./install.sh            copy the mod into $HERDR_APP_HOME/mods/screen-picker
#   ./install.sh link       symlink it there instead (edit the repo, it reloads)
#   ./install.sh copy no-keys   deploy only, leave keys.json alone
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
mode=${1:-copy}
keys=${2:-keys}
app_home=${HERDR_APP_HOME:-$HOME/.config/herdr-app}
target="$app_home/mods/screen-picker"
shortcut=ctrl-shift-o
action=mod.open:screen-picker

[ -d "$app_home" ] || { echo "No Herdr app home at $app_home (set HERDR_APP_HOME)." >&2; exit 1; }
mkdir -p "$app_home/mods"

case "$mode" in
  copy)
    rm -rf "$target"
    mkdir -p "$target"
    cp "$here/mods/screen-picker/main.js" "$here/mods/screen-picker/mod.json" "$target/"
    ;;
  link)
    rm -rf "$target"
    ln -s "$here/mods/screen-picker" "$target"
    ;;
  *) echo "usage: $0 [copy|link] [keys|no-keys]" >&2; exit 2 ;;
esac
echo "installed $mode -> $target"

if [ "$keys" = keys ]; then
  python3 - "$app_home" "$shortcut" "$action" <<'PY'
import json, pathlib, shutil, sys, time
app_home, shortcut, action = sys.argv[1], sys.argv[2], sys.argv[3]
path = pathlib.Path(app_home) / "keys.json"
if not path.exists():
    sys.exit(f"No keys.json in {app_home}; add \"{shortcut}\": \"{action}\" to its global section.")
data = json.loads(path.read_text())
current = data.get("global", {}).get(shortcut)
if current == action:
    print(f"keys.json: {shortcut} already {action}")
    raise SystemExit(0)
backup = path.with_name(f"keys.json.bak-{time.strftime('%Y%m%d%H%M%S')}")
shutil.copy2(path, backup)
data.setdefault("global", {})[shortcut] = action
path.write_text(json.dumps(data, indent=2) + "\n")
print(f"keys.json: {shortcut} -> {action} (was {current or 'unbound'}); backup {backup.name}")
if current and current != action:
    print(f"note: {current} has no key now; bind it elsewhere, or restore {backup.name} to undo.")
PY
fi

echo "check it with: herdr-app check $target"
