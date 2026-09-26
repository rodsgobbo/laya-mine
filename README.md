# laya-mine

Um bot que joga Minecraft Java 1.16.5 sozinho, num servidor local. O **Claude** (pelo Claude Desktop) planeja e
dá as ordens, e o **[Laya](https://huggingface.co/convaiinnovations/laya)**, um modelo de decisão que roda no
próprio computador, escolhe cada passo das missões. Projeto feito por um pai e o filho.

- **Missões** (juntar material e craftar): o Claude diz o que quer, por exemplo *"30 pedregulhos e 10 troncos de
  bétula"*, e o Laya decide sozinho cada ação até terminar. É local e não gasta nada.
- **Comandos diretos** (construir e ações pontuais): o Claude manda e o bot faz na hora, por exemplo *"coloque
  pedregulho aqui"*, *"equipe a picareta"* ou *"abra o baú"*.
- **Visualizador** no navegador, com barra de itens, vida, fome, relógio e câmera que segue o bot. Também dá para
  assistir pelo tablet ou pelo celular na mesma rede.

```
Claude Desktop ──MCP──> mcp-server.mjs ──HTTP 127.0.0.1:3100──> desktop-bridge.mjs (dentro do missao.mjs)
                                                                   │
                        laya-serve :8000 <── models.mjs decide() ──┤── comandos.mjs (comandos diretos)
                                                                   │
                        servidor Minecraft :25576 <── Mineflayer ──┘── visualizador :3007
```

Os scripts de ligar e desligar são para **Windows** (PowerShell). O código do bot é Node.js e roda em qualquer
sistema, mas em outro sistema é preciso iniciar as peças à mão.

## Instalação

Você precisa de:

- [Node.js](https://nodejs.org) 20 ou mais novo
- [Python](https://www.python.org) 3.10 ou mais novo
- Java 17 ([Eclipse Temurin](https://adoptium.net/temurin/releases/?version=17), que o `iniciar.ps1` procura em
  `C:\Program Files\Eclipse Adoptium\jdk-17*`)
- [Claude Desktop](https://claude.ai/download)
- Minecraft Java Edition 1.16.5, só se você quiser entrar no mundo junto com o bot

### 1. Bot

```powershell
git clone https://github.com/rodsgobbo/laya-mine.git
cd laya-mine
npm install
```

O `npm install` também roda `patch-pathfinder.mjs` e `prepare-viewer.mjs`, que ajustam dois pacotes do
`node_modules`. Os dois podem rodar mais de uma vez sem problema.

### 2. Laya

```powershell
python -m venv .venv
.\.venv\Scripts\pip install "laya[serve]"
```

Na primeira vez em que liga, o Laya baixa os pesos do Hugging Face e roda na CPU.

### 3. Servidor do Minecraft

Crie a pasta `server/`, baixe nela o `server.jar` oficial da versão **1.16.5** e aceite o EULA:

```powershell
mkdir server
# coloque server.jar dentro de server\
cd server
$java = (Get-ChildItem "C:\Program Files\Eclipse Adoptium\jdk-17*\bin\java.exe")[0].FullName
& $java -jar server.jar nogui   # na primeira vez, gera os arquivos e para
(Get-Content eula.txt) -replace 'eula=false','eula=true' | Set-Content eula.txt
cd ..
```

No `server/server.properties`, deixe estas linhas:

```properties
server-ip=127.0.0.1
server-port=25576
online-mode=false
difficulty=peaceful
spawn-protection=0
rcon.password=
```

O `iniciar.ps1` liga o RCON e gera sozinho uma senha aleatória para ele na primeira vez. Com ela, o
`desligar.ps1` salva o mundo antes de fechar o servidor.

### 4. Claude Desktop

Abra o arquivo `%APPDATA%\Claude\claude_desktop_config.json` e acrescente o servidor MCP, trocando o caminho pelo
da sua pasta:

```json
{
  "mcpServers": {
    "auto-mine": {
      "command": "node",
      "args": ["C:\\caminho\\para\\laya-mine\\mcp-server.mjs"]
    }
  }
}
```

Feche e abra o Claude Desktop. As ferramentas `ver_jogo`, `definir_plano` e `executar_comandos` devem aparecer.

## Uso

```powershell
.\iniciar.ps1      # liga o servidor, o Laya e o bot, e abre o visualizador
.\desligar.ps1     # desliga tudo e salva o mundo
```

Depois disso, é só pedir as coisas no Claude Desktop. O guia completo, com exemplos de pedidos, o visualizador e o
que fazer quando o bot empaca, está em **[COMO-JOGAR.md](COMO-JOGAR.md)**.

## Arquivos

| Arquivo | Papel |
|---|---|
| `missao.mjs` | O bot: conecta no servidor, roda as missões (o Laya escolhe entre as ações que `candidates()` monta) e os comandos diretos |
| `comandos.mjs` | Comandos diretos do Claude. Cada ação é uma função em `actions` |
| `mcp-server.mjs` | Ferramentas que o Claude Desktop enxerga |
| `desktop-bridge.mjs` | Ponte local entre o MCP e o bot |
| `models.mjs` | `decide()` chama o Laya. `plan()` espera o plano do Claude Desktop ou chama a API da Anthropic (`PLANNER=api`) |
| `viewer-follow.js`, `recording-client.js` | Câmera que segue o bot, relógio e barra de itens no visualizador |
| `patch-pathfinder.mjs`, `prepare-viewer.mjs` | Ajustes em `node_modules` aplicados no `npm install` |
| `iniciar.ps1`, `desligar.ps1`, `reiniciar-bot.ps1` | Ligar tudo, desligar tudo, reiniciar só o bot |
| `rcon.mjs` | Manda um comando ao console do servidor (`node rcon.mjs stop`) |
| `metricas.mjs` | Quantas decisões foram do Laya e quantas do Claude, e a estimativa de tokens por construção |
| `diag/buraco.mjs` | Segundo bot de diagnóstico, para separar bug do pathfinder de bot preso |
| `CLAUDE.md` | Instruções para o Claude (Claude Code ou Claude Desktop com acesso à pasta) consertar o bot |

Cada partida grava um registro em `runs/<partida>/events.jsonl`, com uma linha por decisão, comando e erro.

## Segurança

Tudo roda em `127.0.0.1`: o servidor do Minecraft, o Laya e a ponte do MCP. A única exceção é o visualizador, que
só permite olhar. O servidor usa `online-mode=false`, então **não o exponha à internet**, porque qualquer pessoa
entraria com qualquer nome. As ferramentas MCP só controlam o bot no jogo: nenhuma lê ou edita arquivos, e nenhuma
roda comandos no computador.

A chave da API da Anthropic, usada só no modo automático (`PLANNER=api`), é lida da variável de ambiente
`ANTHROPIC_API_KEY` e nunca fica em arquivo.

## Créditos

Este projeto começou como fork de [rmalde/minecraft-agent](https://github.com/rmalde/minecraft-agent), um agente
de speedrun até o Ender Dragon. O bot e os ajustes no pathfinder e no visualizador vieram de lá. Aqui ficou só a
parte de missões e comandos, com o Laya no lugar do modelo de decisão original.

- [Laya](https://huggingface.co/convaiinnovations/laya), da Convai Innovations (Apache-2.0)
- [Mineflayer](https://github.com/PrismarineJS/mineflayer),
  [mineflayer-pathfinder](https://github.com/PrismarineJS/mineflayer-pathfinder) e
  [prismarine-viewer](https://github.com/PrismarineJS/prismarine-viewer)

O projeto original não tem licença publicada, então este fork também não declara uma.
