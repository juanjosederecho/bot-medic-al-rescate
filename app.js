const modal=document.querySelector('#modal');
const content=document.querySelector('#modalContent');
const toast=document.querySelector('#toast');
let lastFocus=null;
let recognition=null;
let mediaStream=null;

const PHONE='900973658';
const LS_THEME='medicTheme';
const LS_CONTACTS='medicContacts';
const LS_FONT='medicFont';

function showToast(msg){toast.textContent=msg;toast.classList.add('show');setTimeout(()=>toast.classList.remove('show'),3200)}
function escapeHTML(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function showModal(html){lastFocus=document.activeElement;content.innerHTML=html;modal.classList.add('open');modal.setAttribute('aria-hidden','false');document.body.style.overflow='hidden';setTimeout(()=>modal.querySelector('button,input,a,textarea')?.focus(),30)}
function closeModal(){stopMedia();modal.classList.remove('open');modal.setAttribute('aria-hidden','true');document.body.style.overflow='';content.innerHTML='';lastFocus?.focus?.()}
function stopMedia(){if(mediaStream){mediaStream.getTracks().forEach(t=>t.stop());mediaStream=null}if(recognition){try{recognition.stop()}catch(e){}recognition=null}}

function applyTheme(t){document.documentElement.setAttribute('data-theme',t);localStorage.setItem(LS_THEME,t);const meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.content=t==='dark'?'#0b1520':'#0a7f8c'}
function initTheme(){const saved=localStorage.getItem(LS_THEME);const pref=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';applyTheme(saved||pref)}

const symptoms=[
  {id:'fiebre',label:'Fiebre o malestar',q:['¿Cuántos días llevas con fiebre?','¿Hay dificultad para respirar?','¿Hay rigidez de cuello o confusión?']},
  {id:'dolor',label:'Dolor (cabeza, pecho, abdomen)',q:['¿Dónde duele exactamente?','¿El dolor es intenso o súbito?','¿Hay vómitos, desmayo o sudoración fría?']},
  {id:'herida',label:'Herida o golpe',q:['¿Sangra mucho o no para?','¿Puedes mover la zona?','¿Hubo pérdida de conocimiento?']},
  {id:'respirar',label:'Dificultad para respirar',q:['¿Empeora al caminar o hablar?','¿Hay labios azulados?','¿Es la primera vez que te pasa?']},
  {id:'animo',label:'Ansiedad o bajo ánimo',q:['¿Te sientes en peligro ahora?','¿Puedes pedir ayuda a alguien cercano?','¿Quieres un ejercicio de respiración?']}
];

function openFeature(name){
  const map={chat:startChat,firstAid:showAid,calm:startCalm,camera:openCamera,alternativa:showAlt,urgentBox:showUrgent,emergency:showEmergency};
  (map[name]||startChat)();
}

function startChat(){
  showModal(`<h2 id="modalTitle">Conversar con Medic</h2>
  <p class="safety-note">Cuéntame qué sientes por texto o audio. Haré preguntas para entender mejor. No diagnostico.</p>
  <div class="chat-log" id="chatLog"></div>
  <div class="choice-grid" id="symChoices">${symptoms.map(s=>`<button type="button" data-sym="${s.id}">${s.label}</button>`).join('')}</div>
  <div class="chat-input-row">
    <input id="chatInput" placeholder="Escribe tu consulta..." aria-label="Mensaje">
    <button type="button" id="micBtn" title="Hablar">🎤</button>
    <button type="button" id="sendBtn">Enviar</button>
  </div>`);
  botSay('Hola, soy Medic 👋. ¿Qué te preocupa hoy? Puedes elegir una opción o escribir/hablar.');
  wireChat();
}

function botSay(t){const log=document.querySelector('#chatLog');if(!log)return;log.innerHTML+=`<div class="bubble bot">${escapeHTML(t)}</div>`;log.scrollTop=log.scrollHeight}
function userSay(t){const log=document.querySelector('#chatLog');if(!log)return;log.innerHTML+=`<div class="bubble user">${escapeHTML(t)}</div>`;log.scrollTop=log.scrollHeight}

function wireChat(){
  const input=document.querySelector('#chatInput');
  document.querySelector('#sendBtn')?.addEventListener('click',()=>handleUserText(input.value));
  input?.addEventListener('keydown',e=>{if(e.key==='Enter')handleUserText(input.value)});
  document.querySelector('#symChoices')?.addEventListener('click',e=>{const b=e.target.closest('[data-sym]');if(!b)return;startSymptomFlow(b.dataset.sym)});
  document.querySelector('#micBtn')?.addEventListener('click',toggleMic);
}

function handleUserText(raw){
  const text=(raw||'').trim();if(!text)return;
  const input=document.querySelector('#chatInput');if(input)input.value='';
  userSay(text);
  const lower=text.toLowerCase();
  if(/accident|emergenc|urgencia|desmayo|sangrado fuerte|no respira/.test(lower)){botSay('Suena urgente. Si hay peligro inmediato, llama ya al '+PHONE+' o SAMU 106.');showUrgentHints();return}
  const hit=symptoms.find(s=>lower.includes(s.id)||lower.includes(s.label.split(' ')[0].toLowerCase()));
  if(hit){startSymptomFlow(hit.id);return}
  botSay('Gracias. Para orientarte mejor, elige el tema más cercano o dame un poco más de detalle (desde cuándo, intensidad, si hay fiebre o dificultad para respirar).');
}

let flow=null;
function startSymptomFlow(id){
  const s=symptoms.find(x=>x.id===id);if(!s)return;
  flow={s,i:0,answers:[]};
  document.querySelector('#symChoices')?.remove();
  userSay(s.label);
  botSay('Vamos a precisar un poco. '+s.q[0]);
  const input=document.querySelector('#chatInput');
  const send=document.querySelector('#sendBtn');
  const handler=()=>{
    const v=(input.value||'').trim();if(!v)return;input.value='';
    userSay(v);flow.answers.push(v);flow.i++;
    if(flow.i<s.q.length){botSay(s.q[flow.i]);return}
    finishSymptom(s,flow.answers);send.removeEventListener('click',handler);
  };
  send?.addEventListener('click',handler,{once:false});
  // replace send once with flow-aware - simpler: monkey patch
  send.onclick=()=>{const v=(input.value||'').trim();if(!v)return;input.value='';userSay(v);flow.answers.push(v);flow.i++;if(flow.i<s.q.length)botSay(s.q[flow.i]);else{finishSymptom(s,flow.answers);send.onclick=()=>handleUserText(input.value)}};
}

function finishSymptom(s,answers){
  const joined=answers.join(' | ').toLowerCase();
  const red=/mucho|fuerte|súbit|subit|no puedo|desmayo|azul|confus|pecho|ahogo|inconsciente/.test(joined);
  if(red||s.id==='respirar'){
    botSay('Hay señales que merecen evaluación presencial pronto. Llama a '+PHONE+' o acude a emergencia si empeora. Mientras, mantén la calma y evita esfuerzo.');
  }else if(s.id==='animo'){
    botSay('Gracias por contarlo. Puedes probar respiración guiada. Si te sientes en riesgo, llama a la Línea 113 opción 5 o a '+PHONE+'.');
  }else{
    botSay('Orientación general: hidrátate, reposa y observa. Si empeora en 24–48 h o aparecen señales de alarma, busca atención. Esto no es un diagnóstico.');
  }
  botSay('¿Quieres ver primeros auxilios, calma o la casilla de emergencia?');
}

function toggleMic(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){showToast('Tu navegador no soporta dictado por voz');return}
  if(recognition){recognition.stop();recognition=null;showToast('Micrófono detenido');return}
  recognition=new SR();recognition.lang='es-PE';recognition.interimResults=false;
  recognition.onresult=e=>{const t=e.results[0][0].transcript;const input=document.querySelector('#chatInput');if(input)input.value=t;handleUserText(t)};
  recognition.onerror=()=>showToast('No pude escuchar. Prueba de nuevo.');
  recognition.onend=()=>{recognition=null};
  recognition.start();showToast('Escuchando… habla ahora');
}

function showAid(){
  const items=[
    ['Quemadura leve','Enfría con agua tibia 10–20 min. No uses pasta ni hielo directo. Cubre limpio.'],
    ['Sangrado','Presión firme con tela limpia. Si no para o es abundante: emergencia.'],
    ['Atragantamiento','Tos vigorosa. Si no puede toser/hablar: pide ayuda y maniobra de Heimlich si sabes hacerla.'],
    ['Desmayo','Acuesta, eleva piernas, aire fresco. Si no despierta: llama emergencia.'],
    ['Golpe leve','Hielo envuelto 10 min. Observa dolor intenso, vómito o confusión.']
  ];
  showModal(`<h2 id="modalTitle">Primeros auxilios</h2><img src="images/firstaid.jpg" alt="" style="width:100%;border-radius:18px;margin:.6rem 0 1rem;max-height:180px;object-fit:cover"><div class="aid-grid">${items.map(([t,d])=>`<button type="button" data-aid="${escapeHTML(t)}"><strong>${t}</strong><br><small>${d}</small></button>`).join('')}</div><p class="safety-note">Guías educativas. En duda, llama ${PHONE}.</p>`);
}

function startCalm(){
  showModal(`<h2 id="modalTitle">Pausa de 1 minuto</h2><img src="images/wellness.jpg" alt="" style="width:100%;border-radius:18px;margin:.6rem 0;max-height:180px;object-fit:cover"><p>Inhala 4 segundos, sostén 4, exhala 6. Repite 6 veces.</p><p id="calmTimer" style="font-size:2rem;font-weight:800;text-align:center">Listo</p><button class="primary-btn" type="button" id="startCalmBtn">Comenzar</button><p class="safety-note">Si necesitas apoyo: Línea 113 opción 5 o ${PHONE}.</p>`);
  document.querySelector('#startCalmBtn')?.addEventListener('click',runCalm);
}
function runCalm(){const el=document.querySelector('#calmTimer');const steps=['Inhala…','Sostén…','Exhala…'];let i=0,n=0;const tick=()=>{if(n>=18){el.textContent='Bien hecho';return}el.textContent=steps[i%3];i++;n++;setTimeout(tick,4000)};tick()}

function showUrgent(){
  showModal(`<h2 id="modalTitle">Consultas no establecidas</h2>
  <p>Eventos, accidentes o emergencias fuera de lo habitual.</p>
  <div class="choice-grid">
    <a class="chip" href="tel:${PHONE}" style="text-decoration:none">📞 Llamar ${PHONE}</a>
    <a class="chip" href="tel:106" style="text-decoration:none">🚑 SAMU 106</a>
    <a class="chip" href="tel:105" style="text-decoration:none">🚓 Policía 105</a>
    <a class="chip" href="tel:116" style="text-decoration:none">🔥 Bomberos 116</a>
    <button type="button" data-open="chat">Seguir con Medic por chat</button>
  </div>
  <img src="images/emergency.jpg" alt="" style="width:100%;border-radius:18px;margin-top:1rem;max-height:160px;object-fit:cover">`);
  content.querySelector('[data-open="chat"]')?.addEventListener('click',startChat);
}
function showUrgentHints(){/* already messaged */}
function showEmergency(){showUrgent()}

function showAlt(){
  showModal(`<h2 id="modalTitle">Medicina alternativa</h2><img src="images/alternativa.jpg" alt="" style="width:100%;border-radius:18px;margin:.6rem 0;max-height:180px;object-fit:cover">
  <ul>
    <li>Infusión de manzanilla: puede ayudar a relajar (evitar si alergia).</li>
    <li>Miel y limón: alivio suave de garganta irritada (no en menores de 1 año).</li>
    <li>Menta: sensación de frescura; no sustituye tratamiento.</li>
  </ul>
  <p class="safety-note"><strong>Importante:</strong> esto es orientación cultural/educativa. No reemplaza indicación médica ni suspende tratamientos prescritos. Ante síntomas graves, llama ${PHONE}.</p>`);
}

async function openCamera(){
  showModal(`<h2 id="modalTitle">Cámara guía</h2>
  <p class="safety-note">Toma una foto de un producto o una lesión leve. Medic solo da orientación general, no identifica con certeza ni diagnostica.</p>
  <div class="camera-box"><video id="camVideo" autoplay playsinline></video><img class="preview" id="camPreview" alt="" hidden></div>
  <div class="camera-actions">
    <button class="primary-btn" type="button" id="shotBtn">Capturar</button>
    <label class="secondary-btn" style="cursor:pointer">Subir foto<input type="file" accept="image/*" capture="environment" id="fileCam" hidden></label>
  </div>
  <p id="camResult" class="safety-note"></p>`);
  try{
    mediaStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:false});
    const v=document.querySelector('#camVideo');v.srcObject=mediaStream;
  }catch(e){showToast('Sin acceso a cámara: puedes subir una foto');}
  document.querySelector('#shotBtn')?.addEventListener('click',()=>{
    const v=document.querySelector('#camVideo');const c=document.createElement('canvas');c.width=v.videoWidth||640;c.height=v.videoHeight||480;c.getContext('2d').drawImage(v,0,0);const url=c.toDataURL('image/jpeg',0.85);showCamResult(url);
  });
  document.querySelector('#fileCam')?.addEventListener('change',e=>{const f=e.target.files?.[0];if(!f)return;const url=URL.createObjectURL(f);showCamResult(url)});
}
function showCamResult(url){
  const prev=document.querySelector('#camPreview');const v=document.querySelector('#camVideo');
  if(prev){prev.src=url;prev.hidden=false}if(v)v.style.display='none';
  const r=document.querySelector('#camResult');
  if(r)r.innerHTML='Revisión educativa: si es un medicamento, verifica prospecto y fecha. Si es una lesión con sangrado abundante, dolor intenso, deformidad o signos de infección, busca atención. Puedes llamar a <a href="tel:'+PHONE+'">'+PHONE+'</a>.';
}

