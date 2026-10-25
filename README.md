# Dashboard de Apuração Eleitoral em Tempo Real
> **2º Turno · Presidente da República · Brasil 2026**  
> Desenvolvido estritamente de acordo com a especificação técnica do TSE.

---

## 1. Visão Geral e Identidade Visual

O **Dashboard de Apuração** é um painel minimalista de alto contraste com fundo preto puro (`#000000`), projetado para acompanhar a evolução temporal da contagem de votos do segundo turno presidencial utilizando dados oficiais em tempo real do Tribunal Superior Eleitoral (TSE).

- **Fundo Dinâmico com Ambientação de Liderança**:
  - **Lula na frente**: A tela assume um tom vermelho escuro suave e discreto (`rgba(185, 28, 28, 0.24)` em gradiente radial).
  - **Flávio Bolsonaro na frente**: A tela assume um tom amarelo-ouro escuro e discreto (`rgba(217, 119, 6, 0.24)` em gradiente radial).
  - **Empate**: Mantém o fundo preto neutro original (`#000000`).
  - **Transição Suave**: Transição com duração de 650ms entre os estados, preservando o contraste e a legibilidade total dos textos, eixos e linhas do gráfico.
- **Gráfico Dominante**: Gráfico de linhas (`Recharts`) centralizado, ocupando a maior área útil da tela.
- **Cores das Séries e Candidatos (Fixas)**:
  - **Lula (13 · PT)**: Linha vermelha nítida e legível (`#F04444`) sobre fundo escuro.
  - **Flávio Bolsonaro (22 · PL)**: Linha amarelo-ouro (`#E8B83F`).
  - *As cores das linhas e dos pontos mais recentes permanecem sempre fixas para cada candidatura, independente de quem estiver liderando no momento.*
- **Marcos Temporais Reais**: Eixo X cronológico com horários oficiais no fuso horário `America/Sao_Paulo`.
- **Eixo Y**: Percentual de votos válidos entre 0% e 100% com formatação brasileira (`XX,XX%`) e linhas de grade discretas (`#18181b`), incluindo alternância dinâmica para modo de foco (zoom nas curvas).
- **Resumo Acima do Gráfico**: Nome de cada candidato, percentual atual, votos absolutos formatados e percentual de urnas apuradas.
- **Tooltip Completo**: Ao passar o cursor ou tocar em um ponto, exibe o horário da observação, percentual e votos contabilizados de cada candidato e o percentual de urnas apuradas naquele registro específico.

---

## 2. Fonte Oficial e Mapeamento dos Campos do TSE

A aplicação conecta-se ao endpoint oficial de divulgação de resultados do TSE:
`https://resultados.tse.jus.br/oficial/ele2026/6258/dados/br/br-c0001-e006258-u.json`

| Campo TSE | Significado / Mapeamento no Dashboard |
| :--- | :--- |
| `ele` | Código da eleição (`6258` - 2º Turno Presidencial 2026) |
| `t` | Turno da eleição (`2`) |
| `dg` / `hg` | Data (`25/10/2026`) e Hora de geração do arquivo pelo TSE |
| `dt` / `ht` | Data e Hora da totalização dos votos apurados |
| `idg` | Identificador único da versão de geração dos dados |
| `s.pst` / `s.pstn` | **Percentual de seções eleitorais/urnas totalizadas** no Brasil |
| `s.st` | Quantidade absoluta de seções/urnas totalizadas |
| `s.ts` | Total de seções eleitorais do país |
| `v.vv` | Total de votos válidos nominais contabilizados |
| `carg[0].agr[].par[].cand[]` | Lista oficial das candidaturas |
| `cand.sqcand` | **Identificador estável e único do candidato** no TSE |
| `cand.n` | Número de urna do candidato (`13`, `22`) |
| `cand.nm` / `cand.nmu` | Nome completo e Nome de urna oficial |
| `cand.vap` | Quantidade de votos apurados do candidato |
| `cand.pvap` / `cand.pvapn`| **Percentual oficial de votos válidos apurados** |
| `cand.st` | Situação da totalização (ex: "Eleito", quando declarado) |

---

## 3. Arquitetura do Sistema

```
c:\Segundo Turno\
├── backend/
│   ├── data/
│   │   └── apuracao.sqlite    # Banco SQLite para persistência contínua dos snapshots
│   ├── database.js            # Módulo SQLite nativo (node:sqlite) e queries atômicas
│   ├── tse-collector.js       # Coletor com ETag/304, validação aritmética e lock in-flight
│   ├── server.js              # API Express (rotas /api/resultado, /api/historico) e servidor estático
│   ├── test-suite.js          # Bateria de testes automatizados da integridade e resiliência
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── App.jsx            # Aplicação React com Recharts, custom dot e tooltip
│   │   ├── App.css            # Estilos minimalistas em preto puro e responsivos
│   │   ├── index.css          # Reset e fontes Inter / JetBrains Mono
│   │   └── main.jsx
│   ├── index.html             # Título oficial e metas
│   ├── vite.config.js         # Proxy para API local e portas configuradas
│   └── package.json
├── package.json               # Scripts raiz para execução facilitada
└── README.md
```

