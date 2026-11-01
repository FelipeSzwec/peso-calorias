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

const COLLS=["entradas","recorrentes","sophia","parcelas","variaveis"];
const TABS=["parcelas","recorrentes","sophia","entradas","variaveis"];
const blank=()=>({entradas:[],recorrentes:[],sophia:[],parcelas:[],variaveis:[],cfg:{reajusteMes:null},viagem:{}});
const norm=f=>{const b=blank();if(!f||typeof f!=="object")return b;COLLS.forEach(c=>{if(Array.isArray(f[c]))b[c]=f[c]});b.cfg={...b.cfg,...(f.cfg||{})};b.viagem={...(f.viagem||{})};return b};

/* ---------- Cálculos ---------- */
const cur=r=>{const b=idx(r.base);return nv(r.atual)+(b==null?0:NOW()-b)};
const endIdx=r=>NOW()+(nv(r.total)-cur(r));
function statusParc(r){const c=cur(r),t=nv(r.total);if(c>t)return"Quitada";if(c<1)return"Começa em "+lab(NOW()+(1-c));return c===t?"Última parcela este mês":"Termina em "+lab(endIdx(r))}
function calc(F){
  const ent=sum(F.entradas,x=>nv(x.valor)),rec=sum(F.recorrentes,x=>nv(x.valor)),rj=idx(F.cfg.reajusteMes),rows=[];
  for(let k=0;k<24;k++){
    const m=NOW()+k;
    const par=sum(F.parcelas,p=>{const b=idx(p.base);if(b==null)return 0;const c=nv(p.atual)+(m-b);return c>=1&&c<=nv(p.total)?nv(p.valor):0});
    const soph=sum(F.sophia,s=>{const novo=rj!=null&&m>=rj&&s.novoTotal!=null&&s.novoTotal!==""?nv(s.novoTotal):nv(s.total);return novo/2});
    const vari=sum(F.variaveis,v=>idx(v.data)===m?nv(v.valor):0);
    const out=par+rec+soph+vari;
    rows.push({m,ent,par,rec,soph,vari,out,saldo:ent-out,reaj:rj===m});
  }
  return rows;
}
const empty=F=>!F.entradas.length&&!F.parcelas.length&&!F.recorrentes.length&&!F.sophia.length;
const objNome=F=>String((F&&F.viagem&&F.viagem.nome)||"").trim()||"Objetivo";
const homeSum=F=>{if(empty(F))return null;const all=calc(F),t=trip(F,all);return{saldo:all[0].saldo,nome:objNome(F),viagem:t.list?{total:t.total,mes:t.ti}:null}};
const mesAtual=F=>empty(F)?null:calc(F)[0];

