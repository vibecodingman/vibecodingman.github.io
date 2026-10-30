
/* Химический тренажёр — Supabase client. Never place service_role keys in browser code. */
"use strict";
const SUPABASE_URL="https://jjfuhqntmszksptaubeg.supabase.co";
const SUPABASE_PUBLISHABLE_KEY="sb_publishable_qa1uohdpDbS9jp11DQi7gQ_b_OaceAK";
const sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY);
const $=id=>document.getElementById(id);
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const uid=p=>(p||"id")+"_"+crypto.randomUUID().slice(0,8);
let user=null,profile=null,fullAccess=false,course={programs:[]},progress={},selected=null,activeSectionId=null,toastTimer,editorOpen=false,booting=false;

function notify(s){$("toast").textContent=s;$("toast").classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>$("toast").classList.remove("show"),3500)}
function msg(s){$("authMsg").textContent=s||""}
function admin(){return profile?.role==="admin"}
async function dataOrThrow(r){if(r.error)throw r.error;return r.data}
function programIsFree(p){if(typeof p?.isFree==="boolean")return p.isFree;return course.programs.findIndex(x=>x.id===p?.id)===0}
function canOpen(p){return !!p&&(admin()||programIsFree(p)||fullAccess)}
function allQuestions(){return course.programs.flatMap(p=>(p.sections||[]).flatMap(s=>s.questions||[]))}
function findSection(id){for(const p of course.programs){const s=(p.sections||[]).find(s=>s.id===id);if(s)return s}return null}
function rubricNumber(s,i){const v=s?.rubricNumber;return v!==undefined&&v!==null&&String(v).trim()!==""?String(v).trim():String(i+1)}
function findRubricByNumber(p,n){const wanted=String(n??"").trim();return wanted?(p.sections||[]).find((s,i)=>rubricNumber(s,i)===wanted)||null:null}
function sectionComplete(s){return !!s&&(s.questions||[]).length>0&&(s.questions||[]).every(q=>progress[q.id]?.answered)}
function transitionTarget(p,s){const n=s?.nextRubricNumber;if(n===undefined||n===null||String(n).trim()==="")return null;return findRubricByNumber(p,n)}
function normalizeAnswer(v){return String(v??"").trim().toLocaleLowerCase().replace(/[\s\u00a0]+/g," ").replace(/[.!?;:,]+$/g,"")}

