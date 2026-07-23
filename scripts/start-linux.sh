#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "ไม่พบ Node.js กรุณาติดตั้ง Node.js 22 หรือใหม่กว่า"
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "กำลังติดตั้ง dependencies..."
  npm install
  npm run install-browser
fi

if [ ! -f "dist/server.js" ]; then
  echo "กำลัง build แอป..."
  npm run build
fi

echo
echo "HR Auto กำลังเปิดที่ http://127.0.0.1:4173"
echo "กด Ctrl+C ในหน้าต่างนี้เมื่อต้องการปิดแอป"
echo

if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "http://127.0.0.1:4173" >/dev/null 2>&1 || true
fi

npm start
