
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
    body=`<div class="options">${(q.options||[]).map((o,i)=>`<button type="button" class="option ${r&&i===q.answer?"good":r&&i===r.selected?"bad":""}" data-a="${i}" ${r?"disabled":""}>${esc(o)}</button>`).join("")}</div>${r?`<div class="feedback ${r.correct?"correct":"wrong"}"><b>${r.correct?"Правильно!":"Неправильно."}</b> ${esc(q.explanation||"")}${!r.correct?`<p>Правильный ответ: ${esc(q.options?.[q.answer]||"")}</p>`:""}</div>`:""}`;
  }
  const adminButtons=admin()?`<div class="question-admin-actions" style="display:flex!important;flex-wrap:wrap;gap:10px;margin-top:16px;padding-top:12px;border-top:1px solid #dbe3ef;visibility:visible!important;opacity:1!important">
    <button type="button" class="light" style="display:inline-flex!important;visibility:visible!important;opacity:1!important" data-editq="${esc(q.id)}">✏️ Редактировать задание</button>
    <button type="button" class="danger" style="display:inline-flex!important;visibility:visible!important;opacity:1!important" data-delq="${esc(q.id)}">🗑️ Удалить задание</button>
  </div>`:"";
  return `<div class="question" data-q="${esc(q.id)}"><b>${qi+1}. ${esc(inline?"":q.text)}</b>${body}${adminButtons}</div>`;
}
function renderLesson(){
  const el=$("lesson"),p=course.programs.find(x=>x.id===selected);
  if(!p){el.innerHTML=`<div class="panel"><h2>Химический тренажёр</h2><p>${admin()?"Создай первую программу кнопкой слева.":"Администратор ещё не добавил программы."}</p></div>`;return}
  if(!canOpen(p)){el.innerHTML='<div class="panel"><h2>Программа закрыта</h2><p>Для доступа нужен промокод.</p></div>';return}
  const pi=course.programs.indexOf(p),sections=p.sections||[];
  if(!sections.some(s=>s.id===activeSectionId))activeSectionId=sections[0]?.id||null;
  const active=sections.find(s=>s.id===activeSectionId)||null,idx=active?sections.indexOf(active):-1;
  const targetNumber=active?.nextRubricNumber,complete=sectionComplete(active),target=transitionTarget(p,active);
  el.innerHTML=`<div class="lesson-head"><small>ПРОГРАММА ${pi+1} ИЗ ${course.programs.length}</small><h2>${esc(p.title)}</h2><p>${esc(p.description||"")}</p></div>
  ${sections.length?`<div class="rubric-layout">${admin()?`<nav class="rubric-nav" aria-label="Рубрики">${sections.map((s,i)=>`<button type="button" class="rubric-link ${s.id===activeSectionId?"active":""}" data-rubric="${esc(s.id)}"><span>Рубрика ${esc(rubricNumber(s,i))}</span><small>${esc(s.title||"Без названия")}</small></button>`).join("")}</nav>`:""}
  <article class="section rubric-content ${admin()?"":"student-rubric-content"}"><div class="rubric-topline"><small>РУБРИКА ${esc(rubricNumber(active,idx))}</small>${active?.nextRubricNumber?`<span class="transition-note">После выполнения → рубрика ${esc(active.nextRubricNumber)}</span>`:""}</div><h3>${esc(active?.title||"")}</h3><div class="theory">${esc(active?.text||"")}</div>
  ${(active?.questions||[]).map((q,i)=>renderQuestionHTML(q,i)).join("")}
  ${!admin()&&complete&&targetNumber!==undefined&&String(targetNumber).trim()!==""?`<div class="rubric-navigation-buttons"><button type="button" id="studentNext">${target?`Перейти к рубрике ${esc(String(targetNumber).trim())} →`:`Рубрика ${esc(String(targetNumber).trim())} не найдена`}</button></div>`:""}
  ${admin()?`<div class="rubric-navigation-buttons">${idx>0?`<button type="button" class="light" id="prevRubric">← Предыдущая рубрика</button>`:""}${idx>=0&&idx<sections.length-1?`<button type="button" class="light" id="nextRubric">Следующая по списку →</button>`:""}</div><div class="admin-actions"><button type="button" data-addq="${esc(active.id)}">+ Задание</button><button type="button" data-edits="${esc(active.id)}">Изменить рубрику</button><button type="button" class="danger" data-dels="${esc(active.id)}">Удалить рубрику</button></div>`:""}</article></div>`:`<div class="panel">В этой программе пока нет рубрик.</div>`}
  ${admin()?`<div class="panel"><h3>Управление программой</h3><div class="admin-actions"><button type="button" id="addSection">+ Рубрика</button><button type="button" id="editProgram">Изменить программу</button><button type="button" class="danger" id="deleteProgram">Удалить программу</button></div></div>`:""}`;
  el.querySelectorAll("[data-rubric]").forEach(b=>b.onclick=()=>{activeSectionId=b.dataset.rubric;renderLesson()});
  el.querySelectorAll("[data-route-answer]").forEach(form=>form.onsubmit=async e=>{
    e.preventDefault();
    const q=allQuestions().find(x=>x.id===form.dataset.routeAnswer);
    if(!q||progress[q.id]?.answered)return;
    const selectedInput=form.querySelector('input[name="routeChoice"]:checked');
    if(!selectedInput){notify("Выбери вариант ответа.");return}
    const choice=Number(selectedInput.value),destination=String(q.destinations?.[choice]??"").trim();
    const p=course.programs.find(x=>(x.sections||[]).some(sec=>(sec.questions||[]).some(item=>item.id===q.id)));
    const target=findRubricByNumber(p,destination);
    if(!target){notify(`Рубрика №${destination} не найдена. Ответ не сохранён; проверь настройки маршрута.`);return}
    const previous=progress[q.id];
    progress[q.id]={selected:choice,answered:true,correct:true,date:new Date().toISOString()};
    try{
      await saveProgress();
      selected=p.id;activeSectionId=target.id;render();
      notify(`Переход в рубрику ${destination}.`);
      window.scrollTo({top:0,behavior:"smooth"});
    }catch(err){
      if(previous)progress[q.id]=previous;else delete progress[q.id];
      notify("Ошибка сохранения ответа: "+err.message);renderLesson();
    }
  });
  el.querySelectorAll("[data-q]").forEach(qel=>qel.querySelectorAll("[data-a]").forEach(b=>b.onclick=async()=>{const q=allQuestions().find(x=>x.id===qel.dataset.q);if(!q||progress[q.id])return;const a=Number(b.dataset.a);progress[q.id]={selected:a,correct:a===Number(q.answer),answered:true,date:new Date().toISOString()};await submitQuestionAnswer(q)}));
  el.querySelectorAll("[data-free-answer]").forEach(form=>form.onsubmit=async e=>{e.preventDefault();const q=allQuestions().find(x=>x.id===form.dataset.freeAnswer);if(!q||progress[q.id])return;const response=new FormData(form).get("response").toString().trim();if(!response){notify("Напиши ответ перед сохранением.");return}progress[q.id]={response,answered:true,correct:false,date:new Date().toISOString()};await submitQuestionAnswer(q)});
  el.querySelectorAll("[data-inline-answer]").forEach(form=>form.onsubmit=async e=>{e.preventDefault();const q=allQuestions().find(x=>x.id===form.dataset.inlineAnswer);if(!q||progress[q.id])return;const responses=[...form.querySelectorAll("[data-blank]")].map(i=>i.value.trim());if(responses.some(x=>!x)){notify("Заполни все поля ответа.");return}const expected=Array.isArray(q.acceptedAnswers)?q.acceptedAnswers:[];const correct=responses.length===expected.length&&responses.every((value,i)=>{const allowed=Array.isArray(expected[i])?expected[i]:[expected[i]];return allowed.some(a=>normalizeAnswer(value)===normalizeAnswer(a))});progress[q.id]={responses,answered:true,correct,date:new Date().toISOString()};await submitQuestionAnswer(q)});
  el.querySelectorAll("[data-addq]").forEach(b=>b.onclick=()=>addQuestion(b.dataset.addq));el.querySelectorAll("[data-edits]").forEach(b=>b.onclick=()=>editSection(b.dataset.edits));el.querySelectorAll("[data-dels]").forEach(b=>b.onclick=()=>deleteSection(b.dataset.dels));
  el.querySelectorAll("[data-editq]").forEach(b=>b.onclick=()=>editQuestion(b.dataset.editq));el.querySelectorAll("[data-delq]").forEach(b=>b.onclick=()=>deleteQuestion(b.dataset.delq));
  $("prevRubric")?.addEventListener("click",()=>{if(idx>0){activeSectionId=sections[idx-1].id;renderLesson()}});
  $("nextRubric")?.addEventListener("click",()=>{if(idx>=0&&idx<sections.length-1){activeSectionId=sections[idx+1].id;renderLesson()}});
  $("studentNext")?.addEventListener("click",()=>{const next=transitionTarget(p,active);if(!next){notify(`Рубрика с номером ${String(targetNumber).trim()} не найдена. Остаёмся в текущей рубрике.`);return}activeSectionId=next.id;renderLesson();window.scrollTo({top:0,behavior:"smooth"})});
  $("addSection")?.addEventListener("click",addSection);$("editProgram")?.addEventListener("click",()=>editProgram(p.id));$("deleteProgram")?.addEventListener("click",()=>deleteProgram(p.id));
}
async function submitQuestionAnswer(q){
  try{await saveProgress();renderLesson();const p=course.programs.find(x=>x.id===selected),s=findSection(activeSectionId);if(sectionComplete(s)&&s?.nextRubricNumber){const target=transitionTarget(p,s);notify(target?`Все задания выполнены. Можно перейти к рубрике ${String(s.nextRubricNumber)}.`:`Ответ сохранён. Рубрика ${String(s.nextRubricNumber)} пока не найдена.`)}else notify("Ответ сохранён.")}
  catch(e){delete progress[q.id];notify("Ошибка сохранения ответа: "+e.message);renderLesson()}
}
function openEditor(title,fields,initial={}){
  editorOpen=true;return new Promise(resolve=>{
    const backdrop=$("editorBackdrop"),form=$("editorForm"),fieldsEl=$("editorFields");
    $("editorTitle").textContent=title;fieldsEl.innerHTML="";
    fields.forEach(f=>{const value=initial[f.name]??f.value??"",label=document.createElement("label");label.textContent=f.label+(f.required?" *":"");let input;
      if(f.type==="routeRows"){
        label.className="route-rows-field";const rows=document.createElement("div");rows.id="editor_routeRows";rows.className="route-editor-rows";
        const seed=Array.isArray(initial.routeRows)?initial.routeRows:[{text:"",destination:""},{text:"",destination:""}];
        const addRow=(text="",destination="")=>{const row=document.createElement("div");row.className="route-editor-row";const area=document.createElement("textarea");area.rows=2;area.placeholder="Текст варианта ответа";area.value=text;area.required=true;const number=document.createElement("input");number.type="number";number.min="1";number.placeholder="№ рубрики";number.value=destination;number.required=true;const remove=document.createElement("button");remove.type="button";remove.className="light route-remove";remove.textContent="×";remove.onclick=()=>{if(rows.children.length>2)row.remove();else notify("Нужно оставить минимум два варианта.")};row.append(area,number,remove);rows.appendChild(row)};
        seed.forEach(r=>addRow(r.text||"",r.destination||""));label.appendChild(rows);const add=document.createElement("button");add.type="button";add.className="light route-add";add.textContent="+ Добавить вариант";add.onclick=()=>addRow();label.appendChild(add);if(f.help){const help=document.createElement("span");help.className="field-help";help.textContent=f.help;label.appendChild(help)}fieldsEl.appendChild(label);return;
      }
      if(f.type==="textarea"){input=document.createElement("textarea");input.rows=f.rows||5;input.value=value}
      else if(f.type==="select"){input=document.createElement("select");(f.options||[]).forEach(o=>{const option=document.createElement("option");option.value=o.value;option.textContent=o.label;input.appendChild(option)});input.value=value||f.options?.[0]?.value||""}
      else{input=document.createElement("input");input.type=f.type||"text";input.value=value;if(f.min!==undefined)input.min=f.min;if(f.maxlength)input.maxLength=f.maxlength}
      input.id="editor_"+f.name;input.name=f.name;input.required=!!f.required;if(f.placeholder&&"placeholder"in input)input.placeholder=f.placeholder;label.appendChild(input);
      if(f.help){const help=document.createElement("span");help.className="field-help";help.textContent=f.help;label.appendChild(help)}fieldsEl.appendChild(label)});
    backdrop.classList.remove("hidden");fieldsEl.querySelector("input,textarea,select")?.focus();let finished=false;
    const cleanup=v=>{if(finished)return;finished=true;editorOpen=false;backdrop.classList.add("hidden");form.removeEventListener("submit",submit);$("editorClose").removeEventListener("click",cancel);$("editorCancel").removeEventListener("click",cancel);backdrop.removeEventListener("click",outside);document.removeEventListener("keydown",key);resolve(v)};
    const cancel=()=>cleanup(null),outside=e=>{if(e.target===backdrop)cancel()},key=e=>{if(e.key==="Escape")cancel()};
    const submit=e=>{e.preventDefault();if(!form.reportValidity())return;const values={};fields.forEach(f=>{if(f.type==="routeRows")values.routeRows=[...$("editor_routeRows").querySelectorAll(".route-editor-row")].map(row=>({text:row.querySelector("textarea").value.trim(),destination:row.querySelector("input").value.trim()}));else values[f.name]=$("editor_"+f.name).value});cleanup(values)};
    form.addEventListener("submit",submit);$("editorClose").addEventListener("click",cancel);$("editorCancel").addEventListener("click",cancel);backdrop.addEventListener("click",outside);document.addEventListener("keydown",key);
  })
}
async function addProgram(){if(!admin())return;const v=await openEditor("Добавить программу",[{name:"title",label:"Название программы",required:true},{name:"description",label:"Краткое описание",type:"textarea",rows:3},{name:"access",label:"Доступ",type:"select",value:"free",options:[{value:"free",label:"Бесплатная"},{value:"paid",label:"Платная — нужен полный доступ / промокод"}]}]);if(!v||!v.title.trim())return;course.programs.push({id:uid("program"),title:v.title.trim(),description:v.description.trim(),isFree:v.access==="free",sections:[]});selected=course.programs.at(-1).id;activeSectionId=null;await changed("Программа создана.")}
async function editProgram(id){const p=course.programs.find(x=>x.id===id);if(!admin()||!p)return;const v=await openEditor("Изменить программу",[{name:"title",label:"Название программы",required:true},{name:"description",label:"Краткое описание",type:"textarea",rows:3},{name:"access",label:"Доступ",type:"select",value:programIsFree(p)?"free":"paid",options:[{value:"free",label:"Бесплатная"},{value:"paid",label:"Платная — нужен полный доступ / промокод"}]}],{...p,access:programIsFree(p)?"free":"paid"});if(!v||!v.title.trim())return;p.title=v.title.trim();p.description=v.description.trim();p.isFree=v.access==="free";await changed("Программа обновлена.")}
async function deleteProgram(id){const p=course.programs.find(x=>x.id===id);if(!admin()||!p||!confirm(`Удалить программу «${p.title}» вместе с рубриками и заданиями?`))return;(p.sections||[]).flatMap(s=>s.questions||[]).forEach(q=>delete progress[q.id]);course.programs=course.programs.filter(x=>x.id!==id);selected=course.programs[0]?.id||null;activeSectionId=null;try{await saveCourse();await saveProgress();render();notify("Программа удалена.")}catch(e){notify(e.message)}}
async function addSection(){const p=course.programs.find(x=>x.id===selected);if(!admin()||!p)return;const v=await openEditor("Добавить рубрику",[{name:"rubricNumber",label:"Индивидуальный номер рубрики",type:"number",required:true,value:String((p.sections||[]).length+1),help:"Номер используется для переходов и не обязан совпадать с позицией в списке."},{name:"title",label:"Название рубрики",required:true},{name:"text",label:"Учебный текст / теория",type:"textarea",rows:9},{name:"nextRubricNumber",label:"Номер рубрики для перехода после выполнения (необязательно)",type:"number",help:"Можно указать рубрику, которую добавишь позже."}]);if(!v||!v.title.trim())return;p.sections||=[];p.sections.push({id:uid("section"),rubricNumber:v.rubricNumber.trim(),title:v.title.trim(),text:v.text,nextRubricNumber:v.nextRubricNumber.trim(),questions:[]});activeSectionId=p.sections.at(-1).id;await changed("Рубрика добавлена.")}
async function editSection(id){const s=findSection(id),p=course.programs.find(p=>(p.sections||[]).some(x=>x.id===id));if(!admin()||!s||!p)return;const v=await openEditor("Изменить рубрику",[{name:"rubricNumber",label:"Индивидуальный номер рубрики",type:"number",required:true,value:String(rubricNumber(s,p.sections.indexOf(s)))},{name:"title",label:"Название рубрики",required:true},{name:"text",label:"Учебный текст / теория",type:"textarea",rows:12},{name:"nextRubricNumber",label:"Номер рубрики для перехода (необязательно)",type:"number",help:"Номер не проверяется при сохранении."}],{...s,rubricNumber:String(rubricNumber(s,p.sections.indexOf(s))),nextRubricNumber:s.nextRubricNumber??""});if(!v||!v.title.trim())return;s.rubricNumber=v.rubricNumber.trim();s.title=v.title.trim();s.text=v.text;s.nextRubricNumber=v.nextRubricNumber.trim();await changed("Рубрика изменена.")}
async function deleteSection(id){const p=course.programs.find(p=>(p.sections||[]).some(s=>s.id===id)),s=findSection(id);if(!admin()||!p||!s||!confirm(`Удалить рубрику «${s.title}» и её задания?`))return;(s.questions||[]).forEach(q=>delete progress[q.id]);p.sections=p.sections.filter(x=>x.id!==id);if(activeSectionId===id)activeSectionId=p.sections[0]?.id||null;try{await saveCourse();await saveProgress();render();notify("Рубрика удалена.")}catch(e){notify(e.message)}}
async function addQuestion(id){
  if(!admin())return;const ownerProgramId=course.programs.find(p=>(p.sections||[]).some(s=>s.id===id))?.id;if(!ownerProgramId)return;selected=ownerProgramId;activeSectionId=id;
  const kind=await openEditor("Выбери тип задания",[{name:"type",label:"Тип задания",type:"select",value:"choice",options:[{value:"choice",label:"Выбор одного правильного варианта"},{value:"route",label:"Выбор маршрута — переход в рубрику по ответу"},{value:"text",label:"Текст задания со встроенными полями {{input}}"},{value:"essay",label:"Свободный ответ без автоматической проверки"}]}]);if(!kind)return;let q;
  if(kind.type==="route"){
    const v=await openEditor("Задание с выбором маршрута",[
      {name:"text",label:"Текст вопроса",type:"textarea",rows:4,required:true},
      {name:"routeRows",label:"Варианты ответа и рубрики назначения",type:"routeRows",required:true,help:"У каждого варианта своё поле текста и маленькое поле номера рубрики. Можно добавлять варианты кнопкой."}
    ]);
    if(!v||!v.text.trim())return;
    const rows=v.routeRows||[],options=rows.map(r=>r.text),destinations=rows.map(r=>r.destination);
    if(rows.length<2||rows.some(r=>!r.text||!/^[0-9]+$/.test(r.destination))){notify("Заполни текст и номер рубрики для каждого варианта.");return}
    q={id:uid("question"),type:"route",text:v.text.trim(),options,destinations};
  }
  else if(kind.type==="text"){const v=await openEditor("Задание со встроенными полями",[{name:"text",label:"Текст задания",type:"textarea",rows:7,required:true,help:"Добавь {{input}} в каждое место для ответа."},{name:"explanation",label:"Объяснение после проверки",type:"textarea",rows:3}]);if(!v||!v.text.trim())return;const n=(v.text.match(/\{\{input\}\}/g)||[]).length;if(!n){notify("Добавь хотя бы один маркер {{input}}.");return}const fields=Array.from({length:n},(_,i)=>({name:"a"+i,label:`Правильный ответ для окошка №${i+1}`,required:true,help:"Несколько допустимых ответов раздели символом |"}));const answers=await openEditor("Правильные ответы",fields);if(!answers)return;const acceptedAnswers=fields.map(f=>String(answers[f.name]||"").split("|").map(x=>x.trim()).filter(Boolean));if(acceptedAnswers.some(a=>!a.length)){notify("Укажи ответ для каждого поля.");return}q={id:uid("question"),type:"text",text:v.text.trim(),acceptedAnswers,explanation:v.explanation.trim()}}
  else if(kind.type==="essay"){const v=await openEditor("Свободный ответ",[{name:"text",label:"Текст задания",type:"textarea",rows:5,required:true},{name:"modelAnswer",label:"Ответ для самостоятельной проверки",type:"textarea",rows:3},{name:"explanation",label:"Инструкция",type:"textarea",rows:3}]);if(!v||!v.text.trim())return;q={id:uid("question"),type:"essay",text:v.text.trim(),modelAnswer:v.modelAnswer.trim(),explanation:v.explanation.trim()}}
  else{const v=await openEditor("Вопрос с вариантами",[{name:"text",label:"Текст вопроса",type:"textarea",rows:4,required:true},{name:"options",label:"Варианты — по одному на строку",type:"textarea",rows:5,required:true,value:"Вариант 1\nВариант 2\nВариант 3"},{name:"answer",label:"Номер правильного варианта",type:"number",min:1,required:true,value:"1"},{name:"explanation",label:"Объяснение",type:"textarea",rows:3}]);if(!v||!v.text.trim())return;const options=v.options.split(/\r?\n/).map(x=>x.trim()).filter(Boolean),a=Number(v.answer)-1;if(options.length<2){notify("Нужно минимум два варианта.");return}if(!Number.isInteger(a)||a<0||a>=options.length){notify("Номер правильного ответа вне диапазона.");return}q={id:uid("question"),type:"choice",text:v.text.trim(),options,answer:a,explanation:v.explanation.trim()}}
  const live=findSection(id);if(!live){notify("Рубрика не найдена. Обнови страницу.");return}live.questions||=[];live.questions.push(q);selected=ownerProgramId;activeSectionId=id;await changed("Задание добавлено.")
}

