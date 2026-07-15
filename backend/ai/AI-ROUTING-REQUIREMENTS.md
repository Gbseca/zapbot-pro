# Requisitos de roteamento da IA

Atualizado em: 2026-07-13

## Objetivo

O MoOve IA deve identificar a intencao da mensagem mais recente e separar com seguranca:

- interesse comercial real em cotacao;
- atendimento operacional de associado;
- pergunta apenas informativa;
- pedido explicito de atendimento humano.

Todos os atendimentos operacionais sao encaminhados aos consultores cadastrados. Nao existem equipes separadas de suporte ou financeiro. Os status antigos continuam no armazenamento apenas por compatibilidade com o painel.

## Regras obrigatorias

1. Reboque, assistencia, evento com veiculo, boleto, pagamento, comprovante, cobranca, inadimplencia, aplicativo, cancelamento, reativacao e revistoria sao atendimentos de consultor.
2. Se o telefone real ja estiver resolvido, o consultor deve ser avisado imediatamente.
3. Se o telefone real nao estiver resolvido, o bot faz somente uma pergunta: WhatsApp com DDD.
4. O bot nao pede nome, modelo, ano ou placa antes de um encaminhamento operacional.
5. O consultor deve ser avisado antes de o cliente receber a confirmacao de encaminhamento.
6. Se nao houver consultor ou o envio falhar, o bot registra `handoff_failed`, pausa a automacao e nao afirma que encaminhou.
7. Atendimentos criticos nao ficam presos ao horario comercial.
8. Midia sem texto e ignorada. Uma legenda e tratada apenas como mensagem de texto.
9. O bot nao transcreve audio, interpreta documento, processa foto ou usa localizacao.
10. O bot nunca afirma que um reboque esta a caminho, que um pagamento foi confirmado, que houve baixa ou que o aplicativo foi liberado.
11. Respostas ao cliente nao usam `seguro`, `seguradora`, `apolice`, `sinistro` ou `premio`.
12. Mensagens operacionais seguras nao sao reescritas por um modelo generativo.

## Prioridade de intencao

- Uma correcao explicita na mensagem mais recente vence o assunto anterior.
- `nao quero boleto, quero cotacao` e comercial.
- `nao paguei, preciso do boleto` e pedido de boleto.
- `nao bati, o carro parou` e pedido de assistencia.
- `quero cancelar o boleto e gerar outro` e pedido de boleto.
- `quero cancelar a cotacao` e desistencia comercial, nao cancelamento da associacao.
- Perguntas hipoteticas como `se eu bater` ou `quantos km de reboque` continuam informativas.
- Um pedido real e atual como `reboque`, `bati o carro` ou `meu carro parou` e encaminhado.

## Resumo enviado ao consultor

O aviso deve conter:

- nome e WhatsApp disponiveis;
- intencao em linguagem clara;
- ultima mensagem do cliente;
- contexto recente quando ajudar;
- dados operacionais ja conhecidos;
- acao sugerida sem prometer acesso ou resultado inexistente.

A primeira frase antiga da conversa nao deve substituir a intencao atual.

## Falhas corrigidas

- regras de intencao duplicadas e divergentes;
- casos operacionais novos nao gravados no CRM;
- confirmacao enviada ao cliente antes da notificacao do consultor;
- falha de envio engolida sem status persistido;
- pedidos sem telefone desviados para mensagem de fora do horario;
- pedido de humano interpretado como falta de interesse comercial;
- mudanca de boleto para cotacao ignorada durante coleta de telefone;
- revistoria exigindo placa antes do consultor;
- numero invalido montado pela repeticao da mesma mensagem;
- CPF ou CNPJ aceito como WhatsApp;
- resumo do consultor baseado em mensagem antiga;
- rotulos visiveis de equipes de suporte e financeiro inexistentes;
- dependencia do Supabase usada pelo codigo, mas ausente do projeto.

## Cobertura automatizada

Os testes em `conversation-regression.test.js` e `agent-handoff.integration.test.js` cobrem:

- mais de cem frases com linguagem comum, abreviacoes, erros de digitacao e irritacao;
- negacoes, correcoes e perguntas hipoteticas;
- mensagens curtas divididas em mais de um envio;
- telefone conhecido e telefone desconhecido por LID;
- ordem consultor antes do cliente;
- persistencia no CRM;
- ausencia de consultor e falha de entrega;
- operacao fora do horario comercial;
- midia sem texto;
- termos proibidos e promessas operacionais indevidas.
