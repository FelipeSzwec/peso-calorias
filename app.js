"use strict";
(()=>{
const CFG=window.APP_CONFIG||{};
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt=(n,d=0)=>(+n).toLocaleString("pt-BR",{minimumFractionDigits:d,maximumFractionDigits:d});
const num=v=>{const x=parseFloat(String(v??"").replace(",","."));return isNaN(x)?null:x};
const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const norm=s=>String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim();
const uid=()=>crypto.randomUUID();
const nowISO=()=>new Date().toISOString();
const toast=t=>{const e=$("#toast");e.textContent=t;e.classList.add("on");clearTimeout(toast.t);toast.t=setTimeout(()=>e.classList.remove("on"),2600)};

/* ---------- Estado local (offline primeiro) ---------- */
const KEY="pc3";
const DEF={onboarded:false,profile:null,settings:{meals:["1ª refeição","2ª refeição","3ª refeição","4ª refeição"],pinHash:null,pinSalt:null,lembrete:false,wifi:false,plan:{dias:4,min:60,int:1},semIni:1},customFoods:[],entries:[],days:{},outbox:[],last:null,session:null,usage:{},imported:{},localOnly:false,dieta:null};
let S;
try{S=JSON.parse(localStorage.getItem(KEY)||"{}")}catch(e){S={}}
S={...structuredClone(DEF),...S};S.settings={...DEF.settings,...S.settings,plan:{...DEF.settings.plan,...(S.settings||{}).plan}};
const save=()=>{try{localStorage.setItem(KEY,JSON.stringify(S))}catch(e){toast("Sem espaço para salvar no aparelho")}};
const rowKey=(t,r)=>t==="days"?r.date:t==="user_state"?"s":r.id;
function queue(t,row,quiet){const k=rowKey(t,row);S.outbox=S.outbox.filter(o=>!(o.t===t&&o.k===k));S.outbox.push({t,k,row});if(!quiet){save();Cloud.sync()}}
const stateRow=()=>{const{pinHash,pinSalt,...st}=S.settings;return{profile:S.profile,settings:st,customFoods:S.customFoods,dieta:S.dieta}};
const queueState=()=>{if(S.profile)queue("user_state",stateRow())};

/* ---------- Nuvem (Supabase: login + RLS) ---------- */
const stat={ok:false,t:"Neste aparelho"};
const Cloud={
  on:()=>/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(CFG.supabaseUrl||"")&&!!CFG.supabaseKey,
  h(tok){return{apikey:CFG.supabaseKey,Authorization:"Bearer "+(tok||CFG.supabaseKey),"Content-Type":"application/json"}},
  async auth(path,body){const r=await fetch(CFG.supabaseUrl+"/auth/v1/"+path,{method:"POST",headers:this.h(),body:JSON.stringify(body)});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.msg||j.error_description||j.message||"Falha no login");return j},
  setSession(j){if(!j.access_token)return false;S.session={at:j.access_token,rt:j.refresh_token,exp:Date.now()+(j.expires_in||3600)*1000,uid:j.user.id,email:j.user.email};save();return true},
  async signIn(e,p){return this.setSession(await this.auth("token?grant_type=password",{email:e,password:p}))},
  async signUp(e,p){return this.setSession(await this.auth("signup",{email:e,password:p}))},
  async token(){const s=S.session;if(!s)throw new Error("sem sessão");if(s.exp-Date.now()<60000){try{this.setSession(await this.auth("token?grant_type=refresh_token",{refresh_token:s.rt}))}catch(e){S.session=null;save();throw e}}return S.session.at},
  async rest(method,path,body,extra){const r=await fetch(CFG.supabaseUrl+"/rest/v1/"+path,{method,headers:{...this.h(await this.token()),...extra},body:body?JSON.stringify(body):undefined});if(!r.ok)throw new Error("HTTP "+r.status);return method==="GET"?r.json():null},
  busy:false,
  async sync(){
    if(!this.on()||!S.session||!navigator.onLine||this.busy)return;
    if(S.settings.wifi&&navigator.connection&&navigator.connection.type==="cellular")return;
    this.busy=true;
    try{
      const u=S.session.uid,sent=[...S.outbox],by=t=>sent.filter(o=>o.t===t).map(o=>o.row);
      const conf={entries:"id",days:"user_id,date",user_state:"user_id"};
      const map={
        entries:r=>({id:r.id,user_id:u,date:r.date,meal:r.meal,food_name:r.name,qty:r.qty,unit:r.unit,kcal:r.k,p:r.p,c:r.c,g:r.g,deleted:!!r.deleted}),
        days:r=>({user_id:u,date:r.date,tipo:r.tipo||"",treino:r.treino||"",peso:r.peso??null,gasto:r.gasto??null}),
        user_state:r=>({user_id:u,data:r})};
      for(const t of ["entries","days","user_state"]){const rows=by(t).map(map[t]);for(let i=0;i<rows.length;i+=400)await this.rest("POST",`${t}?on_conflict=${conf[t]}`,rows.slice(i,i+400),{Prefer:"resolution=merge-duplicates,return=minimal"})}
      S.outbox=S.outbox.filter(o=>!sent.includes(o));
      await this.pull();
      setStat(true,"Sincronizado");
    }catch(e){setStat(false,S.session?"Sem sincronia":"Entre na conta");if(!S.session&&needLogin()&&view!=="login"){view="login";render()}}
    finally{this.busy=false;save()}
  },
  async pull(){
    const q=S.last?`&updated_at=gt.${encodeURIComponent(S.last)}`:"";
    const[en,dy,us]=await Promise.all([this.rest("GET",`entries?select=*&order=updated_at.asc${q}`),this.rest("GET",`days?select=*&order=updated_at.asc${q}`),this.rest("GET",`user_state?select=*${q}`)]);
    const pend=new Set(S.outbox.map(o=>o.t+o.k));let max=S.last||"";
    for(const r of en){if(r.updated_at>max)max=r.updated_at;if(pend.has("entries"+r.id))continue;
      const e={id:r.id,date:r.date,meal:r.meal,name:r.food_name,qty:+r.qty,unit:r.unit,k:+r.kcal,p:+r.p,c:+r.c,g:+r.g,deleted:r.deleted};
      const i=S.entries.findIndex(x=>x.id===e.id);i<0?S.entries.push(e):S.entries[i]=e}
    for(const r of dy){if(r.updated_at>max)max=r.updated_at;if(pend.has("days"+r.date))continue;
      S.days[r.date]={tipo:r.tipo,treino:r.treino,peso:r.peso==null?null:+r.peso,gasto:r.gasto==null?null:+r.gasto}}
    for(const r of us){if(r.updated_at>max)max=r.updated_at;if(pend.has("user_states")||!r.data)continue;
      const d=r.data;if(d.profile){S.profile=d.profile;S.onboarded=true}
      if(d.settings)S.settings={...S.settings,...d.settings,pinHash:S.settings.pinHash,pinSalt:S.settings.pinSalt};
      if(d.customFoods)S.customFoods=d.customFoods;
      if(d.dieta!==undefined)S.dieta=d.dieta}
    if(max)S.last=max;
    if(!$(".scroll input:focus"))render();
  },
  queueAll(){S.entries.forEach(e=>queue("entries",e));Object.entries(S.days).forEach(([date,d])=>queue("days",{date,...d}));queueState()}
};
function setStat(ok,t){stat.ok=ok;stat.t=t;const c=$(".chip");if(c)c.innerHTML=`<i class="dot ${ok?"ok":""}"></i>${esc(t)}`}

/* ---------- PIN local (trava de tela; a proteção dos dados na nuvem é o login) ---------- */
const b64=a=>btoa(String.fromCharCode(...new Uint8Array(a)));
async function hashPin(pin,salt){const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(pin),"PBKDF2",false,["deriveBits"]);return b64(await crypto.subtle.deriveBits({name:"PBKDF2",salt:Uint8Array.from(atob(salt),c=>c.charCodeAt(0)),iterations:200000,hash:"SHA-256"},k,256))}
async function storePin(pin){const salt=b64(crypto.getRandomValues(new Uint8Array(16)));S.settings.pinSalt=salt;S.settings.pinHash=await hashPin(pin,salt);save()}
let fails=0,blockedUntil=0;

/* ---------- Alimentos e cálculos ---------- */
let BASE=[];
const foods=()=>BASE.concat(S.customFoods);
const day=d=>S.days[d]||(S.days[d]={tipo:"",treino:"",peso:null,gasto:null});
const ents=d=>S.entries.filter(e=>e.date===d&&!e.deleted);
const sum=l=>l.reduce((a,e)=>({k:a.k+e.k,p:a.p+e.p,c:a.c+e.c,g:a.g+e.g}),{k:0,p:0,c:0,g:0});
function calcGasto(){const p=S.profile;if(!p)return null;const tmb=10*p.peso+6.25*p.alt-5*p.idade+(p.sexo==="f"?-161:5),rest=tmb*1.2,pl=S.settings.plan,MET=[4.5,6,8][pl.int],extra=pl.dias>0?(MET-1)*p.peso*pl.min/60:0;return{tmb,rest,trein:rest+extra,extra,peso:p.peso}}
function metaFor(tipo){const c=calcGasto(),pm=S.dieta&&S.dieta.metas,pk=pm&&(pm[tipo==="Treino"?"treino":"descanso"]||pm.treino||pm.descanso);
  if(pk&&pk.k>0){const g=pk.gasto>0?pk.gasto:c?(tipo==="Treino"?c.trein:c.rest):0;return{k:Math.round(pk.k),p:Math.round(pk.p),c:Math.round(pk.c),g:Math.round(pk.g),gasto:Math.round(g),plano:true}}
  if(!c)return{k:0,p:0,c:0,g:0,gasto:0};const gasto=tipo==="Treino"?c.trein:c.rest,k=Math.round(gasto+[-400,0,300][S.profile.goal||0]),p=Math.round(1.8*c.peso),g=Math.round(.9*c.peso);return{k,p,g,c:Math.max(0,Math.round((k-4*p-9*g)/4)),gasto:Math.round(gasto)}}