function findQuestion(id){
  for(const p of course.programs||[]) for(const s of p.sections||[]) {
    const q=(s.questions||[]).find(q=>q.id===id);
    if(q) return {program:p,section:s,question:q};
  }
  return null;
}
async function editQuestion(id){
  if(!admin())return;
  const found=findQuestion(id);if(!found)return;
  const {program,section,question:q}=found;
  let updated=null;
  if(q.type==="route"){
    const v=await openEditor("Редактировать выбор маршрута",[
      {name:"text",label:"Текст вопроса",type:"textarea",rows:4,required:true},
      {name:"routeRows",label:"Варианты ответа и рубрики назначения",type:"routeRows",required:true,help:"Измени текст или номер рубрики, удали ненужные варианты либо добавь новые."}
    ],{text:q.text||"",routeRows:(q.options||[]).map((text,i)=>({text,destination:q.destinations?.[i]||""}))});
    if(!v||!v.text.trim())return;
    const rows=v.routeRows||[],options=rows.map(r=>r.text),destinations=rows.map(r=>r.destination);
    if(rows.length<2||rows.some(r=>!r.text||!/^[0-9]+$/.test(r.destination))){notify("Заполни текст и номер рубрики для каждого варианта.");return}
    updated={...q,type:"route",text:v.text.trim(),options,destinations};
  }else if(q.type==="text"){
    const v=await openEditor("Редактировать задание с полями",[
      {name:"text",label:"Текст задания",type:"textarea",rows:7,required:true,help:"Каждое поле ответа обозначается маркером {{input}}."},
      {name:"explanation",label:"Объяснение после проверки",type:"textarea",rows:3}
    ],{text:q.text||"",explanation:q.explanation||""});
    if(!v||!v.text.trim())return;
    const n=(v.text.match(/\{\{input\}\}/g)||[]).length;
    if(!n){notify("Добавь хотя бы один маркер {{input}}.");return}
    const existing=Array.isArray(q.acceptedAnswers)?q.acceptedAnswers:[];
    const fields=Array.from({length:n},(_,i)=>({name:"a"+i,label:`Правильный ответ для окошка №${i+1}`,required:true,help:"Несколько допустимых ответов раздели символом |"}));
    const initial={};
    fields.forEach((f,i)=>{const val=existing[i];initial[f.name]=Array.isArray(val)?val.join(" | "):(val??"")});
    const answers=await openEditor("Правильные ответы",fields,initial);if(!answers)return;
    const acceptedAnswers=fields.map(f=>String(answers[f.name]||"").split("|").map(x=>x.trim()).filter(Boolean));
    if(acceptedAnswers.some(a=>!a.length)){notify("Укажи ответ для каждого поля.");return}
    updated={...q,text:v.text.trim(),acceptedAnswers,explanation:v.explanation.trim()};
  }else if(q.type==="essay"||q.type==="free_text"){
    const v=await openEditor("Редактировать свободный ответ",[
      {name:"text",label:"Текст задания",type:"textarea",rows:5,required:true},
      {name:"modelAnswer",label:"Ответ для самостоятельной проверки",type:"textarea",rows:3},
      {name:"explanation",label:"Инструкция",type:"textarea",rows:3}
    ],{text:q.text||"",modelAnswer:q.modelAnswer||"",explanation:q.explanation||""});
    if(!v||!v.text.trim())return;
    updated={...q,text:v.text.trim(),modelAnswer:v.modelAnswer.trim(),explanation:v.explanation.trim()};
  }else{
    const v=await openEditor("Редактировать вопрос",[
      {name:"text",label:"Текст вопроса",type:"textarea",rows:4,required:true},
      {name:"options",label:"Варианты — по одному на строку",type:"textarea",rows:5,required:true},
      {name:"answer",label:"Номер правильного варианта",type:"number",min:1,required:true},
      {name:"explanation",label:"Объяснение",type:"textarea",rows:3}
    ],{text:q.text||"",options:(q.options||[]).join("\n"),answer:String(Number(q.answer||0)+1),explanation:q.explanation||""});
    if(!v||!v.text.trim())return;
    const options=v.options.split(/\r?\n/).map(x=>x.trim()).filter(Boolean),answer=Number(v.answer)-1;
    if(options.length<2){notify("Нужно минимум два варианта.");return}
    if(!Number.isInteger(answer)||answer<0||answer>=options.length){notify("Номер правильного ответа вне диапазона.");return}
    updated={...q,text:v.text.trim(),options,answer,explanation:v.explanation.trim()};
  }
  const answerKeyChanged=JSON.stringify({type:q.type,options:q.options,answer:q.answer,destinations:q.destinations,acceptedAnswers:q.acceptedAnswers,modelAnswer:q.modelAnswer})!==JSON.stringify({type:updated.type,options:updated.options,answer:updated.answer,destinations:updated.destinations,acceptedAnswers:updated.acceptedAnswers,modelAnswer:updated.modelAnswer});
  Object.assign(q,updated);
  if(answerKeyChanged)delete progress[q.id];
  selected=program.id;activeSectionId=section.id;
  try{await saveCourse();if(answerKeyChanged)await saveProgress();render();notify(answerKeyChanged?"Задание изменено. Старый результат сброшен, так как изменился правильный ответ.":"Задание изменено.")}
  catch(e){notify("Ошибка сохранения задания: "+e.message);console.error(e)}
}
async function deleteQuestion(id){
  if(!admin())return;
  const found=findQuestion(id);if(!found)return;
  if(!confirm("Удалить это задание и сохранённые ответы учеников на него?"))return;
  found.section.questions=(found.section.questions||[]).filter(q=>q.id!==id);
  delete progress[id];
  selected=found.program.id;activeSectionId=found.section.id;
  try{await saveCourse();await saveProgress();render();notify("Задание удалено.")}
  catch(e){notify("Ошибка удаления задания: "+e.message);console.error(e)}
}

