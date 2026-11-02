"use strict";
/* Módulo Finanças: porta as contas do dashboard "Meu Controle Financeiro".
   Os dados ficam em S.fin e sincronizam junto com o resto (user_state). */
(()=>{
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const brl=n=>(+n||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const MES=["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
const MESL=["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
const cap=s=>s.charAt(0).toUpperCase()+s.slice(1);
const nv=v=>{v=+v;return isFinite(v)?v:0};
const sum=(a,f)=>a.reduce((s,x)=>s+f(x),0);
const NOW=()=>{const d=new Date();return d.getFullYear()*12+d.getMonth()};
const idx=s=>{const m=/^(\d{4})-(\d{2})/.exec(s||"");return m?+m[1]*12+(+m[2]-1):null};
const lab=i=>MES[i%12]+"/"+String(Math.floor(i/12)).slice(2);
const longLab=i=>cap(MESL[i%12])+" de "+Math.floor(i/12);
const ym=i=>Math.floor(i/12)+"-"+String(i%12+1).padStart(2,"0");
const compact=v=>{const a=Math.abs(v),s=a>=1000?(a/1000).toFixed(1).replace(".",",")+"k":String(Math.round(a));return(v<0?"-":"")+s};
const todayStr=()=>{const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")};
const fmtData=s=>{const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(s||"");return m?m[3]+"/"+m[2]:""};

const DEFROT={parcelas:"Parcelas",recorrentes:"Recorrentes",sophia:"Compartilhados",entradas:"Entradas",variaveis:"Variáveis"};
const TIPOS={mensal:["Gasto mensal fixo","recorrentes","Contas e assinaturas que se repetem todo mês."],parcelado:["Compra parcelada","parcelas","Compras parceladas, com valor da parcela e quantas faltam."],avulso:["Gasto avulso com data","variaveis","Gastos com data e categoria, sem repetir."],dividido:["Dividido com outra pessoa","sophia","Gastos que você divide com outra pessoa. O app considera 50% do total como a sua parte."],entrada:["Entrada de dinheiro","entradas","Dinheiro que entra, como salário e outras rendas."]};
const grupos=f=>f&&Array.isArray(f.grupos)?f.grupos:[];
const grp=k=>grupos(ctx&&ctx.S.fin).find(g=>g.id===k);
const baseOf=k=>DEFROT[k]?k:(grp(k)?TIPOS[grp(k).tipo][1]:"variaveis");
const coll=(f,k)=>DEFROT[k]?f[k]:((f.extra=f.extra||{})[k]=f.extra[k]||[]);
const rot=k=>{if(!DEFROT[k]){const g=grp(k);return g?g.nome:""}const r=(ctx&&ctx.S.fin&&ctx.S.fin.cfg&&ctx.S.fin.cfg.rot)||{};return String(r[k]||"").trim().slice(0,24)||DEFROT[k]};
const DICA0={parcelas:"Compras parceladas, com valor da parcela e quantas faltam.",recorrentes:"Contas e assinaturas que se repetem todo mês.",sophia:"Gastos que você divide com outra pessoa. O app considera 50% do total como a sua parte.",entradas:"O que entra por mês: salário e outras rendas.",variaveis:"Gastos do dia a dia, com data e categoria."};
const spec=k=>SEC[baseOf(k)];
const allTabs=()=>TABS.concat(grupos(ctx.S.fin).map(g=>g.id));
const PAL=["#e07a8f","#6cc9c4","#c9b458","#8f8fe0","#d98c5f","#7ab87a"];
const dica=k=>DEFROT[k]?DICA0[k]:(grp(k)?TIPOS[grp(k).tipo][2]:"");
const COLLS=["entradas","recorrentes","sophia","parcelas","variaveis"];
const TABS=["parcelas","recorrentes","sophia","entradas","variaveis"];
const blank=()=>({entradas:[],recorrentes:[],sophia:[],parcelas:[],variaveis:[],grupos:[],extra:{},faturas:{},cfg:{reajusteMes:null},viagem:{}});
const norm=f=>{const b=blank();if(!f||typeof f!=="object")return b;COLLS.forEach(c=>{if(Array.isArray(f[c]))b[c]=f[c]});b.cfg={...b.cfg,...(f.cfg||{})};b.viagem={...(f.viagem||{})};b.grupos=(Array.isArray(f.grupos)?f.grupos:[]).filter(g=>g&&typeof g.id==="string"&&typeof g.nome==="string"&&TIPOS[g.tipo]).slice(0,20).map(g=>({id:g.id.slice(0,40),nome:g.nome.slice(0,24),tipo:g.tipo}));b.faturas=(f.faturas&&typeof f.faturas==="object")?f.faturas:{};b.extra={};if(f.extra&&typeof f.extra==="object")b.grupos.forEach(g=>{if(Array.isArray(f.extra[g.id]))b.extra[g.id]=f.extra[g.id]});return b};

/* ---------- Cálculos ---------- */
const cur=r=>{const b=idx(r.base);return nv(r.atual)+(b==null?0:NOW()-b)};
const endIdx=r=>NOW()+(nv(r.total)-cur(r));
function statusParc(r){const c=cur(r),t=nv(r.total);if(c>t)return"Quitada";if(c<1)return"Começa em "+lab(NOW()+(1-c));return c===t?"Última parcela este mês":"Termina em "+lab(endIdx(r))}
function calc(F){
  const rj=idx(F.cfg.reajusteMes),rows=[],G=grupos(F),EX=F.extra||{};
  const entVal=(x,m)=>{const b=idx(x.inicio);if(b==null)return nv(x.valor);return m>=b&&(x.rep===0?m===b:true)?nv(x.valor):0};
  const parVal=(p,m)=>{const b=idx(p.base);if(b==null)return 0;const c=nv(p.atual)+(m-b);return c>=1&&c<=nv(p.total)?nv(p.valor):0};
  const sophVal=(s,m)=>{const novo=rj!=null&&m>=rj&&s.novoTotal!=null&&s.novoTotal!==""?nv(s.novoTotal):nv(s.total);return novo/2};
  for(let k=0;k<24;k++){
    const m=NOW()+k;
    let ent=sum(F.entradas,x=>entVal(x,m));
    const rec=sum(F.recorrentes,x=>nv(x.valor)),par=sum(F.parcelas,p=>parVal(p,m)),soph=sum(F.sophia,s=>sophVal(s,m)),vari=sum(F.variaveis,v=>idx(v.data)===m?nv(v.valor):0);
    const ext={};let cus=0;
    G.forEach(g=>{const L=EX[g.id]||[];let v=0;
      if(g.tipo==="entrada"){ent+=sum(L,x=>entVal(x,m));return}
      if(g.tipo==="mensal")v=sum(L,x=>nv(x.valor));
      else if(g.tipo==="parcelado")v=sum(L,p=>parVal(p,m));
      else if(g.tipo==="avulso")v=sum(L,x=>idx(x.data)===m?nv(x.valor):0);
      else if(g.tipo==="dividido")v=sum(L,s=>sophVal(s,m));
      ext[g.id]=v;cus+=v});
    const out=par+rec+soph+vari+cus;
    rows.push({m,ent,par,rec,soph,vari,ext,cus,out,saldo:ent-out,reaj:rj===m});
  }
  return rows;
}
const empty=F=>!F.entradas.length&&!F.parcelas.length&&!F.recorrentes.length&&!F.sophia.length&&!grupos(F).some(g=>((F.extra||{})[g.id]||[]).length);
const objNome=F=>String((F&&F.viagem&&F.viagem.nome)||"").trim()||"Objetivo";
const homeSum=F=>{if(empty(F))return null;const all=calc(F),t=trip(F,all);return{saldo:all[0].saldo,ent:all[0].ent,out:all[0].out,mes:MESL[all[0].m%12],nome:objNome(F),viagem:t.list?{total:t.total,mes:t.ti}:null}};
const mesAtual=F=>empty(F)?null:calc(F)[0];

function trip(F,all){
  const c=F.viagem||{},ti=idx(c.mes);
  if(ti==null)return{msg:"Escolha o mês do objetivo abaixo."};
  const teto=nv(c.teto),meta=c.meta!=null&&c.meta!==""?nv(c.meta):null;
  let ini=idx(c.inicio);if(ini==null||ini<NOW())ini=NOW();
  const list=[];let total=0,base=0,pend=0,pendN=0;
  all.forEach(r=>{
    if(r.m>=NOW()&&r.m<ti){
      const livre=r.ent-(r.par+r.rec+r.soph+r.cus);
      if(r.m<ini){pend+=livre-r.vari;pendN++;return}
      const sep=livre-Math.max(teto,r.vari);base+=livre;total+=sep;list.push({m:r.m,sep,acc:total});
    }
  });
  if(!list.length)return{ti,msg:"Não há meses de poupança antes do mês do objetivo. Confira o início e o mês do objetivo."};
  const free={};
  F.parcelas.forEach(p=>{const f=endIdx(p)+1;if(f>NOW()&&f<ti){(free[f]=free[f]||{v:0,n:[]});free[f].v+=nv(p.valor);free[f].n.push(p.nome)}});
  return{ti,teto,meta,ini,list,total,base,pend,pendN,free};
}

/* ---------- Seções (listas editáveis) ---------- */
const SEC={
  parcelas:{l:"Parcelas",sort:(a,b)=>endIdx(a)-endIdx(b),t:r=>r.nome,
    s:r=>{const c=cur(r),t=nv(r.total);return(c>t?"Quitada":Math.max(c,0)+" de "+t)+" · "+statusParc(r)},
    v:r=>brl(r.valor),prog:r=>Math.max(0,Math.min(1,cur(r)/(nv(r.total)||1))),
    cols:[
      {k:"nome",l:"Compra",t:"text",w:1,get:r=>r.nome,set:v=>({nome:v})},
      {k:"valor",l:"Valor da parcela",t:"money",get:r=>r.valor,set:v=>({valor:v})},
      {k:"hoje",l:"Parcela atual",t:"int",get:cur,set:v=>({atual:v,base:ym(NOW())})},
      {k:"total",l:"Total de parcelas",t:"int",get:r=>r.total,set:v=>({total:v})}],
    sum:rows=>"Este mês: <b>"+brl(sum(rows,p=>{const c=cur(p);return c>=1&&c<=nv(p.total)?nv(p.valor):0}))+"</b>",
    none:"Nenhuma parcela. Toque em Adicionar para lançar a primeira."},
  recorrentes:{l:"Recorrentes",sort:(a,b)=>nv(b.valor)-nv(a.valor),t:r=>r.nome,s:r=>r.obs||"",v:r=>brl(r.valor),
    cols:[
      {k:"nome",l:"Conta ou assinatura",t:"text",w:1,get:r=>r.nome,set:v=>({nome:v})},
      {k:"valor",l:"Valor mensal",t:"money",get:r=>r.valor,set:v=>({valor:v})},
      {k:"obs",l:"Observação",t:"text",opt:1,w:1,get:r=>r.obs||"",set:v=>({obs:v})}],
    sum:rows=>"Por mês: <b>"+brl(sum(rows,r=>nv(r.valor)))+"</b>",none:"Nenhuma conta recorrente ainda."},
  sophia:{l:"Divididos",sort:(a,b)=>nv(b.total)-nv(a.total),t:r=>r.nome,
    s:r=>{let s="Total "+brl(r.total);if(r.novoTotal!=null&&r.novoTotal!=="")s+=" · após reajuste, sua metade: "+brl(nv(r.novoTotal)/2);return s},
    v:r=>brl(nv(r.total)/2),
    cols:[
      {k:"nome",l:"Gasto",t:"text",w:1,get:r=>r.nome,set:v=>({nome:v})},
      {k:"total",l:"Valor total hoje",t:"money",get:r=>r.total,set:v=>({total:v})},
      {k:"novoTotal",l:"Total após reajuste",t:"money",opt:1,get:r=>r.novoTotal,set:v=>({novoTotal:v})}],
    sum:rows=>{const a=sum(rows,r=>nv(r.total)/2),b=sum(rows,r=>(r.novoTotal!=null&&r.novoTotal!==""?nv(r.novoTotal):nv(r.total))/2);return"Sua metade: <b>"+brl(a)+"</b>"+(Math.abs(a-b)>.004?" → <b>"+brl(b)+"</b> após o reajuste":"")},
    none:"Nenhum gasto dividido lançado."},
  entradas:{l:"Entradas",sort:(a,b)=>nv(b.valor)-nv(a.valor),t:r=>r.nome,s:r=>r.inicio?"Cai em "+lab(idx(r.inicio))+(r.rep===0?" (só nesse mês)":" e todo mês depois"):"Todo mês",v:r=>brl(r.valor),
    cols:[
      {k:"nome",l:"Entrada",t:"text",w:1,get:r=>r.nome,set:v=>({nome:v})},
      {k:"valor",l:"Valor",t:"money",get:r=>r.valor,set:v=>({valor:v})},
      {k:"inicio",l:"Cai a partir de",t:"month",get:r=>r.inicio||"",set:v=>({inicio:v})},
      {k:"rep",l:"Repete?",t:"sel",get:r=>r.rep===0?"0":"1",set:v=>({rep:v})}],
    sum:rows=>"Entram: <b>"+brl(sum(rows,r=>nv(r.valor)))+"</b>",none:"Nenhuma entrada lançada."},
  variaveis:{l:"Variáveis",sort:(a,b)=>String(b.data).localeCompare(String(a.data)),t:r=>r.nome,s:r=>(r.compra?"compra "+fmtData(r.compra)+" · pago "+fmtData(r.data):fmtData(r.data))+(r.cat?" · "+r.cat:""),v:r=>brl(r.valor),
    cols:[
      {k:"data",l:"Data",t:"date",get:r=>r.data,set:v=>({data:v})},
      {k:"nome",l:"Descrição",t:"text",w:1,get:r=>r.nome,set:v=>({nome:v})},
      {k:"valor",l:"Valor",t:"money",get:r=>r.valor,set:v=>({valor:v})},
      {k:"cat",l:"Categoria",t:"text",opt:1,get:r=>r.cat||"",set:v=>({cat:v})}],
    sum:rows=>"Em "+MESL[NOW()%12]+": <b>"+brl(sum(rows,r=>idx(r.data)===NOW()?nv(r.valor):0))+"</b>",
    none:"Nenhum gasto variável lançado. Lance aqui o que gastar no dia a dia."}
};
const parse=(c,raw)=>c.t==="month"?(raw===""?null:raw):c.t==="sel"?(raw==="0"?0:1):c.t==="text"?raw.trim():c.t==="date"?raw:c.t==="int"?parseInt(raw,10):(raw===""&&c.opt?null:parseFloat(raw));
const valid=(c,v)=>c.t==="month"?(v===null?!!c.opt:/^\d{4}-\d{2}$/.test(v)):c.t==="sel"?true:c.t==="text"?(!!c.opt||v!==""):c.t==="date"?/^\d{4}-\d{2}-\d{2}$/.test(v):v===null?!!c.opt:typeof v==="number"&&isFinite(v);

const ui={tab:"parcelas",open:null,sel:0,dest:"variaveis"};
let ctx=null;
const F=()=>ctx.S.fin;

/* ---------- Telas (devolvem HTML; o app.js coloca no page()) ---------- */
const SEGN=()=>{const s=[[rot("parcelas"),r=>r.par,"var(--ac)"],[rot("recorrentes"),r=>r.rec,"#7fa3db"],[rot("sophia"),r=>r.soph,"#e0aa5c"],[rot("variaveis"),r=>r.vari,"#ab92d6"]];grupos(F()).filter(g=>g.tipo!=="entrada").forEach((g,i)=>s.push([g.nome,r=>r.ext[g.id]||0,PAL[i%PAL.length]]));return s};
const line=(k,v,cls="")=>`<div class="fl ${cls}"><span class="mu">${k}</span><b>${v}</b></div>`;

function vResumo(){
  const f=F(),now=NOW(),head=`<div class="top"><div><div class="mu">${MESL[now%12]} de ${Math.floor(now/12)}</div><h1>Finanças</h1></div></div>`;
  if(empty(f))return head+`<div class="card"><b>Ainda não há dados.</b><p class="mu" style="margin:6px 0 14px;font-size:14px">Comece lançando uma entrada na aba Contas.</p><button class="btn" data-a="go" data-v="fcontas">Ir para Contas</button></div>`;
  const all=calc(f),rows=all.slice(0,12),r0=rows[0],base=Math.max(r0.ent,r0.out)||1,sel=Math.min(ui.sel,11),r=rows[sel];
  const maxAbs=Math.max(1,...rows.map(x=>Math.abs(x.saldo)));
  const ends=f.parcelas.filter(p=>endIdx(p)===r.m).map(p=>p.nome),notes=[];
  if(ends.length)notes.push("Última parcela: "+esc(ends.join(", ")));
  if(r.reaj)notes.push("Reajuste dos gastos divididos passa a valer neste mês");
  const t=trip(f,all);
  return head+`
  <button class="card tripc" data-a="finGasto" aria-label="Lançar um gasto"><div class="lbl" style="margin-top:0">Saldo de ${MESL[now%12]}</div>
    <div class="fbig ${r0.saldo<0?"bad":"good"}">${brl(r0.saldo)}</div>
    <div class="mu" style="font-size:14px;margin-top:4px">Previsto no mês: entram ${brl(r0.ent)} e saem ${brl(r0.out)}</div>
    <div class="stack" role="img" aria-label="Divisão das saídas do mês">${SEGN().map(([n,g,c])=>g(r0)>0?`<i style="width:${g(r0)/base*100}%;background:${c}"></i>`:"").join("")}</div>
    <div class="legd">${SEGN().map(([n,g,c])=>`<div class="lg"><span class="sw" style="background:${c}"></span><span class="mu">${esc(n)}</span><b>${brl(g(r0))}</b></div>`).join("")}</div><div class="mu" style="font-size:13px;margin-top:12px">Toque para lançar um gasto ›</div></button>
  <label class="card tripc" style="cursor:pointer;display:block"><div class="mh" style="display:flex;align-items:center;gap:10px"><b style="flex:1">Importar fatura do cartão</b><span class="mu">›</span></div><div class="mu" style="font-size:13px;margin-top:4px">${Object.keys(f.faturas||{}).length?"Última: fatura paga em "+lab(idx(Object.keys(f.faturas).sort().pop()))+" · ":""}Escolha o PDF e o app ajusta parcelas e gastos.</div><input type="file" id="fat_file" accept=".pdf,application/pdf" hidden></label>
  ${t.list?`<button class="card tripc" data-a="go" data-v="fviagem"><div class="lbl" style="margin-top:0">${esc(objNome(f))} · ${MESL[t.ti%12]} · poupança prevista</div><div class="fbig ${t.total<0?"bad":"good"}" style="font-size:30px">${brl(t.total)}</div><div class="mu" style="font-size:13px;margin-top:2px">${t.list.length} ${t.list.length>1?"meses":"mês"} de ${lab(t.list[0].m)} a ${lab(t.list[t.list.length-1].m)} ›</div></button>`:""}
  <div class="card"><h2 style="margin-top:0">Saldo mês a mês</h2>
    <div class="fchart">${rows.map((x,k)=>`<button class="fcol" data-a="finSel" data-i="${k}" aria-pressed="${k===sel}" aria-label="${lab(x.m)}, saldo ${brl(x.saldo)}"><span class="tip">${k===sel?compact(x.saldo):""}</span><span class="fb ${x.saldo<0?"neg":""}" style="height:${Math.max(6,Math.round(Math.abs(x.saldo)/maxAbs*110))}px"></span><span class="fm">${MES[x.m%12]}</span></button>`).join("")}</div>
    <div class="fdet"><b style="font-size:16px">${longLab(r.m)}</b>
      ${line(rot("entradas"),brl(r.ent))}${line(rot("parcelas"),brl(r.par))}${line(rot("recorrentes"),brl(r.rec))}${line(rot("sophia")+" (sua parte)",brl(r.soph))}${line(rot("variaveis"),brl(r.vari))}${grupos(f).filter(g=>g.tipo!=="entrada").map(g=>line(esc(g.nome),brl(r.ext[g.id]||0))).join("")}${line("Saldo",brl(r.saldo),"tot "+(r.saldo<0?"bad":"good"))}
      ${notes.length?`<ul class="notes">${notes.map(n=>`<li>${n}</li>`).join("")}</ul>`:""}</div></div>`;
}

function form(tab,row){
  const S=spec(tab);
  return `<div class="fform"><div class="grid2">${S.cols.map(c=>{
    const val=row?c.get(row):c.t==="date"?todayStr():c.t==="month"?ym(NOW()):c.t==="sel"?"1":"",at=c.t==="text"?'type="text"':c.t==="date"?'type="date"':c.t==="month"?'type="month"':c.t==="money"?'type="number" step="0.01" min="0" inputmode="decimal"':'type="number" step="1" min="0" inputmode="numeric"';
    return `<div class="fld" ${c.w||c.t==="date"?'style="grid-column:1/-1"':""}><label for="ff_${c.k}">${c.l}${c.opt?" (opcional)":""}</label>${c.t==="sel"?`<select id="ff_${c.k}"><option value="1"${String(val)==="1"?" selected":""}>Todo mês</option><option value="0"${String(val)==="0"?" selected":""}>Só nesse mês</option></select>`:`<input id="ff_${c.k}" ${at} value="${esc(val==null?"":val)}">`}</div>`}).join("")}</div>
  <div class="frow"><button class="btn" data-a="finSave">${row?"Salvar":"Adicionar"}</button><button class="btn ghost" data-a="finCancel">Cancelar</button></div>${row?`<button class="lk fdel" data-a="finDel" data-id="${esc(row.id)}">Remover</button>`:""}</div>`;
}

function vContas(){
  const f=F();if(!allTabs().includes(ui.tab))ui.tab="parcelas";
  const tab=ui.tab,S=spec(tab),rows=coll(f,tab).slice().sort(S.sort),isNew=ui.open===tab+":new",custom=!DEFROT[tab];
  return `<div class="top"><div><div class="mu">Lançamentos</div><h1>Contas</h1></div><button class="btn" style="width:auto;padding:10px 16px;font-size:14px;border-radius:12px" data-a="finLancar">＋ Lançar</button></div>
  <div class="chips">${allTabs().map(c=>`<button data-a="finTab" data-t="${c}" class="${c===tab?"on":""}">${esc(rot(c))}</button>`).join("")}<button data-a="finGrupoNovo" class="${ui.novoGrupo?"on":""}">＋ Novo grupo</button></div>
  ${ui.novoGrupo?`<div class="card"><b>Novo grupo</b><p class="mu" style="font-size:13px;margin:4px 0 10px">Crie o grupo do jeito que preferir, com o nome que quiser.</p><div class="fld"><label for="gn_nome">Nome do grupo</label><input id="gn_nome" type="text" maxlength="24" placeholder="Ex.: Saúde, Pets, Carro"></div><div class="fld" style="margin-top:10px"><label for="gn_tipo">Como ele funciona</label><select id="gn_tipo">${Object.entries(TIPOS).map(([k,v])=>`<option value="${k}">${v[0]}</option>`).join("")}</select></div><div class="frow" style="margin-top:12px"><button class="btn" data-a="finGrupoSave">Criar grupo</button><button class="btn ghost" data-a="finGrupoNovo">Cancelar</button></div></div>`:""}
  <div class="fhead"><span class="mu">${S.sum(rows)}</span><button class="btn" style="width:auto;padding:10px 16px;font-size:14px;border-radius:12px" data-a="finAdd">＋ Adicionar</button></div>
  <div class="fld" style="margin-bottom:8px"><label for="fr_nome">Nome desta aba (você pode mudar)</label><input id="fr_nome" type="text" maxlength="24" data-fin="rot" data-rk="${tab}" value="${esc(rot(tab))}"></div><p class="mu" style="font-size:13px;margin:0 0 10px">${dica(tab)}</p>
  ${baseOf(tab)==="sophia"?`<div class="fld" style="margin-bottom:10px"><label for="fr">Reajuste vale a partir de</label><input id="fr" type="month" data-fin="reaj" value="${esc(f.cfg.reajusteMes||"")}"></div>`:""}
  ${isNew?`<div class="card">${form(tab,null)}</div>`:""}
  ${rows.length?`<div class="card flush">${rows.map(r=>{const open=ui.open===tab+":"+r.id;return `<button class="row" data-a="finOpen" data-id="${esc(r.id)}" aria-expanded="${open}"><span class="n"><b ${open?'class="good"':""}>${esc(S.t(r))}</b>${S.s(r)?`<small>${esc(S.s(r))}</small>`:""}</span><b>${S.v(r)}</b></button>${S.prog?`<div class="bar" style="margin:-4px 16px 12px"><i style="width:${Math.round(S.prog(r)*100)}%"></i></div>`:""}${open?`<div style="padding:0 16px 14px">${form(tab,r)}</div>`:""}`}).join("")}</div>`:(isNew?"":`<p class="mu" style="padding:8px 4px">${S.none}</p>`)}
  ${custom?`<button class="lk fdel" data-a="finGrupoDel" data-id="${esc(tab)}" style="display:block;margin:18px auto 0">Excluir este grupo</button>`:""}`;
}

function vLancarFin(){
  if(!DEFROT[ui.dest]&&!grp(ui.dest))ui.dest="variaveis";
  const d=ui.dest,ord=["variaveis","parcelas","recorrentes","sophia","entradas"].concat(grupos(F()).map(g=>g.id));
  return `<h1 style="margin-bottom:4px">Lançar</h1><p class="mu" style="font-size:13px;margin:0 0 12px">Escolha para onde o lançamento vai e preencha os dados.</p>
  <div class="lbl" style="margin-top:0">Para onde vai?</div><div class="chips" style="flex-wrap:wrap;overflow:visible">${ord.map(c=>`<button data-a="finDest" data-t="${c}" class="${c===d?"on":""}">${esc(rot(c))}</button>`).join("")}</div>
  <p class="mu" style="font-size:13px;margin:0 0 10px">${dica(d)}</p>
  <div class="card">${form(d,null).replace('data-a="finSave"','data-a="finLSave"').replace('data-a="finCancel"','data-a="finLCancel"')}</div>`;
}
function vViagem(){
  const f=F(),all=calc(f),t=trip(f,all),c=f.viagem||{};
  const fields=`<div class="fld" style="margin-top:16px"><label for="t_nome">Nome do objetivo</label><input id="t_nome" type="text" maxlength="30" placeholder="Ex.: Viagem, Reserva, Carro" data-fin="nome" value="${esc(c.nome||"")}"></div><div class="grid1" style="margin-top:12px">
    <div class="fld"><label for="t_ini">Começa a poupar em</label><input id="t_ini" type="month" data-fin="ini" value="${esc(c.inicio||"")}"></div>
    <div class="fld"><label for="t_teto">Limite de gastos do dia a dia (R$/mês)</label><input id="t_teto" type="number" step="50" min="0" inputmode="decimal" data-fin="teto" value="${esc(c.teto??"")}"></div>
    <div class="fld"><label for="t_mes">Mês do objetivo</label><input id="t_mes" type="month" data-fin="mes" value="${esc(c.mes||"")}"></div>
    <div class="fld"><label for="t_meta">Meta (opcional, R$)</label><input id="t_meta" type="number" step="100" min="0" inputmode="decimal" data-fin="meta" value="${esc(c.meta??"")}"></div></div>`;
  const head=`<div class="top"><div><div class="mu">${t.ti!=null?"Plano de poupança":"Planejamento"}</div><h1>${t.ti!=null?objNome(f)+" · "+MESL[t.ti%12]+" de "+Math.floor(t.ti/12):objNome(f)}</h1></div></div>`;
  if(!t.list)return head+`<div class="card"><div class="mu" style="font-size:14px">${esc(t.msg)}</div>${fields}</div>`;
  const mx=t.meta!=null?(t.base-t.meta)/t.list.length:null;
  const fk=Object.keys(t.free).map(Number).sort((a,b)=>a-b);
  return head+`<div class="card"><div class="lbl" style="margin-top:0">Poupança prevista até ${MESL[(t.ti-1)%12]}</div>
    <div class="fbig ${t.total<0?"bad":"good"}">${brl(t.total)}</div>
    <div class="mu" style="font-size:14px;margin-top:6px">É uma previsão, não um valor guardado: quanto sobra de ${lab(t.list[0].m)} a ${lab(t.list[t.list.length-1].m)} (${t.list.length} ${t.list.length>1?"meses":"mês"}) se você gastar até ${brl(t.teto)} por mês no dia a dia. Conta só a entrada fixa, depois de parcelas, recorrentes e gastos divididos. Muda quando você lança uma compra parcelada.</div>
    ${mx!=null?`<div class="callout">${mx<0?`Só com a entrada fixa, a meta de ${brl(t.meta)} não fecha. O máximo possível, sem gastar nada no dia a dia, é ${brl(t.base)}.`:`Para chegar a ${brl(t.meta)}, o dia a dia pode custar no máximo ${brl(mx)} por mês. ${t.total>=t.meta?"Com o teto atual, você chega lá.":"Com o teto atual, faltam "+brl(t.meta-t.total)+"."}`}</div>`:""}
    ${fields}
    <details><summary>Quanto separar por mês</summary><div class="tri"><span class="mu">Mês</span><span class="mu r">Separar</span><span class="mu r">Acumulado</span>${t.list.map(x=>`<span>${lab(x.m)}</span><span class="r ${x.sep<0?"bad":""}">${brl(x.sep)}</span><span class="r">${brl(x.acc)}</span>`).join("")}</div><p class="mu" style="font-size:13px">Separe no dia em que o dinheiro entra, antes de gastar. O valor sobe sozinho quando uma parcela acaba.</p></details>
    <details><summary>Parcelas que acabam e liberam dinheiro</summary>${fk.length?fk.map(k=>`<div class="fl"><span class="mu">${lab(k)} · ${esc(t.free[k].n.join(", "))}</span><b class="good">+${brl(t.free[k].v)}</b></div>`).join(""):`<p class="mu" style="font-size:13px">Nenhuma parcela termina antes do mês do objetivo.</p>`}</details></div>`;
}

function vImport(){
  return `<h1>Importar finanças</h1><p class="mu" style="font-size:13px;margin:4px 0 16px">Cole aqui o texto do arquivo <b>financeiro.json</b> gerado a partir do Controle Financeiro. Isso substitui as listas de finanças que já estão no app.</p>
  <div class="fld"><label for="fi_txt">Conteúdo do arquivo</label><textarea id="fi_txt" rows="8" placeholder='{"entradas":[...],"parcelas":[...]}' autocapitalize="off" spellcheck="false"></textarea></div>
  <div style="height:14px"></div><button class="btn" data-a="finImp">Importar</button>`;
}


/* ---------- Importar fatura do cartão (PDF) ---------- */
const nrmF=t=>String(t||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase();
const num2=s=>{const v=parseFloat(String(s).replace(/\./g,"").replace(",","."));return isNaN(v)?null:v};
const CATS=[
  ["Mercado",/supermercad|mercado(?!livre)|hortifruti|atacad|assai|carrefour|pao de acucar|sacolao|emporio|açougue|acougue/],
  ["Transporte",/\buber\b|\b99 ?(app|pop|taxi)|cabify|posto |ipiranga|combust|estacionam|pedagio|sem parar|bilhete|metro\b/],
  ["Alimentação",/restaurante|lanchonete|padaria|burger|ifd\*|ifood|cantina|pizza|cafeteria|sorvet|acai|doceria|bar e |churrasc/],
  ["Saúde",/drogal|droga|farmac|raia|pacheco|clinica|hospital|laborat|odonto|consulta/],
  ["Assinaturas",/anthropic|apple\.com|netflix|spotify|openai|google|adobe|youtube|prime video|disney|hbo|globoplay|icloud/],
  ["Compras",/mercadolivre|amazon|centauro|magalu|shopee|americanas|aliexpress|shein|renner|riachuelo|loja/]
];
const OUTROS="Outros";
const chaveLoja=d=>nrmF(d).replace(/[^a-z0-9 ]/g," ").split(/\s+/).filter(Boolean).slice(0,2).join(" ");
function classificar(desc){
  const rg=(F().cfg&&F().cfg.regras)||{},k=chaveLoja(desc);
  if(rg[k])return rg[k];
  const n=nrmF(desc);for(const[nome,re]of CATS)if(re.test(n))return nome;
  return OUTROS}
function parseFatura(tx){
  const L=tx.split("\n").map(x=>x.replace(/\s+/g," ").trim()).filter(x=>x!==""),it=[];
  const dd=(tx.match(/Data:\s*(\d{2})\/(\d{2})\/(\d{4})/)||[]),docM=+dd[2]||null,docY=+dd[3]||new Date().getFullYear();
  const tot=tx.match(/Total da Fatura em Real[^\d-]*(-?\d[\d.]*,\d{2})/i);
  for(let i=0;i<L.length;i++){
    let a=L[i].match(/^(\d{1,2}) (.*?)\s?(BRL|USD|EUR)$/),j=i+1,b=null;
    if(a)b=L[j]&&L[j].match(/^(.*?)\s*(-?\d[\d.]*,\d{2}) R\$ (-?\d[\d.]*,\d{2}) (-?\d[\d.]*,\d{2})$/);
    if(!b){const s=L[i].match(/^(\d{1,2}) (.*?)\s?(BRL|USD|EUR) (-?\d[\d.]*,\d{2}) R\$ (-?\d[\d.]*,\d{2}) (-?\d[\d.]*,\d{2})$/);if(!s)continue;a=[null,s[1],s[2]];b=[null,"",s[4],s[5],s[6]];j=i}
    const c=L[j+1]&&L[j+1].match(/^\/(\d{2})(?: (\d{1,2}\/\d{1,2}))?\s/);if(!c)continue;
    let desc=(a[2]||b[1]||"").trim();if(!desc)continue;
    const valor=num2(b[4]);if(valor==null)continue;
    let n=null,m=null,pm=(c[2]||"").match(/^(\d{1,2})\/(\d{1,2})$/)||desc.match(/\s(\d{1,2})\/(\d{1,2})$/);
    if(pm&&+pm[2]>=2&&+pm[1]>=1&&+pm[1]<=+pm[2]){n=+pm[1];m=+pm[2];desc=desc.replace(/\s\d{1,2}\/\d{1,2}$/,"").trim()}
    const mes=+c[1],ano=docM&&mes>docM?docY-1:docY;
    it.push({dia:+a[1],mes,ano,data:ano+"-"+String(mes).padStart(2,"0")+"-"+String(+a[1]).padStart(2,"0"),desc:desc.slice(0,60),valor,n,m});
    i=j+1}
  return{itens:it,total:tot?num2(tot[1]):null,docM,docY}}
const nomeBonito=d=>{let s=String(d).replace(/\*/g," ").replace(/\s+/g," ").trim(),w=s.split(" ");if(w.length%2===0&&w.slice(0,w.length/2).join(" ").toLowerCase()===w.slice(w.length/2).join(" ").toLowerCase())s=w.slice(0,w.length/2).join(" ");return s.toLowerCase().replace(/(^|[\s\-\/\.])([a-zà-ÿ])/g,(m,a,b)=>a+b.toUpperCase())};
const diaPag=()=>{const d=+((F().cfg||{}).cartao||{}).dia;return d>=1&&d<=31?d:25};
const mesPagPadrao=()=>{const n=new Date(),d=n.getDate(),ix=NOW()+(d>diaPag()?1:0);return ym(ix)};
const dataPag=(mes,dia)=>{const[y,m]=mes.split("-").map(Number),u=new Date(y,m,0).getDate();return mes+"-"+String(Math.min(dia,u)).padStart(2,"0")};
function casarParcela(it,pars,usados){
  if(it.m==null)return null;
  const c=pars.filter(p=>nv(p.total)===it.m&&!usados.has(p.id)&&Math.abs(nv(p.valor)-it.valor)/it.valor<=.03);
  if(!c.length)return null;
  const tk=nrmF(it.desc).split(/[^a-z0-9]+/).filter(t=>t.length>=4);
  c.sort((a,b)=>{const sa=tk.filter(t=>nrmF(a.nome).includes(t)).length,sb=tk.filter(t=>nrmF(b.nome).includes(t)).length;return sb-sa||Math.abs(nv(a.valor)-it.valor)-Math.abs(nv(b.valor)-it.valor)});
  return c[0]}
function casarRecorrente(it,recs){
  if(it.m!=null)return null;
  const tk=nrmF(it.desc).split(/[^a-z0-9]+/).filter(t=>t.length>=4);
  return recs.find(r=>{const rn=nrmF(r.nome);return tk.some(t=>rn.includes(t))||rn.split(/[^a-z0-9]+/).filter(t=>t.length>=4).some(t=>nrmF(it.desc).includes(t))})||null}
function faturaDeTexto(tx){
  const f=F(),r=parseFatura(tx);
  if(!r.itens.length)return ctx.toast("Não consegui ler compras nesse PDF. Por enquanto só a fatura do Bradesco.");
  const usados=new Set(),itens=r.itens.map((it,i)=>{
    let acao,auto,motivo="";
    const p=casarParcela(it,f.parcelas,usados);
    if(it.m!=null){if(p){usados.add(p.id);acao="p:"+p.id;motivo="atualiza "+p.nome}else{acao="pnova";motivo="parcela nova"}}
    else{const rc=casarRecorrente(it,f.recorrentes);if(rc){acao="rec";motivo="já cadastrado: "+rc.nome}else{auto=classificar(it.desc);acao="g:"+auto}}
    return{...it,id:i,acao,auto:acao,motivo}});
  const soma=itens.reduce((s,x)=>s+x.valor,0);
  ui.fat={mes:mesPagPadrao(),dia:diaPag(),itens,totalPdf:r.total,soma};
  ctx.go("fimpfat")}
const grpAvulsos=()=>grupos(F()).filter(g=>g.tipo==="avulso").map(g=>g.nome);
const nomesGrupo=()=>{const e=grpAvulsos(),pad=CATS.map(c=>c[0]).concat([OUTROS]);return e.concat(pad.filter(n=>!e.some(x=>x.toLowerCase()===n.toLowerCase())))};
function vFatura(){
  const x=ui.fat;if(!x)return `<h1>Importar fatura</h1><p class="mu">Escolha o PDF da fatura em Finanças.</p>`;
  const f=F(),op=(v,l,s)=>`<option value="${esc(v)}"${s===v?" selected":""}>${esc(l)}</option>`;
  const gOpts=sel=>nomesGrupo().map(n=>op("g:"+n,n,sel)).join("")+op("var",rot("variaveis"),sel)+op("ign","Ignorar",sel);
  const row=it=>{
    let opts;
    if(it.m!=null)opts=f.parcelas.map(p=>op("p:"+p.id,"Atualizar: "+p.nome,it.acao)).join("")+op("pnova","Criar parcela nova",it.acao)+op("ign","Ignorar",it.acao);
    else opts=op("rec","Já cadastrado (recorrente)",it.acao)+gOpts(it.acao);
    return `<div class="fatrow"><div class="fl"><span><b>${esc(it.desc)}</b>${it.m!=null?` <span class="good">${it.n}/${it.m}${it.n===it.m?" · última":""}</span>`:""}<br><small class="mu">${String(it.dia).padStart(2,"0")}/${String(it.mes).padStart(2,"0")}${it.motivo?" · "+esc(it.motivo):""}</small></span><b>${brl(it.valor)}</b></div><select data-fin="fatacao" data-i="${it.id}">${opts}</select></div>`};
  const dif=x.totalPdf!=null?Math.abs(x.totalPdf-x.soma):null;
  const gp=it=>it.m!=null?0:it.acao==="rec"?1:2;
  const sec=(t,l)=>l.length?`<div class="lbl">${t} · ${l.length}</div><div class="card flush">${l.map(row).join("")}</div>`:"";
  const par=x.itens.filter(i=>i.m!=null),rec=x.itens.filter(i=>i.m==null&&i.acao==="rec"),oth=x.itens.filter(i=>i.m==null&&i.acao!=="rec");
  const pagto=dataPag(x.mes,x.dia);
  return `<h1 style="margin-bottom:4px">Importar fatura</h1><p class="mu" style="font-size:13px;margin:0 0 12px">Confira como cada compra entra. O que você mudar aqui vale só para esta importação, e o app aprende o grupo das lojas que você corrigir.</p>
  <div class="card"><div class="grid2"><div class="fld"><label for="fat_mes">Mês do pagamento</label><input id="fat_mes" type="month" data-fin="fatmes" value="${esc(x.mes)}"></div><div class="fld"><label for="fat_dia">Dia do pagamento</label><input id="fat_dia" type="number" min="1" max="31" inputmode="numeric" data-fin="fatdia" value="${x.dia}"></div></div>
  <p class="mu" style="font-size:13px;margin:10px 0 0">As compras entram no mês em que a fatura é paga: <b>${fmtData(pagto)}/${pagto.slice(0,4)}</b>.</p>
  <div class="fl" style="margin-top:10px"><span class="mu">Soma das compras</span><b>${brl(x.soma)}</b></div>${x.totalPdf!=null?`<div class="fl"><span class="mu">Total da fatura</span><b>${brl(x.totalPdf)}</b></div><p class="${dif<.02?"good":"bad"}" style="font-size:13px;margin:6px 0 0">${dif<.02?"Confere com o total da fatura.":"Diferença de "+brl(dif)+" em relação ao total."}</p>`:""}</div>
  ${sec("Parcelas",par)}${sec("Recorrentes reconhecidas",rec)}${sec("Outras compras",oth)}
  <div class="frow" style="margin-top:14px"><button class="btn" data-a="fatOk">Importar fatura</button><button class="btn ghost" data-a="fatCancel">Cancelar</button></div>`}
function aplicarFatura(){
  const x=ui.fat;if(!x)return;const f=F(),pagto=dataPag(x.mes,x.dia);
  f.cfg=f.cfg||{};f.cfg.cartao={...(f.cfg.cartao||{}),dia:x.dia};f.cfg.regras={...(f.cfg.regras||{})};
  // limpa importações anteriores da mesma fatura
  f.variaveis=f.variaveis.filter(v=>v.fat!==x.mes);
  if(f.extra)Object.keys(f.extra).forEach(k=>{f.extra[k]=f.extra[k].filter(v=>v.fat!==x.mes)});
  let nP=0,nC=0,nN=0;
  const grupoDe=nome=>{let g=grupos(f).find(g=>g.tipo==="avulso"&&g.nome.toLowerCase()===nome.toLowerCase());if(!g){g={id:"g"+ctx.uid().replace(/-/g,"").slice(0,12),nome:nome.slice(0,24),tipo:"avulso"};f.grupos=[...grupos(f),g];(f.extra=f.extra||{})[g.id]=[]}return g};
  x.itens.forEach(it=>{
    const a=it.acao;if(a==="ign"||a==="rec")return;
    if(it.m!=null){
      if(a.startsWith("p:")){const p=f.parcelas.find(p=>p.id===a.slice(2));if(p){p.atual=it.n;p.base=x.mes;p.valor=it.valor;p.total=it.m;nP++}}
      else if(a==="pnova"){f.parcelas.push({id:ctx.uid(),nome:nomeBonito(it.desc).slice(0,40),valor:it.valor,atual:it.n,total:it.m,base:x.mes});nN++}
      return}
    const base={id:ctx.uid(),data:pagto,compra:it.data,nome:it.desc,valor:it.valor,cat:"",fat:x.mes};
    if(a==="var")f.variaveis.push(base);
    else if(a.startsWith("g:")){const g=grupoDe(a.slice(2));f.extra[g.id].push(base)}
    else return;
    nC++;
    if(a!==it.auto){const k=chaveLoja(it.desc);if(k)f.cfg.regras[k]=a==="var"?"Variáveis":a.slice(2)}
  });
  f.faturas={...(f.faturas||{}),[x.mes]:{total:x.totalPdf!=null?x.totalPdf:x.soma,em:todayStr()}};
  ui.fat=null;commit0();
  ctx.toast("Fatura importada: "+nP+" parcela(s) atualizada(s), "+nN+" nova(s), "+nC+" compra(s)");
  ctx.go("fresumo")}

/* ---------- Ações ---------- */
function commit(){ctx.save();ctx.queueState();ctx.render()}
function commit0(){ctx.save();ctx.queueState()}
function cleanImport(j){
  if(!j||typeof j!=="object")return null;
  const out=blank(),id=()=>ctx.uid();
  for(const c of COLLS){
    const src=j[c];if(src==null)continue;if(!Array.isArray(src)||src.length>500)return null;
    for(const r of src){
      if(!r||typeof r!=="object")return null;
      const o={id:typeof r.id==="string"&&r.id.length<80?r.id:id()};
      for(const col of SEC[c].cols){
        const keys=Object.keys(col.set(col.t==="text"?"x":1));
        for(const k of keys){
          const raw=r[k];
          if(col.t==="month"){o[k]=/^\d{4}-\d{2}/.test(raw||"")?String(raw).slice(0,7):null;continue}
          if(k==="base"){o.base=/^\d{4}-\d{2}/.test(raw||"")?String(raw).slice(0,7):null;continue}
          if(col.t==="text"){o[k]=String(raw??"").slice(0,80);continue}
          if(col.t==="date"){o[k]=/^\d{4}-\d{2}-\d{2}$/.test(raw||"")?raw:null;continue}
          if(raw==null||raw===""){o[k]=null;continue}
          const n=Number(raw);if(!isFinite(n)||n<0||n>1e9)return null;o[k]=n;
        }
      }
      if(c==="parcelas"&&!o.base)return null;
      if(c==="variaveis"&&!o.data)return null;
      out[c].push(o);
    }
  }
  const rj=j.cfg&&j.cfg.reajusteMes;if(j.cfg&&j.cfg.rot&&typeof j.cfg.rot==="object"){out.cfg.rot={};for(const k of Object.keys(DEFROT))if(typeof j.cfg.rot[k]==="string")out.cfg.rot[k]=j.cfg.rot[k].slice(0,24)}out.cfg.reajusteMes=/^\d{4}-\d{2}$/.test(rj||"")?rj:null;
  const v=j.viagem||{};
  out.viagem={nome:typeof v.nome==="string"?v.nome.trim().slice(0,30):"",inicio:/^\d{4}-\d{2}$/.test(v.inicio||"")?v.inicio:null,mes:/^\d{4}-\d{2}$/.test(v.mes||"")?v.mes:null,meta:v.meta>0?Number(v.meta):null,teto:v.teto>=0?Number(v.teto):0};
  return out;
}
function importText(txt){
  let j;try{j=JSON.parse(txt)}catch(e){return ctx.toast("O arquivo não é um JSON válido")}
  const n=cleanImport(j);if(!n)return ctx.toast("Arquivo com dados inválidos");
  if(!empty(F())&&!confirm("Isso substitui as finanças que já estão no app. Continuar?"))return;
  ctx.S.fin=n;ctx.save();ctx.queueState();ctx.toast("Finanças importadas");ctx.go("fresumo");
}
function actions(c){
  ctx=c;if(!ctx.S.fin||!Array.isArray(ctx.S.fin.entradas))ctx.S.fin=norm(ctx.S.fin);
  document.addEventListener("change",e=>{
    const k=e.target.dataset&&e.target.dataset.fin;if(!k)return;
    const f=F(),v=e.target.value,x=parseFloat(v);
    if(k==="fatacao"){const it=ui.fat&&ui.fat.itens[+e.target.dataset.i];if(it){it.acao=v;ctx.render()}return}
    if(k==="fatmes"){if(ui.fat&&/^\d{4}-\d{2}$/.test(v)){ui.fat.mes=v;ctx.render()}return}
    if(k==="fatdia"){if(ui.fat){const d=parseInt(v,10);ui.fat.dia=d>=1&&d<=31?d:25;ctx.render()}return}
    if(k==="rot"){const rk=e.target.dataset.rk,nn=v.trim().slice(0,24);if(DEFROT[rk])f.cfg.rot={...(f.cfg.rot||{}),[rk]:nn};else{const g=grp(rk);if(g&&nn)g.nome=nn}}
    else if(k==="nome")f.viagem.nome=v.trim().slice(0,30);
    else if(k==="teto")f.viagem.teto=isFinite(x)&&x>=0?x:0;
    else if(k==="mes"){if(v)f.viagem.mes=v}
    else if(k==="ini")f.viagem.inicio=v||null;
    else if(k==="meta")f.viagem.meta=isFinite(x)&&x>0?x:null;
    else if(k==="reaj")f.cfg.reajusteMes=v||null;
    commit();
  });
  return{
    finSel:d=>{ui.sel=+d.i;ctx.render()},
    finTab:d=>{if(allTabs().includes(d.t)){ui.tab=d.t;ui.open=null;ui.novoGrupo=false;ctx.render()}},
    finGrupoNovo:()=>{ui.novoGrupo=!ui.novoGrupo;ctx.render()},
    finGrupoSave:()=>{const n=(document.getElementById("gn_nome").value||"").trim().slice(0,24),t=document.getElementById("gn_tipo").value;if(!n)return ctx.toast("Dê um nome ao grupo");if(!TIPOS[t])return;const f=F();if(grupos(f).length>=20)return ctx.toast("Limite de 20 grupos");if(Object.keys(DEFROT).some(k=>rot(k).toLowerCase()===n.toLowerCase())||grupos(f).some(g=>g.nome.toLowerCase()===n.toLowerCase()))return ctx.toast("Já existe um grupo com esse nome");const id="g"+ctx.uid().replace(/-/g,"").slice(0,12);f.grupos=[...grupos(f),{id,nome:n,tipo:t}];(f.extra=f.extra||{})[id]=[];ui.tab=id;ui.novoGrupo=false;commit()},
    finGrupoDel:d=>{const g=grp(d.id);if(!g||!confirm("Excluir o grupo "+g.nome+" e tudo que está nele?"))return;const f=F();f.grupos=grupos(f).filter(x=>x.id!==d.id);if(f.extra)delete f.extra[d.id];ui.tab="parcelas";ui.open=null;commit()},
    fatOk:()=>aplicarFatura(),
    fatCancel:()=>{ui.fat=null;ctx.go("fresumo")},
    finGasto:()=>{ui.dest="variaveis";ctx.go("flancar")},
    finLancar:()=>{ui.dest=ui.tab;ctx.go("flancar")},
    finDest:d=>{if(DEFROT[d.t]||grp(d.t)){ui.dest=d.t;ctx.render()}},
    finLCancel:()=>ctx.go("fresumo"),
    finLSave:()=>{const S=spec(ui.dest),doc={};let ok=true;S.cols.forEach(c=>{const el=document.getElementById("ff_"+c.k),v=parse(c,el?el.value:"");if(!valid(c,v)){ok=false;return}Object.assign(doc,c.set(v))});if(!ok)return ctx.toast("Preencha os campos com valores válidos");coll(F(),ui.dest).push({id:ctx.uid(),...doc});ui.tab=ui.dest;ui.open=null;ctx.save();ctx.queueState();ctx.toast("Adicionado em "+rot(ui.dest));ctx.go("fresumo")},
    finAdd:()=>{ui.open=ui.open===ui.tab+":new"?null:ui.tab+":new";ctx.render()},
    finOpen:d=>{const k=ui.tab+":"+d.id;ui.open=ui.open===k?null:k;ctx.render()},
    finCancel:()=>{ui.open=null;ctx.render()},
    finSave:()=>{
      const S=spec(ui.tab),doc={};let ok=true;
      S.cols.forEach(c=>{const el=document.getElementById("ff_"+c.k),v=parse(c,el?el.value:"");if(!valid(c,v)){ok=false;return}Object.assign(doc,c.set(v))});
      if(!ok)return ctx.toast("Preencha os campos com valores válidos");
      const L=coll(F(),ui.tab);
      if(ui.open===ui.tab+":new")L.push({id:ctx.uid(),...doc});
      else{const r=L.find(x=>x.id===ui.open.split(":").slice(1).join(":"));if(!r)return;Object.assign(r,doc)}
      ui.open=null;commit();
    },
    finDel:d=>{if(!confirm("Remover este item?"))return;const f=F(),L=coll(f,ui.tab).filter(x=>x.id!==d.id);if(DEFROT[ui.tab])f[ui.tab]=L;else f.extra[ui.tab]=L;ui.open=null;commit()},
    finImp:()=>importText(document.getElementById("fi_txt").value)
  };
}
window.Fin={vFatura,faturaDeTexto,vLancarFin,objNome,importText,actions,norm,blank,mesAtual,homeSum,vResumo,vContas,vViagem,vImport,brl};
})();
