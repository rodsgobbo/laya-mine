// Sends one console command to the local Minecraft server over RCON and prints the reply.
// Port and password come from server/server.properties (set up by iniciar.ps1). Usage: node rcon.mjs stop
import fs from 'node:fs';import net from 'node:net';
const props=Object.fromEntries(fs.readFileSync(new URL('./server/server.properties',import.meta.url),'utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
if(props['enable-rcon']!=='true'||!props['rcon.password']){console.error('RCON desligado no server.properties');process.exit(2);}
const command=process.argv.slice(2).join(' ')||'list';
// RCON packet: length, request id, type (3 = login, 2 = command), ASCII body, two NUL bytes; all little-endian.
const packet=(id,type,body)=>{const b=Buffer.from(body,'utf8'),p=Buffer.alloc(14+b.length);p.writeInt32LE(10+b.length,0);p.writeInt32LE(id,4);p.writeInt32LE(type,8);b.copy(p,12);return p;};
const socket=net.connect({host:props['server-ip']||'127.0.0.1',port:Number(props['rcon.port']||25575)});
let buf=Buffer.alloc(0);const timer=setTimeout(()=>{console.error('RCON sem resposta');process.exit(3);},8000);
socket.on('connect',()=>socket.write(packet(1,3,props['rcon.password'])));
socket.on('data',d=>{
 buf=Buffer.concat([buf,d]);
 while(buf.length>=4&&buf.length>=4+buf.readInt32LE(0)){
  const len=buf.readInt32LE(0),id=buf.readInt32LE(4),body=buf.subarray(12,4+len-2).toString('utf8');buf=buf.subarray(4+len);
  if(id===-1){console.error('Senha do RCON recusada');process.exit(4);}
  if(id===1){socket.write(packet(2,2,command));if(command==='stop'){setTimeout(()=>{clearTimeout(timer);console.log('stop enviado');socket.destroy();process.exit(0);},500);}}
  else if(id===2){clearTimeout(timer);console.log(body||'(ok)');socket.destroy();process.exit(0);}
 }
});
socket.on('error',e=>{console.error('RCON indisponível: '+e.message);process.exit(1);});
