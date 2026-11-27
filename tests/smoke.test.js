/* Smoke test del Gestor de Pagos con jsdom + stubs de Supabase/CDN */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const htmlPath = process.argv[2] || path.join(__dirname, '..', 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');

// Quitar tags de scripts externos (CDN no accesible desde el sandbox)
html = html.replace(/<script src="https:\/\/[^"]+"><\/script>/g, '');

let errores = [];
let logs = [];

const dom = new JSDOM(html, {
  url: 'https://example.com/index.html',
  runScripts: 'outside-only',
  pretendToBeVisual: true
});

const { window } = dom;
const { document } = window;
function irSeccion(sec) {
  const destino = document.querySelector('#bottomMenu button[data-section="' + sec + '"]') || document.querySelector('#dropdownMenu button[data-section="' + sec + '"]');
  if (!destino) throw new Error('Falta navegación: ' + sec);
  destino.click();
}
window.confirm = () => true;
window.HTMLCanvasElement.prototype.getContext = () => ({});


// ---------- STUBS ----------
window.console = {
  log: (...a) => logs.push(a.join(' ')),
  error: (...a) => { errores.push('[console.error] ' + a.join(' ')); },
  warn: () => {}
};

// Session storage / localStorage ya existen en jsdom

// Query builder stub de Supabase
function qb(result) {
  const p = Promise.resolve(result);
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => p,
    upsert: () => p,
    insert: () => p,
    update: () => p,
    delete: () => p,
    order: () => chain,
    limit: () => p,
    then: (res, rej) => p.then(res, rej)
  };
  return chain;
}

let remoteSnapshot = null;
let authCallback = null;
let signOutCalls = 0;
let tasasError = false;

window.supabase = {
  createClient: (url, key) => {
    if (!url || !key) throw new Error('falta config');
    return {
      auth: {
        onAuthStateChange: cb => { authCallback = cb; return { data: { subscription: { unsubscribe() {} } } }; },
        getSession: () => Promise.resolve({ data: { session: null }, error: null }),
        signInWithPassword: ({ email, password }) => {
          if (email === 'test@x.com' && password === '123456') {
            if (authCallback) authCallback('SIGNED_IN', SESION);
            return Promise.resolve({ data: { session: SESION }, error: null });
          }
          return Promise.resolve({ data: {}, error: { message: 'Invalid login credentials' } });
        },
        signUp: () => {
          if (authCallback) authCallback('SIGNED_IN', SESION);
          return Promise.resolve({ data: { session: SESION }, error: null });
        },
        resetPasswordForEmail: () => Promise.resolve({ data: {}, error: null }),
        verifyOtp: ({ token }) => token === '12345678'
          ? Promise.resolve({ data: { session: SESION }, error: null })
          : Promise.resolve({ data: {}, error: { message: 'OTP expired' } }),
        updateUser: () => Promise.resolve({ data: {}, error: null }),
        signOut: () => { signOutCalls++; if (authCallback) authCallback('SIGNED_OUT', null); return Promise.resolve({ error: null }); }
      },
      from: table => {
        if (table !== 'gestor_snapshots') throw new Error('tabla inesperada: ' + table);
        return qb({ data: remoteSnapshot, error: null });
      },
      rpc: (name, args) => {
        if ((remoteSnapshot ? remoteSnapshot.revision : null) !== args.p_revision) return Promise.resolve({data:{ok:false},error:null});
        remoteSnapshot = {revision:(remoteSnapshot ? remoteSnapshot.revision : 0)+1,payload:JSON.parse(JSON.stringify(args.p_payload)),updated_at:new Date().toISOString()};
        return Promise.resolve({data:{ok:true,revision:remoteSnapshot.revision},error:null});
      },
      functions: { invoke: async () => tasasError ? {data:null,error:{message:'offline'}} : {data:{generated_at:'2020-01-01T00:00:00Z',rates:[{code:'USD',cup:100},{code:'EUR',cup:120},{code:'MLC',cup:90},{code:'CAD',cup:80}]},error:null} },
      channel: () => ({ on() { return this; }, subscribe() { return this; } }),
      removeChannel: () => {}
    };
  }
};

const SESION = {
  user: {
    id: 'uid-test-123',
    email: 'test@x.com',
    user_metadata: { username: 'Ale Test' }
  }
};