async function signUp(){
  msg("");const email=$("email").value.trim(),password=$("password").value;
  if(password.length<8){msg("Пароль должен содержать не менее 8 символов.");return}
  try{const {data,error}=await sb.auth.signUp({email,password});if(error)throw error;if(data.session)await boot(data.user);else msg("Аккаунт создан. Проверь почту, подтверди адрес и затем войди.")}
  catch(e){msg("Ошибка регистрации: "+e.message)}
}
async function signIn(e){
  e.preventDefault();msg("");
  try{const {data,error}=await sb.auth.signInWithPassword({email:$("email").value.trim(),password:$("password").value});if(error)throw error;await boot(data.user)}
  catch(e2){msg("Не удалось войти: "+e2.message)}
}
async function boot(u){
  if(booting)return;booting=true;user=u;
  try{
    profile=await dataOrThrow(await sb.from("profiles").select("id,email,role").eq("id",u.id).single());
    const access=await dataOrThrow(await sb.from("user_access").select("full_access").eq("user_id",u.id).maybeSingle());
    fullAccess=!!access?.full_access||admin();
    course=await dataOrThrow(await sb.rpc("get_course_data"))||{programs:[]};
    if(!Array.isArray(course.programs))course.programs=[];
    const saved=await dataOrThrow(await sb.from("user_progress").select("data").eq("user_id",u.id).maybeSingle());
    progress=saved?.data&&typeof saved.data==="object"?saved.data:{};
    $("auth").classList.add("hidden");$("app").classList.remove("hidden");
    $("badge").textContent=(u.email||"")+(admin()?" · АДМИНИСТРАТОР":fullAccess?" · ПОЛНЫЙ ДОСТУП":"");
    document.querySelectorAll(".admin").forEach(el=>el.classList.toggle("hidden",!admin()));
    if(!course.programs.some(p=>p.id===selected&&canOpen(p)))selected=(course.programs.find(canOpen)||course.programs[0])?.id||null;
    const p=course.programs.find(p=>p.id===selected);
    if(!p||!p.sections?.some(s=>s.id===activeSectionId))activeSectionId=p?.sections?.[0]?.id||null;
    render();
  }catch(e){msg("Ошибка загрузки. Проверь настройки Supabase и SQL: "+e.message);console.error(e)}
  finally{booting=false}
}
async function logout(){await sb.auth.signOut();user=null;profile=null;fullAccess=false;progress={};selected=null;activeSectionId=null;$("app").classList.add("hidden");$("auth").classList.remove("hidden");$("badge").textContent=""}
async function saveCourse(){if(!admin())throw Error("Редактировать курс может только администратор.");const {error}=await sb.from("course_state").upsert({id:1,data:course,updated_at:new Date().toISOString()});if(error)throw error}
async function saveProgress(){if(!user)throw Error("Нужно войти в аккаунт.");const {error}=await sb.from("user_progress").upsert({user_id:user.id,data:progress,updated_at:new Date().toISOString()});if(error)throw error}
async function changed(text){
  const beforeProgram=selected,beforeSection=activeSectionId;
  try{await saveCourse();selected=beforeProgram;activeSectionId=beforeSection;render();notify(text)}
  catch(e){selected=beforeProgram;activeSectionId=beforeSection;notify("Ошибка сохранения: "+e.message);console.error(e)}
}
function render(){
  renderPrograms();renderPromo();renderLesson();
  const done=course.programs.filter(p=>(p.sections||[]).length&&p.sections.every(s=>(s.questions||[]).length&&s.questions.every(q=>["essay","free_text"].includes(q.type)?!!progress[q.id]?.answered:!!progress[q.id]?.correct))).length;
  $("progress").textContent=`Программ пройдено: ${done} / ${course.programs.length}`;
}
function renderPrograms(){
  const query=($("search").value||"").toLowerCase().trim();
  const list=course.programs.filter(p=>(p.title||"").toLowerCase().includes(query));
  $("programs").innerHTML=list.length?list.map(p=>`<button class="program ${p.id===selected?"active":""} ${canOpen(p)?"":"locked"}" data-p="${esc(p.id)}"><span>${canOpen(p)?"📘":"🔒"} ${esc(p.title)}</span><small class="access-label ${programIsFree(p)?"free-label":"paid-label"}">${programIsFree(p)?"Бесплатная":"Платная"}</small></button>`).join(""):`<div class="panel">${course.programs.length?"Ничего не найдено.":"Курс пока пуст."}</div>`;
  $("programs").querySelectorAll("[data-p]").forEach(b=>b.onclick=()=>{const p=course.programs.find(x=>x.id===b.dataset.p);if(!canOpen(p)){notify("Эта программа закрыта. Нужен промокод или полный доступ.");return}selected=p.id;activeSectionId=p.sections?.[0]?.id||null;$("adminPanel").classList.add("hidden");$("lesson").classList.remove("hidden");render()});
}
function renderPromo(){
  if(admin()||fullAccess){$("promoBox").innerHTML="";return}
  $("promoBox").innerHTML=`<div class="notice"><b>Бесплатные программы доступны всем.</b><p>Есть промокод? Введи его ниже.</p><form id="promoForm"><input id="promoInput" placeholder="Промокод" required><button type="submit">Активировать</button></form></div>`;
  $("promoForm").onsubmit=async e=>{e.preventDefault();try{const {error}=await sb.rpc("redeem_course_promo",{p_code:$("promoInput").value.trim().toUpperCase()});if(error)throw error;fullAccess=true;course=await dataOrThrow(await sb.rpc("get_course_data"))||{programs:[]};if(!Array.isArray(course.programs))course.programs=[];$("badge").textContent=(user.email||"")+" · ПОЛНЫЙ ДОСТУП";render();notify("Полный доступ открыт!")}catch(err){notify(err.message||"Не удалось активировать промокод.")}};
}
function renderInlineTask(q,responses=[],editable=false){
  const parts=String(q.text||"").split("{{input}}");
  return parts.map((part,i)=>`${esc(part)}${i<parts.length-1?`<input class="inline-answer-input" type="text" ${editable?`name="blank${i}" data-blank="${i}" required`:`value="${esc(responses[i]||"")}" disabled`} aria-label="Ответ ${i+1}" placeholder="Впиши ответ">`:""}`).join("");
}

