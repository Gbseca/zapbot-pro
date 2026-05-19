# 🚀 ZapBot Pro v3.0

O **ZapBot Pro** é uma solução avançada e custo zero de automação de WhatsApp Web, desenvolvida especificamente para a **Moove Proteção Veicular**. O sistema qualifica leads de forma inteligente com IA, gerencia lembretes de retorno (agenda), notifica consultores e oferece um painel administrativo completo com visualização em Kanban (CRM).

---

## 🌟 Principais Recursos da Versão 3.0

### 1. 🧠 Camada de IA & Pipeline de Decisão Avançado
* **State Machine de Atendimento**: Fluxos estruturados que evitam comportamento de chatbot genérico. A IA atua de forma humanizada, consultiva e segura.
* **Fallback Determinístico por Regex**: Se a chamada de API de IA falhar ou estourar o limite de requisições, o bot assume o controle de forma determinística por regras de expressão regular, garantindo resposta imediata ao cliente.
* **Handoff Inteligente**: Redirecionamento ágil para atendentes humanos quando o cliente menciona palavras-chave como "boleto", "atraso", "pagamento" ou "falar com atendente".
* **Base de Conhecimento Rígida**: Carregamento dinâmico de manuais da Moove (perfil, coberturas, vistorias e regras operacionais) via arquivos locais ou PDFs.

### 2. 📋 Painel CRM Kanban (Arrastar & Soltar)
* **Organização Visual**: Leads representados como cartões organizados em colunas verticais (`Novos`, `Em Atendimento`, `Humano/Boleto`, `Qualificados/Resolvidos`, `Frios`).
* **Interação Fluida**: Arrastar cartões atualiza automaticamente os status no backend.
* **CRM Tools no Modal**:
  * **Etiquetas Coloridas (Tags)**: Classificação visual dos clientes (Quente, Morno, Frio, Boleto, Suporte).
  * **Agendar Retorno Integrado**: Campo de data/hora que sincroniza com a base de agendamentos (`reminders`) e permite concluir compromissos (✓) diretamente da interface.

### 3. 🔊 Alertas e Chimes Sonoros Premium
* **Notificação Dual-Voice**: Chime sonoro de notificação elegante sintetizado usando múltiplos osciladores (`triangle` e `sine` waves) para alertas imediatos de leads que precisam de atenção.
* **Notificação de Sistema**: Alertas no navegador para novos leads e solicitações de atendimento.

---

## ⚙️ Variáveis de Ambiente e Configurações

As seguintes variáveis configuram o comportamento do bot:

* `PORT`: Porta de execução do painel administrativo (padrão: `3001`).
* `APP_STORAGE_DIR`: Caminho da pasta física onde o bot salva os dados locais (sessão do WhatsApp, arquivos JSON e cache de PDFs). Se não for declarada, os arquivos serão salvos na pasta raiz do projeto.
* `GROQ_API_KEY` / `GEMINI_API_KEY`: Chaves de autenticação das IAs.

---

## 🚀 Instalação e Execução Local

1. Instale as dependências necessárias:
   ```bash
   npm install
   ```

2. Inicie o servidor:
   ```cmd
   npm run dev
   ```

3. Acesse o painel pelo navegador:
   ```
   http://localhost:3001
   ```

---

## 🔒 Boas Práticas e Segurança

* **Privacidade de Credenciais**: O arquivo `config.json` que contém as chaves de API é gerado localmente na pasta especificada em `APP_STORAGE_DIR` ou na subpasta `backend/data/` (ambas ignoradas no `.gitignore`). Nunca versione chaves privadas.
* **WhatsApp Session**: A pasta `auth_info/` contém os arquivos de autenticação do WhatsApp Web e também está listada no `.gitignore` para proteção das suas credenciais.
