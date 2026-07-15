# MoOve IA

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
- Historico, monitoramentos recorrentes e alertas de mudancas em anuncios.
- Comparacao de criativos, biblioteca de referencias e matriz de testes A/B.
- Auditoria basica de paginas de destino, exportacao CSV e gerador de UTM.
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

## Pesquisa Ads

A Pesquisa Ads usa dados publicos da Biblioteca de Anuncios da Meta. O coletor precisa do Chromium do Playwright no mesmo usuario que executa o Node.js.

Em Linux, a instalacao completa e repetivel fica em:

```bash
bash scripts/install-ad-research-browser.sh
```

Para validar o coletor e, opcionalmente, executar uma pesquisa real:

```bash
npm run verify:ad-research -- http://127.0.0.1:3001
npm run verify:ad-research -- http://127.0.0.1:3001 --search
```

O modulo mantem fila com uma coleta por vez, cache local, cancelamento, diagnosticos e persistencia em `APP_STORAGE_DIR`. Os indicadores de forca e relevancia sao estimativas explicaveis baseadas em sinais publicos; eles nao representam impressoes, vendas ou resultados informados pela Meta.

Se o Chromium for administrado pelo sistema, defina `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` com o caminho absoluto. O coletor tambem detecta automaticamente instalacoes comuns do Chrome e Chromium no Linux.

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

