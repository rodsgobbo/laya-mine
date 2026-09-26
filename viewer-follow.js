// Button (and F key) that turns camera follow on and off in the prismarine viewer.
// The camera itself is moved by the patched bundle (see prepare-viewer.mjs), which reads window.__amFollow.
(() => {
 let follow;
 try{follow=localStorage.getItem('amFollow')!=='0';}catch{follow=true;}
 window.__amFollow=follow;
 const button=document.createElement('button');
 button.style='position:fixed;top:calc(16vh + 8px);right:12px;z-index:100;padding:10px 16px;font:bold 16px system-ui,sans-serif;border:0;border-radius:8px;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.4)';
 const render=()=>{button.textContent=window.__amFollow?'🎥 Seguindo o bot (F)':'🗺️ Câmera livre (F)';button.style.background=window.__amFollow?'#4caf50':'#555';button.style.color='#fff';};
 const toggle=()=>{window.__amFollow=!window.__amFollow;try{localStorage.setItem('amFollow',window.__amFollow?'1':'0');}catch{}render();};
 button.addEventListener('click',toggle);
 window.addEventListener('keydown',e=>{if(e.key==='f'||e.key==='F')toggle();});
 render();document.body.append(button);

 // Day/night badge from the game clock (ticks: 0 = 6h, 6000 = noon, 13000-23000 = night).
 const clock=document.createElement('div');
 clock.style='position:fixed;top:calc(16vh + 8px);left:12px;z-index:100;padding:10px 16px;font:bold 16px system-ui,sans-serif;border-radius:8px;color:#fff;background:rgba(0,0,0,.6);box-shadow:0 2px 6px rgba(0,0,0,.4)';
 document.body.append(clock);
 const update=async()=>{
  try{
   const {timeOfDay,day}=await (await fetch('am-time')).json();
   if(timeOfDay==null){clock.textContent='⏳ Carregando...';return;}
   const minutes=Math.floor(((timeOfDay+6000)%24000)/24000*1440),hh=String(Math.floor(minutes/60)).padStart(2,'0'),mm=String(minutes%60).padStart(2,'0');
   const night=timeOfDay>=13000&&timeOfDay<23000;
   clock.textContent=(night?'🌙 Noite':'☀️ Dia')+` · ${hh}:${mm} · dia ${day+1}`;
   clock.style.background=night?'rgba(20,30,80,.8)':'rgba(0,0,0,.6)';
  }catch{clock.textContent='⚠️ Sem conexão com o bot';}
 };
 update();setInterval(update,2000);
})();
