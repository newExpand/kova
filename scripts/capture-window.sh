#!/bin/bash
# Capture a specific app window by owner name
# Usage: ./capture-window.sh <owner-name> <output-path>
# Example: ./capture-window.sh "Clew" docs/assets/screenshot.png

OWNER="${1:-Kova}"
OUTPUT="${2:-screenshot.png}"

WINDOW_ID=$(swift -e "
import CoreGraphics
let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as! [[String: Any]]
for w in windows {
    let owner = w[\"kCGWindowOwnerName\"] as? String ?? \"\"
    let layer = w[\"kCGWindowLayer\"] as? Int ?? -1
    if layer == 0 && owner == \"$OWNER\" {
        print(w[\"kCGWindowNumber\"] as? Int ?? 0)
        break
    }
}
" 2>/dev/null)

if [ -z "$WINDOW_ID" ] || [ "$WINDOW_ID" = "0" ]; then
    echo "Error: Window not found for '$OWNER'"
    echo "Available windows:"
    swift -e '
import CoreGraphics
let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as! [[String: Any]]
for w in windows { let o = w["kCGWindowOwnerName"] as? String ?? ""; let l = w["kCGWindowLayer"] as? Int ?? -1; if l == 0 { print("  \(o)") } }
'
    exit 1
fi

screencapture -l "$WINDOW_ID" "$OUTPUT"
echo "Captured window '$OWNER' (ID=$WINDOW_ID) → $OUTPUT"