function search(q){
  const tk=norm(parseQ(q).name).split(" ").filter(Boolean);
  const use=f=>S.usage[f.n]||0;
  if(!tk.length)return foods().sort((a,b)=>use(b)-use(a)||a.n.localeCompare(b.n)).slice(0,12);
  return foods().map(f=>{f._n=f._n||norm(f.n);const ws=f._n.split(" ");if(!tk.every(t=>ws.some(w=>w.startsWith(t))))return null;return{f,s:Math.min(use(f),10)*.6-f.n.length/60+(f._n.startsWith(tk[0])?1:0)}}).filter(Boolean).sort((a,b)=>b.s-a.s).slice(0,12).map(x=>x.f);
}
function parseQ(t){const m=t.trim().match(/^(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l|un\w*)?\s*(?:de\s+)?(.+)$/i);if(!m)return{q:null,name:t.trim()};let q=num(m[1]);const u=(m[2]||"").toLowerCase();if(u==="kg"||u==="l")q*=1000;return{q,name:m[3]}}

/* ---------- Navegação e estado de tela ---------- */
const today=()=>iso(new Date());
const needLogin=()=>Cloud.on()&&!S.session&&!S.localOnly;
let view=needLogin()?"login":S.onboarded?"hoje":"onb",cur=today(),meal=0,draft=[],rng=1,hrng=1,pinBuf="",locked=!!S.settings.pinHash,q="";
let ob={step:0,goal:0,sexo:"m",nome:"",idade:"",alt:"",peso:"",email:"",pw:""};
const MAIN=["hoje","lancar","peso","ajustes"],SUB={hist:"ajustes",calc:"ajustes",cad:"ajustes",conta:"ajustes",setpin:"ajustes"};
const go=v=>{view=v;pinBuf="";render()};

const nav=()=>`<nav>${[["hoje","Hoje"],["lancar","Lançar"],["peso","Peso"],["ajustes","Ajustes"]].map(([k,n])=>`<button data-a="go" data-v="${k}" class="${view===k?"on":""}"><i></i>${n}</button>`).join("")}</nav>`;
const page=(body,{back}={})=>`<div class="scroll">${back?`<button class="back" data-a="go" data-v="${back}">‹ Voltar</button>`:""}${body}</div>${back?"":nav()}`;
const pad=()=>`<div class="pins">${[0,1,2,3].map(i=>`<i class="${i===pinBuf.length?"cur":""}">${pinBuf[i]?"●":""}</i>`).join("")}</div><div class="keys">${["1","2","3","4","5","6","7","8","9","","0","⌫"].map(k=>k?`<button data-a="key" data-k="${k}" aria-label="${k}">${k}</button>`:"<span></span>").join("")}</div>`;
const field=(id,label,val="",ph="",extra="")=>`<div class="fld"><label for="${id}">${label}</label><input id="${id}" value="${esc(val)}" placeholder="${esc(ph)}" ${extra}></div>`;

/* ---------- Telas ---------- */
function vOnb(){
  const s=ob.step,GOALS=[["Perder peso","Déficit calórico moderado"],["Manter o peso","Comer o que você gasta"],["Ganhar massa","Superávit com proteína alta"]];
  let body;
  if(s===0)body=`<div class="logo">P</div><div class="hero">Controle de peso e calorias, sem complicação.</div><p class="mu">Lance refeições em segundos, acompanhe sua evolução e use mesmo sem internet.</p><div class="lbl">Qual é o seu objetivo?</div>${GOALS.map((g,i)=>`<button class="pick ${ob.goal===i?"on":""}" data-a="goal" data-i="${i}">${g[0]}<small>${g[1]}</small></button>`).join("")}`;
  else if(s===1)body=`<div class="hero" style="font-size:30px">Conte um pouco sobre você</div><p class="mu">Usamos esses dados só para calcular o seu gasto calórico.</p><div class="grid2">${field("o_nome","Nome",ob.nome,"Como quer ser chamado",'maxlength="30" autocomplete="given-name"').replace('class="fld"','class="fld" style="grid-column:1/-1"')}${field("o_idade","Idade",ob.idade,"anos",'inputmode="numeric"')}${field("o_alt","Altura (cm)",ob.alt,"",'inputmode="numeric"')}${field("o_peso","Peso (kg)",ob.peso,"",'inputmode="decimal"')}<div class="fld"><label>Sexo</label><div class="seg"><button data-a="sexo" data-s="m" class="${ob.sexo==="m"?"on":""}">M</button><button data-a="sexo" data-s="f" class="${ob.sexo==="f"?"on":""}">F</button></div></div></div>`;
  else body=`<div class="hero" style="font-size:30px">Proteja seus dados</div><p class="mu">${Cloud.on()?"Crie uma conta para guardar tudo na nuvem e defina um PIN para abrir o app.":"A nuvem não está configurada: os dados ficam só neste aparelho. Defina um PIN para abrir o app."}</p>${Cloud.on()?`${field("o_email","E-mail",ob.email,"voce@email.com",'type="email" autocomplete="email" autocapitalize="off"')}<div style="height:10px"></div>${field("o_pw","Senha (mín. 8 caracteres)",ob.pw,"",'type="password" autocomplete="new-password"')}`:""}<div class="lbl">PIN de 4 dígitos</div>${pad()}`;
  const last=s===2;
  return `<div class="scroll" style="display:flex;flex-direction:column"><div class="steps">${[0,1,2].map(i=>`<i class="${i<=s?"on":""}"></i>`).join("")}</div><div style="flex:1">${body}</div><button class="btn" style="margin-top:20px" data-a="obNext">${last?(Cloud.on()?"Criar conta e entrar":"Começar"):"Continuar"}</button>${last&&Cloud.on()?`<button class="lk" data-a="obLocal">Usar só neste aparelho</button>`:s>0?`<button class="lk" data-a="obBack">Voltar</button>`:Cloud.on()?`<button class="lk" data-a="toLogin">Já tenho conta</button>`:""}</div>`;
}
function vLock(){return `<div class="lock"><div class="logo" style="margin:0 auto 18px">P</div><h1>Digite seu PIN</h1><p class="mu" id="lockMsg">${Date.now()<blockedUntil?"Muitas tentativas. Aguarde um pouco.":"&nbsp;"}</p>${pad()}</div>`}
function vHoje(){
  const D=day(cur),tipo=D.tipo||"Descanso",m=metaFor(tipo),es=ents(cur),t=sum(es),pct=m.k?Math.min(1,t.k/m.k):0,falta=m.k-t.k,dt=new Date(cur+"T12:00:00");
  return page(`<div class="top"><div><div class="mu">${cur===today()?"Hoje, ":""}${dt.toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long"})}</div><h1>Olá, ${esc(S.profile?.nome||"")}</h1></div><span class="chip"><i class="dot ${stat.ok?"ok":""}"></i>${esc(stat.t)}</span></div>
  <div class="dnav"><button data-a="day" data-n="-1" aria-label="Dia anterior">‹</button><div class="seg"><button data-a="tipo" data-t="Descanso" class="${tipo==="Descanso"?"on":""}">Descanso</button><button data-a="tipo" data-t="Treino" class="${tipo==="Treino"?"on":""}">Treino</button></div><button data-a="day" data-n="1" aria-label="Próximo dia" ${cur>=today()?"disabled style='opacity:.3'":""}>›</button></div>
  <div class="card" style="padding:22px 18px;text-align:center"><div class="ring"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" fill="none" stroke="var(--ln)" stroke-width="9"/><circle cx="60" cy="60" r="52" fill="none" stroke="${falta<0?"var(--bad)":"var(--ac)"}" stroke-width="9" stroke-linecap="round" stroke-dasharray="${(pct*326.7).toFixed(1)} 326.7" transform="rotate(-90 60 60)"/></svg><div><b>${fmt(t.k)}</b><small>de ${fmt(m.k)} kcal</small></div></div><div class="${falta<0?"bad":"good"}" style="margin-top:12px;font-weight:600;font-size:14px">${m.k?(falta>=0?`Faltam ${fmt(falta)} kcal`:`Passou ${fmt(-falta)} kcal`):"Defina seus dados em Ajustes"}</div>${m.plano?'<div class="mu" style="font-size:11px;margin-top:4px">Meta do seu plano alimentar</div>':""}</div>
  <div class="grid3">${[["Proteína","p"],["Carbo","c"],["Gordura","g"]].map(([n,f])=>`<div class="mini"><small>${n}</small><b>${fmt(t[f])}</b><small style="display:inline"> g</small><div class="bar"><i style="width:${m[f]?Math.min(100,t[f]/m[f]*100):0}%"></i></div>${m[f]?`<small class="${m[f]>=t[f]?"mu":"bad"}" style="display:block;margin-top:6px">${m[f]>=t[f]?"faltam "+fmt(m[f]-t[f]):"passou "+fmt(t[f]-m[f])} g</small>`:""}</div>`).join("")}</div>
  <div class="card" style="margin-top:12px"><div class="fld"><label for="gw">Gasto do dia (Apple Watch)</label><div class="row" style="border:0;padding:0"><input id="gw" inputmode="numeric" value="${D.gasto||""}" placeholder="Estimado: ${fmt(m.gasto)} kcal"><button class="btn" style="width:auto;padding:14px 20px" data-a="saveGasto">Salvar</button></div></div><div class="mu" style="font-size:12px;margin-top:8px">${D.gasto?"Usando o gasto que você informou.":"Sem valor: usando o gasto estimado."} Informe o total do dia (ativas + em repouso) como aparece no app Atividade do relógio.</div></div>
  <h2>Refeições</h2><div class="card flush">${S.settings.meals.map((ml,i)=>{const l=es.filter(e=>e.meal===ml),k=sum(l).k;return`<button class="row" data-a="meal" data-i="${i}"><span class="ck ${l.length?"on":""}">${l.length?"✓":""}</span><span class="n"><b>${esc(ml)}</b><small>${l.length?`${l.length} ${l.length>1?"itens":"item"}`:"Não lançado"}</small></span><b>${l.length?fmt(k):"+"}</b></button>`}).join("")}</div>
  ${weekSummary()}`);
}
function weekSummary(){
  const dias=week(),hj=today();let tk=0,tg=0,n=0;
  const cells=dias.map(d=>{const k=sum(ents(d)).k,D=day(d),has=d<=hj&&k>0;let s=null;
    if(has){const g=D.gasto||metaFor(D.tipo||"Descanso").gasto;if(g){s=g-k;if(d<hj){tg+=g;tk+=k;n++}}}
    const lab=has&&s!=null?(d<hj?(s>0?"−":"+")+fmt(Math.abs(s)):"hoje"):"&nbsp;";
    return`<button class="wd ${d===cur?"cur":""}${has?"":" vz"}" data-a="pick" data-d="${d}"><small>${["dom","seg","ter","qua","qui","sex","sáb"][new Date(d+"T12:00:00").getDay()]}</small><b>${has?fmt(k):"—"}</b><i class="${s==null||d===hj?"mu":s>0?"bad":"good"}">${lab}</i></button>`}).join("");
  const res=tg-tk,dm=d=>d.slice(8)+"/"+d.slice(5,7);
  return`<h2>Semana <span class="mu" style="font-weight:400;font-size:13px">${dm(dias[0])} a ${dm(dias[6])}</span></h2><div class="card"><div class="wk">${cells}</div>${n?`<div class="wt"><span class="good">Calorias consumidas</span><b class="good">${fmt(tk)} kcal</b><span class="bad">Calorias gastas</span><b class="bad">${fmt(tg)} kcal</b><span class="${res>0?"bad":"good"}">Saldo calórico</span><b class="${res>0?"bad":"good"}">${res>0?"−":"+"}${fmt(Math.abs(res))} kcal</b></div>`:'<p class="mu" style="font-size:12px;margin:10px 0 0">Os totais aparecem quando houver dias fechados na semana.</p>'}</div>`;
}
function week(){const d=new Date(cur+"T12:00:00"),dif=(d.getDay()-S.settings.semIni+7)%7;d.setDate(d.getDate()-dif);return Array.from({length:7},(_,i)=>{const x=new Date(d);x.setDate(d.getDate()+i);return iso(x)})}
function foodList(){return search(q).map(f=>{const p=parseQ(q);return`<button class="food" data-a="add" data-n="${esc(f.n)}"><span class="n">${esc(f.n)}<small>${f.por===100&&f.u!=="unid"?"100 "+f.u:f.por+" "+f.u} · P ${fmt(f.p,1)} C ${fmt(f.c,1)} G ${fmt(f.f,1)}</small></span><span class="k">${fmt(f.k)}</span><span class="ck on">＋</span></button>`}).join("")||`<p class="mu">Nada encontrado.</p><button class="btn ghost" data-a="newFood">＋ Cadastrar “${esc(parseQ(q).name)}”</button>`}
const tipoDia=()=>(day(cur).tipo||"Descanso")==="Treino"?"treino":"descanso";
function planBox(){
  const r=planRefs(tipoDia())[meal];if(!r||!r.itens.length)return"";
  return`<div class="lbl">Seu plano · ${esc(r.nome)}</div><div class="card flush">${r.itens.map((it,i)=>`<button class="row" data-a="addPlan" data-i="${i}"><span class="n"><b>${esc(it.n)}</b><small>${fmt(it.q)} ${un(it.u)} · P ${fmt(it.p,1)} C ${fmt(it.c,1)} G ${fmt(it.g,1)}</small></span><b>${fmt(it.k)}</b></button>`).join("")}</div><button class="btn ghost" style="margin-bottom:6px" data-a="planAll">＋ Lançar tudo do plano</button>`}