/* Обновлено: кнопки редактирования и удаления задания явно видны администратору. */
function renderQuestionHTML(q,qi){
  const r=progress[q.id],inline=q.type==="text"&&String(q.text||"").includes("{{input}}"),free=q.type==="essay"||q.type==="free_text";
  let body="";
  if(inline){
    body=r?.answered?`<div class="submitted-answer"><div class="inline-task-text">${renderInlineTask(q,r.responses||[])}</div><div class="feedback ${r.correct?"correct":"wrong"}"><b>${r.correct?"Правильно!":"Ответ не совпал с образцом."}</b> ${esc(q.explanation||"")}</div>${admin()?`<p><b>Правильный ответ:</b> ${esc((q.acceptedAnswers||[]).map(a=>Array.isArray(a)?a.join(" / "):a).join("; "))}</p>`:""}</div>`:`<form class="free-answer-form inline-answer-form" data-inline-answer="${esc(q.id)}"><div class="inline-task-text">${renderInlineTask(q,[],true)}</div><button type="submit">Проверить ответ</button></form>`;
  }else if(free){
    body=r?.answered?`<div class="submitted-answer"><b>Твой ответ:</b><p>${esc(r.response||"")}</p><div class="feedback"><b>Ответ сохранён.</b> ${esc(q.explanation||"Проверь его по инструкции учебника.")}</div>${q.modelAnswer?`<p><b>Ответ для самостоятельной проверки:</b><br>${esc(q.modelAnswer)}</p>`:""}</div>`:`<form class="free-answer-form" data-free-answer="${esc(q.id)}"><label class="answer-label" for="answer-${esc(q.id)}">Твой ответ</label><textarea id="answer-${esc(q.id)}" name="response" rows="4" required placeholder="Напиши ответ своими словами..."></textarea><button type="submit">Сохранить ответ</button></form>`;
  }else if(q.type==="route"){
    body=r?.answered
      ? `<div class="submitted-answer"><p><b>Выбранный вариант:</b> ${esc(q.options?.[r.selected]||"")}</p><div class="feedback">Маршрут выбран.</div></div>`
      : `<form class="free-answer-form route-answer-form" data-route-answer="${esc(q.id)}"><div class="options">${(q.options||[]).map((o,i)=>`<label class="option route-option"><input type="radio" name="routeChoice" value="${i}" required><span>${esc(o)}</span></label>`).join("")}</div><button type="submit">Продолжить</button></form>`;
  }else{
    body=`<div class="options">${(q.options||[]).map((o,i)=>`<button class="option ${r?.answered?(i===q.answer?"good":i===r.selected?"bad":""):""}" data-answer="${esc(q.id)}" data-index="${i}" ${r?.answered?"disabled":""}>${esc(o)}</button>`).join("")}</div>${r?.answered?`<div class="feedback ${r.correct?"correct":"wrong"}"><b>${r.correct?"Правильно!":"Неправильно."}</b> ${esc(q.explanation||"")}</div>`:""}`;
  }
  return `<div class="question" data-q="${esc(q.id)}"><b>${qi+1}. ${esc(inline?"":q.text)}</b>${body}${admin()?`<div class="admin-actions" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px"><button type="button" class="light" data-editq="${esc(q.id)}">Редактировать задание</button><button type="button" class="danger" data-delq="${esc(q.id)}">Удалить задание</button></div>`:""}</div>`;
}
function renderLesson(){
  const p=course.programs.find(x=>x.id===selected);
  if(!p){$("lesson").innerHTML="<div class='panel'>Выбери программу.</div>";return}
  if(!canOpen(p)){$("lesson").innerHTML="<div class='panel'><h2>Программа закрыта</h2><p>Введи промокод, чтобы получить доступ.</p></div>";return}
  const sections=p.sections||[];
  if(!activeSectionId||!sections.some(s=>s.id===activeSectionId))activeSectionId=sections[0]?.id||null;
  if(!sections.length){$("lesson").innerHTML="<div class='panel'>В этой программе пока нет рубрик.</div>";renderAdminPanel(p);return}
  const s=sections.find(x=>x.id===activeSectionId)||sections[0],idx=sections.indexOf(s);
  const done=sectionComplete(s),target=transitionTarget(p,s);
  $("lesson").innerHTML=`<div class="section"><div class="section-head"><div><h2>${esc(s.title||"Рубрика")}</h2><p>${esc(s.description||"")}</p></div>${admin()?`<span class="small-note">Рубрика № ${esc(rubricNumber(s,idx))}</span>`:""}</div>${(s.questions||[]).map((q,i)=>renderQuestionHTML(q,i)).join("")||"<p>Заданий пока нет.</p>"}${!admin()&&done&&target?`<button id="nextRubric">Перейти дальше</button>`:""}</div>`;
  $("lesson").querySelectorAll("[data-answer]").forEach(b=>b.onclick=()=>answerChoice(b.dataset.answer,Number(b.dataset.index)));
  $("lesson").querySelectorAll("[data-free-answer]").forEach(f=>f.onsubmit=e=>{e.preventDefault();saveFreeAnswer(f.dataset.freeAnswer,new FormData(f).get("response"))});
  $("lesson").querySelectorAll("[data-inline-answer]").forEach(f=>f.onsubmit=e=>{e.preventDefault();const q=findQuestion(f.dataset.inlineAnswer)?.question;if(!q)return;const count=(q.text.match(/\{\{input\}\}/g)||[]).length;const responses=Array.from({length:count},(_,i)=>f.querySelector(`[name="blank${i}"]`)?.value||"");checkInlineAnswer(q,responses)});
  $("lesson").querySelectorAll("[data-route-answer]").forEach(f=>f.onsubmit=e=>{e.preventDefault();const v=f.querySelector('input[name="routeChoice"]:checked');if(!v){notify("Выбери вариант ответа.");return}chooseRoute(f.dataset.routeAnswer,Number(v.value))});
  $("lesson").querySelectorAll("[data-editq]").forEach(b=>b.onclick=()=>editQuestion(b.dataset.editq));
  $("lesson").querySelectorAll("[data-delq]").forEach(b=>b.onclick=()=>deleteQuestion(b.dataset.delq));
  $("lesson").querySelectorAll("[data-edit-section]").forEach(b=>b.onclick=()=>editSection(b.dataset.editSection));
  $("lesson").querySelectorAll("[data-delete-section]").forEach(b=>b.onclick=()=>deleteSection(b.dataset.deleteSection));
  $("lesson").querySelectorAll("[data-addq]").forEach(b=>b.onclick=()=>addQuestion(b.dataset.addq));
  $("lesson").querySelectorAll("[data-nav-section]").forEach(b=>b.onclick=()=>{activeSectionId=b.dataset.navSection;render()});
  const next=$("nextRubric");if(next)next.onclick=()=>{if(!target){notify("Следующая рубрика не найдена.");return}activeSectionId=target.id;render()};
  renderAdminPanel(p);
}

