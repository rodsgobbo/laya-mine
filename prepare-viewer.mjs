import {readFileSync,writeFileSync,copyFileSync,existsSync,cpSync} from 'node:fs';
const base='node_modules/prismarine-viewer/public/';
const file=base+'index.html';
let html=readFileSync(file,'utf8');
if(!html.includes('/recording-client.js'))html=html.replace('</body>','<script src="/recording-client.js"></script></body>');
writeFileSync(file,html);copyFileSync('recording-client.js',base+'recording-client.js');
if(existsSync('item-textures.json'))copyFileSync('item-textures.json',base+'item-textures.json');
console.log('Viewer HUD installed');

const viewerFile='node_modules/prismarine-viewer/lib/mineflayer.js';
let viewer=readFileSync(viewerFile,'utf8');
if(!viewer.includes('    botPosition()'))viewer=viewer.replace("    bot.on('move', botPosition)","    botPosition()\n    bot.on('move', botPosition)");
// Auto-mine: game clock for the day/night badge in viewer-follow.js (the viewer has no day/night lighting).
// Auto-mine: HUD data (hotbar, held item, health, food, mission) from the agent; same origin so a tablet can load it too.
if(!viewer.includes('/am-status'))viewer=viewer.replace('  setupRoutes(app, prefix)\n',"  setupRoutes(app, prefix)\n  app.get(prefix + '/am-status', (req, res) => res.json(bot.amStatus ? bot.amStatus() : {}))\n");
if(!viewer.includes('/am-time'))viewer=viewer.replace('  setupRoutes(app, prefix)\n',"  setupRoutes(app, prefix)\n  app.get(prefix + '/am-time', (req, res) => res.json({ timeOfDay: bot.time ? bot.time.timeOfDay : null, day: bot.time ? bot.time.day : null }))\n");
writeFileSync(viewerFile,viewer);

cpSync('node_modules/minecraft-assets/minecraft-assets/data/1.16.4',base+'textures/1.16.4',{recursive:true});

