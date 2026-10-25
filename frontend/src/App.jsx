import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine
} from 'recharts';
import './App.css';

// Cores fixas e estáveis para cada candidatura
export const COLOR_LULA = '#F04444';       // Vermelho nítido e legível sobre fundo escuro
export const COLOR_BOLSONARO = '#E8B83F'; // Amarelo-ouro nítido e legível sobre fundo escuro

/**
 * Retorna a cor fixa de cada candidato, independente da liderança ou posição na lista
 */
export function getCandidateColor(cand) {
  if (!cand) return '#94A3B8';
  const num = String(cand.numero || '');
  const cod = String(cand.codigo || '');
  const nome = String(cand.nome || '').toUpperCase();

  if (num === '13' || cod === '280002542548' || nome.includes('LULA')) {
    return COLOR_LULA;
  }
  if (num === '22' || cod === '280002551544' || nome.includes('BOLSONARO')) {
    return COLOR_BOLSONARO;
  }
  return '#94A3B8';
}

/**
 * Formata data/hora garantindo o fuso horário America/Sao_Paulo
 */
function formatTimeSaoPaulo(dateString, includeSeconds = true) {
  if (!dateString) return '--:--:--';
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      minute: '2-digit',
      second: includeSeconds ? '2-digit' : undefined,
      hour12: false
    }).format(date);
  } catch (e) {
    return dateString;
  }
}

/**
 * Componente de ponto customizado: destaca apenas a última observação (mais recente)
 */
function CustomDot(props) {
  const { cx, cy, index, dataLength, stroke } = props;
  // Apenas renderiza no último índice (mais recente)
  if (index !== dataLength - 1) return null;

  return (
    <g key={`latest-dot-${index}`}>
      <circle cx={cx} cy={cy} r={7} fill={stroke} fillOpacity={0.25} />
      <circle cx={cx} cy={cy} r={4.5} fill={stroke} stroke="#000000" strokeWidth={1.5} />
    </g>
  );
}

/**
 * Tooltip customizado com detalhamento completo exigido no PDF
 */
