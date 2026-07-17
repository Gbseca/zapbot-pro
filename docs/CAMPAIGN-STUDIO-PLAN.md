# Campaign Studio: plano de produto e engenharia

## Objetivo

Transformar o disparador atual em um estúdio de campanhas confiável, configurável e simples para contatos que autorizaram comunicações da Moove. O sistema deve preservar o contexto do Agente IA, impedir promessas indevidas, respeitar pedidos de saída e nunca esconder falhas de entrega.

## Limites reais

- O projeto usa Baileys conectado como dispositivo vinculado, e não a API oficial do WhatsApp Business.
- A própria documentação do Baileys desencoraja spam e uso massivo automatizado.
- A política do WhatsApp exige número fornecido pelo contato, opt-in e respeito imediato a opt-out.
- Uma mensagem aceita pelo socket não é prova de leitura ou entrega final.
- Nenhum software pode prometer ausência total de bloqueios, indisponibilidade de rede ou mudanças externas do WhatsApp.

## Arquitetura-alvo

1. **Campaign Store**: rascunhos, campanhas, destinatários, anexos, eventos, modelos, supressões e consumo diário persistidos de forma atômica.
2. **Audience Engine**: importação estruturada, campos personalizados, deduplicação, consentimento, supressão e limite de frequência.
3. **Content Engine**: blocos ordenados de texto, imagem, vídeo, áudio, documento e enquete, com variáveis e variantes aprovadas.
4. **Preflight Engine**: validação de destinatários, variáveis, mídia, termos proibidos, opt-out, conexão, janela e estimativa antes do lançamento.
5. **Durable Queue**: checkpoint após cada transição, retomada segura, idempotência por destinatário/bloco e nenhuma repetição automática após aceite sem confirmação.
6. **AI Copilot**: criação, revisão, encurtamento, variantes, análise de tom e resposta contextual, sempre com fallback determinístico.
7. **Operations Console**: teste controlado, lançamento, pausa, retomada, cancelamento, fila filtrável, histórico, diagnóstico e exportação.

## Matriz de 220 melhorias

**Status desta entrega:** 133 itens implementados e verificados. Os demais permanecem registrados como evolução futura e não são declarados como concluídos.

### Estratégia e gestão de campanhas

- [x] CAMP-001 [P0] Dar nome obrigatório a cada campanha.
- [x] CAMP-002 [P0] Registrar objetivo comercial ou operacional explícito.
- [x] CAMP-003 [P0] Salvar rascunho no servidor.
- [x] CAMP-004 [P0] Salvar rascunho automaticamente durante a edição.
- [ ] CAMP-005 [P1] Duplicar campanha sem copiar resultados antigos.
- [ ] CAMP-006 [P1] Arquivar campanhas concluídas.
- [ ] CAMP-007 [P1] Restaurar campanha arquivada como novo rascunho.
- [x] CAMP-008 [P0] Exibir histórico de campanhas com estado e data.
- [ ] CAMP-009 [P1] Pesquisar campanha por nome, objetivo ou conteúdo.
- [ ] CAMP-010 [P1] Filtrar histórico por estado, período e intenção.
- [ ] CAMP-011 [P1] Ordenar histórico por criação, início, término e desempenho.
- [ ] CAMP-012 [P1] Mostrar proprietário e última edição.
- [ ] CAMP-013 [P2] Adicionar notas internas da campanha.
- [ ] CAMP-014 [P2] Criar etiquetas para organizar campanhas.
- [ ] CAMP-015 [P1] Salvar modelos reutilizáveis.
- [ ] CAMP-016 [P1] Versionar modelos sem alterar campanhas antigas.
- [ ] CAMP-017 [P1] Comparar rascunho atual com a versão lançada.
- [x] CAMP-018 [P0] Bloquear edição destrutiva de campanha em execução.
- [ ] CAMP-019 [P1] Criar campanha a partir de resultado do Buscador de Anúncios.
- [ ] CAMP-020 [P1] Associar campanha a uma meta mensurável.

### Público, importação e segmentação

