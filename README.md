# ZapBot Pro

Automacao de WhatsApp com campanhas, qualificacao por IA e painel web local.

## Principais ajustes desta versao

- IA com modelo principal separado do modelo de qualificacao.
- Qualificacao estruturada em JSON, sem depender de marcador regex fragil.
- Telefone do proprio chat normalizado automaticamente no lead.
- Menor latencia de resposta no WhatsApp.
- `campaignLoopEnabled` respeitado no backend.
- PDFs realmente entram no contexto da IA.
- Suporte a armazenamento persistente via `APP_STORAGE_DIR`.

## Rodando localmente

```bash
npm install
npm start
```

O painel sobe em `http://localhost:3001`.

## Variaveis importantes

- `PORT`: porta do servidor.
- `APP_STORAGE_DIR`: pasta persistente para sessao do WhatsApp, config, leads e cache de PDFs.

Sem `APP_STORAGE_DIR`, os dados ficam dentro de `backend/`.

## Deploy recomendado

Para este projeto, o melhor fit gratuito costuma ser o Railway, porque o app precisa de:

- processo Node sempre ativo
- conexao longa com WhatsApp Web/Baileys
- WebSocket
- armazenamento persistente para a sessao

### Configuracao sugerida no Railway

1. Crie um volume persistente.
2. Defina `APP_STORAGE_DIR=/data/zapbot-pro`.
3. Defina as chaves de IA no painel ou pela interface do proprio app.
4. Suba o projeto usando o `railway.toml` ja incluido.

## Observacoes

- Nao versione sessao do WhatsApp nem arquivos `config.json`, `leads.json` e cache de PDFs.
- Vercel/Netlify nao sao um bom destino para o backend completo deste projeto por causa da conexao persistente do WhatsApp.
