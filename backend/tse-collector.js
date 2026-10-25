import crypto from 'node:crypto';
import { salvarSnapshot, obterUltimoSnapshot, obterHistoricoSnapshots } from './database.js';

/**
 * MAPEAMENTO OFICIAL DOS CAMPOS DO TSE (Documentação Técnica):
 * 
 * Raiz do JSON:
 * - ele: Código da eleição (ex: "6258" para 2º Turno Presidencial 2026)
 * - t: Turno (ex: "2")
 * - f: Fase da eleição (ex: "o" = oficial)
 * - dg: Data de geração do arquivo pelo TSE (ex: "25/10/2026")
 * - hg: Hora de geração do arquivo pelo TSE (ex: "19:13:37")
 * - idg: Identificador numérico único de geração do arquivo (ex: "3955387")
 * - dt: Data da totalização dos votos (ex: "25/10/2026")
 * - ht: Hora da totalização dos votos (ex: "19:13:32")
 * 
 * Objeto 's' (Seções / Urnas):
 * - ts: Total de seções eleitorais do país (ex: "499248")
 * - st: Total de seções totalizadas até o momento (ex: "8674")
 * - pst: Percentual de seções totalizadas com vírgula (ex: "1,74")
 * - pstn: Percentual de seções totalizadas com ponto/alta precisão (ex: "1.737413069")
 * - sa: Seções apuradas
 * - snt: Seções não totalizadas
 * 
 * Objeto 'v' (Votos Gerais):
 * - tv: Total de votos apurados
 * - vv: Total de votos válidos nominais
 * - vb: Total de votos em branco
 * - vn: Total de votos nulos
 * - pvv: Percentual de votos válidos
 * 
 * Objeto 'carg' -> 'agr' -> 'par' -> 'cand' (Candidaturas):
 * - cd: Código do cargo (ex: "1" = Presidente)
 * - nmn: Nome do cargo (ex: "Presidente")
 * - agr: Agremiações / Coligações / Federações
 * - par: Partidos componentes
 * - cand: Candidatos
 *   - sqcand: Sequencial do candidato (identificador estável único do TSE)
 *   - n: Número de urna do candidato (ex: "13", "22")
 *   - nm: Nome completo do candidato
 *   - nmu: Nome de urna do candidato (ex: "LULA", "FLAVIO BOLSONARO")
 *   - dvt: Destinação do voto (ex: "Válido")
 *   - vap: Votos apurados para o candidato (ex: "1136190")
 *   - pvap: Percentual de votos válidos apurados formato BR (ex: "52,11")
 *   - pvapn: Percentual numérico com ponto (ex: "52.106234918")
 *   - st: Situação do candidato (ex: "Eleito", "Não eleito", ou vazio em apuração)
 */

export const TSE_URL_DEFAULT = process.env.TSE_URL || 'https://resultados.tse.jus.br/oficial/ele2026/6258/dados/br/br-c0001-e006258-u.json';
export const POLLING_INTERVAL_MS = parseInt(process.env.POLLING_INTERVAL_MS || '15000', 10); // 15 segundos

class TseCollector {
  constructor(url = TSE_URL_DEFAULT) {
    this.url = url;
    this.isFetching = false;
    this.lastEtag = null;
    this.lastModified = null;
    this.lastSuccessTimestamp = null;
    this.lastCheckedTimestamp = null;
    this.lastError = null;
    this.timer = null;
    this.latestSnapshot = null;
    this.initialLoadDone = false;
  }

  async carregarUltimoSnapshotInicial() {
    if (this.initialLoadDone) return;
    try {
      this.latestSnapshot = await obterUltimoSnapshot();
      if (this.latestSnapshot) {
        this.lastSuccessTimestamp = new Date(this.latestSnapshot.horarioColeta).getTime();
      }
      this.initialLoadDone = true;
    } catch (err) {
      console.error('[TseCollector] Erro ao carregar último snapshot do banco:', err.message);
    }
  }

  /**
   * Converte percentual string ("52,11") ou numérico ("52.106") para número float seguro
   */
  parsePercentual(valStr, valNum) {
    if (valNum !== undefined && valNum !== null && !isNaN(Number(valNum))) {
      return Number(Number(valNum).toFixed(2));
    }
    if (typeof valStr === 'string') {
      const parsed = parseFloat(valStr.replace(',', '.'));
      if (!isNaN(parsed)) return Number(parsed.toFixed(2));
    }
    return 0;
  }