function loadContacts(){
  try{return JSON.parse(localStorage.getItem(LS_CONTACTS)||'null')}catch(e){return null}
}
function renderContacts(){
  const box=document.querySelector('#contactsList');if(!box)return;
  const c=loadContacts();
  if(!c){box.innerHTML='<p class="safety-note">Aún no guardas contactos personales.</p>';return}
  box.innerHTML=`<a href="tel:${escapeHTML(c.p1)}">${escapeHTML(c.n1)} <span>${escapeHTML(c.p1)}</span></a>
  <a href="tel:${escapeHTML(c.p2)}">${escapeHTML(c.n2)} <span>${escapeHTML(c.p2)}</span></a>`;
}

function findNearby(){
  if(!navigator.geolocation){showToast('Geolocalización no disponible');return}
  showToast('Buscando centros cercanos…');
  navigator.geolocation.getCurrentPosition(pos=>{
    const {latitude:lat,longitude:lng}=pos.coords;
    const q=encodeURIComponent('centro de salud hospital farmacia');
    window.open(`https://www.google.com/maps/search/${q}/@${lat},${lng},14z`,'_blank');
  },()=>showToast('No pude obtener tu ubicación'),{enableHighAccuracy:true,timeout:10000});
}

function wire(){
  initTheme();
  document.querySelector('#themeBtn')?.addEventListener('click',()=>{
    const cur=document.documentElement.getAttribute('data-theme')==='dark'?'light':'dark';applyTheme(cur);
  });
  document.querySelector('#fontBtn')?.addEventListener('click',()=>{
    const cur=parseFloat(getComputedStyle(document.documentElement).fontSize)||16;
    const next=cur>=20?15:cur+2;document.documentElement.style.setProperty('--base',next+'px');localStorage.setItem(LS_FONT,String(next));
  });
  const savedFont=localStorage.getItem(LS_FONT);if(savedFont)document.documentElement.style.setProperty('--base',savedFont+'px');
  document.querySelectorAll('[data-open]').forEach(el=>el.addEventListener('click',()=>openFeature(el.getAttribute('data-open'))));
  document.querySelector('#nearbyBtn')?.addEventListener('click',findNearby);
  document.querySelector('#nearbyBtn2')?.addEventListener('click',findNearby);
  modal?.addEventListener('click',e=>{if(e.target.matches('[data-close],.modal-backdrop'))closeModal()});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&modal.classList.contains('open'))closeModal()});
  document.querySelector('#contactsForm')?.addEventListener('submit',e=>{
    e.preventDefault();const fd=new FormData(e.target);
    const data={n1:fd.get('n1'),p1:fd.get('p1'),n2:fd.get('n2'),p2:fd.get('p2')};
    localStorage.setItem(LS_CONTACTS,JSON.stringify(data));renderContacts();showToast('Contactos guardados');e.target.reset();
  });
  renderContacts();
  if('serviceWorker' in navigator){navigator.serviceWorker.register('sw.js').catch(()=>{})}
}
wire();
