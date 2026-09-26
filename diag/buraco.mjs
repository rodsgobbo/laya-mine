// Diagnostic: a second bot ("Diag") digs a 3-deep hole under itself, then asks the pathfinder to climb out.
// Use it to tell a pathfinder bug from a stuck state in the main bot. Run: node diag/buraco.mjs
import mineflayer from 'mineflayer';
import pf from 'mineflayer-pathfinder';
const {pathfinder,Movements,goals}=pf;
const bot=mineflayer.createBot({host:'127.0.0.1',port:Number(process.env.MC_PORT||25576),username:'Diag',version:'1.16.5'});
bot.loadPlugin(pathfinder);
const events=[];bot.on('path_update',r=>events.push(r.status+':'+r.path.length));
setTimeout(()=>{console.log('HARD TIMEOUT',events.slice(-10).join(' '));process.exit(1);},90000);
bot.once('spawn',async()=>{
 await bot.waitForTicks(40);
 bot.pathfinder.setMovements(new Movements(bot));
 const start=bot.entity.position.floored();console.log('start',start.toString());
 for(let i=1;i<=3;i++){const b=bot.blockAt(bot.entity.position.floored().offset(0,-1,0));if(!b||!bot.canDigBlock(b)){console.log('cannot dig',b?.name);break;}await bot.dig(b);await bot.waitForTicks(15);}
 await bot.waitForTicks(20);
 const inv={};for(const i of bot.inventory.items())inv[i.name]=(inv[i.name]||0)+i.count;
 console.log('in hole at',bot.entity.position.floored().toString(),'inventory',JSON.stringify(inv));
 const t=Date.now();
 try{await Promise.race([bot.pathfinder.goto(new goals.GoalBlock(start.x+2,start.y,start.z)),new Promise((_,r)=>setTimeout(()=>r(Error('timeout 30s')),30000))]);console.log('CLIMBED OUT in',Date.now()-t,'ms');}
 catch(e){console.log('FAILED',e.message,'pos',bot.entity.position.floored().toString());}
 console.log('path events',events.slice(-8).join(' '));
 bot.pathfinder.setGoal(null);bot.quit();setTimeout(()=>process.exit(0),500);
});
bot.on('error',e=>{console.log('ERR',e.message);process.exit(1);});
