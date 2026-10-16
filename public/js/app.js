/* Inicialização: nome do usuário, sala (via ?sala=&nome=), schemas NAF e conexão */
(function () {
  const params = new URLSearchParams(location.search);
  window.VR_SALA = (params.get("sala") || "sala-principal").replace(/[^\w-]/g, "").slice(0, 40);
  window.VR_USUARIO = (params.get("nome") || "Visitante-" + Math.floor(Math.random() * 9000 + 1000)).slice(0, 30);

  const hud = document.getElementById("hud");
  const setHud = () => {
    const n = Object.keys(NAF.connection.connectedClients || {}).length + 1;
    hud.textContent = `${window.VR_USUARIO} · sala "${window.VR_SALA}" · ${n} pessoa(s) · WASD/analógico para andar`;
  };

  // O que é sincronizado no avatar: posição/rotação + cor + nome
  NAF.schemas.add({
    template: "#head-template",
    components: [
      "position",
      "rotation",
      { selector: ".head", component: "material", property: "color" },
      { selector: ".nametag", component: "text", property: "value" }
    ]
  });
  NAF.schemas.add({ template: "#rig-template", components: ["position", "rotation"] });

  const scene = document.querySelector("a-scene");
  const start = () => {
    scene.setAttribute("networked-scene", "room", window.VR_SALA);
    scene.emit("connect");
  };
  scene.hasLoaded ? start() : scene.addEventListener("loaded", start);

  document.body.addEventListener("connected", () => {
    document.body.dispatchEvent(new Event("naf-pronto"));
    setHud();
    // Coloca o nome no avatar local (é replicado para os outros)
    const t = setInterval(() => {
      const tag = document.querySelector("#player .nametag");
      if (tag) {
        tag.setAttribute("text", "value", window.VR_USUARIO);
        clearInterval(t);
      }
    }, 200);
  });
  document.body.addEventListener("clientConnected", setHud);
  document.body.addEventListener("clientDisconnected", setHud);
})();
