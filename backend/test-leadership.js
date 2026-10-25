import assert from 'node:assert';

console.log('--- TESTANDO LÓGICA DE LIDERANÇA DINÂMICA ---');

function calcularLideranca(cands) {
  if (!cands || cands.length < 2) {
    return { lider: 'empate', candidatoLider: null, diferenca: 0 };
  }

  const lula = cands.find(c =>
    c.numero === '13' ||
    c.codigo === '280002542548' ||
    (c.nome && c.nome.toUpperCase().includes('LULA'))
  );
  const bolsonaro = cands.find(c =>
    c.numero === '22' ||
    c.codigo === '280002551544' ||
    (c.nome && c.nome.toUpperCase().includes('BOLSONARO'))
  );

  if (!lula || !bolsonaro) {
    return { lider: 'empate', candidatoLider: null, diferenca: 0 };
  }

  const diffPct = Number(Math.abs(lula.percentual - bolsonaro.percentual).toFixed(2));

  if (lula.percentual > bolsonaro.percentual) {
    return { lider: 'lula', candidatoLider: lula, diferenca: diffPct };
  } else if (bolsonaro.percentual > lula.percentual) {
    return { lider: 'bolsonaro', candidatoLider: bolsonaro, diferenca: diffPct };
  } else {
    if (lula.votos > bolsonaro.votos) {
      return { lider: 'lula', candidatoLider: lula, diferenca: diffPct };
    } else if (bolsonaro.votos > lula.votos) {
      return { lider: 'bolsonaro', candidatoLider: bolsonaro, diferenca: diffPct };
    }
    return { lider: 'empate', candidatoLider: null, diferenca: 0 };
  }
}

// Caso 1: Lula na frente (ordem normal)
const caso1 = [
  { numero: '13', nome: 'LULA', percentual: 51.13, votos: 3353322 },
  { numero: '22', nome: 'FLAVIO BOLSONARO', percentual: 48.87, votos: 3204977 }
];
const res1 = calcularLideranca(caso1);
assert.strictEqual(res1.lider, 'lula', 'Lula deve liderar no Caso 1');
assert.strictEqual(res1.diferenca, 2.26, 'Diferença deve ser 2.26%');
console.log('✓ Caso 1 (Lula na frente): Aprovado (tom vermelho escuro ativado)');

// Caso 2: Flávio Bolsonaro na frente (ordem invertida no array)
const caso2 = [
  { numero: '22', nome: 'FLAVIO BOLSONARO', percentual: 50.40, votos: 4000000 },
  { numero: '13', nome: 'LULA', percentual: 49.60, votos: 3936500 }
];
const res2 = calcularLideranca(caso2);
assert.strictEqual(res2.lider, 'bolsonaro', 'Bolsonaro deve liderar no Caso 2 independente da ordem no array');
assert.strictEqual(res2.diferenca, 0.80, 'Diferença deve ser 0.80%');
console.log('✓ Caso 2 (Flávio Bolsonaro na frente com array invertido): Aprovado (tom amarelo-ouro ativado)');

// Caso 3: Empate rigoroso
const caso3 = [
  { numero: '13', nome: 'LULA', percentual: 50.00, votos: 3500000 },
  { numero: '22', nome: 'FLAVIO BOLSONARO', percentual: 50.00, votos: 3500000 }
];
const res3 = calcularLideranca(caso3);
assert.strictEqual(res3.lider, 'empate', 'Deve identificar empate');
assert.strictEqual(res3.diferenca, 0, 'Diferença de empate deve ser 0%');
console.log('✓ Caso 3 (Empate nos percentuais e votos): Aprovado (fundo preto neutro mantido)');

// Caso 4: Desempate por votos absolutos quando percentuais arredondados são iguais
const caso4 = [
  { numero: '13', nome: 'LULA', percentual: 50.00, votos: 3500001 },
  { numero: '22', nome: 'FLAVIO BOLSONARO', percentual: 50.00, votos: 3500000 }
];
const res4 = calcularLideranca(caso4);
assert.strictEqual(res4.lider, 'lula', 'Desempate por votos deve apontar Lula');
console.log('✓ Caso 4 (Desempate fino por votos absolutos): Aprovado');

console.log('--- TODOS OS TESTES DE LIDERANÇA PASSARAM COM SUCESSO ---');
