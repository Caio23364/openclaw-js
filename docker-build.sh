#!/bin/sh
# OpenClaw JS - Docker Build Script
# Suporte multi-plataforma: AMD64 e ARM64 (Apple Silicon, Raspberry Pi, etc.)
# Uso: ./docker-build.sh [tag] [platform]

set -e

TAG="${1:-latest}"
PLATFORM="${2:-}"  # Opcional: linux/amd64, linux/arm64, ou vazio para arquitetura nativa
IMAGE_NAME="openclaw-js"

echo "🦞 OpenClaw JS - Docker Build"
echo "=============================="
echo ""
echo "Image: ${IMAGE_NAME}:${TAG}"
echo "Platform: ${PLATFORM:-native (current arch)}"
echo ""

# Verificar se docker buildx está disponível
if docker buildx version >/dev/null 2>&1; then
    echo "✅ Docker Buildx detected"
    
    if [ -n "$PLATFORM" ]; then
        # Build específico para uma plataforma
        echo "Building for platform: $PLATFORM"
        docker buildx build \
            --platform "$PLATFORM" \
            --target production \
            -t "${IMAGE_NAME}:${TAG}" \
            --load \
            .
    else
        # Verificar se quer fazer build multi-plataforma
        echo ""
        echo "Opções de build:"
        echo "  1) Build nativo (arquitetura atual - mais rápido)"
        echo "  2) Build multi-plataforma (AMD64 + ARM64)"
        echo "  3) Build apenas AMD64"
        echo "  4) Build apenas ARM64 (Apple Silicon, Raspberry Pi)"
        echo ""
        
        # Se não houver input interativo, fazer build nativo
        if [ ! -t 0 ]; then
            echo "Modo não-interativo detectado. Fazendo build nativo..."
            docker build \
                --target production \
                -t "${IMAGE_NAME}:${TAG}" \
                .
        else
            printf "Escolha uma opção (1-4, padrão: 1): "
            read -r choice
            
            case "$choice" in
                2)
                    echo "🔨 Build multi-plataforma (pode demorar...)"
                    docker buildx build \
                        --platform linux/amd64,linux/arm64 \
                        --target production \
                        -t "${IMAGE_NAME}:${TAG}" \
                        -t "${IMAGE_NAME}:latest" \
                        --push \
                        .
                    echo "✅ Imagens enviadas para registry"
                    exit 0
                    ;;
                3)
                    PLATFORM="linux/amd64"
                    ;;
                4)
                    PLATFORM="linux/arm64"
                    ;;
                *)
                    # Build nativo com docker buildx
                    docker buildx build \
                        --target production \
                        -t "${IMAGE_NAME}:${TAG}" \
                        --load \
                        .
                    echo ""
                    echo "✅ Build completed successfully!"
                    show_usage
                    exit 0
                    ;;
            esac
            
            if [ -n "$PLATFORM" ]; then
                echo "🔨 Building for $PLATFORM..."
                docker buildx build \
                    --platform "$PLATFORM" \
                    --target production \
                    -t "${IMAGE_NAME}:${TAG}" \
                    --load \
                    .
            fi
        fi
    fi
else
    echo "⚠️  Docker Buildx não disponível, usando build tradicional"
    echo "   (apenas arquitetura nativa)"
    echo ""
    docker build \
        --target production \
        -t "${IMAGE_NAME}:${TAG}" \
        .
fi

echo ""
echo "✅ Build completed successfully!"
echo ""
show_usage

show_usage() {
    echo "Para rodar o container:"
    echo ""
    echo "  Linux/AMD64 (Intel/AMD tradicional):"
    echo "    docker run -d --name openclaw -p 18789:18789 --env-file .env ${IMAGE_NAME}:${TAG}"
    echo ""
    echo "  Linux/ARM64 (Apple Silicon M1/M2/M3, Raspberry Pi 4/5, AWS Graviton):"
    echo "    docker run -d --name openclaw -p 18789:18789 --env-file .env --platform linux/arm64 ${IMAGE_NAME}:${TAG}"
    echo ""
    echo "  Docker Compose (recomendado):"
    echo "    docker-compose up -d"
    echo ""
}

show_usage