function vLancar(){
  const ml=S.settings.meals[meal],done=ents(cur).filter(e=>e.meal===ml),t=draft.reduce((a,x)=>a+x.f.k*x.q/x.f.por,0);
  return page(`<h1 style="margin-bottom:14px">Lançar</h1><div class="chips">${S.settings.meals.map((m,i)=>`<button data-a="meal" data-i="${i}" data-stay="1" class="${i===meal?"on":""}">${esc(m)}</button>`).join("")}</div>
  ${planBox()}
  <input id="q" value="${esc(q)}" placeholder="Buscar ou digitar “200 g de arroz”" autocomplete="off" enterkeyhint="search">
  ${done.length?`<div class="lbl">Já lançado em ${esc(ml)}</div><div class="card flush">${done.map(e=>`<div class="dq"><span class="n">${esc(e.name)}<br><small class="mu">${fmt(e.qty)} ${e.unit==="unid"?"un":e.unit} · ${fmt(e.k)} kcal</small></span><button data-a="del" data-id="${e.id}" aria-label="Remover">✕</button></div>`).join("")}</div>`:""}
  ${draft.length?`<div class="lbl">Montando</div><div class="card flush">${draft.map((x,i)=>`<div class="dq"><span class="n">${esc(x.f.n)}</span><input data-di="${i}" value="${x.q}" inputmode="decimal" aria-label="Quantidade"><span class="mu" style="width:24px">${x.f.u==="unid"?"un":x.f.u}</span><button data-a="rm" data-i="${i}" aria-label="Remover">✕</button></div>`).join("")}</div>`:""}
  <div class="lbl">${q?"Resultados":"Mais usados"}</div><div id="res">${foodList()}</div>
  ${draft.length?`<div class="sticky"><div class="in"><span>${draft.length} ${draft.length>1?"itens":"item"} · ${fmt(t)} kcal</span><button data-a="saveDraft">Salvar refeição</button></div></div>`:""}`);
}
function vPeso(){
  const N=[7,30,90][rng],lim=new Date();lim.setDate(lim.getDate()-N);
  const all=Object.entries(S.days).filter(([,d])=>d.peso).sort((a,b)=>a[0]<b[0]?-1:1),pts=all.filter(([d])=>d>=iso(lim));
  let chart='<p class="mu">Registre o peso em 2 dias para ver o gráfico.</p>',big="—",pill="";
  if(all.length){const last=all[all.length-1][1].peso,first=all[0][1].peso,dif=last-first;big=fmt(last,1);pill=`${dif>0?"+":dif<0?"−":""}${fmt(Math.abs(dif),1)} kg · ${dif>0?"+":dif<0?"−":""}${fmt(Math.abs(dif/first*100),1)}%`}
  if(pts.length>1){const v=pts.map(p=>p[1].peso),mn=Math.min(...v)-.4,mx=Math.max(...v)+.2,t0=new Date(pts[0][0]).getTime(),t1=new Date(pts[pts.length-1][0]).getTime()||1;
    const xy=pts.map(([d,x])=>[(new Date(d).getTime()-t0)/(t1-t0||1)*300,120-(x.peso-mn)/(mx-mn)*110]),line="M"+xy.map(p=>p[0].toFixed(1)+" "+p[1].toFixed(1)).join(" L");
    chart=`<svg viewBox="0 0 300 130" width="100%" style="overflow:visible;margin-top:12px" role="img" aria-label="Gráfico de peso"><g stroke="var(--ln)" stroke-dasharray="3 4"><line x1="0" y1="30" x2="300" y2="30"/><line x1="0" y1="75" x2="300" y2="75"/><line x1="0" y1="120" x2="300" y2="120"/></g><path d="${line} L300 130 L0 130 Z" fill="var(--ac)" opacity=".12"/><path d="${line}" fill="none" stroke="var(--ac)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/><circle cx="300" cy="${xy[xy.length-1][1].toFixed(1)}" r="5" fill="var(--ac)"/></svg>`}
  const D=day(today());
  return page(`<h1 style="margin-bottom:14px">Evolução</h1><div class="card"><div class="big"><b>${big}</b><span class="mu">kg</span>${pill?`<span class="pill">${pill}</span>`:""}</div>${chart}<div class="seg" style="margin-top:12px">${["7 dias","30 dias","90 dias"].map((n,i)=>`<button data-a="rng" data-i="${i}" class="${rng===i?"on":""}">${n}</button>`).join("")}</div></div>
  <div class="card"><div class="fld"><label for="pw">Peso de hoje (kg)</label><div class="row" style="border:0;padding:0"><input id="pw" inputmode="decimal" value="${D.peso?fmt(D.peso,1):""}" placeholder="Ex.: 82,4"><button class="btn" style="width:auto;padding:14px 20px" data-a="savePeso">Salvar</button></div></div></div>`);
}
function vHist(){
  const N=[7,14,30][hrng],rows=[];
  for(let i=0;i<N;i++){const dt=new Date();dt.setDate(dt.getDate()-i);const d=iso(dt),es=ents(d);if(!es.length)continue;const D=day(d),k=sum(es).k,m=metaFor(D.tipo||"Descanso");rows.push({d,k,m,gasto:D.gasto||m.gasto,dt})}
  const avg=rows.length?rows.reduce((a,r)=>a+r.k,0)/rows.length:0,ok=rows.filter(r=>Math.abs(r.k-r.m.k)<=150).length,bal=rows.reduce((a,r)=>a+(r.k-r.gasto),0);
  return page(`<h1 style="margin-bottom:12px">Histórico</h1><div class="chips">${["7 dias","14 dias","30 dias"].map((n,i)=>`<button data-a="hrng" data-i="${i}" class="${hrng===i?"on":""}">${n}</button>`).join("")}</div>
  <div class="grid3" style="margin-bottom:14px"><div class="mini"><small>MÉDIA</small><b>${fmt(avg)}</b></div><div class="mini"><small>NA META</small><b class="good">${ok}/${rows.length}</b></div><div class="mini"><small>SALDO</small><b class="${bal>0?"good":"bad"}">${bal>0?"+":"−"}${fmt(Math.abs(bal))}</b></div></div>
  <div class="card flush">${rows.map(r=>{const near=Math.abs(r.k-r.m.k)<=150,s=r.gasto-r.k;return`<div class="hrow"><div style="width:44px"><b>${r.d.slice(8)}/${r.d.slice(5,7)}</b><div class="mu" style="font-size:11px">${r.dt.toLocaleDateString("pt-BR",{weekday:"short"})}</div></div><div class="hbar"><div><i style="width:${Math.min(100,r.k/3000*100)}%;background:${near?"var(--ac)":"var(--bad)"}"></i></div><small>${near?"Dentro da meta":r.k>r.m.k?"Acima da meta":"Abaixo da meta"}</small></div><div style="text-align:right"><b>${fmt(r.k)} kcal</b><div class="${s>0?"bad":"good"}" style="font-size:11px;font-weight:600">${s>0?"−":"+"}${fmt(Math.abs(s))}</div></div></div>`}).join("")||'<p class="mu" style="padding:16px">Nenhum dia lançado neste período.</p>'}</div>`,{back:"ajustes"});
}
function vCalc(){
  const c=calcGasto(),pl=S.settings.plan;if(!c)return page(`<p>Preencha o cadastro primeiro.</p><button class="btn" data-a="go" data-v="cad">Abrir cadastro</button>`,{back:"ajustes"});
  return page(`<h1>Gasto calórico</h1><p class="mu" style="margin:4px 0 16px;font-size:13px">Conte como é o seu treino e o app calcula quanto você gasta por dia.</p>
  <div class="card"><div class="mu" style="font-size:12px;margin-bottom:8px">Treinos por semana</div><div class="days">${[0,1,2,3,4,5,6,7].map(n=>`<button data-a="plan" data-k="dias" data-v="${n}" class="${pl.dias===n?"on":""}">${n}</button>`).join("")}</div>
  <div class="mu" style="font-size:12px;margin:16px 0 8px">Minutos por treino</div><div class="row" style="border:0;padding:0"><button class="back" style="margin:0;width:44px;height:44px" data-a="min" data-n="-10">−</button><div style="flex:1;text-align:center;font-size:24px;font-weight:700">${pl.min} <small class="mu" style="font-size:13px;font-weight:400">min</small></div><button class="back" style="margin:0;width:44px;height:44px" data-a="min" data-n="10">＋</button></div>
  <div class="mu" style="font-size:12px;margin:16px 0 8px">Intensidade</div><div class="seg">${["Leve","Moderada","Intensa"].map((n,i)=>`<button data-a="plan" data-k="int" data-v="${i}" class="${pl.int===i?"on":""}">${n}</button>`).join("")}</div></div>
  <div class="grid2"><div class="mini"><small>DIA DE DESCANSO</small><b style="font-size:26px">${fmt(c.rest)}</b><small>kcal</small></div><div class="mini" style="background:var(--ac);color:var(--acf)"><small style="color:var(--acf)">DIA DE TREINO</small><b style="font-size:26px">${fmt(c.trein)}</b><small style="color:var(--acf)">kcal</small></div></div>
  <div class="card" style="margin-top:12px"><div class="calc"><span>Metabolismo basal</span><b>${fmt(c.tmb)} kcal</b></div><div class="calc"><span>Gasto do treino</span><b>+${fmt(c.extra)} kcal</b></div><div class="calc"><span>${metaFor("Treino").plano?"Meta (plano alimentar)":"Meta ("+["perder","manter","ganhar"][S.profile.goal||0]+" peso)"}</span><b>${fmt(metaFor("Treino").k)} / ${fmt(metaFor("Descanso").k)} kcal</b></div></div>
  <p class="mu" style="font-size:12px;text-align:center">Fórmula de Mifflin-St Jeor. Proteína 1,8 g/kg, gordura 0,9 g/kg, resto em carboidrato. É uma estimativa.</p>`,{back:"ajustes"});
}
function vCad(){
  const p=S.profile||{};
  return page(`<h1>Cadastro</h1><p class="mu" style="margin:4px 0 16px;font-size:13px">Usamos estes dados para calcular o seu gasto calórico.</p><div class="card grid2">${field("c_nome","Nome",p.nome,"",'maxlength="30"').replace('class="fld"','class="fld" style="grid-column:1/-1"')}${field("c_idade","Idade",p.idade,"",'inputmode="numeric"')}${field("c_alt","Altura (cm)",p.alt,"",'inputmode="numeric"')}${field("c_peso","Peso (kg)",p.peso?fmt(p.peso,1):"","",'inputmode="decimal"')}<div class="fld"><label>Sexo</label><div class="seg"><button data-a="sexoC" data-s="m" class="${p.sexo!=="f"?"on":""}">M</button><button data-a="sexoC" data-s="f" class="${p.sexo==="f"?"on":""}">F</button></div></div></div>
  <div class="lbl">Objetivo</div>${["Perder peso","Manter o peso","Ganhar massa"].map((g,i)=>`<button class="pick ${(p.goal||0)===i?"on":""}" data-a="goalC" data-i="${i}">${g}</button>`).join("")}<button class="btn" style="margin-top:10px" data-a="saveCad">Salvar cadastro</button>`,{back:"ajustes"});
}
function vConta(){
  return page(`<h1>Conta</h1>${S.session?`<div class="card"><div class="mu" style="font-size:12px">Conectado como</div><b>${esc(S.session.email)}</b></div><button class="btn ghost" data-a="syncNow">Sincronizar agora</button><button class="lk" data-a="logout" style="display:block;margin:10px auto 0">Sair da conta</button>`:Cloud.on()?`<p class="mu">Entre para sincronizar seus dados entre aparelhos.</p>${field("a_email","E-mail","","voce@email.com",'type="email" autocomplete="email" autocapitalize="off"')}<div style="height:10px"></div>${field("a_pw","Senha (mín. 8 caracteres)","","",'type="password" autocomplete="current-password"')}<div style="height:14px"></div><button class="btn" data-a="login">Entrar</button><button class="btn ghost" style="margin-top:8px" data-a="signup">Criar conta</button>`:`<p class="mu">A nuvem não está configurada. Preencha <b>config.js</b> com os dados do Supabase (veja o README).</p>`}`,{back:"ajustes"});
}
function vLogin(){return `<div class="scroll" style="display:flex;flex-direction:column;justify-content:center"><div class="logo">P</div><div class="hero">Entre na sua conta</div><p class="mu">Seus dados ficam guardados na nuvem e protegidos por login.</p>${field("a_email","E-mail","","voce@email.com",'type="email" autocomplete="email" autocapitalize="off"')}<div style="height:10px"></div>${field("a_pw","Senha","","",'type="password" autocomplete="current-password"')}<div style="height:16px"></div><button class="btn" data-a="login">Entrar</button><button class="btn ghost" style="margin-top:8px" data-a="firstTime">Primeira vez? Criar conta</button><button class="lk" data-a="localOnly">Continuar só neste aparelho</button></div>`}
function vImport(){return page(`<h1>Importar do app antigo</h1><p class="mu" style="font-size:13px;margin:4px 0 16px">Cole o endereço do script (termina em /exec) e o token que estão em Ajustes do app antigo. Lançamentos, peso, treinos e alimentos são copiados. Rodar de novo não duplica.</p>${field("i_url","Endereço do script","","https://script.google.com/macros/s/.../exec",'autocapitalize="off" autocomplete="off"')}<div style="height:10px"></div>${field("i_tok","Token","","",'type="password" autocomplete="off"')}<div style="height:14px"></div><button class="btn" id="i_go" data-a="runImport">Importar</button><p class="mu" id="i_msg" style="margin-top:12px;font-size:13px"></p>`,{back:"ajustes"})}
function vSetPin(){return page(`<h1>Novo PIN</h1><p class="mu">Digite 4 dígitos.</p>${pad()}`,{back:"ajustes"})}
function vAjustes(){
  const tg=(a,on,n,s)=>`<button class="row" data-a="${a}"><span class="n"><b>${n}</b><small>${s}</small></span><span class="tg ${on?"on":""}"></span></button>`;
  const lk=(a,v,n,r="›")=>`<button class="row" data-a="${a}" data-v="${v||""}"><span class="n">${n}</span><span class="mu">${r}</span></button>`;
  const c=calcGasto();
  return page(`<h1 style="margin-bottom:14px">Ajustes</h1><div class="lbl" style="margin-top:0">Segurança</div><div class="card flush">${tg("tgPin",!!S.settings.pinHash,"Bloqueio por PIN","Pede o PIN ao abrir o app")}${tg("tgLem",S.settings.lembrete,"Lembretes de refeição","Avisos às 12:30 e 19:00 com o app aberto")}${tg("tgWifi",S.settings.wifi,"Sincronizar só no Wi-Fi","Economiza dados móveis")}</div>
  <div class="lbl">Metas</div><div class="card flush">${lk("go","plano","Plano alimentar",S.dieta?"importado ›":"›")}${lk("go","calc","Calculadora de gasto",c?fmt(metaFor("Descanso").k)+" kcal ›":"›")}${lk("go","cad","Cadastro",esc(S.profile?.nome||"")+" ›")}</div>
  <div class="lbl">Dados</div><div class="card flush">${lk("go","conta","Conta",esc(S.session?S.session.email:"Neste aparelho")+" ›")}${lk("go","hist","Histórico")}${lk("go","import","Importar do app antigo")}${lk("exportCsv","","Exportar lançamentos (CSV)")}<label class="row" style="cursor:pointer"><span class="n">Importar alimentos (CSV)<small>Colunas: Alimento;Grupo;Unidade;Porção;Kcal;P;C;G</small></span><input type="file" id="csv" accept=".csv,text/csv" hidden><span class="mu">›</span></label>${lk("wipe","","<span class='bad'>Apagar dados deste aparelho</span>")}</div>
  <p class="mu" style="font-size:12px;text-align:center;margin-top:16px">${S.outbox.length?S.outbox.length+" alteração(ões) aguardando envio":"Tudo enviado"} · versão 2.3</p>`);
}

