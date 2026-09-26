# Como jogar o Auto-mine

O bot joga Minecraft sozinho. O **Claude** decide a missão, e o **Laya** escolhe cada ação.

Este guia parte do ponto em que tudo já está instalado. Para instalar, veja o [README](README.md#instalação).

## 1. Ligar tudo

No PowerShell, dentro da pasta do projeto:

```powershell
.\iniciar.ps1
```

O script abre três janelas (servidor do Minecraft, Laya e o bot) e depois o navegador, onde dá para ver o bot.
O Laya leva uns 30 segundos para carregar. No fim, o script mostra os endereços para assistir e para entrar no jogo.

## 2. Assistir

- **Neste computador:** http://localhost:3007
- **Pelo tablet ou celular (na mesma rede Wi-Fi):** o endereço aparece no fim do `iniciar.ps1` (ex.: `http://192.168.0.20:3007`).
- **Entrando no jogo:** abra o Minecraft Java **1.16.5**, vá em Multijogador e entre em `127.0.0.1:25576`.
  Por enquanto só dá para entrar deste computador.
- **Na janela "Bot AutoMine":** cada ação escolhida pelo Laya aparece ali.

No visualizador:

- **Barra de baixo:** itens do bot, o espaço selecionado, corações e fome, como no jogo.
- **Faixa de cima:** a missão e o que o bot está fazendo agora.
- **Botão 🎥 (ou tecla F):** a câmera segue o bot ou fica livre. O zoom e o ângulo continuam os seus.
- **Relógio ☀️/🌙:** a hora do jogo. O visualizador não escurece à noite.
- Depois de um reinício, recarregue com **Ctrl+F5**.

## 3. Dar uma missão

No Claude Desktop, é só pedir. O trabalho é dividido assim:

**Missão (o Laya decide cada passo, sozinho e de graça)**, para **juntar material e craftar**:

- *"Junte 30 pedregulhos e 10 troncos de bétula."*
- *"Faça uma picareta de pedra."*
- *"Junte 20 carvões."*

**Comando direto (o Claude manda, o bot faz na hora)**, para **construir e ações pontuais**:

- *"Construa uma parede de pedregulho daqui até ali."*
- *"Equipe a picareta e coloque no espaço 1 da barra."*
- *"Vá até a vaca mais perto e ataque."*
- *"Abra o baú mais perto e me diga o que tem."*

Se o Claude tentar minerar mais de 8 blocos por comando direto, o bot recusa e ele passa a tarefa para o Laya
sozinho. Para garantir desde o começo, peça: *"use uma missão do Laya para isso"*.

Se algo der errado:

- *"O bot empacou? Olhe as últimas ações e mude o plano."*
- *"Cancele a missão."*
- *"Fique acompanhando: espere o bot pedir um plano novo e mande a próxima missão."*

Quando o bot termina uma missão, ou quando empaca, a janela do bot mostra:
`>>> O agente precisa de um novo plano`. Aí é só pedir a próxima ao Claude.

## Speedrun do dragão

O bot tenta ir do zero até matar o Ender Dragon. O Laya escolhe cada ação, e o Claude diz o objetivo de cada etapa.

1. Se estiver tudo ligado, desligue: `.\desligar.ps1`.
2. Ligue no modo speedrun: `.\iniciar.ps1 -Speedrun`. Ele cria um mundo novo, sempre com a mesma semente.
3. No Claude Desktop, peça:
   *"Vamos fazer o speedrun do dragão. Veja o jogo, siga as instruções do pedido e fique respondendo cada pedido
   de plano até o bot sair pelo portal do End."*
4. Assista em http://localhost:3007.

Para parar no meio, crie um arquivo chamado `stop` na pasta da partida (`runs\speedrun-...`): o bot termina a
ação atual e para. Para voltar às missões, rode `.\desligar.ps1` e depois `.\iniciar.ps1`. O mundo das missões
volta sozinho.

## Quem jogou mais: o Laya ou o Claude?

```powershell
node metricas.mjs
```

Mostra quantas decisões cada um tomou e quantas deram certo, e quantos tokens do Claude uma construção gasta
(por exemplo, `node metricas.mjs --blocos 80` para uma torre).

## Quando o bot der erro

Com a pasta do projeto aberta no Claude Desktop (modo com acesso a pastas), peça:
*"O bot deu erro. Olhe o log da última partida, ache a causa e corrija."*
O Claude lê o `CLAUDE.md` da pasta, que explica como o projeto funciona, e pergunta antes de reiniciar o bot.

## Para desligar

```powershell
.\desligar.ps1
```

Ele desliga tudo que o `iniciar.ps1` abriu, sem você fechar nada: o bot, o servidor do Minecraft (que **salva
o mundo** antes de fechar), o Laya e as três janelas. Só a aba do visualizador no navegador fica aberta.

O Claude Desktop pode ficar aberto: sem o bot, as ferramentas do Auto-mine só avisam que o agente não está rodando.

## Modo automático (usa a API paga)

Com uma chave da API da Anthropic, o bot planeja sozinho, sem o Claude Desktop:

```powershell
$env:ANTHROPIC_API_KEY='sk-ant-...'; $env:PLANNER='api'; $env:MISSAO='fazer uma picareta de pedra'; npm run missao
```
