# Auto-mine

Um bot que joga Minecraft Java 1.16.5 (servidor local, modo Peaceful). O **Claude** planeja e comanda; o
**Laya** (modelo de decisão local, `laya-serve` na porta 8000) escolhe cada passo das missões. Projeto feito
por um pai e o filho: fale em português simples e mostre resultado no jogo rápido.

Fork de [rmalde/minecraft-agent](https://github.com/rmalde/minecraft-agent) (remoto `upstream`), publicado em
`origin` (github.com/rodsgobbo/laya-mine, **público**). O agente original de speedrun do dragão saiu do repositório;
há uma cópia local em `_speedrun-original/`, ignorada pelo git. `README.md` e `COMO-JOGAR.md` são públicos: não
ponha neles nomes, IPs da rede de casa nem caminhos pessoais.

## Como as peças se ligam

```
Claude Desktop ──MCP──> mcp-server.mjs ──HTTP 127.0.0.1:3100──> desktop-bridge.mjs (dentro do missao.mjs)
                                                                   │
                        laya-serve :8000 <── models.mjs decide() ──┤── comandos.mjs (comandos diretos)
                                                                   │
                        servidor Minecraft :25576 <── Mineflayer ──┘── visualizador :3007 (prismarine-viewer)
```

| Arquivo | Papel |
|---|---|
| `missao.mjs` | O bot do dia a dia: missões (Laya escolhe entre ações geradas em `candidates()`) e comandos diretos |
| `comandos.mjs` | Comandos diretos do Claude (`executar_comandos`): cada ação é uma função em `actions` |
| `mcp-server.mjs` | Ferramentas do Claude Desktop. **Toda ação nova em `comandos.mjs` precisa entrar no `z.enum` e na descrição daqui** |
| `desktop-bridge.mjs` | Ponte local entre o MCP e o bot (estado, plano, comandos, cancelamento) |
| `models.mjs` | `decide()` chama o Laya; `plan()` chama a API da Anthropic (`PLANNER=api`) ou espera o Desktop (`PLANNER=desktop`, padrão do `missao.mjs`) |
| `viewer-follow.js`, `recording-client.js` | Botão de seguir o bot, relógio e HUD (barra de itens, vida, fome) no visualizador |
| `patch-pathfinder.mjs`, `prepare-viewer.mjs` | Ajustes em `node_modules` aplicados no `npm install`. **Nunca edite `node_modules` à mão**: ponha a mudança nesses scripts, idempotente (checa se já aplicou) |
| `iniciar.ps1`, `desligar.ps1`, `reiniciar-bot.ps1` | Ligar tudo (e liga o RCON, anota as janelas em `.janelas.json`), desligar tudo, reiniciar só o bot |
| `rcon.mjs` | Manda um comando de console ao servidor (`node rcon.mjs stop`), usado pelo `desligar.ps1` |
| `metricas.mjs` | Decisões do Laya vs do Claude e previsão de tokens por construção (lê `runs/*/events.jsonl` e `runs/mcp-uso.jsonl`) |
| `diag/buraco.mjs` | Segundo bot de diagnóstico para separar bug do pathfinder de estado preso do bot |

## Quem faz o quê

- **Laya** (missões, `definir_plano`): juntar material e craftar. É local e gratuito, e decide cada passo entre as
  opções que `candidates()` monta. Essas opções precisam ser específicas para a meta (ex.: missão de `birch_log`
  só oferece bétula; `coal` vem de `coal_ore`, mapa `dropSource`).
- **Claude** (comandos, `executar_comandos`): construir e ações pontuais. `minerar` direto recusa mais de 8 blocos
  e manda usar `definir_plano`: sem isso o Claude junta material por comando e gasta turnos em "esperar + coletar".
- Medido em 25/09/2026: missão de 8 troncos de bétula cumprida pelo Laya em 72 s, 10/10 decisões certas, zero
  turnos do Claude. O mesmo pelo Claude, por comando, levava vários minutos de espera e releitura.

## Ligar, reiniciar, ver

- Ligar tudo: `.\iniciar.ps1` (servidor, Laya, bot e navegador).
- Desligar tudo: `.\desligar.ps1` (bot, servidor, Laya e as janelas listadas em `.janelas.json`). O servidor
  recebe `stop` pelo RCON (`node rcon.mjs stop`, só em 127.0.0.1, senha no `server/server.properties`), que salva
  o mundo; só fecha à força se o RCON não responder. Nunca mate o `java` do servidor sem avisar o usuário.
- Reiniciar **só o bot** depois de mudar código: `.\reiniciar-bot.ps1` (ou `-Background`). O inventário e a posição
  ficam salvos no servidor. Mudanças em `mcp-server.mjs` só valem depois de fechar e abrir o Claude Desktop.
- **Antes de reiniciar o bot, pergunte ao usuário**: o reinício interrompe missão ou comando em andamento, e
  reiniciar no meio de um pedido já fez um pedido se perder.
- Visualizador: http://localhost:3007 (Ctrl+F5 depois de mudar `viewer-follow.js` ou `recording-client.js`).

## Onde olhar quando algo dá errado

- `runs/<partida>/events.jsonl`: uma linha JSON por evento. Tipos úteis: `decision` (ação do Laya e `result`;
  falha começa com `FAILED`), `commands`/`command` (comandos diretos; `ok:false` = falha), `plan_request`
  (`stuck...` = empacou), `mission_complete`, `fatal`, `death`. A partida mais recente é a pasta mais nova.
- A janela "Bot AutoMine" (ou `bot.log`/`bot-erros.log` com `-Background`).
- `http://127.0.0.1:3100/estado`: o mesmo estado que `ver_jogo` mostra.

## Como corrigir

1. Leia o `events.jsonl` e ache o primeiro erro, não o último.
2. `Action timeout` sem o bot sair do lugar costuma ser o pathfinder travado, não falta de tempo. Compare com
   `node diag/buraco.mjs` (um segundo bot, "Diag", cava um buraco e tenta sair). Se o Diag sai e o bot não,
   o bot está num estado preso: ache a causa no código e reinicie.
3. Faça a menor mudança que resolve e confira com `node --check <arquivo>`. Não há testes automáticos do bot
   de missões (os que existiam eram do speedrun): a prova é no jogo.
4. Explique ao usuário o que quebrou e o que mudou, e peça para reiniciar.

### Problemas no visualizador (o que aparece na tela)

Você não vê a tela pelo MCP: peça ao usuário uma descrição ou captura de tela, ou abra http://localhost:3007
no navegador se tiver essa ferramenta. Cruze com as criaturas e blocos de `ver_jogo`.

- O que roda no navegador é o pacote compilado `node_modules/prismarine-viewer/public/index.js` (minificado).
  Ajuste com substituição de texto em `prepare-viewer.mjs`: ache o trecho exato, troque só se ainda não foi
  trocado e avise no console se o trecho mudou. Depois rode `node prepare-viewer.mjs` duas vezes (a segunda
  não pode mudar nada), `node --check` no pacote, e peça Ctrl+F5. Não precisa reiniciar o bot.
- Rotas que o bot serve ao visualizador ficam em `node_modules/prismarine-viewer/lib/mineflayer.js` (também
  via `prepare-viewer.mjs`): `/am-time` (relógio) e `/am-status` (HUD, vem de `bot.amStatus` no `missao.mjs`).
  Mudanças aqui exigem reiniciar o bot.
- **Caixa magenta/rosa = criatura sem modelo** no visualizador. Confira o nome em `ver_jogo` e se ele existe em
  `node_modules/prismarine-viewer/viewer/lib/entity/entities.json`. Se não existir, acrescente ao mapa de
  apelidos em `prepare-viewer.mjs` (ex.: `trader_llama:"llama"`) apontando para o modelo mais parecido.
  Itens no chão (`item`) são desenhados com a imagem do próprio item: o `worldView.js` manda o nome (`item`) e o
  pacote cria um sprite que recebe a imagem quando `item-textures.json` carrega. Quadradinho cinza que não vira
  imagem = item sem entrada nesse JSON.
- O visualizador não desenha dia/noite, luz, nem a camada de enfeite de alguns bichos. Isso é limite dele.

Bugs já corrigidos, para não reintroduzir: trava de equipar do pathfinder presa para sempre após uma falha
(`patch-pathfinder.mjs`); mesa colocada colada no bot recusada pelo servidor (`placeTable` tenta a 2 blocos);
Laya escolhendo "esperar" quando havia ação útil (só é oferecido se não houver outra); lhamas do comerciante
como caixas magenta (apelido `trader_llama`→`llama` no `prepare-viewer.mjs`); capim e outros blocos sem hitbox
impossíveis de minerar (`mineBlock` usa `GoalNear` para eles) e de substituir (`colocar_bloco` aceita a lista
`replaceable`); servidor recusando bloco dentro do jogador (`colocar_bloco` sai da frente antes); comando que estourava o tempo
continuava rodando escondido e disputava o pathfinder com o próximo ("The goal was changed"): o executor em
`comandos.mjs` marca o passo como cancelado, os laços checam `checkCancelled()`, e o teto de `minerar` cresce
com a quantidade. Laço novo em comando precisa chamar `checkCancelled()`. Missão de um tipo de tronco (`birch_log`)
cortava qualquer árvore e nunca terminava: `candidates()` só oferece o tipo pedido. Coleta em quantidade vai para
o Laya: `minerar` direto recusa mais de 8 blocos e manda usar `definir_plano` (era o Claude gastando turnos esperando).

## Onde paramos (26/09/2026)

Funcionando: ligar/desligar com um comando (RCON salva o mundo), visualizador com HUD, câmera que segue, relógio
e itens no chão desenhados; comandos diretos com `ver_blocos` e `hotbar`; missões do Laya sendo usadas pelo Claude
Desktop por causa da trava do `minerar`. Em 26/09/2026 o speedrun saiu do repositório, a documentação foi
reescrita e o projeto foi publicado como fork público.

Próximos passos, na ordem combinada:

1. **Expor o `construir`.** Já existe em `comandos.mjs` (formas `cheio`, `paredes`, `oca`; de baixo para cima,
   limpa folhas e capim, pula o que já está pronto), mas **não está** no `z.enum` nem na descrição do
   `mcp-server.mjs`, e nunca foi testado. Testar numa área livre antes de expor.
2. **Blocos altos com `Action timeout`.** `placeAt` aproxima com `GoalNear(alvo, 3)`; no teto isso obriga a subir
   e estoura 30 s. Trocar por `goals.GoalPlaceBlock` do pathfinder, que acha qualquer lugar de onde dá para
   colocar o bloco.
3. **Laya como vigia:** perguntas `noul` (sim/não) a cada passo, como lava perto, noite com o bot fora de casa ou
   fome baixa, usando o mesmo `laya-serve`.
4. **Treinar o Laya** com as partidas (`runs/*/events.jsonl`): é a vantagem de ele ter pesos abertos.
5. **Decisão pendente do usuário:** liberar o servidor para outro computador da rede (hoje `server-ip=127.0.0.1`
   e `online-mode=false`; liberar deixa qualquer um na rede de casa entrar com qualquer nome).

## Regras

- Não faça commit sem o usuário pedir.
- Servidor do Minecraft, Laya e ponte ficam só em `127.0.0.1`. Não abra portas para a rede (o visualizador,
  só leitura, é a única exceção). Nada de ferramenta MCP que edite arquivos ou rode código: o jogo não pode
  virar porta de entrada para o computador.
- Chave da API só por variável de ambiente (`ANTHROPIC_API_KEY`), nunca em arquivo.
- Nomes de itens e blocos: os do Minecraft 1.16.5 em inglês (`oak_log`, `stone_pickaxe`).
