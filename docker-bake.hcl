// OpenClaw JS - Docker Bake Configuration
// Build multi-plataforma para AMD64 e ARM64
// Uso: docker buildx bake

variable "IMAGE_NAME" {
    default = "openclaw-js"
}

variable "IMAGE_TAG" {
    default = "latest"
}

group "default" {
    targets = ["production"]
}

target "docker-metadata-action" {}

target "production" {
    inherits = ["docker-metadata-action"]
    context = "."
    dockerfile = "Dockerfile"
    target = "production"
    platforms = [
        "linux/amd64",
        "linux/arm64"
    ]
    tags = [
        "${IMAGE_NAME}:${IMAGE_TAG}",
        "${IMAGE_NAME}:latest"
    ]
    cache-from = [
        "type=gha",
        "type=registry,ref=${IMAGE_NAME}:buildcache"
    ]
    cache-to = [
        "type=gha,mode=max",
        "type=registry,ref=${IMAGE_NAME}:buildcache,mode=max"
    ]
}

// Target para desenvolvimento local (apenas arquitetura nativa)
target "dev" {
    context = "."
    dockerfile = "Dockerfile"
    target = "production"
    tags = ["${IMAGE_NAME}:dev"]
    cache-from = ["type=local,src=.docker-cache"]
    cache-to = ["type=local,dest=.docker-cache,mode=max"]
    output = ["type=docker"]
}
