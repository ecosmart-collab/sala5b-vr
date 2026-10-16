// Relatórios em HTML para imprimir ou salvar em PDF pelo navegador:
//  - encontro (versão do profissional e versão da família)
//  - registro mensal do Método 5B (por pessoa atendida)
// Linguagem segue o Método 5B: a participação (1–5) descreve o encontro e não classifica a pessoa;
// participação e resultado demonstrado são registrados separadamente.
const { BLOCOS, NOMES_BLOCOS } = require("./sessoes");

const FUSO = process.env.TZ_RELATORIO || "America/Sao_Paulo";
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const dataBR = (iso) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: FUSO }) : "—");
const horaBR = (iso) => (iso ? new Date(iso).toLocaleTimeString("pt-BR", { timeZone: FUSO, hour: "2-digit", minute: "2-digit" }) : "");
const mesDe = (iso) => new Date(iso).toLocaleString("sv-SE", { timeZone: FUSO }).slice(0, 7);
const min = (ms) => (ms ? Math.round(ms / 60000) : 0);
const mmss = (ms) => {
  const s = Math.round((ms || 0) / 1000);
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
};

const PARTICIPACAO = {
  1: "Participação muito limitada",
  2: "Participação breve",
  3: "Participação oscilante",
  4: "Participação consistente",
  5: "Participação sustentada e ativa"
};
const NIVEIS = { independente: "independente", gestual: "gestual", verbal: "verbal", visual: "visual", modelo: "modelo", fisico: "físico" };
const APOIOS_BLOCO = {
  demonstracao: "demonstração",
  "instrucao-verbal": "instrução verbal",
  "apoio-visual": "apoio visual",
  "escolha-reduzida": "escolha reduzida",
  "pausa-oferecida": "pausa oferecida",
  outro: "outro"
};
const SINTOMAS = {
  enjoo: "enjoo",
  tontura: "tontura",
  "dor-de-cabeca": "dor de cabeça",
  "cansaco-visual": "cansaço nos olhos",
  "visao-dupla": "visão dupla",
  "peso-ajuste": "peso ou ajuste do óculos",
  outro: "outro"
};
const CHECKINS = { calma: "calma", cansaco: "cansaço", agitacao: "agitação", animacao: "animação", "prefiro-nao-dizer": "prefiro não dizer" };
const TIPOS = { contagem: "Contagem", comparacao: "Comparação (mais/menos)", soma: "Adição", cubo: "Cubo 2×2", palavra: "Palavra", categorias: "Categorias", alvos: "Alvos (aquecimento)" };
const NOMES_CATEGORIAS = { frutas: "frutas", bebidas: "bebidas", limpeza: "limpeza", padaria: "padaria" };
const REF = { 40: { B1: 5, B2: 7, B3: 8, B4: 10, B5: 5 }, 60: { B1: 8, B2: 12, B3: 10, B4: 15, B5: 7 } };

