#!/bin/bash
set -euo pipefail

LABEL="com.merge-radar.server"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
rm -rf "$HOME/Applications/Merge Radar.app"
echo "Uninstalled."
