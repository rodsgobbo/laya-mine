// Direct commands from Claude (Desktop, through executar_comandos): a list of steps the bot runs in order.
// Each step names an action and its parameters; the result of every step goes back to Claude.
// Everything here acts inside the game only.
import {Vec3} from 'vec3';
export const commandNames=['ir_ate','ir_ate_jogador','minerar','coletar_itens','craftar','colocar_bloco','construir','ver_blocos','hotbar','equipar','largar','comer','atacar','abrir_bau','dormir','olhar','falar','esperar','parar'];
export function createCommands(bot,{go,mineBlock,drops,nearbyTable,placeTable,item,bounded,goals}){
 // The step now running. A timeout marks it cancelled; loops check it so the action really stops
 // instead of competing with the next command for the pathfinder.
 let current={cancelled:false,note:''};
 const checkCancelled=()=>{if(current.cancelled)throw Error('Cancelado');};
 const stopAll=()=>{bot.pathfinder.setGoal(null);try{bot.stopDigging();}catch{}bot.clearControlStates();};
 const need=(v,name)=>{if(v===undefined||v===null||v==='')throw Error('Falta o parâmetro "'+name+'"');return v;};
 const at=c=>new Vec3(Number(need(c.x,'x')),Number(need(c.y,'y')),Number(need(c.z,'z')));
 const itemId=name=>{const it=bot.registry.itemsByName[name];if(!it)throw Error('Item desconhecido no 1.16.5: '+name);return it.id;};
 // Blocks the game replaces when you place something on them.
 const replaceable=new Set(['air','cave_air','void_air','grass','tall_grass','fern','large_fern','dead_bush','seagrass','tall_seagrass','snow','vine','water','lava','fire']);
 const free=b=>!!b&&replaceable.has(b.name);
 const occupies=t=>{const p=bot.entity.position;return p.x+0.3>t.x&&p.x-0.3<t.x+1&&p.z+0.3>t.z&&p.z-0.3<t.z+1&&p.y+1.8>t.y&&p.y<t.y+1;};
 const faces=[[0,-1,0],[0,1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]];
 const supportOf=t=>faces.map(([x,y,z])=>bot.blockAt(t.offset(x,y,z))).find(b=>b&&b.boundingBox==='block');
 const hasSupport=t=>!!supportOf(t);
 const stepAway=t=>bounded(bot.pathfinder.goto(new goals.GoalInvert(new goals.GoalNear(t.x,t.y,t.z,1.6))),10000).catch(()=>{});
 // Places one block, used by colocar_bloco and construir.
 async function placeAt(target,name){
  if(!item(name))throw Error('Não tenho '+name);
  const here=bot.blockAt(target);
  if(here&&!free(here)){
   let up=target.offset(0,1,0);for(let i=0;i<6&&!free(bot.blockAt(up));i++)up=up.offset(0,1,0);
   throw Error('Já tem '+here.name+' em '+target+(free(bot.blockAt(up))?'; o primeiro espaço livre acima é y='+up.y:''));
  }
  const ref=supportOf(target);
  if(!ref){
   let down=target.offset(0,-1,0);for(let i=0;i<12&&free(bot.blockAt(down));i++)down=down.offset(0,-1,0);
   const ground=bot.blockAt(down);
   throw Error('Nada sólido encostado em '+target+' para apoiar o bloco'+(ground&&!free(ground)?'; o chão abaixo está em y='+down.y+(target.y-down.y>1?', coloque blocos de y='+(down.y+1)+' até y='+(target.y-1)+' antes':''):''));
  }
  // The server refuses a block inside the player: step off the spot first.
  if(occupies(target))await stepAway(target);
  if(occupies(target))throw Error('Estou em cima de '+target+' e não consegui sair da frente');
  if(bot.entity.position.distanceTo(target)>4)await go(target,3,30000);
  if(occupies(target))await stepAway(target);
  await bot.equip(item(name),'hand');await bot.lookAt(target.offset(0.5,0.5,0.5),true);
  // Grass, snow layers and similar are replaced by the new block, like in the game.
  await bot.placeBlock(ref,target.minus(ref.position));
  return 'Coloquei '+name+' em '+target+(here&&here.name!=='air'?' (substituiu '+here.name+')':'');
 }
 const recipeText=r=>{const ids=r.inShape?r.inShape.flat():r.ingredients||[];const n={};for(const x of ids){const i=typeof x==='object'&&x!==null?x.id:x;if(i!=null&&i>=0&&bot.registry.items[i]){const k=bot.registry.items[i].name;n[k]=(n[k]||0)+1;}}return Object.entries(n).map(([k,v])=>v+' '+k).join(' + ')+' → '+(r.result?.count||1);};
 const count=name=>bot.inventory.items().filter(i=>i.name===name).reduce((s,i)=>s+i.count,0);
 const findBlocks=(name,max=48,n=1)=>{if(!bot.registry.blocksByName[name])throw Error('Bloco desconhecido no 1.16.5: '+name);return bot.findBlocks({matching:b=>b&&b.name===name,maxDistance:max,count:Math.max(n,40)}).map(p=>bot.blockAt(p)).sort((a,b)=>a.position.distanceTo(bot.entity.position)-b.position.distanceTo(bot.entity.position)).slice(0,n);};
 const entity=alvo=>{
  const list=Object.values(bot.entities).filter(e=>e!==bot.entity&&e.type!=='object'&&e.name!=='item'&&e.position.distanceTo(bot.entity.position)<=32&&(!alvo||alvo==='mais_perto'||e.name===alvo||e.username===alvo||e.displayName===alvo));
  return list.sort((a,b)=>a.position.distanceTo(bot.entity.position)-b.position.distanceTo(bot.entity.position))[0];
 };
 const actions={
  async ir_ate(c){await go(at(c),c.distancia??1.5,Number(c.segundos||60)*1000);return 'Cheguei perto de '+at(c);},
  async ir_ate_jogador(c){const p=bot.players[need(c.nome,'nome')]?.entity;if(!p)throw Error('Não vejo o jogador '+c.nome+' por perto');await go(p.position,c.distancia??2,60000);return 'Cheguei perto de '+c.nome;},
  async minerar(c){
   const total=Number(c.quantidade||1),done=[];
   // Gathering in bulk belongs to Laya's missions: one call instead of many polling turns for Claude.
   if(c.x===undefined&&total>8){
    const drop={stone:'cobblestone',coal_ore:'coal',diamond_ore:'diamond',redstone_ore:'redstone',lapis_ore:'lapis_lazuli',gravel:'flint'}[c.bloco]||c.bloco;
    throw Error('Para juntar em quantidade (mais de 8 blocos), use definir_plano: o Laya junta sozinho e avisa quando terminar. Ex.: itens [{"item":"'+drop+'","quantidade":'+(count(drop)+total)+'}] (a quantidade é o total que o inventário deve ter; hoje tem '+count(drop)+')');
   }
   const targets=c.x!==undefined?[bot.blockAt(at(c))]:findBlocks(need(c.bloco,'bloco'),48,total);
   if(!targets.length||!targets[0])throw Error('Não achei '+(c.bloco||'bloco')+' num raio de 48 blocos');
   // An unreachable block (high in a tree, behind water) is skipped instead of aborting the whole list.
   const skipped=[];
   for(const b of targets){
    checkCancelled();const fresh=bot.blockAt(b.position);if(!fresh||fresh.name==='air')continue;
    try{done.push(await mineBlock(fresh));}catch(e){if(current.cancelled)throw e;skipped.push(fresh.position+': '+e.message);if(targets.length===1)throw e;}
    current.note='minerei '+done.length+' de '+targets.length+(skipped.length?', pulei '+skipped.length:'');
   }
   if(!done.length&&skipped.length)throw Error('Não consegui minerar nenhum: '+skipped.slice(0,3).join('; '));
   return done.length+' bloco(s) minerado(s)'+(skipped.length?'; pulei '+skipped.length+' que não consegui alcançar ('+skipped.slice(0,3).join('; ')+')':'');
  },
  async coletar_itens(c){
   const list=drops(Number(c.raio||16)).filter(e=>!c.item||e.getDroppedItem().name===c.item);let n=0;
   for(const e of list){checkCancelled();if(!bot.entities[e.id])continue;await go(e.position,0.5,15000).catch(()=>{});n++;current.note='recolhi '+n;}
   return n?'Fui até '+n+' item(ns) no chão':'Nenhum item no chão por perto';
  },
  async craftar(c){
   // quantidade = how many items Claude wants (8 torches = 2 recipes of 4), not how many times to run the recipe.
   const name=need(c.item,'item'),id=itemId(name),wanted=Number(c.quantidade||1);let table=nearbyTable();
   if(!bot.recipesFor(id,null,1,table).length&&!table&&bot.recipesFor(id,null,1,true).length){
    if(!item('crafting_table'))throw Error(name+' precisa de mesa de trabalho, e não tenho uma');
    await placeTable();table=nearbyTable();
   }
   const any=bot.recipesFor(id,null,1,table)[0];
   if(!any){const r=(bot.registry.recipes[id]||[])[0];throw Error('Faltam ingredientes para '+name+(r?': a receita usa '+recipeText(r):''));}
   const per=any.result?.count||1,ops=Math.ceil(wanted/per);
   let doable=ops;while(doable>0&&!bot.recipesFor(id,null,doable*per,table).length)doable--;
   const recipe=bot.recipesFor(id,null,doable*per,table)[0];
   const before=count(name);await bot.craft(recipe,doable,table);
   const made=count(name)-before;
   return 'Craftei '+made+' '+name+' (agora tenho '+count(name)+')'+(doable<ops?'; pediu '+wanted+', mas os ingredientes só deram para '+made:'');
  },
  async colocar_bloco(c){
   return placeAt(at(c),need(c.item,'item'));
  },
  async construir(c){
   // Fills a shape from bottom to top so every block has support; skips what is already done,
   // clears soft obstacles (leaves, grass, flowers, snow) and keeps passing until nothing more can be placed.
   const name=need(c.item,'item'),a=at(need(c.de,'de')),b=at(need(c.ate,'ate')),forma=c.forma||'cheio';
   const min=new Vec3(Math.min(a.x,b.x),Math.min(a.y,b.y),Math.min(a.z,b.z)),max=new Vec3(Math.max(a.x,b.x),Math.max(a.y,b.y),Math.max(a.z,b.z));
   const cells=[];
   for(let y=min.y;y<=max.y;y++)for(let x=min.x;x<=max.x;x++)for(let z=min.z;z<=max.z;z++){
    const edgeX=x===min.x||x===max.x,edgeZ=z===min.z||z===max.z,edgeY=y===min.y||y===max.y;
    if(forma==='paredes'&&!(edgeX||edgeZ))continue;
    if(forma==='oca'&&!(edgeX||edgeZ||edgeY))continue;
    cells.push(new Vec3(x,y,z));
   }
   if(cells.length>512)throw Error('Construção grande demais ('+cells.length+' blocos); divida em partes de até 512');
   const soft=/leaves|grass|fern|dandelion|poppy|orchid|allium|bluet|tulip|daisy|cornflower|lily|bush|snow|vine|mushroom|sapling/;
   let placed=0,cleared=0,ready=0;const blocked=new Set();
   let pending=cells.filter(p=>{const h=bot.blockAt(p);if(h?.name===name){ready++;return false;}return true;});
   for(let pass=0;pass<4&&pending.length;pass++){
    let progress=false;const next=[];
    pending.sort((p,q)=>p.y-q.y||p.distanceTo(bot.entity.position)-q.distanceTo(bot.entity.position));
    for(const p of pending){
     checkCancelled();
     if(!item(name)){current.note='coloquei '+placed+' de '+cells.length;return 'Acabou o '+name+': coloquei '+placed+' de '+(cells.length-ready)+' que faltavam ('+ready+' já estavam prontos). Faltam '+(pending.length-(pending.indexOf(p)))+' blocos.';}
     let h=bot.blockAt(p);
     if(h&&!free(h)&&h.name!==name){
      if(c.limpar===false||!soft.test(h.name)){blocked.add(p.toString()+' ('+h.name+')');continue;}
      try{await mineBlock(h);cleared++;}catch{next.push(p);continue;}
      h=bot.blockAt(p);
     }
     if(h?.name===name)continue;
     if(!hasSupport(p)){next.push(p);continue;}
     try{await placeAt(p,name);placed++;progress=true;current.note='coloquei '+placed+' de '+cells.length;}catch(e){if(current.cancelled)throw e;next.push(p);}
    }
    pending=next;if(!progress)break;
   }
   const parts=['Coloquei '+placed+' de '+(cells.length-ready)+' blocos de '+name+' ('+forma+')'];
   if(ready)parts.push(ready+' já estavam prontos');
   if(cleared)parts.push('limpei '+cleared+' folhas/capim no caminho');
   if(pending.length)parts.push(pending.length+' ficaram sem apoio ou fora de alcance: '+pending.slice(0,4).map(String).join(', '));
   if(blocked.size)parts.push(blocked.size+' ocupados por blocos que não quebro sozinho: '+[...blocked].slice(0,4).join(', '));
   return parts.join('; ');
  },
  async ver_blocos(c){
   // Non-air blocks around a point, grouped by height, so Claude can see the terrain before building or digging.
   const center=c.x!==undefined?at(c):bot.entity.position.floored(),r=Math.min(Number(c.raio||2),4),layers={};
   for(let y=-r;y<=r;y++){const row={};for(let x=-r;x<=r;x++)for(let z=-r;z<=r;z++){const b=bot.blockAt(center.offset(x,y,z));if(!b||b.name==='air'||b.name==='cave_air')continue;(row[b.name]??=[]).push([center.x+x,center.z+z]);}if(Object.keys(row).length)layers['y='+(center.y+y)]=row;}
   const p=bot.entity.position.floored();
   return JSON.stringify({centro:[center.x,center.y,center.z],raio:r,bot_em:[p.x,p.y,p.z],blocos_por_altura:layers,obs:'posições como [x,z]; o que não aparece é ar'});
  },
  async hotbar(c){
   // Put an item in hotbar slot 1-9 (inventory slots 36-44) and select that slot, like pressing the number key.
   const slot=Number(need(c.slot,'slot'));if(!(slot>=1&&slot<=9))throw Error('slot vai de 1 a 9');
   const dest=36+slot-1;
   if(c.item){const it=item(c.item);if(!it)throw Error('Não tenho '+c.item);if(it.slot!==dest)await bot.moveSlotItem(it.slot,dest);}
   bot.setQuickBarSlot(slot-1);await bot.waitForTicks(2);
   const now=bot.inventory.slots[dest];return 'Espaço '+slot+' da barra selecionado: '+(now?now.name+' x'+now.count:'vazio');
  },
  async equipar(c){const name=need(c.item,'item');if(!item(name))throw Error('Não tenho '+name);await bot.equip(item(name),c.lugar||'hand');return 'Equipei '+name+' ('+(c.lugar||'hand')+')';},
  async largar(c){const name=need(c.item,'item'),n=Math.min(Number(c.quantidade||count(name)),count(name));if(!n)throw Error('Não tenho '+name);await bot.toss(itemId(name),null,n);return 'Larguei '+n+' '+name;},
  async comer(c){
   const food=c.item?item(c.item):bot.inventory.items().find(i=>bot.registry.foodsByName?.[i.name]);
   if(!food)throw Error('Não tenho comida'+(c.item?' ('+c.item+')':''));
   if(bot.food>=20)return 'Estou de barriga cheia (fome 20/20)';
   await bot.equip(food,'hand');await bot.consume();return 'Comi '+food.name+'; fome agora '+bot.food+'/20';
  },
  async atacar(c){
   const e=entity(c.alvo);if(!e)throw Error('Não vejo '+(c.alvo||'nenhuma criatura')+' num raio de 32 blocos');
   const name=e.username||e.name,end=Date.now()+Number(c.segundos||20)*1000;
   while(bot.entities[e.id]&&e.isValid!==false&&Date.now()<end){
    checkCancelled();
    if(e.position.distanceTo(bot.entity.position)>3){bot.pathfinder.setGoal(new goals.GoalFollow(e,2),true);await bot.waitForTicks(5);continue;}
    await bot.lookAt(e.position.offset(0,e.height*0.8,0),true);bot.attack(e);await bot.waitForTicks(12);
   }
   bot.pathfinder.setGoal(null);
   return bot.entities[e.id]?'Parei de atacar '+name+' (tempo esgotado)':'Derrotei '+name;
  },
  async abrir_bau(c){
   const chest=c.x!==undefined?bot.blockAt(at(c)):findBlocks('chest',32)[0];if(!chest||!['chest','trapped_chest','barrel'].includes(chest.name))throw Error('Não achei baú'+(c.x!==undefined?' em '+at(c):' por perto'));
   await go(chest.position,3,30000);const box=await bot.openContainer(chest),log=[];
   try{
    for(const p of c.pegar||[]){const it=box.containerItems().find(i=>i.name===p.item);if(!it){log.push('sem '+p.item+' no baú');continue;}const n=Math.min(Number(p.quantidade||it.count),box.containerItems().filter(i=>i.name===p.item).reduce((s,i)=>s+i.count,0));await box.withdraw(it.type,null,n);log.push('peguei '+n+' '+p.item);}
    for(const p of c.guardar||[]){const n=Math.min(Number(p.quantidade||count(p.item)),count(p.item));if(!n){log.push('não tenho '+p.item);continue;}await box.deposit(itemId(p.item),null,n);log.push('guardei '+n+' '+p.item);}
    const inside={};for(const i of box.containerItems())inside[i.name]=(inside[i.name]||0)+i.count;log.push('no baú: '+JSON.stringify(inside));
   }finally{box.close();}
   return log.join('; ');
  },
  async dormir(){const bed=bot.findBlock({matching:b=>bot.isABed(b),maxDistance:16});if(!bed)throw Error('Não achei cama num raio de 16 blocos');await go(bed.position,2,20000);await bot.sleep(bed);return 'Dormindo';},
  async olhar(c){await bot.lookAt(at(c),true);return 'Olhando para '+at(c);},
  async falar(c){bot.chat(String(need(c.mensagem,'mensagem')).slice(0,250));return 'Falei no chat';},
  async esperar(c){const s=Math.min(Number(c.segundos||1),60);await bot.waitForTicks(Math.round(s*20));return 'Esperei '+s+'s';},
  async parar(){bot.pathfinder.setGoal(null);bot.clearControlStates();return 'Parei de me mexer';},
 };
 // Runs steps in order; stops at the first failure unless the step says continuar_se_falhar.
 return async function run(steps,onResult=()=>{}){
  const results=[];
  for(const [n,c] of steps.entries()){
   const act=actions[c.acao];let entry;
   try{
    if(!act)throw Error('Ação desconhecida: '+c.acao+'. Disponíveis: '+commandNames.join(', '));
    // Time limit grows with the work asked: mining and collecting take ~8 s per block. Capped at 10 minutes.
    const seconds=Math.min(600,c.acao==='minerar'&&!(c.x!==undefined)?60+8*Number(c.quantidade||1):Number(c.segundos||60)+5);
    const token={cancelled:false,note:''};current=token;
    const job=Promise.resolve().then(()=>act(c));let timer;
    try{entry={passo:n+1,acao:c.acao,ok:true,resultado:await Promise.race([job,new Promise((_,rej)=>timer=setTimeout(()=>rej(Error('Tempo esgotado ('+seconds+' s)')),seconds*1000))])};}
    catch(e){
     // Stop the action for real, and wait for it to wind down before the next step may move the bot.
     token.cancelled=true;stopAll();await Promise.race([job.catch(()=>{}),new Promise(r=>setTimeout(r,5000))]);
     throw Error(e.message+(token.note?' depois de: '+token.note:''));
    }finally{clearTimeout(timer);}
   }
   catch(e){entry={passo:n+1,acao:c.acao,ok:false,resultado:e.message};stopAll();}
   results.push(entry);onResult(entry);
   if(!entry.ok&&!c.continuar_se_falhar)break;
  }
  return results;
 };
}
