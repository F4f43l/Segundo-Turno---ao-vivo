import assert from 'node:assert';
import { obterUltimoSnapshot, obterHistoricoSnapshots } from './database.js';
import { tseCollector } from './tse-collector.js';

console.log('--- INICIANDO BATERIA DE TESTES AUTOMATIZADOS ---');

async function executarTestes() {
  // Teste 1: Validação do banco SQLite e recuperação de histórico
  console.log('1. Testando persistência e recuperação do histórico...');
  const historico = await obterHistoricoSnapshots();
  assert(Array.isArray(historico), 'Histórico deve ser um array');
  assert(historico.length > 0, 'Histórico deve conter snapshots persistidos');
  console.log(`   ✓ Histórico recuperado com sucesso: ${historico.length} snapshots encontrados.`);

  // Teste 2: Validação da estrutura do último snapshot
  console.log('2. Testando integridade do último snapshot...');
  const ultimo = await obterUltimoSnapshot();
  assert(ultimo !== null, 'Último snapshot não pode ser nulo');
  assert(typeof ultimo.percentualUrnas === 'number', 'Percentual de urnas deve ser número');
  assert(ultimo.candidatos.length === 2, 'Devem existir 2 candidaturas no segundo turno');

  const [c1, c2] = ultimo.candidatos;
  console.log(`   ✓ Candidato 1: ${c1.nome} (${c1.partido}) - ${c1.percentual}% (${c1.votos} votos)`);
  console.log(`   ✓ Candidato 2: ${c2.nome} (${c2.partido}) - ${c2.percentual}% (${c2.votos} votos)`);
  console.log(`   ✓ Urnas apuradas: ${ultimo.percentualUrnas}% (${ultimo.secoesTotalizadas}/${ultimo.totalSecoes} seções)`);

  // Teste 3: Consistência matemática dos votos
  console.log('3. Validando consistência matemática dos dados recebidos...');
  assert(c1.votos + c2.votos === ultimo.votosValidosTotal, 'Soma dos votos dos candidatos deve igualar o total de válidos');
  const somaPercentuais = Number((c1.percentual + c2.percentual).toFixed(1));
  assert(Math.abs(somaPercentuais - 100.0) <= 0.2, 'Soma dos percentuais deve totalizar ~100%');
  console.log(`   ✓ Consistência de votos verificada com sucesso (${c1.votos} + ${c2.votos} = ${ultimo.votosValidosTotal}).`);

  // Teste 4: API /api/resultado
  console.log('4. Testando rota /api/resultado...');
  const resResultado = await tseCollector.obterResultadoAtual();
  assert(resResultado.status !== undefined, 'Status deve estar definido');
  assert(resResultado.dados !== null, 'Dados do resultado devem estar presentes');
  console.log(`   ✓ Status retornado: ${resResultado.status}, isStale: ${resResultado.isStale}`);

  // Teste 5: Resiliência a falhas (Simulação de erro na fonte)
  console.log('5. Testando resiliência a falhas sem perda de dados históricos...');
  const snapAntes = tseCollector.latestSnapshot;
  tseCollector.lastError = 'Simulação de queda na conexão com o TSE';
  const resComFalha = await tseCollector.obterResultadoAtual();
  assert.strictEqual(resComFalha.status, 'stale', 'Status deve mudar para stale em caso de falha');
  assert.strictEqual(resComFalha.isStale, true, 'isStale deve ser true');
  assert.deepStrictEqual(resComFalha.dados.horarioColeta, snapAntes.horarioColeta, 'Dados anteriores devem ser preservados');
  console.log('   ✓ Teste de resiliência a falhas aprovado: histórico e último resultado preservados.');

  // Restaura erro do coletor
  tseCollector.lastError = null;

  console.log('--- TODOS OS TESTES PASSARAM COM SUCESSO (5/5) ---');
}

executarTestes().catch(err => {
  console.error('Falha nos testes:', err);
  process.exit(1);
});
