const G=require(require('path').join(__dirname,'..','guide.js')); const assert=require('assert');
const f=(n,d)=>Number(n).toLocaleString("es-AR",{minimumFractionDigits:d===undefined?2:d,maximumFractionDigits:d===undefined?2:d});
const base={ticker:"BTC",tipo:"cripto",marco:"4h",validada:true,estado:"mantener long",precio:72000,entrada:72000,stop_movil:66000,vela_cierre_t:1000,indicadores:{atr14:1500},ultimo_evento:{tipo:"entrada_long",t:1000}};
const cfg={capital:1000,riesgo:1,fmt:f};
let g=G.buildGuide(base,cfg);
assert.strictEqual(g.pasos.length,6);
assert(g.resumen.find(r=>r[0]==="Tamaño")[1].startsWith("0,001667")); // 10/6000
assert(g.pasos[2].items.some(i=>i.includes("65.802,00")||i.includes("65.802"))); // 66000*0.997=65802
assert(g.pasos[4].items.join(" ").includes("8,3%"));
assert(!g.avisos.some(a=>a.includes("hace")));
// short
let s=G.buildGuide({...base,ticker:"BTC",stop_movil:78000,entrada:72000,ultimo_evento:{tipo:"entrada_short",t:1000}},cfg);
assert(s.titulo.startsWith("Vender"));assert(s.avisos.some(a=>a.includes("Lemon")));
assert(s.resumen.find(r=>r[0]==="Stop-loss")[1].includes("+8,3%"));
assert(s.pasos.some(p=>p.t.includes("Preparar la cuenta")));
// señal vieja
let v=G.buildGuide({...base,vela_cierre_t:1000+14400*3,precio:80000,stop_movil:75000},cfg);
assert(v.avisos.some(a=>a.includes("hace 3 velas"))); assert(v.titulo.startsWith("Seguimiento LONG")); assert(v.pasos.length===3);
assert(v.resumen.find(r=>r[0]==="Resultado de la operación")[1]==="+11,1%");
// precio en vivo lejos (r=6000, mueve 4000 > 3000)
let l=G.buildGuide(base,{...cfg,livePrice:76000}); assert(l.avisos.some(a=>a.includes("perseguirlo")));
let n=G.buildGuide(base,{...cfg,livePrice:72500}); assert(!n.avisos.some(a=>a.includes("perseguirlo")));
// posición mayor al capital
let big=G.buildGuide({...base,stop_movil:71900},cfg); assert(big.avisos.some(a=>a.includes("supera tu capital")));
// salida
let x=G.buildGuide({...base,ultimo_evento:{tipo:"salida_long",t:1000}},cfg); assert(x.titulo.startsWith("Cerrar LONG"));
// acción
let a=G.buildGuide({...base,ticker:"NVDA",tipo:"accion",validada:false,marco:"1d",entrada:200,precio:200,stop_movil:180},cfg);
assert(!JSON.stringify(a.pasos).includes("Binance Spot")); assert(a.avisos.some(z=>z.includes("NO está validada")));
// sin evento
assert.strictEqual(G.buildGuide({ticker:"X"},cfg),null);
console.log("guide OK");
