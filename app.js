(() => {
  'use strict';

  const PHONE = '900973658';
  const LS_THEME = 'medicTheme';
  const LS_VOICE = 'medicVoiceOn';
  const DB_NAME = 'MedicAlRescateDB';
  const DB_VER = 2;

  const SYSTEM_PROMPT = `Eres Medic, asistente educativo de orientación en salud del prototipo "Bot Medic al Rescate" (Colegio Rosas Pata, Perú).
Reglas estrictas:
- Responde en español claro, cálido y humano (como un orientador de salud, no como robot).
- NO diagnostiques enfermedades ni recetes medicamentos ni dosis.
- Da orientación general, señales de alarma y cuándo buscar ayuda profesional.
- Si hay emergencia (dificultad respiratoria severa, dolor de pecho intenso, sangrado abundante, pérdida de conciencia, convulsiones, sospecha de ACV), indica llamar YA al ${PHONE} o SAMU 106.
- Sé breve (máx ~120 palabras) salvo que pidan más detalle.
- Si preguntan por remedios caseros, aclara que no reemplazan atención médica.`;

  const modal = document.querySelector('#modal');
  const content = document.querySelector('#modalContent');
  const toastEl = document.querySelector('#toast');
  const aiStatus = document.querySelector('#aiStatus');
  const onlinePill = document.querySelector('#onlinePill');

  let db = null;
  let lastFocus = null;
  let mediaStream = null;
  let recognition = null;
  let chatHistory = [];
  let voiceOn = localStorage.getItem(LS_VOICE) !== '0';
  let preferredVoice = null;

  /* ========== Utils ========== */
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    setTimeout(() => toastEl.classList.remove('show'), 3400);
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ========== Theme ========== */
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem(LS_THEME, t);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = t === 'dark' ? '#0b1520' : '#0a7f8c';
  }
  function initTheme() {
    const saved = localStorage.getItem(LS_THEME);
    const pref = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    applyTheme(saved || pref);
  }

  /* ========== IndexedDB ========== */
  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = (e) => {
        const d = e.target.result;
        ['consultas', 'contactos', 'fotos', 'ajustes'].forEach(name => {
          if (!d.objectStoreNames.contains(name)) {
            const store = d.createObjectStore(name, { keyPath: 'id', autoIncrement: true });
            store.createIndex('createdAt', 'createdAt', { unique: false });
          }
        });
      };
      req.onsuccess = () => { db = req.result; resolve(db); };
      req.onerror = () => reject(req.error);
    });
  }
  function txStore(name, mode = 'readonly') {
    return db.transaction(name, mode).objectStore(name);
  }
  function addRow(store, value) {
    return new Promise(async (resolve, reject) => {
      if (!db) await openDB();
      const req = txStore(store, 'readwrite').add({ ...value, createdAt: new Date().toISOString() });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function getAll(store) {
    return new Promise(async (resolve, reject) => {
      if (!db) await openDB();
      const req = txStore(store).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }
  function clearStore(store) {
    return new Promise(async (resolve, reject) => {
      if (!db) await openDB();
      const req = txStore(store, 'readwrite').clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  /* ========== Natural voice (TTS) ========== */
  function pickVoice() {
    const voices = speechSynthesis.getVoices();
    if (!voices.length) return null;
    const prefer = [
      v => /google.*español.*estados|google español us|es-us.*google/i.test(`${v.name} ${v.lang}`),
      v => /google.*español|google español/i.test(v.name) && /^es/i.test(v.lang),
      v => /microsoft.*(sabina|elena|elvira|dalia|jorge|alonso)/i.test(v.name),
      v => /es-PE|es-MX|es-US|es-AR|es-CO/i.test(v.lang) && /natural|neural|online/i.test(v.name),
      v => /es-MX|es-US|es-PE/i.test(v.lang),
      v => /^es/i.test(v.lang)
    ];
    for (const fn of prefer) {
      const hit = voices.find(fn);
      if (hit) return hit;
    }
    return voices[0];
  }
  function refreshVoice() {
    preferredVoice = pickVoice();
  }
  speechSynthesis.onvoiceschanged = refreshVoice;
  refreshVoice();

  function speak(text) {
    if (!voiceOn || !window.speechSynthesis) return;
    const clean = String(text).replace(/[*#_>`]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!clean) return;
    speechSynthesis.cancel();
    // Speak in shorter chunks for more natural pacing
    const chunks = clean.match(/[^.!?。]+[.!?。]+|[^.!?。]+$/g) || [clean];
    chunks.forEach((chunk, i) => {
      const u = new SpeechSynthesisUtterance(chunk.trim());
      u.lang = (preferredVoice && preferredVoice.lang) || 'es-MX';
      if (preferredVoice) u.voice = preferredVoice;
      u.rate = 0.94;
      u.pitch = 1.02;
      u.volume = 1;
      if (i === 0) setTimeout(() => speechSynthesis.speak(u), 40);
      else speechSynthesis.speak(u);
    });
  }
  function stopSpeak() {
    try { speechSynthesis.cancel(); } catch (_) {}
  }

  /* ========== Modal ========== */
  function showModal(html) {
    lastFocus = document.activeElement;
    content.innerHTML = html;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    setTimeout(() => content.querySelector('button,input,textarea,a')?.focus(), 40);
  }
  function closeModal() {
    stopMedia();
    stopSpeak();
    if (recognition) { try { recognition.stop(); } catch (_) {} recognition = null; }
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    content.innerHTML = '';
    lastFocus?.focus?.();
  }
  function stopMedia() {
    if (mediaStream) {
      mediaStream.getTracks().forEach(t => t.stop());
      mediaStream = null;
    }
  }

  /* ========== Gemini AI API ========== */
  const AI_ENDPOINT = (location.hostname.endsWith('here.now') || location.hostname === 'localhost')
    ? '/api/gemini'
    : 'https://stormy-dune-65a3.here.now/api/gemini';

  function dataUrlToInline(dataUrl) {
    const m = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return null;
    return { mime_type: m[1], data: m[2] };
  }

  function extractGeminiText(data) {
    try {
      const parts = data?.candidates?.[0]?.content?.parts || [];
      return parts.map(p => p.text || '').join('\n').trim();
    } catch {
      return '';
    }
  }

  async function askAI(userText, extra = {}) {
    const historyBits = chatHistory.slice(-6).map(m => `${m.role === 'user' ? 'Usuario' : 'Medic'}: ${m.text}`).join('\n');
    let prompt = `Consulta del usuario: ${userText}`;
    if (historyBits) prompt += `\n\nContexto reciente:\n${historyBits}`;
    if (extra.imageBase64) prompt += '\n(El usuario envió una imagen para orientación educativa.)';

    const parts = [{ text: prompt }];
    if (extra.imageBase64) {
      const inline = dataUrlToInline(extra.imageBase64);
      if (inline) parts.push({ inline_data: inline });
    }

    const body = {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 512 }
    };

    const resp = await fetch(AI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(resp.status === 429 ? 'RATE' : ('HTTP_' + resp.status + (errText ? '' : '')));
    }
    const data = await resp.json();
    const text = extractGeminiText(data);
    if (!text) throw new Error('EMPTY');
    return text;
  }

  async function refreshAiStatus() {
    aiStatus.textContent = 'IA lista · Gemini (sin login)';
    aiStatus.className = 'ai-status ok';
    if (onlinePill) onlinePill.textContent = 'IA en vivo';
  }

  /* ========== Settings ========== */  /* ========== Settings ========== */
  function openSettings() {
    showModal(`
      <h2 id="modalTitle">Ajustes</h2>
      <p class="safety-note">La IA usa Gemini por un proxy seguro. <strong>No pide login ni API key</strong>.</p>
      <label style="display:flex;gap:.5rem;align-items:center;margin:1rem 0;font-weight:600">
        <input type="checkbox" id="voiceToggle" ${voiceOn ? 'checked' : ''}> Voz al responder
      </label>
      <div class="camera-actions">
        <button class="primary-btn" type="button" id="saveSettings">Guardar</button>
        <button class="secondary-btn" type="button" id="testAi">Probar IA</button>
      </div>
      <p id="settingsMsg" class="safety-note" style="margin-top:.8rem"></p>
    `);
    document.querySelector('#saveSettings').onclick = () => {
      voiceOn = document.querySelector('#voiceToggle').checked;
      localStorage.setItem(LS_VOICE, voiceOn ? '1' : '0');
      document.querySelector('#settingsMsg').textContent = 'Guardado.';
      toast('Ajustes guardados');
    };
    document.querySelector('#testAi').onclick = async () => {
      const msg = document.querySelector('#settingsMsg');
      msg.textContent = 'Probando IA…';
      try {
        const r = await askAI('Di solo: Hola, soy Medic y estoy listo para orientarte.');
        msg.textContent = 'OK: ' + r.slice(0, 160);
        speak(r);
        await refreshAiStatus();
      } catch (e) {
        msg.textContent = e.message === 'RATE'
          ? 'Demasiadas consultas. Espera un minuto.'
          : 'Error: ' + e.message;
      }
    };
  }

  /* ========== Chat with live AI ========== */
  function botBubble(html, asHtml = false) {
    const log = document.querySelector('#chatLog');
    if (!log) return;
    log.insertAdjacentHTML('beforeend', `<div class="bubble bot">${asHtml ? html : esc(html)}</div>`);
    log.scrollTop = log.scrollHeight;
  }
  function userBubble(text) {
    const log = document.querySelector('#chatLog');
    if (!log) return;
    log.insertAdjacentHTML('beforeend', `<div class="bubble user">${esc(text)}</div>`);
    log.scrollTop = log.scrollHeight;
  }
  function sysBubble(text) {
    const log = document.querySelector('#chatLog');
    if (!log) return;
    log.insertAdjacentHTML('beforeend', `<div class="bubble sys">${esc(text)}</div>`);
  }
  function showTyping() {
    const log = document.querySelector('#chatLog');
    if (!log) return;
    log.insertAdjacentHTML('beforeend', `<div class="bubble bot" id="typing"><span class="typing"><i></i><i></i><i></i></span></div>`);
    log.scrollTop = log.scrollHeight;
  }
  function hideTyping() {
    document.querySelector('#typing')?.remove();
  }

  function openChat(seed = '') {
    chatHistory = [];
    showModal(`
      <h2 id="modalTitle">Consulta con Medic (IA)</h2>
      <p class="safety-note">Respuestas generadas en tiempo real. No diagnostica ni receta.</p>
      <div class="chat-log" id="chatLog"></div>
      <div class="choice-grid" id="quickAsks">
        <button type="button" data-q="Tengo dolor de cabeza desde ayer, ¿qué debo observar?">Dolor de cabeza</button>
        <button type="button" data-q="Me quemé levemente con agua caliente, ¿qué hago?">Quemadura leve</button>
        <button type="button" data-q="Estoy con ansiedad y el pecho agitado, ¿cómo me calmo?">Ansiedad</button>
        <button type="button" data-q="Es una emergencia: hay alguien que no responde">Emergencia</button>
      </div>
      <div class="chat-input-row">
        <input id="chatInput" placeholder="Escribe tu consulta real…" autocomplete="off">
        <button type="button" class="ghost" id="micBtn" title="Dictar">🎤</button>
        <button type="button" id="sendBtn">Enviar</button>
      </div>
    `);
    botBubble('Hola, soy Medic. Cuéntame qué te preocupa y te oriento con IA en tiempo real.');
    if (voiceOn) speak('Hola, soy Medic. Cuéntame qué te preocupa.');

    const input = document.querySelector('#chatInput');
    const send = () => handleUserMessage(input.value);
    document.querySelector('#sendBtn').onclick = send;
    input.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
    document.querySelector('#micBtn').onclick = () => toggleMic(input);
    document.querySelector('#quickasks')?.addEventListener('click', e => {
      const b = e.target.closest('[data-q]');
      if (!b) return;
      handleUserMessage(b.dataset.q);
    });
    if (seed) setTimeout(() => handleUserMessage(seed), 200);
  }

  async function handleUserMessage(raw) {
    const text = (raw || '').trim();
    if (!text) return;
    const input = document.querySelector('#chatInput');
    if (input) input.value = '';
    document.querySelector('#quickasks')?.remove();
    userBubble(text);
    chatHistory.push({ role: 'user', text });

    showTyping();
    try {
      const reply = await askAI(text);
      hideTyping();
      botBubble(reply);
      chatHistory.push({ role: 'model', text: reply });
      speak(reply);
      await addRow('consultas', { pregunta: text, respuesta: reply, tipo: 'chat' });
    } catch (e) {
      hideTyping();
      const msg = e.message === 'RATE'
        ? 'Demasiadas consultas. Espera un minuto e intenta de nuevo.'
        : 'Hubo un problema al consultar la IA. Intenta de nuevo. Si es urgente: ' + PHONE;
      botBubble(msg);
      speak(msg);
    }
  }

  function toggleMic(inputEl) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast('Este navegador no soporta dictado por voz'); return; }
    const btn = document.querySelector('#micBtn');
    if (recognition) {
      recognition.stop();
      recognition = null;
      btn?.classList.remove('listening');
      toast('Micrófono detenido');
      return;
    }
    recognition = new SR();
    recognition.lang = 'es-PE';
    recognition.interimResults = false;
    recognition.continuous = false;
    btn?.classList.add('listening');
    toast('Escuchando… habla ahora');
    recognition.onresult = (e) => {
      const t = e.results[0][0].transcript;
      if (inputEl) inputEl.value = t;
      handleUserMessage(t);
    };
    recognition.onerror = () => toast('No escuché bien. Prueba otra vez.');
    recognition.onend = () => {
      btn?.classList.remove('listening');
      recognition = null;
    };
    recognition.start();
  }

  /* ========== Camera (real getUserMedia) ========== */
  async function openCamera() {
    showModal(`
      <h2 id="modalTitle">Cámara</h2>
      <p class="safety-note">La cámara debe pedir permiso del navegador. Luego puedes capturar o subir una foto para orientación educativa con IA.</p>
      <div class="camera-box">
        <video id="camVideo" autoplay playsinline muted></video>
        <img class="preview" id="camPreview" alt="Captura" hidden>
      </div>
      <div class="camera-actions">
        <button class="primary-btn" type="button" id="startCam">Encender cámara</button>
        <button class="secondary-btn" type="button" id="shotBtn" disabled>Capturar</button>
        <label class="secondary-btn" style="cursor:pointer">Subir foto
          <input type="file" accept="image/*" capture="environment" id="fileCam" hidden>
        </label>
        <button class="secondary-btn" type="button" id="askPhoto" disabled>Preguntar a la IA</button>
      </div>
      <p id="camMsg" class="safety-note"></p>
    `);

    let lastDataUrl = '';
    const video = document.querySelector('#camVideo');
    const preview = document.querySelector('#camPreview');
    const shotBtn = document.querySelector('#shotBtn');
    const askBtn = document.querySelector('#askPhoto');
    const msg = document.querySelector('#camMsg');

    async function startCam() {
      stopMedia();
      msg.textContent = 'Solicitando permiso…';
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false
        });
        video.srcObject = mediaStream;
        video.hidden = false;
        preview.hidden = true;
        await video.play();
        shotBtn.disabled = false;
        msg.textContent = 'Cámara encendida.';
        toast('Cámara activa');
      } catch (err) {
        msg.textContent = 'No se pudo encender la cámara (' + (err.name || 'error') + '). Usa “Subir foto” o revisa permisos del sitio.';
        toast('Sin acceso a cámara');
      }
    }

    document.querySelector('#startCam').onclick = startCam;
    // Auto-start on open (user already clicked a button → gesture)
    startCam();

    shotBtn.onclick = () => {
      if (!mediaStream) return;
      const c = document.createElement('canvas');
      c.width = video.videoWidth || 640;
      c.height = video.videoHeight || 480;
      c.getContext('2d').drawImage(video, 0, 0);
      lastDataUrl = c.toDataURL('image/jpeg', 0.85);
      preview.src = lastDataUrl;
      preview.hidden = false;
      video.hidden = true;
      askBtn.disabled = false;
      msg.textContent = 'Foto capturada. Puedes preguntar a la IA.';
    };

    document.querySelector('#fileCam').onchange = (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        lastDataUrl = reader.result;
        preview.src = lastDataUrl;
        preview.hidden = false;
        video.hidden = true;
        askBtn.disabled = false;
        stopMedia();
        msg.textContent = 'Imagen cargada.';
      };
      reader.readAsDataURL(f);
    };

    askBtn.onclick = async () => {
      if (!lastDataUrl) return;
      msg.textContent = 'Consultando IA…';
      askBtn.disabled = true;
      try {
        const reply = await askAI(
          'Te envío una imagen (posible producto, medicamento o lesión). Da orientación educativa general, sin diagnosticar ni inventar marcas. Indica cuándo acudir a un profesional.',
          { imageBase64: lastDataUrl, mimeType: 'image/jpeg' }
        );
        msg.textContent = reply;
        speak(reply);
        await addRow('fotos', { nota: reply, preview: lastDataUrl.slice(0, 80) + '…' });
        await addRow('consultas', { pregunta: '[imagen]', respuesta: reply, tipo: 'camera' });
      } catch (e) {
        msg.textContent = 'No pude analizar la imagen. Intenta otra foto o recarga la página.';
      }
      askBtn.disabled = false;
    };
  }

  /* ========== Other features ========== */
  function openFirstAid() {
    const items = [
      ['Quemadura leve', 'Enfriar con agua a temperatura ambiente 10–20 min. No uses pasta ni hielo directo.'],
      ['Sangrado', 'Presión firme con tela limpia. Si no para o es abundante: emergencia.'],
      ['Atragantamiento', 'Si tose, anímale a toser. Si no puede hablar/respirar: ayuda urgente y SAMU 106.'],
      ['Desmayo', 'Acostar, elevar piernas, aire fresco. Si no despierta: llama emergencia.']
    ];
    showModal(`
      <h2 id="modalTitle">Primeros auxilios</h2>
      <img src="images/firstaid.jpg" alt="" style="width:100%;border-radius:16px;max-height:160px;object-fit:cover;margin:.5rem 0 1rem">
      <div class="choice-grid">
        ${items.map(([t, d]) => `<button type="button" data-aid="${esc(t)}"><strong>${esc(t)}</strong><br><small>${esc(d)}</small></button>`).join('')}
      </div>
      <button class="primary-btn" type="button" id="aidAsk">Preguntar a la IA con más detalle</button>
    `);
    content.querySelector('.choice-grid').onclick = (e) => {
      const b = e.target.closest('[data-aid]');
      if (!b) return;
      const t = b.dataset.aid;
      const d = items.find(x => x[0] === t)?.[1] || '';
      speak(`${t}. ${d}`);
      toast(t);
    };
    document.querySelector('#aidAsk').onclick = () => openChat('Explícame primeros auxilios para una lesión leve y cuándo es emergencia');
  }

  function openCalm() {
    showModal(`
      <h2 id="modalTitle">Pausa de calma</h2>
      <img src="images/wellness.jpg" alt="" style="width:100%;border-radius:16px;max-height:160px;object-fit:cover;margin:.5rem 0">
      <p>Inhala 4 · sostén 4 · exhala 6. Te guío con voz.</p>
      <p id="calmTimer" style="font-size:1.8rem;font-weight:800;text-align:center">Listo</p>
      <button class="primary-btn" type="button" id="startCalm">Comenzar</button>
      <p class="safety-note">Si estás en crisis: Línea 113 opción 5 o ${PHONE}.</p>
    `);
    document.querySelector('#startCalm').onclick = () => {
      const el = document.querySelector('#calmTimer');
      const steps = [
        ['Inhala…', 'Inhala despacio por la nariz', 4000],
        ['Sostén…', 'Sostén el aire con suavidad', 4000],
        ['Exhala…', 'Exhala lento por la boca', 6000]
      ];
      let n = 0;
      const run = () => {
        if (n >= 9) { el.textContent = 'Bien hecho'; speak('Bien hecho. Puedes repetir cuando lo necesites.'); return; }
        const s = steps[n % 3];
        el.textContent = s[0];
        speak(s[1]);
        n++;
        setTimeout(run, s[2]);
      };
      run();
    };
  }

  function openUrgent() {
    showModal(`
      <h2 id="modalTitle">Emergencia / accidente</h2>
      <img src="images/emergency.jpg" alt="" style="width:100%;border-radius:16px;max-height:150px;object-fit:cover;margin:.5rem 0 1rem">
      <div class="choice-grid">
        <a class="secondary-btn" href="tel:${PHONE}" style="text-decoration:none">📞 Llamar ${PHONE}</a>
        <a class="secondary-btn" href="tel:106" style="text-decoration:none">🚑 SAMU 106</a>
        <a class="secondary-btn" href="tel:105" style="text-decoration:none">🚓 Policía 105</a>
        <a class="secondary-btn" href="tel:116" style="text-decoration:none">🔥 Bomberos 116</a>
        <button type="button" id="urgentAi">Describir situación a la IA</button>
      </div>
    `);
    document.querySelector('#urgentAi').onclick = () => openChat('Es una posible emergencia. Indícame qué hacer mientras llega ayuda profesional.');
  }

  function openAlt() {
    showModal(`
      <h2 id="modalTitle">Medicina alternativa</h2>
      <img src="images/alternativa.jpg" alt="" style="width:100%;border-radius:16px;max-height:160px;object-fit:cover;margin:.5rem 0">
      <p class="safety-note"><strong>No reemplaza</strong> consulta médica ni tratamientos indicados.</p>
      <button class="primary-btn" type="button" id="altAi">Consultar a la IA</button>
    `);
    document.querySelector('#altAi').onclick = () => openChat('Quiero orientación general sobre remedios caseros suaves (manzanilla, miel, menta) y sus límites. Recuerda que no reemplazan al médico.');
  }

  async function openHistory() {
    const rows = (await getAll('consultas')).reverse().slice(0, 30);
    showModal(`
      <h2 id="modalTitle">Historial (base de datos)</h2>
      <p class="safety-note">Consultas guardadas en IndexedDB de este dispositivo.</p>
      <div class="choice-grid" style="max-height:50vh;overflow:auto">
        ${rows.length ? rows.map(r => `<div class="bubble bot"><strong>${esc(r.tipo || 'chat')}</strong> · ${esc((r.createdAt || '').slice(0, 19))}<br><small>${esc((r.pregunta || '').slice(0, 80))}</small><br>${esc((r.respuesta || '').slice(0, 160))}…</div>`).join('') : '<p class="safety-note">Aún no hay consultas.</p>'}
      </div>
      <div class="camera-actions">
        <button class="secondary-btn" type="button" id="exportDb">Exportar JSON</button>
        <button class="secondary-btn" type="button" id="clearDb">Borrar historial</button>
      </div>
    `);
    document.querySelector('#exportDb').onclick = async () => {
      const data = {
        consultas: await getAll('consultas'),
        contactos: await getAll('contactos'),
        fotos: await getAll('fotos')
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'medic-historial.json';
      a.click();
    };
    document.querySelector('#clearDb').onclick = async () => {
      if (!confirm('¿Borrar historial de consultas?')) return;
      await clearStore('consultas');
      toast('Historial borrado');
      openHistory();
    };
  }

  function findNearby() {
    if (!navigator.geolocation) { toast('Geolocalización no disponible'); return; }
    toast('Buscando centros cercanos…');
    navigator.geolocation.getCurrentPosition(
      pos => {
        const { latitude: lat, longitude: lng } = pos.coords;
        window.open(`https://www.google.com/maps/search/centro+de+salud+hospital+farmacia/@${lat},${lng},14z`, '_blank');
      },
      () => toast('No pude obtener tu ubicación'),
      { enableHighAccuracy: true, timeout: 12000 }
    );
  }

  /* ========== Contacts ========== */
  async function renderContacts() {
    const box = document.querySelector('#contactsList');
    if (!box) return;
    const rows = await getAll('contactos');
    const latest = rows[rows.length - 1];
    if (!latest) {
      box.innerHTML = '<p class="safety-note">Aún no hay contactos guardados.</p>';
      return;
    }
    box.innerHTML = `
      <a href="tel:${esc(latest.p1)}">${esc(latest.n1)} <span>${esc(latest.p1)}</span></a>
      <a href="tel:${esc(latest.p2)}">${esc(latest.n2)} <span>${esc(latest.p2)}</span></a>`;
  }

  /* ========== Router ========== */
  function go(name) {
    const map = {
      chat: () => openChat(),
      camera: openCamera,
      firstAid: openFirstAid,
      calm: openCalm,
      urgent: openUrgent,
      alt: openAlt,
      history: openHistory,
      nearby: findNearby,
      settings: openSettings
    };
    (map[name] || openChat)();
  }

  async function boot() {
    initTheme();
    try { await openDB(); } catch (_) { toast('Base de datos no disponible en este navegador'); }
    await refreshAiStatus();
    await renderContacts();

    document.querySelector('#themeBtn')?.addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      applyTheme(cur);
    });
    document.querySelector('#settingsBtn')?.addEventListener('click', openSettings);
    document.querySelector('#openChatBtn')?.addEventListener('click', () => openChat());
    document.querySelector('#openCameraBtn')?.addEventListener('click', openCamera);
    document.querySelectorAll('[data-go]').forEach(el => el.addEventListener('click', () => go(el.getAttribute('data-go'))));

    modal?.addEventListener('click', e => {
      if (e.target.matches('[data-close], .modal-backdrop')) closeModal();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && modal.classList.contains('open')) closeModal();
    });

    document.querySelector('#contactsForm')?.addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      await addRow('contactos', {
        n1: fd.get('n1'), p1: fd.get('p1'),
        n2: fd.get('n2'), p2: fd.get('p2')
      });
      e.target.reset();
      await renderContacts();
      toast('Contactos guardados en la base de datos');
    });

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  boot();
})();
