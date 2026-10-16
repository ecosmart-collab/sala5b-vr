// Tempo real da Sala 5B (namespace Socket.IO "/5b").
// Terapeuta: autenticado pelo cookie de login, controla a sala.
// Paciente: entra só com o código da sala ativa; envia respostas, não lê dados.
const { BLOCOS } = require("./sessoes");
const oculos = require("./oculos");
const { gerarAtividade, paraPaciente, corrigir, moverCubo, tocarPeca, tocarItem, tocarAlvo } = require("./atividades");

const CHECKINS = ["calma", "cansaco", "agitacao", "animacao", "prefiro-nao-dizer"];
// Hierarquia de apoio registrada em cada resposta (do menor para o maior)
const NIVEIS_APOIO = ["independente", "gestual", "verbal", "visual", "modelo", "fisico"];
const MODOS_RESPOSTA = ["apontar", "olhar"];
const garantirApoio = (s) => (s.apoioResposta ||= { nivel: "independente", voltar: true });

const APOIOS = ["demonstracao", "instrucao-verbal", "apoio-visual", "escolha-reduzida", "pausa-oferecida", "outro"];

function registrarSocket5b(io, store, auth) {
  const nsp = io.of("/5b");

  nsp.use((socket, next) => {
    const terapeuta = auth.terapeutaDoHeader(socket.handshake.headers.cookie);
    const { papel, sala } = socket.handshake.auth || {};
    if (papel === "terapeuta") {
      if (!terapeuta) return next(new Error("login-necessario"));
      socket.data.papel = "terapeuta";
      return next();
    }
    const s = store.obterAtiva(String(sala || "").toUpperCase());
    if (!s) return next(new Error("sala-invalida"));
    socket.data.papel = "paciente";
    socket.data.sala = s.codigo;
    next();
  });

  const salaTerapeuta = (c) => `t:${c}`;
  const salaPaciente = (c) => `p:${c}`;

  async function pacientesConectados(codigo) {
    return (await nsp.in(salaPaciente(codigo)).fetchSockets()).length;
  }

  // Conexões de paciente por sala (síncrono, para o cronômetro do óculos)
  const conectados = new Map();
  const temPaciente = (codigo) => (conectados.get(codigo) || 0) > 0;

  // Aviso de tempo contínuo no óculos (verifica a cada 10 s)
  setInterval(() => {
    for (const s of store.ativasLista()) {
      const o = oculos.garantir(s);
      const r = oculos.resumo(s);
      if (r.alerta && !o.avisado) {
        o.avisado = true;
        store.evento(s, "aviso_tempo_oculos", { minutos: o.limiteMin });
        publicar(s);
      }
    }
  }, 10000).unref();

  // Omissão: nenhuma resposta dentro do tempo limite da atividade (com a pessoa conectada e fora de pausa).
  // Depois de registrar, a contagem recomeça; respostas, pausas e reconexões também recomeçam a espera.
  setInterval(() => {
    const agora = Date.now();
    for (const s of store.ativasLista()) {
      const at = s.atividadeAtual;
      if (!at || !at.limiteMs || at.resolvida || s.pausa || !temPaciente(s.codigo)) continue;
      if (!at.esperaDesde) at.esperaDesde = agora;
      if (agora - at.esperaDesde < at.limiteMs) continue;
      at.esperaDesde = agora;
      (s.omissoes ||= []).push({
        ts: new Date(agora).toISOString(),
        bloco: s.blocoAtual,
        atividadeId: at.id,
        tipo: at.tipo,
        params: at.params,
        segundos: at.limiteMs / 1000
      });
      publicar(s);
    }
  }, 1000).unref();

  // Quadros do espelho: só texto data:image/jpeg pequeno; não são gravados
  const QUADRO_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;

  function estadoPaciente(s) {
    const concluidas = s.atividades.filter((a) => a.resolvida);
    return {
      bloco: s.blocoAtual,
      pausa: s.pausa,
      pausaTipo: s.pausaTipo || "dentro",
      avisoPausa: (() => {
        const r = oculos.resumo(s);
        return r.alerta && r.avisoNoOculos && !s.pausa;
      })(),
      cena: s.cena,
      atividade: s.atividadeAtual ? { ...paraPaciente(s.atividadeAtual), resolvida: Boolean(s.atividadeAtual.resolvida) } : null,
      fechamento:
        s.blocoAtual === "B5"
          ? {
              atividades: new Set(s.respostas.map((r) => r.atividadeId)).size,
              concluidas: concluidas.length,
              tipos: [...new Set(concluidas.map((a) => a.tipo))],
              palavras: concluidas.filter((a) => a.tipo === "palavra").map((a) => a.params.palavra.replace(/-/g, ""))
            }
          : null
    };
  }

  async function publicar(s) {
    nsp.to(salaPaciente(s.codigo)).emit("estado", estadoPaciente(s));
    nsp.to(salaTerapeuta(s.codigo)).emit("estado", {
      sessao: s,
      resumo: store.resumo(s),
      pacientesConectados: await pacientesConectados(s.codigo)
    });
    store.gravar(s);
  }

  function enviarAtividade(s, cfg) {
    // "Anterior" = a que está na tela ou a última limpa (troca de bloco/limpar), para a troca de regra
    const at = gerarAtividade(cfg, s.atividadeAtual || s.atividadeAnterior);
    if (!at) return false;
    at.bloco = s.blocoAtual;
    at.enviadaEm = Date.now();
    at.esperaDesde = at.enviadaEm;
    s.ultimaConfig = cfg;
    s.atividadeAtual = at;
    s.atividadeAnterior = null;
    s.atividades.push({ id: at.id, ts: new Date().toISOString(), bloco: at.bloco, tipo: at.tipo, params: at.params, apoios: at.apoios });
    return true;
  }

  nsp.on("connection", (socket) => {
    // ---------------- PACIENTE ----------------
    if (socket.data.papel === "paciente") {
      const codigo = socket.data.sala;
      socket.join(salaPaciente(codigo));
      conectados.set(codigo, (conectados.get(codigo) || 0) + 1);
      const s0 = store.obterAtiva(codigo);
      if (s0) {
        store.evento(s0, "paciente_conectou");
        oculos.atualizar(s0, true);
        if (s0.atividadeAtual) s0.atividadeAtual.esperaDesde = Date.now();
        publicar(s0);
      }

      socket.on("xr", (emVR) => {
        const s = store.obterAtiva(codigo);
        if (!s) return;
        const o = oculos.garantir(s);
        if (o.emVR === Boolean(emVR)) return; // só registra mudanças reais
        o.emVR = Boolean(emVR);
        store.evento(s, emVR ? "entrou_vr" : "saiu_vr");
        publicar(s);
      });

      socket.on("quadro", (dados) => {
        if (typeof dados !== "string" || dados.length > 150000 || !QUADRO_RE.test(dados)) return;
        nsp.to(salaTerapeuta(codigo)).volatile.emit("quadro", dados);
      });

      socket.on("resposta", ({ atividadeId, valor, modo } = {}) => {
        const s = store.obterAtiva(codigo);
        const at = s?.atividadeAtual;
        if (!at || at.id !== atividadeId || at.resolvida || s.pausa) return;
        const tentativa = s.respostas.filter((r) => r.atividadeId === at.id).length + 1;
        const ap = garantirApoio(s);
        const registro = {
          ts: new Date().toISOString(), bloco: s.blocoAtual, atividadeId: at.id, tipo: at.tipo, params: at.params, valor: String(valor), tentativa,
          apoio: ap.nivel,
          modo: MODOS_RESPOSTA.includes(modo) ? modo : "apontar"
        };
        const qtdAntes = s.respostas.length;

        let correta;
        if (at.tipo === "cubo") {
          // Cada giro é uma resposta: "correta" = aproximou da solução no grafo de estados
          const passo = moverCubo(at, String(valor));
          if (!passo) return;
          correta = passo.aproximou;
          s.respostas.push({ ...registro, correta, tempoMs: passo.tempoMs, detalhe: `distância ${passo.de}→${passo.para}` });
        } else if (at.tipo === "alvos") {
          // Aquecimento: "correta" = acertou o círculo; "fora" = toque fora (laser/mouse)
          const toque = tocarAlvo(at, String(valor));
          if (!toque) return;
          correta = toque.correta;
          s.respostas.push({
            ...registro,
            valor: toque.correta ? `alvo ${toque.indice}` : "fora do alvo",
            correta,
            tempoMs: toque.tempoMs,
            detalhe: toque.correta ? `alvo ${toque.indice}/${at.alvos.pontos.length}, ${toque.foraNoAlvo} toque(s) fora antes` : `fora, procurando o alvo ${toque.indice}`
          });
        } else if (at.tipo === "categorias") {
          // Cada toque é uma resposta: certo = item da categoria pedida
          const toque = tocarItem(at, String(valor));
          if (!toque) return;
          correta = toque.correta;
          s.respostas.push({ ...registro, valor: toque.nome, correta, tempoMs: toque.tempoMs, detalhe: `item de ${toque.categoria}, pedido ${at.categorias.alvo}${at.categorias.levar ? ", levado ao carrinho" : ""}` });
        } else if (at.tipo === "palavra") {
          // Cada toque é uma resposta: certo = a peça tocada é a próxima da palavra
          const toque = tocarPeca(at, String(valor));
          if (!toque) return;
          correta = toque.correta;
          s.respostas.push({ ...registro, valor: toque.texto, correta, tempoMs: toque.tempoMs, detalhe: `posição ${toque.posicao}, esperado ${toque.esperado}` });
        } else {
          if (!at.publico.opcoes.map(String).includes(String(valor))) return;
          correta = corrigir(at, valor);
          s.respostas.push({ ...registro, correta, tempoMs: Date.now() - at.enviadaEm });
          if (correta) at.resolvida = true;
        }

        if (s.respostas.length > qtdAntes && ap.voltar) ap.nivel = "independente";
        if (s.respostas.length > qtdAntes) at.esperaDesde = Date.now();

        if (at.resolvida) {
          const reg = s.atividades.find((a) => a.id === at.id);
          if (reg) reg.resolvida = true;
          if (s.autoProxima && s.ultimaConfig) {
            const id = at.id;
            setTimeout(() => {
              const atual = store.obterAtiva(codigo);
              if (atual && atual.atividadeAtual?.id === id && !atual.pausa) {
                // Próxima varia os números (valores fixados valem só para a atividade enviada à mão)
                let prox;
                if (atual.ultimaConfig.tipo === "palavra") {
                  const i = (Number(atual.ultimaConfig.indice) || 0) + 1;
                  if (i >= at.params.totalLista) return; // lista terminou
                  prox = { ...atual.ultimaConfig, indice: i };
                } else {
                  const { n, a, b, ...cfgLivre } = atual.ultimaConfig;
                  prox = cfgLivre;
                }
                enviarAtividade(atual, prox);
                atual.ultimaConfig = { ...prox };
                publicar(atual);
              }
            }, 2500);
          }
        } else if (!["cubo", "palavra", "categorias", "alvos"].includes(at.tipo)) {
          // Opção escolhida some (reduz escolhas), mantendo pelo menos 2 visíveis
          at.removidas = at.removidas || [];
          const restantes = at.publico.opcoes.length - at.removidas.length;
          if (restantes > 2) at.removidas.push(String(valor));
        }
        socket.emit("retorno", { atividadeId: at.id, valor: String(valor), correta });
        publicar(s);
      });

      socket.on("checkin", (valor) => {
        const s = store.obterAtiva(codigo);
        if (!s || !CHECKINS.includes(valor)) return;
        s.checkins.push({ ts: new Date().toISOString(), bloco: s.blocoAtual, valor });
        s.cena.checkin = false;
        publicar(s);
      });

      socket.on("disconnect", () => {
        conectados.set(codigo, Math.max(0, (conectados.get(codigo) || 1) - 1));
        const s = store.obterAtiva(codigo);
        if (!s) return;
        store.evento(s, "paciente_desconectou");
        if (!temPaciente(codigo)) oculos.garantir(s).emVR = false;
        oculos.atualizar(s, temPaciente(codigo));
        publicar(s);
      });
      return;
    }

    // ---------------- TERAPEUTA ----------------
    let codigo = null;
    const sessao = () => (codigo ? store.obterAtiva(codigo) : null);

    // Revalida o login a cada comando (cookie pode ter expirado com o socket aberto)
    socket.use((_pkt, next) => (auth.terapeutaDoHeader(socket.handshake.headers.cookie) ? next() : next(new Error("login-necessario"))));
    socket.on("error", () => socket.disconnect(true));

    socket.on("abrir-sala", (c, ack) => {
      const s = store.obterAtiva(String(c || "").toUpperCase());
      if (!s) return ack?.({ ok: false, erro: "Sessão não encontrada ou já finalizada" });
      if (codigo) socket.leave(salaTerapeuta(codigo));
      codigo = s.codigo;
      socket.join(salaTerapeuta(codigo));
      ack?.({ ok: true });
      publicar(s);
    });

    const comando = (nome, fn) =>
      socket.on(nome, (dados, ack) => {
        const s = sessao();
        if (!s) return ack?.({ ok: false, erro: "Nenhuma sessão aberta" });
        const r = fn(s, dados);
        if (r === false) return ack?.({ ok: false, erro: "Comando inválido" });
        ack?.({ ok: true });
        publicar(s);
      });

    comando("bloco", (s, b) => {
      if (!BLOCOS.includes(b) || b === s.blocoAtual) return false;
      store.fecharTempo(s);
      store.evento(s, "bloco", { de: s.blocoAtual, para: b });
      s.blocoAtual = b;
      if (s.atividadeAtual) s.atividadeAnterior = s.atividadeAtual;
      s.atividadeAtual = null;
    });

    // Pausa: true/false ou { ativa, tipo: "dentro" (fica no óculos) | "fora" (tirar o óculos) }
    comando("pausa", (s, d) => {
      const ativa = typeof d === "object" && d !== null ? Boolean(d.ativa) : Boolean(d);
      const tipo = d && d.tipo === "fora" ? "fora" : "dentro";
      if (ativa === s.pausa) return false;
      store.fecharTempo(s);
      s.pausa = ativa;
      s.pausaTipo = ativa ? tipo : null;
      s.pausaDesde = ativa ? Date.now() : null;
      store.evento(s, ativa ? "pausa_inicio" : "pausa_fim", ativa ? { tipo } : undefined);
      if (!ativa && s.atividadeAtual) s.atividadeAtual.esperaDesde = Date.now();
      oculos.atualizar(s, temPaciente(s.codigo));
    });

    comando("oculos-config", (s, d = {}) => {
      const o = oculos.garantir(s);
      if ("limiteMin" in d) {
        const m = Number(d.limiteMin);
        if (![10, 15, 20, 25, 30, 40].includes(m)) return false;
        o.limiteMin = m;
        o.avisado = oculos.resumo(s).alerta; // não repete aviso já passado; avisa ao cruzar o novo limite
      }
      if ("avisoNoOculos" in d) o.avisoNoOculos = Boolean(d.avisoNoOculos);
    });

    // Espelho: o painel renova o pedido a cada poucos segundos; o óculos para sozinho sem renovação
    socket.on("espelho", (ativo) => {
      const s = sessao();
      if (s) nsp.to(salaPaciente(s.codigo)).emit("espelho", { ativo: Boolean(ativo) });
    });

    comando("cena", (s, d = {}) => {
      if ("respiracao" in d) s.cena.respiracao = Boolean(d.respiracao);
      if ("checkin" in d) s.cena.checkin = Boolean(d.checkin);
      if ("ruido" in d) s.cena.ruido = Math.min(1, Math.max(0, Number(d.ruido) || 0));
      if ("olhar" in d) s.cena.olhar = Boolean(d.olhar);
      if ("contraste" in d) s.cena.contraste = Boolean(d.contraste);
      if ("olharSeg" in d) {
        const seg = Number(d.olharSeg);
        if (![1, 1.5, 2, 3].includes(seg)) return false;
        s.cena.olharSeg = seg;
      }
    });

    comando("atividade", (s, cfg) => {
      if (!enviarAtividade(s, cfg || {})) return false;
      const tr = s.atividadeAtual.params && s.atividadeAtual.params.trocaDe;
      if (tr) store.evento(s, "troca_regra", { de: tr, para: s.atividadeAtual.params.categoria });
      store.evento(s, "atividade_enviada", { tipo: s.atividadeAtual.tipo, params: s.atividadeAtual.params });
    });

    comando("limpar-atividade", (s) => {
      if (s.atividadeAtual) s.atividadeAnterior = s.atividadeAtual;
      s.atividadeAtual = null;
    });

    comando("auto-proxima", (s, v) => {
      s.autoProxima = Boolean(v);
    });

    comando("apoio", (s, d = {}) => {
      if (!APOIOS.includes(d.tipo)) return false;
      s.blocos[s.blocoAtual].apoios.push({ ts: new Date().toISOString(), tipo: d.tipo, nota: String(d.nota || "").slice(0, 300) });
    });

    // Nível de apoio da próxima resposta; "voltar" = retorna a independente após cada resposta
    comando("apoio-resposta", (s, d = {}) => {
      const ap = garantirApoio(s);
      if ("nivel" in d) {
        if (!NIVEIS_APOIO.includes(d.nivel)) return false;
        ap.nivel = d.nivel;
      }
      if ("voltar" in d) ap.voltar = Boolean(d.voltar);
    });

    // Corrige o apoio registrado na última resposta (ex.: o profissional ajudou e esqueceu de marcar antes)
    comando("apoio-corrigir", (s, d = {}) => {
      const r = s.respostas[s.respostas.length - 1];
      if (!r || !NIVEIS_APOIO.includes(d.nivel)) return false;
      r.apoio = d.nivel;
      r.apoioCorrigido = true;
    });

    comando("notas", (s, d = {}) => {
      if (!BLOCOS.includes(d.bloco)) return false;
      s.blocos[d.bloco].notas = String(d.texto || "").slice(0, 3000);
    });

    socket.on("finalizar", (enc, ack) => {
      const s = sessao();
      if (!s) return ack?.({ ok: false, erro: "Nenhuma sessão aberta" });
      store.finalizar(s, enc);
      nsp.to(salaPaciente(s.codigo)).emit("encerrada");
      nsp.in(salaPaciente(s.codigo)).disconnectSockets(true);
      ack?.({ ok: true, codigo: s.codigo });
      codigo = null;
    });
  });
}

module.exports = { registrarSocket5b, CHECKINS, APOIOS };
