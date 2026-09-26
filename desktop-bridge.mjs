// Local bridge between a running agent and Claude Desktop (through mcp-server.mjs).
// The agent publishes its latest state and asks for plans; Claude Desktop reads the state and answers with a plan.
// Listens on 127.0.0.1 only. No credentials pass through here.
import http from 'node:http';
export const bridgePort=Number(process.env.BRIDGE_PORT||3100);
let bridge;
export function desktopBridge(){
 if(bridge)return bridge;
 let latest=null,currentPlan=null,request=null,waiters=[],commandHandler=null,cancelRequested=false;
 const recent=[];
 const snapshot=()=>({estado:latest,plano:currentPlan,pedido:request&&{motivo:request.reason,desde:new Date(request.since).toISOString(),...(request.instructions&&{instrucoes:request.instructions})},ultimas_acoes:recent.slice(-10)});
 const wake=()=>{for(const w of waiters.splice(0))w();};
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  const send=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
  try{
   if(req.method==='GET'&&url.pathname==='/estado')return send(200,snapshot());
   if(req.method==='GET'&&url.pathname==='/aguardar'){
    // Long poll: return as soon as the agent asks for a plan, or after the timeout with pedido:null.
    const ms=Math.min(Number(url.searchParams.get('ms')||45000),55000);
    if(!request)await new Promise(resolve=>{const done=()=>{clearTimeout(timer);resolve();};const timer=setTimeout(()=>{waiters=waiters.filter(w=>w!==done);resolve();},ms);waiters.push(done);});
    return send(200,snapshot());
   }
   if(req.method==='POST'&&url.pathname==='/plano'){
    let input='';for await(const chunk of req){input+=chunk;if(input.length>100000)throw Error('Plano grande demais');}
    const p=JSON.parse(input);
    if(typeof p.objective!=='string'||!p.objective.trim())throw Error('O plano precisa de um objetivo');
    currentPlan={objective:p.objective,targets:p.targets||{},waypoint:p.waypoint||null,notes:p.notes||''};
    const pending=request;request=null;
    pending?.resolve({result:currentPlan,latencyMs:Date.now()-pending.since,model:'claude-desktop'});
    return send(200,{ok:true,plano:currentPlan,atendeu_pedido:!!pending});
   }
   if(req.method==='POST'&&url.pathname==='/comandos'){
    // Runs Claude's direct commands; answers when they finish or after 50 s with what is done so far.
    if(!commandHandler)throw Error('Este agente não aceita comandos diretos');
    let input='';for await(const chunk of req){input+=chunk;if(input.length>100000)throw Error('Lista de comandos grande demais');}
    const {comandos}=JSON.parse(input);if(!Array.isArray(comandos)||!comandos.length)throw Error('Mande ao menos um comando');
    const partial=[];const job=commandHandler(comandos,r=>partial.push(r));
    const finished=await Promise.race([job.then(()=>true),new Promise(r=>setTimeout(()=>r(false),50000))]);
    return send(200,{concluido:finished,resultados:partial,aviso:finished?undefined:'Ainda executando. Use ultimas_acoes para acompanhar.'});
   }
   if(req.method==='POST'&&url.pathname==='/cancelar_missao'){cancelRequested=true;return send(200,{ok:true});}
   send(404,{error:'Rota desconhecida'});
  }catch(e){send(400,{error:e.message});}
 });
 server.listen(bridgePort,'127.0.0.1',()=>console.log(`Ponte do Claude Desktop pronta em http://127.0.0.1:${bridgePort}`));
 server.unref();
 bridge={
  update(state){latest=state;},
  record(entry){recent.push(entry);if(recent.length>20)recent.shift();},
  get plan(){return currentPlan;},
  onCommands(handler){commandHandler=handler;},
  // True once after Claude asks to cancel the current mission.
  takeCancel(){const c=cancelRequested;cancelRequested=false;return c;},
  get waiting(){return !!request;},
  // Resolves when Claude Desktop sends a plan through definir_plano. A newer request replaces the reason, not the promise.
  // instructions: the planner system prompt (the dragon route), shown to Claude Desktop inside "pedido".
  requestPlan(state,reason,instructions){
   latest=state;
   if(request){request.reason=reason;return request.promise;}
   let resolve;const promise=new Promise(r=>resolve=r);
   request={reason,instructions,since:Date.now(),resolve,promise};
   console.log('\n>>> O agente precisa de um novo plano: '+reason+'\n>>> Peça ao Claude Desktop: "veja o jogo e defina o próximo plano"\n');
   wake();
   return promise;
  },
 };
 return bridge;
}