function render(){
  const sc=$(".scroll"),y=sc?sc.scrollTop:0;
  let h;
  if(locked&&S.settings.pinHash)h=vLock();
  else h={onb:vOnb,hoje:vHoje,lancar:vLancar,peso:vPeso,ajustes:vAjustes,login:vLogin,import:vImport,hist:vHist,plano:vPlano,planoimp:vPlanoImp,calc:vCalc,cad:vCad,conta:vConta,setpin:vSetPin}[view]();
  $("#app").innerHTML=h;
  const n=$(".scroll");if(n&&y&&sc)n.scrollTop=y;
}

/* ---------- Ações ---------- */
function readOb(){const g=id=>{const e=$("#"+id);return e?e.value:null};["nome","idade","alt","peso","email","pw"].forEach(k=>{const v=g("o_"+k);if(v!==null)ob[k]=v})}
async function finishOb(local){
  const p={nome:ob.nome.trim().slice(0,30),idade:num(ob.idade),alt:num(ob.alt),peso:num(ob.peso),sexo:ob.sexo,goal:ob.goal};
  if(pinBuf.length!==4)return toast("Defina um PIN de 4 dígitos");
  if(!local&&Cloud.on()){
    if(!/^\S+@\S+\.\S+$/.test(ob.email))return toast("E-mail inválido");
    if(ob.pw.length<8)return toast("A senha precisa de 8 ou mais caracteres");
    try{if(!(await Cloud.signUp(ob.email,ob.pw)))return toast("Confirme o e-mail que enviamos e depois toque em Criar conta de novo")}
    catch(e){
      if(!/already|registered|exist/i.test(e.message))return toast(e.message);
      try{await Cloud.signIn(ob.email,ob.pw)}catch(e2){return toast(/confirm/i.test(e2.message)?"Confirme o e-mail que enviamos e tente de novo":"E-mail já cadastrado. Use a mesma senha da criação da conta")}
    }
  }
  S.profile=p;S.onboarded=true;if(local)S.localOnly=true;await storePin(pinBuf);pinBuf="";locked=false;view="hoje";save();
  S.session?Cloud.queueAll():0;render();
}
const LEGM=["cafe da manha","almoco","refeicao da tarde","jantar"];
function canonMeal(nome){const M=S.settings.meals;if(M.includes(nome))return nome;const n=norm(nome);let i=LEGM.indexOf(n);if(i<0&&/quebra/.test(n))i=0;if(i<0)i=M.length-1;return M[Math.min(i,M.length-1)]}
const clamp=(v,a,b)=>{v=+v;return isNaN(v)?0:Math.max(a,Math.min(b,v))};
async function runImport(url,token,say){
  const get=async p=>{const r=await fetch(url+"?"+new URLSearchParams({token,...p}));let j;try{j=await r.json()}catch(e){throw new Error("resposta inválida do script")}if(!j.ok)throw new Error(j.erro==="token"?"token incorreto":(j.erro||"erro"));return j};
  say("Lendo planilha...");
  const[boot,h]=await Promise.all([get({action:"bootstrap"}),get({action:"hist"})]);
  const pa=(boot.alimentos||[]).filter(f=>f.g==="Plano alimentar"&&f.n),metas=cleanMetas(boot.metas),refs=[];
  for(const f of pa){const m=String(f.n).match(/^\s*(.+?)\s*(?:[-–—:|\/»])\s*(.+)$/),sep=m&&MEALRX.test(norm(m[1])),nome=sep?m[2]:String(f.n),u=/unid|^un/i.test(f.u)?"unid":/ml/i.test(f.u)?"ml":"g";
    const R=refGet(refs,sep?m[1]:"Itens do plano");if(R.itens.length<60)R.itens.push({n:nome.slice(0,80),q:clamp(f.por,.1,10000)||100,u,k:clamp(f.k,0,20000),p:clamp(f.p,0,2000),c:clamp(f.c,0,2000),g:clamp(f.f,0,2000)})}
  const old=S.dieta||{};
  if(metas||refs.length){S.dieta={fonte:"planilha antiga",metas:null,...old,em:nowISO()};if(metas&&!(old.metas&&(old.metas.treino||old.metas.descanso)))S.dieta.metas=metas;
    if(refs.length&&!planRefs("treino").length&&!planRefs("descanso").length)S.dieta.dias={treino:refs.slice(0,10),descanso:structuredClone(refs.slice(0,10))}}
  let fl=(boot.alimentos||[]).filter(f=>f.n).map(f=>({n:String(f.n).slice(0,80),g:String(f.g||"Meus alimentos").slice(0,40),u:/unid|^un/i.test(f.u)?"unid":/ml/i.test(f.u)?"ml":"g",por:clamp(f.por,.1,10000)||100,k:clamp(f.k,0,20000),p:clamp(f.p,0,2000),c:clamp(f.c,0,2000),f:clamp(f.f,0,2000)}));
  if(JSON.stringify(fl).length>120000)fl=fl.filter(f=>f.g==="Meus alimentos"||f.g==="Plano alimentar");
  const names=new Set(fl.map(f=>f.n));S.customFoods=S.customFoods.filter(f=>!names.has(f.n)).concat(fl);
  const dias=h.dias||[];let nd=0,ne=0,i=0;
  for(const d of dias){if(!/^\d{4}-\d{2}-\d{2}$/.test(d.data))continue;const D=S.days[d.data]||(S.days[d.data]={tipo:"",treino:"",peso:null,gasto:null});
    if(!D.tipo&&["Treino","Descanso"].includes(d.tipo))D.tipo=d.tipo;if(!D.treino&&d.treino)D.treino=String(d.treino).slice(0,80);
    if(D.peso==null&&d.peso>20&&d.peso<500)D.peso=+d.peso;if(D.gasto==null&&d.gasto>0&&d.gasto<20000)D.gasto=+d.gasto;
    queue("days",{date:d.data,...D},true);nd++}
  const alvo=dias.filter(d=>d.consumo>0&&!S.imported[d.data]);
  for(const d of alvo){say("Importando lançamentos "+(++i)+" de "+alvo.length+"...");
    const j=await get({action:"dia",data:d.data});
    for(const r of j.refs||[]){if(!r.nome)continue;const e={id:uid(),date:d.data,meal:canonMeal(r.meal||""),name:String(r.nome).slice(0,120),qty:clamp(r.qtd,0,100000),unit:/unid|^un/i.test(r.unid)?"unid":/ml/i.test(r.unid)?"ml":"g",k:clamp(r.k,0,20000),p:clamp(r.p,0,2000),c:clamp(r.c,0,2000),g:clamp(r.g,0,2000),deleted:false};S.entries.push(e);queue("entries",e,true);ne++}
    S.imported[d.data]=1;if(i%10===0)save()}
  queueState();save();Cloud.sync();
  const np=planRefs("treino").reduce((a,r)=>a+r.itens.length,0),nm=S.dieta&&S.dieta.metas?Object.keys(S.dieta.metas).length:0;
  return "Pronto: "+ne+" lançamentos, "+nd+" dias e "+fl.length+" alimentos importados. Plano alimentar: "+nm+" meta(s) e "+np+" item(ns). Volte para Hoje.";
}
/* ---------- Plano alimentar: metas do nutricionista + refeições com quantidades ---------- */
const un=u=>u==="unid"?"un":u;
const UN=(u,d="g")=>{u=norm(u||"");if(!u)return d;if(/^(ml|l|litros?)/.test(u))return"ml";if(/^(g|gr|grs|gramas?|kg)$/.test(u))return"g";return"unid"};
const UNM=u=>/^(kg|l|litros?)$/i.test(u||"")?1000:1;
const MEALRX=/^(\d+ (a |o )?refeicao|refeicao \d+|(primeira|segunda|terceira|quarta|quinta|sexta|setima|oitava) refeicao|cafe da manha|desjejum|lanche( da (manha|tarde|noite))?|almoco|jantar|janta|ceia|pre treino|pos treino|colacao|refeicao( da tarde)?)\b/;
const UNRX="kg|gr?s?|gramas?|ml|l|litros?|unidades?|unid|un|fatias?|colher(?:es)?(?:\\s+de\\s+(?:sopa|ch[aá]|sobremesa))?|x[ií]caras?|copos?|por[cç][aãõo]\\w*|scoops?";
const QRX=new RegExp("^(\\d+(?:[.,]\\d+)?)\\s*(?:("+UNRX+")(?=[\\s.,;:)]|$))?\\s*(?:de\\s+|d[oa]s?\\s+)?(.+)$","i");
const NRX=new RegExp("^(.+?)\\s*[:–—-]?\\s*\\(?(\\d+(?:[.,]\\d+)?)\\s*("+UNRX+")(?=[\\s.,;:)]|$)\\)?\\s*(.*)$","i");
const refGet=(refs,nome)=>{let r=refs.find(x=>norm(x.nome)===norm(nome));if(!r){r={nome:String(nome).trim().slice(0,40)||"Refeição",itens:[]};refs.push(r)}return r};
function findFood(name){const tk=norm(name).split(" ").filter(Boolean);
  for(let n=tk.length;n>0;n--){const t=tk.slice(0,n),m=foods().filter(f=>{f._n=f._n||norm(f.n);const ws=f._n.split(" ");return t.every(x=>ws.some(w=>w.startsWith(x)||(x.length>3&&x.endsWith("s")&&w.startsWith(x.slice(0,-1)))))});if(m.length)return m.sort((a,b)=>a.n.length-b.n.length)[0]}
  return null}
