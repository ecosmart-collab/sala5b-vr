/* Painel do terapeuta — Sala 5B */
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const BLOCOS = { B1: "BioRegula", B2: "Botão de Partida", B3: "Bússola do Foco", B4: "Blindagem Neural", B5: "Boa Memória" };
const REF_MIN = { 40: { B1: 5, B2: 7, B3: 8, B4: 10, B5: 5 }, 60: { B1: 8, B2: 12, B3: 10, B4: 15, B5: 7 } };
const APOIOS = {
  demonstracao: "Demonstração",
  "instrucao-verbal": "Instrução verbal",
  "apoio-visual": "Apoio visual",
  "escolha-reduzida": "Escolha reduzida",
  "pausa-oferecida": "Pausa oferecida",
  outro: "Outro"
};
const CHECKINS = { calma: "Calma", cansaco: "Cansaço", agitacao: "Agitação", animacao: "Animação", "prefiro-nao-dizer": "Prefiro não dizer" };
const NIVEIS = {
  independente: "Independente",
  gestual: "Gestual",
  verbal: "Verbal",
  visual: "Visual",
  modelo: "Modelo",
  fisico: "Físico"
};
const TIPOS = { contagem: "Contagem", comparacao: "Comparação", soma: "Adição", cubo: "Cubo 2×2", palavra: "Palavra", categorias: "Categorias", alvos: "Alvos" };
const CATEGORIAS = { frutas: "frutas", bebidas: "bebidas", limpeza: "limpeza", padaria: "padaria" };

const fmt = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
const hora = (iso) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

// ---------------------------------------------------------------- navegação
$("#btn-sair").onclick = async () => {
  await fetch("/api/logout", { method: "POST" });
  location.href = "/login.html";
};
$("#btn-voltar").onclick = () => abrirLista();

function abrirLista() {
  history.replaceState(null, "", "/terapeuta");
  sairDaSala();
  $("#tela-sessao").hidden = true;
  $("#tela-lista").hidden = false;
  $("#btn-voltar").hidden = true;
  $("#topo-sessao").textContent = "";
  carregarLista();
}

