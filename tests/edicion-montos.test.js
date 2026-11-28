// Prueba de edición mediante la interfaz, con datos y Supabase simulados.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');
const html = fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').replace(/<script src="https:\/\/[^"]+"><\/script>/g,'');
const dom = new JSDOM(html,{url:'https://example.com/',runScripts:'outside-only',pretendToBeVisual:true});
const {window:w}=dom, d=w.document;
w.console={log(){},warn(){},error(){}}; w.confirm=()=>true; w.HTMLCanvasElement.prototype.getContext=()=>({}); w.Chart=class{destroy(){}}; w.XLSX={};
const fecha=new Date(2025,0,1).getTime();
const base={
 clientes:[{id:'a',nombre:'Ana',comision:25,saldo:-25},{id:'b',nombre:'Beto',comision:0,saldo:15},{id:'c',nombre:'Legado',comision:9,saldo:80}],
 recibos:[{id:'r',clienteId:'a',monto:100,comision:10,neto:90,fecha,numeroOp:2},{id:'legacy',clienteId:'c',monto:100,comision:10,neto:80,fecha,numeroOp:6}],
 transferencias:[{id:'old',clienteId:'a',monto:5,saldoAntes:777,fecha,numeroOp:1},{id:'t1',clienteId:'a',monto:80,saldoAntes:85,fecha,numeroOp:3,prestamoAutomatico:true,numeroDestino:'9212129938675427',tipoDestino:'tarjeta'},{id:'t2',clienteId:'a',monto:30,saldoAntes:5,fecha,numeroOp:4,prestamoAutomatico:true},{id:'tb',clienteId:'b',monto:5,saldoAntes:20,fecha,numeroOp:5}],
 finanzas:[{id:'com',tipo:'comision',monto:10,clienteId:'a',reciboId:'r',fecha,descripcion:'Comisión de Ana'},{id:'loan',tipo:'gasto',monto:25,clienteId:'a',transferenciaId:'t2',fecha,descripcion:'Préstamo a Ana'},{id:'legacy-fee',tipo:'comision',monto:10,clienteId:'c',fecha,descripcion:'Comisión antigua sin vínculo'}]
};
let snapshot={payload:JSON.parse(JSON.stringify(base)),revision:1,updated_at:new Date().toISOString()};
const session={user:{id:'edit-test',email:'edit@test.invalid',user_metadata:{username:'Edit'}}};
w.supabase={createClient:()=>({auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),getSession:async()=>({data:{session}})},from:table=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:table==='gestor_preferencias'?null:snapshot,error:null}),upsert:async()=>({error:null}),insert:async()=>({error:null})};return q},rpc:async(name,args)=>{if(args.p_revision!==snapshot.revision)return {data:{ok:false},error:null}; snapshot={payload:JSON.parse(JSON.stringify(args.p_payload)),revision:snapshot.revision+1};return {data:{ok:true,revision:snapshot.revision},error:null}},functions:{invoke:async()=>({data:{rates:[]},error:null})},channel:()=>({on(){return this},subscribe(){return this}}),removeChannel(){}})};
const main=[...d.querySelectorAll('script:not([src])')].pop().textContent; w.eval(main);
const saved=()=>JSON.parse(w.localStorage.getItem('gestor_cloud_edit-test'));
const input=(id,value)=>{const e=d.getElementById(id);e.value=String(value);e.dispatchEvent(new w.Event('input',{bubbles:true}));};
const edit=id=>{d.querySelector(`#listaHistorial [data-action="edit-op"][data-id="${id}"]`).click();assert(d.getElementById('modalEditar').classList.contains('open'));};
const close=(a,b)=>assert(Math.abs(a-b)<1e-8,`${a} != ${b}`);
(async()=>{
 await new Promise(r=>setTimeout(r,100)); d.querySelector('#bottomMenu [data-section=historial]').click();
 const order=()=>[...d.querySelectorAll('#listaHistorial [data-action=edit-op]')].map(x=>x.dataset.id).join(','); const originalOrder=order();
 edit('r'); assert.equal(d.getElementById('modalMonto').readOnly,false); input('modalMonto',200);
 close(Number(d.getElementById('modalComision').value),20); assert(d.getElementById('vistaAjuste').textContent.includes('Neto: $180.00'));
 d.getElementById('modalGuardar').click(); let s=saved();
 close(s.recibos[0].monto,200); close(s.recibos[0].comision,20); close(s.recibos[0].neto,180);
 close(s.clientes[0].saldo,65); close(s.transferencias[0].saldoAntes,777); close(s.transferencias[1].saldoAntes,175); close(s.transferencias[2].saldoAntes,95);
 close(s.finanzas.find(x=>x.id==='com').monto,20); close(s.finanzas.find(x=>x.id==='loan').monto,0); assert.equal(order(),originalOrder);
 assert.deepEqual(s.clientes[1],base.clientes[1]); assert.deepEqual(s.transferencias[3],base.transferencias[3]);
 edit('t1'); input('modalMonto',100); d.getElementById('modalGuardar').click(); s=saved();
 close(s.transferencias[1].saldoAntes,175); close(s.transferencias[1].monto,100); close(s.transferencias[2].saldoAntes,75); close(s.clientes[0].saldo,45); assert.equal(order(),originalOrder);
 edit('t1'); input('modalMonto',200); input('modalSaldoDisponible',150); assert(d.getElementById('vistaAjuste').textContent.includes('$-80.00')); d.getElementById('modalGuardar').click(); s=saved();
 close(s.transferencias[1].saldoAntes,150); close(s.transferencias[1].ajusteSaldo,-25); close(s.transferencias[2].saldoAntes,-50); close(s.clientes[0].saldo,-80);
 close(s.finanzas.find(x=>x.transferenciaId==='t1').monto,50); close(s.finanzas.find(x=>x.id==='loan').monto,30); close(s.transferencias[0].saldoAntes,777); assert.equal(order(),originalOrder);
 edit('t1'); let antes=w.localStorage.getItem('gestor_cloud_edit-test'); input('modalMonto',0); d.getElementById('modalGuardar').click(); assert.equal(w.localStorage.getItem('gestor_cloud_edit-test'),antes); assert(d.getElementById('modalEditar').classList.contains('open')); d.getElementById('modalCancelar').click();
 edit('r'); input('modalComision',30); d.getElementById('modalGuardar').click(); s=saved();
 close(s.recibos[0].neto,170); close(s.clientes[0].saldo,-90); close(s.transferencias[1].saldoAntes,140); close(s.transferencias[2].saldoAntes,-60); close(s.finanzas.find(x=>x.id==='com').monto,30); close(s.finanzas.find(x=>x.transferenciaId==='t1').monto,60); antes=w.localStorage.getItem('gestor_cloud_edit-test');
 edit('legacy'); input('modalMonto',200); assert.equal(d.getElementById('modalComision').value,''); d.getElementById('modalGuardar').click(); assert.equal(w.localStorage.getItem('gestor_cloud_edit-test'),antes);
 input('modalComision',20); assert(d.getElementById('vistaAjuste').textContent.includes('sin vínculo')); d.getElementById('modalGuardar').click(); s=saved();
 close(s.recibos[1].neto,180); close(s.clientes[2].saldo,180); assert(!s.finanzas.some(x=>x.reciboId==='legacy')); close(s.finanzas.find(x=>x.id==='legacy-fee').monto,10);
 edit('r'); input('modalMonto',300); d.querySelector('#bottomMenu [data-section=clientes]').click(); d.getElementById('btnMostrarAgregarCliente').click(); input('clienteNombre','Nuevo'); input('clienteComision',0); d.getElementById('btnAgregarCliente').click(); antes=w.localStorage.getItem('gestor_cloud_edit-test'); d.getElementById('modalGuardar').click(); assert.equal(w.localStorage.getItem('gestor_cloud_edit-test'),antes); assert(d.getElementById('modalEditar').classList.contains('open'));
 console.log('OK: edición de importes, comisiones históricas, préstamos, legados y conflictos'); dom.window.close(); process.exit(0);
})().catch(e=>{console.error(e);dom.window.close();process.exit(1)});
