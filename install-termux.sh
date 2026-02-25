#!/data/data/com.termux/files/usr/bin/bash
# OpenClaw JS - Termux Installer
# Instalação automatizada para Android via Termux
# Uso: curl -fsSL https://raw.githubusercontent.com/user/openclaw-js/main/install-termux.sh | bash

set -e

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configurações
INSTALL_DIR="$HOME/openclaw-js"
REPO_URL="https://github.com/openclaw/openclaw-js.git"
NODE_VERSION="22"

echo -e "${BLUE}"
echo "🦞 OpenClaw JS - Termux Installer"
echo "=================================="
echo -e "${NC}"

# Verificar se está no Termux
if [ -z "$TERMUX_VERSION" ] && [ ! -d "/data/data/com.termux" ]; then
    echo -e "${YELLOW}⚠️  Aviso: Este script é otimizado para Termux (Android)${NC}"
    echo "Continuando mesmo assim..."
    sleep 2
fi

# Função para verificar comando existe
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Atualizar pacotes
echo -e "${BLUE}📦 Atualizando pacotes...${NC}"
pkg update -y

# Instalar dependências necessárias
echo -e "${BLUE}📦 Instalando dependências...${NC}"
pkg install -y git nodejs-lts python build-essential openssl

# Verificar Node.js version
echo -e "${BLUE}🔍 Verificando Node.js...${NC}"
if command_exists node; then
    NODE_CURRENT=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_CURRENT" -lt "22" ]; then
        echo -e "${YELLOW}⚠️  Node.js $NODE_CURRENT detectado. Atualizando para LTS...${NC}"
        pkg install -y nodejs-lts
    else
        echo -e "${GREEN}✅ Node.js $(node --version) OK${NC}"
    fi
else
    echo -e "${RED}❌ Node.js não instalado. Tentando instalar...${NC}"
    pkg install -y nodejs-lts
fi

# Verificar npm
echo -e "${BLUE}🔍 Verificando npm...${NC}"
if ! command_exists npm; then
    echo -e "${RED}❌ npm não encontrado. Instalando...${NC}"
    pkg install -y nodejs-lts
fi
echo -e "${GREEN}✅ npm $(npm --version) OK${NC}"

# Clonar ou atualizar repositório
if [ -d "$INSTALL_DIR" ]; then
    echo -e "${YELLOW}📂 Diretório existente encontrado. Atualizando...${NC}"
    cd "$INSTALL_DIR"
    git pull origin main || echo -e "${YELLOW}⚠️  Não foi possível atualizar. Continuando com versão local...${NC}"
else
    echo -e "${BLUE}📥 Clonando repositório...${NC}"
    git clone "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

# Instalar dependências npm
echo -e "${BLUE}📦 Instalando dependências do projeto...${NC}"
npm install

# Criar .env inicial
echo -e "${BLUE}⚙️  Configurando ambiente...${NC}"
if [ ! -f ".env" ]; then
    cp .env.example .env
    echo -e "${GREEN}✅ Arquivo .env criado${NC}"
fi

# Configurações específicas para Termux
echo -e "${BLUE}🔧 Aplicando configurações para Termux...${NC}"

# Configurar para usar 0.0.0.0 no Termux (necessário para acesso)
if ! grep -q "GATEWAY_HOST=0.0.0.0" .env; then
    echo "" >> .env
    echo "# Termux specific settings" >> .env
    echo "GATEWAY_HOST=0.0.0.0" >> .env
fi

# Desabilitar browser no Termux (Chromium não disponível nativamente)
if ! grep -q "ENABLE_BROWSER=false" .env; then
    echo "ENABLE_BROWSER=false" >> .env
fi

# Configurar puppeteer para não baixar Chrome
if ! grep -q "PUPPETEER_SKIP_DOWNLOAD=true" .env; then
    echo "PUPPETEER_SKIP_DOWNLOAD=true" >> .env
fi

# Criar script de atalho
echo -e "${BLUE}📝 Criando atalhos...${NC}"
mkdir -p $HOME/.shortcuts
cat > $HOME/.shortcuts/openclaw << 'EOF'
#!/data/data/com.termux/files/usr/bin/bash
cd ~/openclaw-js
npm start
EOF
chmod +x $HOME/.shortcuts/openclaw

# Criar comando termux-openclaw
mkdir -p $HOME/.termux/bin
cat > $HOME/.termux/bin/openclaw << EOF
#!/data/data/com.termux/files/usr/bin/bash
cd $INSTALL_DIR
exec npm start "\$@"
EOF
chmod +x $HOME/.termux/bin/openclaw

# Adicionar ao bashrc se não existir
if ! grep -q "openclaw-js" "$HOME/.bashrc" 2>/dev/null; then
    echo "" >> "$HOME/.bashrc"
    echo "# OpenClaw JS" >> "$HOME/.bashrc"
    echo 'export PATH="$HOME/.termux/bin:$PATH"' >> "$HOME/.bashrc"
    echo 'alias openclaw="cd ~/openclaw-js && npm start"' >> "$HOME/.bashrc"
fi

# Criar script de atualização
cat > $INSTALL_DIR/update-termux.sh << 'EOF'
#!/data/data/com.termux/files/usr/bin/bash
cd ~/openclaw-js
echo "🦞 Atualizando OpenClaw JS..."
git pull origin main
npm install
echo "✅ Atualização completa!"
EOF
chmod +x $INSTALL_DIR/update-termux.sh

echo ""
echo -e "${GREEN}====================================${NC}"
echo -e "${GREEN}✅ Instalação Completa!${NC}"
echo -e "${GREEN}====================================${NC}"
echo ""
echo -e "${BLUE}📍 Local de instalação:${NC} $INSTALL_DIR"
echo ""
echo -e "${YELLOW}📝 Próximos passos:${NC}"
echo ""
echo "1. ${GREEN}Configure suas API keys:${NC}"
echo "   nano ~/openclaw-js/.env"
echo "   (Adicione pelo menos ANTHROPIC_API_KEY ou OPENAI_API_KEY)"
echo ""
echo "2. ${GREEN}Inicie o OpenClaw:${NC}"
echo "   openclaw"
echo "   ou"
echo "   cd ~/openclaw-js && npm start"
echo ""
echo "3. ${GREEN}Acesse o gateway:${NC}"
echo "   http://localhost:18789"
echo "   (ou use o IP do seu dispositivo na rede local)"
echo ""
echo -e "${YELLOW}⚠️  Notas importantes para Termux:${NC}"
echo "   • Browser automation está DESATIVADO (sem Chrome no Android)"
echo "   • Para atualizar: ./update-termux.sh"
echo "   • Execute 'termux-wake-lock' para manter rodando em background"
echo "   • Adicione ao Termux:Widget para iniciar pela tela inicial"
echo ""
echo -e "${GREEN}🦞 Bom proveito!${NC}"
