/* Cubo 2x2 em three.js dentro de uma entidade A-Frame.
   Estado no formato do servidor: cp (permutação dos cantos) e co (orientação).
   Posições: 0 URF, 1 UFL, 2 ULB, 3 UBR, 4 DFR, 5 DLF, 6 DBL, 7 DRB */
(function () {
  const POS = [[1, 1, 1], [-1, 1, 1], [-1, 1, -1], [1, 1, -1], [1, -1, 1], [-1, -1, 1], [-1, -1, -1], [1, -1, -1]];
  const FACES = [["U", "R", "F"], ["U", "F", "L"], ["U", "L", "B"], ["U", "B", "R"], ["D", "F", "R"], ["D", "L", "F"], ["D", "B", "L"], ["D", "R", "B"]];
  const NORMAL = { U: [0, 1, 0], D: [0, -1, 0], R: [1, 0, 0], L: [-1, 0, 0], F: [0, 0, 1], B: [0, 0, -1] };
  const COR = { U: "#f4f3ee", D: "#f2c53d", F: "#2e9e5b", B: "#2f6fc4", R: "#c8423b", L: "#ee8a2a" };
  const EIXO = { U: ["y", 1], R: ["x", 0], F: ["z", 2] };
  const LADO = 0.2;
  const PASSO = 0.21;

  function montar({ cp, co }) {
    const grupo = new THREE.Group();
    const geoCorpo = new THREE.BoxGeometry(LADO, LADO, LADO);
    const geoAdesivo = new THREE.PlaneGeometry(LADO * 0.84, LADO * 0.84);
    const frente = new THREE.Vector3(0, 0, 1);
    for (let i = 0; i < 8; i++) {
      const peca = new THREE.Group();
      peca.position.set(...POS[i].map((v) => (v * PASSO) / 2));
      peca.userData.pos = POS[i];
      const corpo = new THREE.Mesh(geoCorpo, new THREE.MeshStandardMaterial({ color: "#1d2327", roughness: 0.8 }));
      peca.userData.corpo = corpo;
      peca.add(corpo);
      for (let n = 0; n < 3; n++) {
        const face = FACES[i][(n + co[i]) % 3];
        const cor = COR[FACES[cp[i]][n]];
        const adesivo = new THREE.Mesh(geoAdesivo, new THREE.MeshStandardMaterial({ color: cor, roughness: 0.55 }));
        const nrm = new THREE.Vector3(...NORMAL[face]);
        adesivo.quaternion.setFromUnitVectors(frente, nrm);
        adesivo.position.copy(nrm.multiplyScalar(LADO / 2 + 0.002));
        peca.add(adesivo);
      }
      grupo.add(peca);
    }
    return grupo;
  }

  // Gira uma camada animando no tick da cena (funciona também dentro do modo VR)
  AFRAME.registerComponent("cubo-giro", {
    init() {
      this.giros = [];
    },
    tick(_t, dt) {
      const g = this.giros[0];
      if (!g) return;
      g.t = Math.min(1, g.t + (dt || 16) / g.ms);
      const e = g.t < 0.5 ? 2 * g.t * g.t : 1 - Math.pow(-2 * g.t + 2, 2) / 2;
      g.pivo.rotation[g.eixo] = g.angulo * e;
      if (g.t >= 1) {
        this.giros.shift();
        g.fim();
      }
    }
  });

  window.Cubo3D = {
    criar(pai, estado, attrs = {}) {
      const el = document.createElement("a-entity");
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      el.setAttribute("cubo-giro", "");
      el.setObject3D("cubo", montar(estado));
      pai.appendChild(el);
      return el;
    },

    animar(el, mov, ms = 320) {
      return new Promise((fim) => {
        const grupo = el.getObject3D("cubo");
        const comp = el.components["cubo-giro"];
        if (!grupo || !comp) return fim();
        const [eixo, k] = EIXO[mov[0]];
        const pivo = new THREE.Group();
        grupo.add(pivo);
        grupo.children.filter((c) => c.userData.pos && c.userData.pos[k] > 0).forEach((c) => pivo.attach(c));
        comp.giros.push({ pivo, eixo, angulo: (mov.endsWith("'") ? 1 : -1) * (Math.PI / 2), ms, t: 0, fim });
      });
    },

    destacarCamada(el, mov) {
      const grupo = el?.getObject3D("cubo");
      if (!grupo) return;
      const k = mov ? EIXO[mov[0]][1] : -1;
      grupo.traverse((o) => {
        if (o.userData.corpo) o.userData.corpo.material.emissive.set(k >= 0 && o.userData.pos[k] > 0 ? "#2f8f86" : "#000000");
      });
    }
  };
})();