function renderAdminPanel(p){
  if(!admin()){$("adminPanel").classList.add("hidden");return}
  const panel=$("adminPanel");panel.classList.remove("hidden");
  panel.innerHTML=`<h2>Управление программой</h2>
    <div class="admin-actions">
      <button type="button" id="addSection">Добавить рубрику</button>
      <button type="button" id="editProgram" class="light">Изменить программу</button>
      <button type="button" id="deleteProgram" class="danger">Удалить программу</button>
    </div>
    <h3>Рубрики</h3>
    ${(p.sections||[]).map((s,i)=>`<div class="admin-row">
      <span><b>№ ${esc(rubricNumber(s,i))}.</b> ${esc(s.title||"Без названия")}</span>
      <div class="admin-actions">
        <button type="button" class="light" data-nav-section="${esc(s.id)}">Открыть</button>
        <button type="button" class="light" data-edit-section="${esc(s.id)}">Изменить</button>
        <button type="button" class="danger" data-delete-section="${esc(s.id)}">Удалить</button>
      </div>
    </div>`).join("")}
    ${activeSectionId?`<div class="admin-actions"><button type="button" data-addq="${esc(activeSectionId)}">+ Задание</button></div>`:""}`;
  $("addSection").onclick=()=>addSection(p.id);
  $("editProgram").onclick=()=>editProgram(p.id);
  $("deleteProgram").onclick=()=>deleteProgram(p.id);
  panel.querySelectorAll("[data-nav-section]").forEach(b=>b.onclick=()=>{activeSectionId=b.dataset.navSection;render()});
  panel.querySelectorAll("[data-edit-section]").forEach(b=>b.onclick=()=>editSection(b.dataset.editSection));
  panel.querySelectorAll("[data-delete-section]").forEach(b=>b.onclick=()=>deleteSection(b.dataset.deleteSection));
  panel.querySelectorAll("[data-addq]").forEach(b=>b.onclick=()=>addQuestion(b.dataset.addq));
}

