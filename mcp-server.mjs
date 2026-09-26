// MCP server for Claude Desktop: lets Claude read the running agent's game state and send it plans.
// Claude Desktop starts this over stdio; it talks to desktop-bridge.mjs inside the agent at 127.0.0.1.
// stdout carries the MCP protocol, so diagnostics go to stderr only.
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod';
const base='http://127.0.0.1:'+(process.env.BRIDGE_PORT||3100);
const offline='O agente não está rodando. Peça para iniciar com "npm run missao" na pasta Auto-mine (com o servidor do Minecraft e o laya-serve ligados).';
async function bridge(path,init,timeoutMs=10000){
 try{const r=await fetch(base+path,{...init,signal:AbortSignal.timeout(timeoutMs)});const data=await r.json();if(!r.ok)throw Error(data.error||'HTTP '+r.status);return data;}
 catch(e){if(/fetch failed|ECONNREFUSED/i.test(e.message+(e.cause?.code||'')))throw Error(offline);throw e;}
}
// Size of every tool call (what Claude writes and reads), for the token estimates in metricas.mjs.
import fs from 'node:fs';import {fileURLToPath} from 'node:url';
const usageFile=fileURLToPath(new URL('./runs/mcp-uso.jsonl',import.meta.url));
const record=(tool,args,out)=>{try{fs.mkdirSync(fileURLToPath(new URL('./runs/',import.meta.url)),{recursive:true});fs.appendFileSync(usageFile,JSON.stringify({time:new Date().toISOString(),tool,inChars:JSON.stringify(args||{}).length,outChars:out.content.reduce((s,c)=>s+(c.text||'').length,0)})+'\n');}catch{}return out;};
const text=value=>({content:[{type:'text',text:typeof value==='string'?value:JSON.stringify(value,null,1)}]});
const fail=e=>({content:[{type:'text',text:e.message}],isError:true});
const server=new McpServer({name:'auto-mine',version:'0.1.0'});
// Tools without inputSchema receive only `extra`; tools with one receive (args, extra).
const register=server.registerTool.bind(server);
server.registerTool=(name,config,cb)=>register(name,config,config.inputSchema?async(args,extra)=>record(name,args,await cb(args,extra)):async extra=>record(name,{},await cb(extra)));
server.registerTool('ver_jogo',{
 title:'Ver o jogo',
 description:'Mostra o estado atual do bot no Minecraft: posição, vida, fome, inventário, blocos e itens por perto, o plano atual, as últimas ações e se o agente está esperando um plano novo (campo "pedido"). Use antes de definir um plano.',
},async()=>{try{return text(await bridge('/estado'));}catch(e){return fail(e);}});
server.registerTool('definir_plano',{
 title:'Definir plano',
 description:`Dá uma MISSÃO ao bot: o modelo Laya (local e gratuito) decide sozinho cada passo até o inventário ter os itens pedidos (ou o bot chegar ao destino).
USE ESTA FERRAMENTA PARA TODA COLETA E TODO CRAFTING: juntar pedra, troncos, carvão, areia; fazer ferramentas, tochas, tábuas. Ex.: itens [{cobblestone,40},{oak_log,10}] ou [{stone_pickaxe,1}]. É bem mais rápido e barato do que mandar minerar bloco a bloco com executar_comandos: você manda uma vez e o Laya trabalha enquanto você espera.
O Laya sabe: cortar árvores, minerar pedra (vira cobblestone) e minérios (coal_ore dá coal etc.), minerar blocos visíveis pelo nome, recolher itens, craftar (inclusive os ingredientes intermediários), colocar a mesa, comer, andar até o destino e explorar.
Depois de definir: chame esperar_pedido_de_plano (repita até "pedido" vir preenchido) para saber quando a missão acabou ou empacou, e aí veja o jogo.
Toda missão precisa de itens ou destino. Para construir (colocar blocos em lugares exatos) e ações pontuais (equipar, atacar, abrir baú, falar), use executar_comandos.
Itens usam os nomes do Minecraft 1.16.5 em inglês (oak_log, stick, crafting_table, cobblestone, coal, torch...).`,
 inputSchema:{
  objetivo:z.string().min(1).describe('O que o bot deve fazer agora, numa frase curta'),
  itens:z.array(z.object({item:z.string().describe('Nome do item no Minecraft, ex: oak_log'),quantidade:z.number().int().positive()})).optional().describe('Itens que o bot deve ter no inventário ao terminar'),
  destino:z.object({x:z.number(),y:z.number(),z:z.number()}).optional().describe('Ponto do mapa para onde o bot deve andar, se houver'),
  notas:z.string().optional().describe('Dicas extras para o bot'),
 },
},async({objetivo,itens,destino,notas})=>{
 try{
  if(!itens?.length&&!destino)return fail(Error('Missão sem itens nem destino não tem como terminar. Inclua os itens que o bot deve ter ao final, um destino, ou use executar_comandos para ações diretas.'));
  const body={objective:objetivo,targets:Object.fromEntries((itens||[]).map(i=>[i.item,i.quantidade])),waypoint:destino||null,notes:notas||''};
  const r=await bridge('/plano',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  return text(r.atendeu_pedido?'Plano enviado. O bot estava esperando e já começou.':'Plano enviado. O bot passa a seguir este plano.');
 }catch(e){return fail(e);}
});
const item=z.object({item:z.string(),quantidade:z.number().int().positive().optional()});
server.registerTool('executar_comandos',{
 title:'Executar comandos',
 description:`Manda o bot fazer passos específicos AGORA, em ordem, e devolve o resultado de cada um. Serve para CONSTRUIR e para ações pontuais. Para JUNTAR material em quantidade (minerar dezenas de blocos, cortar árvores, craftar ferramentas), use definir_plano: o Laya faz sozinho, mais rápido e sem gastar seus turnos. Não precisa usar "olhar" antes de colocar_bloco: ele já mira sozinho. Se houver missão em andamento, o Laya pausa enquanto os comandos rodam e retoma depois. Para na primeira falha (a menos que o passo tenha continuar_se_falhar). Se demorar mais de 50 s, devolve o que já terminou e o resto continua (acompanhe com ultimas_acoes).
Ações e parâmetros:
- ir_ate {x,y,z, distancia?, segundos?} (sai sozinho de buracos cavando ou subindo com blocos; não precisa montar escada à mão)
- ir_ate_jogador {nome}
- minerar {bloco, quantidade?: até 8} (os mais próximos) ou {x,y,z} (um bloco exato); o bot recolhe o que cair. Mais de 8 é recusado: para juntar em quantidade use definir_plano
- coletar_itens {item?, raio?}
- craftar {item, quantidade?} (coloca a mesa sozinho se a receita precisar e ele tiver uma)
- colocar_bloco {item, x,y,z} (substitui capim, neve e água como no jogo; se o bot estiver no lugar, ele sai da frente; se estiver ocupado, o erro diz o primeiro espaço livre acima)
- ver_blocos {x?,y?,z?, raio?: até 4} (lista os blocos em volta de um ponto, por altura; sem coordenadas = em volta do bot). Use antes de construir ou cavar em vez de adivinhar coordenadas
- hotbar {slot: 1 a 9, item?} (põe o item naquele espaço da barra e seleciona o espaço; sem item só troca o espaço selecionado)
- equipar {item, lugar?: hand|off-hand|head|torso|legs|feet} (hand = coloca no espaço selecionado da barra)
- largar {item, quantidade?}
- comer {item?}
- atacar {alvo?: nome do bicho (cow, pig, zombie...) ou de jogador; sem alvo = o mais perto, segundos?}
- abrir_bau {x?,y?,z?, pegar?: [{item,quantidade?}], guardar?: [{item,quantidade?}]} (sem coordenadas = baú mais perto)
- dormir {} (cama num raio de 16)
- olhar {x,y,z}
- falar {mensagem}
- esperar {segundos}
- parar {}
Use nomes do Minecraft 1.16.5 em inglês. Veja coordenadas, criaturas e baús em ver_jogo.`,
 inputSchema:{comandos:z.array(z.object({
  acao:z.enum(['ir_ate','ir_ate_jogador','minerar','coletar_itens','craftar','colocar_bloco','ver_blocos','hotbar','equipar','largar','comer','atacar','abrir_bau','dormir','olhar','falar','esperar','parar']),
  x:z.number().optional(),y:z.number().optional(),z:z.number().optional(),
  item:z.string().optional(),bloco:z.string().optional(),quantidade:z.number().int().positive().optional(),
  alvo:z.string().optional(),nome:z.string().optional(),mensagem:z.string().optional(),lugar:z.enum(['hand','off-hand','head','torso','legs','feet']).optional(),
  slot:z.number().int().min(1).max(9).optional(),
  segundos:z.number().positive().optional(),distancia:z.number().nonnegative().optional(),raio:z.number().positive().optional(),
  pegar:z.array(item).optional(),guardar:z.array(item).optional(),continuar_se_falhar:z.boolean().optional(),
 })).min(1).describe('Passos em ordem')},
},async({comandos})=>{try{return text(await bridge('/comandos',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({comandos})},55000));}catch(e){return fail(e);}});
server.registerTool('cancelar_missao',{
 title:'Cancelar missão',
 description:'Cancela a missão atual do Laya; o bot para e espera uma nova missão ou comandos.',
},async()=>{try{await bridge('/cancelar_missao',{method:'POST'});return text('Missão cancelada. O bot vai esperar a próxima.');}catch(e){return fail(e);}});
server.registerTool('ultimas_acoes',{
 title:'Últimas ações',
 description:'Lista as últimas ações que o Laya escolheu e o resultado de cada uma (inclusive falhas). Use para entender por que o bot empacou.',
},async()=>{try{const s=await bridge('/estado');return text({ultimas_acoes:s.ultimas_acoes,plano:s.plano,pedido:s.pedido});}catch(e){return fail(e);}});
server.registerTool('esperar_pedido_de_plano',{
 title:'Esperar pedido de plano',
 description:'Espera até 45 segundos o bot pedir um plano novo (quando termina a missão ou empaca). Se "pedido" vier preenchido, veja o estado e chame definir_plano; se vier vazio, o bot ainda está trabalhando e você pode esperar de novo.',
},async()=>{try{return text(await bridge('/aguardar?ms=45000',{},50000));}catch(e){return fail(e);}});
await server.connect(new StdioServerTransport());
console.error('auto-mine MCP pronto');
