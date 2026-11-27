/* Prueba visual de geometría en Chromium. Requiere CHROMIUM_PATH apuntando a
   un Chromium instalado y npm install. Ejemplo: CHROMIUM_PATH=/usr/bin/chromium npm run test:mobile */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {chromium} = require('playwright-core');

(async () => {
  if (!process.env.CHROMIUM_PATH) throw new Error('Definí CHROMIUM_PATH con la ruta de Chromium.');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'}); res.end(html); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  let browser;
  try {
    browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH, args:['--no-sandbox'], headless:true});
    for (const [width,height] of [[320,568],[360,640],[390,844],[430,932],[568,320],[1100,800]]) {
      const mobile = width < 600;
      const context = await browser.newContext({viewport:{width,height}, isMobile:mobile, hasTouch:mobile});
      await context.route('https://**/*', route => route.abort());
      await context.addInitScript(() => {
        const date = new Date(); date.setHours(0,0,0,0); const fecha=date.getTime();
        const session = {user:{id:'test-mobile',email:'mobile@example.invalid',user_metadata:{username:'Usuario de prueba'}}};
        const payload = {clientes:[{id:'a',nombre:'Valentina Rodríguez Fernández',comision:1.5,saldo:-12345.67,nota:'Observación de prueba'}, {id:'b',nombre:'ClienteConUnNombreMuyLargoSinEspaciosParaProbar',comision:2,saldo:123456789012.89}],recibos:[{id:'r',clienteId:'a',monto:60000,neto:59000,comision:1000,fecha,numeroOp:1}],transferencias:[{id:'t',clienteId:'a',monto:71345.67,fecha,numeroOp:2,saldoAntes:59000,tipoDestino:'tarjeta',numeroDestino:'9212129938675427',banco:'Banco Popular de Ahorro'}],finanzas:[{id:'f',clienteId:'a',monto:12345.67,tipo:'gasto',descripcion:'Préstamo a Valentina Rodríguez Fernández',fecha}]};
        const snapshot={payload,revision:1,updated_at:new Date().toISOString()};
        window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},from:table=>{const q={select:()=>q,eq:()=>q,order:()=>q,limit:async()=>({data:[],error:null}),maybeSingle:async()=>({data:table==='gestor_preferencias'?{preferencias:{monedas:['USD','EUR'],oscuro:false,saldoOculto:false}}:snapshot,error:null}),upsert:async()=>({error:null}),insert:async()=>({error:null})}; return q},rpc:async()=>({data:{ok:true,revision:2},error:null}),functions:{invoke:async()=>({data:{rates:[],generated_at:new Date().toISOString()},error:null})},channel:()=>({on(){return this},subscribe(){return this}}),removeChannel(){}})};
        window.Chart=class {destroy(){}};
      });
      const page=await context.newPage();
      await page.emulateMedia({reducedMotion:'reduce'});
      const errors=[]; page.on('pageerror', error => errors.push(error.message));
      await page.goto(url); await page.waitForSelector('#appContent.show');
      async function check(label) {
        const issues = await page.evaluate(({mobile}) => {
          const problems=[];
          if (document.documentElement.scrollWidth > innerWidth + 1) problems.push(`documento ${document.documentElement.scrollWidth}/${innerWidth}`);
          for (const el of document.querySelectorAll('body *')) {
            const r=el.getBoundingClientRect(), style=getComputedStyle(el);
            if (!r.width || !r.height || style.visibility==='hidden' || style.display==='none' || el.closest('.rates-viewport')) continue;
            if (r.left < -2 || r.right > innerWidth+2) problems.push(`${el.tagName}#${el.id} sale de pantalla`);
            if (el.matches('.cliente-card, .operacion-card, .stat-card, .saldo-total, .balance-amount, .preview-box') && el.scrollWidth > el.clientWidth + 3 && style.overflowX === 'visible') problems.push(`${el.tagName}#${el.id} contenido cortado`);
            if (mobile && el.matches('button, [role="button"], summary') && (r.width < 40 || r.height < 40)) problems.push(`${el.tagName}#${el.id} toque ${Math.round(r.width)}x${Math.round(r.height)}`);
            if (mobile && el.matches('.form-group input:not([type=checkbox]):not([type=radio]), .form-group select, .form-group textarea, .input-comision, .buscador-cliente') && parseFloat(style.fontSize) < 16) problems.push(`${el.tagName}#${el.id} texto menor a 16px`);
          }
          return problems;
        }, {mobile});
        assert.deepEqual(issues, [], `${width}x${height} ${label}: ${issues.join('; ')}`);
      }
      await check('inicio');
      await page.click('#bottomMenu [data-section=clientes]'); await check('clientes');
      await page.click('#btnMostrarComisiones'); await check('comisiones');
      await page.click('#btnMostrarAgregarCliente'); await check('nuevo cliente');
      await page.click('#btnMostrarListaClientes'); await page.locator('#listaClientesResumen [data-action=ficha-cliente]').first().click();
      await page.locator('#modalFicha details').last().locator('summary').click(); await check('ficha'); await page.click('#cerrarFicha');
      await page.click('#abrirAcciones'); await check('acciones'); await page.click('#accionRecibir'); await check('recibir');
      await page.click('#btnMostrarTransferir'); await check('transferir');
      await page.click('#bottomMenu [data-section=historial]'); await check('historial');
      await page.locator('#listaHistorial [data-action=edit-op][data-id=t]').click(); await check('editar operación');
      await page.locator('#modalMonto').fill('70000'); assert((await page.locator('#vistaAjuste').textContent()).includes('Saldo final')); await page.click('#modalCancelar');
      await page.locator('#listaHistorial [data-action=edit-op][data-id=r]').click(); await check('editar recibo');
      await page.locator('#modalMonto').fill('120000'); assert.equal(Number(await page.locator('#modalComision').inputValue()),2000); await page.click('#modalCancelar');
      await page.click('#bottomMenu [data-section=finanzas]'); await check('finanzas');
      await page.click('#btnMostrarRegistrarFinanza'); await check('registrar finanza');
      await page.click('#menuHamburguesa'); await check('perfil'); await page.click('#dropdownMenu [data-section=saldo]'); await check('saldos');
      await page.click('#menuHamburguesa'); await page.click('#dropdownMenu [data-section=bd]'); await check('respaldo');
      await page.click('#menuHamburguesa'); await page.click('#btnMiCuenta'); await check('cuenta'); await page.click('#cuentaCerrar');
      await page.click('#menuHamburguesa'); await page.click('.profile-config summary'); await page.click('#btnMonedas'); await check('monedas'); await page.click('#cerrarMonedas');
      await page.click('#menuHamburguesa');
      if (!await page.locator('.profile-config').evaluate(el=>el.open)) await page.click('.profile-config summary');
      await page.click('#btnDarkMode'); await page.click('#bottomMenu [data-section=inicio]'); await check('modo oscuro');
      assert.deepEqual(errors, [], `errores JS: ${errors.join('; ')}`);
      await context.close();
      const authContext=await browser.newContext({viewport:{width,height}, isMobile:mobile, hasTouch:mobile});
      await authContext.route('https://**/*', route=>route.abort());
      await authContext.addInitScript(() => { window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}})}; });
      const auth=await authContext.newPage(); await auth.emulateMedia({reducedMotion:'reduce'}); await auth.goto(url);
      await auth.waitForSelector('#authScreen', {state:'visible'});
      async function checkAuth(label, last) {
        await auth.waitForTimeout(150);
        const control=auth.locator(last); await control.scrollIntoViewIfNeeded();
        await control.evaluate(el=>el.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'})); await auth.waitForTimeout(100);
        const bounds=await control.boundingBox();
        assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width+1 && bounds.y >= 0 && bounds.y + bounds.height <= height+1, `${width}x${height} ${label} no accesible: ${JSON.stringify(bounds)}`);
        assert.equal(await auth.evaluate(()=>document.documentElement.scrollWidth),width, `${width}x${height} ${label} desborda`);
        const inputs=auth.locator('#authScreen input:visible');
        for (const input of await inputs.all()) assert(Number.parseFloat(await input.evaluate(el=>getComputedStyle(el).fontSize)) >= 16 || !mobile, `${label}: texto pequeño`);
      }
      await checkAuth('iniciar sesión', '#btnLogin'); await auth.click('#switchToRegister');
      await checkAuth('registro', '#btnRegister'); await auth.click('#switchToLogin');
      await auth.click('#switchToRecovery'); await checkAuth('recuperación', '#btnRecovery');
      await authContext.close();
      console.log(`✓ ${width}x${height}: acceso, pantallas, formularios, navegación y modales`);
    }
  } finally { if (browser) await browser.close(); await new Promise(resolve=>server.close(resolve)); }
})().catch(error=>{console.error(error); process.exitCode=1});