- [x] CAMP-021 [P0] Aceitar um telefone por linha.
- [x] CAMP-022 [P0] Importar CSV com cabeçalhos.
- [ ] CAMP-023 [P1] Mapear coluna de telefone antes de importar.
- [ ] CAMP-024 [P1] Mapear coluna de nome antes de importar.
- [x] CAMP-025 [P1] Importar campos personalizados do CSV.
- [x] CAMP-026 [P0] Validar DDD e tamanho do telefone.
- [x] CAMP-027 [P0] Normalizar números com e sem código 55.
- [x] CAMP-028 [P0] Deduplicar destinatários na mesma campanha.
- [ ] CAMP-029 [P1] Explicar por que cada linha foi rejeitada.
- [ ] CAMP-030 [P1] Permitir corrigir linhas inválidas no painel.
- [ ] CAMP-031 [P1] Exportar rejeitados em CSV.
- [ ] CAMP-032 [P1] Importar público a partir de leads filtrados.
- [ ] CAMP-033 [P1] Importar público a partir de etiquetas de leads.
- [ ] CAMP-034 [P1] Excluir consultores internos automaticamente.
- [x] CAMP-035 [P0] Mostrar prévia tabular dos destinatários.
- [x] CAMP-036 [P1] Buscar destinatário por nome ou telefone.
- [x] CAMP-037 [P1] Remover destinatários individualmente.
- [x] CAMP-038 [P1] Selecionar e remover destinatários em lote.
- [ ] CAMP-039 [P2] Criar segmentos salvos reutilizáveis.
- [ ] CAMP-040 [P2] Simular regras de segmento antes do lançamento.

### Consentimento, privacidade e supressão

- [x] CAMP-041 [P0] Exigir confirmação explícita de opt-in antes do envio.
- [x] CAMP-042 [P0] Registrar fonte do consentimento.
- [x] CAMP-043 [P0] Registrar data da confirmação de consentimento.
- [ ] CAMP-044 [P1] Mapear consentimento individual por coluna do CSV.
- [x] CAMP-045 [P0] Manter lista global de não contatar.
- [x] CAMP-046 [P0] Excluir suprimidos antes de criar a fila.
- [x] CAMP-047 [P0] Respeitar comando curto de saída recebido no WhatsApp.
- [x] CAMP-048 [P0] Confirmar ao contato que novas campanhas foram interrompidas.
- [x] CAMP-049 [P1] Permitir remover supressão apenas por ação interna consciente.
- [x] CAMP-050 [P1] Registrar motivo e origem da supressão.
- [ ] CAMP-051 [P1] Exportar lista de supressão.
- [ ] CAMP-052 [P1] Importar lista de supressão.
- [x] CAMP-053 [P0] Adicionar rodapé de saída configurável.
- [x] CAMP-054 [P0] Ativar rodapé de saída por padrão em campanha comercial.
- [x] CAMP-055 [P1] Bloquear uso de campos pessoais sensíveis na mensagem.
- [ ] CAMP-056 [P1] Mascarar telefone em logs exportáveis.
- [ ] CAMP-057 [P1] Definir prazo de retenção para anexos.
- [x] CAMP-058 [P1] Excluir anexos de rascunhos removidos.
- [ ] CAMP-059 [P2] Registrar trilha de auditoria de consentimento.
- [x] CAMP-060 [P2] Exibir resumo de privacidade no pré-lançamento.

### Compositor e estrutura da mensagem

- [x] CAMP-061 [P0] Compor conteúdo em blocos ordenados.
- [x] CAMP-062 [P0] Adicionar bloco de texto.
- [x] CAMP-063 [P0] Adicionar bloco de imagem.
- [x] CAMP-064 [P0] Adicionar bloco de vídeo.
- [x] CAMP-065 [P0] Adicionar bloco de áudio.
- [x] CAMP-066 [P0] Adicionar bloco de documento.
- [x] CAMP-067 [P0] Adicionar bloco de enquete.
- [x] CAMP-068 [P1] Reordenar blocos sem recriá-los.
- [ ] CAMP-069 [P1] Duplicar bloco.
- [ ] CAMP-070 [P1] Desativar bloco temporariamente.
- [x] CAMP-071 [P0] Exibir prévia na ordem real de envio.
- [x] CAMP-072 [P0] Contar mensagens por destinatário.
- [x] CAMP-073 [P0] Contar caracteres do texto.
- [ ] CAMP-074 [P1] Contar palavras e links.
- [ ] CAMP-075 [P1] Inserir formatação do WhatsApp por seleção.
- [ ] CAMP-076 [P1] Desfazer e refazer no editor.
- [ ] CAMP-077 [P1] Salvar trechos reutilizáveis.
- [ ] CAMP-078 [P1] Inserir CTA aprovado da Moove.
- [x] CAMP-079 [P0] Detectar pergunta dupla ou excesso de perguntas.
- [x] CAMP-080 [P0] Detectar termos comerciais proibidos da Moove.