function mkItem(n,mn,q,u,x){
  n=String(n).trim().slice(0,80);const f=findFood(mn||n);let qq=q;
  if(!(qq>0)){if(f){qq=f.por;u=f.u}else qq=0}
  qq=clamp(qq,0,100000);const it={n,q:qq,u,k:0,p:0,c:0,g:0,ok:false};
  if(f&&qq>0&&(f.u===u||(f.u!=="unid"&&u!=="unid"))){const z=qq/f.por;Object.assign(it,{k:+(f.k*z).toFixed(1),p:+(f.p*z).toFixed(1),c:+(f.c*z).toFixed(1),g:+(f.f*z).toFixed(1),ok:true,via:f.n})}
  if(x&&x.k>0){it.k=clamp(x.k,0,20000);it.ok=true;if(x.p!=null)it.p=clamp(x.p,0,2000);if(x.c!=null)it.c=clamp(x.c,0,2000);if(x.g!=null)it.g=clamp(x.g,0,2000)}
  return it}
function cleanMetas(m){const o={};for(const t of["treino","descanso"]){const r=m&&m[t];if(r&&num(r.k)>0)o[t]={k:clamp(r.k,0,20000),p:clamp(r.p,0,2000),c:clamp(r.c,0,2000),g:clamp(r.g,0,2000),gasto:clamp(r.gasto,0,20000)}}return Object.keys(o).length?o:null}
function parseTexto(tx){
  const refs=[];let R=null;
  for(const raw of tx.split(/\r?\n/)){
    let l=raw.replace(/\([^)]*\d{1,2}[:h]\d{2}[^)]*\)|\b\d{1,2}[:h]\d{2}\b|\b\d{1,2}h\b/g," ").replace(/\b(\d+)\/(\d+)\b/g,(m,a,b)=>String(+a/+b)).replace(/^[\s\-•*·–—>]+/,"").replace(/[\s:–—-]+$/,"").replace(/\s+/g," ").trim();
    if(!l||l.length>120)continue;
    const nl=norm(l);
    const rest=nl.replace(MEALRX,"").trim();
    if(MEALRX.test(nl)&&rest.length<=30&&!/\bde\b/.test(rest)&&!/\d+\s*(g|ml|kg|un)\b/.test(rest)){R=refGet(refs,l);continue}
    let k=null;const mk=l.match(/(\d+(?:[.,]\d+)?)\s*kcal/i);if(mk){k=num(mk[1]);l=l.replace(mk[0]," ").replace(/[()]/g," ").replace(/\s+/g," ").trim()}
    let name,q=null,ru="";
    const a=l.match(QRX),b=l.match(NRX);
    if(a&&/^\d/.test(l)){q=num(a[1]);ru=a[2]||"";name=a[3]}
    else if(b){q=num(b[2]);ru=b[3];name=b[1]}
    else{name=l;if(!findFood(name)||name.length>60)continue}
    name=name.replace(/[\s,;:–—-]+$/,"").trim();if(!name)continue;
    const u=UN(ru,"unid");if(q!=null)q*=UNM(ru);
    const med=ru&&u==="unid"&&!/^(un|unid|unidades?)$/i.test(ru)?" ("+ru.toLowerCase()+")":"";
    if(!R)R=refGet(refs,"Refeição 1");
    if(R.itens.length<60)R.itens.push(mkItem(name+med,name,q,u,k?{k}:null))}
  return{metas:null,refs:refs.filter(r=>r.itens.length).slice(0,10)}}