const contar = (lista) => lista.reduce((m, x) => ((m[x] = (m[x] || 0) + 1), m), {});
const listaContagem = (obj, nomes) =>
  Object.entries(obj)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${nomes[k] || k}${n > 1 ? ` (${n}×)` : ""}`)
    .join(", ");

function descricaoAtividade(a) {
  const p = a.params || {};
  if (a.tipo === "palavra") return `Palavra ${String(p.palavra || "").replace(/-/g, p.unidade === "silaba" ? "-" : "")} (${p.unidade === "silaba" ? "sílabas" : "letras"}, ${p.arranjo === "arco" ? "em arco" : "em ordem"})`;
  if (a.tipo === "cubo") return `Cubo 2×2 a ${p.profundidade} giros`;
  if (a.tipo === "alvos") return `Alvos (aquecimento): ${p.qtdAlvos} alvos, tamanho ${p.tamanhoAlvo === "medio" ? "médio" : p.tamanhoAlvo}, área ${p.area}`;
  if (a.tipo === "categorias") return `Categorias: ${NOMES_CATEGORIAS[p.categoria] || p.categoria} (${p.meta} itens, ${p.distratores} de outras categorias)${p.trocaDe ? `, troca de regra a partir de ${NOMES_CATEGORIAS[p.trocaDe] || p.trocaDe}` : ""}${p.levar ? ", pegando e levando ao carrinho" : ""}`;
  if (a.tipo === "contagem") return `Contagem (${p.n})`;
  if (a.tipo === "soma") return `Adição ${p.a} + ${p.b}`;
  if (a.tipo === "comparacao") return `Comparação ${p.a} × ${p.b} (qual tem ${p.pergunta})`;
  return TIPOS[a.tipo] || a.tipo;
}

function desconfortoTexto(d) {
  if (!d || !d.perguntado) return "Não registrado";
  if (d.nenhum) return "Nenhum desconforto relatado";
  return d.sintomas.map((x) => SINTOMAS[x] || x).join(", ") + (d.observacao ? ` — ${d.observacao}` : "");
}

// ---------------------------------------------------------------- página base
function pagina(titulo, corpo) {
  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(titulo)}</title>
<style>
  :root { --ink: #1f2a30; --muted: #5f6c72; --linha: #dcd9d2; --accent: #2f6f6a; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f3f1ec; color: var(--ink); font: 14px/1.5 system-ui, sans-serif; }
  main { max-width: 860px; margin: 24px auto; background: #fff; padding: 36px 40px; border-radius: 10px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 26px 0 8px; color: var(--accent); text-transform: uppercase; letter-spacing: .04em; }
  h3 { font-size: 14px; margin: 14px 0 4px; }
  .sub { color: var(--muted); margin: 0 0 18px; }
  table { width: 100%; border-collapse: collapse; margin: 6px 0 4px; }
  th, td { text-align: left; vertical-align: top; padding: 6px 8px; border-bottom: 1px solid var(--linha); }
  th { font-size: 12px; color: var(--muted); font-weight: 600; }
  .grade { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 6px 18px; }
  .grade div span { display: block; font-size: 12px; color: var(--muted); }
  .nota { background: #f6f4ef; border-left: 3px solid var(--accent); padding: 8px 12px; margin: 8px 0; white-space: pre-wrap; }
  .aviso { font-size: 12px; color: var(--muted); margin-top: 26px; border-top: 1px solid var(--linha); padding-top: 10px; }
  .acoes { max-width: 860px; margin: 16px auto 0; display: flex; gap: 8px; justify-content: flex-end; }
  .acoes button { font: 600 14px system-ui; padding: 8px 14px; border-radius: 8px; border: 0; background: var(--accent); color: #fff; cursor: pointer; }
  @media (max-width: 640px) { main { padding: 20px 16px; margin: 0; border-radius: 0; } }
  @media print { body { background: #fff; } main { margin: 0; padding: 0; max-width: none; } .acoes { display: none; } h2 { break-after: avoid; } tr { break-inside: avoid; } }
</style></head>
<body>
<div class="acoes"><button onclick="window.print()">Imprimir / salvar PDF</button></div>
<main>${corpo}</main>
</body></html>`;
}

// ---------------------------------------------------------------- dados derivados
function metricasBloco(s, b) {
  const rs = s.respostas.filter((r) => r.bloco === b);
  const certas = rs.filter((r) => r.correta);
  const tempos = certas.map((r) => r.tempoMs).filter(Boolean);
  return {
    tentativas: rs.length,
    acertos: certas.length,
    semApoio: rs.filter((r) => (r.apoio || "independente") === "independente").length,
    pelOlhar: rs.filter((r) => r.modo === "olhar").length,
    omissoes: (s.omissoes || []).filter((o) => o.bloco === b).length,
    tempoMedio: tempos.length ? (tempos.reduce((x, y) => x + y, 0) / tempos.length / 1000).toFixed(1) + " s" : "—",
    niveis: contar(rs.map((r) => r.apoio || "independente").filter((n) => n !== "independente"))
  };
}

