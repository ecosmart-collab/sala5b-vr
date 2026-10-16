// Armazenamento das sessões 5B: um arquivo JSON por sala em data/sessoes/<CODIGO>.json
// (fora de public/). Gravação atômica (tmp + rename) e retomada de sessões ativas após reinício.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const oculos = require("./oculos");

const BLOCOS = ["B1", "B2", "B3", "B4", "B5"];
const NOMES_BLOCOS = {
  B1: "BioRegula",
  B2: "Botão de Partida",
  B3: "Bússola do Foco",
  B4: "Blindagem Neural",
  B5: "Boa Memória"
};
const CODIGO_RE = /^[A-HJ-NP-Z2-9]{6}$/; // sem I, O, 0, 1 (fácil de digitar no óculos)
const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function novoCodigo() {
  let c = "";
  for (const b of crypto.randomBytes(6)) c += ALFABETO[b % ALFABETO.length];
  return c;
}

const texto = (v, max) => String(v ?? "").trim().slice(0, max);

function criarStore(dataDir) {
  const dir = path.join(dataDir, "sessoes");
  fs.mkdirSync(dir, { recursive: true });
  const ativas = new Map(); // codigo -> sessao
  const timers = new Map();

  const arquivo = (codigo) => path.join(dir, `${codigo}.json`);

  function gravarAgora(s) {
    clearTimeout(timers.get(s.codigo));
    timers.delete(s.codigo);
    const tmp = arquivo(s.codigo) + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2), "utf-8");
    fs.renameSync(tmp, arquivo(s.codigo));
  }

  // Agrupa gravações frequentes (cada resposta) em uma escrita a cada 500 ms
  function gravar(s) {
    if (timers.has(s.codigo)) return;
    timers.set(s.codigo, setTimeout(() => gravarAgora(s), 500));
  }

  // Retoma sessões não finalizadas (ex.: servidor reiniciou no meio do atendimento)
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const s = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
      if (s.status === "ativa") {
        s.blocoDesde = Date.now(); // tempo em que o servidor ficou fora não é contado
        if (s.pausa) s.pausaDesde = Date.now();
        oculos.aoCarregar(s);
        ativas.set(s.codigo, s);
      }
    } catch (e) {
      console.error("[sessoes] arquivo inválido:", f, e.message);
    }
  }

  function criar({ paciente, objetivo, duracaoMin }) {
    let codigo;
    do codigo = novoCodigo();
    while (ativas.has(codigo) || fs.existsSync(arquivo(codigo)));

    const agora = Date.now();
    const s = {
      codigo,
      versao: 1,
      paciente: texto(paciente, 40) || "SEM-CODIGO",
      objetivo: texto(objetivo, 300),
      duracaoMin: [40, 60].includes(Number(duracaoMin)) ? Number(duracaoMin) : 40,
      status: "ativa",
      criadaEm: new Date(agora).toISOString(),
      finalizadaEm: null,
      blocoAtual: "B1",
      blocoDesde: agora,
      pausa: false,
      pausaTipo: null,
      pausaDesde: null,
      pausasMs: 0,
      blocos: Object.fromEntries(BLOCOS.map((b) => [b, { tempoMs: 0, apoios: [], notas: "" }])),
      cena: { respiracao: false, checkin: false, ruido: 0, olhar: false, olharSeg: 2 },
      apoioResposta: { nivel: "independente", voltar: true },
      atividadeAtual: null,
      autoProxima: false,
      ultimaConfig: null,
      atividades: [],
      respostas: [],
      checkins: [],
      eventos: [{ ts: new Date(agora).toISOString(), tipo: "sessao_criada" }],
      encerramento: null
    };
    ativas.set(codigo, s);
    gravarAgora(s);
    return s;
  }

  const obterAtiva = (codigo) => (CODIGO_RE.test(codigo) ? ativas.get(codigo) || null : null);

  function ler(codigo) {
    if (!CODIGO_RE.test(codigo)) return null;
    if (ativas.has(codigo)) return ativas.get(codigo);
    const f = arquivo(codigo);
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf-8")) : null;
  }

  function listar() {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        try {
          const s = ativas.get(f.slice(0, -5)) || JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
          const acertos = s.respostas.filter((r) => r.correta).length;
          return {
            codigo: s.codigo,
            paciente: s.paciente,
            objetivo: s.objetivo,
            status: s.status,
            criadaEm: s.criadaEm,
            finalizadaEm: s.finalizadaEm,
            respostas: s.respostas.length,
            acertos,
            participacao: s.encerramento?.participacao ?? null
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.criadaEm.localeCompare(a.criadaEm));
  }

  // Fecha o tempo corrido do bloco atual (pausas contam à parte, não são bloco)
  function fecharTempo(s) {
    const agora = Date.now();
    if (s.pausa) {
      s.pausasMs += agora - (s.pausaDesde || agora);
      s.pausaDesde = agora;
    } else {
      s.blocos[s.blocoAtual].tempoMs += agora - (s.blocoDesde || agora);
    }
    s.blocoDesde = agora;
  }

  function evento(s, tipo, detalhe) {
    s.eventos.push({ ts: new Date().toISOString(), bloco: s.blocoAtual, tipo, ...(detalhe ? { detalhe } : {}) });
  }

  function finalizar(s, enc) {
    fecharTempo(s);
    oculos.atualizar(s, false);
    const p = Number(enc?.participacao);
    const SINTOMAS = ["enjoo", "tontura", "dor-de-cabeca", "cansaco-visual", "visao-dupla", "peso-ajuste", "outro"];
    const sintomas = (Array.isArray(enc?.sintomas) ? enc.sintomas : []).filter((x) => SINTOMAS.includes(x));
    s.encerramento = {
      desconforto: {
        perguntado: Boolean(enc?.desconfortoPerguntado),
        nenhum: Boolean(enc?.desconfortoNenhum) && sintomas.length === 0,
        sintomas,
        observacao: texto(enc?.desconfortoObs, 1000)
      },
      oculos: oculos.resumo(s),
      participacao: p >= 1 && p <= 5 ? p : null,
      resultadoDemonstrado: texto(enc?.resultadoDemonstrado, 2000),
      percepcaoPessoa: texto(enc?.percepcaoPessoa, 2000),
      continuidade: texto(enc?.continuidade, 2000)
    };
    s.status = "finalizada";
    s.finalizadaEm = new Date().toISOString();
    s.atividadeAtual = null;
    evento(s, "sessao_finalizada");
    gravarAgora(s);
    ativas.delete(s.codigo);
  }

  // Resumo calculado (tempos em minutos, acertos por bloco/tipo)
  function resumo(s) {
    const porBloco = {};
    for (const b of BLOCOS) {
      const rs = s.respostas.filter((r) => r.bloco === b);
      const extra = s.status === "ativa" && !s.pausa && s.blocoAtual === b ? Date.now() - s.blocoDesde : 0;
      porBloco[b] = {
        nome: NOMES_BLOCOS[b],
        tempoMs: s.blocos[b].tempoMs + extra,
        tentativas: rs.length,
        acertos: rs.filter((r) => r.correta).length,
        independentes: rs.filter((r) => (r.apoio || "independente") === "independente").length,
        omissoes: (s.omissoes || []).filter((o) => o.bloco === b).length,
        atividades: s.atividades.filter((a) => a.bloco === b).length
      };
    }
    const pausaExtra = s.status === "ativa" && s.pausa ? Date.now() - s.pausaDesde : 0;
    return { porBloco, pausasMs: s.pausasMs + pausaExtra, oculos: oculos.resumo(s) };
  }

  function csv(s) {
    const linhas = [["timestamp", "bloco", "atividade_id", "tipo", "parametros", "resposta", "correta", "tentativa", "tempo_resposta_ms", "detalhe", "apoio", "modo"]];
    for (const r of s.respostas) {
      linhas.push([r.ts, r.bloco, r.atividadeId, r.tipo, JSON.stringify(r.params), r.valor, r.correta ? "sim" : "nao", r.tentativa, r.tempoMs, r.detalhe || "", r.apoio || "independente", r.modo || "apontar"]);
    }
    for (const o of s.omissoes || []) {
      linhas.push([o.ts, o.bloco, o.atividadeId, o.tipo, JSON.stringify(o.params), "", "omissao", "", o.segundos * 1000, `sem resposta em ${o.segundos} s`, "", ""]);
    }
    linhas.splice(1, linhas.length - 1, ...linhas.slice(1).sort((x, y) => String(x[0]).localeCompare(String(y[0]))));
    return linhas.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
  }

  const gravarTodas = () => { for (const s of ativas.values()) gravarAgora(s); };

  const ativasLista = () => [...ativas.values()];

  return { ativasLista, gravarTodas, criar, obterAtiva, ler, listar, gravar, gravarAgora, fecharTempo, evento, finalizar, resumo, csv };
}

module.exports = { criarStore, BLOCOS, NOMES_BLOCOS, CODIGO_RE };