async function managePromos(){
  if(!admin())return;const panel=$("adminPanel");panel.classList.remove("hidden");$("lesson").classList.add("hidden");
  try{const promos=await dataOrThrow(await sb.from("promo_codes").select("*").order("created_at",{ascending:false}));
    panel.innerHTML=`<h2>Промокоды</h2><form id="makePromo"><label>Код<input id="promoCodeNew" required maxlength="40" placeholder="CHEM2026"></label><label>Лимит использований (0 — без лимита)<input id="promoLimitNew" type="number" min="0" value="1" required></label><button type="submit">Создать промокод</button></form><h3>Список</h3>${promos.length?promos.map(p=>`<div class="admin-row"><span><b>${esc(p.code)}</b> · ${p.active?"активен":"выключен"} · ${p.uses}/${p.max_uses||"∞"}</span><button type="button" data-toggle="${esc(p.code)}">${p.active?"Отключить":"Включить"}</button><button type="button" class="danger" data-remove="${esc(p.code)}">Удалить</button></div>`).join(""):"<p>Промокодов пока нет.</p>"}<button type="button" id="back" class="light">Назад</button>`;
    $("makePromo").onsubmit=async e=>{e.preventDefault();const code=$("promoCodeNew").value.trim().toUpperCase(),max_uses=Number($("promoLimitNew").value);if(!/^[A-Z0-9_-]{3,40}$/.test(code)){notify("Используй латиницу, цифры, дефис или подчёркивание.");return}const {error}=await sb.from("promo_codes").insert({code,max_uses,active:true});if(error)notify(error.message);else{notify("Промокод создан.");await managePromos()}};
    panel.querySelectorAll("[data-toggle]").forEach(b=>b.onclick=async()=>{const p=promos.find(x=>x.code===b.dataset.toggle),{error}=await sb.from("promo_codes").update({active:!p.active}).eq("code",p.code);if(error)notify(error.message);else await managePromos()});
    panel.querySelectorAll("[data-remove]").forEach(b=>b.onclick=async()=>{if(!confirm("Удалить промокод?"))return;const {error}=await sb.from("promo_codes").delete().eq("code",b.dataset.remove);if(error)notify(error.message);else await managePromos()});
    $("back").onclick=()=>{panel.classList.add("hidden");$("lesson").classList.remove("hidden");render()}
  }catch(e){notify("Не удалось загрузить промокоды: "+e.message);console.error(e)}
}
function setup(){
  $("login").addEventListener("submit",signIn);$("signup").addEventListener("click",signUp);$("logout").addEventListener("click",logout);$("newProgram").addEventListener("click",addProgram);$("manage").addEventListener("click",()=>managePromos());$("search").addEventListener("input",renderPrograms);
  sb.auth.getSession().then(({data,error})=>{if(error)msg(error.message);else if(data.session?.user)boot(data.session.user)}).catch(e=>msg(e.message));
  sb.auth.onAuthStateChange((_event,session)=>{if(session?.user&&!user)setTimeout(()=>boot(session.user),0)});
  setInterval(async()=>{if(!user||editorOpen)return;try{const fresh=await dataOrThrow(await sb.rpc("get_course_data"));if(JSON.stringify(fresh)!==JSON.stringify(course)){course=fresh||{programs:[]};if(!Array.isArray(course.programs))course.programs=[];if(!course.programs.some(p=>p.id===selected))selected=(course.programs.find(canOpen)||course.programs[0])?.id||null;const p=course.programs.find(p=>p.id===selected);if(!p?.sections?.some(s=>s.id===activeSectionId))activeSectionId=p?.sections?.[0]?.id||null;render()}}catch(e){console.warn("Фоновое обновление курса:",e.message)}},15000)
}
setup();
