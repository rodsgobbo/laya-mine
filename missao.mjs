// Short missions: Claude (Desktop by default, or the API) sets a goal with item targets; Laya picks each action.
// Generic survival actions only: chop trees, mine, pick up drops, craft, place a crafting table, eat, walk.
// PLANNER=desktop (default) waits for plans from Claude Desktop through mcp-server.mjs.
// PLANNER=api plans once from MISSAO="..." with the Anthropic API and stops when the mission is done.
process.env.PLANNER??='desktop';
const {decide,plan,plannerName}=await import('./models.mjs');
const {desktopBridge}=await import('./desktop-bridge.mjs');
const {createCommands}=await import('./comandos.mjs');
import fs from 'node:fs';
import mineflayer from 'mineflayer';
import pf from 'mineflayer-pathfinder';
import viewer from 'prismarine-viewer';
import {Vec3} from 'vec3';
const {pathfinder,Movements,goals}=pf;
const desktop=process.env.PLANNER==='desktop';
const run=process.env.RUN_ID||'missao-'+new Date().toISOString().slice(0,19).replace(/[:T]/g,'-'),dir='runs/'+run;
fs.mkdirSync(dir,{recursive:true});
const log=(type,data={})=>fs.appendFileSync(dir+'/events.jsonl',JSON.stringify({time:new Date().toISOString(),type,...data})+'\n');
const bot=mineflayer.createBot({host:'127.0.0.1',port:Number(process.env.MC_PORT||25576),username:process.env.BOT_NAME||'AutoMine',version:'1.16.5'});
bot.loadPlugin(pathfinder);
const bridge=desktop?desktopBridge():null;
let currentPlan=null,steps=0,stepsOnPlan=0,errors=0,stopped=false;
const recent=[],failed=new Map();
// One thing moves the bot at a time: Laya's action or a batch of Claude's direct commands.
let lock=Promise.resolve();
const exclusive=fn=>{const run=lock.then(fn,fn);lock=run.catch(()=>{});return run;};
const remember=entry=>{recent.push(entry);if(recent.length>20)recent.shift();bridge?.record(entry);};

// ---- observation ----
const inventory=()=>{const i={};for(const q of bot.inventory.items())i[q.name]=(i[q.name]||0)+q.count;return i;};
const item=name=>bot.inventory.items().find(i=>i.name===name);
const pos=p=>p&&{x:Math.round(p.x*10)/10,y:Math.round(p.y*10)/10,z:Math.round(p.z*10)/10};
const nearestBlocks=(match,max=32,count=1)=>bot.findBlocks({matching:b=>b&&match(b),maxDistance:max,count:Math.max(count,40)}).map(p=>bot.blockAt(p)).filter(Boolean).sort((a,b)=>a.position.distanceTo(bot.entity.position)-b.position.distanceTo(bot.entity.position)).slice(0,count);
const drops=(max=16)=>Object.values(bot.entities).filter(e=>e.name==='item'&&e.position.distanceTo(bot.entity.position)<=max&&e.getDroppedItem?.()).sort((a,b)=>a.position.distanceTo(bot.entity.position)-b.position.distanceTo(bot.entity.position));
const nearbyTable=()=>nearestBlocks(b=>b.name==='crafting_table',4)[0]||null;
const deficits=()=>{const i=inventory(),out={};for(const [name,count] of Object.entries(currentPlan?.targets||{}))if((i[name]||0)<count)out[name]=count-(i[name]||0);return out;};
const hotbar=()=>Array.from({length:9},(_,n)=>bot.inventory.slots[36+n]);
let active='Esperando missão';
// Data for the viewer HUD (recording-client.js reads it from the viewer's /am-status route).
bot.amStatus=()=>({run,plannerName:desktop?'Claude':plannerName,difficulty:bot.game?.difficulty,steps,position:pos(bot.entity?.position),health:bot.health,food:bot.food,plan:currentPlan,active,
 hotbar:hotbar().map(it=>it&&{name:it.name,count:it.count}),selectedSlot:bot.quickBarSlot,heldItem:bot.heldItem&&{name:bot.heldItem.name,count:bot.heldItem.count},digging:!!bot.targetDigBlock});