function openEditor(title,fields,initial={}){
  return new Promise(resolve=>{
    editorOpen=true;
    $("editorTitle").textContent=title;
    const host=$("editorFields");
    host.innerHTML="";
    let routeRows=[];
    function renderRouteRows(rows){
      routeRows=rows;
      const wrap=document.createElement("div");
      wrap.className="route-editor-rows";
      rows.forEach((row,i)=>{
        const line=document.createElement("div");
        line.className="route-editor-row";
        const text=document.createElement("textarea");
        text.placeholder="Текст варианта ответа";
        text.value=row.text||"";
        text.setAttribute("aria-label",`Текст варианта ${i+1}`);
        const dest=document.createElement("input");
        dest.type="number";
        dest.min="1";
        dest.step="1";
        dest.placeholder="№ рубрики";
        dest.value=row.destination||"";
        dest.setAttribute("aria-label",`Номер рубрики для варианта ${i+1}`);
        const remove=document.createElement("button");
        remove.type="button";
        remove.className="danger route-remove";
        remove.textContent="×";
        remove.title="Удалить вариант";
        text.addEventListener("input",()=>routeRows[i].text=text.value);
        dest.addEventListener("input",()=>routeRows[i].destination=dest.value);
        remove.addEventListener("click",()=>{
          if(routeRows.length<=2){notify("Нужно оставить минимум два варианта.");return}
          const next=routeRows.filter((_,n)=>n!==i);
          renderRouteRows(next);
        });
        line.append(text,dest,remove);
        wrap.append(line);
      });
      const add=document.createElement("button");
      add.type="button";
      add.className="light route-add";
      add.textContent="+ Добавить вариант";
      add.addEventListener("click",()=>renderRouteRows([...routeRows,{text:"",destination:""}]));
      wrap.append(add);
      return wrap;
    }
    fields.forEach(f=>{
      const label=document.createElement("label");
      label.textContent=f.label;
      if(f.help){
        const help=document.createElement("span");
        help.className="field-help";
        help.textContent=f.help;
        label.append(help);
      }
      if(f.type==="routeRows"){
        label.classList.add("route-rows-field");
        const rows=Array.isArray(initial[f.name])?initial[f.name]:[{text:"",destination:""},{text:"",destination:""}];
        label.append(renderRouteRows(rows.map(r=>({...r}))));
      }else{
        let el;
        if(f.type==="textarea"){
          el=document.createElement("textarea");
          el.rows=f.rows||4;
          if(f.rows>=6)el.classList.add("compact-textarea");
        }else{
          el=document.createElement("input");
          el.type=f.type||"text";
          if(f.min!==undefined)el.min=f.min;
        }
        el.name=f.name;
        el.value=initial[f.name]??f.value??"";
        if(f.required)el.required=true;
        label.append(el);
      }
      host.append(label);
    });
    $("editorBackdrop").classList.remove("hidden");
    function close(value){
      $("editorBackdrop").classList.add("hidden");
      $("editorForm").onsubmit=null;
      $("editorClose").onclick=null;
      $("editorCancel").onclick=null;
      editorOpen=false;
      resolve(value);
    }
    $("editorClose").onclick=()=>close(null);
    $("editorCancel").onclick=()=>close(null);
    $("editorForm").onsubmit=e=>{
      e.preventDefault();
      const result={};
      fields.forEach(f=>{
        if(f.type==="routeRows")result[f.name]=routeRows.map(r=>({...r}));
        else result[f.name]=new FormData($("editorForm")).get(f.name)||"";
      });
      close(result);
    };
  });
}

