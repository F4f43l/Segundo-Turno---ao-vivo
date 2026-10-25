import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tseCollector } from './tse-collector.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Log de requisições simples
app.use((req, res, next) => {
  if (req.url.startsWith('/api')) {
    console.log(`[API] ${req.method} ${req.url}`);
  }
  next();
});

/**
 * GET /api/resultado
 * Retorna situação atual da apuração, resumo de candidatos, urnas apuradas e status da conexão.
 */
app.get('/api/resultado', (req, res) => {
  try {
    const resultado = tseCollector.obterResultadoAtual();
    res.json(resultado);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

/**
 * GET /api/historico
 * Retorna todos os marcos cronológicos persistidos para alimentar o Recharts no frontend.
 */
app.get('/api/historico', (req, res) => {
  try {
    const historico = tseCollector.obterHistorico();
    res.json(historico);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

/**
 * POST /api/atualizar
 * Permite forçar uma nova consulta imediata ao TSE
 */
app.post('/api/atualizar', async (req, res) => {
  try {
    await tseCollector.coletar(true);
    const resultado = tseCollector.obterResultadoAtual();
    res.json(resultado);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

/**
 * GET /api/status
 * Diagnóstico da saúde do servidor e do coletor
 */
app.get('/api/status', (req, res) => {
  res.json({
    ok: true,
    tempoAtivoSegundos: Math.floor(process.uptime()),
    urlOficial: tseCollector.url,
    coletorAtivo: !!tseCollector.timer,
    ultimaVerificacao: tseCollector.lastCheckedTimestamp ? new Date(tseCollector.lastCheckedTimestamp).toISOString() : null,
    ultimaConsultaSucesso: tseCollector.lastSuccessTimestamp ? new Date(tseCollector.lastSuccessTimestamp).toISOString() : null,
    ultimoErro: tseCollector.lastError
  });
});

// Servir frontend se o build estático existir
const frontendDist = path.join(__dirname, '../frontend/dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get('*', (req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

// Iniciar servidor
const server = app.listen(PORT, () => {
  console.log(`[Servidor] Backend rodando na porta ${PORT}`);
  tseCollector.iniciar();
});

// Tratamento de encerramento gracioso
const shutdown = () => {
  console.log('[Servidor] Encerrando aplicação graciosamente...');
  tseCollector.parar();
  server.close(() => {
    console.log('[Servidor] Encerrado.');
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
