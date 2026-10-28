#!/bin/bash
# Installs Merge Radar: a login agent that keeps the server running, and "Merge Radar.app" that opens it.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
LABEL="com.merge-radar.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
APP="$HOME/Applications/Merge Radar.app"
NODE="$(command -v node)"
PORT="${PORT:-4747}"
BUNDLE_ID="com.merge-radar.app"

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Applications"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$DIR/server.mjs</string></array>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>$(dirname "$(command -v gh)"):/usr/bin:/bin</string>
    <key>PORT</key><string>$PORT</string>
  </dict>
  <key>AssociatedBundleIdentifiers</key><array><string>$BUNDLE_ID</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/merge-radar.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/merge-radar.log</string>
</dict>
</plist>
EOF

rm -rf "$APP"
osacompile -o "$APP" -e "open location \"http://localhost:$PORT\""
for kv in "CFBundleIdentifier:$BUNDLE_ID" "CFBundleName:Merge Radar" "CFBundleDisplayName:Merge Radar"; do
  /usr/libexec/PlistBuddy -c "Delete :${kv%%:*}" "$APP/Contents/Info.plist" 2>/dev/null || true
  /usr/libexec/PlistBuddy -c "Add :${kv%%:*} string ${kv#*:}" "$APP/Contents/Info.plist"
done
codesign --force --deep --sign - "$APP"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

echo "Installed. Server runs at login on http://localhost:$PORT; open it with \"Merge Radar\" from Spotlight or Launchpad."
