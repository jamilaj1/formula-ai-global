#!/usr/bin/env bash
# Formula AI Global — one-command launcher (macOS / Linux)
set -e

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "❌ .env missing. Copy .env.example → .env and fill the values."
  exit 1
fi

echo "🚀 Launching Formula AI Global v3.0.0"

# ---- Backend ------------------------------------------------
cd backend
if [ ! -d venv ]; then
  echo "📦 Creating Python venv..."
  python3 -m venv venv
fi
# shellcheck disable=SC1091
source venv/bin/activate
pip install -q -r requirements.txt

# ensure __init__.py exist (defensive)
touch ai_brain/__init__.py knowledge_collector/__init__.py services/__init__.py \
      app/__init__.py app/api/__init__.py app/api/v1/__init__.py app/api/v2/__init__.py \
      bots/__init__.py 2>/dev/null || true

uvicorn main:app --host 0.0.0.0 --port 8080 --reload &
BACKEND_PID=$!
echo "✅ Backend → http://localhost:8080  (PID $BACKEND_PID)"

# ---- Frontend -----------------------------------------------
cd ../frontend
if [ ! -d node_modules ]; then
  echo "📦 Installing npm packages..."
  npm install --silent
fi
npm run dev &
FRONT_PID=$!
echo "✅ Frontend → http://localhost:3000  (PID $FRONT_PID)"

trap "echo '🛑 stopping...'; kill $BACKEND_PID $FRONT_PID 2>/dev/null" EXIT
wait
