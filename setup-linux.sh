#!/usr/bin/env bash
set -e

echo "== Saoirse Linux 开发环境准备 =="

# 1. 检查 Node（dsh 需要 Node >= 22）
if ! command -v node >/dev/null 2>&1; then
  echo "❌ 未检测到 Node.js，请先安装 Node 22+："
  echo "   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -"
  echo "   sudo apt-get install -y nodejs"
  exit 1
fi
echo "✅ Node $(node -v)"

# 2. 原生模块需要编译工具（sharp / koffi / node-pty 若无预编译）
if ! command -v gcc >/dev/null 2>&1; then
  echo "安装 build-essential（原生模块编译需要）..."
  sudo apt-get update -y
  sudo apt-get install -y build-essential python3
fi

# 3. 安装依赖（国内网络设 DSH_CN_MIRROR=1 走镜像）
if [ "${DSH_CN_MIRROR:-0}" = "1" ]; then
  export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
  echo "使用国内 electron 镜像"
fi
npm install

# 4. 启动
echo "== 启动 Saoirse =="
npm start
