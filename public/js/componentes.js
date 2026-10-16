/* Componentes A-Frame da sala VR */

// Cor aleatória para o avatar (sincronizada via schema do NAF)
AFRAME.registerComponent("cor-aleatoria", {
  init() {
    const hue = Math.floor(Math.random() * 360);
    this.el.setAttribute("material", "color", `hsl(${hue}, 70%, 60%)`);
  }
});

// Faz o elemento sempre virar para a câmera (placas de texto)
AFRAME.registerComponent("look-at-camera", {
  tick() {
    const cam = this.el.sceneEl.camera;
    if (!cam) return;
    const pos = new THREE.Vector3();
    cam.getWorldPosition(pos);
    pos.y = this.el.object3D.getWorldPosition(new THREE.Vector3()).y;
    this.el.object3D.lookAt(pos);
  }
});

// Botão 3D que chama /api/acionar (servidor repassa ao webhook n8n)
AFRAME.registerComponent("botao-webhook", {
  schema: {
    nome: { type: "string", default: "principal" },
    painel: { type: "selector" }
  },

  init() {
    this.ocupado = false;
    this.corOriginal = this.el.getAttribute("color");
    this.el.addEventListener("click", () => this.acionar());
    this.el.addEventListener("mouseenter", () => this.el.setAttribute("color", "#ff6f60"));
    this.el.addEventListener("mouseleave", () => !this.ocupado && this.el.setAttribute("color", this.corOriginal));

    // Feedback quando OUTRO usuário da sala aperta o botão
    document.body.addEventListener("naf-pronto", () => {
      NAF.connection.subscribeToDataChannel("botao", (_from, _type, data) => {
        this.animar();
        this.status(`${data.usuario} apertou o botao`, "#ffd54f");
      });
    });
  },

  animar() {
    const obj = this.el.object3D;
    obj.position.y = -0.03;
    setTimeout(() => (obj.position.y = 0), 180);
  },

  status(msg, cor) {
    if (!this.data.painel) return;
    this.data.painel.setAttribute("value", msg);
    this.data.painel.setAttribute("color", cor);
  },

  async acionar() {
    if (this.ocupado) return;
    this.ocupado = true;
    this.animar();
    this.el.setAttribute("color", "#ffb300");
    this.status("Enviando para o n8n...", "#ffd54f");

    const usuario = window.VR_USUARIO || "anonimo";
    const sala = window.VR_SALA || "";

    try {
      const r = await fetch("/api/acionar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botao: this.data.nome, sala, usuario })
      });
      const data = await r.json();
      if (data.ok) {
        const msg = data.n8n && data.n8n.mensagem ? data.n8n.mensagem : "n8n recebeu!";
        this.status(msg, "#69f0ae");
        this.el.setAttribute("color", "#43a047");
        if (NAF.connection.isConnected()) NAF.connection.broadcastDataGuaranteed("botao", { usuario });
      } else {
        this.status("Erro: " + (data.erro || "status " + data.status), "#ff8a80");
        this.el.setAttribute("color", "#6d4c41");
      }
    } catch (e) {
      this.status("Erro de rede: " + e.message, "#ff8a80");
    } finally {
      setTimeout(() => {
        this.el.setAttribute("color", this.corOriginal);
        this.ocupado = false;
      }, 1200);
    }
  }
});
