import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildKnowledgeCatalog,
  buildStaticKnowledgeCatalog,
  getKnowledgeForMessage,
  retrieveKnowledge,
} from './knowledge-service.js';

test('retrieves accepted vehicle knowledge without a topic-specific branch', () => {
  const result = retrieveKnowledge(
    'meu carro e usado para trabalhar de aplicativo, voces aceitam?',
    buildStaticKnowledgeCatalog(),
  );

  assert.ok(result.ids.includes('faq-moove.accepted_vehicles'));
  assert.match(result.text, /ve.culos de aplicativo/i);
  assert.notEqual(result.confidence, 'low');
});

test('ignores sales framing and retrieves the factual part of a combined question', () => {
  const result = retrieveKnowledge(
    'quero cotar, mas antes queria saber se cobre granizo',
    buildStaticKnowledgeCatalog(),
  );

  assert.ok(result.ids.includes('coverage-rules.what_is_covered'));
  assert.notEqual(result.confidence, 'low');
});

test('retrieves grounded driver restrictions for a natural family question', () => {
  const result = retrieveKnowledge(
    'meu filho pode dirigir o carro ou tem alguma regra?',
    buildStaticKnowledgeCatalog(),
  );

  assert.ok(result.ids.some((id) => [
    'coverage-rules.what_is_not_covered',
    'knowledge-base.o-que-nao-cobre',
  ].includes(id)));
  assert.match(result.text, /habilita..o v.lida|CNH v.lida/i);
});

test('includes active FAQ items created in the dashboard', async () => {
  const catalog = await buildKnowledgeCatalog({
    faqItems: [{
      id: 'custom-granizo',
      title: 'Protecao em caso de granizo',
      category: 'coberturas',
      keywords: ['granizo', 'chuva de pedra'],
      answer: 'Granizo deve ser analisado conforme a regra de fenomenos da natureza.',
      active: true,
      source: 'local',
    }],
  });
  const result = retrieveKnowledge('chuva de pedra estraga o carro, cobre?', catalog);

  assert.ok(result.ids.includes('faq.custom-granizo'));
  assert.match(result.text, /Granizo deve ser analisado/i);
});

test('marks an unrelated question as low knowledge confidence', () => {
  const result = retrieveKnowledge(
    'qual e a cor preferida do dono da empresa?',
    buildStaticKnowledgeCatalog(),
  );

  assert.equal(result.confidence, 'low');
  assert.ok(result.ids.includes('company-profile.overview'));
});

test('does not treat FAQ priority as evidence for a short unrelated question', async () => {
  const result = await getKnowledgeForMessage('e cachorro?', {
    faqItems: [{
      id: 'prioridade-sem-relacao',
      title: 'Segunda via de boleto',
      category: 'pagamentos',
      answer: 'O consultor orienta a forma de pagamento.',
      keywords: ['boleto', 'pagamento'],
      active: true,
    }],
    pdfChunks: [],
  });

  assert.equal(result.confidence, 'low');
  assert.equal(result.ids.includes('faq.prioridade-sem-relacao'), false);
});

test('matches common singular and compound vehicle words without response rules', () => {
  const catalog = buildStaticKnowledgeCatalog();
  const glass = retrieveKnowledge('quebrou so o parabrisa, como funciona?', catalog);
  const truck = retrieveKnowledge('da pra proteger caminhao?', catalog);

  assert.ok(glass.ids.some((id) => /glass_coverage|cobertura-de-vidros/.test(id)));
  assert.ok(truck.ids.some((id) => /accepted_vehicles|veiculos-aceitos/.test(id)));
  assert.match(glass.text, /associado paga uma participa[cç][aã]o de 40%|participa[cç][aã]o paga pelo associado/i);
  assert.notEqual(glass.confidence, 'low');
  assert.notEqual(truck.confidence, 'low');
});

test('retrieves natural questions from indexed PDF chunks without exact phrase matching', async () => {
  const result = await getKnowledgeForMessage('meu filho pode dirigir o carro?', {
    includeDynamicFaq: false,
    pdfChunks: [{
      filename: 'regulamento.pdf',
      index: 7,
      text: 'A condução do veículo exige habilitação válida e compatível com a categoria do veículo.',
    }],
  });

  assert.ok(result.ids.includes('pdf.regulamento-pdf.7'));
});

test('keeps relevant failure words and understands common chat abbreviations', () => {
  const catalog = buildStaticKnowledgeCatalog();
  const mechanical = retrieveKnowledge('se o motor quebrar vcs pagam o conserto?', catalog);
  const informal = retrieveKnowledge('qro saber se pega uber e qnt fica', catalog);

  assert.ok(mechanical.ids.some((id) => /what_is_not_covered|o-que-nao-cobre/.test(id)));
  assert.ok(informal.ids.some((id) => /accepted_vehicles|veiculos-aceitos/.test(id)));
  assert.notEqual(mechanical.confidence, 'low');
  assert.notEqual(informal.confidence, 'low');
});
