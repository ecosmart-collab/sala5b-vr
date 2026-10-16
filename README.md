# Sala VR + n8n

Sala 3D multiusuário em WebXR (A-Frame 1.7 + Networked-Aframe 0.14, adapter Socket.IO) com um botão que dispara um webhook no n8n.

```
Navegador / Óculos ──socket.io──► server.js (sinalização NAF)
       │ clique no botão
       └──POST /api/acionar──► server.js ──POST + X-VR-Secret──► n8n /webhook/vr-botao
                                         ◄── { ok, mensagem } ── (mensagem aparece no painel 3D)
```

A URL e o segredo do n8n ficam só no servidor (`.env`), nunca no navegador.

## Rodar

```bash
npm install
cp .env.example .env      # ajuste N8N_WEBHOOK_URL e N8N_WEBHOOK_SECRET
npm start                 # http://localhost:8080
```

A página inicial (`/`) só tem dois botões: "Entrar com código" (óculos) e "Painel do profissional". A sala de demonstração com o botão do n8n fica em `/demo` e, assim como `/api/acionar`, exige o login do profissional. Parâmetros de URL da demonstração: `/demo?nome=Elton&sala=reuniao`.

Sem n8n disponível: `npm run mock-n8n` e use `N8N_WEBHOOK_URL=http://localhost:5678/webhook/vr-botao`.

## No óculos (Quest)

WebXR exige HTTPS (exceto `localhost`). Duas opções:

1. **Rede local:** `npm run start:https` → abra `https://<IP-do-PC>:8080/paciente.html` no Meta Quest Browser, aceite o aviso de certificado e clique em “Enter VR”. Libere a porta 8080 no Firewall do Windows.
2. **Cabo USB:** `adb reverse tcp:8080 tcp:8080` → no óculos abra `http://localhost:8080/paciente.html` (sem aviso de certificado).

Controles: analógico anda, gatilho no laser clica no botão. No PC: WASD + mouse.

## n8n

Importe `n8n/TRIGGER-VR-Botao-Sala.json`, crie uma credencial **Header Auth** (nome `X-VR-Secret`, valor = `N8N_WEBHOOK_SECRET`), selecione no node *Webhook Botão VR* e ative o workflow.

Payload recebido: `{ evento, botao, sala, usuario, timestamp }`.

## Sala 5B (atendimento individual)

O profissional controla pelo painel (tablet/PC) e a pessoa atendida usa o óculos.

| Endereço | Quem usa | Acesso |
|---|---|---|
| `/terapeuta` | profissional | login (usuário/senha do `.env`) |
| `/paciente.html` | pessoa atendida | código de 6 letras da sala ativa |

**Configurar o login:**

```bash
npm run criar-senha -- "sua senha forte"
```

Cole as duas linhas geradas (`TERAPEUTA_SENHA_HASH` e `SESSION_SECRET`) no `.env`.

**Fluxo:** criar o encontro (código da pessoa, objetivo, 40/60 min) → digitar o código da sala no óculos → conduzir B1–B5 → *Encerrar encontro* (participação 1–5, resultado demonstrado, percepção da pessoa, continuidade).

