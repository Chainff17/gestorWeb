const fs = require('fs');
const { JSDOM } = require('jsdom');
const path = require('path');
let html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').replace(/<script src="https:\/\/[^"]+"><\/script>/g, '');
const dom = new JSDOM(html, { url: 'https://example.com/index.html', runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom; const { document } = window;
let errores = [];
window.console = { log(){}, error:(...a)=>errores.push(a.join(' ')), warn(){} };

// Sembrar datos legados (como los dejaba la versión v2)
window.localStorage.setItem('gestor_juanperez_clientes', JSON.stringify([{id:'c1',nombre:'Cliente Legacy',comision:3,saldo:50}]));
window.localStorage.setItem('gestor_juanperez_recibos', JSON.stringify([{id:'r1',clienteId:'c1',monto:100,comision:3,neto:97,fecha:Date.now(),numeroOp:1}]));
window.localStorage.setItem('gestor_juanperez_transferencias', JSON.stringify([{id:'t1',clienteId:'c1',monto:10,saldoAntes:147,fecha:Date.now(),numeroOp:2}]));
window.localStorage.setItem('gestor_juanperez_finanzas', JSON.stringify([{id:'f1',tipo:'comision',monto:3,descripcion:'Comisión de Cliente Legacy',clienteId:'c1',reciboId:'r1',fecha:Date.now()}]));
window.localStorage.setItem('gestor_dark_mode', 'true');

function qb(r){ const p=Promise.resolve(r); const c={select:()=>c,eq:()=>c,maybeSingle:()=>p,upsert:()=>p,then:(a,b)=>p.then(a,b)}; return c; }
let authCb = null; let remoteSnapshot = null;
window.supabase = { createClient: () => ({
  auth: { onAuthStateChange: cb=>{authCb=cb;return{data:{subscription:{unsubscribe(){}}}}}, getSession:()=>Promise.resolve({data:{session:null}}),
    signInWithPassword:()=>{ authCb && authCb('SIGNED_IN', SESION); return Promise.resolve({data:{session:SESION},error:null}); },
    signOut:()=>{ authCb && authCb('SIGNED_OUT', null); return Promise.resolve({error:null}); } },
  from: t => qb({ data: remoteSnapshot, error: null }),
  rpc: (name,args)=>{ if ((remoteSnapshot ? remoteSnapshot.revision : null) !== args.p_revision) return Promise.resolve({data:{ok:false},error:null}); remoteSnapshot={ revision:(remoteSnapshot ? remoteSnapshot.revision : 0)+1, payload:JSON.parse(JSON.stringify(args.p_payload)) }; return Promise.resolve({data:{ok:true,revision:remoteSnapshot.revision},error:null}); },
  channel: ()=>({on(){return this},subscribe(){return this}}), removeChannel:()=>{}
})};
const SESION = { user: { id: 'uid-legacy', email: 'l@x.com', user_metadata: { username: 'Legacy' } } };
window.Chart = class { destroy(){} };
window.XLSX = {}; window.jspdf = {};

const scripts = [...document.querySelectorAll('script:not([src])')];
dom.window.eval(scripts[scripts.length-1].textContent);

(async () => {
  await new Promise(r=>setTimeout(r,50));
  document.getElementById('loginUsuario').value = 'l@x.com';
  document.getElementById('loginPassword').value = '123456';
  document.getElementById('btnLogin').click();
  await new Promise(r=>setTimeout(r,150));

  console.log('errores tras login:', JSON.stringify(errores));
  console.log('authScreen display:', document.getElementById('authScreen').style.display);
  console.log('cloud key:', window.localStorage.getItem('gestor_cloud_uid-legacy'));
  const cache = JSON.parse(window.localStorage.getItem('gestor_cloud_uid-legacy') || '{}');
  console.log('cache keys:', Object.keys(cache));
  const ok = [];
  const chk = (name, cond) => { if (cond) ok.push('✅ '+name); else errores.push('❌ '+name); };

  chk('Cliente legado importado', (cache.clientes||[]).some(c=>c.nombre==='Cliente Legacy'));
  chk('Recibo legado importado', (cache.recibos||[]).length===1);
  chk('Transferencia legada importada', (cache.transferencias||[]).length===1);
  chk('Finanza legada importada', (cache.finanzas||[]).length===1);
  chk('Saldo conservado tal cual (50)', cache.clientes && cache.clientes[0] && Math.abs(cache.clientes[0].saldo-50)<0.01);
  chk('Modo oscuro aplicado', document.body.classList.contains('dark-mode'));
  chk('Sección visible', document.getElementById('appContent').classList.contains('show'));

  // No duplicar en segundo login
  document.getElementById('btnLogout').click && (window.confirm = ()=>true);
  document.getElementById('btnLogout').click();
  await new Promise(r=>setTimeout(r,80));
  document.getElementById('loginUsuario').value = 'l@x.com';
  document.getElementById('loginPassword').value = '123456';
  document.getElementById('btnLogin').click();
  await new Promise(r=>setTimeout(r,150));
  const cache2 = JSON.parse(window.localStorage.getItem('gestor_cloud_uid-legacy') || '{}');
  chk('Sin duplicados tras re-login', (cache2.clientes||[]).length===1 && (cache2.recibos||[]).length===1);

  console.log(ok.join('\n'));
  if (errores.length) { console.log(errores.join('\n')); process.exit(1); }
  console.log('✅ PRUEBA LEGADO OK');
  process.exit(0);
})().catch(e=>{ console.error('FATAL', e); process.exit(1); });