function trip(F,all){
  const c=F.viagem||{},ti=idx(c.mes);
  if(ti==null)return{msg:"Escolha o mês do objetivo abaixo."};
  const teto=nv(c.teto),meta=c.meta!=null&&c.meta!==""?nv(c.meta):null;
  let ini=idx(c.inicio);if(ini==null||ini<NOW())ini=NOW();
  const list=[];let total=0,base=0,pend=0,pendN=0;
  all.forEach(r=>{
    if(r.m>=NOW()&&r.m<ti){
      const livre=r.ent-(r.par+r.rec+r.soph);
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
  sophia:{l:"Sophia",sort:(a,b)=>nv(b.total)-nv(a.total),t:r=>r.nome,
    s:r=>{let s="Total "+brl(r.total);if(r.novoTotal!=null&&r.novoTotal!=="")s+=" · após reajuste, sua metade: "+brl(nv(r.novoTotal)/2);return s},
    v:r=>brl(nv(r.total)/2),
    cols:[
      {k:"nome",l:"Gasto",t:"text",w:1,get:r=>r.nome,set:v=>({nome:v})},
      {k:"total",l:"Valor total hoje",t:"money",get:r=>r.total,set:v=>({total:v})},
      {k:"novoTotal",l:"Total após reajuste",t:"money",opt:1,get:r=>r.novoTotal,set:v=>({novoTotal:v})}],
    sum:rows=>{const a=sum(rows,r=>nv(r.total)/2),b=sum(rows,r=>(r.novoTotal!=null&&r.novoTotal!==""?nv(r.novoTotal):nv(r.total))/2);return"Sua metade: <b>"+brl(a)+"</b>"+(Math.abs(a-b)>.004?" → <b>"+brl(b)+"</b> após o reajuste":"")},
    none:"Nenhum gasto da Sophia lançado."},
  entradas:{l:"Entradas",sort:(a,b)=>nv(b.valor)-nv(a.valor),t:r=>r.nome,s:()=>"",v:r=>brl(r.valor),
    cols:[
      {k:"nome",l:"Entrada",t:"text",w:1,get:r=>r.nome,set:v=>({nome:v})},
      {k:"valor",l:"Valor mensal",t:"money",get:r=>r.valor,set:v=>({valor:v})}],
    sum:rows=>"Por mês: <b>"+brl(sum(rows,r=>nv(r.valor)))+"</b>",none:"Nenhuma entrada lançada."},
  variaveis:{l:"Variáveis",sort:(a,b)=>String(b.data).localeCompare(String(a.data)),t:r=>r.nome,s:r=>fmtData(r.data)+(r.cat?" · "+r.cat:""),v:r=>brl(r.valor),
    cols:[
      {k:"data",l:"Data",t:"date",get:r=>r.data,set:v=>({data:v})},
      {k:"nome",l:"Descrição",t:"text",w:1,get:r=>r.nome,set:v=>({nome:v})},
      {k:"valor",l:"Valor",t:"money",get:r=>r.valor,set:v=>({valor:v})},
      {k:"cat",l:"Categoria",t:"text",opt:1,get:r=>r.cat||"",set:v=>({cat:v})}],
    sum:rows=>"Em "+MESL[NOW()%12]+": <b>"+brl(sum(rows,r=>idx(r.data)===NOW()?nv(r.valor):0))+"</b>",
    none:"Nenhum gasto variável lançado. Lance aqui o que gastar no dia a dia."}
};
const parse=(c,raw)=>c.t==="text"?raw.trim():c.t==="date"?raw:c.t==="int"?parseInt(raw,10):(raw===""&&c.opt?null:parseFloat(raw));
const valid=(c,v)=>c.t==="text"?(!!c.opt||v!==""):c.t==="date"?/^\d{4}-\d{2}-\d{2}$/.test(v):v===null?!!c.opt:typeof v==="number"&&isFinite(v);

const ui={tab:"parcelas",open:null,sel:0};
let ctx=null;
const F=()=>ctx.S.fin;

/* ---------- Telas (devolvem HTML; o app.js coloca no page()) ---------- */
const SEG=[["Parcelas","par","var(--ac)"],["Recorrentes","rec","#7fa3db"],["Sophia","soph","#e0aa5c"],["Variáveis","vari","#ab92d6"]];
const line=(k,v,cls="")=>`<div class="fl ${cls}"><span class="mu">${k}</span><b>${v}</b></div>`;

function vResumo(){
  const f=F(),now=NOW(),head=`<div class="top"><div><div class="mu">${MESL[now%12]} de ${Math.floor(now/12)}</div><h1>Finanças</h1></div></div>`;
  if(empty(f))return head+`<div class="card"><b>Ainda não há dados.</b><p class="mu" style="margin:6px 0 14px;font-size:14px">Comece lançando uma entrada na aba Contas.</p><button class="btn" data-a="go" data-v="fcontas">Ir para Contas</button></div>`;
  const all=calc(f),rows=all.slice(0,12),r0=rows[0],base=Math.max(r0.ent,r0.out)||1,sel=Math.min(ui.sel,11),r=rows[sel];
  const maxAbs=Math.max(1,...rows.map(x=>Math.abs(x.saldo)));
  const ends=f.parcelas.filter(p=>endIdx(p)===r.m).map(p=>p.nome),notes=[];
  if(ends.length)notes.push("Última parcela: "+esc(ends.join(", ")));
  if(r.reaj)notes.push("Reajuste da Sophia passa a valer neste mês");
  const t=trip(f,all);
  return head+`
  <div class="card"><div class="lbl" style="margin-top:0">Saldo de ${MESL[now%12]}</div>
    <div class="fbig ${r0.saldo<0?"bad":"good"}">${brl(r0.saldo)}</div>
    <div class="mu" style="font-size:14px;margin-top:4px">Entram ${brl(r0.ent)} e saem ${brl(r0.out)}</div>
    <div class="stack" role="img" aria-label="Divisão das saídas do mês">${SEG.map(([n,k,c])=>r0[k]>0?`<i style="width:${r0[k]/base*100}%;background:${c}"></i>`:"").join("")}</div>
    <div class="legd">${SEG.map(([n,k,c])=>`<div class="lg"><span class="sw" style="background:${c}"></span><span class="mu">${n}</span><b>${brl(r0[k])}</b></div>`).join("")}</div></div>
  ${t.list?`<button class="card tripc" data-a="go" data-v="fviagem"><div class="lbl" style="margin-top:0">${esc(objNome(f))} · ${MESL[t.ti%12]} · poupança prevista</div><div class="fbig ${t.total<0?"bad":"good"}" style="font-size:30px">${brl(t.total)}</div><div class="mu" style="font-size:13px;margin-top:2px">${t.list.length} ${t.list.length>1?"meses":"mês"} de ${lab(t.list[0].m)} a ${lab(t.list[t.list.length-1].m)} ›</div></button>`:""}
  <div class="card"><h2 style="margin-top:0">Saldo mês a mês</h2>
    <div class="fchart">${rows.map((x,k)=>`<button class="fcol" data-a="finSel" data-i="${k}" aria-pressed="${k===sel}" aria-label="${lab(x.m)}, saldo ${brl(x.saldo)}"><span class="tip">${k===sel?compact(x.saldo):""}</span><span class="fb ${x.saldo<0?"neg":""}" style="height:${Math.max(6,Math.round(Math.abs(x.saldo)/maxAbs*110))}px"></span><span class="fm">${MES[x.m%12]}</span></button>`).join("")}</div>
    <div class="fdet"><b style="font-size:16px">${longLab(r.m)}</b>
      ${line("Entradas",brl(r.ent))}${line("Parcelas",brl(r.par))}${line("Recorrentes",brl(r.rec))}${line("Sophia (sua metade)",brl(r.soph))}${line("Variáveis lançados",brl(r.vari))}${line("Saldo",brl(r.saldo),"tot "+(r.saldo<0?"bad":"good"))}
      ${notes.length?`<ul class="notes">${notes.map(n=>`<li>${n}</li>`).join("")}</ul>`:""}</div></div>`;
}

function form(tab,row){
  const S=SEC[tab];
  return `<div class="fform"><div class="grid2">${S.cols.map(c=>{
    const val=row?c.get(row):c.t==="date"?todayStr():"",at=c.t==="text"?'type="text"':c.t==="date"?'type="date"':c.t==="money"?'type="number" step="0.01" min="0" inputmode="decimal"':'type="number" step="1" min="0" inputmode="numeric"';
    return `<div class="fld" ${c.w?'style="grid-column:1/-1"':""}><label for="ff_${c.k}">${c.l}${c.opt?" (opcional)":""}</label><input id="ff_${c.k}" ${at} value="${esc(val==null?"":val)}"></div>`}).join("")}</div>
  <div class="frow"><button class="btn" data-a="finSave">${row?"Salvar":"Adicionar"}</button><button class="btn ghost" data-a="finCancel">Cancelar</button></div>${row?`<button class="lk fdel" data-a="finDel" data-id="${esc(row.id)}">Remover</button>`:""}</div>`;
}

function vContas(){
  const f=F(),tab=ui.tab,S=SEC[tab],rows=f[tab].slice().sort(S.sort),isNew=ui.open===tab+":new";
  return `<div class="top"><div><div class="mu">Lançamentos</div><h1>Contas</h1></div></div>
  <div class="chips">${TABS.map(c=>`<button data-a="finTab" data-t="${c}" class="${c===tab?"on":""}">${SEC[c].l}</button>`).join("")}</div>
  <div class="fhead"><span class="mu">${S.sum(rows)}</span><button class="btn" style="width:auto;padding:10px 16px;font-size:14px;border-radius:12px" data-a="finAdd">＋ Adicionar</button></div>
  ${tab==="sophia"?`<div class="fld" style="margin-bottom:10px"><label for="fr">Reajuste vale a partir de</label><input id="fr" type="month" data-fin="reaj" value="${esc(f.cfg.reajusteMes||"")}"></div>`:""}
  ${isNew?`<div class="card">${form(tab,null)}</div>`:""}
  ${rows.length?`<div class="card flush">${rows.map(r=>{const open=ui.open===tab+":"+r.id;return `<button class="row" data-a="finOpen" data-id="${esc(r.id)}" aria-expanded="${open}"><span class="n"><b ${open?'class="good"':""}>${esc(S.t(r))}</b>${S.s(r)?`<small>${esc(S.s(r))}</small>`:""}</span><b>${S.v(r)}</b></button>${S.prog?`<div class="bar" style="margin:-4px 16px 12px"><i style="width:${Math.round(S.prog(r)*100)}%"></i></div>`:""}${open?`<div style="padding:0 16px 14px">${form(tab,r)}</div>`:""}`}).join("")}</div>`:(isNew?"":`<p class="mu" style="padding:8px 4px">${S.none}</p>`)}`;
}

function vViagem(){
  const f=F(),all=calc(f),t=trip(f,all),c=f.viagem||{};
  const fields=`<div class="fld" style="margin-top:16px"><label for="t_nome">Nome do objetivo</label><input id="t_nome" type="text" maxlength="30" placeholder="Ex.: Viagem, Reserva, Carro" data-fin="nome" value="${esc(c.nome||"")}"></div><div class="grid1" style="margin-top:12px">
    <div class="fld"><label for="t_ini">Começa a poupar em</label><input id="t_ini" type="month" data-fin="ini" value="${esc(c.inicio||"")}"></div>
    <div class="fld"><label for="t_teto">Teto do dia a dia (R$/mês)</label><input id="t_teto" type="number" step="50" min="0" inputmode="decimal" data-fin="teto" value="${esc(c.teto??"")}"></div>
    <div class="fld"><label for="t_mes">Mês do objetivo</label><input id="t_mes" type="month" data-fin="mes" value="${esc(c.mes||"")}"></div>
    <div class="fld"><label for="t_meta">Meta (opcional, R$)</label><input id="t_meta" type="number" step="100" min="0" inputmode="decimal" data-fin="meta" value="${esc(c.meta??"")}"></div></div>`;
  const head=`<div class="top"><div><div class="mu">${t.ti!=null?"Plano de poupança":"Planejamento"}</div><h1>${t.ti!=null?objNome(f)+" · "+MESL[t.ti%12]+" de "+Math.floor(t.ti/12):objNome(f)}</h1></div></div>`;
  if(!t.list)return head+`<div class="card"><div class="mu" style="font-size:14px">${esc(t.msg)}</div>${fields}</div>`;
  const mx=t.meta!=null?(t.base-t.meta)/t.list.length:null;
  const fk=Object.keys(t.free).map(Number).sort((a,b)=>a-b);
  return head+`<div class="card"><div class="lbl" style="margin-top:0">Poupança prevista até ${MESL[(t.ti-1)%12]}</div>
    <div class="fbig ${t.total<0?"bad":"good"}">${brl(t.total)}</div>
    <div class="mu" style="font-size:14px;margin-top:6px">Com teto de ${brl(t.teto)} por mês no dia a dia, de ${lab(t.list[0].m)} a ${lab(t.list[t.list.length-1].m)} (${t.list.length} ${t.list.length>1?"meses":"mês"}). Conta só a entrada fixa.</div>
    ${mx!=null?`<div class="callout">${mx<0?`Só com a entrada fixa, a meta de ${brl(t.meta)} não fecha. O máximo possível, sem gastar nada no dia a dia, é ${brl(t.base)}.`:`Para chegar a ${brl(t.meta)}, o dia a dia pode custar no máximo ${brl(mx)} por mês. ${t.total>=t.meta?"Com o teto atual, você chega lá.":"Com o teto atual, faltam "+brl(t.meta-t.total)+"."}`}</div>`:""}
    ${t.pendN>0?`<p class="mu" style="font-size:13px;margin:10px 0 0">Até ${lab(t.ini-1)} nada é poupado: sobram ${brl(t.pend)} para as pendências, já descontando os variáveis lançados.</p>`:""}
    ${fields}
    <details><summary>Quanto separar por mês</summary><div class="tri"><span class="mu">Mês</span><span class="mu r">Separar</span><span class="mu r">Acumulado</span>${t.list.map(x=>`<span>${lab(x.m)}</span><span class="r ${x.sep<0?"bad":""}">${brl(x.sep)}</span><span class="r">${brl(x.acc)}</span>`).join("")}</div><p class="mu" style="font-size:13px">Separe no dia em que o dinheiro entra, antes de gastar. O valor sobe sozinho quando uma parcela acaba.</p></details>
    <details><summary>Parcelas que acabam e liberam dinheiro</summary>${fk.length?fk.map(k=>`<div class="fl"><span class="mu">${lab(k)} · ${esc(t.free[k].n.join(", "))}</span><b class="good">+${brl(t.free[k].v)}</b></div>`).join(""):`<p class="mu" style="font-size:13px">Nenhuma parcela termina antes do mês do objetivo.</p>`}</details></div>`;
}

function vImport(){
  return `<h1>Importar finanças</h1><p class="mu" style="font-size:13px;margin:4px 0 16px">Cole aqui o texto do arquivo <b>financeiro.json</b> gerado a partir do Controle Financeiro. Isso substitui as listas de finanças que já estão no app.</p>
  <div class="fld"><label for="fi_txt">Conteúdo do arquivo</label><textarea id="fi_txt" rows="8" placeholder='{"entradas":[...],"parcelas":[...]}' autocapitalize="off" spellcheck="false"></textarea></div>
  <div style="height:14px"></div><button class="btn" data-a="finImp">Importar</button>`;
}

/* ---------- Ações ---------- */
function commit(){ctx.save();ctx.queueState();ctx.render()}
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
  const rj=j.cfg&&j.cfg.reajusteMes;out.cfg.reajusteMes=/^\d{4}-\d{2}$/.test(rj||"")?rj:null;
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
    if(k==="nome")f.viagem.nome=v.trim().slice(0,30);
    else if(k==="teto")f.viagem.teto=isFinite(x)&&x>=0?x:0;
    else if(k==="mes"){if(v)f.viagem.mes=v}
    else if(k==="ini")f.viagem.inicio=v||null;
    else if(k==="meta")f.viagem.meta=isFinite(x)&&x>0?x:null;
    else if(k==="reaj")f.cfg.reajusteMes=v||null;
    commit();
  });
  return{
    finSel:d=>{ui.sel=+d.i;ctx.render()},
    finTab:d=>{if(SEC[d.t]){ui.tab=d.t;ui.open=null;ctx.render()}},
    finAdd:()=>{ui.open=ui.open===ui.tab+":new"?null:ui.tab+":new";ctx.render()},
    finOpen:d=>{const k=ui.tab+":"+d.id;ui.open=ui.open===k?null:k;ctx.render()},
    finCancel:()=>{ui.open=null;ctx.render()},
    finSave:()=>{
      const S=SEC[ui.tab],doc={};let ok=true;
      S.cols.forEach(c=>{const el=document.getElementById("ff_"+c.k),v=parse(c,el?el.value:"");if(!valid(c,v)){ok=false;return}Object.assign(doc,c.set(v))});
      if(!ok)return ctx.toast("Preencha os campos com valores válidos");
      const L=F()[ui.tab];
      if(ui.open===ui.tab+":new")L.push({id:ctx.uid(),...doc});
      else{const r=L.find(x=>x.id===ui.open.split(":").slice(1).join(":"));if(!r)return;Object.assign(r,doc)}
      ui.open=null;commit();
    },
    finDel:d=>{if(!confirm("Remover este item?"))return;const f=F();f[ui.tab]=f[ui.tab].filter(x=>x.id!==d.id);ui.open=null;commit()},
    finImp:()=>importText(document.getElementById("fi_txt").value)
  };
}
window.Fin={objNome,importText,actions,norm,blank,mesAtual,homeSum,vResumo,vContas,vViagem,vImport,brl};
})();