// ---------------------------------------------------------------- encontro (profissional)
function encontroProfissional(s, resumo) {
  const enc = s.encerramento || {};
  const ref = REF[s.duracaoMin] || REF[40];
  const oc = enc.oculos || resumo.oculos || {};
  const linhasBlocos = BLOCOS.map((b) => {
    const m = metricasBloco(s, b);
    const t = resumo.porBloco[b].tempoMs;
    return `<tr><td><b>${b}</b> ${esc(NOMES_BLOCOS[b])}</td><td>${min(t)} min <span style="color:#5f6c72">(ref. ~${ref[b]})</span></td>
      <td>${m.acertos}/${m.tentativas}</td><td>${m.semApoio}/${m.tentativas}</td><td>${m.omissoes || "—"}</td><td>${m.tempoMedio}</td></tr>`;
  }).join("");

  const detalheBlocos = BLOCOS.map((b) => {
    const blk = s.blocos[b];
    const m = metricasBloco(s, b);
    const ats = s.atividades.filter((a) => a.bloco === b);
    const ck = s.checkins.filter((c) => c.bloco === b);
    if (!blk.notas && !blk.apoios.length && !ats.length && !ck.length && !m.tentativas) return "";
    return `<h3>${b} · ${esc(NOMES_BLOCOS[b])}</h3>
      ${ck.length ? `<p>Check-in da pessoa: ${esc(ck.map((c) => CHECKINS[c.valor] || c.valor).join(", "))}</p>` : ""}
      ${ats.length ? `<p>Atividades: ${esc(ats.map((a) => descricaoAtividade(a) + (a.resolvida ? " ✓" : "")).join("; "))}</p>` : ""}
      ${blk.apoios.length ? `<p>Apoios oferecidos no bloco: ${esc(listaContagem(contar(blk.apoios.map((a) => a.tipo)), APOIOS_BLOCO))}</p>` : ""}
      ${Object.keys(m.niveis).length ? `<p>Apoio nas respostas: ${esc(listaContagem(m.niveis, NIVEIS))}</p>` : ""}
      ${m.pelOlhar ? `<p>Respostas pelo olhar: ${m.pelOlhar} de ${m.tentativas}</p>` : ""}
      ${blk.notas ? `<div class="nota">${esc(blk.notas)}</div>` : ""}`;
  }).join("");

  const corpo = `
    <h1>Registro do encontro — Método 5B</h1>
    <p class="sub">Sala 5B · documento do profissional</p>
    <div class="grade">
      <div><span>Pessoa atendida (código)</span>${esc(s.paciente)}</div>
      <div><span>Data</span>${dataBR(s.criadaEm)} ${horaBR(s.criadaEm)}</div>
      <div><span>Duração prevista</span>${s.duracaoMin} min</div>
      <div><span>Situação</span>${s.status === "finalizada" ? "encerrado" : "em andamento"}</div>
    </div>
    <h2>Objetivo do encontro</h2>
    <p>${esc(s.objetivo) || "—"}</p>

    <h2>Resumo por bloco</h2>
    <table><thead><tr><th>Bloco</th><th>Tempo</th><th>Acertos</th><th>Sem apoio</th><th>Sem resposta</th><th>Tempo médio (acertos)</th></tr></thead>
    <tbody>${linhasBlocos}</tbody></table>
    <p style="color:#5f6c72;font-size:12px">Pausas e transições: ${min(resumo.pausasMs)} min (não contam como bloco). Tempos de referência são flexíveis.</p>

    ${detalheBlocos ? `<h2>Observações por bloco</h2>${detalheBlocos}` : ""}

    <h2>Uso do óculos</h2>
    <div class="grade">
      <div><span>Tempo total</span>${mmss(oc.totalMs)}</div>
      <div><span>Maior período contínuo</span>${mmss(oc.maiorContinuoMs)}</div>
      <div><span>Desconforto</span>${esc(desconfortoTexto(enc.desconforto))}</div>
    </div>

    <h2>Encerramento</h2>
    <div class="grade">
      <div><span>Referência descritiva de participação</span>${enc.participacao ? `${enc.participacao} — ${PARTICIPACAO[enc.participacao]}` : "—"}</div>
    </div>
    <h3>Resultado demonstrado</h3><div class="nota">${esc(enc.resultadoDemonstrado) || "—"}</div>
    <h3>Percepção da pessoa sobre o encontro</h3><div class="nota">${esc(enc.percepcaoPessoa) || "—"}</div>
    <h3>Continuidade planejada</h3><div class="nota">${esc(enc.continuidade) || "—"}</div>

    <p class="aviso">A referência de participação (1–5) é um instrumento interno: descreve o encontro e não classifica a pessoa, nem é escala clínica validada.
    Participação não comprova aprendizagem — por isso o resultado demonstrado é registrado à parte. Os nomes dos blocos são simbólicos.
    Os dados de acertos, tempos e apoios são registros da atividade, não medidas de avaliação neuropsicológica.</p>`;
  return pagina(`Encontro ${s.codigo} — ${s.paciente}`, corpo);
}

