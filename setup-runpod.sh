#!/bin/bash
# =============================================================================
# Knowledge Harvester Pipeline -- RunPod Deployment Script
# =============================================================================
# Run this on a fresh RunPod GPU pod to set up and start the full stack.
#
# Usage:
#   bash setup-runpod.sh            -- full setup + start
#   bash setup-runpod.sh --rebuild  -- rebuild images from source
# =============================================================================
set -euo pipefail

REPO_DIR="${REPO_DIR:-/workspace/knowledge-harvester-pipeline}"
DATA_DIR="${DATA_DIR:-/workspace/data}"
COMPOSE_FILE="docker-compose.yml"
REBUILD=false
SKIP_VLLM=false

for arg in "$@"; do
  case $arg in
    --rebuild)   REBUILD=true ;;
    --skip-vllm) SKIP_VLLM=true ;;
  esac
done

# ---- Helpers ----
log()  { echo "[$(date +'%H:%M:%S')] $*"; }
fail() { echo "[ERROR] $*" >&2; exit 1; }

# ---- Pre-flight checks ----
log "Running pre-flight checks..."

# GPU
if command -v nvidia-smi &>/dev/null; then
  GPU_NAME=$(nvidia-smi --query-gpu=name --format=csv,noheader | head -1)
  GPU_MEM=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader | head -1)
  log "GPU detected: $GPU_NAME ($GPU_MEM)"
else
  fail "nvidia-smi not found. This script requires an NVIDIA GPU pod."
fi

# Docker
if ! command -v docker &>/dev/null; then
  fail "Docker is not installed. Use a RunPod template with Docker support."
fi

# Docker Compose (v2 plugin or standalone)
if docker compose version &>/dev/null; then
  COMPOSE_CMD="docker compose"
elif command -v docker-compose &>/dev/null; then
  COMPOSE_CMD="docker-compose"
else
  log "Installing docker-compose..."
  curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" \
    -o /usr/local/bin/docker-compose
  chmod +x /usr/local/bin/docker-compose
  COMPOSE_CMD="docker-compose"
fi
log "Compose: $($COMPOSE_CMD version --short 2>/dev/null || $COMPOSE_CMD version)"

# NVIDIA Container Toolkit
if ! docker info 2>/dev/null | grep -q "nvidia"; then
  log "WARNING: NVIDIA container runtime may not be configured."
  log "  If vLLM fails to start, install nvidia-container-toolkit."
fi

# ---- Repository ----
if [ ! -d "$REPO_DIR" ]; then
  fail "Repository not found at $REPO_DIR. Clone it first."
fi
cd "$REPO_DIR"
log "Working directory: $REPO_DIR"

# ---- Environment file ----
if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    log "Created .env from .env.example -- EDIT IT with your real credentials."
    log "  Required: MUNINNDB_URL, MUNINNDB_API_KEY"
    log "  Optional: AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET"
  else
    fail ".env.example not found. Cannot create .env template."
  fi
fi

# ---- Data directory ----
mkdir -p "$DATA_DIR"
mkdir -p ./data
ln -sfn "$DATA_DIR" ./data 2>/dev/null || true
log "Data directory: $DATA_DIR (symlinked to ./data)"

# ---- Remove dev override if present (RunPod uses real GPU) ----
if [ -f docker-compose.override.yml ]; then
  log "Removing docker-compose.override.yml (not needed on RunPod with GPU)."
  mv docker-compose.override.yml docker-compose.override.yml.bak
fi

# ---- Pull / Build ----
if [ "$REBUILD" = true ]; then
  log "Rebuilding images from source..."
  $COMPOSE_CMD -f "$COMPOSE_FILE" build --no-cache pipeline
else
  log "Pulling pre-built images..."
  $COMPOSE_CMD -f "$COMPOSE_FILE" pull nats vllm || true
  log "Building pipeline image..."
  $COMPOSE_CMD -f "$COMPOSE_FILE" build pipeline
fi

# ---- Start services ----
log "Starting services..."
$COMPOSE_CMD -f "$COMPOSE_FILE" up -d

# ---- Wait for health checks ----
log "Waiting for services to become healthy..."

wait_healthy() {
  local service=$1
  local max_wait=$2
  local elapsed=0

  while [ $elapsed -lt $max_wait ]; do
    status=$($COMPOSE_CMD -f "$COMPOSE_FILE" ps --format json "$service" 2>/dev/null | grep -o '"Health":"[^"]*"' | head -1 || echo "")
    if echo "$status" | grep -q "healthy"; then
      log "  $service: healthy"
      return 0
    fi
    sleep 5
    elapsed=$((elapsed + 5))
  done

  log "  WARNING: $service not healthy after ${max_wait}s (may still be starting)"
  return 1
}

wait_healthy "nats" 30
wait_healthy "vllm" 300
wait_healthy "pipeline" 60

# ---- Status ----
HOST_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")

echo ""
echo "============================================"
echo "  Knowledge Harvester -- Deployment Status"
echo "============================================"
$COMPOSE_CMD -f "$COMPOSE_FILE" ps
echo ""
echo "  UI:       http://${HOST_IP}:3001"
echo "  API:      http://${HOST_IP}:3001/api/health"
echo "  vLLM:     http://${HOST_IP}:8000/health"
echo "  NATS:     http://${HOST_IP}:8222"
echo ""
echo "  Logs:     $COMPOSE_CMD -f $COMPOSE_FILE logs -f"
echo "  Stop:     $COMPOSE_CMD -f $COMPOSE_FILE down"
echo "  Restart:  $COMPOSE_CMD -f $COMPOSE_FILE restart pipeline"
echo "============================================"
echo ""
log "Tailing logs for 10 seconds (Ctrl+C to stop)..."
timeout 10 $COMPOSE_CMD -f "$COMPOSE_FILE" logs -f --tail=20 || true
