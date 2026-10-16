/* Cena da pessoa atendida — Sala 5B
   Recebe o estado da sala pelo Socket.IO (namespace /5b) e desenha:
   sequência do encontro, check-in, atividades lógico-matemáticas, fechamento e pausa. */
(function () {
  const COR_PADRAO = {
    quadro: "#2b3a40", texto: "#f2efe6", suave: "#9fb3b0",
    opcao: "#e9e4d8", opcaoHover: "#f6f2e8", opcaoTexto: "#22313a",
    a: "#3d8b85", b: "#d69a3a", destaque: "#8fd0c6", certo: "#5fae7f"
  };
  // Alto contraste: fundo preto, peças brancas com texto preto, destaque amarelo
  const COR_CONTRASTE = {
    quadro: "#000000", texto: "#ffffff", suave: "#e6e6e6",
    opcao: "#ffffff", opcaoHover: "#fff59d", opcaoTexto: "#000000",
    a: "#00b8d4", b: "#ffab00", destaque: "#ffd600", certo: "#00c853"
  };
  const COR = { ...COR_PADRAO };
  function aplicarContraste(alto) {
    Object.assign(COR, alto ? COR_CONTRASTE : COR_PADRAO);
    const quadro = document.getElementById("quadro");
    if (quadro) quadro.setAttribute("color", COR.quadro);
  }
  const ETAPAS = [["B1", "Chegar"], ["B2", "Começar"], ["B3", "Focar"], ["B4", "Praticar"], ["B5", "Encerrar"]];
  const CHECKINS = [
    ["calma", "Calma", "#7fb3a9"],
    ["cansaco", "Cansaço", "#9aa6c4"],
    ["agitacao", "Agitação", "#d9a066"],
    ["animacao", "Animação", "#e2c35e"],
    ["prefiro-nao-dizer", "Prefiro não dizer", "#b8b2a7"]
  ];

  const palco = document.getElementById("palco");
  const sequencia = document.getElementById("sequencia");
  const aviso = document.getElementById("aviso");

  const FONTE = "/vendor/fonte/atkinson-hyperlegible-latin-400-normal.woff";

  // a-text padrão não tem acentos: textos viram troika-text com fonte local (Atkinson Hyperlegible)
  function el(tag, attrs = {}, pai = palco) {
    if (tag === "a-text") {
      const { value = "", width = 3, color = "#fff", position = "0 0 0" } = attrs;
      const e = document.createElement("a-entity");
      e.setAttribute("position", position);
      e.setAttribute("troika-text", { value: String(value), fontSize: Number(width) * 0.04, color, align: "center", anchor: "center", baseline: "center", font: FONTE });
      pai.appendChild(e);
      return e;
    }
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    pai.appendChild(e);
    return e;
  }
  const texto = (value, pos, extra = {}, pai) =>
    el("a-text", { value, align: "center", position: pos, color: COR.texto, width: 3, ...extra }, pai);

  // ------------------------------------------------------------ som (WebAudio)
  let audio = null;
  let ruidoGain = null;
  function iniciarAudio() {
    if (audio) return;
    try {
      audio = new (window.AudioContext || window.webkitAudioContext)();
      // Ruído marrom suave como som ambiente
      const len = audio.sampleRate * 4;
      const buf = audio.createBuffer(1, len, audio.sampleRate);
      const d = buf.getChannelData(0);
      let ultimo = 0;
      for (let i = 0; i < len; i++) {
        ultimo = (ultimo + 0.02 * (Math.random() * 2 - 1)) / 1.02;
        d[i] = ultimo * 3.5;
      }
      const src = audio.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const filtro = audio.createBiquadFilter();
      filtro.type = "lowpass";
      filtro.frequency.value = 700;
      ruidoGain = audio.createGain();
      ruidoGain.gain.value = 0;
      src.connect(filtro).connect(ruidoGain).connect(audio.destination);
      src.start();
      if (estado) aplicarRuido(estado.cena.ruido);
    } catch (e) {
      console.warn("Áudio indisponível", e);
    }
  }
  function aplicarRuido(v) {
    if (ruidoGain) ruidoGain.gain.setTargetAtTime(Math.min(1, v) * 0.25, audio.currentTime, 0.4);
  }
  function tom(freqs, dur = 0.35, vol = 0.12) {
    if (!audio) return;
    freqs.forEach((f, i) => {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = "sine";
      o.frequency.value = f;
      const t = audio.currentTime + i * 0.12;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(audio.destination);
      o.start(t);
      o.stop(t + dur + 0.05);
    });
  }
  document.addEventListener("pointerdown", iniciarAudio);
  document.querySelector("a-scene").addEventListener("enter-vr", () => {
    iniciarAudio();
    socketAtual?.emit("xr", true);
  });
  document.querySelector("a-scene").addEventListener("exit-vr", () => socketAtual?.emit("xr", false));

  // ------------------------------------------------------------ componentes
  AFRAME.registerComponent("opcao", {
    schema: { valor: { type: "string" }, base: { type: "color" }, hover: { type: "color" } },
    init() {
      this.el.classList.add("clicavel");
      this.el.addEventListener("mouseenter", () => !travado && this.el.setAttribute("color", this.data.hover));
      this.el.addEventListener("mouseleave", () => this.el.setAttribute("color", this.data.base));
      this.el.addEventListener("click", (ev) => {
        const modo = ev.detail && ev.detail.cursorEl && ev.detail.cursorEl.id === "mira" ? "olhar" : "apontar";
        this.el.emit("escolha", { valor: this.data.valor, modo }, true);
      });
    }
  });

  // Espelho para o painel: renderiza a visão da pessoa numa textura pequena e envia ~1,5 quadro/s.
  // Funciona também no modo VR (desliga o XR só durante a renderização da textura).
  const ESP_L = 384, ESP_A = 216;
  let espelhoAte = 0;
  AFRAME.registerComponent("espelho-captura", {
    init() {
      this.ultimo = 0;
      this.escala = new THREE.Vector3();
      const gama = new Uint8Array(256);
      for (let i = 0; i < 256; i++) gama[i] = Math.round(255 * Math.pow(i / 255, 1 / 2.2));
      this.gama = gama;
    },
    tick(t) {
      if (Date.now() > espelhoAte || !socketAtual?.connected || t - this.ultimo < 650) return;
      this.ultimo = t;
      const cena = this.el;
      const renderer = cena.renderer;
      if (!this.alvo) {
        this.alvo = new THREE.WebGLRenderTarget(ESP_L, ESP_A);
        this.cam = new THREE.PerspectiveCamera(80, ESP_L / ESP_A, 0.05, 100);
        this.pix = new Uint8Array(ESP_L * ESP_A * 4);
        this.tela = document.createElement("canvas");
        this.tela.width = ESP_L;
        this.tela.height = ESP_A;
        this.ctx = this.tela.getContext("2d");
        this.img = this.ctx.createImageData(ESP_L, ESP_A);
      }
      const xr = renderer.xr;
      const origem = xr.isPresenting ? xr.getCamera() : cena.camera;
      if (!origem) return;
      origem.matrixWorld.decompose(this.cam.position, this.cam.quaternion, this.escala);
      this.cam.updateMatrixWorld(true);
      const xrAntes = xr.enabled;
      const alvoAntes = renderer.getRenderTarget();
      xr.enabled = false;
      renderer.setRenderTarget(this.alvo);
      renderer.render(cena.object3D, this.cam);
      renderer.setRenderTarget(alvoAntes);
      xr.enabled = xrAntes;
      renderer.readRenderTargetPixels(this.alvo, 0, 0, ESP_L, ESP_A, this.pix);
      const d = this.img.data;
      const g = this.gama;
      for (let y = 0; y < ESP_A; y++) {
        const de = (ESP_A - 1 - y) * ESP_L * 4;
        const para = y * ESP_L * 4;
        for (let i = 0; i < ESP_L * 4; i += 4) {
          d[para + i] = g[this.pix[de + i]];
          d[para + i + 1] = g[this.pix[de + i + 1]];
          d[para + i + 2] = g[this.pix[de + i + 2]];
          d[para + i + 3] = 255;
        }
      }
      this.ctx.putImageData(this.img, 0, 0);
      socketAtual.emit("quadro", this.tela.toDataURL("image/jpeg", 0.6));
    }
  });
  document.querySelector("a-scene").setAttribute("espelho-captura", "");

  // Anel que vai se completando enquanto a pessoa fixa o olhar numa opção
  AFRAME.registerComponent("mira-progresso", {
    init() {
      this.inicio = null;
      this.anel = this.el.querySelector("#mira-anel");
      this.el.addEventListener("fusing", () => (this.inicio = performance.now()));
      const parar = () => {
        this.inicio = null;
        this.anel.setAttribute("geometry", "thetaLength", 0.01);
      };
      this.el.addEventListener("mouseleave", parar);
      this.el.addEventListener("click", parar);
    },
    tick() {
      if (this.inicio === null) return;
      const total = this.el.getAttribute("cursor").fuseTimeout;
      const p = Math.min(1, (performance.now() - this.inicio) / total);
      this.anel.setAttribute("geometry", "thetaLength", Math.max(0.01, 360 * p));
    }
  });

  document.getElementById("mira").setAttribute("mira-progresso", "");

  function aplicarOlhar(cena) {
    const mira = document.getElementById("mira");
    if (!mira || !mira.hasLoaded) return;
    const ativo = Boolean(cena.olhar);
    mira.setAttribute("visible", ativo);
    mira.setAttribute("raycaster", "enabled", ativo);
    mira.setAttribute("cursor", "fuseTimeout", Math.round((cena.olharSeg || 2) * 1000));
    atualizarAlvosMira();
  }

  // O raycaster da mira não acompanha a cena enquanto está desligado; recarrega os alvos
  function atualizarAlvosMira() {
    const rc = document.getElementById("mira")?.components.raycaster;
    if (rc && rc.data.enabled) rc.refreshObjects();
  }

  AFRAME.registerComponent("respirar", {
    // 4 s inspira / 4 s solta — ritmo de referência, sem exigência
    tick(t) {
      const fase = (t % 8000) / 8000;
      const s = fase < 0.5 ? 1 + fase * 2 * 0.8 : 1.8 - (fase - 0.5) * 2 * 0.8;
      this.el.object3D.scale.setScalar(s);
      const v = fase < 0.5 ? "inspira" : "solta";
      if (this.ultimo !== v) {
        this.ultimo = v;
        document.getElementById("resp-texto").setAttribute("troika-text", "value", v);
      }
    }
  });

  AFRAME.registerComponent("pulsar-suave", {
    tick(t) {
      const s = 1 + Math.sin(t / 1600) * 0.08;
      this.el.object3D.scale.setScalar(s);
    }
  });

  // ------------------------------------------------------------ sequência do encontro
  function renderSequencia(bloco, pausa) {
    sequencia.innerHTML = "";
    const passo = 0.62;
    ETAPAS.forEach(([b, nome], i) => {
      const x = (i - 2) * passo;
      const atual = b === bloco;
      const idxAtual = ETAPAS.findIndex(([bb]) => bb === bloco);
      el("a-circle", { radius: atual ? 0.07 : 0.05, position: `${x} 0.08 0`, color: atual ? COR.destaque : i < idxAtual ? "#7f9894" : "#b9c4c0" }, sequencia);
      el("a-text", { value: nome, align: "center", position: `${x} -0.08 0`, width: 1.6, color: atual ? "#1f2a30" : "#46555a" }, sequencia);
    });
    if (pausa) el("a-text", { value: "pausa", align: "center", position: "0 0.25 0", width: 2, color: "#5b6a6e" }, sequencia);
    else if (estado && estado.avisoPausa) el("a-text", { value: "Hora de descansar os olhos? Fale com o profissional.", align: "center", position: "0 0.27 0", width: 2.4, color: "#3f4d52" }, sequencia);
  }

  // ------------------------------------------------------------ grupos de objetos
  function grade(qtd, cor, cx, cy, { forma = "a-sphere", tam = 0.07, porLinha = 5, passo = 0.2, pai = palco } = {}) {
    const linhas = Math.ceil(qtd / porLinha);
    for (let i = 0; i < qtd; i++) {
      const linha = Math.floor(i / porLinha);
      const naLinha = Math.min(porLinha, qtd - linha * porLinha);
      const col = i % porLinha;
      const x = cx + (col - (naLinha - 1) / 2) * passo;
      const y = cy + ((linhas - 1) / 2 - linha) * passo;
      const attrs = forma === "a-box" ? { width: tam * 2, height: tam * 2, depth: tam * 2 } : { radius: tam };
      el(forma, { ...attrs, position: `${x} ${y} 0.05`, color: cor }, pai);
    }
  }

  function opcoesNumericas(at, y) {
    const visiveis = at.opcoes.filter((o) => !at.removidas.includes(String(o)));
    const passo = 0.55;
    visiveis.forEach((v, i) => {
      const x = (i - (visiveis.length - 1) / 2) * passo;
      const correta = at.resolvida && String(v) === String(at.destaqueResolvido);
      if (at.destaque !== null && String(at.destaque) === String(v) && !at.resolvida) {
        el("a-plane", { width: 0.48, height: 0.48, position: `${x} ${y} 0.01`, color: COR.destaque }, palco);
      }
      const box = el("a-box", {
        width: 0.4, height: 0.4, depth: 0.06,
        position: `${x} ${y} 0.04`,
        color: correta ? COR.certo : COR.opcao,
        opcao: `valor: ${v}; base: ${correta ? COR.certo : COR.opcao}; hover: ${COR.opcaoHover}`
      });
      el("a-text", { value: String(v), position: "0 0 0.04", width: 4, color: COR.opcaoTexto }, box);
      if (at.resolvida && !correta) box.setAttribute("material", "opacity: 0.35; transparent: true");
    });
  }

  // ------------------------------------------------------------ telas
  // ------------------------------------------------------------ cubo 2x2 (grafo de estados)
  const MOVS = ["U", "U'", "R", "R'", "F", "F'"];
  const NOMES_MOV = {
    U: ["Topo", "horário"], "U'": ["Topo", "anti-horário"],
    R: ["Direita", "horário"], "R'": ["Direita", "anti-horário"],
    F: ["Frente", "horário"], "F'": ["Frente", "anti-horário"]
  };
  let cuboAtual = null; // { id, n, el }
  let arestas = {};
  let animando = false;
  const comemorados = new Set();

  function telaCubo(at) {
    texto(at.enunciado, "0 2.47 0", { width: 3.2 });

    // Cubo principal (mostra Topo, Frente e Direita) e vista de trás (Base, Trás e Esquerda)
    const cuboEl = Cubo3D.criar(palco, at, { position: "-0.55 1.72 0.3", rotation: "38 -35 0", scale: "1.15 1.15 1.15" });
    Cubo3D.criar(palco, at, { position: "-1.3 2.2 0.15", rotation: "-38 145 0", scale: "0.42 0.42 0.42" });
    texto("vista de trás", "-1.3 1.97 0", { width: 1.3, color: COR.suave });
    texto(`Giros feitos: ${at.passos}`, "-0.55 1.2 0", { width: 1.8, color: COR.suave });
    cuboAtual = { id: at.id, n: at.ultimo ? at.ultimo.n : 0, el: cuboEl };

    // Grafo local: estado atual no centro, 6 vizinhos (um por giro)
    const cx = 0.85, cy = 1.9;
    arestas = {};
    MOVS.forEach((m, k) => {
      const ang = Math.PI / 2 - (k * Math.PI) / 3;
      const x = cx + Math.cos(ang) * 0.42;
      const y = cy + Math.sin(ang) * 0.36;
      const v = at.vizinhos[k];
      const disponivel = at.opcoes.includes(m);
      const cor = v.aproxima === null ? "#8a9a9c" : v.aproxima ? "#5fb3a6" : "#c08a4e";
      const linha = el("a-entity", { line: `start: ${cx} ${cy} 0.05; end: ${x} ${y} 0.05; color: ${cor}; opacity: ${disponivel ? 1 : 0.25}` });
      arestas[m] = { linha, cor };
      el("a-circle", { radius: 0.065, position: `${x} ${y} 0.06`, color: cor, material: `opacity: ${disponivel ? 1 : 0.3}; transparent: true` });
      texto(String(k + 1), `${x} ${y} 0.07`, { width: 1.7, color: "#1f2a30" });
    });
    el("a-circle", { radius: 0.12, position: `${cx} ${cy} 0.07`, color: at.dist === 0 ? COR.certo : "#f2efe6" });
    texto(String(at.dist), `${cx} ${cy} 0.08`, { width: 3.2, color: "#1f2a30" });

    if (at.mapa) {
      el("a-circle", { radius: 0.03, position: `${cx - 0.42} 1.43 0.05`, color: "#5fb3a6" });
      texto("aproxima", `${cx - 0.24} 1.43 0`, { width: 1.3, color: COR.suave });
      el("a-circle", { radius: 0.03, position: `${cx + 0.12} 1.43 0.05`, color: "#c08a4e" });
      texto("afasta", `${cx + 0.27} 1.43 0`, { width: 1.3, color: COR.suave });
    }

    // Caminho mais curto até resolvido
    if (at.dist > 0) {
      texto(`Caminho mais curto: ${at.dist} ${at.dist === 1 ? "giro" : "giros"}`, `${cx} 1.28 0`, { width: 1.8, color: COR.texto });
      const passo = Math.min(0.14, 1.2 / at.dist);
      const x0 = cx - (at.dist * passo) / 2;
      for (let i = 0; i <= at.dist; i++) {
        const x = x0 + i * passo;
        if (i > 0) el("a-entity", { line: `start: ${x - passo} 1.14 0.05; end: ${x} 1.14 0.05; color: #7f9894` });
        el("a-circle", { radius: i === 0 ? 0.045 : 0.03, position: `${x} 1.14 0.06`, color: i === 0 ? "#f2efe6" : i === at.dist ? COR.certo : "#7f9894" });
      }
    }

    if (at.resolvida) {
      texto(`Resolvido em ${at.passos} giros (mínimo: ${at.distInicial})`, "0 0.9 0", { width: 2.6, color: COR.destaque });
      if (!comemorados.has(at.id)) {
        comemorados.add(at.id);
        tom([523, 659, 784], 0.6, 0.1);
      }
      return;
    }

    // Botões de giro (número = vizinho no grafo)
    const visiveis = MOVS.filter((m) => at.opcoes.includes(m));
    const largura = 0.5;
    visiveis.forEach((m, i) => {
      const k = MOVS.indexOf(m);
      const x = (i - (visiveis.length - 1) / 2) * largura;
      if (at.destaque === m) el("a-plane", { width: 0.52, height: 0.36, position: `${x} 0.88 0.01`, color: COR.destaque });
      const botao = el("a-box", {
        width: 0.46, height: 0.3, depth: 0.05, position: `${x} 0.88 0.04`, color: COR.opcao,
        opcao: `valor: ${m}; base: ${COR.opcao}; hover: ${COR.opcaoHover}`, "data-mov": m
      });
      el("a-text", { value: String(k + 1), position: "-0.17 0 0.03", width: 2.2, color: "#2f6f6a" }, botao);
      el("a-text", { value: NOMES_MOV[m][0], position: "0.04 0.055 0.03", width: 1.5, color: COR.opcaoTexto }, botao);
      el("a-text", { value: NOMES_MOV[m][1], position: "0.04 -0.06 0.03", width: 1.1, color: "#5b6a6e" }, botao);
    });
  }

  // Ao apontar para um giro: destaca a camada no cubo e a aresta no grafo
  palco.addEventListener("mouseenter", (ev) => {
    const m = ev.target.getAttribute && ev.target.getAttribute("data-mov");
    if (!m || !cuboAtual || travado) return;
    Cubo3D.destacarCamada(cuboAtual.el, m);
    arestas[m]?.linha.setAttribute("line", "color", "#ffffff");
  });
  palco.addEventListener("mouseleave", (ev) => {
    const m = ev.target.getAttribute && ev.target.getAttribute("data-mov");
    if (!m || !cuboAtual) return;
    Cubo3D.destacarCamada(cuboAtual.el, null);
    if (arestas[m]) arestas[m].linha.setAttribute("line", "color", arestas[m].cor);
  });

  // ------------------------------------------------------------ palavra (letras ou sílabas)
  const vozDisponivel = "speechSynthesis" in window;
  function falar(texto) {
    if (!vozDisponivel || !texto) return;
    const u = new SpeechSynthesisUtterance(texto.toLowerCase());
    u.lang = "pt-BR";
    u.rate = 0.8;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }

  function telaPalavra(at) {
    const silaba = at.unidade === "silaba";
    texto(at.enunciado, "0 2.47 0", { width: 3.2 });

    // Espaços da palavra (preenchidos conforme as peças certas são tocadas)
    // Tamanho escolhido pelo profissional, limitado para caber no quadro / no arco
    const lp0 = silaba ? 0.46 : 0.28;
    const nTotal = at.total;
    const porLinhaMax = at.arranjo === "arco" ? Math.ceil(nTotal / (nTotal > 6 ? 2 : 1)) : nTotal;
    const espacoArco = porLinhaMax > 1 ? (2 * 2.15 * Math.sin((60 / (porLinhaMax - 1) / 2) * (Math.PI / 180))) : 1;
    const kMax = at.arranjo === "arco" ? (espacoArco - 0.05) / lp0 : 3.0 / (nTotal * (lp0 + 0.08));
    const k = Math.max(0.8, Math.min(at.tamanho || 1, Math.max(1, kMax)));
    const larg = Math.min((silaba ? 0.55 : 0.34) * k, 2.8 / at.total);
    for (let i = 0; i < at.total; i++) {
      const x = (i - (at.total - 1) / 2) * larg;
      const feita = i < at.colocadas.length;
      el("a-plane", { width: larg * 0.86, height: 0.012, position: `${x} 1.98 0.02`, color: feita ? COR.certo : "#7f9894" });
      if (feita) texto(at.colocadas[i], `${x} 2.13 0.02`, { width: (silaba ? 6 : 7) * Math.min(k, 1.3), color: at.resolvida ? COR.destaque : COR.texto });
    }

    if (at.falar && vozDisponivel) {
      const ouvir = el("a-box", { width: 0.34, height: 0.16, depth: 0.04, position: "1.3 2.47 0.04", color: COR.opcao, opcao: `valor: ouvir; base: ${COR.opcao}; hover: ${COR.opcaoHover}`, "data-ouvir": "1" });
      el("a-text", { value: "Ouvir", position: "0 0 0.03", width: 1.6, color: COR.opcaoTexto }, ouvir);
    }

    if (at.resolvida) {
      texto("Palavra completa", "0 1.5 0", { width: 3, color: COR.destaque });
      if (!comemorados.has(at.id)) {
        comemorados.add(at.id);
        tom([523, 659, 784], 0.6, 0.1);
        if (at.falar) setTimeout(() => falar(at.falar), 500);
      }
      return;
    }

    // Peças: em ordem numa linha, ou espalhadas num arco de ~60° à frente da pessoa
    const lp = lp0 * k;
    const n = at.pecas.length;
    const linhas = at.arranjo === "arco" && n > 6 ? 2 : 1;
    const porLinha = Math.ceil(n / linhas);
    at.pecas.forEach((p, i) => {
      let pos, rot = "0 0 0";
      if (at.arranjo === "arco") {
        const linha = Math.floor(i / porLinha);
        const col = i % porLinha;
        const naLinha = Math.min(porLinha, n - linha * porLinha);
        const a = naLinha > 1 ? (-30 + (60 * col) / (naLinha - 1)) * (Math.PI / 180) : 0;
        const R = 2.15;
        const y = linhas === 2 ? (linha === 0 ? 1.62 : 1.18) : 1.4 + (col % 2 ? 0.12 : -0.08);
        pos = `${(Math.sin(a) * R).toFixed(3)} ${y} ${(2.5 - Math.cos(a) * R).toFixed(3)}`;
        rot = `0 ${((-a * 180) / Math.PI).toFixed(1)} 0`;
      } else {
        pos = `${(i - (n - 1) / 2) * (lp + 0.08)} 1.4 0.05`;
      }
      const grupo = el("a-entity", { position: pos, rotation: rot });
      if (at.destaque === p.id) el("a-plane", { width: lp + 0.07, height: 0.32 * k + 0.07, position: "0 0 -0.03", color: COR.destaque }, grupo);
      const peca = el("a-box", {
        width: lp, height: 0.32 * k, depth: 0.05, color: COR.opcao,
        opcao: `valor: ${p.id}; base: ${COR.opcao}; hover: ${COR.opcaoHover}`, "data-peca": p.id
      }, grupo);
      el("a-text", { value: p.texto, position: "0 0 0.03", width: (silaba ? 5 : 6) * k, color: COR.opcaoTexto }, peca);
    });
  }

  function balancar(alvo) {
    if (!alvo) return;
    const o = alvo.object3D;
    const x0 = o.position.x;
    [0.03, -0.03, 0.02, -0.02, 0].forEach((d, i) => setTimeout(() => (o.position.x = x0 + d), i * 60));
  }

  // ------------------------------------------------------------ categorias (mercado)
  // Produto clicável: cresce um pouco ao apontar; o clique vira "escolha" (com o modo: olhar ou apontar)
  AFRAME.registerComponent("item-produto", {
    schema: { uid: { type: "string" } },
    init() {
      this.el.classList.add("clicavel");
      // Escala original lida no primeiro "apontar" (o componente scale pode ainda não ter sido aplicado no init)
      const original = () => (this.s0 ||= this.el.object3D.scale.clone());
      this.el.addEventListener("mouseenter", () => !travado && this.el.object3D.scale.copy(original()).multiplyScalar(1.15));
      this.el.addEventListener("mouseleave", () => this.el.object3D.scale.copy(original()));
      this.el.addEventListener("click", (ev) => {
        const modo = ev.detail && ev.detail.cursorEl && ev.detail.cursorEl.id === "mira" ? "olhar" : "apontar";
        this.el.emit("escolha", { valor: this.data.uid, modo, cursorEl: ev.detail && ev.detail.cursorEl }, true);
      });
    }
  });

  const kebab = (k) => k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
  // Meia altura do produto (para apoiar na prateleira), considerando a rotação usada no catálogo
  function meiaAltura(it) {
    const g = it.geo;
    const ey = it.escala ? Number(it.escala.split(" ")[1]) : 1;
    if (it.forma === "a-sphere") return g.radius * ey;
    if (it.forma === "a-box") return g.height / 2;
    if (it.forma === "a-torus") return it.rot ? g.radiusTubular : g.radius + g.radiusTubular;
    if (it.rot) return (g.radius || g.radiusBottom || 0.05) + 0.005;
    return g.height / 2;
  }
  const ESC_PRODUTO = 1.45; // produtos maiores que o tamanho real, para leitura a ~2 m
  function produto3D(it, pos, extra = {}, pai = palco, fator = ESC_PRODUTO) {
    const attrs = { position: pos, color: it.cor, ...extra };
    for (const [k, v] of Object.entries(it.geo)) attrs[kebab(k)] = v;
    if (it.rot) attrs.rotation = it.rot;
    const e = (it.escala || "1 1 1").split(" ").map((v) => (Number(v) * fator).toFixed(3));
    attrs.scale = e.join(" ");
    return el(it.forma, attrs, pai);
  }

  // ---- pegar e levar: o item na mão segue o ponteiro que o pegou (laser, mouse ou mira de olhar)
  let segurando = null; // { uid, el (na prateleira), visual (na mão), cursorEl, modo }
  const cena = document.querySelector("a-scene");

  AFRAME.registerComponent("segue-ponteiro", {
    init() {
      this.origem = new THREE.Vector3();
      this.dir = new THREE.Vector3();
    },
    tick() {
      if (!segurando || segurando.visual !== this.el) return;
      const c = segurando.cursorEl;
      const rc = c && c.components && c.components.raycaster;
      if (rc && rc.raycaster) {
        this.origem.copy(rc.raycaster.ray.origin);
        this.dir.copy(rc.raycaster.ray.direction);
      } else {
        const cam = cena.camera;
        if (!cam) return;
        cam.getWorldPosition(this.origem);
        cam.getWorldDirection(this.dir);
      }
      this.el.object3D.position.copy(this.origem).addScaledVector(this.dir, 1.25);
    }
  });

  function esconderNaPrateleira(elItem) {
    elItem.object3D.visible = false;
    elItem.classList.remove("clicavel");
  }
  function mostrarNaPrateleira(elItem) {
    if (!elItem) return;
    elItem.object3D.visible = true;
    elItem.classList.add("clicavel");
  }
  function largarVisual() {
    if (segurando && segurando.visual && segurando.visual.parentNode) segurando.visual.parentNode.removeChild(segurando.visual);
  }
  function devolver() {
    if (!segurando) return;
    largarVisual();
    mostrarNaPrateleira(palco.querySelector(`[data-item="${segurando.uid}"]`));
    segurando = null;
  }
  function pegar(uid, elItem, cursorEl, modo) {
    const at = estado && estado.atividade;
    const it = at && at.itens.find((i) => i.uid === uid);
    if (!it) return;
    if (segurando) devolver();
    esconderNaPrateleira(elItem);
    const visual = produto3D(it, "0 1.6 -1", { "segue-ponteiro": "" }, cena, 0.75); // menor na mão, para não tapar a visão
    segurando = { uid, el: elItem, visual, cursorEl, modo };
    tom([523], 0.12, 0.05);
  }
  function soltarNoCarrinho(modoSoltar) {
    if (!segurando || !estado || !estado.atividade || travado) return;
    const { uid, modo } = segurando;
    largarVisual();
    segurando = { uid, el: null, visual: null, cursorEl: null, modo };
    travado = true;
    socketAtual?.emit("resposta", { atividadeId: estado.atividade.id, valor: uid, modo: modoSoltar || modo });
  }

  // Carrinho e gôndola recebem toques só no modo "levar"
  AFRAME.registerComponent("alvo-carrinho", {
    init() {
      this.el.addEventListener("mouseenter", () => segurando && this.el.object3D.scale.setScalar(1.08));
      this.el.addEventListener("mouseleave", () => this.el.object3D.scale.setScalar(1));
      this.el.addEventListener("click", (ev) => {
        const c = ev.detail && ev.detail.cursorEl;
        soltarNoCarrinho(c && c.id === "mira" ? "olhar" : "apontar");
      });
    }
  });
  AFRAME.registerComponent("devolver-prateleira", {
    init() {
      this.el.addEventListener("click", () => devolver());
    }
  });

  const PRATELEIRA_Y = [1.62, 1.12, 0.62]; // vagas 0–4 em cima, 5–9 no meio, 10–14 embaixo

  function telaCategorias(at) {
    texto(at.enunciado, "-0.25 2.47 0", { width: 3.2 });
    texto(`No carrinho: ${at.noCarrinho.length}/${at.meta}`, "1.2 2.47 0", { width: 1.8, color: COR.suave });
    if (at.trocaDeRegra && !at.resolvida) texto("Mesma prateleira, novo pedido", "-0.25 2.27 0", { width: 1.9, color: COR.suave });
    if (at.levar && !at.resolvida) texto("Toque no item e depois no carrinho", `-0.25 ${at.trocaDeRegra ? 2.12 : 2.27} 0`, { width: 1.9, color: COR.suave });

    // Gôndola
    const fundoGondola = el("a-plane", { width: 2.9, height: 1.62, position: "0 1.2 0.12", color: COR.quadro === "#000000" ? "#1a1a1a" : "#56656c" });
    if (at.levar) {
      // tocar na gôndola com laser/mouse devolve o item (a mira de olhar não atinge o fundo)
      fundoGondola.classList.add("fundo-alvo");
      fundoGondola.setAttribute("devolver-prateleira", "");
    }
    for (const y of PRATELEIRA_Y) el("a-box", { width: 2.9, height: 0.03, depth: 0.36, position: `0 ${y} 0.3`, color: "#c9cfd2" });

    // Produtos
    for (const it of at.itens) {
      const y0 = PRATELEIRA_Y[Math.floor(it.vaga / 5)];
      const x = -1.12 + (it.vaga % 5) * 0.56;
      const y = y0 + 0.015 + meiaAltura(it) * ESC_PRODUTO;
      if (at.destaque === it.uid) el("a-ring", { "radius-inner": 0.19, "radius-outer": 0.23, position: `${x} ${y} 0.18`, color: COR.destaque, material: "shader: flat" });
      produto3D(it, `${x} ${y.toFixed(3)} 0.32`, { "item-produto": `uid: ${it.uid}`, "data-item": it.uid });
      if (at.nomes) texto(it.nome, `${x} ${(y0 - 0.06).toFixed(3)} 0.49`, { width: 1.35, color: "#f2efe6" });
    }

    // Carrinho (à direita da gôndola)
    const carrinho = el("a-entity", { position: "1.18 0.5 0.78", rotation: "0 -20 0" }); // visível no PC, longe do botão de VR do canto
    const caixa = el("a-box", { width: 0.62, height: 0.3, depth: 0.42, color: "#3f8f6e", material: "opacity: 0.85; transparent: true" }, carrinho);
    if (at.levar && !at.resolvida) {
      caixa.classList.add("clicavel");
      caixa.setAttribute("data-carrinho", "1");
      caixa.setAttribute("alvo-carrinho", "");
    }
    el("a-cylinder", { radius: 0.015, height: 0.34, position: "0.28 -0.3 0.18", color: "#7f8c8d" }, carrinho);
    el("a-cylinder", { radius: 0.015, height: 0.34, position: "-0.28 -0.3 0.18", color: "#7f8c8d" }, carrinho);
    texto("Carrinho", "0 0.28 0", { width: 1.6, color: "#1f2a30" }, carrinho);
    at.noCarrinho.forEach((it, i) => {
      const cx = -0.2 + (i % 3) * 0.2;
      const cz = -0.1 + Math.floor(i / 3) * 0.2;
      produto3D(it, `${cx} 0.2 ${cz}`, {}, carrinho, 0.9);
    });

    if (segurando) {
      const naPrateleira = palco.querySelector(`[data-item="${segurando.uid}"]`);
      if (naPrateleira && at.levar && segurando.visual) esconderNaPrateleira(naPrateleira);
      else if (!segurando.visual && naPrateleira) segurando = null; // resposta já processada
      else if (!naPrateleira) { largarVisual(); segurando = null; }
    }

    if (at.resolvida) {
      texto("Lista completa", "0 0.38 0.5", { width: 2.6, color: COR.destaque });
      if (!comemorados.has(at.id)) {
        comemorados.add(at.id);
        tom([523, 659, 784], 0.6, 0.1);
      }
    }
  }

  function piscar(alvo) {
    if (!alvo) return;
    const cor = alvo.getAttribute("color");
    alvo.setAttribute("color", "#8a979c");
    setTimeout(() => alvo.setAttribute("color", cor), 380);
  }

  // ------------------------------------------------------------ alvos (aquecimento)
  AFRAME.registerComponent("alvo-toque", {
    schema: { valor: { type: "string" } },
    init() {
      this.el.addEventListener("click", (ev) => {
        const cursor = ev.detail && ev.detail.cursorEl;
        const modo = cursor && cursor.id === "mira" ? "olhar" : "apontar";
        if (this.data.valor === "fora" && modo === "olhar") return; // o olhar nunca conta "fora"
        this.el.emit("escolha", { valor: this.data.valor, modo }, true);
      });
    }
  });

  function telaAlvos(at) {
    texto(at.enunciado, "0 2.47 0", { width: 3 });
    texto(`${at.feitos}/${at.total}`, "1.3 2.47 0", { width: 1.8, color: COR.suave });

    // Fundo quase invisível: só registra toque "fora" com laser/mouse
    el("a-plane", { class: "fundo-alvo", width: 7, height: 3.6, position: "0 1.6 0.05", material: "opacity: 0.001; transparent: true; depthWrite: false", "alvo-toque": "valor: fora", "data-fundo": "1" });

    if (at.ponto) {
      // Ponto na esfera de raio 2,2 m em torno da cabeça (azimute e elevação em graus)
      const R = 2.2, az = (at.ponto.az * Math.PI) / 180, elv = (at.ponto.el * Math.PI) / 180;
      const x = R * Math.cos(elv) * Math.sin(az);
      const y = 1.6 + R * Math.sin(elv);
      const z = 2.5 - R * Math.cos(elv) * Math.cos(az);
      const alvo = el("a-entity", { position: `${x.toFixed(3)} ${y.toFixed(3)} ${z.toFixed(3)}`, "look-at-camera-alvo": "" });
      el("a-circle", { radius: at.raio * 1.35, color: "#f2efe6", material: "shader: flat; opacity: 0.25; transparent: true", position: "0 0 -0.01" }, alvo);
      el("a-circle", {
        radius: at.raio, color: COR.destaque, material: "shader: flat", class: "clicavel",
        "alvo-toque": "valor: alvo", "data-alvo": "1"
      }, alvo);
      el("a-circle", { radius: at.raio * 0.25, color: COR.quadro, material: "shader: flat", position: "0 0 0.002" }, alvo);
    } else {
      if (!comemorados.has(at.id)) {
        comemorados.add(at.id);
        tom([523, 659, 784], 0.6, 0.1);
      }
    }
  }

  // O alvo sempre virado para a pessoa
  AFRAME.registerComponent("look-at-camera-alvo", {
    tick() {
      const cam = this.el.sceneEl.camera;
      if (!cam) return;
      const p = new THREE.Vector3();
      cam.getWorldPosition(p);
      this.el.object3D.lookAt(p);
    }
  });

  function telaAtividade(at) {
    if (at.tipo !== "categorias" && segurando) devolver();
    if (at.tipo === "alvos") return telaAlvos(at);
    if (at.tipo === "categorias") return telaCategorias(at);
    if (at.tipo === "cubo") return telaCubo(at);
    if (at.tipo === "palavra") return telaPalavra(at);
    texto(at.enunciado, "0 2.35 0", { width: 3.4 });

    if (at.tipo === "contagem") {
      grade(at.n, COR.a, 0, 1.9, { porLinha: 5, passo: 0.22, tam: 0.075 });
      opcoesNumericas(at, 1.1);
    } else if (at.tipo === "soma") {
      const larguraA = Math.min(at.a, 5) * 0.17;
      const larguraB = Math.min(at.b, 5) * 0.17;
      grade(at.a, COR.a, -0.25 - larguraA / 2, 1.9, { forma: "a-box", tam: 0.06, passo: 0.17 });
      texto("+", "0 1.9 0.05", { width: 4 });
      grade(at.b, COR.b, 0.25 + larguraB / 2, 1.9, { forma: "a-box", tam: 0.06, passo: 0.17 });
      opcoesNumericas(at, 1.1);
    } else if (at.tipo === "comparacao") {
      [["esquerda", at.a, -0.72], ["direita", at.b, 0.72]].forEach(([lado, qtd, x]) => {
        if (at.removidas.includes(lado)) return;
        const correta = at.resolvida && lado === at.destaqueResolvido;
        if (at.destaque === lado && !at.resolvida) el("a-plane", { width: 1.3, height: 1.2, position: `${x} 1.55 0.01`, color: COR.destaque });
        const painel = el("a-plane", {
          width: 1.2, height: 1.1, position: `${x} 1.55 0.03`,
          color: correta ? COR.certo : COR.opcao,
          opcao: `valor: ${lado}; base: ${correta ? COR.certo : COR.opcao}; hover: ${COR.opcaoHover}`
        });
        grade(qtd, lado === "esquerda" ? COR.a : COR.b, 0, 0, { porLinha: 4, passo: 0.22, tam: 0.07, pai: painel });
        if (at.resolvida && !correta) painel.setAttribute("material", "opacity: 0.35; transparent: true");
      });
    }

    if (at.resolvida) texto("Certo.", "0 0.78 0", { color: COR.destaque, width: 3 });
  }

  function telaCheckin() {
    texto("Como você está chegando?", "0 2.3 0", { width: 3.4 });
    texto("Aponte e escolha", "0 2.08 0", { width: 2, color: COR.suave });
    const passo = 0.6;
    CHECKINS.forEach(([valor, nome, cor], i) => {
      const x = (i - 2) * passo;
      const cartao = el("a-plane", { width: 0.52, height: 0.62, position: `${x} 1.45 0.03`, color: COR.opcao, opcao: `valor: ${valor}; base: ${COR.opcao}; hover: ${COR.opcaoHover}`, "data-checkin": "1" });
      el("a-circle", { radius: 0.14, position: "0 0.08 0.01", color: cor }, cartao);
      el("a-text", { value: nome, align: "center", position: "0 -0.2 0.01", width: nome.length > 10 ? 1.25 : 1.5, color: COR.opcaoTexto }, cartao);
    });
  }

  function telaFechamento(f) {
    texto("Hoje você fez", "0 2.3 0", { width: 3 });
    texto(String(f.concluidas), "0 1.85 0", { width: 9, color: COR.destaque });
    texto(f.concluidas === 1 ? "atividade" : "atividades", "0 1.45 0", { width: 3 });
    const nomes = { contagem: "contar", comparacao: "comparar", soma: "somar", cubo: "cubo", palavra: "palavras", categorias: "categorias", alvos: "aquecimento" };
    if (f.tipos.length) texto(f.tipos.map((t) => nomes[t] || t).join("  ·  "), "0 1.15 0", { width: 2.6, color: COR.suave });
    if (f.palavras && f.palavras.length) {
      el("a-plane", { width: 2.6, height: 0.26, position: "0 0.98 0.02", color: "#3a4a50", material: "opacity: 0.7; transparent: true" });
      texto(f.palavras.join("   "), "0 0.98 0.03", { width: Math.min(3.2, 1.2 + f.palavras.length * 0.35), color: COR.texto });
      texto("Até o próximo encontro", "0 0.76 0", { width: 2.4, color: COR.suave });
    } else texto("Até o próximo encontro", "0 0.85 0", { width: 2.4, color: COR.suave });
  }

  function telaPausa(tipo) {
    el("a-sphere", { radius: 0.22, position: "0 1.75 0.1", color: "#8fb9b3", "pulsar-suave": "" });
    texto("Pausa", "0 1.28 0", { width: 3.5 });
    if (tipo === "fora") texto("Pode tirar o óculos com calma", "0 1.02 0", { width: 2.6, color: COR.suave });
  }

  function telaEspera(bloco) {
    const msg = bloco === "B1" ? "Boas-vindas" : "Já vamos começar";
    texto(msg, "0 1.75 0", { width: 4 });
    texto("Pode olhar em volta com calma", "0 1.4 0", { width: 2.4, color: COR.suave });
  }

  // ------------------------------------------------------------ estado e rede
  let estado = null;
  let chaveTela = "";
  let travado = false;
  let ultimaCorreta = {}; // atividadeId -> valor correto (para pintar após acerto)

  function render() {
    const e = estado;
    renderSequencia(e.bloco, e.pausa);

    // Respiração e som são independentes da tela principal
    const resp = document.getElementById("respiracao");
    resp.setAttribute("visible", e.cena.respiracao && !e.pausa);
    const esfera = document.getElementById("resp-esfera");
    if (e.cena.respiracao && !esfera.hasAttribute("respirar")) esfera.setAttribute("respirar", "");
    if (!e.cena.respiracao && esfera.hasAttribute("respirar")) esfera.removeAttribute("respirar");
    aplicarRuido(e.cena.ruido);
    aplicarOlhar(e.cena);

    const at = e.atividade ? { ...e.atividade, destaqueResolvido: ultimaCorreta[e.atividade.id] } : null;
    aplicarContraste(Boolean(e.cena.contraste));
    const chave = JSON.stringify({ p: e.pausa, pt: e.pausaTipo, av: e.avisoPausa, c: e.cena.checkin, ct: Boolean(e.cena.contraste), at, b: e.bloco, f: e.fechamento });
    if (chave === chaveTela) return;

    // Cubo: anima o giro no cubo que está na tela antes de redesenhar o novo estado
    if (animando) return;
    if (at?.tipo === "cubo" && cuboAtual && cuboAtual.id === at.id && at.ultimo && at.ultimo.n > cuboAtual.n && cuboAtual.el.isConnected) {
      animando = true;
      cuboAtual.n = at.ultimo.n;
      Cubo3D.destacarCamada(cuboAtual.el, null);
      Cubo3D.animar(cuboAtual.el, at.ultimo.mov).then(() => {
        animando = false;
        render();
      });
      return;
    }
    if (!at || at.tipo !== "cubo") cuboAtual = null;
    chaveTela = chave;
    travado = Boolean(at && at.resolvida); // atividade concluída: sem hover nem novos cliques
    palco.innerHTML = "";

    if (e.pausa) telaPausa(e.pausaTipo);
    else if (e.cena.checkin) telaCheckin();
    else if (at) telaAtividade(at);
    else if (e.bloco === "B5" && e.fechamento) telaFechamento(e.fechamento);
    else telaEspera(e.bloco);
    setTimeout(atualizarAlvosMira, 50);
  }

  let socketAtual = null;
  // Escolhas (atividade ou check-in)
  palco.addEventListener("escolha", (ev) => {
    const alvo = ev.target;
    const valor = ev.detail.valor;
    if (alvo.hasAttribute("data-ouvir")) return falar(estado?.atividade?.falar); // ouvir funciona sempre
    if (travado || !estado || estado.pausa) return;
    if (alvo.hasAttribute("data-checkin")) {
      travado = true;
      tom([587, 740], 0.4, 0.08);
      socketAtual?.emit("checkin", valor);
      return;
    }
    if (!estado.atividade || estado.atividade.resolvida) return;
    if (estado.atividade.tipo === "categorias" && estado.atividade.levar && alvo.hasAttribute("data-item")) {
      pegar(valor, alvo, ev.detail.cursorEl, ev.detail.modo);
      return;
    }
    travado = true;
    if (!alvo.hasAttribute("data-peca") && !alvo.hasAttribute("data-item") && !alvo.hasAttribute("data-alvo") && !alvo.hasAttribute("data-fundo")) alvo.object3D.position.z -= 0.03;
    socketAtual?.emit("resposta", { atividadeId: estado.atividade.id, valor, modo: ev.detail.modo });
  });

  function conectar(codigo) {
    socketAtual?.disconnect();
    const socket = (socketAtual = io("/5b", { auth: { papel: "paciente", sala: codigo } }));

    socket.on("connect_error", (err) => {
      if (err.message === "sala-invalida") {
        socket.disconnect();
        document.getElementById("entrada").hidden = false;
        document.getElementById("erro-entrada").textContent = "Código não encontrado. Confira com o profissional.";
      }
    });
    socket.on("espelho", ({ ativo }) => (espelhoAte = ativo ? Date.now() + 10000 : 0));
    socket.on("connect", () => {
      socket.emit("xr", document.querySelector("a-scene").is("vr-mode"));
      document.getElementById("entrada").hidden = true;
      aviso.hidden = true;
      history.replaceState(null, "", `?sala=${codigo}`);
    });
    socket.on("disconnect", () => {
      aviso.textContent = "Reconectando…";
      aviso.hidden = false;
    });
    socket.on("estado", (e) => {
      estado = e;
      render();
    });
    socket.on("retorno", ({ atividadeId, valor, correta }) => {
      if (estado?.atividade?.tipo === "alvos") {
        tom([correta ? 660 : 330], 0.12, correta ? 0.06 : 0.03);
        if (!correta) travado = false;
        return;
      }
      if (estado?.atividade?.tipo === "categorias") {
        if (correta) tom([587], 0.2, 0.06);
        else {
          tom([392], 0.2, 0.04); // neutro, sem "som de erro"
          const naPrateleira = document.querySelector(`[data-item="${valor}"]`);
          if (segurando && segurando.uid === valor) segurando = null;
          mostrarNaPrateleira(naPrateleira);
          piscar(naPrateleira);
          travado = false;
        }
        return;
      }
      if (estado?.atividade?.tipo === "palavra") {
        if (correta) tom([587], 0.2, 0.06);
        else {
          tom([392], 0.25, 0.05);
          balancar(document.querySelector(`[data-peca="${valor}"]`));
          travado = false;
        }
        return;
      }
      if (estado?.atividade?.tipo === "cubo") {
        tom([correta ? 494 : 392], 0.2, 0.05); // giro registrado; som neutro, sem "erro"
        return;
      }
      if (correta) {
        ultimaCorreta[atividadeId] = valor;
        tom([523, 659, 784], 0.6, 0.1);
      } else {
        tom([392], 0.25, 0.06);
        travado = false;
      }
    });
    socket.on("encerrada", () => {
      palco.innerHTML = "";
      texto("Encontro encerrado", "0 1.7 0", { width: 3.5 });
      texto("Pode tirar o óculos com calma", "0 1.4 0", { width: 2.4, color: COR.suave });
      socket.disconnect();
    });

  }

  // ------------------------------------------------------------ entrada
  const params = new URLSearchParams(location.search);
  const inicial = (params.get("sala") || "").toUpperCase();
  document.getElementById("form-entrada").addEventListener("submit", (e) => {
    e.preventDefault();
    iniciarAudio();
    const c = document.getElementById("codigo").value.trim().toUpperCase();
    document.getElementById("erro-entrada").textContent = "";
    conectar(c);
  });
  if (inicial) {
    document.getElementById("codigo").value = inicial;
    conectar(inicial);
  }
})();