function CustomChartTooltip({ active, payload, label, candidateMeta }) {
  if (!active || !payload || !payload.length) return null;

  const currentPoint = payload[0]?.payload;
  if (!currentPoint) return null;

  return (
    <div className="custom-tooltip">
      <div className="tooltip-header">
        <span className="tooltip-time">{label}</span>
        <span className="tooltip-urnas">
          Urnas: {currentPoint.percentualUrnas?.toFixed(2).replace('.', ',')}%
        </span>
      </div>

      <div className="tooltip-candidates-list">
        {payload.map((entry) => {
          const candKey = entry.dataKey;
          const meta = candidateMeta[candKey] || {};
          const candData = currentPoint.candidatosMap?.[candKey] || {};
          const votos = candData.votos !== undefined ? candData.votos : meta.votos;

          return (
            <div key={candKey} className="tooltip-candidate">
              <div className="tooltip-cand-left">
                <span
                  className="tooltip-cand-dot"
                  style={{ backgroundColor: entry.color }}
                />
                <span className="tooltip-cand-name">
                  {meta.nome || candKey}
                </span>
              </div>
              <div className="tooltip-cand-right">
                <span className="tooltip-cand-pct" style={{ color: entry.color }}>
                  {typeof entry.value === 'number'
                    ? `${entry.value.toFixed(2).replace('.', ',')}%`
                    : '--'}
                </span>
                <span className="tooltip-cand-votes">
                  {typeof votos === 'number'
                    ? `${votos.toLocaleString('pt-BR')} votos`
                    : ''}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function App() {
  const [resultado, setResultado] = useState(null);
  const [historico, setHistorico] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erroInicial, setErroInicial] = useState(null);
  const [zoomMode, setZoomMode] = useState(false); // Alternar entre 0-100% e Foco nas curvas
  const [isUpdating, setIsUpdating] = useState(false);

  // Armazena referência para evitar corridas assíncronas
  const isFetchingRef = useRef(false);

  // Buscar dados da API local
  const carregarDados = async (silencioso = false) => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    if (!silencioso) setIsUpdating(true);

    try {
      const [resResultado, resHistorico] = await Promise.all([
        fetch('/api/resultado'),
        fetch('/api/historico')
      ]);

      if (!resResultado.ok || !resHistorico.ok) {
        throw new Error(`Falha na API local (status ${resResultado.status}/${resHistorico.status})`);
      }

      const dadosResultado = await resResultado.json();
      const dadosHistorico = await resHistorico.json();

      setResultado(dadosResultado);
      setHistorico(dadosHistorico);
      setErroInicial(null);
    } catch (err) {
      console.error('Erro ao atualizar dashboard:', err);
      if (!resultado) {
        setErroInicial(err.message);
      }
    } finally {
      setLoading(false);
      setIsUpdating(false);
      isFetchingRef.current = false;
    }
  };

  // Efeito de inicialização e polling contínuo (a cada 10s)
  useEffect(() => {
    carregarDados(false);
    const interval = setInterval(() => {
      carregarDados(true);
    }, 10000);

    return () => clearInterval(interval);
  }, []);

  // Extrair metadados estáveis dos candidatos a partir do resultado mais recente
  const candidateMeta = useMemo(() => {
    const meta = {};
    const cands = resultado?.dados?.candidatos || [];
    cands.forEach((c) => {
      meta[c.codigo] = {
        codigo: c.codigo,
        numero: c.numero,
        nome: c.nome,
        nomeCompleto: c.nomeCompleto,
        partido: c.partido,
        votos: c.votos,
        percentual: c.percentual,
        color: getCandidateColor(c)
      };
    });
    return meta;
  }, [resultado]);

  // Formatar histórico em série temporal ordenada para o Recharts
  const chartData = useMemo(() => {
    if (!historico || historico.length === 0) return [];

    return historico.map((snap, index) => {
      // Exibe hora formatada no fuso America/Sao_Paulo
      const horaFormatada = snap.horarioGeracao || formatTimeSaoPaulo(snap.horarioColeta);
      const point = {
        id: snap.id,
        horaFormatada,
        horarioColeta: snap.horarioColeta,
        percentualUrnas: snap.percentualUrnas,
        votosValidosTotal: snap.votosValidosTotal,
        candidatosMap: snap.candidatos || {},
        isLatest: index === historico.length - 1
      };

      // Adiciona percentual de votos de cada candidato como chave numérica
      if (snap.candidatos) {
        Object.entries(snap.candidatos).forEach(([codigo, c]) => {
          point[codigo] = c.percentual;
        });
      }

      return point;
    });
  }, [historico]);

  // Lista de códigos de candidatos presentes
  const candidateKeys = useMemo(() => {
    return Object.keys(candidateMeta);
  }, [candidateMeta]);

  // Cálculo de domínio do eixo Y (padrão 0-100% conforme PDF, ou zoom caso usuário prefira foco)
  const yDomain = useMemo(() => {
    if (!zoomMode) return [0, 100];
    if (chartData.length === 0) return [0, 100];

    let min = 100;
    let max = 0;
    chartData.forEach(p => {
      candidateKeys.forEach(k => {
        if (typeof p[k] === 'number') {
          if (p[k] < min) min = p[k];
          if (p[k] > max) max = p[k];
        }
      });
    });

    if (min > max) return [0, 100];
    const floor = Math.max(0, Math.floor(min - 2));
    const ceil = Math.min(100, Math.ceil(max + 2));
    return [floor, ceil];
  }, [zoomMode, chartData, candidateKeys]);

  // Identificação e cálculo da liderança da apuração para ambientação dinâmica
  const lideranca = useMemo(() => {
    const cands = resultado?.dados?.candidatos;
    if (!cands || cands.length < 2) {
      return { lider: 'empate', candidatoLider: null, diferenca: 0 };
    }

    // Identificação dos candidatos independente da ordem no array retornado
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
      // Caso percentual arredondado seja idêntico, desempate pelo total de votos válidos
      if (lula.votos > bolsonaro.votos) {
        return { lider: 'lula', candidatoLider: lula, diferenca: diffPct };
      } else if (bolsonaro.votos > lula.votos) {
        return { lider: 'bolsonaro', candidatoLider: bolsonaro, diferenca: diffPct };
      }
      return { lider: 'empate', candidatoLider: null, diferenca: 0 };
    }
  }, [resultado]);

  // Estado de carregamento inicial
  if (loading && !resultado) {
    return (
      <div className="state-message-container">
        <div className="spinner" />
        <p>Conectando à apuração oficial do TSE...</p>
      </div>
    );
  }

  // Estado de erro crítico inicial sem nenhum dado
  if (erroInicial && !resultado) {
    return (
      <div className="state-message-container">
        <p style={{ color: '#ef4444', fontWeight: 600 }}>Falha de comunicação inicial: {erroInicial}</p>
        <button
          className="btn-toggle-scale"
          style={{ marginTop: 16 }}
          onClick={() => carregarDados(false)}
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  const dados = resultado?.dados;
  const isStale = resultado?.isStale;
  const statusConexao = resultado?.status || 'online';
  const ultimaSucessoHora = resultado?.ultimaConsultaSucesso
    ? formatTimeSaoPaulo(resultado.ultimaConsultaSucesso)
    : dados?.horarioGeracao || '--:--:--';

  return (
    <div className={`dashboard-container lead-${lideranca.lider} ${isStale ? 'is-stale' : ''}`}>
      {/* 1. Cabeçalho Minimalista Conforme PDF */}
      <header className="dashboard-header">
        <div className="header-titles">
          <span className="header-title-small">Apuração Eleitoral</span>
          <h1 className="header-subtitle">2º TURNO · PRESIDENTE · BRASIL</h1>
        </div>

        <div className="header-status-area">
          {/* Indicador de Liderança Dinâmico */}
          {lideranca.lider !== 'empate' && lideranca.candidatoLider ? (
            <div className={`leader-pill lead-${lideranca.lider}`}>
              <span className="leader-pill-dot" />
              <span>
                Liderança: <strong>{lideranca.candidatoLider.nome}</strong> (+{lideranca.diferenca.toFixed(2).replace('.', ',')}%)
                {isStale && ' · (dado anterior)'}
              </span>
            </div>
          ) : (
            <div className="leader-pill lead-empate">
              <span className="leader-pill-dot" style={{ backgroundColor: '#71717a' }} />
              <span>Empate</span>
            </div>
          )}

          {/* Indicador de Desatualização / Falha */}
          {isStale && (
            <div className="status-warning-badge">
              Dados desatualizados · Falha na conexão com TSE
            </div>
          )}

          {/* Estado de Atualização: "Atualizado às HH:MM:SS" */}
          <div className="status-pill">
            <span className={`status-dot ${statusConexao}`} />
            <span>
              Atualizado às <strong className="status-time">{ultimaSucessoHora}</strong>
            </span>
          </div>

          {/* Botão sutil para alternar escala do Eixo Y */}
          <button
            className="btn-toggle-scale"
            onClick={() => setZoomMode(prev => !prev)}
            title="Alternar entre escala 0-100% padrão e foco dinâmico"
          >
            {zoomMode ? 'Escala: Foco (Zoom)' : 'Escala: 0% - 100%'}
          </button>
        </div>
      </header>

      {/* 2. Resumo Discreto dos Candidatos e Urnas Apuradas */}
      <section className="summary-bar">
        <div className="candidates-summary">
          {dados?.candidatos?.map((cand) => {
            const color = getCandidateColor(cand);
            const isLula = cand.numero === '13' || (cand.nome && cand.nome.toUpperCase().includes('LULA'));
            const isBolsonaro = cand.numero === '22' || (cand.nome && cand.nome.toUpperCase().includes('BOLSONARO'));
            const isLeading = (lideranca.lider === 'lula' && isLula) || (lideranca.lider === 'bolsonaro' && isBolsonaro);

            return (
              <div key={cand.codigo} className="candidate-item">
                <div
                  className="candidate-color-bar"
                  style={{ backgroundColor: color }}
                />
                <div className="candidate-info">
                  <div className="candidate-name-row">
                    <span className="candidate-name">{cand.nome}</span>
                    {cand.partido && (
                      <span className="candidate-party">({cand.partido})</span>
                    )}
                    {isLeading && (
                      <span className={`leading-tag tag-${lideranca.lider}`}>
                        Liderando
                      </span>
                    )}
                  </div>
                  <div className="candidate-stats-row">
                    <span className="candidate-percent" style={{ color }}>
                      {cand.percentualFormatado}
                    </span>
                    <span className="candidate-votes">
                      {cand.votosFormatado} votos
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="urnas-summary">
          <span className="urnas-label">Urnas apuradas</span>
          <span className="urnas-value">
            {dados?.urnasTotalizadas?.percentualFormatado || '0,00%'}
          </span>
          {dados?.urnasTotalizadas?.secoesTotalizadas !== undefined && (
            <span className="urnas-detail">
              {dados.urnasTotalizadas.secoesTotalizadas.toLocaleString('pt-BR')} de{' '}
              {dados.urnasTotalizadas.totalSecoes?.toLocaleString('pt-BR')} seções
            </span>
          )}
        </div>
      </section>

      {/* 3. Gráfico de Linhas Dominante */}
      <main className="chart-area">
        {chartData.length === 0 ? (
          <div className="state-message-container" style={{ height: '100%' }}>
            <p>Aguardando os primeiros marcos de apuração do TSE...</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={chartData}
              margin={{ top: 20, right: 30, left: 10, bottom: 20 }}
            >
              <CartesianGrid
                stroke="#18181b"
                strokeDasharray="3 3"
                vertical={false}
              />

              {/* Linha guia de 50% dos votos válidos */}
              <ReferenceLine
                y={50}
                stroke="#27272a"
                strokeDasharray="4 4"
                label={{
                  value: '50%',
                  fill: '#52525b',
                  fontSize: 10,
                  position: 'right'
                }}
              />

              <XAxis
                dataKey="horaFormatada"
                stroke="#3f3f46"
                tick={{ fill: '#71717a', fontSize: 11, fontFamily: 'JetBrains Mono' }}
                tickLine={{ stroke: '#27272a' }}
                minTickGap={40}
              />

              <YAxis
                domain={yDomain}
                stroke="#3f3f46"
                tick={{ fill: '#71717a', fontSize: 11, fontFamily: 'JetBrains Mono' }}
                tickLine={{ stroke: '#27272a' }}
                tickFormatter={(val) => `${val}%`}
                width={50}
              />

              <Tooltip
                content={
                  <CustomChartTooltip candidateMeta={candidateMeta} />
                }
              />

              {candidateKeys.map((codigo) => {
                const meta = candidateMeta[codigo];
                const color = meta?.color || getCandidateColor(meta);

                return (
                  <Line
                    key={codigo}
                    type="monotone"
                    dataKey={codigo}
                    name={meta?.nome || codigo}
                    stroke={color}
                    strokeWidth={3}
                    dot={(dotProps) => (
                      <CustomDot
                        {...dotProps}
                        key={`dot-${codigo}-${dotProps.index}`}
                        dataLength={chartData.length}
                        stroke={color}
                      />
                    )}
                    activeDot={{ r: 6, fill: color, stroke: '#ffffff', strokeWidth: 2 }}
                    isAnimationActive={false} // Evita reiniciar ou resetar a animação a cada polling
                  />
                );
              })}
            </LineChart>
          </ResponsiveContainer>
        )}
      </main>
    </div>
  );
}