function parseCSV(tx){
  const L=tx.replace(/^﻿/,"").split(/\r?\n/).filter(l=>l.trim()),sep=L[0].includes(";")?";":",";
  const cell=l=>{const r=[];let c="",qt=false;for(const ch of l){if(ch==='"')qt=!qt;else if(ch===sep&&!qt){r.push(c);c=""}else c+=ch}r.push(c);return r.map(s=>s.trim())};
  const rows=L.map(cell),h=rows[0].map(norm),has=h.some(x=>/alimento|^refeicao/.test(x));
  let ix={ref:0,n:1,q:2,u:3,k:4,p:5,c:6,g:7,d:-1};
  if(has){const f=re=>h.findIndex(x=>re.test(x));ix={d:f(/^(dia|tipo)/),ref:f(/^refeicao/),n:f(/^(alimento|item)/),q:f(/^(qtd|quant)/),u:f(/^unid/),k:f(/^(kcal|caloria)/),p:f(/^(p|prot\w*)$/),c:f(/^(c|carb\w*)$/),g:f(/^(g|gord\w*)$/)}}
  const dias={treino:[],descanso:[]},metas={};
  for(const r of rows.slice(has?1:0)){
    const a0=norm(r[0]);
    if(a0==="meta"||a0==="metas"){const t=/trein/.test(norm(r[1]))?"treino":"descanso";metas[t]={k:num(r[2]),p:num(r[3]),c:num(r[4]),g:num(r[5]),gasto:num(r[6])};continue}
    const n=r[ix.n];if(!n)continue;
    const dv=ix.d>=0?norm(r[ix.d]):"",alvo=/trein/.test(dv)?["treino"]:/desc/.test(dv)?["descanso"]:["treino","descanso"];
    for(const t of alvo){const R=refGet(dias[t],(ix.ref>=0&&r[ix.ref])||"Refeição 1");
      if(R.itens.length<60)R.itens.push(mkItem(n,null,num(r[ix.q]),UN(r[ix.u]),{k:num(r[ix.k]),p:num(r[ix.p]),c:num(r[ix.c]),g:num(r[ix.g])}))}}
  dias.treino=dias.treino.slice(0,10);dias.descanso=dias.descanso.slice(0,10);
  return{metas:cleanMetas(metas),dias}}
function parseJSON(tx){const j=JSON.parse(tx),refs=[];
  for(const r of(j.refeicoes||j.refs||[]).slice(0,10)){const R=refGet(refs,String(r.nome||r.refeicao||"Refeição"));
    for(const i of(r.itens||[]).slice(0,60)){const n=i.n||i.nome;if(!n)continue;R.itens.push(mkItem(n,null,num(i.q??i.qtd),UN(i.u||i.unid),{k:num(i.k??i.kcal),p:num(i.p),c:num(i.c),g:num(i.g)}))}}
  return{metas:cleanMetas(j.metas),refs:refs.filter(r=>r.itens.length)}}
function parseDoc(tx,fname){
  tx=tx.replace(/^﻿/,"").trim();
  if(tx[0]==="{")return parseJSON(tx);
  const first=norm(tx.split(/\r?\n/)[0]);
  if(/\.csv$/i.test(fname||"")||/alimento/.test(first)||/^metas? /.test(first))return parseCSV(tx);
  return parseTexto(tx)}
let pimp=null;
function pimpFrom(tx,fonte,fname){
  let r;try{r=parseDoc(tx.slice(0,200000),fname)}catch(e){return toast("Não consegui ler o arquivo")}
  const dias=r.dias||{treino:r.refs,descanso:structuredClone(r.refs)};
  if(!dias.treino.length&&!dias.descanso.length&&!r.metas)return toast("Não encontrei refeições nem metas nesse texto");
  pimp={fonte,metas:r.metas,dias};view="planoimp";render()}