const edible=()=>bot.inventory.items().find(i=>bot.registry.foodsByName?.[i.name]);
function state(){
 const p=bot.entity?.position,tree=nearestBlocks(b=>b.name.endsWith('_log'),48)[0],stone=nearestBlocks(b=>b.name==='stone',24)[0];
 return {mission:currentPlan,missingItems:deficits(),position:pos(p),dimension:bot.game?.dimension,health:bot.health,food:bot.food,timeOfDay:bot.time?.timeOfDay,inventory:inventory(),
  nearby:{nearestLog:tree&&{name:tree.name,position:tree.position,distance:Math.round(tree.position.distanceTo(p))},nearestStone:stone&&{position:stone.position,distance:Math.round(stone.position.distanceTo(p))},craftingTableWithinReach:!!nearbyTable(),drops:drops().slice(0,6).map(e=>({item:e.getDroppedItem().name,count:e.getDroppedItem().count,distance:Math.round(e.position.distanceTo(p))})),
  creatures:Object.values(bot.entities).filter(e=>e!==bot.entity&&e.name!=='item'&&e.type!=='object'&&e.position.distanceTo(p)<=32).sort((a,b)=>a.position.distanceTo(p)-b.position.distanceTo(p)).slice(0,8).map(e=>({name:e.username||e.name,type:e.type,position:pos(e.position),distance:Math.round(e.position.distanceTo(p))})),
  chests:nearestBlocks(b=>b.name==='chest'||b.name==='barrel',32,4).map(b=>({position:b.position,distance:Math.round(b.position.distanceTo(p))}))},
  held:bot.heldItem?.name||null,
  hotbar:hotbar().map((it,n)=>({slot:n+1,item:it?.name||null,count:it?.count||0})),selectedSlot:bot.quickBarSlot+1,
  steps,recent:recent.slice(-6)};
}

// ---- crafting knowledge: which items are worth crafting for the current targets ----
function recipeInputs(name){
 const id=bot.registry.itemsByName[name]?.id,out=new Set();if(id===undefined)return out;
 for(const r of bot.registry.recipes[id]||[]){const ids=r.inShape?r.inShape.flat():r.ingredients||[];for(const x of ids){const i=typeof x==='object'&&x!==null?x.id:x;if(i!=null&&i>=0&&bot.registry.items[i])out.add(bot.registry.items[i].name);}}
 return out;
}
const needsTable=name=>{const id=bot.registry.itemsByName[name]?.id;const rs=bot.registry.recipes[id]||[];return rs.length>0&&rs.every(r=>r.inShape?(r.inShape.length>2||r.inShape.some(row=>row.length>2)):(r.ingredients||[]).length>4);};
function neededItems(){
 // Target deficits plus everything that goes into them, three levels deep (log -> planks -> stick -> pickaxe).
 const need=new Set(),queue=Object.keys(deficits()).map(n=>[n,0]);
 while(queue.length){const [n,d]=queue.shift();if(need.has(n))continue;need.add(n);if(d<3)for(const x of recipeInputs(n))queue.push([x,d+1]);}
 if([...need].some(needsTable))need.add('crafting_table');
 if([...need].some(n=>n.endsWith('_planks')))for(const n of Object.keys(bot.registry.itemsByName))if(n.endsWith('_planks')||n.endsWith('_log'))need.add(n);
 return need;
}