async function carregarLista() {
  const r = await fetch("/api/sessoes");
  if (r.status === 401) return (location.href = "/login.html");
  const lista = await r.json();
  $("#lista-pacientes").innerHTML = [...new Set(lista.map((s) => s.paciente))].map((p) => `<option value="${esc(p)}"></option>`).join("");
  const tbody = $("#lista-sessoes");
  if (!lista.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="muted">Nenhum encontro ainda.</td></tr>`;
    return;
  }
  tbody.innerHTML = lista
    .map(
      (s) => `<tr>
        <td>${new Date(s.criadaEm).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</td>
        <td>${esc(s.paciente)}</td>
        <td>${esc(s.objetivo)}</td>
        <td>${s.acertos}/${s.respostas}</td>
        <td>${s.participacao ?? "—"}</td>
        <td>${s.status === "ativa" ? "<b>ativa</b>" : "finalizada"}</td>
        <td>
          ${s.status === "ativa" ? `<a href="#" data-abrir="${esc(s.codigo)}">Abrir</a>` : ""}
          <a href="/relatorios/encontro/${esc(s.codigo)}" target="_blank" rel="noopener">Relatório</a>
          <a href="/relatorios/encontro/${esc(s.codigo)}?versao=familia" target="_blank" rel="noopener">Família</a>
          <a href="/api/sessoes/${esc(s.codigo)}/json">JSON</a>
          <a href="/api/sessoes/${esc(s.codigo)}/csv">CSV</a>
        </td>
      </tr>`
    )
    .join("");
}

// Registro mensal
const formMensal = $("#form-mensal");
formMensal.mes.value = new Date().toISOString().slice(0, 7);
formMensal.addEventListener("submit", (e) => {
  e.preventDefault();
  const q = new URLSearchParams({ paciente: formMensal.paciente.value.trim(), mes: formMensal.mes.value });
  window.open("/relatorios/mensal?" + q, "_blank", "noopener");
});

$("#lista-sessoes").addEventListener("click", (e) => {
  const c = e.target.dataset?.abrir;
  if (c) {
    e.preventDefault();
    abrirSessao(c);
  }
});

$("#form-nova").addEventListener("submit", async (e) => {
  e.preventDefault();
  const dados = Object.fromEntries(new FormData(e.target));
  const r = await fetch("/api/sessoes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(dados) });
  const d = await r.json();
  if (d.ok) {
    e.target.reset();
    abrirSessao(d.codigo);
  } else alert(d.erro || "Não foi possível criar a sala");
});

// ---------------------------------------------------------------- sessão ao vivo
let socket = null;
let estado = null; // { sessao, resumo, pacientesConectados }
let recebidoEm = 0;
let timer = null;

function conectar() {
  if (socket) return socket;
  socket = io("/5b", { auth: { papel: "terapeuta" } });
  socket.on("connect_error", (err) => {
    if (err.message === "login-necessario") location.href = "/login.html";
  });
  socket.on("connect", () => {
    const c = new URLSearchParams(location.search).get("sala");
    if (c) socket.emit("abrir-sala", c, (r) => !r.ok && (alert(r.erro), abrirLista()));
  });
  socket.on("quadro", (dados) => {
    if (!espelhoLigado) return;
    ultimoQuadro = Date.now();
    $("#espelho-img").src = dados;
    $("#espelho-img").hidden = false;
    $("#espelho-vazio").hidden = true;
  });
  socket.on("estado", (e) => {
    estado = e;
    recebidoEm = Date.now();
    render();
  });
  return socket;
}

function sairDaSala() {
  clearInterval(timer);
  if (espelhoLigado) alternarEspelho(false);
  estado = null;
}

function abrirSessao(codigo) {
  history.replaceState(null, "", `/terapeuta?sala=${encodeURIComponent(codigo)}`);
  $("#tela-lista").hidden = true;
  $("#tela-sessao").hidden = false;
  $("#btn-voltar").hidden = false;
  const s = conectar();
  if (s.connected) s.emit("abrir-sala", codigo, (r) => !r.ok && (alert(r.erro), abrirLista()));
  clearInterval(timer);
  timer = setInterval(renderTempos, 1000);
}

const enviar = (evento, dados) =>
  new Promise((ok) => socket.emit(evento, dados, (r) => (r?.ok ? ok(r) : (r && r.erro !== "Comando inválido" && alert(r.erro), ok(r)))));

// Blocos
$("#blocos").innerHTML = Object.entries(BLOCOS)
  .map(([b, nome]) => `<button class="bloco" data-bloco="${b}"><b>${b}</b><span>${nome}</span><span class="t" data-t="${b}">00:00</span><span class="ref" data-ref="${b}"></span></button>`)
  .join("");
$("#blocos").addEventListener("click", (e) => {
  const b = e.target.closest("[data-bloco]")?.dataset.bloco;
  if (b) enviar("bloco", b);
});
document.addEventListener("click", (e) => {
  const tipo = e.target.closest("[data-pausa]")?.dataset.pausa;
  if (tipo && estado && !estado.sessao.pausa) enviar("pausa", { ativa: true, tipo });
});
$("#btn-retomar").onclick = () => enviar("pausa", { ativa: false });

// Óculos: limite e aviso
$("#oculos-limite").onchange = (e) => enviar("oculos-config", { limiteMin: Number(e.target.value) });
$("#oculos-aviso-paciente").onchange = (e) => enviar("oculos-config", { avisoNoOculos: e.target.checked });

// Espelho ao vivo: pede quadros enquanto ligado (renova a cada 4 s); nada é gravado
const TEXTO_ESPELHO_OFF = "Desligado. Mostra o que a pessoa vê (cerca de 1,5 quadro por segundo). Nada é gravado.";
let espelhoLigado = false;
let espelhoT = null;
let ultimoQuadro = 0;
function mostrarAvisoEspelho(txt) {
  $("#espelho-img").hidden = true;
  $("#espelho-vazio").hidden = false;
  $("#espelho-vazio").textContent = txt;
}
function pedirEspelho() {
  if (socket) socket.emit("espelho", espelhoLigado);
  if (espelhoLigado && Date.now() - ultimoQuadro > 6000) {
    mostrarAvisoEspelho(estado?.pacientesConectados ? "Aguardando imagem do óculos…" : "Óculos não conectado.");
  }
}
function alternarEspelho(ligar) {
  espelhoLigado = ligar;
  clearInterval(espelhoT);
  ultimoQuadro = 0;
  pedirEspelho();
  if (ligar) espelhoT = setInterval(pedirEspelho, 4000);
  $("#btn-espelho").textContent = ligar ? "Desligar espelho" : "Ligar espelho";
  $("#btn-espelho").classList.toggle("on", ligar);
  if (!ligar) mostrarAvisoEspelho(TEXTO_ESPELHO_OFF);
}
$("#btn-espelho").onclick = () => alternarEspelho(!espelhoLigado);

// Cena
$("#cena-respiracao").onchange = (e) => enviar("cena", { respiracao: e.target.checked });
$("#btn-checkin").onclick = () => enviar("cena", { checkin: true });
let ruidoT;
$("#cena-ruido").oninput = (e) => {
  $("#ruido-val").textContent = e.target.value + "%";
  clearTimeout(ruidoT);
  ruidoT = setTimeout(() => enviar("cena", { ruido: e.target.value / 100 }), 150);
};

// Atividades
const formAt = $("#form-atividade");
function mostrarCamposTipo() {
  const tipo = formAt.tipo.value;
  formAt.querySelectorAll("[data-tipo]").forEach((el) => (el.hidden = !el.dataset.tipo.split(" ").includes(tipo)));
}
formAt.tipo.onchange = mostrarCamposTipo;
mostrarCamposTipo();

formAt.addEventListener("submit", (e) => {
  e.preventDefault();
  const f = new FormData(formAt);
  const cfg = {
    tipo: f.get("tipo"), max: f.get("max"), numOpcoes: f.get("numOpcoes"), pergunta: f.get("pergunta"),
    profundidade: f.get("profundidade"), numMov: f.get("numMov"), mapa: f.get("mapa") === "on", destacar: f.get("destacar") === "on",
    palavras: f.get("palavras"), unidade: f.get("unidade"), arranjo: f.get("arranjo"), falar: f.get("falar") === "on",
    limiteResposta: Number(f.get("limiteResposta")),
    tamanho: Number(f.get("tamanho")),
    categoria: f.get("categoria"), meta: Number(f.get("meta")), distratores: Number(f.get("distratores")),
    nomes: f.get("nomes") === "on", trocarRegra: f.get("trocarRegra") === "on", levar: f.get("levar") === "on",
    qtdAlvos: Number(f.get("qtdAlvos")), tamanhoAlvo: f.get("tamanhoAlvo"), area: f.get("area")
  };
  if (cfg.tipo === "palavra" && !/[A-Za-zÀ-ÿ]/.test(cfg.palavras || "")) {
    alert("Digite ao menos uma palavra (só letras; use hífen para separar sílabas).");
    return;
  }
  for (const k of ["n", "a", "b"]) {
    const campo = formAt.querySelector(`[name=${k}]`);
    if (!campo.closest("label").hidden && f.get(k) !== "") cfg[k] = Number(f.get(k));
  }
  enviar("atividade", cfg);
});
$("#btn-limpar").onclick = () => enviar("limpar-atividade");
$("#auto-proxima").onchange = (e) => enviar("auto-proxima", e.target.checked);

// Apoio da próxima resposta (hierarquia) e correção da última
$("#niveis-apoio").innerHTML = Object.entries(NIVEIS).map(([k, v]) => `<button data-nivel="${k}">${v}</button>`).join("");
$("#niveis-apoio").addEventListener("click", (e) => {
  const nivel = e.target.closest("[data-nivel]")?.dataset.nivel;
  if (nivel) enviar("apoio-resposta", { nivel });
});
$("#apoio-voltar").onchange = (e) => enviar("apoio-resposta", { voltar: e.target.checked });
$("#apoio-ultima").innerHTML = Object.entries(NIVEIS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
$("#apoio-ultima").onchange = (e) => enviar("apoio-corrigir", { nivel: e.target.value });

// Resposta pelo olhar
$("#cena-olhar").onchange = (e) => enviar("cena", { olhar: e.target.checked });
$("#cena-contraste").onchange = (e) => enviar("cena", { contraste: e.target.checked });
$("#olhar-seg").onchange = (e) => enviar("cena", { olharSeg: Number(e.target.value) });

// Apoios
$("#apoios").innerHTML = Object.entries(APOIOS)
  .map(([k, v]) => `<button data-apoio="${k}" title="Registrar apoio oferecido neste bloco">${v}<span class="n" data-n="${k}"></span></button>`)
  .join("");
$("#apoios").addEventListener("click", (e) => {
  const tipo = e.target.closest("[data-apoio]")?.dataset.apoio;
  if (!tipo) return;
  const nota = tipo === "outro" ? prompt("Descreva o apoio:") || "" : "";
  enviar("apoio", { tipo, nota });
});

// Notas do bloco (salvamento automático)
let notasT;
$("#notas-bloco").addEventListener("input", (e) => {
  clearTimeout(notasT);
  $("#salvo-notas").textContent = "…";
  const bloco = estado?.sessao.blocoAtual;
  notasT = setTimeout(async () => {
    await enviar("notas", { bloco, texto: e.target.value });
    $("#salvo-notas").textContent = "Salvo " + new Date().toLocaleTimeString("pt-BR");
  }, 700);
});

// Encerramento
$("#btn-encerrar").onclick = () => $("#dlg-encerrar").showModal();
$("#form-encerrar").addEventListener("submit", async (e) => {
  if (e.submitter?.value !== "ok") return;
  const fd = new FormData(e.target);
  const dados = Object.fromEntries(fd);
  dados.sintomas = fd.getAll("sintomas");
  dados.desconfortoNenhum = fd.get("desconfortoNenhum") === "on";
  dados.desconfortoPerguntado = dados.desconfortoNenhum || dados.sintomas.length > 0;
  if (!dados.desconfortoPerguntado) {
    e.preventDefault(); // mantém o diálogo aberto
    $("#erro-desconforto").hidden = false;
    return;
  }
  $("#erro-desconforto").hidden = true;
  const r = await enviar("finalizar", dados);
  if (r?.ok) {
    $("#form-encerrar").reset();
    alert(`Encontro ${r.codigo} salvo.`);
    abrirLista();
  }
});

// ---------------------------------------------------------------- render
let blocoRenderizado = null;

function render() {
  if (!estado) return;
  const { sessao: s, pacientesConectados } = estado;
  $("#topo-sessao").textContent = `${s.paciente} · ${s.objetivo}`;
  $("#codigo-sala").textContent = s.codigo;
  const link = `${location.origin}/paciente.html?sala=${s.codigo}`;
  $("#link-paciente").textContent = link;

  const st = $("#status-paciente");
  st.textContent = pacientesConectados ? "Óculos conectado" : "Aguardando óculos…";
  st.classList.toggle("on", pacientesConectados > 0);

  document.querySelectorAll(".bloco").forEach((el) => el.classList.toggle("ativo", el.dataset.bloco === s.blocoAtual));
  $("#pausas").hidden = s.pausa;
  $("#btn-retomar").hidden = !s.pausa;
  const o = estado.resumo.oculos;
  if (document.activeElement !== $("#oculos-limite")) $("#oculos-limite").value = String(o.limiteMin);
  $("#oculos-aviso-paciente").checked = o.avisoNoOculos;
  $("#oculos-vr").textContent = o.emVR ? "EM VR" : pacientesConectados ? "TELA" : "";

  $("#cena-respiracao").checked = s.cena.respiracao;
  $("#cena-olhar").checked = Boolean(s.cena.olhar);
  $("#cena-contraste").checked = Boolean(s.cena.contraste);
  if (document.activeElement !== $("#olhar-seg")) $("#olhar-seg").value = String(s.cena.olharSeg || 2);
  const ap = s.apoioResposta || { nivel: "independente", voltar: true };
  document.querySelectorAll("[data-nivel]").forEach((b) => b.classList.toggle("on", b.dataset.nivel === ap.nivel));
  $("#apoio-voltar").checked = ap.voltar;
  const ultima = s.respostas[s.respostas.length - 1];
  $("#apoio-ultima-wrap").hidden = !ultima;
  if (ultima && document.activeElement !== $("#apoio-ultima")) $("#apoio-ultima").value = ultima.apoio || "independente";
  $("#auto-proxima").checked = s.autoProxima;
  if (document.activeElement !== $("#cena-ruido")) {
    $("#cena-ruido").value = Math.round(s.cena.ruido * 100);
    $("#ruido-val").textContent = Math.round(s.cena.ruido * 100) + "%";
  }
  $("#btn-checkin").textContent = s.cena.checkin ? "Check-in na tela…" : "Pedir check-in (palavras e cores)";

  const at = s.atividadeAtual;
  $("#atividade-atual").textContent = !at
    ? "Nenhuma atividade na tela."
    : at.tipo === "alvos"
      ? `Na tela: Alvos · ${at.alvos.atual}/${at.alvos.pontos.length} acertados · ${at.alvos.fora} toque(s) fora${at.resolvida ? " · concluído" : ""}`
    : at.tipo === "categorias"
      ? `Na tela: Categorias · ${CATEGORIAS[at.params.categoria]} · ${at.categorias.coletados.length}/${at.params.meta} no carrinho · ${at.params.distratores} de outras categorias${at.params.levar ? " · levando ao carrinho" : ""}${at.resolvida ? " · concluída" : ""}`
    : at.tipo === "palavra"
      ? `Na tela: Palavra ${at.params.palavra} (${at.params.indice + 1}/${at.params.totalLista}) · ${at.palavra.progresso}/${at.palavra.unidades.length} peças${at.resolvida ? " · concluída" : ""}`
    : at.tipo === "cubo"
      ? `Na tela: Cubo 2×2 · começou a ${at.cubo.distInicial} giros · ${at.cubo.passos} giros feitos${at.resolvida ? " · resolvido" : ""}`
      : `Na tela: ${TIPOS[at.tipo]} ${JSON.stringify(at.params)} · resposta ${at.correta}${at.resolvida ? " · concluída" : ""}`;

  // Registro do bloco atual
  const b = s.blocoAtual;
  $("#reg-bloco").textContent = `${b} · ${BLOCOS[b]}`;
  if (blocoRenderizado !== b || document.activeElement !== $("#notas-bloco")) $("#notas-bloco").value = s.blocos[b].notas;
  if (blocoRenderizado !== b) $("#salvo-notas").textContent = "";
  blocoRenderizado = b;
  const cont = {};
  s.blocos[b].apoios.forEach((a) => (cont[a.tipo] = (cont[a.tipo] || 0) + 1));
  document.querySelectorAll("[data-n]").forEach((el) => (el.textContent = cont[el.dataset.n] ? "×" + cont[el.dataset.n] : ""));

  // Métricas do bloco atual
  const rb = estado.resumo.porBloco[b];
  const tempos = s.respostas.filter((r) => r.bloco === b && r.correta).map((r) => r.tempoMs);
  const medio = tempos.length ? (tempos.reduce((x, y) => x + y, 0) / tempos.length / 1000).toFixed(1) + "s" : "—";
  $("#metricas").innerHTML = `
    <div><strong>${rb.acertos}</strong><span>acertos</span></div>
    <div><strong>${rb.tentativas - rb.acertos}</strong><span>outras respostas</span></div>
    <div><strong>${medio}</strong><span>tempo médio</span></div>
    <div><strong>${rb.independentes ?? rb.tentativas}/${rb.tentativas}</strong><span>sem apoio</span></div>
    <div><strong>${rb.omissoes || 0}</strong><span>sem resposta</span></div>`;

  renderLog(s);
  renderTempos();
}

function renderTempos() {
  if (!estado) return;
  const { sessao: s, resumo } = estado;
  const delta = Date.now() - recebidoEm;

  // Óculos: extrapola o tempo entre atualizações do servidor
  const o = resumo.oculos;
  const extra = o.emUso ? delta : 0;
  const continuo = o.emUso || o.paradoMs + delta < 60000 ? o.continuoMs + extra : 0;
  $("#oculos-continuo").textContent = fmt(continuo);
  $("#oculos-total").textContent = fmt(o.totalMs + extra);
  const alerta = continuo >= o.limiteMin * 60000;
  document.querySelector(".oculos").classList.toggle("alto", alerta);
  $("#alerta-oculos").hidden = !alerta || s.pausa;
  $("#alerta-texto").textContent = o.limiteMin + " min contínuos no óculos.";
  if (s.pausa) {
    const onde = s.pausaTipo === "fora" ? "fora do óculos" : "no óculos";
    $("#btn-retomar").textContent = "Retomar (pausa " + onde + " · " + fmt(Date.now() - s.pausaDesde) + ")";
  }
  const ref = REF_MIN[s.duracaoMin] || REF_MIN[40];
  for (const b of Object.keys(BLOCOS)) {
    let ms = resumo.porBloco[b].tempoMs;
    if (s.status === "ativa" && !s.pausa && s.blocoAtual === b) ms += delta;
    const el = document.querySelector(`[data-t="${b}"]`);
    el.textContent = fmt(ms);
    el.closest(".bloco").classList.toggle("passou", ms > ref[b] * 60000);
    document.querySelector(`[data-ref="${b}"]`).textContent = `referência ~${ref[b]} min`;
  }
}

function renderLog(s) {
  const extraResp = (r) => {
    const partes = [];
    if (r.apoio && r.apoio !== "independente") partes.push("apoio " + NIVEIS[r.apoio].toLowerCase() + (r.apoioCorrigido ? "*" : ""));
    if (r.modo === "olhar") partes.push("pelo olhar");
    return partes.length ? " · " + partes.join(" · ") : "";
  };
  const itens = [
    ...s.eventos.map((e) => ({ ts: e.ts, txt: textoEvento(e), cls: "" })),
    ...s.respostas.map((r) => ({
      ts: r.ts,
      txt: r.tipo === "alvos"
        ? `${r.bloco} Alvos: ${r.valor} (${r.detalhe}, ${(r.tempoMs / 1000).toFixed(1)}s)`
        : r.tipo === "categorias"
        ? `${r.bloco} Categorias: tocou ${r.valor} (${r.detalhe}, ${r.correta ? "certo" : "outra categoria"}, ${(r.tempoMs / 1000).toFixed(1)}s)`
        : r.tipo === "palavra"
        ? `${r.bloco} Palavra ${r.params.palavra}: tocou ${r.valor} (${r.detalhe}, ${r.correta ? "certo" : "outra"}, ${(r.tempoMs / 1000).toFixed(1)}s)`
        : r.tipo === "cubo"
        ? `${r.bloco} Cubo: giro ${r.valor} (${r.detalhe}, ${r.correta ? "aproximou" : "afastou"}, ${(r.tempoMs / 1000).toFixed(1)}s)`
        : `${r.bloco} ${TIPOS[r.tipo]}: respondeu ${r.valor} (${r.correta ? "correta" : "outra"}, tentativa ${r.tentativa}, ${(r.tempoMs / 1000).toFixed(1)}s)`,
      cls: r.correta ? "ok" : "erro",
      extra: extraResp(r)
    })),
    ...(s.omissoes || []).map((o) => ({ ts: o.ts, txt: `${o.bloco} ${TIPOS[o.tipo]}: sem resposta em ${o.segundos} s (omissão)`, cls: "erro" })),
    ...s.checkins.map((c) => ({ ts: c.ts, txt: `Check-in: ${CHECKINS[c.valor] || c.valor}`, cls: "ok" })),
    ...Object.entries(s.blocos).flatMap(([b, d]) => d.apoios.map((a) => ({ ts: a.ts, txt: `${b} apoio: ${APOIOS[a.tipo]}${a.nota ? " — " + a.nota : ""}`, cls: "" })))
  ]
    .sort((a, b) => a.ts.localeCompare(b.ts))
    .slice(-80);
  const log = $("#log");
  const noFim = log.scrollTop + log.clientHeight >= log.scrollHeight - 10;
  log.innerHTML = itens.map((i) => `<li class="${i.cls}">[${hora(i.ts)}] ${esc(i.txt + (i.extra || ""))}</li>`).join("");
  if (noFim) log.scrollTop = log.scrollHeight;
}

function textoEvento(e) {
  switch (e.tipo) {
    case "sessao_criada": return "Sala criada";
    case "bloco": return `Bloco ${e.detalhe.para} · ${BLOCOS[e.detalhe.para]}`;
    case "pausa_inicio": return e.detalhe?.tipo === "fora" ? "Pausa para tirar o óculos" : "Pausa no óculos";
    case "aviso_tempo_oculos": return "Aviso: " + e.detalhe.minutos + " min contínuos no óculos";
    case "entrou_vr": return "Entrou no modo VR";
    case "troca_regra": return `Troca de regra: de ${CATEGORIAS[e.detalhe.de]} para ${CATEGORIAS[e.detalhe.para]}`;
    case "saiu_vr": return "Saiu do modo VR";
    case "pausa_fim": return "Retomada";
    case "atividade_enviada": return `${e.bloco} atividade: ${TIPOS[e.detalhe.tipo]} ${JSON.stringify(e.detalhe.params)}`;
    case "paciente_conectou": return "Óculos conectou";
    case "paciente_desconectou": return "Óculos desconectou";
    default: return e.tipo;
  }
}

// ---------------------------------------------------------------- início
const salaInicial = new URLSearchParams(location.search).get("sala");
if (salaInicial) abrirSessao(salaInicial);
else abrirLista();
