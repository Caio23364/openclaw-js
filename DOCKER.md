# 🐳 OpenClaw JS - Docker Guide

Guia completo para rodar o OpenClaw JS em Docker.

## 📋 Pré-requisitos

- Docker Engine 24.0+
- Docker Compose 2.0+ (opcional, mas recomendado)
- Pelo menos 2GB de RAM disponível

## 🚀 Quick Start

### 1. Configure o ambiente

```bash
# Copie o arquivo de exemplo
cp .env.example .env

# Edite o .env com suas chaves de API
nano .env
```

### 2. Execute com Docker Compose (Recomendado)

```bash
# Construir e iniciar
docker-compose up -d

# Ver logs
docker-compose logs -f

# Parar
docker-compose down
```

### 3. Ou use Docker diretamente

```bash
# Construir a imagem
./docker-build.sh

# Rodar o container
docker run -d \
  --name openclaw \
  -p 18789:18789 \
  -v openclaw-data:/app/.openclaw \
  --env-file .env \
  openclaw-js:latest
```

## ⚙️ Configuração

### Variáveis de Ambiente Obrigatórias

No mínimo, configure uma chave de AI provider no `.env`:

```bash
# Escolha pelo menos uma
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=...
```

### Gateway

Por padrão, o gateway escuta em `0.0.0.0:18789` dentro do container.

Acesse de fora do container:
- WebSocket: `ws://localhost:18789`
- HTTP API: `http://localhost:18789`

### Persistência de Dados

Os dados são persistidos no volume Docker `openclaw-data`:

- Configurações: `~/.openclaw/config.json`
- Estado: `~/.openclaw/state/`
- Logs: `~/.openclaw/logs/`
- Skills: `~/.openclaw/skills/`

Para backup:

```bash
# Backup
docker run --rm -v openclaw-data:/data -v $(pwd):/backup alpine tar czf /backup/openclaw-backup.tar.gz -C /data .

# Restore
docker run --rm -v openclaw-data:/data -v $(pwd):/backup alpine tar xzf /backup/openclaw-backup.tar.gz -C /data
```

## 🔧 Comandos Úteis

### Docker Compose

```bash
# Iniciar
docker-compose up -d

# Ver logs em tempo real
docker-compose logs -f

# Reiniciar
docker-compose restart

# Parar e remover containers
docker-compose down

# Parar e remover containers + volumes (CUIDADO: apaga dados!)
docker-compose down -v
```

### Docker Puro

```bash
# Ver containers rodando
docker ps

# Ver logs
docker logs -f openclaw

# Executar comando no container
docker exec -it openclaw sh

# Reiniciar
docker restart openclaw

# Parar
docker stop openclaw

# Remover container
docker rm openclaw
```

## 🛠️ Build Manual

```bash
# Build simples
docker build -t openclaw-js .

# Build com tag específica
./docker-build.sh v2026.2.14

# Build multi-plataforma (amd64 + arm64)
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t openclaw-js:latest \
  --push .
```

## 🌐 Conectando a Serviços Externos

### Ollama Local

Para conectar ao Ollama rodando no host:

```bash
# No .env, use o IP especial do Docker host
OLLAMA_BASE_URL=http://host.docker.internal:11434/v1
```

Ou adicione o serviço Ollama no `docker-compose.yml` (já incluído, comentado).

### WhatsApp

O WhatsApp reescaneamento de QR code a cada reinicialização. Para persistir a sessão:

```bash
# Os dados já são persistidos automaticamente no volume
# Apenas não remova o volume entre reinicializações
```

### Custom Providers (OpenAI-Compatible)

Para usar providers customizados com Docker, adicione ao seu `.env`:

```bash
# Defina os prefixes dos providers customizados
CUSTOM_PROVIDERS=together,fireworks

# Configure cada provider
TOGETHER_NAME="Together AI"
TOGETHER_BASE_URL=https://api.together.xyz/v1
TOGETHER_API_KEY=sua-chave-aqui

FIREWORKS_NAME="Fireworks AI"
FIREWORKS_BASE_URL=https://api.fireworks.ai/inference/v1
FIREWORKS_API_KEY=sua-chave-aqui
```

Ou passe diretamente no `docker run`:

```bash
docker run -d \
  --name openclaw \
  -p 18789:18789 \
  -e CUSTOM_PROVIDERS=together \
  -e TOGETHER_NAME="Together AI" \
  -e TOGETHER_BASE_URL=https://api.together.xyz/v1 \
  -e TOGETHER_API_KEY=sua-chave \
  -v openclaw-data:/app/.openclaw \
  openclaw-js:latest
```

Uso após configurar:
```bash
# Via CLI
openclaw agent -m "Hello" --model together/llama-3.1-70b

# Ou no chat
/model together/llama-3.1-70b
```

## 🔒 Segurança

- O container roda como usuário não-root (`nodejs`)
- Puppeteer usa Chromium do Alpine (não baixa Chrome)
- Apenas porta 18789 é exposta
- Health check configurado

## 🐛 Troubleshooting

### Problema: Container não inicia

```bash
# Ver logs
docker logs openclaw

# Verificar se há erros de configuração
docker exec openclaw cat /app/.openclaw/config.json
```

### Problema: Gateway não responde

```bash
# Testar conectividade interna
docker exec openclaw wget -qO- http://localhost:18789/health

# Verificar portas expostas
docker port openclaw
```

### Problema: Puppeteer/Chrome não funciona

O Chromium já está incluído na imagem. Se houver problemas:

```bash
# Verificar se Chromium existe
docker exec openclaw which chromium-browser

# Testar Puppeteer
docker exec openclaw node -e "const puppeteer = require('puppeteer'); console.log('OK')"
```

### Problema: Permissões no volume

```bash
# Corrigir permissões
docker run --rm -v openclaw-data:/data alpine chown -R 1001:1001 /data
```

## 📊 Monitoramento

```bash
# Uso de recursos
docker stats openclaw

# Inspecionar container
docker inspect openclaw
```

## 📝 Notas

- A imagem usa Node.js 22 Alpine (~180MB base)
- Com Chromium adicionado, a imagem fica em torno de ~400MB
- O build multi-stage remove devDependencies da imagem final
- Use `docker-compose` para ambiente de desenvolvimento
- Use `docker run` direto para deployment simples