// ---- actions ----
async function bounded(promise,ms){let t;try{return await Promise.race([promise,new Promise((_,rej)=>t=setTimeout(()=>{bot.pathfinder.setGoal(null);rej(Error('Action timeout'));},ms))]);}finally{clearTimeout(t);}}
const go=(p,range=1.5,ms=20000)=>bounded(bot.pathfinder.goto(new goals.GoalNear(p.x,p.y,p.z,range)),ms);
async function equipFor(block){
 const kinds=block.name.endsWith('_log')?['_axe']:['_pickaxe'],order=['netherite','diamond','iron','stone','golden','wooden'];
 for(const m of order)for(const k of kinds){const t=item(m+k);if(t){await bot.equip(t,'hand');return;}}
}
async function mineBlock(block){
 // Blocks without a hitbox (grass, flowers, snow layers) cannot be aimed at, so GoalLookAtBlock never resolves: just get close.
 const goal=block.boundingBox==='empty'?new goals.GoalNear(block.position.x,block.position.y,block.position.z,2):new goals.GoalLookAtBlock(block.position,bot.world,{reach:4});
 await bounded(bot.pathfinder.goto(goal),20000);
 const fresh=bot.blockAt(block.position);if(!fresh||fresh.name==='air')return 'Block already gone';
 await equipFor(fresh);if(!bot.canDigBlock(fresh))throw Error('Cannot dig '+fresh.name+' from here');
 await bounded(bot.dig(fresh),15000);await bot.waitForTicks(8);
 const drop=drops(6)[0];if(drop)await go(drop.position,0.5,8000).catch(()=>{});
 return 'Mined '+fresh.name;
}
async function craft(name){
 const id=bot.registry.itemsByName[name].id,table=nearbyTable(),recipe=bot.recipesFor(id,null,1,table)[0];
 if(!recipe)throw Error('No recipe available for '+name);
 await bot.craft(recipe,1,table);return 'Crafted '+name;
}
async function placeTable(){
 // Two blocks away first: a spot touching the player's hitbox is refused by the server.
 const p=bot.entity.position.floored();let lastError;
 for(const [dx,dz] of [[2,0],[0,2],[-2,0],[0,-2],[2,1],[1,2],[-2,-1],[-1,-2],[1,0],[0,1],[-1,0],[0,-1]]){
  for(const dy of [0,-1,1]){
   const q=p.offset(dx,dy,dz),below=bot.blockAt(q.offset(0,-1,0)),here=bot.blockAt(q);
   if(here?.name!=='air'||!below||below.boundingBox!=='block'||below.name.includes('leaves'))continue;
   try{await bot.equip(item('crafting_table'),'hand');await bot.lookAt(below.position.offset(0.5,1,0.5),true);await bot.placeBlock(below,new Vec3(0,1,0));return 'Placed crafting table at '+q;}
   catch(e){lastError=e;if(bot.blockAt(q)?.name==='crafting_table')return 'Placed crafting table at '+q;}
  }
 }
 throw Error(lastError?'Could not place the table: '+lastError.message:'No free ground near the player for the table');
}
async function explore(){const a=Math.random()*Math.PI*2,p=bot.entity.position;await go(new Vec3(p.x+Math.cos(a)*24,p.y,p.z+Math.sin(a)*24),3,20000).catch(e=>{if(bot.entity.position.distanceTo(p)<3)throw e;});return 'Explored toward a new area';}

