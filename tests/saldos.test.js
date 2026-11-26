// Ejecutar con node tests/saldos.test.js (sin dependencias).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
const begin = html.indexOf('    function operacionesCronologicas()');
const end = html.indexOf('    function obtenerSiguienteNumeroOperacion()', begin);
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
 assert.equal(s.transferencias[1].saldoAntes,90); assert.equal(s.transferencias[0].saldoAntes,80); assert.equal(s.clientes[0].saldo,60);
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
console.log('OK: edición de montos, recibos, cliente, fecha, eliminación, préstamos y saldos iniciales');
