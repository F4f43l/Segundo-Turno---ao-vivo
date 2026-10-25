import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATABASE_URL = process.env.DATABASE_URL;
let pgPool = null;
let sqliteDb = null;

if (DATABASE_URL) {
  console.log('[Banco] Utilizando banco de dados externo PostgreSQL via DATABASE_URL');
  pgPool = new pg.Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
  });
} else {
  console.log('[Banco] Utilizando banco de dados local SQLite (node:sqlite)');
  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const dbPath = path.join(dataDir, 'apuracao.sqlite');
  sqliteDb = new DatabaseSync(dbPath);
}

let schemaInitialized = false;

export async function inicializarBanco() {
  if (schemaInitialized) return;

  if (pgPool) {
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS snapshots (
        id SERIAL PRIMARY KEY,
        identificador_fonte TEXT,
        horario_coleta TEXT NOT NULL,
        horario_geracao TEXT,
        data_geracao TEXT,
        horario_totalizacao TEXT,
        data_totalizacao TEXT,
        percentual_urnas DOUBLE PRECISION NOT NULL,
        secoes_totalizadas BIGINT,
        total_secoes BIGINT,
        votos_validos_total BIGINT,
        votos_brancos BIGINT,
        votos_nulos BIGINT,
        votos_total BIGINT,
        raw_hash TEXT UNIQUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS snapshot_candidatos (
        id SERIAL PRIMARY KEY,
        snapshot_id INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
        codigo_candidato TEXT NOT NULL,
        numero_candidato TEXT NOT NULL,
        nome_candidato TEXT NOT NULL,
        nome_completo TEXT,
        partido TEXT,
        votos BIGINT NOT NULL,
        percentual_votos_validos DOUBLE PRECISION NOT NULL,
        situacao TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_snapshots_coleta ON snapshots(horario_coleta);
      CREATE INDEX IF NOT EXISTS idx_snapshot_cand_snap ON snapshot_candidatos(snapshot_id);
    `);
  } else {
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        identificador_fonte TEXT,
        horario_coleta TEXT NOT NULL,
        horario_geracao TEXT,
        data_geracao TEXT,
        horario_totalizacao TEXT,
        data_totalizacao TEXT,
        percentual_urnas REAL NOT NULL,
        secoes_totalizadas INTEGER,
        total_secoes INTEGER,
        votos_validos_total INTEGER,
        votos_brancos INTEGER,
        votos_nulos INTEGER,
        votos_total INTEGER,
        raw_hash TEXT UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS snapshot_candidatos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        snapshot_id INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
        codigo_candidato TEXT NOT NULL,
        numero_candidato TEXT NOT NULL,
        nome_candidato TEXT NOT NULL,
        nome_completo TEXT,
        partido TEXT,
        votos INTEGER NOT NULL,
        percentual_votos_validos REAL NOT NULL,
        situacao TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_snapshots_coleta ON snapshots(horario_coleta);
      CREATE INDEX IF NOT EXISTS idx_snapshot_cand_snap ON snapshot_candidatos(snapshot_id);
    `);
  }

  schemaInitialized = true;
}

// Inicializa schema automaticamente
inicializarBanco().catch(err => console.error('[Banco] Erro ao inicializar tabelas:', err.message));

/**
 * Persiste um novo snapshot com seus candidatos de forma atômica
 */
export async function salvarSnapshot(snapshot, candidatos) {
  await inicializarBanco();

  if (pgPool) {
    if (snapshot.raw_hash) {
      const existing = await pgPool.query('SELECT id FROM snapshots WHERE raw_hash = $1', [snapshot.raw_hash]);
      if (existing.rows.length > 0) {
        return { id: existing.rows[0].id, inserido: false };
      }
    }

    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      const insertSnap = `
        INSERT INTO snapshots (
          identificador_fonte,
          horario_coleta,
          horario_geracao,
          data_geracao,
          horario_totalizacao,
          data_totalizacao,
          percentual_urnas,
          secoes_totalizadas,
          total_secoes,
          votos_validos_total,
          votos_brancos,
          votos_nulos,
          votos_total,
          raw_hash
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        RETURNING id
      `;

      const snapRes = await client.query(insertSnap, [
        snapshot.identificador_fonte || null,
        snapshot.horario_coleta,
        snapshot.horario_geracao || null,
        snapshot.data_geracao || null,
        snapshot.horario_totalizacao || null,
        snapshot.data_totalizacao || null,
        snapshot.percentual_urnas,
        snapshot.secoes_totalizadas || null,
        snapshot.total_secoes || null,
        snapshot.votos_validos_total || null,
        snapshot.votos_brancos || null,
        snapshot.votos_nulos || null,
        snapshot.votos_total || null,
        snapshot.raw_hash || null
      ]);

      const snapshotId = snapRes.rows[0].id;

      const insertCand = `
        INSERT INTO snapshot_candidatos (
          snapshot_id,
          codigo_candidato,
          numero_candidato,
          nome_candidato,
          nome_completo,
          partido,
          votos,
          percentual_votos_validos,
          situacao
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `;

      for (const c of candidatos) {
        await client.query(insertCand, [
          snapshotId,
          c.codigo,
          c.numero,
          c.nome,
          c.nomeCompleto || c.nome,
          c.partido || '',
          c.votos,
          c.percentual,
          c.situacao || ''
        ]);
      }

      await client.query('COMMIT');
      return { id: snapshotId, inserido: true };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } else {
    // Modo SQLite
    if (snapshot.raw_hash) {
      const existing = sqliteDb.prepare('SELECT id FROM snapshots WHERE raw_hash = ?').get(snapshot.raw_hash);
      if (existing) {
        return { id: existing.id, inserido: false };
      }
    }

    sqliteDb.exec('BEGIN TRANSACTION');
    try {
      const stmtSnap = sqliteDb.prepare(`
        INSERT INTO snapshots (
          identificador_fonte,
          horario_coleta,
          horario_geracao,
          data_geracao,
          horario_totalizacao,
          data_totalizacao,
          percentual_urnas,
          secoes_totalizadas,
          total_secoes,
          votos_validos_total,
          votos_brancos,
          votos_nulos,
          votos_total,
          raw_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmtSnap.run(
        snapshot.identificador_fonte || null,
        snapshot.horario_coleta,
        snapshot.horario_geracao || null,
        snapshot.data_geracao || null,
        snapshot.horario_totalizacao || null,
        snapshot.data_totalizacao || null,
        snapshot.percentual_urnas,
        snapshot.secoes_totalizadas || null,
        snapshot.total_secoes || null,
        snapshot.votos_validos_total || null,
        snapshot.votos_brancos || null,
        snapshot.votos_nulos || null,
        snapshot.votos_total || null,
        snapshot.raw_hash || null
      );

      const rowId = sqliteDb.prepare('SELECT last_insert_rowid() AS id').get().id;

      const stmtCand = sqliteDb.prepare(`
        INSERT INTO snapshot_candidatos (
          snapshot_id,
          codigo_candidato,
          numero_candidato,
          nome_candidato,
          nome_completo,
          partido,
          votos,
          percentual_votos_validos,
          situacao
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const c of candidatos) {
        stmtCand.run(
          rowId,
          c.codigo,
          c.numero,
          c.nome,
          c.nomeCompleto || c.nome,
          c.partido || '',
          c.votos,
          c.percentual,
          c.situacao || ''
        );
      }

      sqliteDb.exec('COMMIT');
      return { id: rowId, inserido: true };
    } catch (err) {
      sqliteDb.exec('ROLLBACK');
      throw err;
    }
  }
}

/**
 * Obtém todo o histórico cronológico de snapshots para montar o gráfico
 */
export async function obterHistoricoSnapshots() {
  await inicializarBanco();

  if (pgPool) {
    const snapsRes = await pgPool.query(`
      SELECT * FROM snapshots ORDER BY horario_coleta ASC, id ASC
    `);
    const snaps = snapsRes.rows;
    if (snaps.length === 0) return [];

    const candsRes = await pgPool.query(`
      SELECT * FROM snapshot_candidatos ORDER BY snapshot_id ASC, numero_candidato ASC
    `);
    const candRows = candsRes.rows;

    const candsBySnap = new Map();
    for (const row of candRows) {
      if (!candsBySnap.has(row.snapshot_id)) {
        candsBySnap.set(row.snapshot_id, {});
      }
      candsBySnap.get(row.snapshot_id)[row.codigo_candidato] = {
        codigo: row.codigo_candidato,
        numero: row.numero_candidato,
        nome: row.nome_candidato,
        nomeCompleto: row.nome_completo,
        partido: row.partido,
        votos: Number(row.votos),
        percentual: Number(row.percentual_votos_validos),
        situacao: row.situacao
      };
    }

    return snaps.map(s => ({
      id: s.id,
      horarioColeta: s.horario_coleta,
      horarioGeracao: s.horario_geracao,
      dataGeracao: s.data_geracao,
      horarioTotalizacao: s.horario_totalizacao,
      dataTotalizacao: s.data_totalizacao,
      identificadorFonte: s.identificador_fonte,
      percentualUrnas: Number(s.percentual_urnas),
      secoesTotalizadas: Number(s.secoes_totalizadas || 0),
      totalSecoes: Number(s.total_secoes || 0),
      votosValidosTotal: Number(s.votos_validos_total || 0),
      votosBrancos: Number(s.votos_brancos || 0),
      votosNulos: Number(s.votos_nulos || 0),
      votosTotal: Number(s.votos_total || 0),
      candidatos: candsBySnap.get(s.id) || {}
    }));
  } else {
    // Modo SQLite
    const snaps = sqliteDb.prepare(`
      SELECT * FROM snapshots ORDER BY datetime(horario_coleta) ASC, id ASC
    `).all();

    if (snaps.length === 0) return [];

    const candRows = sqliteDb.prepare(`
      SELECT * FROM snapshot_candidatos ORDER BY snapshot_id ASC, numero_candidato ASC
    `).all();

    const candsBySnap = new Map();
    for (const row of candRows) {
      if (!candsBySnap.has(row.snapshot_id)) {
        candsBySnap.set(row.snapshot_id, {});
      }
      candsBySnap.get(row.snapshot_id)[row.codigo_candidato] = {
        codigo: row.codigo_candidato,
        numero: row.numero_candidato,
        nome: row.nome_candidato,
        nomeCompleto: row.nome_completo,
        partido: row.partido,
        votos: row.votos,
        percentual: row.percentual_votos_validos,
        situacao: row.situacao
      };
    }

    return snaps.map(s => ({
      id: s.id,
      horarioColeta: s.horario_coleta,
      horarioGeracao: s.horario_geracao,
      dataGeracao: s.data_geracao,
      horarioTotalizacao: s.horario_totalizacao,
      dataTotalizacao: s.data_totalizacao,
      identificadorFonte: s.identificador_fonte,
      percentualUrnas: s.percentual_urnas,
      secoesTotalizadas: s.secoes_totalizadas,
      totalSecoes: s.total_secoes,
      votosValidosTotal: s.votos_validos_total,
      votosBrancos: s.votos_brancos,
      votosNulos: s.votos_nulos,
      votosTotal: s.votos_total,
      candidatos: candsBySnap.get(s.id) || {}
    }));
  }
}

/**
 * Retorna o snapshot mais recente persistido
 */
export async function obterUltimoSnapshot() {
  await inicializarBanco();

  if (pgPool) {
    const snapRes = await pgPool.query(`
      SELECT * FROM snapshots ORDER BY horario_coleta DESC, id DESC LIMIT 1
    `);
    const lastSnap = snapRes.rows[0];
    if (!lastSnap) return null;

    const candsRes = await pgPool.query(`
      SELECT * FROM snapshot_candidatos WHERE snapshot_id = $1 ORDER BY votos DESC
    `, [lastSnap.id]);

    return {
      id: lastSnap.id,
      horarioColeta: lastSnap.horario_coleta,
      horarioGeracao: lastSnap.horario_geracao,
      dataGeracao: lastSnap.data_geracao,
      horarioTotalizacao: lastSnap.horario_totalizacao,
      dataTotalizacao: lastSnap.data_totalizacao,
      identificadorFonte: lastSnap.identificador_fonte,
      percentualUrnas: Number(lastSnap.percentual_urnas),
      secoesTotalizadas: Number(lastSnap.secoes_totalizadas || 0),
      totalSecoes: Number(lastSnap.total_secoes || 0),
      votosValidosTotal: Number(lastSnap.votos_validos_total || 0),
      votosBrancos: Number(lastSnap.votos_brancos || 0),
      votosNulos: Number(lastSnap.votos_nulos || 0),
      votosTotal: Number(lastSnap.votos_total || 0),
      candidatos: candsRes.rows.map(c => ({
        codigo: c.codigo_candidato,
        numero: c.numero_candidato,
        nome: c.nome_candidato,
        nomeCompleto: c.nome_completo,
        partido: c.partido,
        votos: Number(c.votos),
        percentual: Number(c.percentual_votos_validos),
        situacao: c.situacao
      }))
    };
  } else {
    // Modo SQLite
    const lastSnap = sqliteDb.prepare(`
      SELECT * FROM snapshots ORDER BY datetime(horario_coleta) DESC, id DESC LIMIT 1
    `).get();

    if (!lastSnap) return null;

    const cands = sqliteDb.prepare(`
      SELECT * FROM snapshot_candidatos WHERE snapshot_id = ? ORDER BY votos DESC
    `).all(lastSnap.id);

    return {
      id: lastSnap.id,
      horarioColeta: lastSnap.horario_coleta,
      horarioGeracao: lastSnap.horario_geracao,
      dataGeracao: lastSnap.data_geracao,
      horarioTotalizacao: lastSnap.horario_totalizacao,
      dataTotalizacao: lastSnap.data_totalizacao,
      identificadorFonte: lastSnap.identificador_fonte,
      percentualUrnas: lastSnap.percentual_urnas,
      secoesTotalizadas: lastSnap.secoes_totalizadas,
      totalSecoes: lastSnap.total_secoes,
      votosValidosTotal: lastSnap.votos_validos_total,
      votosBrancos: lastSnap.votos_brancos,
      votosNulos: lastSnap.votos_nulos,
      votosTotal: lastSnap.votos_total,
      candidatos: cands.map(c => ({
        codigo: c.codigo_candidato,
        numero: c.numero_candidato,
        nome: c.nome_candidato,
        nomeCompleto: c.nome_completo,
        partido: c.partido,
        votos: c.votos,
        percentual: c.percentual_votos_validos,
        situacao: c.situacao
      }))
    };
  }
}