// Auto-mine: optional camera follow. The stock viewer aims at the bot once and then stays put.
// While window.__amFollow is on, shift the orbit camera by the bot's movement so zoom and angle are kept.
html=readFileSync(file,'utf8');
if(!html.includes('/viewer-follow.js'))html=html.replace('</body>','<script src="/viewer-follow.js"></script></body>');
writeFileSync(file,html);copyFileSync('viewer-follow.js',base+'viewer-follow.js');
const bundleFile=base+'index.js';let bundle=readFileSync(bundleFile,'utf8');
const aimOnce='if(t.y>0&&s&&(h.target.set(t.x,t.y,t.z),u.camera.position.set(t.x,t.y+20,t.z+20),h.update(),s=!1),i){';
const aimFollow='if(t.y>0&&s&&(h.target.set(t.x,t.y,t.z),u.camera.position.set(t.x,t.y+20,t.z+20),h.update(),s=!1),t.y>0&&!s&&h&&window.__amFollow!==!1&&(u.camera.position.x+=t.x-h.target.x,u.camera.position.y+=t.y-h.target.y,u.camera.position.z+=t.z-h.target.z,h.target.set(t.x,t.y,t.z)),i){';
// Mobs the viewer has no model for were drawn as magenta boxes (e.g. the wandering trader's llamas).
// Draw them with the closest existing model.
const entityCall='const i=new a("1.16.4",t.name,e);';
const aliases='{trader_llama:"llama",giant:"zombie",illusioner:"evoker",furnace_minecart:"minecart",spawner_minecart:"minecart",spectral_arrow:"arrow"}';
if(!bundle.includes('trader_llama:"llama"')){
 if(!bundle.includes(entityCall))console.log('Viewer bundle changed; mob model aliases not installed');
 else{bundle=bundle.replace(entityCall,'const i=new a("1.16.4",'+aliases+'[t.name]||t.name,e);');writeFileSync(bundleFile,bundle);console.log('Viewer mob model aliases installed');}
}
// Dropped items have no model either: draw a small sprite with the item's own picture instead of a magenta box.
// window.__amItemTextures is loaded by viewer-follow.js; the item name comes from the worldView patch below.
const boxFallback='const i=new n.BoxGeometry(t.width,t.height,t.width);';
// Items already on the ground arrive right after the page connects, often before the picture list loads,
// so the sprite is created at once and gets its picture when the list arrives.
const itemSprite='if(t.name==="item"&&t.item){window.__amItemTexturesP=window.__amItemTexturesP||fetch("item-textures.json").then(r=>r.json());const m=new n.SpriteMaterial({transparent:!0,color:13421772});const s=new n.Sprite(m);s.scale.set(.5,.5,.5);s.position.y=.25;const g=new n.Group;g.add(s);window.__amItemTexturesP.then(x=>{const u=x[t.item];if(!u)return;(new n.TextureLoader).load(u,q=>{q.magFilter=n.NearestFilter;m.map=q;m.color.set(16777215);m.needsUpdate=!0})}).catch(()=>{});return g}';
if(bundle.includes('window.__amItemTextures&&window.__amItemTextures[t.item]')){
 // Upgrade the first version of this patch (it depended on the picture list being loaded first).
 const old='if(t.name==="item"&&t.item&&window.__amItemTextures&&window.__amItemTextures[t.item]){const m=new n.SpriteMaterial({map:(new n.TextureLoader).load(window.__amItemTextures[t.item]),transparent:!0});m.map.magFilter=n.NearestFilter;const s=new n.Sprite(m);s.scale.set(.5,.5,.5);s.position.y=.25;const g=new n.Group;g.add(s);return g}';
 bundle=bundle.replace(old,itemSprite);writeFileSync(bundleFile,bundle);console.log('Viewer dropped item sprites upgraded');
}
if(!bundle.includes('window.__amItemTexturesP')){
 if(!bundle.includes(boxFallback))console.log('Viewer bundle changed; dropped item sprites not installed');
 else{bundle=bundle.replace(boxFallback,itemSprite+boxFallback);writeFileSync(bundleFile,bundle);console.log('Viewer dropped item sprites installed');}
}
const worldViewFile='node_modules/prismarine-viewer/viewer/lib/worldView.js';let worldView=readFileSync(worldViewFile,'utf8');
if(!worldView.includes('droppedItemName')){
 const spawn="        if (e === bot.entity) return\n        worldView.emitter.emit('entity', { id: e.id, name: e.name, pos: e.position, width: e.width, height: e.height, username: e.username })";
 const sync="        this.emitter.emit('entity', { id: e.id, name: e.name, pos: e.position, width: e.width, height: e.height, username: e.username })";
 if(!worldView.includes(spawn)||!worldView.includes(sync))console.log('Viewer worldView changed; dropped item names not sent');
 else{
  // Item metadata arrives just after the spawn packet, so item spawns are sent a moment later.
  worldView="const droppedItemName = e => e.name === 'item' && e.getDroppedItem ? (e.getDroppedItem() || {}).name : undefined\n"+worldView
   .replace(spawn,"        if (e === bot.entity) return\n        const send = () => worldView.emitter.emit('entity', { id: e.id, name: e.name, pos: e.position, width: e.width, height: e.height, username: e.username, item: droppedItemName(e) })\n        if (e.name === 'item') setTimeout(() => { if (bot.entities[e.id]) send() }, 250)\n        else send()")
   .replace(sync,"        this.emitter.emit('entity', { id: e.id, name: e.name, pos: e.position, width: e.width, height: e.height, username: e.username, item: droppedItemName(e) })");
  writeFileSync(worldViewFile,worldView);console.log('Viewer dropped item names installed');
 }
}
if(!bundle.includes('window.__amFollow')){
 if(!bundle.includes(aimOnce))console.log('Viewer bundle changed; camera follow not installed');
 else{bundle=bundle.replace(aimOnce,aimFollow);writeFileSync(bundleFile,bundle);console.log('Viewer camera follow installed');}
}