async function addProgram(){
  if(!admin())return;
  const v=await openEditor("Новая программа",[
    {name:"title",label:"Название программы",required:true},
    {name:"description",label:"Описание",type:"textarea",rows:3},
    {name:"isFree",label:"Доступ",type:"select",value:"false"}
  ],{isFree:"false"});
  if(!v||!v.title.trim())return;
  course.programs.push({id:uid("program"),title:v.title.trim(),description:v.description.trim(),isFree:v.isFree==="true",sections:[]});
  selected=course.programs.at(-1).id;
  activeSectionId=null;
  await changed("Программа добавлена.");
}

async function editProgram(id){
  if(!admin())return;
  const p=course.programs.find(x=>x.id===id);if(!p)return;
  const v=await openEditor("Изменить программу",[
    {name:"title",label:"Название программы",required:true},
    {name:"description",label:"Описание",type:"textarea",rows:3},
    {name:"isFree",label:"Доступ",type:"select"}
  ],{title:p.title,description:p.description||"",isFree:programIsFree(p)?"true":"false"});
  if(!v||!v.title.trim())return;
  p.title=v.title.trim();p.description=v.description.trim();p.isFree=v.isFree==="true";
  await changed("Программа изменена.");
}

async function deleteProgram(id){
  if(!admin())return;
  const p=course.programs.find(x=>x.id===id);if(!p)return;
  if(!confirm(`Удалить программу «${p.title}» и все её рубрики и задания?`))return;
  course.programs=course.programs.filter(x=>x.id!==id);
  selected=course.programs[0]?.id||null;
  activeSectionId=course.programs[0]?.sections?.[0]?.id||null;
  await changed("Программа удалена.");
}

async function addSection(programId){
  if(!admin())return;
  const p=course.programs.find(x=>x.id===programId);if(!p)return;
  const v=await openEditor("Новая рубрика",[
    {name:"rubricNumber",label:"Номер рубрики",type:"number",min:1,required:true},
    {name:"title",label:"Название рубрики",required:true},
    {name:"description",label:"Описание",type:"textarea",rows:3},
    {name:"nextRubricNumber",label:"Номер следующей рубрики (необязательно)",type:"number",min:1}
  ],{rubricNumber:String((p.sections||[]).length+1)});
  if(!v||!v.title.trim()||!v.rubricNumber.trim())return;
  if(findRubricByNumber(p,v.rubricNumber)){notify("Такая рубрика уже существует.");return}
  const s={id:uid("section"),rubricNumber:v.rubricNumber.trim(),title:v.title.trim(),description:v.description.trim(),nextRubricNumber:v.nextRubricNumber.trim(),questions:[]};
  p.sections||=[];p.sections.push(s);
  selected=programId;activeSectionId=s.id;
  await changed("Рубрика добавлена.");
}

async function editSection(id){
  if(!admin())return;
  const s=findSection(id);if(!s)return;
  const p=course.programs.find(x=>(x.sections||[]).some(y=>y.id===id));
  const v=await openEditor("Изменить рубрику",[
    {name:"rubricNumber",label:"Номер рубрики",type:"number",min:1,required:true},
    {name:"title",label:"Название рубрики",required:true},
    {name:"description",label:"Описание",type:"textarea",rows:3},
    {name:"nextRubricNumber",label:"Номер следующей рубрики (необязательно)",type:"number",min:1}
  ],{rubricNumber:rubricNumber(s,p.sections.indexOf(s)),title:s.title,description:s.description||"",nextRubricNumber:s.nextRubricNumber||""});
  if(!v||!v.title.trim()||!v.rubricNumber.trim())return;
  const duplicate=findRubricByNumber(p,v.rubricNumber);
  if(duplicate&&duplicate.id!==id){notify("Такая рубрика уже существует.");return}
  Object.assign(s,{rubricNumber:v.rubricNumber.trim(),title:v.title.trim(),description:v.description.trim(),nextRubricNumber:v.nextRubricNumber.trim()});
  selected=p.id;activeSectionId=id;
  await changed("Рубрика изменена.");
}

async function deleteSection(id){
  if(!admin())return;
  const s=findSection(id);if(!s)return;
  if(!confirm(`Удалить рубрику «${s.title}» и все задания в ней?`))return;
  const p=course.programs.find(x=>(x.sections||[]).some(y=>y.id===id));
  p.sections=p.sections.filter(x=>x.id!==id);
  activeSectionId=p.sections[0]?.id||null;
  await changed("Рубрика удалена.");
}