### Mídia e anexos

- [x] CAMP-081 [P0] Aceitar JPEG, PNG, WebP e GIF compatíveis.
- [x] CAMP-082 [P0] Aceitar vídeo MP4 compatível.
- [x] CAMP-083 [P0] Aceitar áudio MP3, M4A e OGG compatíveis.
- [x] CAMP-084 [P0] Aceitar PDF.
- [x] CAMP-085 [P1] Aceitar DOCX, XLSX, PPTX, CSV e TXT.
- [x] CAMP-086 [P0] Validar MIME real do anexo.
- [x] CAMP-087 [P0] Limitar tamanho por tipo de mídia.
- [x] CAMP-088 [P0] Limitar quantidade de anexos por campanha.
- [x] CAMP-089 [P1] Mostrar nome, tipo e tamanho de cada anexo.
- [ ] CAMP-090 [P1] Renomear documento antes do envio.
- [x] CAMP-091 [P1] Adicionar legenda a imagem, vídeo e documento.
- [x] CAMP-092 [P1] Previsualizar imagem antes do lançamento.
- [ ] CAMP-093 [P1] Previsualizar vídeo antes do lançamento.
- [ ] CAMP-094 [P1] Reproduzir áudio antes do lançamento.
- [ ] CAMP-095 [P1] Identificar duração do áudio e vídeo quando possível.
- [x] CAMP-096 [P1] Remover anexo sem limpar a mensagem.
- [x] CAMP-097 [P0] Persistir mídia para retomada após reinício.
- [ ] CAMP-098 [P1] Calcular volume total da campanha.
- [ ] CAMP-099 [P2] Gerar miniaturas localmente.
- [ ] CAMP-100 [P2] Limpar mídia órfã automaticamente.

### Personalização, variantes e IA

- [x] CAMP-101 [P0] Suportar variável `{{numero}}`.
- [x] CAMP-102 [P0] Suportar variável `{{nome}}`.
- [x] CAMP-103 [P0] Suportar variáveis importadas do CSV.
- [x] CAMP-104 [P0] Mostrar todas as variáveis disponíveis.
- [ ] CAMP-105 [P0] Exigir valor padrão para variável opcional.
- [x] CAMP-106 [P0] Bloquear variáveis não resolvidas no pré-lançamento.
- [x] CAMP-107 [P1] Visualizar a mensagem com um destinatário real da amostra.
- [x] CAMP-108 [P1] Alternar entre amostras na prévia.
- [x] CAMP-109 [P0] Pedir à IA uma primeira versão da mensagem.
- [x] CAMP-110 [P0] Pedir à IA para encurtar a mensagem.
- [x] CAMP-111 [P0] Pedir à IA para deixar a mensagem mais natural.
- [x] CAMP-112 [P0] Pedir à IA para revisar termos proibidos.
- [ ] CAMP-113 [P1] Pedir à IA três CTAs alternativos.
- [x] CAMP-114 [P1] Gerar variante A e B.
- [x] CAMP-115 [P1] Distribuir variante por hash estável do destinatário.
- [x] CAMP-116 [P1] Registrar qual variante cada pessoa recebeu.
- [ ] CAMP-117 [P1] Bloquear variante não aprovada.
- [ ] CAMP-118 [P1] Comparar diferenças entre variantes.
- [x] CAMP-119 [P0] Usar fallback determinístico quando a IA estiver sem cota.
- [x] CAMP-120 [P0] Nunca deixar a criação da campanha dependente da IA.

### Agendamento e política de entrega