### Funcionalidades do Backend:
1. **Evita consultas redundantes e sobrepostas**: Usa uma trava em memória (`isFetching`) e cabeçalhos `If-None-Match` (ETag) e `If-Modified-Since`.
2. **Persistência em SQLite**: Registra novos snapshots apenas quando os votos apurados ou percentual de urnas mudam, garantindo que o histórico nunca seja perdido ao reiniciar a aplicação.
3. **Tratamento de Falhas e Desatualização**: Se a conexão com o TSE falhar temporariamente, os dados válidos anteriores são mantidos, a curva histórica é preservada e o frontend recebe `isStale: true` com a indicação da última sincronização com sucesso.

---

## 4. Como Executar o Projeto

### Pré-requisitos
- Node.js versão 20+ ou 24+ instalado.

### Passo 1: Instalação das dependências
Na raiz do projeto (`c:\Segundo Turno`), execute:
```bash
npm run install:all
```
*(Ou instale separadamente entrando nas pastas `backend` e `frontend` e rodando `npm install`)*

### Passo 2: Construir o frontend (uma vez ou após alterações)
```bash
npm run build
```

### Passo 3: Iniciar a aplicação localmente
Para rodar a aplicação unificada (o backend gerencia a coleta contínua, persiste no banco e serve a interface no navegador):
```bash
npm start
```
Acesse no seu navegador: **`http://localhost:3001`**

### Modo Desenvolvimento com Hot Reload (Opcional):
Caso queira rodar o frontend com Vite dev server em paralelo:
- **Terminal 1**: `cd backend && npm start` (porta `3001`)
- **Terminal 2**: `cd frontend && npm run dev` (porta `5173`)
Acesse em: **`http://localhost:5173`**

---

## 5. Hospedagem na Nuvem (Render / Vercel)

A aplicação foi projetada para rodar em nuvem em um **único domínio público**, servindo o frontend React e a API Node.js de forma integrada, com suporte a **banco de dados externo** e **atualização sob demanda (SWR)** sem depender de timers em memória ou arquivos locais.

### A. Deploy no Render (Recomendado)
O Render suporta nativamente a arquitetura unificada como um **Web Service Node.js**:

1. Acesse o [Render Dashboard](https://dashboard.render.com).
2. Clique em **New** > **Web Service**.
3. Conecte ao repositório GitHub: `https://github.com/F4f43l/Segundo-Turno---ao-vivo.git`.
4. Preencha as configurações (já pré-configuradas em [render.yaml](file:///c:/Segundo%20Turno/render.yaml)):
   - **Build Command**: `npm run install:all && npm run build`
   - **Start Command**: `npm start`
   - **Environment Variables**:
     - `NODE_ENV`: `production`
     - `PORT`: `10000`
     - `DATABASE_URL`: URL do seu banco de dados PostgreSQL externo (ex: Supabase, Neon ou Render Postgres). *(Se omitido, utiliza SQLite local)*.
5. Clique em **Create Web Service**.
6. O Render fornecerá uma URL pública automática: `https://segundo-turno-ao-vivo.onrender.com`.

### B. Banco de Dados Persistente Externo
Para não depender do disco efêmero de servidores gratuitos:
- Defina a variável de ambiente `DATABASE_URL` apontando para qualquer PostgreSQL (Neon, Supabase ou Render PostgreSQL).
- As tabelas `snapshots` e `snapshot_candidatos` são criadas automaticamente no primeiro acesso.

### C. Atualização Sob Demanda (Zero Dependência de Timers)
O coletor implementa o padrão **Stale-While-Revalidate**:
- A cada requisição a `/api/resultado`, se a última coleta tiver mais de 15 segundos, o backend consulta o TSE de forma assíncrona, grava o novo marco no banco externo e retorna o dado atualizado.
- O polling automático do próprio frontend a cada 10-15s garante que as visitas mantenham a apuração continuamente fresca sem necessidade de processos em background que nunca dormem.

---

## 5. Testes Realizados e Validação dos Critérios de Aceite

Foi executada a suíte de testes automatizados (`node backend/test-suite.js`) que validou:
1. **Coleta de Dados Reais**: Ingestão bem-sucedida da apuração oficial do TSE (2º Turno Presidencial 2026).
2. **Consistência Matemática**: Soma de votos de Lula e Flávio Bolsonaro igual ao total oficial de votos válidos (`v.vv`), e soma dos percentuais totalizando ~100%.
3. **Persistência SQLite**: Snapshots gravados sobrevivem ao encerramento e reinicialização completa do servidor Node.js.
4. **Resiliência a Falhas de Rede**: Emulação de queda na conexão preserva o último resultado válido e o histórico sem substituí-lo por zero ou apagar as séries temporais.
5. **Atualizações em Tempo Real**: Coleta periódica a cada 15 segundos alimentando o gráfico sem reiniciá-lo ou perder pontos visíveis.