const dropSource={coal:'coal_ore',diamond:'diamond_ore',redstone:'redstone_ore',lapis_lazuli:'lapis_ore',emerald:'emerald_ore',flint:'gravel',clay_ball:'clay',snowball:'snow_block',quartz:'nether_quartz_ore'};
function candidates(){
 const out=[],add=(key,description,fn)=>{if((failed.get(key)||0)<Date.now())out.push({key,description,fn});};
 const need=neededItems(),i=inventory(),p=bot.entity.position,missing=deficits(),hasPickaxe=Object.keys(i).some(n=>n.endsWith('_pickaxe'));
 // Stop chopping once a few logs are in stock, unless logs themselves are a mission target.
 const logs=Object.entries(i).filter(([n])=>n.endsWith('_log')).reduce((s,[,c])=>s+c,0);
 const wantLogs=Object.keys(missing).some(n=>n.endsWith('_log'))||(logs<3&&(need.size===0||[...need].some(n=>n.endsWith('_planks')||n==='stick')));
 for(const e of drops().slice(0,3))if(need.size===0||need.has(e.getDroppedItem().name))add('pickup_'+e.id,'Pick up dropped '+e.getDroppedItem().name+'; distance '+Math.round(e.position.distanceTo(p)),()=>go(e.position,0.5,10000).then(()=>'Picked up item'));
 // A mission for a specific wood (birch_log) must chop that wood only; otherwise any log helps (planks, sticks).
 const wantedLogs=Object.keys(missing).filter(n=>n.endsWith('_log'));
 if(wantLogs){const b=nearestBlocks(x=>wantedLogs.length?wantedLogs.includes(x.name):x.name.endsWith('_log'),64)[0];if(b)add('chop','Chop the nearest '+b.name+' at '+b.position+'; distance '+Math.round(b.position.distanceTo(p)),()=>mineBlock(b));else add('explore','No trees nearby: explore to find trees',explore);}
 if(need.has('cobblestone')&&hasPickaxe){const b=nearestBlocks(x=>x.name==='stone',24)[0];if(b)add('mine_stone','Mine stone at '+b.position+' to get cobblestone; distance '+Math.round(b.position.distanceTo(p)),()=>mineBlock(b));}
 for(const name of Object.keys(missing)){
  if(name.endsWith('_log')||name==='cobblestone')continue;
  // Items that drop from a differently named block (coal comes from coal_ore, flint from gravel...).
  const source=dropSource[name]||name;
  if(dropSource[name]&&!hasPickaxe&&source.endsWith('_ore'))continue;
  const b=bot.registry.blocksByName[source]&&nearestBlocks(x=>x.name===source,32)[0];
  if(b)add('mine_'+name,'Mine '+source+' at '+b.position+' to get '+name+' (mission needs '+missing[name]+' more); distance '+Math.round(b.position.distanceTo(p)),()=>mineBlock(b));
 }
 const table=nearbyTable();
 for(const name of need){
  const id=bot.registry.itemsByName[name]?.id;if(id===undefined||name.endsWith('_log'))continue;
  // Bark blocks only appear as recipe inputs for planks; crafting them wastes logs.
  if(!missing[name]&&(name.endsWith('_wood')||name.startsWith('stripped_')))continue;
  // An ingredient already in stock is enough for now; craft more only when it runs low.
  if(!missing[name]&&(i[name]||0)>=4)continue;
  if(name==='crafting_table'&&!missing[name]&&(i.crafting_table||table))continue;
  if(bot.recipesFor(id,null,1,table).length)add('craft_'+name,'Craft '+name+(missing[name]?' (mission needs '+missing[name]+' more)':' (ingredient for the mission)'),()=>craft(name));
 }
 if(i.crafting_table&&!table&&[...need].some(needsTable))add('place_table','Place the crafting table next to the player to unlock bigger recipes',placeTable);
 if(currentPlan?.waypoint){const w=currentPlan.waypoint;if(p.distanceTo(new Vec3(w.x,w.y,w.z))>3)add('waypoint','Walk toward the mission destination ('+w.x+', '+w.y+', '+w.z+'); distance '+Math.round(p.distanceTo(new Vec3(w.x,w.y,w.z))),()=>go(new Vec3(w.x,w.y,w.z),2,25000).then(()=>'Reached destination'));}
 const food=edible();if(food&&bot.food<18)add('eat','Eat '+food.name+' (food '+bot.food+'/20)',async()=>{await bot.equip(food,'hand');await bot.consume();return 'Ate '+food.name;});
 // Waiting is only offered when nothing else is possible (for example, every option is cooling down after a failure).
 if(!out.length)out.push({key:'wait',description:'Wait briefly for fresh observations',fn:()=>bot.waitForTicks(20).then(()=>'Waited')});
 return out;
}
const layaInstructions='Control the Minecraft player for a short survival mission. Choose the one available action that best advances the mission objective and the missingItems in the state. Gather raw materials before crafting. Craft intermediate items (planks, sticks) only when they lead to a missing item. Place a crafting table before recipes that need it. Pick up nearby dropped items the mission needs. Eat when food is low. Avoid actions that just failed in recent. Never wait when a useful action is available.';

// ---- planning ----
const plannerSystem='You plan short Minecraft Java 1.16.5 survival missions for a bot. Another model picks each concrete action from: chop trees, mine stone (needs a pickaxe) or visible blocks, pick up drops, craft recipes, place a crafting table, eat, walk to a waypoint, explore. Turn the requested mission into item targets the inventory must reach (Minecraft item ids like oak_log, crafting_table, wooden_pickaxe) and, only if the mission is about going somewhere, a waypoint. Keep targets minimal and reachable from the current state. Return JSON with objective, targets, waypoint, notes. Do not invent observations.';
async function newPlan(reason){
 log('plan_request',{reason});active='Esperando missão do Claude';
 const s={...state(),planReason:reason,request:process.env.MISSAO||null};
 const r=await plan(s,plannerSystem);
 currentPlan=r.result;stepsOnPlan=0;errors=0;log('plan',{...r,reason});console.log('PLANO',JSON.stringify(currentPlan));
}
function missionDone(){
 if(!currentPlan)return false;
 const targets=Object.keys(currentPlan.targets||{}),w=currentPlan.waypoint;
 const arrived=!w||bot.entity.position.distanceTo(new Vec3(w.x,w.y,w.z))<=3;
 if(!targets.length&&!w)return stepsOnPlan>=15; // A plan with nothing to check runs 15 actions, then asks again.
 return arrived&&Object.keys(deficits()).length===0;
}