- [x] CAMP-121 [P0] Enviar imediatamente ou agendar data futura.
- [x] CAMP-122 [P0] Persistir o horário agendado.
- [x] CAMP-123 [P0] Exibir fuso horário da campanha.
- [x] CAMP-124 [P1] Escolher dias da semana permitidos.
- [x] CAMP-125 [P0] Definir janela diária de início e término.
- [x] CAMP-126 [P0] Tratar janelas que atravessam meia-noite.
- [ ] CAMP-127 [P1] Pausar em feriados cadastrados.
- [x] CAMP-128 [P0] Definir intervalo fixo.
- [x] CAMP-129 [P0] Definir intervalo aleatório transparente.
- [x] CAMP-130 [P0] Validar mínimo menor que máximo.
- [x] CAMP-131 [P0] Definir contatos por janela.
- [x] CAMP-132 [P0] Definir limite diário persistente.
- [x] CAMP-133 [P1] Definir limite semanal por contato.
- [x] CAMP-134 [P1] Aplicar frequency cap entre campanhas.
- [x] CAMP-135 [P1] Estimar data e hora reais de término.
- [ ] CAMP-136 [P1] Mostrar impacto de janela e limite na estimativa.
- [ ] CAMP-137 [P1] Oferecer presets conservador, equilibrado e manual.
- [x] CAMP-138 [P0] Remover qualquer mecanismo de caractere invisível.
- [x] CAMP-139 [P1] Manter digitação simulada opcional e transparente.
- [x] CAMP-140 [P0] Bloquear lançamento fora das configurações válidas.

### Fila, confiabilidade e recuperação

- [x] CAMP-141 [P0] Persistir fila e índice atual atomicamente.
- [x] CAMP-142 [P0] Persistir estado após cada destinatário.
- [x] CAMP-143 [P0] Recuperar campanha após reinício do servidor.
- [x] CAMP-144 [P0] Recuperar campanha como pausada para revisão.
- [x] CAMP-145 [P0] Usar chave idempotente por destinatário e bloco.
- [x] CAMP-146 [P0] Não repetir envio já aceito sem confirmação.
- [x] CAMP-147 [P0] Separar falha antes do aceite de falta de confirmação.
- [ ] CAMP-148 [P1] Permitir reenvio manual apenas para falha segura.
- [ ] CAMP-149 [P1] Exigir confirmação para reenvio com risco de duplicidade.
- [x] CAMP-150 [P0] Pausar após falhas consecutivas configuráveis.
- [ ] CAMP-151 [P0] Pausar se o WhatsApp desconectar.
- [ ] CAMP-152 [P0] Retomar somente quando conexão estiver saudável.
- [x] CAMP-153 [P1] Pausar por taxa de falha acima de limite.
- [x] CAMP-154 [P1] Pausar por taxa de não confirmação acima de limite.
- [x] CAMP-155 [P0] Manter diagnóstico de rota e messageId.
- [x] CAMP-156 [P1] Guardar múltiplos messageIds por destinatário.
- [ ] CAMP-157 [P1] Cancelar um destinatário pendente individualmente.
- [ ] CAMP-158 [P1] Pular destinatário e continuar a fila.
- [ ] CAMP-159 [P1] Retomar a partir de checkpoint explícito.
- [x] CAMP-160 [P0] Encerrar campanha com resumo consistente.

### Respostas, jornadas e integração com o Agente IA

- [x] CAMP-161 [P0] Associar resposta ao campaignId correto.
- [x] CAMP-162 [P0] Registrar mensagem e variante recebida pelo contato.
- [x] CAMP-163 [P0] Entregar contexto da campanha ao Agente IA.
- [x] CAMP-164 [P0] Permitir ativar ou desativar respostas da IA por campanha.
- [x] CAMP-165 [P1] Definir objetivo de resposta da IA.
- [x] CAMP-166 [P1] Definir instruções específicas da campanha.
- [x] CAMP-167 [P0] Manter regras rígidas de termos da Moove.
- [x] CAMP-168 [P0] Encaminhar intenções operacionais imediatamente.
- [x] CAMP-169 [P0] Encaminhar pedido humano ao consultor ativo.
- [ ] CAMP-170 [P1] Parar novos envios ao contato quando ele responder.
- [ ] CAMP-171 [P1] Marcar resposta positiva como oportunidade.
- [ ] CAMP-172 [P1] Marcar recusa e aplicar frequency cap.
- [x] CAMP-173 [P0] Aplicar supressão em comando de saída.
- [ ] CAMP-174 [P1] Criar lembrete após resposta sem conclusão.
- [ ] CAMP-175 [P1] Definir follow-up condicional por intenção.
- [ ] CAMP-176 [P1] Cancelar follow-up quando houver resposta.
- [ ] CAMP-177 [P2] Criar jornada com espera e condição.
- [ ] CAMP-178 [P2] Criar ramo de resposta positiva e negativa.
- [ ] CAMP-179 [P2] Encerrar jornada após handoff confirmado.
- [x] CAMP-180 [P1] Mostrar respostas da campanha na Central de Leads.

