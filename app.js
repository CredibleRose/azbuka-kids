(() => {
  'use strict';

  const $app = document.getElementById('app');
  const COLORS = ['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#38d9a9', '#4dabf7', '#9775fa', '#f783ac'];
  const ROUNDS = 10;

  // ---------- Хранилище (работает и без localStorage) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* приватный режим */ } },
  };

  const state = {
    lang: store.get('abc.lang', 'ru'),
    sound: store.get('abc.sound', true),
    seen: store.get('abc.seen', { ru: [], en: [] }),
    screen: 'home',
    idx: 0,
    game: null,
  };
  if (!window.ALPHABETS[state.lang]) state.lang = 'ru';
  for (const k of Object.keys(window.ALPHABETS)) if (!Array.isArray(state.seen[k])) state.seen[k] = [];

  const A = () => window.ALPHABETS[state.lang];
  const color = (i) => COLORS[i % COLORS.length];
  const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- Подсказки ----------
  const toasted = new Set();
  function toast(msg, once) {
    if (once) { if (toasted.has(once)) return; toasted.add(once); }
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.getElementById('toasts').appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  // ---------- Озвучка (Web Speech API) ----------
  const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
  let voices = [];
  function loadVoices() { voices = synth ? synth.getVoices() : []; }
  if (synth) { loadVoices(); synth.addEventListener?.('voiceschanged', loadVoices); }

  function pickVoice(lang) {
    const want = lang.toLowerCase();
    const prefix = want.slice(0, 2);
    const list = voices.filter((v) => v.lang.toLowerCase().replace('_', '-').startsWith(prefix));
    if (!list.length) return null;
    const score = (v) => (/natural|online/i.test(v.name) ? 4 : 0) + (/google/i.test(v.name) ? 2 : 0)
      + (v.lang.toLowerCase().replace('_', '-') === want ? 1 : 0);
    return list.sort((a, b) => score(b) - score(a))[0];
  }

  let speakTimer = 0;
  function speak(parts, rate = 0.85) {
    if (!state.sound) return;
    if (!synth) { toast('Этот браузер не умеет озвучивать текст. Попробуйте Chrome, Edge или Safari.', 'nospeech'); return; }
    const lang = A().speechLang;
    const voice = pickVoice(lang);
    if (!voice && voices.length) {
      toast(state.lang === 'ru'
        ? 'В системе нет русского голоса — озвучка может звучать с акцентом.'
        : 'В системе нет английского голоса — озвучка может звучать с акцентом.', 'novoice-' + state.lang);
    }
    synth.cancel();
    clearTimeout(speakTimer);
    // Небольшая пауза после cancel() — иначе Chrome иногда глотает новую фразу.
    speakTimer = setTimeout(() => {
      [].concat(parts).forEach((text) => {
        const u = new SpeechSynthesisUtterance(text);
        u.lang = lang;
        if (voice) u.voice = voice;
        u.rate = rate;
        u.pitch = 1.15;
        synth.speak(u);
      });
    }, 60);
  }
  function stopSpeech() { clearTimeout(speakTimer); if (synth) synth.cancel(); }

  // ---------- Звуковые эффекты (Web Audio, без файлов) ----------
  let ac = null;
  function tone(freq, dur, type = 'triangle', when = 0, vol = 0.18) {
    if (!state.sound) return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume();
      const t = ac.currentTime + when;
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(ac.destination);
      o.start(t);
      o.stop(t + dur + 0.05);
    } catch { /* без звука */ }
  }
  const sfx = {
    pop() { tone(740, 0.1, 'sine', 0, 0.15); },
    good() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.28, 'triangle', i * 0.08)); },
    bad() { tone(230, 0.22, 'square', 0, 0.06); tone(175, 0.3, 'square', 0.13, 0.06); },
    win() { [523, 659, 784, 659, 784, 1047].forEach((f, i) => tone(f, 0.3, 'triangle', i * 0.12)); },
  };

  // ---------- Конфетти ----------
  const cv = document.getElementById('confetti');
  const cx = cv.getContext('2d');
  let parts = [];
  let raf = 0;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function sizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  sizeCanvas();
  addEventListener('resize', sizeCanvas);
  function confetti(x = innerWidth / 2, y = innerHeight / 3, n = 140, power = 1) {
    if (reduced) n = Math.min(n, 20);
    for (let i = 0; i < n; i++) {
      parts.push({
        x, y,
        vx: (Math.random() - 0.5) * 16 * power,
        vy: (-Math.random() * 13 - 4) * power,
        s: 7 + Math.random() * 9,
        c: rand(COLORS),
        r: Math.random() * 6,
        vr: (Math.random() - 0.5) * 0.35,
        round: Math.random() < 0.4,
      });
    }
    if (!raf) raf = requestAnimationFrame(tick);
  }
  function tick() {
    cx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.vy += 0.38; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      cx.save();
      cx.translate(p.x, p.y);
      cx.rotate(p.r);
      cx.fillStyle = p.c;
      cx.strokeStyle = '#2b2d42';
      cx.lineWidth = 2;
      cx.beginPath();
      if (p.round) cx.arc(0, 0, p.s / 2, 0, Math.PI * 2);
      else cx.rect(-p.s / 2, -p.s / 3, p.s, p.s * 0.66);
      cx.fill(); cx.stroke();
      cx.restore();
    }
    parts = parts.filter((p) => p.y < innerHeight + 40);
    raf = parts.length ? requestAnimationFrame(tick) : 0;
    if (!raf) cx.clearRect(0, 0, innerWidth, innerHeight);
  }
  function burstFrom(el, n = 40) {
    const r = el.getBoundingClientRect();
    confetti(r.left + r.width / 2, r.top + r.height / 2, n, 0.7);
  }

  // ---------- Маскот (оригинальный персонаж — «Буквоша») ----------
  function mascot(size = '', mood = '') {
    return `
<svg class="mascot ${size} ${mood}" viewBox="0 0 120 130" aria-hidden="true">
  <g class="m-all" stroke="#2b2d42" stroke-width="4" stroke-linejoin="round" stroke-linecap="round">
    <path d="M60 32 L60 18" fill="none"/>
    <path d="M58 20 C50 4 34 6 32 13 C38 22 50 24 58 20Z" fill="#69db7c"/>
    <path d="M62 20 C70 4 86 6 88 13 C82 22 70 24 62 20Z" fill="#8ce99a"/>
    <ellipse cx="42" cy="118" rx="13" ry="7" fill="#ff922b"/>
    <ellipse cx="78" cy="118" rx="13" ry="7" fill="#ff922b"/>
    <ellipse cx="17" cy="80" rx="9" ry="13" fill="#ffa94d" transform="rotate(20 17 80)"/>
    <ellipse class="arm-r" cx="103" cy="70" rx="9" ry="13" fill="#ffa94d" transform="rotate(-25 103 70)"/>
    <ellipse cx="60" cy="74" rx="45" ry="43" fill="#ffa94d" stroke-width="5"/>
    <ellipse cx="60" cy="90" rx="27" ry="21" fill="#ffe8cc" stroke="none"/>
    <circle cx="44" cy="62" r="11" fill="#fff"/>
    <circle cx="76" cy="62" r="11" fill="#fff"/>
    <circle cx="46" cy="64" r="5" fill="#2b2d42" stroke="none"/>
    <circle cx="74" cy="64" r="5" fill="#2b2d42" stroke="none"/>
    <circle cx="48" cy="61.5" r="1.8" fill="#fff" stroke="none"/>
    <circle cx="76" cy="61.5" r="1.8" fill="#fff" stroke="none"/>
    <ellipse cx="32" cy="80" rx="7" ry="4.5" fill="#ff8787" stroke="none" opacity=".85"/>
    <ellipse cx="88" cy="80" rx="7" ry="4.5" fill="#ff8787" stroke="none" opacity=".85"/>
    <path class="mouth-happy" d="M47 82 Q60 100 73 82 Q60 89 47 82Z" fill="#e03131"/>
    <path class="mouth-sad" d="M50 92 Q60 83 70 92" fill="none"/>
  </g>
</svg>`;
  }
  function setMood(mood) {
    const el = $app.querySelector('.prompt .mascot');
    if (!el) return;
    el.classList.remove('sad', 'jump');
    void el.getBoundingClientRect(); // перезапуск анимации
    if (mood) el.classList.add(mood);
  }

  const soundBtn = () => `<button class="btn round" data-act="sound" aria-label="${state.sound ? 'Выключить звук' : 'Включить звук'}"><span class="emoji">${state.sound ? '🔊' : '🔇'}</span></button>`;
  const homeBtn = () => `<button class="btn round" data-act="home" aria-label="Все буквы"><span class="emoji">🏠</span></button>`;

  // ---------- Главная: все буквы ----------
  function renderHome() {
    state.screen = 'home';
    state.game = null;
    const a = A();
    const seen = new Set(state.seen[state.lang]);
    $app.innerHTML = `
<header class="topbar">
  <div class="brand">${mascot()}<h1>Весёлая Азбука</h1></div>
  <div class="actions">
    <div class="lang-switch" role="group" aria-label="Алфавит">
      ${Object.entries(window.ALPHABETS).map(([k, v]) =>
        `<button class="seg ${k === state.lang ? 'on' : ''}" data-act="lang" data-lang="${k}" aria-pressed="${k === state.lang}">${v.label}</button>`).join('')}
    </div>
    ${soundBtn()}
  </div>
</header>
<section class="hero">
  <button class="btn big green" data-act="games"><span class="emoji">🎮</span> Играть</button>
  <p class="progress">Изучено: ${seen.size} из ${a.letters.length} <span class="emoji">⭐</span></p>
</section>
<main class="grid">
  ${a.letters.map((L, i) => `
  <button class="tile" style="--c:${color(i)};--i:${i}" data-act="open" data-i="${i}" aria-label="Буква ${L.l}, ${esc(L.word)}">
    <span class="tile-letter">${L.l}<span class="lo">${L.lo}</span></span>
    <span class="tile-pic emoji">${L.pic}</span>
    ${seen.has(L.l) ? '<span class="tile-star">⭐</span>' : ''}
  </button>`).join('')}
</main>`;
  }

  // ---------- Карточка буквы ----------
  function highlight(L) {
    const i = L.word.toLowerCase().indexOf(L.lo);
    if (i < 0) return esc(L.word);
    return esc(L.word.slice(0, i)) + `<span class="hl">${esc(L.word[i])}</span>` + esc(L.word.slice(i + 1));
  }

  function markSeen(l) {
    const list = state.seen[state.lang];
    if (!list.includes(l)) { list.push(l); store.set('abc.seen', state.seen); }
  }

  function renderCard(i, silent) {
    const a = A();
    const n = a.letters.length;
    i = Math.max(0, Math.min(n - 1, i));
    const L = a.letters[i];
    state.screen = 'card';
    state.idx = i;
    markSeen(L.l);
    $app.innerHTML = `
<header class="topbar">
  ${homeBtn()}
  <div class="counter">${i + 1} / ${n}</div>
  ${soundBtn()}
</header>
<main class="card" style="--c:${color(i)}">
  <button class="card-letter" data-act="say-letter" aria-label="Послушать букву ${L.l}">${L.l}<span class="lo">${L.lo}</span></button>
  <div class="card-right">
    <button class="pic-blob" data-act="say-word" aria-label="Послушать слово ${esc(L.word)}"><span class="emoji">${L.pic}</span></button>
    <div class="word">${highlight(L)}</div>
  </div>
</main>
<nav class="card-nav">
  <button class="btn round" data-act="prev" aria-label="Предыдущая буква" ${i === 0 ? 'disabled' : ''}><span class="emoji">⬅️</span></button>
  <button class="btn yellow say" data-act="say-letter"><span class="emoji">🔊</span> Буква</button>
  <button class="btn sky say" data-act="say-word"><span class="emoji">🔊</span> Слово</button>
  <button class="btn round" data-act="next" aria-label="Следующая буква" ${i === n - 1 ? 'disabled' : ''}><span class="emoji">➡️</span></button>
</nav>`;
    if (!silent) speak([L.say, L.word]);
  }

  function wiggle(sel) {
    const el = $app.querySelector(sel);
    if (!el) return;
    el.classList.remove('wiggle');
    void el.offsetWidth;
    el.classList.add('wiggle');
  }

  // ---------- Игры ----------
  function renderGames() {
    state.screen = 'games';
    state.game = null;
    stopSpeech();
    $app.innerHTML = `
<header class="topbar">${homeBtn()}${soundBtn()}</header>
<div class="menu-title prompt">${mascot('md')}<div class="speech">Во что поиграем?</div></div>
<section class="modes">
  <button class="mode" style="--c:var(--blue)" data-act="start" data-mode="find">
    <span class="emoji">👂</span><b>Найди букву</b><span class="hint">Послушай и нажми на букву</span>
  </button>
  <button class="mode" style="--c:var(--pink);animation-delay:.1s" data-act="start" data-mode="pic">
    <span class="emoji">🖼️</span><b>С какой буквы?</b><span class="hint">Посмотри на картинку</span>
  </button>
</section>`;
  }

  function startGame(mode) {
    state.game = { mode, round: 0, stars: 0, used: [] };
    nextRound();
  }

  function nextRound() {
    const g = state.game;
    if (!g) return;
    if (g.round >= ROUNDS) { renderResult(); return; }
    g.round++;
    const all = A().letters;
    const pool = all.filter((L) => (g.mode === 'pic' ? L.starts : true));
    let cand = pool.filter((L) => !g.used.includes(L.l));
    if (!cand.length) { g.used = []; cand = pool; }
    const target = rand(cand);
    g.used.push(target.l);
    const others = shuffle(all.filter((L) => L.l !== target.l)).slice(0, 3);
    g.target = target;
    g.choices = shuffle([target, ...others]);
    g.firstTry = true;
    g.locked = false;
    renderRound();
    setTimeout(() => { if (state.game === g && !g.locked) promptRound(); }, 400);
  }

  function promptRound() {
    const g = state.game;
    const ph = A().phrases;
    if (g.mode === 'find') speak(`${ph.find} ${g.target.say}`);
    else speak([g.target.word, ph.which]);
  }

  function renderRound() {
    const g = state.game;
    const T = g.target;
    const all = A().letters;
    const masked = `<span class="mask">?</span>${esc(T.word.slice(1))}`;
    const prompt = g.mode === 'find'
      ? `${mascot('md')}
         <div class="prompt-main">
           <div class="speech">Найди букву!</div>
           <button class="btn big sky listen" data-act="repeat"><span class="emoji">🔊</span> Послушать</button>
         </div>`
      : `${mascot('md')}
         <div class="prompt-main" style="--c:${color(all.indexOf(T))}">
           <button class="pic-blob" data-act="repeat" aria-label="Послушать слово"><span class="emoji">${T.pic}</span></button>
           <div class="word">${masked}</div>
         </div>`;
    $app.innerHTML = `
<header class="topbar">
  ${homeBtn()}
  <div class="dots" aria-label="Раунд ${g.round} из ${ROUNDS}">
    ${Array.from({ length: ROUNDS }, (_, k) => `<span class="dot ${k < g.round - 1 ? 'done' : k === g.round - 1 ? 'now' : ''}"></span>`).join('')}
  </div>
  <div class="stars" aria-label="Звёзд: ${g.stars}"><span class="emoji">⭐</span> <span class="star-n">${g.stars}</span></div>
</header>
<section class="prompt">${prompt}</section>
<section class="choices">
  ${g.choices.map((L, k) => `<button class="choice" style="--c:${color(all.indexOf(L))};--i:${k}" data-act="choose" data-l="${L.l}" aria-label="Буква ${L.l}">${L.l}</button>`).join('')}
</section>`;
  }

  function choose(btn) {
    const g = state.game;
    if (!g || g.locked) return;
    const ph = A().phrases;
    if (btn.dataset.l === g.target.l) {
      g.locked = true;
      if (g.firstTry) g.stars++;
      btn.classList.add('right');
      const mask = $app.querySelector('.mask');
      if (mask) { mask.textContent = g.target.l; mask.style.animation = 'none'; }
      $app.querySelectorAll('.choice').forEach((b) => { b.disabled = true; });
      const st = $app.querySelector('.stars');
      st.querySelector('.star-n').textContent = g.stars;
      st.classList.add('bump');
      setMood('jump');
      sfx.good();
      burstFrom(btn, 45);
      speak(g.mode === 'pic' ? [rand(ph.praise), g.target.word] : [rand(ph.praise)]);
      setTimeout(() => { if (state.game === g) nextRound(); }, 2000);
    } else {
      g.firstTry = false;
      btn.classList.add('wrong');
      btn.disabled = true;
      setMood('sad');
      sfx.bad();
      speak(g.mode === 'find' ? [rand(ph.retry), g.target.say] : [rand(ph.retry)]);
    }
  }

  function renderResult() {
    const g = state.game;
    state.screen = 'result';
    const stars = g.stars;
    const text = stars >= 8 ? 'Ты настоящий знаток букв!' : stars >= 5 ? 'Очень здорово! Ещё чуть-чуть — и будет 10!' : 'Хорошая тренировка! Сыграем ещё?';
    $app.innerHTML = `
<header class="topbar">${homeBtn()}${soundBtn()}</header>
<section class="result">
  ${mascot('lg', 'jump')}
  <h2>Ура!</h2>
  <p>${text}</p>
  <div class="star-row" aria-label="Звёзд: ${stars} из ${ROUNDS}">
    ${Array.from({ length: ROUNDS }, (_, k) => `<span class="emoji ${k < stars ? '' : 'off'}" style="--i:${k}">⭐</span>`).join('')}
  </div>
  <div class="row">
    <button class="btn big green" data-act="start" data-mode="${g.mode}"><span class="emoji">🔁</span> Ещё раз</button>
    <button class="btn big yellow" data-act="games"><span class="emoji">🎮</span> Другая игра</button>
  </div>
</section>`;
    sfx.win();
    confetti(innerWidth / 2, innerHeight * 0.35, 180, 1.1);
    setTimeout(() => confetti(innerWidth * 0.2, innerHeight * 0.5, 80, 0.9), 350);
    setTimeout(() => confetti(innerWidth * 0.8, innerHeight * 0.5, 80, 0.9), 650);
    speak(A().phrases.win);
  }

  // ---------- События ----------
  $app.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const act = b.dataset.act;
    switch (act) {
      case 'open': sfx.pop(); renderCard(+b.dataset.i); break;
      case 'home': sfx.pop(); stopSpeech(); renderHome(); break;
      case 'prev': sfx.pop(); renderCard(state.idx - 1); break;
      case 'next': sfx.pop(); renderCard(state.idx + 1); break;
      case 'say-letter': speak(A().letters[state.idx].say); wiggle('.card-letter'); break;
      case 'say-word': speak(A().letters[state.idx].word); wiggle('.card .pic-blob'); break;
      case 'lang':
        if (b.dataset.lang !== state.lang) {
          state.lang = b.dataset.lang; store.set('abc.lang', state.lang); sfx.pop(); stopSpeech(); renderHome();
        }
        break;
      case 'sound':
        state.sound = !state.sound; store.set('abc.sound', state.sound);
        if (!state.sound) stopSpeech(); else sfx.pop();
        b.outerHTML = soundBtn();
        break;
      case 'games': sfx.pop(); renderGames(); break;
      case 'start': sfx.pop(); startGame(b.dataset.mode); break;
      case 'repeat': promptRound(); if (state.game.mode === 'pic') wiggle('.prompt .pic-blob'); break;
      case 'choose': choose(b); break;
    }
  });

  // Свайп влево/вправо на карточке буквы
  let touchX = null;
  let touchY = null;
  $app.addEventListener('touchstart', (e) => {
    if (state.screen !== 'card') return;
    touchX = e.touches[0].clientX; touchY = e.touches[0].clientY;
  }, { passive: true });
  $app.addEventListener('touchend', (e) => {
    if (state.screen !== 'card' || touchX == null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    const dy = e.changedTouches[0].clientY - touchY;
    touchX = null;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      const n = A().letters.length;
      const to = state.idx + (dx < 0 ? 1 : -1);
      if (to >= 0 && to < n) { sfx.pop(); renderCard(to); }
    }
  }, { passive: true });

  addEventListener('keydown', (e) => {
    if (state.screen === 'card') {
      const n = A().letters.length;
      if (e.key === 'ArrowRight' && state.idx < n - 1) renderCard(state.idx + 1);
      else if (e.key === 'ArrowLeft' && state.idx > 0) renderCard(state.idx - 1);
    }
    if (e.key === 'Escape' && state.screen !== 'home') { stopSpeech(); renderHome(); }
  });

  renderHome();
})();
