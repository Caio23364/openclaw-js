# OpenClaw JS - Dockerfile
# Multi-stage build para otimizar a imagem final

# ============================================
# Stage 1: Build
# ============================================
FROM node:22-alpine AS builder

# Instalar dependências de build
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copiar arquivos de dependências primeiro (cache layer)
COPY package*.json ./
COPY tsconfig.json ./

# Instalar TODAS as dependências (incluindo devDependencies)
RUN npm ci

# Copiar código fonte
COPY src ./src
COPY bin ./bin

# Compilar TypeScript
RUN npm run build

# ============================================
# Stage 2: Production
# ============================================
FROM node:22-alpine AS production

# Instalar dependências para Puppeteer (Chromium)
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    # Dependências adicionais para Puppeteer
    dumb-init \
    curl \
    && rm -rf /var/cache/apk/*

# Configurar Puppeteer para usar Chromium do Alpine
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    NODE_ENV=production

# Criar usuário não-root para segurança
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /app

# Copiar arquivos de dependências
COPY package*.json ./

# Instalar apenas dependências de produção
RUN npm ci --omit=dev && \
    npm cache clean --force

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