### Testes, métricas e otimização

- [x] CAMP-181 [P0] Enviar teste para um número interno.
- [x] CAMP-182 [P0] Marcar envio de teste sem criar lead.
- [ ] CAMP-183 [P1] Testar com dados de uma amostra selecionada.
- [x] CAMP-184 [P0] Executar pré-verificação completa antes do lançamento.
- [x] CAMP-185 [P0] Exibir erros bloqueantes e avisos separadamente.
- [ ] CAMP-186 [P1] Mostrar taxa de aceite.
- [ ] CAMP-187 [P1] Mostrar taxa de confirmação.
- [ ] CAMP-188 [P1] Mostrar taxa de falha.
- [ ] CAMP-189 [P1] Mostrar taxa de resposta.
- [ ] CAMP-190 [P1] Mostrar respostas positivas e negativas.
- [ ] CAMP-191 [P1] Mostrar handoffs gerados.
- [ ] CAMP-192 [P1] Mostrar supressões geradas.
- [ ] CAMP-193 [P1] Comparar desempenho de variantes.
- [ ] CAMP-194 [P2] Definir grupo de controle sem mensagem.
- [ ] CAMP-195 [P1] Exportar resultados em CSV.
- [ ] CAMP-196 [P1] Exportar falhas com motivo seguro.
- [ ] CAMP-197 [P1] Exportar campanha completa para auditoria.
- [ ] CAMP-198 [P1] Mostrar série temporal de envios e respostas.
- [ ] CAMP-199 [P1] Calcular tempo médio até a resposta.
- [ ] CAMP-200 [P2] Recomendar melhorias com base em resultados reais.

### UX, segurança e operação

- [x] CAMP-201 [P0] Unificar as quatro etapas em um Campaign Studio coerente.
- [x] CAMP-202 [P0] Exibir estado salvo, salvando e erro de salvamento.
- [x] CAMP-203 [P0] Alertar antes de sair com alterações não salvas.
- [x] CAMP-204 [P0] Manter todos os controles acessíveis por teclado.
- [x] CAMP-205 [P0] Dar nome acessível a botões de ícone.
- [x] CAMP-206 [P0] Impedir estouro horizontal em celular.
- [x] CAMP-207 [P1] Oferecer prévia móvel em tela pequena.
- [x] CAMP-208 [P0] Proteger mutações de campanha contra CSRF.
- [x] CAMP-209 [P0] Limitar taxa de chamadas de campanha.
- [x] CAMP-210 [P0] Validar payload novamente no servidor.
- [x] CAMP-211 [P0] Limitar tamanho e quantidade de arquivos no servidor.
- [x] CAMP-212 [P0] Sanitizar nomes de arquivo.
- [x] CAMP-213 [P0] Impedir leitura fora do diretório de mídia.
- [x] CAMP-214 [P1] Registrar eventos de auditoria sem conteúdo sensível.
- [x] CAMP-215 [P1] Mostrar saúde do WhatsApp antes do lançamento.
- [ ] CAMP-216 [P1] Mostrar consumo diário persistente.
- [ ] CAMP-217 [P1] Disponibilizar diagnóstico copiável e redigido.
- [ ] CAMP-218 [P0] Testar repositório, preflight, fila e rotas.
- [x] CAMP-219 [P0] Verificar visualmente desktop e celular.
- [ ] CAMP-220 [P0] Criar backup antes de cada implantação.

## Critério de conclusão

O trabalho só pode ser considerado concluído quando os itens P0 estiverem implementados e cobertos por evidência direta, os itens P1 essenciais do fluxo estiverem entregues ou explicitamente justificados, a fila sobreviver a reinício sem duplicar mensagens aceitas, o preflight bloquear campanha sem consentimento e o sistema publicado no Oracle passar pelos testes automatizados e visuais.
