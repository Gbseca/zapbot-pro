# MoOve IA | Atendimento e CRM para WhatsApp

O projeto conecta o atendimento pelo WhatsApp ao acompanhamento comercial. As conversas chegam ao painel, os leads ficam organizados e a automação pode apoiar as respostas. Quando o fluxo pede intervenção, o atendimento passa para uma pessoa. Foi desenvolvido a partir das necessidades da operação da Moove Proteção Veicular.

## O que você encontra

- Integração de WhatsApp, CRM e IA no mesmo fluxo de trabalho.
- Respostas por regras como alternativa à IA e passagem para atendimento humano.
- Pesquisa de anúncios públicos e organização de referências para campanhas.

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

O painel fica disponível em:

```text
http://localhost:3001
```

## Pesquisa Ads

A Pesquisa Ads usa dados públicos da Biblioteca de Anúncios da Meta. O coletor precisa do Chromium do Playwright no mesmo usuário que executa o Node.js.

Em Linux, a instalação completa e repetível fica em:

```bash
bash scripts/install-ad-research-browser.sh
```

Para validar o coletor e, opcionalmente, executar uma pesquisa real:

```bash
npm run verify:ad-research -- http://127.0.0.1:3001
npm run verify:ad-research -- http://127.0.0.1:3001 --search
```

O módulo mantém fila com uma coleta por vez, cache local, cancelamento, diagnósticos e persistência em `APP_STORAGE_DIR`. Os indicadores de força e relevância são estimativas explicáveis baseadas em sinais públicos; eles não representam impressões, vendas ou resultados informados pela Meta.

Se o Chromium for administrado pelo sistema, defina `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` com o caminho absoluto. O coletor também detecta automaticamente instalações comuns do Chrome e Chromium no Linux.

## Variáveis E Configuração

Configure as chaves e caminhos necessários por variáveis de ambiente ou pelos arquivos locais ignorados pelo Git.

```bash
PORT=
APP_STORAGE_DIR=
GEMINI_API_KEY=
GROQ_API_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
```

## Segurança

- Não versionar sessões do WhatsApp.
- Não publicar chaves de API.
- Manter arquivos de configuração sensíveis fora do repositório.
- Revisar regras de atendimento antes de usar em produção.