const TIPOS=[["treino","Dia de treino"],["descanso","Dia de descanso"]];
const planRefs=t=>{const d=S.dieta;return(d&&((d.dias&&d.dias[t])||d.refs))||[]};
const difDias=dias=>JSON.stringify(dias.treino)!==JSON.stringify(dias.descanso);
const refsHtml=(refs,t,acts)=>refs.map((r,ri)=>`<div class="lbl">${esc(r.nome)} · ${fmt(r.itens.reduce((a,i)=>a+i.k,0))} kcal</div><div class="card flush">${r.itens.map((i,ii)=>`<div class="dq"><span class="n">${esc(i.n)}<br><small class="${i.ok===false?"bad":"mu"}">${i.ok===false?fmt(i.q)+" "+un(i.u)+" · sem calorias":itemTxt(i)+(acts&&i.via?" · ≈ "+esc(i.via):"")}</small></span>${i.ok===false?`<button data-a="impFix" data-t="${t}" data-r="${ri}" data-i="${ii}" aria-label="Informar calorias">⚠</button>`:""}<button data-a="${acts?"impRm":"planRm"}" data-t="${t}" data-r="${ri}" data-i="${ii}" aria-label="Remover">✕</button></div>`).join("")}</div>`).join("");
const itemTxt=i=>`${fmt(i.q)} ${un(i.u)} · ${fmt(i.k)} kcal · P ${fmt(i.p,1)} C ${fmt(i.c,1)} G ${fmt(i.g,1)}`;
function vPlano(){
  const d=S.dieta,mt=(d&&d.metas)||{},T=mt.treino||{},R=mt.descanso||{};
  const f=(id,v,l)=>field(id,l,v?String(v):"","",'inputmode="decimal"');
  const dias={treino:planRefs("treino"),descanso:planRefs("descanso")},dif=difDias(dias);
  const refs=dias.treino.length||dias.descanso.length?(dif?TIPOS:[TIPOS[0]]).map(([t,tn])=>`<h2>${dif?tn:"Refeições do plano"}</h2>${refsHtml(dias[t],t,false)}`).join(""):'<p class="mu" style="font-size:13px">Nenhuma refeição do plano ainda. Importe o plano abaixo.</p>';
  return page(`<h1>Plano alimentar</h1><p class="mu" style="margin:4px 0 16px;font-size:13px">${d?`Origem: ${esc(d.fonte||"manual")}. As metas abaixo substituem o cálculo automático.`:"Traga o plano do seu nutricionista: metas do dia e refeições com as quantidades."}</p>
  <div class="lbl" style="margin-top:0">Metas do dia</div><div class="card"><div class="mu" style="font-size:12px;margin-bottom:6px">Dia de treino</div><div class="grid2">${f("pm_tk",T.k,"Kcal")}${f("pm_tp",T.p,"Proteína (g)")}${f("pm_tc",T.c,"Carbo (g)")}${f("pm_tg",T.g,"Gordura (g)")}</div>
  <div class="mu" style="font-size:12px;margin:14px 0 6px">Dia de descanso</div><div class="grid2">${f("pm_rk",R.k,"Kcal")}${f("pm_rp",R.p,"Proteína (g)")}${f("pm_rc",R.c,"Carbo (g)")}${f("pm_rg",R.g,"Gordura (g)")}</div>
  <button class="btn" style="margin-top:14px" data-a="saveMetas">Salvar metas</button></div>
  ${refs}
  <div class="lbl">Importar o plano</div><div class="card"><p class="mu" style="font-size:13px;margin:0 0 10px">Envie o arquivo (CSV, TXT ou JSON) ou cole o texto do plano. De PDF ou Word, copie o texto e cole abaixo. As calorias vêm da sua tabela de alimentos quando não estiverem no arquivo.</p>
  <label class="btn ghost" style="display:block;text-align:center;cursor:pointer">Escolher arquivo<input type="file" id="pl_file" accept=".csv,.txt,.json,.md,text/*" hidden></label>
  <textarea id="pl_txt" rows="7" placeholder="Café da manhã&#10;2 ovos&#10;50 g de aveia&#10;&#10;Almoço&#10;150 g de arroz branco cozido&#10;120 g de frango grelhado" style="margin-top:10px"></textarea>
  <button class="btn" style="margin-top:10px" data-a="planRead">Ler texto colado</button><button class="lk" data-a="planModelo" style="display:block;margin:10px auto 0">Baixar modelo CSV</button></div>
  ${d?`<button class="lk" data-a="planClear" style="display:block;margin:6px auto"><span class="bad">Remover plano alimentar</span></button>`:""}`,{back:"ajustes"});
}
function vPlanoImp(){
  const p=pimp;if(!p){view="plano";return vPlano()}
  const dif=difDias(p.dias),tl=(dif?TIPOS:[TIPOS[0]]),all=tl.flatMap(([t])=>p.dias[t]),n=all.reduce((a,r)=>a+r.itens.length,0),fx=all.reduce((a,r)=>a+r.itens.filter(i=>!i.ok).length,0),m=p.metas||{};
  const mc=t=>m[t]?`<div class="calc"><span>${t==="treino"?"Dia de treino":"Dia de descanso"}</span><b>${fmt(m[t].k)} kcal · P ${fmt(m[t].p)} C ${fmt(m[t].c)} G ${fmt(m[t].g)}</b></div>`:"";
  return page(`<h1>Conferir plano</h1><p class="mu" style="margin:4px 0 12px;font-size:13px">${n} ${n===1?"item":"itens"} em ${all.length} ${all.length===1?"refeição":"refeições"}${dif?" (treino e descanso)":""}${p.metas?" e metas do dia":""}.${fx?` <b class="bad">${fx} sem calorias</b>: toque em ⚠ para informar.`:""}</p>
  ${p.metas?`<div class="card">${mc("treino")}${mc("descanso")}</div>`:""}
  ${tl.map(([t,tn])=>`${dif?`<h2>${tn}</h2>`:""}${refsHtml(p.dias[t],t,true)}`).join("")}
  <button class="btn" style="margin-top:14px" data-a="planUse">Usar este plano</button><button class="btn ghost" style="margin-top:8px" data-a="planCancel">Cancelar</button>`,{back:"plano"})}
