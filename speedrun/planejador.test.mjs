// Claude Desktop as the speedrun planner: route instructions reach it, and a slow answer is not thrown away.
// Run: node --test speedrun/planejador.test.mjs   (uses bridge port 3199, so it works with the bot running)
import {test} from 'node:test';
import assert from 'node:assert/strict';
process.env.BRIDGE_PORT='3199';
const {asyncPlanner}=await import('./async-planner.mjs');
const {desktopBridge}=await import('../desktop-bridge.mjs');
const base='http://127.0.0.1:3199';
const estado=async()=>(await fetch(base+'/estado')).json();

test('a slow plan survives a stage change only with keepOnStageChange',async()=>{
 for(const keep of [false,true]){
  let stage='village',got=null,release;
  const p=asyncPlanner({getState:()=>({stage}),plan:()=>new Promise(r=>release=r),onPlan:r=>got=r,keepOnStageChange:keep});
  const pending=p.refresh(true);await new Promise(r=>setImmediate(r));
  stage='nether';release({result:{objective:'x'}});await pending;
  assert.equal(!!got,keep);
 }
});

test('Claude Desktop reads the route instructions in pedido and its plan answers the request',async()=>{
 const b=desktopBridge();
 const waiting=b.requestPlan({stage:'village'},'start','ROUTE PROMPT');
 assert.equal((await estado()).pedido.instrucoes,'ROUTE PROMPT');
 await fetch(base+'/plano',{method:'POST',body:JSON.stringify({objective:'loot chests',targets:{obsidian:10}})});
 assert.deepEqual((await waiting).result.targets,{obsidian:10});
 assert.equal((await estado()).pedido,null);
 b.requestPlan({},'missao');
 assert.equal((await estado()).pedido.instrucoes,undefined);
});
