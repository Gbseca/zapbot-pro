# ZapBot Pro

Sistema de atendimento e CRM para WhatsApp, criado para qualificar leads, organizar conversas e apoiar consultores com um painel administrativo. O projeto combina automacao, regras deterministicas, IA e uma interface de acompanhamento comercial.

## Funcionalidades

- Conexao com WhatsApp Web via Baileys.
- Atendimento automatizado com fluxo de estados.
- Uso de IA para respostas consultivas quando configurado.
- Fallback por regras para manter o atendimento funcionando sem IA.
- Handoff para atendimento humano em casos sensiveis.
- Painel CRM em kanban para acompanhar leads.
- Etiquetas, lembretes e historico operacional.
- Pesquisa e coleta de anuncios para apoio comercial.
- Persistencia com Supabase e arquivos locais conforme configuracao.

## Stack

- Node.js
- Express
- Baileys
- Supabase
- Google Generative AI
- Playwright
- WebSocket
- Docker
- Railway

## Como Rodar

```bash
npm install
npm run dev
```

O painel fica disponivel em:

```text
http://localhost:3001
```

## Variaveis E Configuracao

Configure as chaves e caminhos necessarios por variaveis de ambiente ou pelos arquivos locais ignorados pelo Git.

```bash
PORT=
APP_STORAGE_DIR=
GEMINI_API_KEY=
GROQ_API_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
```

## Seguranca

- Nao versionar sessoes do WhatsApp.
- Nao publicar chaves de API.
- Manter arquivos de configuracao sensiveis fora do repositorio.
- Revisar regras de atendimento antes de usar em producao.

## Observacoes De Engenharia

O projeto mostra integracao entre backend, automacao de mensageria, painel administrativo e IA. Para portfolio, vale destacar principalmente a arquitetura de fallback, o handoff humano e o kanban de leads, porque esses pontos mostram preocupacao com operacao real.