- **B1–B5:** o painel cronometra cada bloco e mostra o tempo de referência; pausas são contadas à parte.
- **Cena:** respiração guiada (opcional), check-in por palavras e cores (sem números) e som ambiente.
- **Lógico-matemático:** contagem, comparação (mais/menos) e adição com blocos. Apoios: número de opções, destaque visual da resposta, próxima automática. Ao errar, a opção escolhida some, até restarem duas. O servidor corrige as respostas e mede o tempo.
- **Cubo 2×2 (grafo de estados):** implementação própria, escrita do zero. O servidor calcula por busca em largura (BFS) a distância de todas as 3.674.160 configurações até a solução, em cerca de 0,5 s ao iniciar. A tela mostra o cubo em 3D, a vista de trás, o grafo local (estado atual e seus 6 vizinhos, um por giro) e o caminho mais curto. Apoios: quantos giros até resolver (1–8), giros na tela (6, 3 ou 2, sempre com um que aproxima), cores no grafo e destaque do giro que aproxima. Cada giro fica registrado como "aproximou" ou "afastou", com a distância antes e depois. Sugerido para B3 e B4.
- **Palavra (letras ou sílabas):** o profissional digita uma lista (`BO-LA, CA-SA, TA-PU`), em que o hífen separa as sílabas; aceita pseudopalavras. A pessoa toca as peças na ordem da palavra.
  - *Em ordem*: peças alinhadas, com a próxima destacada se o apoio estiver ligado; sugerido para B2.
  - *Embaralhadas em arco*: peças espalhadas por cerca de 60° à frente da pessoa; sugerido para B3 e B4.
  - Um toque fora de ordem não apaga a peça: ela balança, e a pessoa tenta de novo.
  - Botão "Ouvir" opcional, com a voz do navegador.
  - Com "próxima automática", a lista avança palavra por palavra. O B5 mostra as palavras concluídas.
  - Cada toque fica registrado com a posição, a peça esperada e o tempo.
- **Alvos (aquecimento do laser/olhar):** aparece um círculo de cada vez, começando no centro, e a pessoa aponta e toca. Sugerido no B1, para conferir se o controle ou o olhar estão confortáveis antes das atividades.
  - O profissional escolhe a quantidade (5 ou 9), o tamanho (grande, médio ou pequeno) e a área (perto do centro ou mais aos lados).
  - Fica registrado o tempo até acertar cada alvo e os toques fora dele. Com o laser ou o mouse, o toque fora conta; com o olhar, nunca conta.
  - É um registro do uso do controle, não uma avaliação da pessoa.
- **Categorias (mercado):** uma gôndola com 3 prateleiras e um carrinho. A pessoa coloca no carrinho só os itens da categoria pedida: frutas, bebidas, limpeza ou padaria. São 20 produtos em 3D, com nomes acentuados opcionais.
  - O profissional escolhe a categoria, quantos itens coletar (1 a 5) e quantos itens de outras categorias aparecem (0 a 10).
  - **Troca de regra:** mantém a mesma prateleira e muda só a categoria pedida. Funciona também depois de trocar de bloco, por exemplo do B3 para o B4. A troca entra na linha do tempo.
  - Um item de outra categoria pisca em cinza, com som neutro, e continua na prateleira. O destaque (apoio visual) marca o próximo item da categoria pedida.
  - **Pegar e levar ao carrinho** (opcional): a pessoa toca no item, que passa a acompanhar o laser, o mouse ou a mira de olhar, e depois toca no carrinho para soltar.
    - Tocar em outro item troca o que está na mão.
    - Tocar na gôndola com o laser ou o mouse devolve o item; a mira de olhar não devolve.
    - Item de outra categoria solto no carrinho volta para a prateleira e pisca.
    - O registro diz "levado ao carrinho".
  - Cada toque registra o item, a categoria do item, a categoria pedida, o tempo, o apoio e o modo (olhar ou apontar).
- **Tempo no óculos:** o painel mostra o tempo contínuo e o total de uso, marcando se a pessoa está em VR ou na tela.
  - "Em uso" quer dizer conectado e fora de pausa. Um descanso de 1 min ou mais zera o tempo contínuo.
  - Ao atingir o limite (padrão de 20 min; dá para escolher entre 10 e 40), aparece um aviso no painel. Opcionalmente, aparece também um aviso discreto no óculos.
  - Há duas pausas: *no óculos* (cena calma) e *para tirar o óculos*. O aviso fica registrado na linha do tempo.