// ---- main loop ----
bot.once('spawn',async()=>{
 const moves=new Movements(bot);bot.pathfinder.setMovements(moves);
 // Read-only 3D view in the browser; it listens on every interface so a tablet on the same Wi-Fi can watch too.
 if(process.env.VIEWER!=='0'){const port=Number(process.env.VIEWER_PORT||3007);viewer.mineflayer(bot,{port,firstPerson:process.env.VIEWER_FIRST_PERSON==='1',viewDistance:6});console.log('Assista em http://localhost:'+port);}
 if(bridge){
  bridge.update(state());setInterval(()=>bridge.update(state()),2000).unref();
  // Direct commands work at any time, even while the mission waits for a plan; Laya pauses while they run.
  const runCommands=createCommands(bot,{go,mineBlock,drops,nearbyTable,placeTable,item,bounded,goals});
  bridge.onCommands((list,onResult)=>exclusive(()=>{
   console.log('COMANDOS DO CLAUDE',JSON.stringify(list));log('commands',{list});active='Comando do Claude: '+list.map(c=>c.acao).join(', ');
   return runCommands(list,entry=>{onResult(entry);log('command',entry);console.log('COMANDO',entry.passo,entry.acao,entry.ok?'ok:':'FALHOU:',entry.resultado);remember({step:steps,action:'Comando do Claude: '+entry.acao,result:entry.ok?entry.resultado:'FAILED '+entry.resultado});}).finally(()=>{active=currentPlan?'Missão: '+currentPlan.objective:'Esperando missão do Claude';});
  }));
 }
 log('spawn',{position:pos(bot.entity.position),planner:plannerName});
 console.log(`${bot.username} entrou no jogo em ${JSON.stringify(pos(bot.entity.position))}. Planejador: ${plannerName}; decisões: Laya.`);
 try{
  if(!desktop&&!process.env.MISSAO)throw Error('Defina MISSAO="..." para usar PLANNER=api');
  await newPlan('start: no plan yet');
  while(!stopped){
   if(bridge?.takeCancel()){log('mission_cancelled',{plan:currentPlan});console.log('MISSÃO CANCELADA pelo Claude');currentPlan=null;await newPlan('mission cancelled by Claude; waiting for a new mission');continue;}
   if(missionDone()){
    const summary='mission complete: '+currentPlan.objective;log('mission_complete',{plan:currentPlan,inventory:inventory(),steps});console.log('MISSÃO CUMPRIDA:',currentPlan.objective);
    if(!desktop)break;
    await newPlan(summary);continue;
   }
   if(errors>=3){await newPlan('stuck after 3 failed actions; last: '+(recent.at(-1)?.result||'?'));continue;}
   if(recent.length>=8&&recent.slice(-8).every(e=>e.result==='Waited')){await newPlan('stuck: no useful action for 8 turns');recent.push({step:steps,action:'New plan',result:'Plan received'});continue;}
   const options=candidates(),s=state();
   const r=await decide(s,options,layaInstructions);
   console.log('AÇÃO',steps+1,r.selected.description,`(${r.latencyMs} ms)`);active=r.selected.description;
   let result;
   try{result=await exclusive(()=>bounded(Promise.resolve(r.selected.fn()),30000));errors=r.selected.key==='wait'?errors:0;}
   catch(e){result='FAILED '+e.message;failed.set(r.selected.key,Date.now()+8000);errors++;bot.pathfinder.setGoal(null);bot.clearControlStates();}
   steps++;stepsOnPlan++;
   const entry={step:steps,action:r.selected.description,result:typeof result==='string'?result:'done',probability:r.data.answers?.action?.answer_confidence};
   remember(entry);
   log('decision',{step:steps,selected:r.selected.key,latencyMs:r.latencyMs,answer:r.data.answers?.action,result:entry.result});
  }
 }catch(e){log('fatal',{error:e.message});console.error('ERRO',e.message);}
 bot.quit();setTimeout(()=>process.exit(0),500);
});
bot.on('kicked',r=>{console.error('Expulso do servidor:',r);process.exit(1);});
bot.on('error',e=>{console.error('Erro de conexão:',e.message);process.exit(1);});
bot.on('death',()=>{log('death',{});console.log('O bot morreu; renascendo.');});
process.on('SIGINT',()=>{stopped=true;console.log('\nParando...');bot.quit();setTimeout(()=>process.exit(0),500);});