// ---------------------------------------------------------------- encontro (família)
function encontroFamilia(s) {
  const enc = s.encerramento || {};
  const oc = enc.oculos || {};
  const feitas = s.atividades.filter((a) => a.resolvida);
  const palavras = feitas.filter((a) => a.tipo === "palavra").map((a) => String(a.params.palavra).replace(/-/g, ""));
  const contas = feitas.filter((a) => ["contagem", "soma", "comparacao"].includes(a.tipo)).length;
  const cubos = feitas.filter((a) => a.tipo === "cubo").length;
  const listas = [...new Set(feitas.filter((a) => a.tipo === "categorias").map((a) => NOMES_CATEGORIAS[a.params.categoria] || a.params.categoria))];
  const itens = [];
  if (palavras.length) itens.push(`Montou as palavras: <b>${esc(palavras.join(", "))}</b>.`);
  if (contas) itens.push(`Fez ${contas} ${contas === 1 ? "atividade" : "atividades"} de contar, comparar ou somar.`);
  if (feitas.some((a) => a.tipo === "alvos")) itens.push("Fez um aquecimento apontando para alvos, para se acostumar com o óculos.");
  if (listas.length) itens.push(`Separou itens por categoria no mercado: ${esc(listas.join(", "))}.`);
  if (cubos) itens.push(`Resolveu ${cubos} ${cubos === 1 ? "desafio" : "desafios"} com o cubo.`);
  if (!itens.length) itens.push("Neste encontro, o foco foi conhecer o ambiente e se sentir à vontade.");
  const d = enc.desconforto;
  const bemEstar = !d || !d.perguntado
    ? "Não houve registro sobre desconforto."
    : d.nenhum
      ? "Não relatou desconforto com o óculos."
      : `Relatou: ${esc(d.sintomas.map((x) => SINTOMAS[x] || x).join(", "))}. Se perceber algo diferente em casa, avise o profissional.`;

  const corpo = `
    <h1>Como foi o encontro</h1>
    <p class="sub">${dataBR(s.criadaEm)} · Sala 5B</p>
    <h2>O que fizemos</h2>
    <ul>${itens.map((i) => `<li>${i}</li>`).join("")}</ul>
    ${enc.resultadoDemonstrado ? `<h2>O que observamos</h2><div class="nota">${esc(enc.resultadoDemonstrado)}</div>` : ""}
    ${enc.percepcaoPessoa ? `<h2>O que a pessoa contou</h2><div class="nota">${esc(enc.percepcaoPessoa)}</div>` : ""}
    <h2>Óculos de realidade virtual</h2>
    <p>Tempo de uso: ${min(oc.totalMs) || "menos de 1"} min, com pausas quando necessário. ${bemEstar}</p>
    ${enc.continuidade ? `<h2>Próximos passos</h2><div class="nota">${esc(enc.continuidade)}</div>` : ""}
    <p class="aviso">Este resumo descreve as atividades deste encontro. Ele não é avaliação nem diagnóstico.
    Em caso de dúvida, converse com o profissional que acompanha o atendimento.</p>`;
  return pagina(`Encontro de ${dataBR(s.criadaEm)}`, corpo);
}

