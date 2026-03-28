#!/bin/bash
set -e

echo "============================================"
echo "  🍄 Mycelium Pipeline — Starting Services"
echo "============================================"

# Load .env if it exists (RunPod can also pass env vars via template)
if [ -f /app/.env ]; then
  set -a
  source /app/.env
  set +a
fi

# Defaults for all config
export NATS_URL="${NATS_URL:-nats://localhost:4222}"
export MUNINNDB_URL="${MUNINNDB_URL:-http://localhost:3030}"
export LLM_BASE_URL="${LLM_BASE_URL:-http://localhost:8000/v1}"
export LLM_MODEL="${LLM_MODEL:-mistralai/Mistral-7B-Instruct-v0.3}"
export AUTH_MODE="${AUTH_MODE:-dev}"
export JWT_DEV_SECRET="${JWT_DEV_SECRET:-mycelium-dev-secret}"
export POLL_INTERVAL_MS="${POLL_INTERVAL_MS:-30000}"
export MAX_CONCURRENT_EXTRACTIONS="${MAX_CONCURRENT_EXTRACTIONS:-8}"
export MUNINNDB_API_KEY="${MUNINNDB_API_KEY:-changeme}"

# Check required Azure vars
if [ -z "$AZURE_TENANT_ID" ] || [ -z "$AZURE_CLIENT_ID" ] || [ -z "$AZURE_CLIENT_SECRET" ]; then
  echo "⚠ WARNING: Azure AD credentials not set. Graph API polling will fail."
  echo "  Set AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET"
  echo "  via RunPod template env vars or /app/.env file"
  echo ""
  # Don't exit — let the pipeline start anyway so you can access the UI
fi

# Use /workspace for persistent storage if available (RunPod mounts it)
DATA_DIR="${DATA_DIR:-/data}"
mkdir -p "$DATA_DIR/nats" "$DATA_DIR/pipeline"

# Cache HuggingFace models to persistent volume
export HF_HOME="${DATA_DIR}/huggingface"
mkdir -p "$HF_HOME"

# ---- Start NATS ----
echo "[1/3] Starting NATS server..."
nats-server --jetstream --store_dir="$DATA_DIR/nats" --port=4222 --http_port=8222 &
NATS_PID=$!

# Wait for NATS
for i in $(seq 1 30); do
  if curl -sf http://localhost:8222/healthz > /dev/null 2>&1; then
    echo "  ✓ NATS ready"
    break
  fi
  sleep 1
done

# ---- Start vLLM ----
echo "[2/3] Starting vLLM server (this may take a few minutes on first run)..."
VLLM_ARGS=(
  --model "$LLM_MODEL"
  --max-model-len "${LLM_MAX_MODEL_LEN:-8192}"
  --gpu-memory-utilization 0.85
  --host 0.0.0.0
  --port 8000
)
# Add quantization flag only when explicitly set (e.g. for AWQ/GPTQ models)
if [ -n "${LLM_QUANTIZATION:-}" ]; then
  VLLM_ARGS+=(--quantization "$LLM_QUANTIZATION")
fi
python3 -m vllm.entrypoints.openai.api_server "${VLLM_ARGS[@]}" &
VLLM_PID=$!

# Wait for vLLM (model download + load can take minutes)
echo "  Waiting for vLLM to load model..."
for i in $(seq 1 300); do
  if curl -sf http://localhost:8000/health > /dev/null 2>&1; then
    echo "  ✓ vLLM ready"
    break
  fi
  if [ $i -eq 300 ]; then
    echo "  ✗ vLLM failed to start after 5 minutes"
    exit 1
  fi
  sleep 1
done

# ---- Start Pipeline ----
echo "[3/3] Starting Mycelium pipeline..."
cd /app
node dist/src/main.js &
PIPELINE_PID=$!

# Wait for pipeline
for i in $(seq 1 30); do
  if curl -sf http://localhost:3001/api/health > /dev/null 2>&1; then
    echo "  ✓ Pipeline ready"
    break
  fi
  sleep 1
done

echo ""
echo "============================================"
echo "  🍄 Mycelium is running!"
echo "  UI:       http://localhost:3001"
echo "  API:      http://localhost:3001/api/health"
echo "  vLLM:     http://localhost:8000"
echo "  NATS:     nats://localhost:4222"
echo "============================================"
echo ""

# Handle shutdown
cleanup() {
  echo "Shutting down..."
  kill $PIPELINE_PID $VLLM_PID $NATS_PID 2>/dev/null
  wait
  echo "Shutdown complete"
}
trap cleanup SIGTERM SIGINT

# Keep running — wait for any process to exit
wait -n $NATS_PID $VLLM_PID $PIPELINE_PID
echo "A service exited unexpectedly. Shutting down..."
cleanup
