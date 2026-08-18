#!/usr/bin/env bash
# 在 Linux 上创建一个应用菜单快捷方式（.desktop 文件）
# 用法：在项目目录下执行  bash install-desktop-entry.sh
set -e

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
DESKTOP_FILE="$HOME/.local/share/applications/saoirse-desktop.desktop"
mkdir -p "$HOME/.local/share/applications"

cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=Saoirse
Comment=DeepSeek Harness 第三方桌面端
Exec=bash -c "cd '$APP_DIR' && npm start"
Icon=$APP_DIR/assets/icon.png
Terminal=true
Categories=Utility;
EOF

chmod +x "$DESKTOP_FILE"
echo "✅ 已创建快捷方式：$DESKTOP_FILE"
echo "现在可以在应用菜单搜到 Saoirse 了（部分桌面环境需注销重登后显示）"