- **Espelho ao vivo:** mostra no painel o que a pessoa vê, em cerca de 1,5 quadro por segundo, inclusive dentro do modo VR. Só funciona enquanto o painel pede, vai apenas para o profissional logado naquela sala e não é gravado.
- **Apoio em cada resposta:** o profissional marca o nível de apoio antes da resposta: independente, gestual, verbal, visual, modelo ou físico.
  - Por padrão, o nível volta para "independente" depois de cada resposta, o que ajuda a retirar o apoio aos poucos.
  - Dá para corrigir o apoio da última resposta; a correção aparece com `*`.
  - O painel mostra quantas respostas foram dadas sem apoio. O CSV inclui as colunas `apoio` e `modo`.
- **Resposta pelo olhar:** opcional, para quem não usa os controles. A pessoa escolhe uma opção fixando o olhar nela por 1, 1,5, 2 ou 3 s, enquanto um anel vai se completando. Cada resposta registra se veio "pelo olhar" ou "apontando".
- **Desconforto no encerramento:** é obrigatório marcar "nenhum desconforto relatado" ou pelo menos um sintoma: enjoo, tontura, dor de cabeça, cansaço nos olhos, visão dupla, peso ou ajuste do óculos, ou outro. O registro inclui uma observação e o tempo de uso do óculos.
- **Sem resposta (omissão):** "Tempo para responder" é opcional (10, 20, 30 ou 60 s). Se a pessoa não responder dentro do tempo, o sistema registra uma omissão e recomeça a contagem. Respostas, pausas e reconexões também recomeçam a espera, e o tempo com o óculos desconectado não conta. As omissões ficam à parte das respostas: aparecem no painel, no CSV e nos relatórios.
- **Tamanho e contraste:** na atividade Palavra, as peças podem ser normais, grandes ou muito grandes, limitadas para caber no quadro ou no arco. Em Cena, o alto contraste deixa o quadro preto, as peças brancas com texto preto e o destaque amarelo.
- **Registro:** apoios por bloco (demonstração, instrução verbal…), observações com salvamento automático e linha do tempo.

**Relatórios** (na lista de encontros do painel; botão "Imprimir / salvar PDF"):
- **Relatório:** documento do profissional, com tempo, acertos, respostas sem apoio e omissões por bloco, observações, uso do óculos, desconforto e encerramento.
- **Família:** linguagem simples, com o que foi feito, o que foi observado, o uso do óculos e os próximos passos. Não mostra a escala de 1 a 5 nem os níveis de apoio.
- **Registro mensal:** escolha o código da pessoa e o mês. Mostra uma tabela por encontro, a participação mais frequente com a variação no mês, as respostas sem apoio, o desconforto e as evidências por bloco.

**Dados:** um arquivo por sala em `data/sessoes/<CÓDIGO>.json`, fora de `public/`. A gravação é atômica, e as sessões ativas são retomadas se o servidor reiniciar. Exportação em JSON e CSV pelo painel (somente com login). Use códigos em vez de nomes: são dados de saúde (LGPD).

## VPS (Easypanel)

O `Dockerfile` já vem configurado: Node 24, porta 8080, dados em `/data`, `TRUST_PROXY` e `COOKIE_SECURE` ligados, e verificação de saúde em `/api/health`.

1. Coloque o projeto num repositório Git privado, sem `.env`, `data/` e `certs/`, que já estão no `.gitignore` e no `.dockerignore`.
2. No Easypanel, crie um serviço **App** e escolha o repositório como fonte, com build por **Dockerfile**.
3. Em **Environment**, configure: `TERAPEUTA_USUARIO`, `TERAPEUTA_SENHA_HASH` e `SESSION_SECRET` (gere com `npm run criar-senha -- "senha"`). Se usar o n8n, configure também `N8N_WEBHOOK_URL` e `N8N_WEBHOOK_SECRET`.
4. Em **Mounts**, crie um volume montado em `/data` e inclua esse volume no backup.
5. Em **Domains**, aponte um subdomínio (por exemplo `sala5b.seudominio`) para a porta **8080**. O HTTPS é emitido automaticamente, e o WebSocket passa sem configuração extra.
6. No Quest, abra `https://sala5b.seudominio/paciente.html`, que já tem certificado válido e não mostra aviso.