  /**
   * Converte votos string para inteiro seguro
   */
  parseVotos(val) {
    if (typeof val === 'number') return Math.floor(val);
    if (typeof val === 'string') {
      const parsed = parseInt(val.replace(/\D/g, ''), 10);
      return isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  }

  /**
   * Realiza a extração e normalização dos dados do JSON do TSE
   */
  normalizarDadosTse(data, horarioColetaIso) {
    if (!data || !data.carg || !Array.isArray(data.carg) || data.carg.length === 0) {
      throw new Error('Formato inválido do JSON do TSE: objeto "carg" não encontrado.');
    }

    if (!data.s) {
      throw new Error('Formato inválido do JSON do TSE: seções "s" não encontradas.');
    }

    // Urnas apuradas (seções totalizadas)
    const percentualUrnas = this.parsePercentual(data.s.pst, data.s.pstn);
    const secoesTotalizadas = this.parseVotos(data.s.st);
    const totalSecoes = this.parseVotos(data.s.ts);

    // Votos gerais
    const votosValidos = this.parseVotos(data.v?.vv);
    const votosBrancos = this.parseVotos(data.v?.vb);
    const votosNulos = this.parseVotos(data.v?.vn);
    const votosTotal = this.parseVotos(data.v?.tv);

    // Extrair candidatos de todas as coligações/partidos do cargo de Presidente
    const candidatos = [];
    const carg = data.carg[0]; // Cargo 1: Presidente

    if (carg.agr && Array.isArray(carg.agr)) {
      for (const ag of carg.agr) {
        if (ag.par && Array.isArray(ag.par)) {
          for (const p of ag.par) {
            if (p.cand && Array.isArray(p.cand)) {
              for (const c of p.cand) {
                const codigo = String(c.sqcand || c.n);
                const numero = String(c.n);
                const nomeUrna = c.nmu || c.nm || `Candidato ${numero}`;
                const nomeCompleto = c.nm || nomeUrna;
                const partido = p.sg || '';
                const votos = this.parseVotos(c.vap);
                const percentual = this.parsePercentual(c.pvap, c.pvapn);
                const situacao = c.st || '';

                candidatos.push({
                  codigo,
                  numero,
                  nome: nomeUrna,
                  nomeCompleto,
                  partido,
                  votos,
                  percentual,
                  situacao
                });
              }
            }
          }
        }
      }
    }

    if (candidatos.length === 0) {
      throw new Error('Nenhum candidato válido encontrado na estrutura do TSE.');
    }

    // Ordenar candidatos por número de votos (decrescente)
    candidatos.sort((a, b) => b.votos - a.votos);

    // Gerar um hash único baseado nos dados relevantes de apuração
    const fingerprintContent = JSON.stringify({
      idg: data.idg,
      hg: data.hg,
      ht: data.ht,
      st: secoesTotalizadas,
      pst: percentualUrnas,
      cands: candidatos.map(c => ({ cd: c.codigo, v: c.votos, p: c.percentual }))
    });
    const rawHash = crypto.createHash('sha256').update(fingerprintContent).digest('hex');

    const snapshot = {
      identificador_fonte: data.idg || null,
      horario_coleta: horarioColetaIso,
      horario_geracao: data.hg || null,
      data_geracao: data.dg || null,
      horario_totalizacao: data.ht || null,
      data_totalizacao: data.dt || null,
      percentual_urnas: percentualUrnas,
      secoes_totalizadas: secoesTotalizadas,
      total_secoes: totalSecoes,
      votos_validos_total: votosValidos,
      votos_brancos: votosBrancos,
      votos_nulos: votosNulos,
      votos_total: votosTotal,
      raw_hash: rawHash
    };

    return { snapshot, candidatos };
  }

  /**
   * Executa uma consulta à fonte oficial do TSE com validações e persistência
   */
  async coletar(forcar = false) {
    if (this.isFetching) {
      console.log('[TseCollector] Consulta já em andamento. Aguardando conclusão.');
      return;
    }

    this.isFetching = true;
    const now = new Date();
    const horarioColetaIso = now.toISOString();

    try {
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) TSE-Apuracao-Dashboard/1.0',
        'Accept': 'application/json'
      };

      if (!forcar && this.lastEtag) {
        headers['If-None-Match'] = this.lastEtag;
      }
      if (!forcar && this.lastModified) {
        headers['If-Modified-Since'] = this.lastModified;
      }

      console.log(`[TseCollector] Consultando TSE: ${this.url}`);
      const res = await fetch(this.url, {
        headers,
        signal: AbortSignal.timeout(10000)
      });

      this.lastCheckedTimestamp = Date.now();

      if (res.status === 304) {
        console.log('[TseCollector] 304 Not Modified: Sem alterações no TSE.');
        this.lastSuccessTimestamp = Date.now();
        this.lastError = null;
        return;
      }

      if (!res.ok) {
        throw new Error(`TSE HTTP ${res.status}: ${res.statusText}`);
      }

      if (res.headers.get('etag')) {
        this.lastEtag = res.headers.get('etag');
      }
      if (res.headers.get('last-modified')) {
        this.lastModified = res.headers.get('last-modified');
      }

      const json = await res.json();
      const { snapshot, candidatos } = this.normalizarDadosTse(json, horarioColetaIso);

      // Salva snapshot no banco de dados (PostgreSQL ou SQLite)
      const resSalvar = await salvarSnapshot(snapshot, candidatos);
      if (resSalvar.inserido) {
        console.log(`[TseCollector] Novo marco persistido! ID: ${resSalvar.id}, Urnas: ${snapshot.percentual_urnas}%, Votos Válidos: ${snapshot.votos_validos_total}`);
      } else {
        console.log('[TseCollector] Dados recebidos idênticos ao marco anterior. Histórico mantido sem duplicação.');
      }

      this.latestSnapshot = {
        id: resSalvar.id,
        horarioColeta: snapshot.horario_coleta,
        horarioGeracao: snapshot.horario_geracao,
        dataGeracao: snapshot.data_geracao,
        horarioTotalizacao: snapshot.horario_totalizacao,
        dataTotalizacao: snapshot.data_totalizacao,
        identificadorFonte: snapshot.identificador_fonte,
        percentualUrnas: snapshot.percentual_urnas,
        secoesTotalizadas: snapshot.secoes_totalizadas,
        totalSecoes: snapshot.total_secoes,
        votosValidosTotal: snapshot.votos_validos_total,
        votosBrancos: snapshot.votos_brancos,
        votosNulos: snapshot.votos_nulos,
        votosTotal: snapshot.votos_total,
        candidatos
      };

      this.lastSuccessTimestamp = Date.now();
      this.lastError = null;
    } catch (err) {
      console.error(`[TseCollector] Erro ao consultar TSE: ${err.message}`);
      this.lastError = err.message;
    } finally {
      this.isFetching = false;
    }
  }

  /**
   * Inicia o polling contínuo periódico (opcional quando em processo permanente)
   */
  iniciar() {
    if (process.env.DISABLE_BACKGROUND_TIMER === 'true') {
      console.log('[TseCollector] Timer em segundo plano desativado (modo sob demanda puro).');
      return;
    }

    console.log(`[TseCollector] Iniciando coletor com intervalo de ${POLLING_INTERVAL_MS / 1000}s`);
    this.coletar(true);

    this.timer = setInterval(() => {
      this.coletar(false);
    }, POLLING_INTERVAL_MS);
  }

  /**
   * Para o coletor
   */
  parar() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Retorna os dados para a rota GET /api/resultado
   * Implementa Stale-While-Revalidate sob demanda sem depender de timers em memória
   */
  async obterResultadoAtual() {
    await this.carregarUltimoSnapshotInicial();

    const agora = Date.now();

    // Se não há dados ou a última verificação tiver mais de 15 segundos, revalida sob demanda
    if (!this.lastCheckedTimestamp || (agora - this.lastCheckedTimestamp > POLLING_INTERVAL_MS)) {
      await this.coletar(false);
    }

    const snap = this.latestSnapshot;
    const tempoSemSucessoMs = this.lastSuccessTimestamp ? (agora - this.lastSuccessTimestamp) : null;
    const isStale = (this.lastError !== null) || (tempoSemSucessoMs !== null && tempoSemSucessoMs > 120000);

    let status = 'online';
    if (!snap) {
      status = this.lastError ? 'error' : 'carregando';
    } else if (isStale) {
      status = 'stale';
    } else if (snap.percentualUrnas >= 100) {
      status = 'concluido';
    }

    return {
      status,
      isStale,
      erro: this.lastError,
      ultimaConsultaSucesso: this.lastSuccessTimestamp ? new Date(this.lastSuccessTimestamp).toISOString() : null,
      ultimaVerificacao: this.lastCheckedTimestamp ? new Date(this.lastCheckedTimestamp).toISOString() : null,
      dados: snap ? {
        horarioColeta: snap.horarioColeta,
        horarioGeracao: snap.horarioGeracao,
        dataGeracao: snap.dataGeracao,
        horarioTotalizacao: snap.horarioTotalizacao,
        dataTotalizacao: snap.dataTotalizacao,
        identificadorFonte: snap.identificadorFonte,
        urnasTotalizadas: {
          percentual: snap.percentualUrnas,
          percentualFormatado: `${snap.percentualUrnas.toFixed(2).replace('.', ',')}%`,
          secoesTotalizadas: snap.secoesTotalizadas,
          totalSecoes: snap.totalSecoes
        },
        votos: {
          validos: snap.votosValidosTotal,
          brancos: snap.votosBrancos,
          nulos: snap.votosNulos,
          total: snap.votosTotal
        },
        candidatos: snap.candidatos.map(c => ({
          codigo: c.codigo,
          numero: c.numero,
          nome: c.nome,
          nomeCompleto: c.nomeCompleto,
          partido: c.partido,
          votos: c.votos,
          votosFormatado: c.votos.toLocaleString('pt-BR'),
          percentual: c.percentual,
          percentualFormatado: `${c.percentual.toFixed(2).replace('.', ',')}%`,
          situacao: c.situacao
        }))
      } : null
    };
  }

  /**
   * Retorna os dados para a rota GET /api/historico
   */
  async obterHistorico() {
    return await obterHistoricoSnapshots();
  }
}

export const tseCollector = new TseCollector();
