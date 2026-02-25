#!/bin/sh
# OpenClaw JS - Docker Build Script
# Uso: ./docker-build.sh [tag]

set -e

TAG="${1:-latest}"
IMAGE_NAME="openclaw-js"

echo "🦞 OpenClaw JS - Docker Build"
echo "=============================="
echo ""
echo "Building image: ${IMAGE_NAME}:${TAG}"
echo ""

# Build da imagem
docker build \
  --target production \
  -t "${IMAGE_NAME}:${TAG}" \
  -t "${IMAGE_NAME}:latest" \
  .

echo ""
echo "✅ Build completed successfully!"
echo ""
echo "To run the container:"
echo "  docker run -d \\"
echo "    --name openclaw \\"
echo "    -p 18789:18789 \\"
echo "    -v openclaw-data:/app/.openclaw \\"
echo "    --env-file .env \\"
echo "    ${IMAGE_NAME}:latest"
echo ""
echo "Or use docker-compose:"
echo "  docker-compose up -d"