// ---------------------------------------------------------------- registro mensal
function mensal(paciente, mes, sessoes) {
  const ordenadas = sessoes.sort((a, b) => a.criadaEm.localeCompare(b.criadaEm));
  const finalizadas = ordenadas.filter((s) => s.status === "finalizada");
  const niveis = finalizadas.map((s) => s.encerramento?.participacao).filter(Boolean);
  const freq = contar(niveis);
  const maxF = Math.max(0, ...Object.values(freq));
  const modas = Object.keys(freq).filter((k) => freq[k] === maxF).map(Number).sort();
  const totalResp = ordenadas.reduce((n, s) => n + s.respostas.length, 0);
  const semApoio = ordenadas.reduce((n, s) => n + s.respostas.filter((r) => (r.apoio || "independente") === "independente").length, 0);
  const comDesconforto = finalizadas.filter((s) => s.encerramento?.desconforto?.sintomas?.length).length;

  const linhas = ordenadas.map((s) => {
    const enc = s.encerramento || {};
    const blocosComResposta = BLOCOS.filter((b) => s.respostas.some((r) => r.bloco === b));
    const apoiosResp = contar(s.respostas.map((r) => r.apoio || "independente").filter((n) => n !== "independente"));
    const apoiosBloco = contar(BLOCOS.flatMap((b) => s.blocos[b].apoios.map((a) => a.tipo)));
    const apoios = [listaContagem(apoiosResp, NIVEIS), listaContagem(apoiosBloco, APOIOS_BLOCO)].filter(Boolean).join("; ");
    return `<tr>
      <td>${dataBR(s.criadaEm)}</td>
      <td>${esc(s.objetivo)}</td>
      <td>${enc.participacao || (s.status === "ativa" ? "em andamento" : "—")}</td>
      <td>${esc(blocosComResposta.join(", ") || "—")}</td>
      <td>${esc(enc.resultadoDemonstrado || "—")}</td>
      <td>${esc(apoios || "—")}</td>
      <td>${esc(enc.continuidade || "—")}</td>
    </tr>`;
  }).join("");

  const porBloco = BLOCOS.map((b) => {
    const notas = ordenadas.filter((s) => s.blocos[b].notas).map((s) => `<li><b>${dataBR(s.criadaEm)}:</b> ${esc(s.blocos[b].notas)}</li>`).join("");
    const tent = ordenadas.reduce((n, s) => n + s.respostas.filter((r) => r.bloco === b).length, 0);
    const sem = ordenadas.reduce((n, s) => n + s.respostas.filter((r) => r.bloco === b && (r.apoio || "independente") === "independente").length, 0);
    if (!notas && !tent) return "";
    return `<h3>${b} · ${esc(NOMES_BLOCOS[b])}</h3>
      ${tent ? `<p>${tent} respostas registradas, ${sem} sem apoio.</p>` : ""}
      ${notas ? `<ul>${notas}</ul>` : ""}`;
  }).join("");

  const corpo = `
    <h1>Registro mensal — Método 5B</h1>
    <p class="sub">Sala 5B · documento do profissional</p>
    <div class="grade">
      <div><span>Pessoa atendida (código)</span>${esc(paciente)}</div>
      <div><span>Mês</span>${esc(mes.split("-").reverse().join("/"))}</div>
      <div><span>Encontros</span>${ordenadas.length} (${finalizadas.length} encerrados)</div>
    </div>

    <h2>Registro por encontro</h2>
    ${ordenadas.length ? `<table><thead><tr><th>Data</th><th>Objetivo / tarefa</th><th>Participação (1–5)</th><th>Blocos com registro</th><th>Resultado demonstrado</th><th>Apoios</th><th>Próximo ajuste</th></tr></thead><tbody>${linhas}</tbody></table>` : "<p>Nenhum encontro neste mês.</p>"}

    <h2>Análise do mês</h2>
    <ul>
      <li>Referência de participação mais frequente: ${modas.length ? modas.map((n) => `${n} — ${PARTICIPACAO[n]}`).join(" e ") + ` (${maxF} de ${niveis.length} encontros)` : "sem registros"}.</li>
      ${niveis.length > 1 ? `<li>Variação no mês: de ${Math.min(...niveis)} a ${Math.max(...niveis)}.</li>` : ""}
      <li>Respostas registradas: ${totalResp}, sendo ${semApoio} sem apoio.</li>
      <li>Encontros com desconforto relatado no óculos: ${comDesconforto} de ${finalizadas.length}.</li>
    </ul>
    <p style="font-size:12px;color:#5f6c72">A participação mais frequente não indica, sozinha, aprendizagem. Considere junto o resultado demonstrado em cada encontro.</p>

    ${porBloco ? `<h2>Evidências e ajustes por bloco</h2>${porBloco}` : ""}

    <p class="aviso">A referência de participação (1–5) descreve encontros e não classifica a pessoa. Os nomes dos blocos são simbólicos.
    Este registro organiza o acompanhamento e não substitui avaliação profissional.</p>`;
  return pagina(`Registro mensal ${paciente} ${mes}`, corpo);
}

module.exports = { encontroProfissional, encontroFamilia, mensal, mesDe };