const A={
  localOnly:()=>{S.localOnly=true;save();view="hoje";render()},
  saveMetas:()=>{const g=id=>num($("#"+id).value),old=(S.dieta&&S.dieta.metas)||{};
    const mk=(t,key)=>{const k=g("pm_"+t+"k");return k>0?{k,p:g("pm_"+t+"p")||0,c:g("pm_"+t+"c")||0,g:g("pm_"+t+"g")||0,gasto:(old[key]||{}).gasto||0}:null};
    const m={};const T=mk("t","treino"),R=mk("r","descanso");if(T)m.treino=T;if(R)m.descanso=R;
    const bad=Object.values(m).some(x=>x.k>20000||x.p>2000||x.c>2000||x.g>2000||x.k<300);if(bad)return toast("Confira os valores das metas");
    S.dieta={fonte:"manual",...(S.dieta||{}),em:nowISO(),metas:Object.keys(m).length?m:null};save();queueState();toast("Metas salvas");render()},
  planRead:()=>{const tx=$("#pl_txt").value;if(tx.trim().length<3)return toast("Cole o texto do plano");pimpFrom(tx,"texto colado")},
  planModelo:()=>{const csv="﻿Dia;Refeição;Alimento;Qtd;Unid;Kcal;P;C;G\nTreino;Café da manhã;Ovo cozido;2;unid;;;;\nTreino;Almoço;Arroz branco cozido;200;g;;;;\nDescanso;Almoço;Arroz branco cozido;150;g;;;;\n;Jantar;Peito de frango grelhado;120;g;198;37;0;4\nMeta;Treino;2800;180;320;70;3100\nMeta;Descanso;2400;170;250;65;2675\n";
    const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));a.download="modelo-plano-alimentar.csv";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)},
  planRm:d=>{const D=S.dieta;if(!D.dias)D.dias={treino:D.refs||[],descanso:structuredClone(D.refs||[])};const same=!difDias(D.dias);D.dias[d.t][+d.r].itens.splice(+d.i,1);D.dias[d.t]=D.dias[d.t].filter(x=>x.itens.length);if(same)D.dias.descanso=structuredClone(D.dias.treino);save();queueState();render()},
  planClear:()=>{if(confirm("Remover o plano alimentar? As metas voltam a ser calculadas pelo app.")){S.dieta=null;save();queueState();render()}},
  impRm:d=>{const same=!difDias(pimp.dias),L=pimp.dias[d.t];L[+d.r].itens.splice(+d.i,1);pimp.dias[d.t]=L.filter(x=>x.itens.length);if(same)pimp.dias.descanso=structuredClone(pimp.dias.treino);render()},
  impFix:d=>{const same=!difDias(pimp.dias),it=pimp.dias[d.t][+d.r].itens[+d.i],k=num(prompt("Calorias totais de “"+it.n+"” ("+fmt(it.q)+" "+un(it.u)+")"));if(k==null||k<=0||k>20000)return;
    it.k=k;it.p=num(prompt("Proteína (g) no total",0))||0;it.c=num(prompt("Carboidrato (g) no total",0))||0;it.g=num(prompt("Gordura (g) no total",0))||0;it.ok=true;if(same)pimp.dias.descanso=structuredClone(pimp.dias.treino);render()},
  planCancel:()=>{pimp=null;go("plano")},
  planUse:()=>{const p=pimp;if(!p)return;const cl=L=>L.filter(r=>r.itens.length).map(r=>({nome:r.nome,itens:r.itens.map(({n,q,u,k,p,c,g})=>({n,q,u,k,p,c,g}))})),
      dias={treino:cl(p.dias.treino),descanso:cl(p.dias.descanso)},old=S.dieta||{},tem=dias.treino.length||dias.descanso.length;
    if(!tem&&!p.metas)return toast("Nada para importar");
    S.dieta={fonte:p.fonte,em:nowISO(),metas:p.metas||old.metas||null,dias:tem?dias:{treino:planRefs("treino"),descanso:planRefs("descanso")}};
    const nomes=(S.dieta.dias.treino.length?S.dieta.dias.treino:S.dieta.dias.descanso).map(r=>r.nome).slice(0,8),atual=S.settings.meals;
    if(nomes.length&&nomes.join("|")!==atual.join("|")&&confirm("Usar as refeições do plano ("+nomes.join(", ")+") no app? Lançamentos antigos passam para a refeição da mesma posição.")){
      S.entries.forEach(e=>{const i=atual.indexOf(e.meal),nm=nomes[Math.min(i<0?nomes.length-1:i,nomes.length-1)];if(e.meal!==nm){e.meal=nm;queue("entries",e,true)}});
      S.settings.meals=nomes}
    pimp=null;save();queueState();Cloud.sync();toast("Plano salvo");go("plano")},
  addPlan:d=>{const r=planRefs(tipoDia())[meal],it=r&&r.itens[+d.i];if(!it)return;draft.push({f:{n:it.n,u:it.u,por:it.q||1,k:it.k,p:it.p,c:it.c,f:it.g},q:it.q||1});render()},
  planAll:()=>{const r=planRefs(tipoDia())[meal];if(!r)return;r.itens.forEach(it=>draft.push({f:{n:it.n,u:it.u,por:it.q||1,k:it.k,p:it.p,c:it.c,f:it.g},q:it.q||1}));render()},
  saveGasto:()=>{const raw=$("#gw").value.trim(),D=day(cur);
    if(!raw){D.gasto=null}else{const v=num(raw);if(!(v>=500&&v<20000))return toast("Gasto inválido (entre 500 e 20000 kcal)");D.gasto=Math.round(v)}
    queue("days",{date:cur,...D});toast(D.gasto?"Gasto do dia salvo":"Voltou a usar o gasto estimado");render()},
  pick:d=>{if(d.d<=today()){cur=d.d;render()}},
  runImport:async()=>{const url=$("#i_url").value.trim(),tok=$("#i_tok").value.trim(),msg=$("#i_msg"),btn=$("#i_go");
    if(!/^https:\/\/script\.google\.com\/(a\/macros\/[\w.-]+\/|macros\/)s\/[\w-]+\/exec$/.test(url)||!tok)return toast("Confira o endereço e o token");
    btn.disabled=true;try{msg.textContent=await runImport(url,tok,x=>msg.textContent=x)}catch(e){msg.textContent="Falhou: "+e.message}btn.disabled=false},
  go:d=>go(d.v),
  key:async d=>{
    if(Date.now()<blockedUntil)return;
    if(d.k==="⌫")pinBuf=pinBuf.slice(0,-1);else if(pinBuf.length<4)pinBuf+=d.k;
    if(view==="onb")readOb();
    if(pinBuf.length===4){
      if(locked){const ok=(await hashPin(pinBuf,S.settings.pinSalt))===S.settings.pinHash;pinBuf="";if(ok){fails=0;locked=false;view=needLogin()?"login":"hoje"}else if(++fails>=5){blockedUntil=Date.now()+30000*Math.min(fails-4,10)}render();if(!ok)toast("PIN incorreto");return}
      if(view==="setpin"){await storePin(pinBuf);pinBuf="";view="ajustes";toast("PIN definido");render();return}
    }
    render();
  },
  goal:d=>{readOb();ob.goal=+d.i;render()},sexo:d=>{readOb();ob.sexo=d.s;render()},
  obBack:()=>{readOb();ob.step--;render()},obLocal:()=>{readOb();finishOb(true)},
  obNext:()=>{readOb();
    if(ob.step===1){if(!ob.nome.trim()||!(num(ob.idade)>=10)||!(num(ob.alt)>=100)||!(num(ob.peso)>=30))return toast("Preencha nome, idade, altura e peso")}
    if(ob.step===2)return finishOb(false);
    ob.step++;render()},
  day:d=>{const x=new Date(cur+"T12:00:00");x.setDate(x.getDate()+ +d.n);if(iso(x)>today())return;cur=iso(x);render()},
  tipo:d=>{const D=day(cur);D.tipo=d.t;queue("days",{date:cur,...D});render()},
  meal:(d)=>{meal=+d.i;if(!d.stay)view="lancar";render()},
  add:d=>{const f=foods().find(x=>x.n===d.n),p=parseQ(q);draft.push({f,q:p.q&&search(q)[0]===f?p.q:f.por});q="";render()},
  rm:d=>{draft.splice(+d.i,1);render()},
  saveDraft:()=>{const ml=S.settings.meals[meal];
    draft.forEach(({f,q})=>{const z=q/f.por,e={id:uid(),date:cur,meal:ml,name:f.n,qty:q,unit:f.u,k:+(f.k*z).toFixed(1),p:+(f.p*z).toFixed(1),c:+(f.c*z).toFixed(1),g:+(f.f*z).toFixed(1),deleted:false};S.entries.push(e);S.usage[f.n]=(S.usage[f.n]||0)+1;queue("entries",e)});
    toast(`${ml} salva`);draft=[];view="hoje";save();render()},
  del:d=>{const e=S.entries.find(x=>x.id===d.id);if(e){e.deleted=true;queue("entries",e);render()}},
  rng:d=>{rng=+d.i;render()},hrng:d=>{hrng=+d.i;render()},
  savePeso:()=>{const v=num($("#pw").value);if(!(v>20&&v<500))return toast("Peso inválido");const D=day(today());D.peso=v;queue("days",{date:today(),...D});toast("Peso salvo");render()},
  plan:d=>{S.settings.plan[d.k]=+d.v;save();queueState();render()},
  min:d=>{const p=S.settings.plan;p.min=Math.max(10,Math.min(240,p.min+ +d.n));save();queueState();render()},
  sexoC:d=>{S.profile.sexo=d.s;render()},goalC:d=>{S.profile.goal=+d.i;render()},
  saveCad:()=>{const p={...S.profile,nome:$("#c_nome").value.trim().slice(0,30),idade:num($("#c_idade").value),alt:num($("#c_alt").value),peso:num($("#c_peso").value)};
    if(!p.nome||!(p.idade>=10)||!(p.alt>=100)||!(p.peso>=30))return toast("Confira os campos");S.profile=p;save();queueState();toast("Cadastro salvo");go("ajustes")},
  tgPin:()=>{if(S.settings.pinHash){if(confirm("Desativar o bloqueio por PIN?")){S.settings.pinHash=S.settings.pinSalt=null;save();render()}}else go("setpin")},
  tgLem:async()=>{const on=!S.settings.lembrete;if(on){if(!("Notification" in window)||(await Notification.requestPermission())!=="granted")return toast("Permita notificações nas configurações do navegador")}S.settings.lembrete=on;save();queueState();remind();render()},
  tgWifi:()=>{S.settings.wifi=!S.settings.wifi;save();queueState();render()},
  login:async()=>{try{const had=S.onboarded;if(await Cloud.signIn($("#a_email").value.trim(),$("#a_pw").value)){toast("Entrando...");if(had)Cloud.queueAll();S.last=null;await Cloud.sync();view=S.onboarded?"hoje":"onb";render()}}catch(e){toast(e.message)}},
  firstTime:()=>{ob.step=0;view="onb";render()},toLogin:()=>{view="login";render()},
  signup:async()=>{try{toast(await Cloud.signUp($("#a_email").value.trim(),$("#a_pw").value)?"Conta criada":"Confirme o e-mail que enviamos");if(S.session){Cloud.queueAll();view="hoje"}render()}catch(e){toast(e.message)}},
  logout:()=>{S.session=null;S.last=null;save();setStat(false,"Neste aparelho");render()},
  syncNow:async()=>{toast("Sincronizando...");await Cloud.sync();toast(stat.t)},
  exportCsv:()=>{const r=[["data","refeicao","alimento","qtd","unid","kcal","p","c","g"],...S.entries.filter(e=>!e.deleted).sort((a,b)=>a.date<b.date?-1:1).map(e=>[e.date,e.meal,e.name,e.qty,e.unit,e.k,e.p,e.c,e.g])];
    const csv=r.map(l=>l.map(v=>{v=String(v);if(/^[=+\-@\t\r]/.test(v))v="'"+v;return /[";\n]/.test(v)?`"${v.replace(/"/g,'""')}"`:v}).join(";")).join("\n");
    const a=document.createElement("a");a.href=URL.createObjectURL(new Blob(["\ufeff"+csv],{type:"text/csv"}));a.download="lancamentos.csv";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)},
  wipe:()=>{if(confirm("Apagar todos os dados DESTE aparelho? Dados já sincronizados continuam na sua conta.")){localStorage.removeItem(KEY);location.reload()}},
  newFood:()=>{const n=parseQ(q||"").name.slice(0,60),g=prompt("Quantas kcal em 100 g de “"+n+"”?");const k=num(g);if(!n||k==null||k<0||k>1000)return;
    S.customFoods.push({n,g:"Meus alimentos",u:"g",por:100,k,p:num(prompt("Proteína (g) em 100 g",0))||0,c:num(prompt("Carboidrato (g) em 100 g",0))||0,f:num(prompt("Gordura (g) em 100 g",0))||0});save();queueState();render()}
};
document.addEventListener("click",e=>{const el=e.target.closest("[data-a]");if(el&&A[el.dataset.a])A[el.dataset.a](el.dataset)});
document.addEventListener("input",e=>{if(e.target.id==="q"){q=e.target.value;$("#res").innerHTML=foodList()}});
document.addEventListener("change",e=>{
  const t=e.target;
  if(t.dataset.di!==undefined){const v=num(t.value);if(v>0&&v<=100000)draft[+t.dataset.di].q=v;render()}
  if(t.id==="pl_file"&&t.files[0]){const f=t.files[0];if(f.size>2e6)return toast("Arquivo grande demais");f.text().then(tx=>pimpFrom(tx,"documento: "+f.name.slice(0,40),f.name));t.value=""}
  if(t.id==="csv"&&t.files[0]){const f=t.files[0];if(f.size>2e6)return toast("Arquivo grande demais");f.text().then(tx=>{
    const sep=tx.split("\n")[0].includes(";")?";":",",L=tx.replace(/^\ufeff/,"").split(/\r?\n/).slice(1);let n=0;
    L.forEach(l=>{const c=l.split(sep).map(s=>s.replace(/^"|"$/g,"").trim());if(!c[0])return;const u=/unid/i.test(c[2])?"unid":/ml/i.test(c[2])?"ml":"g";const o={n:c[0].slice(0,80),g:(c[1]||"Meus alimentos").slice(0,40),u,por:num(c[3])||100,k:num(c[4])||0,p:num(c[5])||0,c:num(c[6])||0,f:num(c[7])||0};if(o.k<=0||o.k>20000)return;S.customFoods=S.customFoods.filter(x=>x.n!==o.n);S.customFoods.push(o);n++});
    save();queueState();toast(n+" alimentos importados");render()})}
});
let hiddenAt=0;
document.addEventListener("visibilitychange",()=>{if(document.hidden)hiddenAt=Date.now();else{if(S.settings.pinHash&&hiddenAt&&Date.now()-hiddenAt>60000){locked=true;pinBuf="";render()}Cloud.sync();remind()}});
window.addEventListener("online",()=>Cloud.sync());

/* ---------- Lembretes (só disparam com o app aberto; push em segundo plano exige servidor) ---------- */
let rt;
function remind(){clearTimeout(rt);if(!S.settings.lembrete||!("Notification" in window)||Notification.permission!=="granted")return;
  const n=new Date(),next=[[12,30],[19,0]].map(([h,m])=>{const d=new Date();d.setHours(h,m,0,0);if(d<=n)d.setDate(d.getDate()+1);return d}).sort((a,b)=>a-b)[0];
  rt=setTimeout(async()=>{const r=await navigator.serviceWorker.ready;r.showNotification("Hora de lançar sua refeição",{body:"Registre o que comeu em segundos.",icon:"icon-180.png",tag:"lembrete"});remind()},next-n)}

/* ---------- Início ---------- */
(async()=>{
  if("serviceWorker" in navigator){const had=!!navigator.serviceWorker.controller;navigator.serviceWorker.register("sw.js").then(r=>{r.update();document.addEventListener("visibilitychange",()=>{if(!document.hidden)r.update()})}).catch(()=>{});navigator.serviceWorker.addEventListener("controllerchange",()=>{if(had&&!window.__rl){window.__rl=1;location.reload()}})}
  try{BASE=await (await fetch("foods.json")).json()}catch(e){toast("Não foi possível carregar a lista de alimentos")}
  setStat(false,Cloud.on()?(S.session?"Conectando...":"Entre na conta"):"Neste aparelho");
  render();remind();Cloud.sync();
})();
})();
