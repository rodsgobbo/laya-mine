// Decisions by Laya and by Claude, and a token forecast for constructions, from runs/*/events.jsonl.
// Runs whose name starts with "teste" are left out (development tests).
// Usage: node metricas.mjs              (all runs)
//        node metricas.mjs partida-08   (one run)
//        node metricas.mjs --blocos 80  (forecast for a construction of 80 blocks)
import fs from 'node:fs';import path from 'node:path';
const args=process.argv.slice(2),blocosArg=args.indexOf('--blocos'),planned=blocosArg>=0?Number(args[blocosArg+1]):null;
const only=args.find((a,i)=>!a.startsWith('--')&&i!==blocosArg+1);
const CHARS_PER_TOKEN=3.5; // rough average for Portuguese text mixed with JSON
const tokens=chars=>Math.round(chars/CHARS_PER_TOKEN);
const runs=fs.readdirSync('runs').filter(d=>!d.startsWith('teste')&&(!only||d===only)&&fs.existsSync(path.join('runs',d,'events.jsonl')));
const laya={n:0,ok:0,ms:[],conf:[]},claude={missions:0,done:0,batches:0,commands:0,ok:0};
const builds=[]; // batches that place blocks
for(const run of runs){
 let batch=null;
 for(const line of fs.readFileSync(path.join('runs',run,'events.jsonl'),'utf8').split('\n').filter(Boolean)){
  let e;try{e=JSON.parse(line);}catch{continue;}
  if(e.type==='decision'){laya.n++;if(!/^FAILED/.test(e.result||''))laya.ok++;if(e.latencyMs)laya.ms.push(e.latencyMs);const c=e.answer?.answer_confidence;if(typeof c==='number')laya.conf.push(c);}
  else if(e.type==='plan'&&!/^start: no plan/.test(e.reason||'x')||e.type==='plan'&&e.result?.objective)claude.missions++;
  else if(e.type==='mission_complete')claude.done++;
  else if(e.type==='commands'){claude.batches++;batch={writeChars:JSON.stringify({comandos:e.list}).length,readChars:0,placed:0,steps:e.list.length,builds:e.list.some(c=>c.acao==='colocar_bloco')};if(batch.builds)builds.push(batch);}
  else if(e.type==='command'){claude.commands++;if(e.ok)claude.ok++;if(batch){batch.readChars+=JSON.stringify(e).length+20;if(e.ok&&e.acao==='colocar_bloco')batch.placed++;}}
 }
}
const pct=(a,b)=>b?Math.round(100*a/b)+'%':'—';
const avg=v=>v.length?v.reduce((s,x)=>s+x,0)/v.length:0;
console.log(`Partidas: ${runs.join(', ')||'nenhuma'} (testes de desenvolvimento ficam de fora)\n`);
console.log('DECISÕES');
console.log(`  Laya   ${String(laya.n).padStart(4)} decisões  acerto ${pct(laya.ok,laya.n).padStart(4)}  ~${Math.round(avg(laya.ms))} ms cada  confiança ${laya.n?avg(laya.conf).toFixed(2):'—'}`);
console.log(`  Claude ${String(claude.commands).padStart(4)} comandos  acerto ${pct(claude.ok,claude.commands).padStart(4)}  em ${claude.batches} lotes;  ${claude.missions} missões definidas, ${claude.done} cumpridas`);
const total=laya.n+claude.commands;
if(total)console.log(`  Quem decidiu: Laya ${pct(laya.n,total)}, Claude ${pct(claude.commands,total)}`);

// Token forecast: what Claude writes (commands) and reads (results) per block actually placed.
const placed=builds.reduce((s,b)=>s+b.placed,0),write=builds.reduce((s,b)=>s+b.writeChars,0),read=builds.reduce((s,b)=>s+b.readChars,0);
console.log('\nTOKENS EM CONSTRUÇÃO (estimativa pelo texto das ferramentas; o gasto real do Claude é maior)');
if(!placed){console.log('  Ainda não há construção registrada nessas partidas.');}
else{
 const perBlockOut=tokens(write)/placed,perBlockIn=tokens(read)/placed;
 console.log(`  Medido: ${builds.length} lotes de construção, ${placed} blocos colocados`);
 console.log(`  Por bloco colocado: ~${Math.round(perBlockOut)} tokens escritos pelo Claude + ~${Math.round(perBlockIn)} tokens lidos = ~${Math.round(perBlockOut+perBlockIn)}`);
 const usage=path.join('runs','mcp-uso.jsonl');
 if(fs.existsSync(usage)){const u=fs.readFileSync(usage,'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l));const look=u.filter(x=>x.tool==='ver_jogo'||x.tool==='ultimas_acoes');if(look.length)console.log(`  Cada olhada no jogo (ver_jogo/ultimas_acoes): ~${tokens(avg(look.map(x=>x.outChars)))} tokens lidos (${look.length} medidas)`);}
 const sizes=planned?[[`${planned} blocos`,planned]]:[['Piso 5x5',25],['Casinha 5x5x3 com teto',73],['Torre 3x3x10',80],['Casa 7x7x4 com teto',145]];
 console.log('  Previsão:');
 for(const [name,n] of sizes)console.log(`    ${name.padEnd(24)} ~${Math.round(n*(perBlockOut+perBlockIn)).toLocaleString('pt-BR')} tokens`);
 console.log('  O Laya não gasta tokens: roda no computador de vocês.');
}
