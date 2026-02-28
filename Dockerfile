# OpenClaw JS - Dockerfile
# Multi-stage build com suporte multi-plataforma (AMD64, ARM64)
# Compatível com: Linux AMD64, Linux ARM64, Apple Silicon (M1/M2/M3)

# ============================================
# Stage 1: Build
# ============================================
FROM node:22-alpine AS builder

# Argumentos de build
ARG TARGETPLATFORM
ARG BUILDPLATFORM
ARG TARGETARCH

RUN echo "Building on $BUILDPLATFORM for $TARGETPLATFORM (arch: $TARGETARCH)"

# Instalar dependências de build
# python3, make, g++ necessários para compilação de módulos nativos
RUN apk add --no-cache python3 make g++ git

WORKDIR /app

# Copiar arquivos de dependências primeiro (cache layer)
COPY package*.json ./
COPY tsconfig.json ./

# Instalar TODAS as dependências (incluindo devDependencies)
# Forçar rebuild de módulos nativos para a arquitetura alvo
RUN npm ci && npm cache clean --force

# Copiar código fonte
COPY src ./src
COPY bin ./bin

# Compilar TypeScript
RUN npm run build

# ============================================
# Stage 2: Production
# ============================================
FROM node:22-alpine AS production

ARG TARGETARCH

# Instalar dependências para Puppeteer (Chromium)
# As dependências variam ligeiramente entre AMD64 e ARM64
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    font-noto-emoji \
    # Dependências adicionais para Puppeteer funcionar corretamente
    dumb-init \
    curl \
    # Dependências adicionais para Alpine ARM64
    $([ "$TARGETARCH" = "arm64" ] && echo "chromium-chromedriver" || echo "") \
    && rm -rf /var/cache/apk/*

# Configurar Puppeteer para usar Chromium do Alpine
# Nota: O path do Chromium pode variar entre arquiteturas
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    NODE_ENV=production \
    # Desabilitar features de GPU que podem causar problemas em containers
    PUPPETEER_ARGS="--no-sandbox,--disable-setuid-sandbox,--disable-gpu,--disable-dev-shm-usage"

# Criar usuário não-root para segurança
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /app

# Copiar arquivos de dependências
COPY package*.json ./

# Instalar apenas dependências de produção
RUN npm ci --omit=dev && npm cache clean --force

# Copiar arquivos compilados do stage de build
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/bin ./bin

# Criar diretórios necessários para runtime
RUN mkdir -p /app/.openclaw/state /app/.openclaw/logs /app/.openclaw/skills /app/.openclaw/workspace && \
    chown -R nodejs:nodejs /app/.openclaw

# Mudar para usuário não-root
USER nodejs

# Expor porta do gateway
EXPOSE 18789

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:18789/health', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1))" || exit 1

# Usar dumb-init para gerenciar sinais corretamente
ENTRYPOINT ["dumb-init", "--"]

# Comando padrão: iniciar o gateway
CMD ["node", "dist/index.js"]
