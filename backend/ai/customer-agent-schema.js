export const CUSTOMER_AGENT_INTENTS = [
  'greeting',
  'thanks',
  'assistant_identity',
  'company_question',
  'coverage_question',
  'eligibility_question',
  'sales_quote',
  'sales_price_request',
  'sales_consultant_requested',
  'objection',
  'no_interest',
  'human_requested',
  'assistance_request',
  'event_report',
  'boleto_request',
  'regularization_request',
  'payment_claimed',
  'receipt_available',
  'receipt_received',
  'reactivation_request',
  'cancel_request',
  'app_blocked',
  'billing_disputed',
  'inspection_pending',
  'system_check_request',
  'unknown',
  'other',
];

export const CUSTOMER_AGENT_ACTIONS = [
  'respond',
  'ask_model_year',
  'ask_plate_optional',
  'handoff_sales',
  'handoff_operational',
  'stop',
  'clarify',
];

export const CUSTOMER_AGENT_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    reply: {
      type: 'STRING',
      description: 'Mensagem natural e curta que sera enviada ao cliente no WhatsApp.',
    },
    primaryIntent: {
      type: 'STRING',
      enum: CUSTOMER_AGENT_INTENTS,
      description: 'Pedido principal da ultima mensagem do cliente.',
    },
    secondaryIntent: {
      type: 'STRING',
      enum: ['none', ...CUSTOMER_AGENT_INTENTS],
      description: 'Segundo objetivo presente na mesma mensagem, ou none.',
    },
    mode: {
      type: 'STRING',
      enum: ['sales', 'operational'],
    },
    action: {
      type: 'STRING',
      enum: CUSTOMER_AGENT_ACTIONS,
      description: 'Proxima acao que o backend deve executar depois de validar a resposta.',
    },
    confidence: {
      type: 'NUMBER',
      description: 'Confianca entre 0 e 1 na interpretacao e na acao.',
    },
    emotion: {
      type: 'STRING',
      enum: ['neutral', 'confused', 'interested', 'hesitant', 'irritated', 'angry'],
    },
    answerStatus: {
      type: 'STRING',
      enum: ['answered', 'partial', 'unknown', 'not_applicable'],
      description: 'Se a duvida factual foi respondida pelas fontes fornecidas.',
    },
    knowledgeIds: {
      type: 'ARRAY',
      items: { type: 'STRING' },
      description: 'IDs exatos das fontes usadas para cada afirmacao factual.',
    },
    reasoningSummary: {
      type: 'STRING',
      description: 'Resumo curto e nao sensivel do motivo da decisao.',
    },
    handoffReason: {
      type: 'STRING',
      description: 'Motivo objetivo do encaminhamento, vazio se nao houver.',
    },
    handoffSummary: {
      type: 'STRING',
      description: 'Resumo util da conversa para o consultor, vazio se nao houver encaminhamento.',
    },
    memory: {
      type: 'OBJECT',
      properties: {
        customerGoal: { type: 'STRING' },
        currentTopic: { type: 'STRING' },
        pendingQuestion: { type: 'STRING' },
        objections: { type: 'ARRAY', items: { type: 'STRING' } },
        answeredTopics: { type: 'ARRAY', items: { type: 'STRING' } },
      },
      required: ['customerGoal', 'currentTopic', 'pendingQuestion', 'objections', 'answeredTopics'],
    },
    extractedFacts: {
      type: 'OBJECT',
      description: 'Dados que o cliente escreveu explicitamente nesta conversa. Nao deduza nem complete.',
      properties: {
        vehicleModel: { type: 'STRING' },
        vehicleYear: { type: 'STRING' },
      },
      required: ['vehicleModel', 'vehicleYear'],
    },
  },
  required: [
    'reply',
    'primaryIntent',
    'secondaryIntent',
    'mode',
    'action',
    'confidence',
    'emotion',
    'answerStatus',
    'knowledgeIds',
    'reasoningSummary',
    'handoffReason',
    'handoffSummary',
    'memory',
    'extractedFacts',
  ],
};
