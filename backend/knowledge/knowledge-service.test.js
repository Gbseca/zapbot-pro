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
  assert.deepEqual(result.ids, []);
});

test('does not spend context on company information for a greeting', () => {
  const result = retrieveKnowledge('oi', buildStaticKnowledgeCatalog());

  assert.equal(result.confidence, 'low');
  assert.deepEqual(result.ids, []);
  assert.equal(result.text, '');
});

test('ignores colloquial question framing and retrieves the actual concept', () => {
  const result = retrieveKnowledge('oq significa mutualismo?', buildStaticKnowledgeCatalog());

  assert.notEqual(result.confidence, 'low');
  assert.ok(result.ids.some((id) => /company-profile|what_is_moove|o-que-e-a-moove/.test(id)));
  assert.match(result.text, /mutualismo/i);
});

test('ignores inflected question words when searching payment dates', () => {
  const result = retrieveKnowledge('quais os dias de vencimento?', buildStaticKnowledgeCatalog());

  assert.notEqual(result.confidence, 'low');
  assert.ok(result.ids.includes('faq-moove.monthly_payment'));
  assert.match(result.text, /10, 15 ou 20/i);
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

test('does not infer an unsupported ownership rule from loose words like carro and nome', () => {
  const result = retrieveKnowledge(
    'posso colocar dois carros no meu nome?',
    buildStaticKnowledgeCatalog(),
  );

  assert.equal(result.confidence, 'low');
  assert.equal(result.ids.includes('coverage-rules.car_rental_benefit'), false);
});

test('ranks the direct theft coverage source for natural verb variations', () => {
  const result = retrieveKnowledge(
    'se roubarem meu carro tem cobertura?',
    buildStaticKnowledgeCatalog(),
  );

  assert.notEqual(result.confidence, 'low');
  assert.ok(result.ids.some((id) => /what_is_covered|o-que-cobre/.test(id)));
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

test('prioritizes the optional glass benefit for every listed glass component', () => {
  const catalog = buildStaticKnowledgeCatalog();
  const questions = [
    'farol quebrado entra?',
    'trincou meu parabrisa, como funciona?',
    'quebrou o retrovisor, tem beneficio?',
    'e lanterna traseira?',
  ];

  for (const question of questions) {
    const result = retrieveKnowledge(question, catalog);
    assert.notEqual(result.confidence, 'low');
    assert.ok(result.ids.some((id) => /glass_coverage|cobertura-de-vidros/.test(id)));
    assert.match(result.text, /benef[ií]cio opcional|participa[cç][aã]o de 40%/i);
  }
});

test('distinguishes a tow distance from zero-kilometer vehicle rules', () => {
  const result = retrieveKnowledge('quantos km de guincho?', buildStaticKnowledgeCatalog());

  assert.notEqual(result.confidence, 'low');
  assert.ok(result.ids.some((id) => /assistance_24h|assistencia-24h/.test(id)));
  assert.match(result.text, /100\s*km/i);
  assert.equal(result.ids.some((id) => /zero.km|veiculo-zero-km/.test(id)), false);
});

test('interprets roda Uber as professional vehicle use instead of a wheel topic', () => {
  const result = retrieveKnowledge('meu carro roda uber, pode?', buildStaticKnowledgeCatalog());

  assert.notEqual(result.confidence, 'low');
  assert.equal(result.ids[0], 'faq-moove.accepted_vehicles');
  assert.match(result.text, /ve[ií]culos? de aplicativo|Uber/i);
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

test('understands common benefit and trust wording without exact document phrases', () => {
  const catalog = buildStaticKnowledgeCatalog();
  const fuel = retrieveKnowledge('acabou a gasolina, tem ajuda?', catalog);
  const van = retrieveKnowledge('protege van?', catalog);
  const trust = retrieveKnowledge('como eu sei que isso nao e furada?', catalog);

  assert.ok(fuel.ids.some((id) => /assistance_24h|assistencia-24h/.test(id)));
  assert.ok(van.ids.some((id) => /accepted_vehicles|veiculos-aceitos/.test(id)));
  assert.ok(trust.ids.includes('company-profile.overview'));
  assert.notEqual(fuel.confidence, 'low');
  assert.notEqual(van.confidence, 'low');
  assert.notEqual(trust.confidence, 'low');
});

test('does not use unrelated years or generic company text as missing evidence', () => {
  const catalog = buildStaticKnowledgeCatalog();
  const companyAge = retrieveKnowledge('ha quantos anos vcs existem?', catalog);
  const companyId = retrieveKnowledge('qual o cnpj da moove?', catalog);

  assert.equal(companyAge.confidence, 'low');
  assert.equal(companyId.confidence, 'low');
  assert.deepEqual(companyAge.ids, []);
  assert.deepEqual(companyId.ids, []);
});

test('does not fill a collision query with generic vehicle sources', () => {
  const result = retrieveKnowledge('se eu bater o carro como fica?', buildStaticKnowledgeCatalog());

  assert.notEqual(result.confidence, 'low');
  assert.ok(result.ids.some((id) => /what_is_covered|o-que-cobre/.test(id)));
  assert.equal(result.ids.includes('coverage-rules.car_rental_benefit'), false);
  assert.equal(result.ids.includes('faq-moove.accepted_vehicles'), false);
});

test('splits the company profile instead of retrieving one broad mixed source', () => {
  const catalog = buildStaticKnowledgeCatalog();
  const mutualism = retrieveKnowledge('como funciona o rateio?', catalog);

  assert.equal(catalog.some((item) => item.id === 'company-profile.agent-details'), false);
  assert.ok(catalog.some((item) => /rateio-e-mutualismo/.test(item.id)));
  assert.ok(mutualism.ids.some((id) => /rateio-e-mutualismo|what_is_moove|o-que-e-a-moove/.test(id)));
  assert.doesNotMatch(mutualism.text, /carro reserva/i);
});

test('retrieves trust and event-analysis knowledge from natural objections', async () => {
  const trust = await getKnowledgeForMessage('como sei que nao e golpe?');
  assert.notEqual(trust.confidence, 'low');
  assert.ok(trust.ids.some((id) => id.includes('company-profile')));
  assert.ok(!trust.ids.includes('knowledge-base.o-que-nao-cobre'));

  const event = await getKnowledgeForMessage('vcs realmente pagam quando acontece algo?');
  assert.notEqual(event.confidence, 'low');
  assert.ok(event.ids.some((id) => /regulamento|sem-promessa|cobre|covered/i.test(id)));
});

test('retrieves cota de participacao despite conversational objection words', async () => {
  const result = await getKnowledgeForMessage('nao gostei dessa cota de participacao');
  assert.notEqual(result.confidence, 'low');
  assert.ok(result.ids.some((id) => /cota|participacao/i.test(id)));
});

test('does not interpret a broad request for something in writing as cancellation', async () => {
  const result = await getKnowledgeForMessage('manda tudo por escrito que eu vejo depois');
  assert.equal(result.confidence, 'low');
  assert.ok(!result.ids.some((id) => /cancel/i.test(id)));
});

test('retrieves company knowledge from natural summary, adhesion and differentiation requests', () => {
  const catalog = buildStaticKnowledgeCatalog();
  const summary = retrieveKnowledge('me explica a moove rapidinho', catalog);
  const genericExplanation = retrieveKnowledge('me explica como funciona', catalog);
  const adhesion = retrieveKnowledge('como faco pra entrar pra moove?', catalog);
  const differentiation = retrieveKnowledge('pq eu escolheria a moove?', catalog);
  const regulation = retrieveKnowledge('tem regulamento?', catalog);

  assert.notEqual(summary.confidence, 'low');
  assert.ok(summary.ids.some((id) => /overview|o-que-e-a-moove|rateio-e-mutualismo/.test(id)));
  assert.ok(genericExplanation.ids.some((id) => /overview|o-que-e-a-moove|rateio-e-mutualismo/.test(id)));
  assert.notEqual(adhesion.confidence, 'low');
  assert.ok(adhesion.ids.some((id) => /adesao|sem-promessa|vistoria|ativacao/.test(id)));
  assert.notEqual(differentiation.confidence, 'low');
  assert.ok(differentiation.ids.some((id) => /overview|o-que-e-a-moove|o-que-cobre|assistencia/.test(id)));
  assert.ok(regulation.ids.includes('company-profile.regulamento-e-analise'));
});
