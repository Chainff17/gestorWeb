// Ejecutar con node tests/saldos.test.js (sin dependencias).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
const begin = html.indexOf('    function operacionesCronologicas()');
const end = html.indexOf('    /** Importa datos guardados', begin);
assert(begin >= 0 && end > begin, 'No se encontraron funciones de saldo');
const source = html.slice(begin, end);
function fixture() {
  const state = {
    clientes: [{id:'a', nombre:'Ana', saldo:60}, {id:'b', nombre:'Beto', saldo:25}],
    recibos: [{id:'r1', clienteId:'a', monto:100, neto:90, fecha:1, numeroOp:1}],
    transferencias: [
      {id:'t1', clienteId:'a', monto:20, saldoAntes:90, fecha:2, numeroOp:2, prestamoAutomatico:true},
      {id:'t2', clienteId:'a', monto:10, saldoAntes:70, fecha:3, numeroOp:3, prestamoAutomatico:true},
      {id:'b1', clienteId:'b', monto:5, saldoAntes:999, fecha:3, numeroOp:4}
    ], finanzas: []
  };
  let id=0;
  const context = {state, generarId:()=>`f${++id}`, getCliente:id=>state.clientes.find(c=>c.id===id)};
  vm.createContext(context); vm.runInContext(source, context);
  return context;
}
{
 const c = fixture(), {state:s} = c, apertura=c.saldosIniciales();
 assert.equal(apertura.get('a'), 0); assert.equal(apertura.get('b'), 30);
 s.transferencias[0].monto = 40; c.renumerar(); c.recalcularSaldos(apertura,['a']);
 assert.equal(s.transferencias[0].saldoAntes,90); assert.equal(s.transferencias[1].saldoAntes,50);
 assert.equal(s.clientes[0].saldo,40); assert.equal(s.transferencias[2].saldoAntes,999);
}
{
 const c=fixture(), {state:s}=c, apertura=c.saldosIniciales();
 s.recibos[0].neto=50; c.renumerar(); c.recalcularSaldos(apertura,['a']);
 assert.equal(s.transferencias[0].saldoAntes,50); assert.equal(s.transferencias[1].saldoAntes,30); assert.equal(s.clientes[0].saldo,20);
}
{
 const c=fixture(), {state:s}=c, apertura=c.saldosIniciales();
 s.transferencias[0].clienteId='b'; c.renumerar(); c.recalcularSaldos(apertura,['a','b']);
 assert.equal(s.transferencias[1].saldoAntes,90); assert.equal(s.clientes[0].saldo,80);
 assert.equal(s.transferencias[0].saldoAntes,30); assert.equal(s.transferencias[2].saldoAntes,10); assert.equal(s.clientes[1].saldo,5);
}
{
 const c=fixture(), {state:s}=c, apertura=c.saldosIniciales();
 s.transferencias[0].fecha=4; c.renumerar(); c.recalcularSaldos(apertura,['a']);
 assert.equal(s.transferencias[0].saldoAntes,90); assert.equal(s.transferencias[1].saldoAntes,70); assert.equal(s.transferencias[0].numeroOp,2); assert.equal(s.clientes[0].saldo,60);
}
{
 const c=fixture(), {state:s}=c, apertura=c.saldosIniciales();
 s.recibos.splice(0,1); c.renumerar(); c.recalcularSaldos(apertura,['a']);
 assert.equal(s.clientes[0].saldo,-30); assert.equal(s.transferencias[1].saldoAntes,-20);
 assert.deepEqual(s.finanzas.map(f=>f.monto),[20,10]);
 s.transferencias[0].monto=0; c.recalcularSaldos(apertura,['a']);
 assert.equal(s.finanzas.length,1); assert.equal(s.finanzas[0].monto,10);
}
{
 const c=fixture(), {state:s}=c, apertura=c.saldosIniciales();
 s.transferencias[1].fecha=2; c.renumerar(); c.recalcularSaldos(apertura,['a']);
 assert.equal(s.transferencias[0].saldoAntes,90); assert.equal(s.transferencias[1].saldoAntes,70);
 assert.equal(c.saldoAntesProyectado('a',2,s.transferencias[0]),90);
}
{
 const c=fixture(), {state:s}=c, apertura=c.saldosIniciales();
 s.transferencias[0].ajusteSaldo = -40;
 c.recalcularSaldos(apertura,['a']);
 assert.equal(s.transferencias[0].saldoAntes,50); assert.equal(s.transferencias[1].saldoAntes,30); assert.equal(s.clientes[0].saldo,20);
 assert.equal(c.saldosIniciales().get('a'),0);
 assert.equal(c.saldoAntesProyectado('a',3,s.transferencias[1]),30);
 const anterior=c.saldosIniciales(); s.recibos[0].neto=80; c.recalcularSaldos(anterior,['a']);
 assert.equal(s.transferencias[0].saldoAntes,40); assert.equal(s.transferencias[1].saldoAntes,20); assert.equal(s.clientes[0].saldo,10);
}
{
 const c=fixture(), {state:s}=c;
 const original=JSON.parse(JSON.stringify(s));
 assert.equal(c.aplicarAjusteSaldo('transferencia','t1',15),true);
 assert.equal(s.transferencias[0].saldoAntes,105); assert.equal(s.transferencias[1].saldoAntes,85);
 assert.equal(s.transferencias[2].saldoAntes,999); assert.equal(s.clientes[0].saldo,75); assert.equal(s.clientes[1].saldo,25);
 assert.equal(s.transferencias[0].ajusteSaldo,15);
 const strip = x => {const copy=JSON.parse(JSON.stringify(x)); delete copy.saldoAntes; delete copy.ajusteSaldo; return copy;};
 s.transferencias.forEach((t,i)=>assert.deepEqual(strip(t),strip(original.transferencias[i])));
 assert.deepEqual(s.recibos,original.recibos); assert.deepEqual(s.finanzas,original.finanzas);
 c.renumerar(); assert.equal(s.transferencias[0].numeroOp,2); assert.equal(s.transferencias[1].numeroOp,3);
 assert.equal(c.saldosIniciales().get('a'),0);
}
{
 const c=fixture(), {state:s}=c;
 assert.equal(c.aplicarAjusteSaldo('recibo','r1',-20),true);
 assert.equal(s.recibos[0].ajusteSaldo,-20); assert.equal(s.transferencias[0].saldoAntes,70); assert.equal(s.transferencias[1].saldoAntes,50); assert.equal(s.clientes[0].saldo,40);
 assert.equal(c.saldosIniciales().get('a'),0);
 assert.equal(c.saldoAntesProyectado('a',1,{...s.recibos[0],tipo:'recibo'}),0);
 const apertura=c.saldosIniciales(); c.recalcularSaldos(apertura,['a']);
 assert.equal(s.transferencias[0].saldoAntes,70); assert.equal(s.transferencias[1].saldoAntes,50); assert.equal(s.clientes[0].saldo,40);
}
{
 const c=fixture(), {state:s}=c;
 s.transferencias.splice(0,1); c.renumerar();
 assert.equal(s.transferencias[0].numeroOp,3); assert.equal(s.transferencias[1].numeroOp,4);
 assert.equal(c.obtenerSiguienteNumeroOperacion(),5);
}
{
 const c=fixture(), {state:s}=c;
 // Corrige la segunda transferencia con saldo legado inconsistente: no se toca la primera.
 s.transferencias[0].saldoAntes = 777;
 const antes=JSON.parse(JSON.stringify(s));
 assert.equal(c.aplicarAjusteSaldo('transferencia','t2',-12),true);
 assert.equal(s.transferencias[0].saldoAntes,777); assert.equal(s.transferencias[1].saldoAntes,58);
 assert.equal(s.transferencias[2].saldoAntes,999); assert.equal(s.clientes[0].saldo,48);
 assert.deepEqual(s.recibos,antes.recibos); assert.deepEqual(s.finanzas,antes.finanzas);
 const sinCambios=JSON.stringify(s); assert.equal(c.aplicarAjusteSaldo('recibo','no-existe',10),false); assert.equal(JSON.stringify(s),sinCambios);
}
{
 const c=fixture(), {state:s}=c;
 s.transferencias[0].numeroOp=1; // un duplicado histórico no debe cambiarse al recargar
 c.renumerar(); assert.equal(s.recibos[0].numeroOp,1); assert.equal(s.transferencias[0].numeroOp,1);
}
{
 const c=fixture(), {state:s}=c;
 s.transferencias[0].saldoAntes=777; // un saldo legado anterior no debe reconstruirse
 const antes=JSON.parse(JSON.stringify(s));
 const plan=c.prepararCambioMonto('transferencia','t2',30,null);
 c.validarEfectosEdicion('transferencia',s.transferencias[1],0,plan);
 c.aplicarCambioMonto(plan);
 assert.equal(s.transferencias[0].saldoAntes,777); assert.equal(s.transferencias[1].saldoAntes,70);
 assert.equal(s.transferencias[1].numeroOp,3); assert.equal(s.clientes[0].saldo,40);
 assert.deepEqual(s.clientes[1],antes.clientes[1]);
}
{
 const c=fixture(), {state:s}=c;
 s.finanzas.push({id:'x',tipo:'gasto',transferenciaId:'t2',monto:1},{id:'y',tipo:'gasto',transferenciaId:'t2',monto:1});
 const antes=JSON.stringify(s);
 assert.throws(()=>c.prepararCambioMonto('recibo','r1',200,20),/vínculos financieros ambiguos/);
 assert.equal(JSON.stringify(s),antes);
 s.finanzas.pop(); s.finanzas[0].tipo='ingreso';
 assert.throws(()=>c.prepararCambioMonto('recibo','r1',200,20),/vínculos financieros ambiguos/);
 s.finanzas=[]; s.transferencias[1].saldoAntes='';
 assert.throws(()=>c.prepararCambioMonto('recibo','r1',200,20),/inválido/);
}
console.log('OK: ajuste de saldos, operaciones preservadas y numeración estable');