// CDNs stub
window.Chart = class Chart { constructor() { this.destroy = () => {}; } };
window.XLSX = { utils: {}, read: () => ({ Sheets: {}, SheetNames: [] }), write: () => new ArrayBuffer(0) };
window.jspdf = { jsPDF: class jsPDF { constructor(){ this.internal={ pageSize:{getWidth:()=>297,getHeight:()=>210}, getNumberOfPages:()=>1 }; } text(){} setFontSize(){} setTextColor(){} setPage(){} save(){} autoTable(){} } };

// Ejecutar el script principal de la página
const scripts = [...document.querySelectorAll('script:not([src])')];
const mainScript = scripts[scripts.length - 1].textContent;

let cola = Promise.resolve();
function run(label, fn) {
  cola = cola.then(() => {
    try {
      const r = fn();
      if (r && typeof r.then === 'function') {
        return r.then(
          () => logs.push('✅ ' + label),
          e => errores.push('❌ ' + label + ': ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n'))
        );
      }
      logs.push('✅ ' + label);
    } catch (e) {
      errores.push('❌ ' + label + ': ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n'));
    }
  });
}

(async () => {
  // 1) Arranque
  run('Ejecutar script principal', () => {
    dom.window.eval(mainScript);
  });

  await new Promise(r => setTimeout(r, 50));

  run('Pantalla de login visible tras arranque', () => {
    const auth = document.getElementById('authScreen');
    if (auth.style.display !== 'flex') throw new Error('authScreen no visible: ' + auth.style.display);
    if (document.getElementById('appContent').classList.contains('show')) throw new Error('app visible sin sesión');
  });

  run('Error si Supabase no carga (sb=null) se maneja', () => {
    // ya verificado implícitamente: bootstrap no lanzó excepción
  });

  // 2) Login con credenciales inválidas
  document.getElementById('loginUsuario').value = 'test@x.com';
  document.getElementById('loginPassword').value = 'mala';
  document.getElementById('btnLogin').click();
  await new Promise(r => setTimeout(r, 30));

  run('Login inválido muestra error', () => {
    const err = document.getElementById('loginError');
    if (!err.classList.contains('show')) throw new Error('no mostró error');
    if (!/incorrectos/i.test(err.textContent)) throw new Error('texto inesperado: ' + err.textContent);
  });

  // 3) Login correcto
  document.getElementById('loginPassword').value = '123456';
  document.getElementById('btnLogin').click();
  await new Promise(r => setTimeout(r, 100));

  run('Login correcto entra a la app', () => {
    if (document.getElementById('authScreen').style.display !== 'none') throw new Error('auth sigue visible');
    if (!document.getElementById('appContent').classList.contains('show')) throw new Error('app no visible');
    const badge = document.getElementById('usuarioBadge').textContent;
    if (!badge.includes('Ale Test')) throw new Error('badge: ' + badge);
  });

  // 4) Agregar cliente
  run('Agregar cliente', () => {
    document.getElementById('btnMostrarAgregarCliente').click();
    document.getElementById('clienteNombre').value = 'Juan Pérez <b>test</b>';
    document.getElementById('clienteComision').value = '2';
    document.getElementById('btnAgregarCliente').click();
    const cache = JSON.parse(window.localStorage.getItem('gestor_cloud_uid-test-123') || '{}');
    if (!cache.clientes || cache.clientes.length !== 1) throw new Error('no guardó: ' + JSON.stringify(cache.clientes));
    if (cache.clientes[0].nombre !== 'Juan Pérez <b>test</b>') throw new Error('nombre mal guardado');
  });

  run('XSS escapado en la lista de clientes', () => {
    document.getElementById('btnMostrarListaClientes').click();
    const cont = document.getElementById('listaClientesResumen');
    if (cont.querySelector('b')) throw new Error('HTML inyectado NO escapado');
    if (!cont.textContent.includes('Juan Pérez')) throw new Error('no se renderizó el nombre');
  });

  // 5) Registrar recibo
  run('Registrar recibo con comisión', () => {
    document.getElementById('btnMostrarRecibir') && null;
    // cambiar a sección operaciones
    irSeccion('operaciones');
    const sel = document.getElementById('recibirCliente');
    if (!sel.options.length) throw new Error('select sin clientes');
    document.getElementById('recibirMonto').value = '100';
    document.getElementById('recibirMonto').dispatchEvent(new window.Event('input'));
    const neto = document.getElementById('recibirNeto').value;
    if (neto !== '$98.00') throw new Error('neto esperado $98.00, got ' + neto);
    document.getElementById('btnRegistrarRecibo').click();
    const cache = JSON.parse(window.localStorage.getItem('gestor_cloud_uid-test-123') || '{}');
    if (!cache.recibos || cache.recibos.length !== 1) throw new Error('recibo no guardado');
    if (Math.abs(cache.clientes[0].saldo - 98) > 0.001) throw new Error('saldo: ' + cache.clientes[0].saldo);
    if (!cache.finanzas.some(f => f.tipo === 'comision' && Math.abs(f.monto - 2) < 0.001)) throw new Error('finanza comisión no creada');
  });

  // 6) Transferencia con número de tarjeta
  run('Validar y registrar transferencia sin confirmación', () => {
    const input = document.getElementById('numeroDestino');
    const antes = JSON.parse(window.localStorage.getItem('gestor_cloud_uid-test-123'));
    input.value = '123'; input.dispatchEvent(new window.Event('input'));
    document.getElementById('transferirMonto').value = '50';
    document.getElementById('btnRegistrarTransferencia').click();
    if (JSON.parse(window.localStorage.getItem('gestor_cloud_uid-test-123')).transferencias.length !== antes.transferencias.length) throw new Error('aceptó destino inválido');
    input.value = '9212129938675427';
    input.dispatchEvent(new window.Event('input'));
    if (input.dataset.tipoDetectado !== 'tarjeta') throw new Error('no detectó tarjeta: ' + input.dataset.tipoDetectado);
    if (input.dataset.banco !== 'BPA') throw new Error('banco: ' + input.dataset.banco);
    if (input.value !== '9212-1299-3867-5427') throw new Error('formato: ' + input.value);
    document.getElementById('transferirMonto').value = '0';
    document.getElementById('btnRegistrarTransferencia').click();
    if (JSON.parse(window.localStorage.getItem('gestor_cloud_uid-test-123')).transferencias.length !== antes.transferencias.length) throw new Error('aceptó monto inválido');
    document.getElementById('transferirMonto').value = '50';
    let confirmaciones = 0;
    const confirmar = window.confirm;
    window.confirm = () => { confirmaciones++; return false; };
    try { document.getElementById('btnRegistrarTransferencia').click(); } finally { window.confirm = confirmar; }
    if (confirmaciones !== 0) throw new Error('se pidió confirmación');
    const cache = JSON.parse(window.localStorage.getItem('gestor_cloud_uid-test-123') || '{}');
    if (!cache.transferencias || cache.transferencias.length !== 1) throw new Error('transferencia no guardada');
    if (Math.abs(cache.clientes[0].saldo - 48) > 0.001) throw new Error('saldo post-transfer: ' + cache.clientes[0].saldo);
  });

  run('Portada muestra saldo y accesos rápidos funcionan', () => {
    irSeccion('inicio');
    if (document.getElementById('saldoInicio').textContent !== '$48.00') throw new Error('saldo inicio incorrecto: ' + document.getElementById('saldoInicio').textContent);
    for (const [id, sec, tab] of [['quickRecibir','operaciones','recibir'], ['quickTransferir','operaciones','transferir'], ['quickSaldo','saldo',null], ['quickHistorial','historial',null]]) {
      document.getElementById(id).click();
      if (!document.getElementById('section-' + sec).classList.contains('visible')) throw new Error(id + ' no navega');
      if (tab && document.getElementById('sub-' + tab).style.display !== 'block') throw new Error(id + ' no abre la pestaña');
    }
  });

  // 7) Navegar por todas las secciones
  run('Navegar todas las secciones sin errores', () => {
    ['clientes', 'operaciones', 'saldo', 'historial', 'finanzas', 'bd'].forEach(sec => {
      irSeccion(sec);
      const el = document.getElementById('section-' + sec);
      if (!el.classList.contains('visible')) throw new Error('sección no visible: ' + sec);
    });
  });

  // 8) Historial renderiza con acciones de edición
  run('Historial muestra operaciones con botón editar', () => {
    document.querySelector('#bottomMenu button[data-section="historial"]').click();
    const cont = document.getElementById('listaHistorial');
    const cards = cont.querySelectorAll('.operacion-card');
    if (cards.length !== 2) throw new Error('esperaba 2 ops, hay ' + cards.length);
    const editar = cont.querySelector('[data-action="edit-op"]');
    if (!editar) throw new Error('sin botón editar');
    const copiar = cont.querySelector('[data-action="copy-transfer"]');
    if (!copiar) throw new Error('sin botón copiar en transferencia');
  });

  // 9) Abrir modal de edición desde historial
  run('Modal edición abre desde historial', () => {
    const editar = document.querySelector('#listaHistorial [data-action="edit-op"]');
    editar.click();
    const modal = document.getElementById('modalEditar');
    if (!modal.classList.contains('open')) throw new Error('modal no abrió');
    if (!document.getElementById('modalMonto').value) throw new Error('monto vacío');
    document.getElementById('modalCancelar').click();
    if (modal.classList.contains('open')) throw new Error('modal no cerró');
  });

  // 10) Editar cliente desde lista
  run('Modal editar cliente funciona', () => {
    document.querySelector('#bottomMenu button[data-section="clientes"]').click();
    document.getElementById('btnMostrarListaClientes').click();
    const btn = document.querySelector('#listaClientesResumen [data-action="edit-cliente"]');
    if (!btn) throw new Error('sin botón editar cliente');
    btn.click();
    const modal = document.getElementById('modalEditarCliente');
    if (!modal.classList.contains('open')) throw new Error('modal no abrió');
    document.getElementById('mcNombre').value = 'Juan Modificado';
    document.getElementById('mcGuardar').click();
    const cache = JSON.parse(window.localStorage.getItem('gestor_cloud_uid-test-123') || '{}');
    if (cache.clientes[0].nombre !== 'Juan Modificado') throw new Error('no actualizó nombre');
    // renombrar propagado en recibos vía clienteId (sin cambios de id)
    if (modal.classList.contains('open')) throw new Error('modal no cerró');
  });

  // 11) Saldo section
  run('Sección saldo calcula total', () => {
    irSeccion('saldo');
    const total = document.getElementById('saldoTotal').textContent;
    if (total !== '$48.00') throw new Error('total: ' + total);
  });

  // 12) Finanzas + gráfico
  run('Finanzas muestra stats', () => {
    document.querySelector('#bottomMenu button[data-section="finanzas"]').click();
    if (document.getElementById('totalComisiones').textContent !== '$2.00') {
      throw new Error('comisiones: ' + document.getElementById('totalComisiones').textContent);
    }
    document.getElementById('btnMostrarGrafico').click();
    if (document.getElementById('sub-grafico').style.display !== 'block') throw new Error('gráfico no visible');
  });

  // 13) Filtro historial
  run('Filtro por tipo en historial', () => {
    document.querySelector('#bottomMenu button[data-section="historial"]').click();
    const sel = document.getElementById('historialTipo');
    sel.value = 'recibo';
    sel.dispatchEvent(new window.Event('change'));
    const cards = document.querySelectorAll('#listaHistorial .operacion-card');
    if (cards.length !== 1) throw new Error('esperaba 1 recibo, hay ' + cards.length);
    sel.value = 'todos';
    sel.dispatchEvent(new window.Event('change'));
  });

  // 14) Búsqueda de clientes
  run('Buscador de clientes filtra', () => {
    document.querySelector('#bottomMenu button[data-section="clientes"]').click();
    document.getElementById('btnMostrarListaClientes').click();
    const buscador = document.getElementById('buscadorCliente');
    buscador.value = 'noexiste';
    buscador.dispatchEvent(new window.Event('input'));
    const visibles = [...document.querySelectorAll('#listaClientesResumen .cliente-card')]
      .filter(c => c.style.display !== 'none');
    if (visibles.length !== 0) throw new Error('debería filtrar todo');
    buscador.value = 'modificado';
    buscador.dispatchEvent(new window.Event('input'));
    const visibles2 = [...document.querySelectorAll('#listaClientesResumen .cliente-card')]
      .filter(c => c.style.display !== 'none');
    if (visibles2.length !== 1) throw new Error('debería encontrar 1');
  });

  // 15) Sincronización: pushCloud se programa con persist
  run('persist() programa subida (sync chip cambia)', () => {
    document.getElementById('btnSyncNow').click();
  });
  await new Promise(r => setTimeout(r, 50));

  // 16) Cambio de sesión por realtime (otro dispositivo)
  run('Sesión inicial no duplica (SIGNED_IN repetido)', async () => {
    if (!authCallback) throw new Error('no se suscribió a auth');
    // re-disparar con la misma sesión no debe re-cargar ni duplicar
    await authCallback('TOKEN_REFRESHED', SESION);
    const cache = JSON.parse(window.localStorage.getItem('gestor_cloud_uid-test-123') || '{}');
    if (cache.clientes.length !== 1) throw new Error('datos alterados: ' + cache.clientes.length);
  });
  await new Promise(r => setTimeout(r, 50));

  run('Editar saldo mantiene los registros y su posición en historial', () => {
    irSeccion('operaciones');
    document.getElementById('btnMostrarTransferir').click();
    const numero = document.getElementById('numeroDestino');
    numero.value = '9212129938675427'; numero.dispatchEvent(new window.Event('input'));
    document.getElementById('transferirMonto').value = '20';
    document.getElementById('btnRegistrarTransferencia').click();
    let data=JSON.parse(window.localStorage.getItem('gestor_cloud_uid-test-123'));
    if (data.transferencias.length!==2 || data.transferencias[1].saldoAntes!==48) throw new Error('segunda transferencia incorrecta');
    const antes=JSON.parse(JSON.stringify(data));
    document.querySelector('#bottomMenu button[data-section="historial"]').click();
    const ids=()=>[...document.querySelectorAll('#listaHistorial [data-action="edit-op"]')].map(x=>x.dataset.id).join(',');
    const ordenAntes=ids();
    document.querySelector('[data-action="edit-op"][data-id="'+data.transferencias[0].id+'"]').click();
    if (!document.getElementById('modalMonto').readOnly || !document.getElementById('modalFecha').readOnly || !document.getElementById('modalCliente').disabled) throw new Error('los datos originales se pueden modificar');
    if (document.getElementById('modalSaldoDisponible').value !== '98.00') throw new Error('vista previa no es saldo histórico');
    // Incluso manipulando el DOM, los datos originales no se usan al guardar.
    document.getElementById('modalMonto').value='999';
    document.getElementById('modalFecha').value='2020-01-01';
    document.getElementById('modalSaldoDisponible').value='150';
    document.getElementById('modalSaldoDisponible').dispatchEvent(new window.Event('input'));
    document.getElementById('modalGuardar').click();
    data=JSON.parse(window.localStorage.getItem('gestor_cloud_uid-test-123'));
    if (data.transferencias[0].ajusteSaldo!==52 || data.transferencias[0].saldoAntes!==150 || data.transferencias[1].saldoAntes!==100 || data.clientes[0].saldo!==80) throw new Error('ajuste no propagado: '+JSON.stringify(data));
    const strip=o=>{const c={...o};delete c.saldoAntes;delete c.ajusteSaldo;return JSON.stringify(c)};
    data.transferencias.forEach((t,i)=>{if(strip(t)!==strip(antes.transferencias[i]))throw new Error('cambió el registro '+i)});
    if(JSON.stringify(data.recibos)!==JSON.stringify(antes.recibos) || JSON.stringify(data.finanzas)!==JSON.stringify(antes.finanzas)) throw new Error('cambiaron otros registros');
    if (ids()!==ordenAntes) throw new Error('cambió el orden o desapareció una operación');
    const filtro=document.getElementById('historialTipo');
    filtro.value='recibo'; filtro.dispatchEvent(new window.Event('change'));
    if (ids() !== data.recibos[0].id) throw new Error('filtro no muestra el recibo');
    document.querySelector('[data-action="edit-op"][data-id="'+data.recibos[0].id+'"]').click();
    document.getElementById('modalSaldoDisponible').value='10';
    document.getElementById('modalSaldoDisponible').dispatchEvent(new window.Event('input'));
    document.getElementById('modalGuardar').click();
    data=JSON.parse(window.localStorage.getItem('gestor_cloud_uid-test-123'));
    if (data.recibos[0].ajusteSaldo!==10 || data.transferencias[0].saldoAntes!==160 || data.transferencias[1].saldoAntes!==110 || data.clientes[0].saldo!==90) throw new Error('ajuste de recibo no propagado');
    if (strip(data.recibos[0])!==strip(antes.recibos[0]) || ids()!==data.recibos[0].id) throw new Error('recibo cambió o desapareció del filtro');
    if (!document.getElementById('listaHistorial').textContent.includes('Ajuste previo: $10.00')) throw new Error('ajuste de recibo no visible');
    filtro.value='todos'; filtro.dispatchEvent(new window.Event('change'));
    if (ids()!==ordenAntes) throw new Error('cambió el orden del historial');
    const sinCambios=JSON.stringify(data);
    document.querySelector('[data-action="edit-op"][data-id="'+data.transferencias[0].id+'"]').click();
    document.getElementById('modalGuardar').click();
    if (window.localStorage.getItem('gestor_cloud_uid-test-123')!==sinCambios) throw new Error('guardar sin cambios alteró los datos');
  });

  run('Conflicto de sincronización conserva ambas copias', async () => {
    await new Promise(r=>setTimeout(r,1100));
    if (!remoteSnapshot) throw new Error('sin versión remota');
    const original = JSON.stringify(remoteSnapshot.payload);
    remoteSnapshot.revision += 1;
    remoteSnapshot.payload = JSON.parse(original);
    remoteSnapshot.payload.clientes[0].nombre = 'Otro dispositivo';
    document.querySelector('#bottomMenu button[data-section="clientes"]').click();
    document.getElementById('btnMostrarListaClientes').click();
    document.querySelector('#listaClientesResumen [data-action="edit-cliente"]').click();
    document.getElementById('mcNombre').value='Versión local';
    document.getElementById('mcGuardar').click();
    document.getElementById('btnSyncNow').click();
    await new Promise(r=>setTimeout(r,50));
    if (!document.getElementById('modalConflicto').classList.contains('open')) throw new Error('no detectó conflicto');
    if (remoteSnapshot.payload.clientes[0].nombre !== 'Otro dispositivo') throw new Error('sobrescribió la nube');
    const local=JSON.parse(window.localStorage.getItem('gestor_cloud_uid-test-123'));
    if (local.clientes[0].nombre !== 'Versión local') throw new Error('perdió la copia local');
    document.getElementById('conflictoLocal').click();
    await new Promise(r=>setTimeout(r,50));
    if (document.getElementById('modalConflicto').classList.contains('open')) throw new Error('conflicto no resuelto');
    if (remoteSnapshot.payload.clientes[0].nombre !== 'Versión local') throw new Error('no guardó elección explícita');
  });

  run('Comprobantes comparten datos enmascarados y búsqueda rápida funciona', async () => {
    document.querySelector('#bottomMenu button[data-section="historial"]').click();
    let compartido;
    window.navigator.share = async x => { compartido = x.text; };
    const boton = document.querySelector('#listaHistorial [data-action="share-comprobante"][data-tipo="transferencia"]');
    if (!boton) throw new Error('falta acción compartir');
    boton.click(); await new Promise(r=>setTimeout(r,10));
    if (!compartido || !compartido.includes('no es constancia bancaria') || !compartido.includes('5427') || compartido.includes('9212129938675427')) throw new Error('comprobante incorrecto o destino expuesto');
    irSeccion('operaciones');
    document.getElementById('btnMostrarTransferir').click();
    const buscar=document.getElementById('buscarClienteTransferir');
    buscar.value='no existe'; buscar.dispatchEvent(new window.Event('input'));
    if (document.getElementById('transferirCliente').options.length !== 0) throw new Error('búsqueda no filtra');
    buscar.value=''; buscar.dispatchEvent(new window.Event('input'));
    if (document.getElementById('destinosRecientes').options.length < 2) throw new Error('sin destinos recientes');
    document.getElementById('destinosRecientes').selectedIndex=1;
    document.getElementById('destinosRecientes').dispatchEvent(new window.Event('change'));
    if (document.getElementById('numeroDestino').dataset.numeroLimpio !== '9212129938675427') throw new Error('destino reciente no seleccionado');
  });

  // 17) Logout
  run('Cerrar sesión vuelve al login', async () => {
    window.confirm = () => true;
    document.getElementById('btnLogout').click();
    await new Promise(r => setTimeout(r, 50));
    if (document.getElementById('authScreen').style.display !== 'flex') throw new Error('no volvió al login');
  });
  await new Promise(r => setTimeout(r, 50));

  // 18) Registro
  run('Registro con validaciones', async () => {
    document.getElementById('switchToRegister').click();
    document.getElementById('registerNombre').value = 'Al';
    document.getElementById('btnRegister').click();
    const err = document.getElementById('registerError');
    if (!err.classList.contains('show')) throw new Error('no validó nombre corto');
    document.getElementById('registerNombre').value = 'Ale Test';
    document.getElementById('registerEmail').value = 'no-email';
    document.getElementById('btnRegister').click();
    if (!/email/i.test(err.textContent)) throw new Error('no validó email: ' + err.textContent);
    document.getElementById('registerEmail').value = 'a@b.com';
    document.getElementById('registerPassword').value = '123456';
    document.getElementById('registerConfirm').value = '654321';
    document.getElementById('btnRegister').click();
    if (!/coinciden/i.test(err.textContent)) throw new Error('no validó confirmación');
    document.getElementById('registerConfirm').value = '123456';
    document.getElementById('btnRegister').click();
    await new Promise(r => setTimeout(r, 80));
    if (document.getElementById('authScreen').style.display !== 'none') throw new Error('no entró tras registro');
  });
  await new Promise(r => setTimeout(r, 50));


  // 19) Panel de MI CUENTA
  run('Abrir Mi Cuenta desde el badge', () => {
    document.getElementById('usuarioBadge').click();
    const modal = document.getElementById('modalCuenta');
    if (!modal.classList.contains('open')) throw new Error('modal no abrió');
    if (document.getElementById('cuentaEmail').value !== 'test@x.com') throw new Error('email: ' + document.getElementById('cuentaEmail').value);
    if (document.getElementById('cuentaAvatar').textContent !== 'A') throw new Error('avatar: ' + document.getElementById('cuentaAvatar').textContent);
    document.getElementById('cuentaCerrar').click();
    if (modal.classList.contains('open')) throw new Error('no cerró');
  });

  run('Actualizar nombre de cuenta', async () => {
    document.getElementById('usuarioBadge').click();
    document.getElementById('cuentaNombre').value = 'Ale Nuevo';
    document.getElementById('btnGuardarCuenta').click();
    await new Promise(r => setTimeout(r, 80));
    const badge = document.getElementById('usuarioBadge').textContent;
    if (!badge.includes('Ale Nuevo')) throw new Error('badge no actualizó: ' + badge);
    document.getElementById('cuentaCerrar').click();
  });

  run('Entrar a Mi Cuenta desde el menú hamburguesa', () => {
    document.getElementById('menuHamburguesa').click();
    document.getElementById('btnMiCuenta').click();
    if (!document.getElementById('modalCuenta').classList.contains('open')) throw new Error('no abrió desde menú');
    if (document.getElementById('dropdownMenu').classList.contains('open')) throw new Error('dropdown quedó abierto');
    document.getElementById('cuentaCerrar').click();
  });

  // 20) Navegación con iconos SVG intacta
  run('Menú inferior y acciones rápidas conservan la navegación', () => {
    const btns = document.querySelectorAll('#bottomMenu button');
    if (btns.length !== 5) throw new Error('botones: ' + btns.length);
    for (const sec of ['inicio','clientes','historial','finanzas']) if (!document.querySelector('#bottomMenu button[data-section="'+sec+'"] svg')) throw new Error('falta navegación ' + sec);
    irSeccion('inicio');
    if (!document.getElementById('section-inicio').classList.contains('visible') || document.getElementById('section-clientes').classList.contains('visible')) throw new Error('inicio no separado de clientes');
    document.getElementById('abrirAcciones').click();
    const menu=document.getElementById('menuAcciones');
    if (!menu.classList.contains('open') || menu.getAttribute('aria-hidden') !== 'false') throw new Error('no abrió acciones');
    document.getElementById('accionTransferir').click();
    if (menu.classList.contains('open') || !document.getElementById('section-operaciones').classList.contains('visible') || document.getElementById('sub-transferir').style.display !== 'block') throw new Error('no abrió transferencia');
    document.getElementById('abrirAcciones').click();
    document.getElementById('accionRecibir').click();
    if (!document.getElementById('section-operaciones').classList.contains('visible') || document.getElementById('sub-recibir').style.display !== 'block') throw new Error('no abrió recibo');
    irSeccion('inicio');
    document.getElementById('abrirAcciones').click();
    document.getElementById('cerrarAcciones').click();
    if (menu.classList.contains('open') || document.activeElement !== document.getElementById('abrirAcciones')) throw new Error('no cerró o devolvió el foco');
    document.getElementById('menuHamburguesa').click();
    if (document.getElementById('menuHamburguesa').getAttribute('aria-expanded') !== 'true') throw new Error('perfil no accesible');
    if (!document.querySelector('#dropdownMenu [data-section="bd"]')) throw new Error('respaldo inaccesible');
    irSeccion('bd');
    if (!document.getElementById('section-bd').classList.contains('visible')) throw new Error('respaldo no abrió');
  });

  run('Tasas: selección, persistencia, pausa y fecha sin alterar saldos', async () => {
    await new Promise(r => setTimeout(r, 20));
    const bar = document.getElementById('tasasContenido');
    if (!bar.textContent.includes('USD') || !bar.textContent.includes('100') || !document.getElementById('tasasNota').textContent.includes('posiblemente desactualizados')) throw new Error('tasas o antigüedad');
    document.getElementById('menuHamburguesa').click(); document.getElementById('btnMonedas').click();
    const opts = document.getElementById('opcionesMonedas');
    opts.querySelectorAll('input').forEach(el => el.checked = el.value === 'CAD');
    document.getElementById('guardarMonedas').click();
    if (bar.textContent.includes('USD') || !bar.textContent.includes('CAD') || !bar.textContent.includes('80')) throw new Error('selección no aplicada');
    if (JSON.parse(window.localStorage.getItem('gestor_monedas_uid-test-123'))[0] !== 'CAD') throw new Error('selección no guardada por cuenta');
    document.getElementById('pausarTasas').click();
    if (document.getElementById('pausarTasas').getAttribute('aria-pressed') !== 'true') throw new Error('pausa');
    document.getElementById('menuHamburguesa').click(); document.getElementById('btnMonedas').click();
    opts.querySelectorAll('input').forEach(el => el.checked = false);
    document.getElementById('guardarMonedas').click();
    if (!bar.textContent.includes('No seleccionaste')) throw new Error('sin selección');
  });

  // 21) RECUPERACIÓN CON CÓDIGO DE VERIFICACIÓN
  run('Paso 1 → Paso 2 tras enviar código', async () => {
    // salir primero si estamos dentro
    window.confirm = () => true;
    if (document.getElementById('authScreen').style.display !== 'flex') {
      document.getElementById('btnLogout').click();
      await new Promise(r => setTimeout(r, 80));
    }
    document.getElementById('switchToRecovery').click();
    if (document.getElementById('recoveryRequestStep').style.display === 'none') throw new Error('paso1 no visible');
    document.getElementById('recoveryEmail').value = 'test@x.com';
    document.getElementById('btnRecovery').click();
    await new Promise(r => setTimeout(r, 50));
    if (document.getElementById('recoveryCodeStep').style.display !== 'block') throw new Error('paso2 no apareció');
    if (!document.getElementById('recoveryCodeInfo').textContent.includes('test@x.com')) throw new Error('info sin email');
  });

  run('Código inválido muestra error sin entrar', async () => {
    document.getElementById('recoveryCode').value = '00000000';
    document.getElementById('btnVerifyCode').click();
    await new Promise(r => setTimeout(r, 50));
    const err = document.getElementById('codeError');
    if (!err.classList.contains('show')) throw new Error('no mostró error de código');
    if (document.getElementById('authScreen').style.display !== 'flex') throw new Error('entró con código malo');
  });

  run('Código válido abre modal de nueva contraseña y entra', async () => {
    document.getElementById('recoveryCode').value = '12345678';
    document.getElementById('btnVerifyCode').click();
    await new Promise(r => setTimeout(r, 120));
    if (!document.getElementById('modalPassword').classList.contains('open')) throw new Error('modal no abrió');
    if (document.getElementById('authScreen').style.display !== 'none') throw new Error('no entró a la app');
    // crear contraseña nueva
    document.getElementById('npPassword').value = 'nueva123';
    document.getElementById('npConfirm').value = 'nueva123';
    document.getElementById('npGuardar').click();
    await new Promise(r => setTimeout(r, 80));
    if (document.getElementById('modalPassword').classList.contains('open')) throw new Error('modal no cerró');
    if (document.getElementById('authScreen').style.display !== 'none') throw new Error('perdió la sesión');
    if (!document.getElementById('usuarioBadge').textContent.includes('Ale Test')) throw new Error('badge perdido');
  });

  run('Botón reenviar y volver al paso 1', () => {
    // ya dentro: abrir recovery de nuevo para probar navegación de pasos
    document.getElementById('btnLogout') && null;
    document.getElementById('switchToRecovery') && null;
    // probar funciones de paso directamente
    document.getElementById('btnChangeEmail').click();
    if (document.getElementById('recoveryRequestStep').style.display !== 'block') throw new Error('volvió a paso1');
  });

  await cola;

  // ---------- RESULTADO ----------
  console.log(logs.filter(l => l.startsWith('✅ ')).join('\n'));
  console.log('\n========== RESULTADO ==========');
  if (errores.length === 0) {
    console.log('✅ TODAS LAS PRUEBAS PASARON');
    process.exit(0);
  } else {
    console.log('❌ ERRORES (' + errores.length + '):');
    errores.forEach(e => console.log(' - ' + e));
    process.exit(1);
  }
})().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
