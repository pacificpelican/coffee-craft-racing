// Smartphone UI: home screen, Settings (tabs), Menus, IRL Coffee, News, Chat, Music, App Downloader.
import { h, money, esc, fmtClock, clamp, saveCanvasPNG } from './util.js';
import { DATA } from './data.js';
import { server, account, aiText, aiJson } from './api.js';
import * as eco from './economy.js';
import { LOGO_SVG, foodSVG, svgURI, bagSVG, kindFor } from './art.js';
import { getChannel, setChannel, sfx } from './audio.js';
import { playPickleball, playRoaster } from './minigames.js';
import { BOOKS } from './books.js';
import { mountHoops } from './hoops.js';

const APPS = [
  ['settings', '⚙️', 'Settings'], ['irl', '☕', 'IRL Coffee'], ['news', '📰', 'News'],
  ['chat', '💬', 'Chat'], ['music', '🎵', 'Music'], ['pickle', '🏓', 'Pickleball'], ['map', '🗺️', 'Map'], ['guru', '☕', 'Coffee Guru'], ['alta', '🎬', 'Alta Redwood'], ['books', '📚', 'Books'], ['hoops', '🏀', 'Hoops'], ['cb', '📻', 'CB Radio'], ['ask', '🤖', 'Ask AI'], ['store', '⬇️', 'App Downloader'],
];
// Purchases, Bank and Business belong to the original open-world game. Their code and save data stay intact; add the names back here to show them again.
const TABS = ['Account', 'Stats', 'Diary', 'Roasts', 'TOWS', 'Controls', 'Debug', 'Credits', 'Terms', 'Privacy'];

export function createPhone(G) {
  const root = document.getElementById('phone');
  let app = null, tab = 'Account', bankTab = 'Overview', chatWith = null, irl = null, tows = null, towsBusy = false;
  let live = false, clockT = null; // live: the world keeps running while the phone is open (reset to paused on every pickup)
  const S = () => G.state;

  function open(a, sub) {
    app = a || null; if (sub) { tab = sub.tab || tab; bankTab = sub.bankTab || bankTab; chatWith = sub.chat || chatWith; }
    if (!isOpen()) live = false;
    root.classList.remove('hidden'); G.setPaused(!live); render();
    clearInterval(clockT); clockT = setInterval(tickBar, 1000);
  }
  function close() { root.classList.add('hidden'); live = false; clearInterval(clockT); G.setPaused(false); }
  const isOpen = () => !root.classList.contains('hidden');
  const pausesWorld = () => isOpen() && !live;
  function tickBar() {
    const s = S(), c = root.querySelector('.bar .ph-clock'), w = root.querySelector('.bar .ph-weather');
    if (c) c.textContent = `Day ${s.day} · ${fmtClock(s.minutes)}`; if (w) w.textContent = s.weather || 'cloudy';
  }
  function toggleLive() { live = !live; G.setPaused(!live); render(); G.notify(live ? '▶ World running while you use the phone.' : '⏸ World paused.', { sound: false, ms: 1800 }); }
  function render() {
    const s = S();
    const screen = h('div', { class: 'screen' });
    if (!app) {
      screen.append(h('h3', { class: 'ph-title' }, h('span', { class: 'ph-logo', html: LOGO_SVG }), 'Phone'), h('div', { class: 'apps' }, ...APPS.map(([id, ic, nm]) => h('div', { class: 'app', onclick: () => { app = id; render(); } }, h('span', {}, ic), nm))));
    } else {
      screen.append(h('button', { class: 'btn alt', onclick: () => { app = null; render(); } }, '← Home'));
      ({ settings, irl: irlApp, news, chat, music, pickle, map: mapApp, guru, alta: altaApp, books: booksApp, hoops: (el) => mountHoops(el, G), cb: cbApp, ask, store })[app](screen);
    }
    root.replaceChildren(
      h('div', { class: 'bar' }, h('span', { class: 'ph-clock' }, `Day ${s.day} · ${fmtClock(s.minutes)}`), h('span', { class: 'ph-weather' }, s.weather || 'cloudy'),
        h('div', { class: 'ph-btns' },
          h('button', { class: 'ph-live' + (live ? ' on' : ''), title: live ? 'Pause the world while the phone is open' : 'Let the world keep running while the phone is open', 'aria-label': live ? 'Pause the world' : 'Run the world', 'aria-pressed': String(live), onclick: toggleLive }, live ? '⏸' : '▶'),
          h('button', { class: 'ph-x', title: 'Close phone', 'aria-label': 'Close phone', onclick: close }, '✕ Close'))),
      screen,
      h('div', { class: 'ph-foot' },
        h('button', { class: 'home', title: 'Close phone', onclick: close }),
        h('button', { class: 'ph-shot', title: 'Save a screenshot of the phone', 'aria-label': 'Save phone screenshot', onclick: shootPhone }, '▫')),
    );
  }

  // Screenshot of the phone: the live DOM is cloned with computed styles inlined, drawn through an SVG foreignObject, then stamped with the same credit line as the game screenshot.
  async function shootPhone() {
    try {
      const src = root, rect = src.getBoundingClientRect(), W = Math.ceil(rect.width), Hh = Math.ceil(rect.height);
      const clone = src.cloneNode(true);
      const srcEls = [src, ...src.querySelectorAll('*')], dstEls = [clone, ...clone.querySelectorAll('*')];
      srcEls.forEach((el, i) => {
        const d = dstEls[i], cs = getComputedStyle(el);
        if (el.tagName === 'CANVAS') { const im = document.createElement('img'); try { im.src = el.toDataURL(); } catch (e) { /* tainted canvas: leave blank */ } im.style.cssText = `width:${el.clientWidth}px;height:${el.clientHeight}px`; d.replaceWith(im); return; }
        let css = ''; for (const p of cs) css += `${p}:${cs.getPropertyValue(p)};`;
        d.setAttribute('style', css);
        if (el.scrollTop && d.firstElementChild) d.firstElementChild.style.marginTop = `-${el.scrollTop}px`;
      });
      clone.setAttribute('style', clone.getAttribute('style') + `;position:static;width:${W}px;height:${Hh}px;animation:none;margin:0;`);
      const xml = new XMLSerializer().serializeToString(clone);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Hh}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml">${xml}</div></foreignObject></svg>`;
      const img = new Image();
      await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
      const k = 2, bar = 34, c = document.createElement('canvas'); c.width = W * k; c.height = Hh * k + bar;
      const g = c.getContext('2d');
      g.fillStyle = '#23291f'; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, W * k, Hh * k);
      g.fillStyle = '#efe6cc'; g.font = `${Math.max(11, Math.round(c.width / 36))}px Georgia, serif`; g.textBaseline = 'middle';
      g.fillText(`Coffee Craft by Daniel McKeown https://altaredwood.work — ${new Date().toLocaleString()}`, 8, Hh * k + bar / 2);
      const res = await saveCanvasPNG(c, `Coffee_Craft_Phone_${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
      if (res !== 'cancelled') G.notify('📸 Phone screenshot saved.', { sound: false, ms: 2000 });
    } catch (e) { G.notify('Could not capture the phone screen.', { sound: false, ms: 2500 }); }
  }

  // E-book reader: public-domain excerpts, split into screens of about 900 characters; the page you reach is remembered.
  const COVERS = {
    moby: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 140"><rect width="100" height="140" rx="6" fill="#1f3a52"/><path d="M0 100 Q25 90 50 100 T100 100 V140 H0Z" fill="#2e5a7d"/><path d="M12 92 Q20 60 52 66 Q78 70 84 92 Q50 100 12 92Z" fill="#e9eef0"/><circle cx="66" cy="80" r="2.4" fill="#1f3a52"/><path d="M52 66 Q54 50 62 44 M58 58 Q66 52 72 50" stroke="#9fc4dc" stroke-width="2" fill="none"/><text x="50" y="22" text-anchor="middle" font-family="Georgia,serif" font-size="11" fill="#f2e7c8">MOBY-DICK</text></svg>',
    jane: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 140"><rect width="100" height="140" rx="6" fill="#5a2a35"/><rect x="8" y="8" width="84" height="124" rx="3" fill="none" stroke="#d8b46a" stroke-width="1.5"/><path d="M50 52 L50 100 M38 84 Q50 70 62 84 M44 60 Q50 46 56 60" stroke="#d8b46a" stroke-width="2.2" fill="none" stroke-linecap="round"/><circle cx="50" cy="104" r="3" fill="#d8b46a"/><text x="50" y="30" text-anchor="middle" font-family="Georgia,serif" font-size="14" fill="#f2e7c8">JANE EYRE</text></svg>',
  };
  const screensOf = (b) => {
    const out = []; let cur = [], n = 0;
    for (const p of b.pages) { if (n && n + p.length > 900) { out.push(cur); cur = []; n = 0; } cur.push(p); n += p.length; }
    if (cur.length) out.push(cur);
    return out;
  };
  let readingId = null;
  function booksApp(el) {
    const s = S(); const prog = (s.reading ||= {});
    const book = BOOKS.find((b) => b.id === readingId);
    if (!book) {
      el.append(h('h3', {}, '📚 Books'), h('p', { class: 'small' }, 'Free public-domain e-books. Each includes an opening excerpt.'));
      for (const b of BOOKS) {
        const total = screensOf(b).length, at = (prog[b.id] || 0) + 1;
        el.append(h('div', { class: 'bizcard', style: 'display:flex;gap:12px;align-items:center;cursor:pointer', onclick: () => { readingId = b.id; render(); } },
          h('div', { html: COVERS[b.id], style: 'width:64px;flex:none' }),
          h('div', {}, h('h4', {}, b.title), h('div', { class: 'small' }, `${b.author} · ${b.year}`), h('div', { class: 'small' }, prog[b.id] ? `Continue — page ${at} of ${total}` : `Excerpt · ${total} pages`))));
      }
      return;
    }
    const screens = screensOf(book), i = Math.min(prog[book.id] || 0, screens.length - 1);
    const go = (d) => { prog[book.id] = clamp(i + d, 0, screens.length - 1); render(); };
    el.append(h('div', { class: 'row' }, h('button', { class: 'btn alt', onclick: () => { readingId = null; render(); } }, '← Library')),
      h('h3', {}, book.title), h('div', { class: 'small' }, `${book.author} · ${book.chapter}`),
      h('div', { class: 'ebook', style: 'font-family:Georgia,serif;font-size:16px;line-height:1.6;margin:10px 0;text-align:left' }, ...screens[i].map((p) => h('p', { style: 'margin:0 0 .8em' }, p))),
      h('div', { class: 'row' }, h('button', { class: 'btn', disabled: i === 0, onclick: () => go(-1) }, '◀ Prev'), h('span', { class: 'small' }, `Page ${i + 1} of ${screens.length}`), h('button', { class: 'btn', disabled: i === screens.length - 1, onclick: () => go(1) }, 'Next ▶')));
    if (i === screens.length - 1) el.append(h('p', { class: 'small' }, `End of the excerpt. Read the whole book free at `, h('a', { href: book.gutenberg, target: '_blank', rel: 'noopener noreferrer' }, 'Project Gutenberg'), '.'));
  }

  // Alta Redwood Pictures: two videos, each a stacked card with logo, title and a play link (opens YouTube in a new tab).
  const CROW_LOGO = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="16" fill="#2f3b40"/><ellipse cx="46" cy="58" rx="24" ry="17" fill="#15181a" transform="rotate(-12 46 58)"/><circle cx="64" cy="40" r="12" fill="#15181a"/><path d="M74 38 L92 43 L74 47Z" fill="#d9a441"/><circle cx="67" cy="37" r="2.6" fill="#f4efe0"/><path d="M24 62 L6 76 L30 70Z" fill="#15181a"/><path d="M42 74 L40 88 M52 74 L52 88" stroke="#d9a441" stroke-width="3" stroke-linecap="round"/></svg>';
  const PARROT_LOGO = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="16" fill="#e6efd8"/><ellipse cx="46" cy="58" rx="20" ry="25" fill="#4fae43" transform="rotate(10 46 58)"/><ellipse cx="46" cy="64" rx="11" ry="15" fill="#b9d98a" transform="rotate(10 46 64)"/><circle cx="52" cy="30" r="15" fill="#5cc04c"/><ellipse cx="52" cy="38" rx="9" ry="7" fill="#aab4b8"/><path d="M60 26 Q76 28 70 42 Q64 38 60 36Z" fill="#e8892b"/><circle cx="56" cy="27" r="3" fill="#fff"/><circle cx="57" cy="27" r="1.5" fill="#15181a"/><path d="M36 78 L30 96 L44 84Z" fill="#2f7d3a"/></svg>';
  const RUM_LOGO = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="16" fill="#3a2418"/><rect x="40" y="14" width="20" height="14" rx="3" fill="#c9a45a"/><path d="M42 28 H58 V40 Q70 48 70 62 V84 Q70 90 64 90 H36 Q30 90 30 84 V62 Q30 48 42 40Z" fill="#8a4a1e"/><rect x="34" y="58" width="32" height="22" rx="3" fill="#f2e7c8"/><text x="50" y="73" text-anchor="middle" font-family="Georgia,serif" font-size="11" font-weight="bold" fill="#3a2418">RUM</text><path d="M44 46 Q44 40 48 38" stroke="#e8b878" stroke-width="2" fill="none" stroke-linecap="round"/></svg>';
  function altaApp(el) {
    const vids = [
      ['The Local Crows', CROW_LOGO, 'https://youtu.be/DEMCbXPJJ0s', 'Watch the neighborhood crows go about their business.'],
      ['The Quaker Parrot', PARROT_LOGO, 'https://www.youtube.com/watch?v=eI0T58xTx_o', 'A green parrot with big opinions.'],
      ['The Rum Diary (review)', RUM_LOGO, 'https://www.youtube.com/watch?v=T2gdJrWu38U', 'A look back at a boozy Caribbean tale.'],
    ];
    el.append(h('h3', {}, '🎬 Alta Redwood Pictures'), h('p', { class: 'small' }, 'Films from Alta Redwood Pictures. Plays on YouTube in a new tab.'));
    for (const [title, logo, url, blurb] of vids) {
      el.append(h('div', { class: 'bizcard', style: 'text-align:center' },
        h('div', { html: logo, style: 'width:96px;height:96px;margin:0 auto 6px' }),
        h('h4', {}, title), h('div', { class: 'small' }, blurb),
        h('a', { class: 'btn', href: url, target: '_blank', rel: 'noopener noreferrer', style: 'display:inline-block;margin-top:8px;text-decoration:none' }, '▶ Play on YouTube')));
    }
  }

  function pickle(el) {
    const card = h('div', { class: 'pickle-app' });
    el.append(card);
    playPickleball(card, { state: S(), notify: G.notify, sfx, aiText, server }, () => { app = null; render(); });
  }

  // ------------------------------------------------------------ Coffee Guru (roast lab)
  function guru(el) {
    const card = h('div', { class: 'pickle-app' });
    el.append(card);
    playRoaster(card, G.mini(), () => { app = null; render(); });
  }

  // ------------------------------------------------------------ Map (course overview)
  function mapApp(el) {
    const { track, player, ai } = G.mapInfo();
    const pts = track.P.filter((_, i) => i % 6 === 0);
    const xs = pts.map((p) => p.x), zs = pts.map((p) => p.z);
    const pad = 60, x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad, z0 = Math.min(...zs) - pad, z1 = Math.max(...zs) + pad;
    const line = pts.map((p) => `${p.x.toFixed(0)},${p.z.toFixed(0)}`).join(' ');
    const dot = (id, c) => `<circle id="${id}" r="${Math.max(x1 - x0, z1 - z0) / 60}" fill="${c}" stroke="#fff" stroke-width="${Math.max(x1 - x0, z1 - z0) / 400}"/>`;
    const stands = track.stands.map((s) => `<circle cx="${s.x}" cy="${s.z}" r="${Math.max(x1 - x0, z1 - z0) / 90}" fill="#8a4b2a"><title>${esc(s.name)}</title></circle>`).join('');
    const svg = `<svg viewBox="${x0} ${z0} ${x1 - x0} ${z1 - z0}" xmlns="http://www.w3.org/2000/svg" class="mapsvg" style="max-height:60vh">
      <rect x="${x0}" y="${z0}" width="${x1 - x0}" height="${z1 - z0}" fill="#cfd9b8"/>
      <polyline points="${line}" fill="none" stroke="#4a5055" stroke-width="${Math.max(x1 - x0, z1 - z0) / 160}" stroke-linejoin="round"/>
      ${stands}${dot('mapAi', '#5ee6ff')}${dot('mapMe', '#d03c4a')}</svg>`;
    const wrap = h('div', { class: 'mapwrap', html: svg });
    el.append(h('h3', {}, '🗺️ ' + track.level.name), h('p', { class: 'small' }, '🔴 you · 🔵 robo-taxi · brown dots are coffee stands. ' + (track.level.mapHint || 'The road runs from the bottom (start) to the top-left (finish at the pier).')), wrap);
    const me = wrap.querySelector('#mapMe'), rb = wrap.querySelector('#mapAi');
    const place = () => { me.setAttribute('cx', player.x); me.setAttribute('cy', player.z); rb.setAttribute('cx', ai.x); rb.setAttribute('cy', ai.z); };
    const tm = setInterval(() => { if (!me.isConnected) return clearInterval(tm); place(); }, 300); place();
  }

  // ------------------------------------------------------------ Ask AI
  const askLog = []; let askBusy = false;
  const SPIN_CAPTIONS = ['Warming up the neural espresso machine…', 'Calibrating the grind of the language model…', 'Searching for a signal in the rain…', 'Tamping down some tokens…', 'Waiting for the AI to wake up…', 'Looking for an AI API to chat with…'];
  function spinner(small) {
    const wrap = h('div', { class: 'orb-wrap' + (small ? ' small' : '') },
      h('div', { class: 'orb' },
        h('div', { class: 'ring r1' }), h('div', { class: 'ring r2' }), h('div', { class: 'ring r3' }),
        h('div', { class: 'orbit o1' }, h('i', {})), h('div', { class: 'orbit o2' }, h('i', {})), h('div', { class: 'orbit o3' }, h('i', {})),
        h('div', { class: 'core' }, '☕')));
    if (!small) {
      const cap = h('div', { class: 'orb-cap small' }, SPIN_CAPTIONS[0]); wrap.append(cap);
      let i = 0; const tm = setInterval(() => { if (!cap.isConnected) return clearInterval(tm); cap.textContent = SPIN_CAPTIONS[++i % SPIN_CAPTIONS.length]; }, 2400);
    }
    return wrap;
  }
  function ask(el) {
    el.append(h('h3', {}, '🤖 Ask AI'));
    if (!server.ai) {
      el.append(spinner(false), h('p', { class: 'small', style: 'text-align:center' }, 'No AI API is connected. Enable one in config.php (Ollama or a cloud provider) and this app will answer general questions.'));
      return;
    }
    el.append(h('p', { class: 'small' }, `Ask a general question. Answers come from ${server.aiProvider}${server.aiModel ? ' · ' + server.aiModel : ''} and can be wrong.`));
    const box = h('div');
    for (const m of askLog) box.append(h('div', { class: 'say' + (m.me ? ' me' : '') }, h('b', {}, m.me ? 'You: ' : 'AI: '), m.text, m.me ? '' : h('span', { class: 'small', style: 'margin-left:6px;opacity:.7' }, '✨AI')));
    if (askBusy) box.append(spinner(true));
    const inp = h('input', { placeholder: 'Ask anything…', style: 'width:68%' });
    const send = async () => {
      const q = inp.value.trim(); if (!q || askBusy) return;
      askLog.push({ me: true, text: q }); askBusy = true; render();
      const history = askLog.slice(-8).map((m) => ({ role: m.me ? 'user' : 'assistant', content: m.text }));
      const r = await aiText('You are a helpful general-purpose assistant built into a phone in a cozy coffee game. Answer clearly and concisely (a few sentences). Do not claim to be a person.', history);
      askBusy = false;
      askLog.push({ me: false, text: r ? r.trim().slice(0, 1500) : '⚠ The AI did not answer. Is the AI service running?' });
      if (app === 'ask' && isOpen()) render();
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); e.stopPropagation(); });
    el.append(box, inp, h('button', { class: 'btn', onclick: send }, 'Ask'), askLog.length ? h('button', { class: 'btn alt', onclick: () => { askLog.length = 0; render(); } }, 'Clear') : '');
    if (!askBusy) setTimeout(() => inp.focus(), 0);
  }

  // ------------------------------------------------------------ Settings
  function settings(el) {
    if (!TABS.includes(tab)) tab = TABS[0];
    el.append(h('div', { class: 'tabs' }, ...TABS.map((t) => h('button', { class: t === tab ? 'on' : '', onclick: () => { tab = t; render(); } }, t))));
    const body = h('div'); el.append(body);
    ({ Account: tAccount, Stats: tStats, Diary: tDiary, Purchases: tPurchases, Bank: tBank, Business: tBusiness, TOWS: tTows, Debug: tDebug, Controls: tControls, Roasts: tRoasts, Credits: tCredits, Terms: tTerms, Privacy: tPrivacy })[tab](body);
  }
  const kv = (k, v) => h('div', { class: 'kv' }, h('span', {}, k), h('b', {}, String(v)));

  function tAccount(el) {
    const u = server.user;
    if (!server.available) el.append(h('p', { class: 'small' }, 'Server (PHP) not detected: accounts need api.php. Your game is saved in this browser instead.'));
    if (u) {
      el.append(h('p', {}, 'Logged in as ', h('b', {}, u)), h('button', { class: 'btn', onclick: async () => { await account.logout(); render(); } }, 'Log out'),
        h('button', { class: 'btn', onclick: async () => { try { await account.saveGame(G.snapshot()); G.notify('Saved to server.'); } catch (e) { G.notify('Save failed: ' + e.message); } } }, 'Save to server'),
        h('button', { class: 'btn', onclick: async () => { try { const sv = await account.loadSave(); if (!sv) return G.notify('No server save found yet.'); if (confirm('Replace your current game with the server save?')) { G.restore(sv); render(); } } catch (e) { G.notify('Load failed: ' + e.message); } } }, 'Load from server'),
        h('p', { class: 'small' }, 'While logged in, your game is also saved to the server automatically every game day and every 45 seconds.'));
      const pw = h('input', { type: 'password', placeholder: 'password to confirm' });
      el.append(h('hr'), h('p', {}, '⚠ Deleting your account permanently erases it and all saved game data.'), pw,
        h('button', { class: 'btn warn', onclick: async () => { if (!confirm('Really delete your account and all data? This cannot be undone.')) return; try { await account.remove(pw.value); localStorage.removeItem('coffeecraftracing.save'); G.notify('Account deleted.'); render(); } catch (e) { alert(e.message); } } }, 'Delete account & data'));
    } else if (server.available) {
      const n = h('input', { placeholder: 'name', autocomplete: 'username' }), p = h('input', { type: 'password', placeholder: 'password', autocomplete: 'current-password' });
      const go = (fn) => async () => { try { await fn(n.value, p.value); if (fn === account.login) { const sv = await account.loadSave(); if (sv && confirm('Load your saved game from the server?')) G.restore(sv); } G.notify('Welcome, ' + server.user); render(); } catch (e) { alert(e.message); } };
      el.append(h('p', {}, 'Create an account or log in to keep your game on the server.'), n, p, h('div', { class: 'row' }, h('button', { class: 'btn', onclick: go(account.login) }, 'Log in'),
        server.registration ? h('button', { class: 'btn alt', onclick: go(account.register) }, 'Create account') : h('span', { class: 'small' }, 'Registration disabled.')));
    }
  }

  function tStats(el) {
    const s = S(), rc = s.race || {};
    const diff = h('select', { onchange: (e) => { rc.difficulty = e.target.value; G.notify('Difficulty: ' + e.target.value, { sound: false, ms: 1800 }); } }, h('option', { value: 'normal' }, 'Normal'), h('option', { value: 'challenging' }, 'Challenging (1.5× points)'));
    diff.value = rc.difficulty || 'normal';
    el.append(h('h4', {}, '🏁 Racing'), kv('Race points', rc.points || 0), kv('Races / wins', `${rc.races || 0} / ${rc.wins || 0}`), kv('Best time', Object.entries(rc.best || {}).map(([k, t]) => `${k} ${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`).join(', ') || '—'), kv('Coffees bought', rc.coffees || 0), kv('Difficulty', ''), diff, h('hr'), h('h4', {}, 'Town & economy'));
    el.append(kv('Day', s.day), kv('Time', fmtClock(s.minutes)), kv('Weather', s.weather), kv('Bank cash', money(s.bank.cash)), kv('Unique foods tried', s.diary.length), kv('Roasts unlocked', s.roastsUnlocked.length));
  }
  function bailoutUI() {
    const max = eco.bailoutMax(S());
    const v = prompt(`Request a government loan (up to ${money(max)}). You never have to pay it back.`, String(Math.round(max / 4)));
    if (v == null) return; const amt = eco.bailout(S(), Number(v) || 0); G.notify(`Government loan of ${money(amt)} received.`); render();
  }

  // Same lookup as the shops: tagged/keyword icon, else a cached AI drawing, else the platter.
  const src = (p) => { const k = kindFor(p.name, p.kind); const a = S().itemArt?.[p.name]; return svgURI(k ? foodSVG(k) : a || foodSVG('platter')); };

  function tPurchases(el) {
    const d = S().purchases || [];
    if (!d.length) return el.append(h('p', {}, 'Nothing here yet. Buy something at a convenience store, pharmacy, pet shop or electronics shop!'));
    const total = d.reduce((n, p) => n + p.count, 0);
    const g = h('div', { class: 'diary' });
    for (const p of d) g.append(h('div', { class: 'bizcard' }, h('img', { src: src(p), alt: p.name }), h('b', {}, p.name), h('div', { class: 'small' }, `${p.where} · day ${p.day}${p.count > 1 ? ` · ×${p.count}` : ''}`)));
    el.append(h('p', { class: 'small' }, `${d.length} unique product${d.length === 1 ? '' : 's'} collected · ${total} bought in all`), g,
      h('button', { class: 'btn alt', title: 'Print or save your purchases as PDF', onclick: () => G.printSheet('purchases', `Purchases — ${d.length} unique product${d.length === 1 ? '' : 's'} collected`, [h('div', { style: 'display:grid;grid-template-columns:repeat(3,1fr);gap:12px' }, ...d.map((p) => h('div', { style: 'text-align:center;break-inside:avoid' }, h('img', { src: src(p), alt: p.name, style: 'width:100%;max-width:150px' }), h('div', {}, h('b', {}, p.name)), h('div', { style: 'font-size:12px' }, `${p.where} · day ${p.day}${p.count > 1 ? ` · ×${p.count}` : ''}`))))]) }, '🖨 Print / PDF'));
  }

  function tDiary(el) {
    const d = S().diary;
    if (!d.length) return el.append(h('p', {}, 'Nothing here yet. Order something at a café, restaurant or pub!'));
    const g = h('div', { class: 'diary' });
    for (const f of d) g.append(h('div', { class: 'bizcard' }, h('img', { src: src(f), alt: f.name }), h('b', {}, f.name), h('div', { class: 'small' }, f.where + ' · day ' + f.day)));
    el.append(g, h('button', { class: 'btn alt', title: 'Print or save your food diary as PDF', onclick: () => G.printSheet('food_diary', `Food diary — ${d.length} item${d.length === 1 ? '' : 's'} tried`, [h('div', { style: 'display:grid;grid-template-columns:repeat(3,1fr);gap:12px' }, ...d.map((f) => h('div', { style: 'text-align:center;break-inside:avoid' }, h('img', { src: src(f), alt: f.name, style: 'width:100%;max-width:150px' }), h('div', {}, h('b', {}, f.name)), h('div', { style: 'font-size:12px' }, `${f.where} · day ${f.day}`))))]) }, '🖨 Print / PDF'));
      }

      // ------------------------------------------------------------ Bank
      function tBank(el) {
    const s = S();
    el.append(h('div', { class: 'tabs' }, ...['Overview', 'Decisions', 'Suppliers'].map((t) => h('button', { class: t === bankTab ? 'on' : '', onclick: () => { bankTab = t; render(); } }, t + (t === 'Decisions' ? ` (${s.bank.decisions.length})` : '')))));
    const auto = h('input', { type: 'checkbox', checked: s.bank.auto, onchange: (e) => { s.bank.auto = e.target.checked; if (s.bank.auto) G.autoPending(); G.notify(s.bank.auto ? 'Bank automation ON' : 'Manual banking'); render(); } });
    if (bankTab === 'Overview') {
      el.append(h('label', {}, auto, ' Automate banking (uses AI when available)'), kv('Cash', money(s.bank.cash)), kv('Loans out', money(s.bank.loans?.reduce?.((a, l) => a + (l.amount || 0), 0) || s.bank.lent || 0)), kv('Interest earned', money(s.bank.interestEarned || 0)));
      el.append(h('h4', {}, 'Real-time business holdings'));
      for (const b of Object.values(s.businesses).filter((x) => x.owner === 'player' || x.lender === 'player')) {
        el.append(h('div', { class: 'bizcard' }, h('h4', {}, b.name, ' ', h('span', { class: 'tag' + (b.state !== 'open' ? ' bad' : '') }, b.owner === 'player' ? 'owned' : 'lent')), kv('Status', b.state), kv('Debt', money(b.debt)), kv('Today', money(b.dayRevenue)), kv('Savings', money(b.savings))));
      }
      el.append(h('h4', {}, 'Recent bank log'), ...(s.bank.log || []).slice(-6).reverse().map((l) => h('div', { class: 'small' }, typeof l === 'string' ? l : JSON.stringify(l))));
      if (eco.needsBailout(s)) el.append(h('button', { class: 'btn warn', onclick: bailoutUI }, '🆘 Bailout'));
    } else if (bankTab === 'Decisions') {
      if (s.bank.auto) el.append(h('p', { class: 'small' }, 'Automation is on; decisions are made for you.'));
      if (!s.bank.decisions.length) el.append(h('p', {}, 'No decisions waiting.'));
      for (const d of s.bank.decisions) {
        const yes = d.type === 'loan' ? ['approve', 'Approve'] : ['buy', 'Buy out'], no = d.type === 'loan' ? ['deny', 'Decline'] : ['liquidate', 'Liquidate'];
        el.append(h('div', { class: 'bizcard' }, h('p', {}, d.text), h('div', { class: 'row' }, ...[yes, no].map(([c, l]) => h('button', { class: 'btn' + (c === 'approve' || c === 'buy' ? ' alt' : ''), onclick: () => { eco.decideManually(s, d.id, c); sfx('coin'); render(); } }, l)))));
      }
    } else {
      suppliers(el);
    }
  }
  function suppliers(el) {
    const s = S(), S_ = DATA.suppliers, own = eco.ownedBusinesses(s);
    const sel = (b, key, list) => h('div', { class: 'kv' }, h('span', {}, key), h('select', { onchange: (e) => { b.supply[key] = e.target.value; if (key === 'payment' && e.target.value !== 'cash') b.gambling = false; render(); } }, ...list.map((o) => h('option', { value: o.id, selected: b.supply[key] === o.id }, o.name))));
    for (const [title, type, keys] of [['☕ Coffee', 'coffee', ['beans', 'cups']], ['🍜 Restaurants & donut shops', 'restaurant', ['ingredients', 'packaging']]]) {
      el.append(h('h4', {}, title));
      for (const b of own.filter((x) => (type === 'coffee' ? x.type === 'coffee' : x.type !== 'coffee'))) {
        el.append(h('div', { class: 'bizcard' }, h('b', {}, b.name), ...keys.map((k) => sel(b, k, S_[type][k])), sel(b, 'payment', S_.payment),
          b.supply.payment === 'cash' ? h('label', {}, h('input', { type: 'checkbox', checked: b.gambling, onchange: (e) => { b.gambling = e.target.checked; if (b.gambling) { s.scrutiny += 5; G.notify('A back-room gambling den: more cash, more cop attention.'); } } }), ' Gambling den (risky!)') : h('div', { class: 'small' }, 'Cash-only unlocks a gambling den option.')));
      }
      if (!own.some((x) => (type === 'coffee' ? x.type === 'coffee' : x.type !== 'coffee'))) el.append(h('p', { class: 'small' }, 'None owned yet.'));
    }
  }

  // ------------------------------------------------------------ Business
  function tBusiness(el) {
    const s = S(), own = eco.ownedBusinesses(s);
    for (const b of own) {
      const pb = eco.propertyBreakdown(b);
      const card = h('div', { class: 'bizcard' }, h('h4', {}, b.name), h('div', { class: 'small' }, `${b.type}${b.style ? ' · ' + b.style : ''}`));
      card.append(h('div', { class: 'kv' }, h('span', {}, 'Pricing'), h('select', { onchange: (e) => { b.tier = Number(e.target.value); } }, ...eco.PRICE_TIERS.map((t) => h('option', { value: t.id, selected: b.tier === t.id }, t.name)))));
      const hr = (i) => h('select', { onchange: (e) => { b.hours[i] = Number(e.target.value); } }, ...Array.from({ length: i ? 25 : 24 }, (_, k) => h('option', { value: k, selected: b.hours[i] === k }, k + ':00')));
      card.append(h('div', { class: 'kv' }, h('span', {}, 'Hours'), h('span', {}, hr(0), ' – ', hr(1))));
      if (b.type === 'coffee') card.append(h('div', { class: 'kv' }, h('span', {}, 'Roast'), h('select', { onchange: (e) => { b.roast = e.target.value; const r = DATA.roastStyles.find((x) => x.id === e.target.value); b.boost = (r?.buzz || 0); } }, ...DATA.roastStyles.filter((r) => S().roastsUnlocked.includes(r.id)).map((r) => h('option', { value: r.id, selected: b.roast === r.id }, r.name)))));
      card.append(h('div', { class: 'small' }, `Property ${money(b.propertyValue)} — location ${money(pb.location)}, condition ${money(pb.condition)}, assets ${money(pb.assets)}`));
      if (b.state === 'renovating') card.append(h('p', { class: 'small' }, `🚧 Shuttered. Finish ${eco.RENOVATION_PROJECTS} major projects to reopen (${b.enhancements.length}/${eco.RENOVATION_PROJECTS}). Renovation costs are steep.`));
      card.append(h('div', { class: 'row' }, ...DATA.enhancements.map((e) => {
        const done = b.enhancements.includes(e.id), cost = eco.enhanceCost(b, e);
        return h('button', { class: 'btn' + (done ? '' : ' alt'), disabled: done, onclick: () => { if (eco.enhance(s, b, e.id)) { sfx('coin'); render(); } else G.notify('Not enough funds.'); } }, done ? `✓ ${e.name}` : `${e.name} ${money(cost)}`);
      })));
      el.append(card);
    }
    el.append(h('h4', {}, 'Hire a problem customer (under the bridge)'), h('p', { class: 'small' }, 'Pick a rival. $2,500; risks reputation and police attention.'));
    const rivals = Object.values(s.businesses).filter((b) => b.owner !== 'player' && b.state === 'open' && ['coffee', 'restaurant', 'donut'].includes(b.type));
    const sel = h('select', {}, ...rivals.map((b) => h('option', { value: b.id }, b.name)));
    el.append(sel, h('button', { class: 'btn warn', onclick: () => { const caught = eco.hireTroublemaker(s, s.businesses[sel.value]); G.notify(caught ? 'Someone talked. Cops are asking questions.' : 'It got done. Quietly.'); render(); } }, 'Hire'));
    if (G.nearDealer?.()) { /* dealers are handled in-world */ }
  }

  // ------------------------------------------------------------ TOWS
  function localTows() {
    const s = S(), own = eco.ownedBusinesses(s);
    const avgQ = own.reduce((a, b) => a + eco.effectiveQuality(b), 0) / Math.max(1, own.length);
    return {
      threats: [s.scrutiny > 30 ? 'Police scrutiny is elevated.' : 'Rival cafés keep an eye on your price tier.', Object.values(s.businesses).some((b) => b.state === 'bankrupt') ? 'Bankruptcies are souring the neighborhood mood.' : 'Rainy weeks cut foot traffic.'],
      opportunities: [eco.donutUnlocked(s) ? 'Donut shops are available to buy.' : `Earn ${eco.DONUT_UNLOCK_POINTS} points to unlock donut shops.`, 'Distressed NPC businesses can be bought out by your bank.'],
      weaknesses: [avgQ < 65 ? 'Average quality is middling; upgrade suppliers.' : 'Premium suppliers eat into margins.', own.some((b) => b.debt > 0) ? 'Some of your shops carry debt.' : 'No expansion beyond two shops yet.'],
      strengths: [`Bank cash ${money(s.bank.cash)}.`, `Community reputation ${Math.round(s.rep)}.`, s.roastsUnlocked.length > 3 ? 'A growing roast menu from the Lab.' : 'A comfortable base to experiment.'],
    };
  }
  function tTows(el) {
    el.append(h('p', { class: 'small' }, server.ai ? `AI analysis via ${server.aiProvider}.` : 'AI is not configured; showing a simple built-in analysis.'));
    const data = tows || localTows();
    for (const [k, c] of [['Threats', 'threats'], ['Opportunities', 'opportunities'], ['Weaknesses', 'weaknesses'], ['Strengths', 'strengths']]) {
      el.append(h('div', { class: 'bizcard' }, h('h4', {}, k), h('ul', {}, ...(data[c] || []).map((x) => h('li', {}, String(x))))));
    }
    el.append(h('button', { class: 'btn', disabled: towsBusy, onclick: async () => {
      if (!server.ai) { tows = null; return render(); }
      towsBusy = true; render(); const s = S();
      const sum = eco.ownedBusinesses(s).map((b) => `${b.name}: q${Math.round(eco.effectiveQuality(b))}, buzz${Math.round(b.buzz)}, debt ${Math.round(b.debt)}, tier ${b.tier}`).join('; ');
      const j = await aiJson('You are a friendly business coach for a café-owner game. Output {"threats":[..],"opportunities":[..],"weaknesses":[..],"strengths":[..]} with 2-3 short strings each.', `Day ${s.day}. Cash ${Math.round(s.bank.cash)}. Rep ${Math.round(s.rep)}. Scrutiny ${Math.round(s.scrutiny)}. ${sum}`);
      if (j && j.threats) tows = j; towsBusy = false; render();
    } }, towsBusy ? 'Thinking…' : '↻ Refresh analysis'));
  }

  function tDebug(el) {
    el.append(kv('Storage', server.storage), kv('PHP server', server.available ? 'yes' : 'no (static)'), kv('AI chat enabled', server.ai ? 'yes' : 'no'), kv('AI provider', server.aiProvider || 'none'), kv('AI model', server.aiModel || '—'), kv('Logged in', server.user || 'no'), kv('Businesses', Object.keys(S().businesses).length), kv('Mods loaded', (DATA.modsLoaded || []).join(', ') || 'none'), kv('Version', '1.0'));
        if (server.ai) {
          const out = h('p', { class: 'small' });
          el.append(h('button', { class: 'btn', onclick: async () => { out.textContent = 'Asking the AI…'; const t = await G.aiText('Reply in five words or fewer.', [{ role: 'user', content: 'Say hello to a coffee shop customer.' }]); out.textContent = t ? '✨ AI works: “' + t + '”' : '⚠ AI is enabled but did not answer. Is Ollama running and the model pulled? Set debug => true in config.local.php for details in the server log.'; } }, 'Test AI'), out);
        }
      }
  function tRoasts(el) {
    const s = S(), log = s.roastLog || [];
    el.append(h('h3', {}, '🔥 Roasts'), h('p', { class: 'small' }, 'Styles unlocked by experimenting at the Roast Lab, and every batch you have roasted. Bag labels are AI-designed when AI is on.'));
    el.append(h('b', {}, 'Styles'), ...DATA.roastStyles.map((r) => h('div', { class: 'kv' }, h('span', {}, r.name), h('span', { class: 'small' }, s.roastsUnlocked.includes(r.id) ? 'unlocked' : `locked · ${r.need} experiments`))));
    el.append(h('hr'), h('b', {}, `Batches (${log.length})`));
    if (!log.length) return el.append(h('p', { class: 'small' }, 'Nothing roasted yet. Use the roaster at the Roast Lab.'));
    el.append(h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px;margin-top:6px' }, ...log.slice().reverse().map((r) => h('div', { class: 'bizcard', style: 'text-align:center' },
      h('img', { src: svgURI(bagSVG(r)), alt: r.name, style: 'width:100%;max-width:120px' }), h('b', {}, r.name), h('div', { class: 'small' }, `${r.beanName} · day ${r.day}`), h('div', { class: 'small' }, `${r.body}${r.blend > 50 ? ' · robusta-heavy' : ''}`)))));
  }

  function tControls(el) {
    const rows = [
      ['Steer', 'Left / right arrows, A / D, or the on-screen pad'],
      ['⏩ Gas (right button)', '. (period) or ↑ / W'],
      ['🛑 Brake / reverse (bottom button)', ', (comma) or ↓ / S'],
      ['📣 Horn (left button)', '/ (slash)'],
      ['☕ Coffee (top button)', "' (apostrophe): pull into a nearby coffee stand when slow; otherwise drink a coffee for a speed boost"],
      ['Pause', 'P or Esc'],
      ['Phone', 'Tab or the 📱 button'],
      ['Mute', 'M'],
    ];
    el.append(h('h3', {}, '🎮 Controls'), ...rows.map(([k, v]) => h('div', { class: 'kv' }, h('span', {}, k), h('span', { class: 'small' }, v))));
  }

  function tCredits(el) {
    el.append(h('div', { style: 'text-align:center' }, h('div', { html: LOGO_SVG, style: 'width:100px;margin:auto' }), h('h3', {}, 'Coffee Craft Racing'),
      h('p', { html: 'created by <a href="https://altaredwood.work" target="_blank" rel="noopener">Daniel McKeown</a>' }), h('p', { class: 'small' }, 'Alta Redwood Pictures. Library text: Kusamakura by Natsume Sōseki (1906).')));
  }
  function tTerms(el) {
    el.append(h('p', { class: 'small' }, 'Last updated: November 2, 2026'), h('p', {}, 'Coffee Craft is intended for players aged 18 and over. Do not play if you are under 18.'), h('p', {}, 'Coffee Craft is a hobby game provided as is, with no warranty. It can run locally on your own machine or be deployed to a web server by whoever hosts it; the host is responsible for their deployment.'), h('p', {}, 'In-game businesses, people and events are fictional. Do not use AI-generated text as advice. Weed, alcohol and gambling appear only as fictional game content for adults.'), h('p', {}, 'Do not abuse the server or AI endpoints. The host may remove accounts at any time.'));
  }
  function tPrivacy(el) {
    el.append(h('p', { class: 'small' }, 'Last updated: October 31, 2026'), h('p', {}, 'Without an account, your game is saved only in your browser (localStorage). With an account, your name, a salted password hash and your game save are stored by the server host (JSON files or MySQL/MariaDB as configured).'), h('p', {}, 'If AI is enabled, text you type in conversations and a summary of game state are sent to the configured AI provider (a local Ollama instance or a cloud service chosen by the host). Do not type personal information.'), h('p', {}, 'You can delete your account and data from Settings → Account at any time. No analytics or ads are included.'));
  }

  // ------------------------------------------------------------ Other apps
  async function irlApp(el) {
    el.append(h('h3', {}, '☕ IRL Coffee'), h('p', { class: 'small' }, 'Find a real coffee shop to visit or order from.'));
    const city = h('input', { placeholder: 'your city or neighborhood', value: localStorage.getItem('coffeecraft.city') || '' });
    const out = h('div', {});
    el.append(city, h('button', { class: 'btn', onclick: async () => {
      localStorage.setItem('coffeecraft.city', city.value);
      out.textContent = 'Looking…';
      if (!server.ai) { out.innerHTML = '<p>AI is off, so no live suggestions. Try searching maps for “independent coffee roaster near me” — or your local roastery’s website.</p>'; return; }
      const j = await aiJson('You recommend real, well-regarded, preferably independent coffee shops. Output {"name":"","where":"","why":""}. Only suggest places you are fairly sure exist and say so if unsure.', `Near: ${city.value || 'Seattle, WA'}`);
      out.replaceChildren(j ? h('div', { class: 'bizcard' }, h('h4', {}, j.name), h('div', {}, j.where), h('p', {}, j.why), h('a', { href: 'https://www.google.com/maps/search/' + encodeURIComponent(j.name + ' ' + (j.where || city.value)), target: '_blank', rel: 'noopener' }, 'Open in maps'), h('p', { class: 'small' }, 'AI suggestions may be wrong; check hours first.')) : h('p', {}, 'No suggestion this time.'));
    } }, 'Find one'), out);
  }
  function news(el) {
    el.append(h('h3', {}, '📰 Neighborhood News'));
    const list = S().news.slice(-30).reverse();
    if (!list.length) el.append(h('p', {}, 'Quiet so far.'));
    for (const n of list) el.append(h('div', { class: 'bizcard' }, h('div', { class: 'small' }, 'Day ' + n.day), h('div', {}, n.text)));
  }
  function chat(el) {
    const s = S(), prefs = (s.chatPrefs ||= {});
    const setPref = (c, v) => { if (v) prefs[c] = v; else delete prefs[c]; render(); };
    const muteBtn = (c) => prefs[c] === 'blocked' ? null : h('button', { class: 'btn alt', title: 'Mute: messages still arrive, but no notifications', onclick: (e) => { e.stopPropagation(); setPref(c, prefs[c] === 'muted' ? null : 'muted'); } }, prefs[c] === 'muted' ? '🔔 Unmute' : '🔕 Mute');
    const blockBtn = (c) => h('button', { class: 'btn warn', title: 'Block: no new messages at all', onclick: (e) => { e.stopPropagation(); setPref(c, prefs[c] === 'blocked' ? null : 'blocked'); } }, prefs[c] === 'blocked' ? '✅ Unblock' : '🚫 Block');
    if (chatWith && s.contacts.includes(chatWith)) {
      const msgs = s.chats[chatWith] || [], blocked = prefs[chatWith] === 'blocked';
      el.append(h('h3', {}, chatWith, prefs[chatWith] ? h('span', { class: 'small' }, prefs[chatWith] === 'muted' ? ' · muted' : ' · blocked') : ''), h('div', { class: 'row' }, muteBtn(chatWith), blockBtn(chatWith)), ...msgs.map((m) => h('div', { class: 'say' + (m.me ? ' me' : '') }, m.text, m.ai ? h('span', { class: 'small', title: 'Written by the AI', style: 'margin-left:6px;opacity:.7' }, '✨AI') : '')));
      el.append(h('button', { class: 'btn alt', title: 'Print or save this conversation as PDF', onclick: () => G.printSheet('chat', `Text conversation with ${chatWith}`, msgs.map((m) => h('p', {}, h('b', {}, (m.me ? 'You' : chatWith) + ': '), m.text + (m.ai ? ' [AI]' : '')))) }, '🖨 Print / PDF'));
      if (blocked) return el.append(h('p', { class: 'small' }, 'Blocked: unblock to message again.'), h('button', { class: 'btn alt', onclick: () => { chatWith = null; render(); } }, 'Contacts'));
      const inp = h('input', { placeholder: 'message…', style: 'width:70%' });
      const send = async () => {
        if (!inp.value.trim()) return; (s.chats[chatWith] ||= []).push({ me: true, text: inp.value });
        const t = inp.value, who = chatWith; inp.value = ''; render();
        const reply = await G.npcReply(who, t); (s.chats[who] ||= []).push(G.lastAi ? { text: reply, ai: true } : { text: reply }); if (chatWith === who) render();
      };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } e.stopPropagation(); });
      el.append(inp, h('button', { class: 'btn', onclick: send }, 'Send'), h('button', { class: 'btn alt', onclick: () => { chatWith = null; render(); } }, 'Contacts'));
      setTimeout(() => inp.focus(), 0);
      return;
    }
    el.append(h('h3', {}, '💬 Chat'));
    if (!s.contacts.length) el.append(h('p', {}, 'No contacts yet. After a good conversation someone might offer to swap numbers.'));
    for (const c of s.contacts) el.append(h('div', { class: 'bizcard', style: 'margin:6px 0;cursor:pointer', onclick: () => { chatWith = c; render(); } }, h('b', {}, c, prefs[c] === 'muted' ? ' 🔕' : prefs[c] === 'blocked' ? ' 🚫' : ''), ' ', h('span', { class: 'small' }, (s.chats[c] || []).slice(-1)[0]?.text?.slice(0, 40) || ''), h('div', { class: 'row' }, muteBtn(c), blockBtn(c))));
  }
  function cbApp(el) {
    const s = S(), log = (s.cb ||= []);
    el.append(h('h3', {}, '📻 CB Radio'), h('p', { class: 'small' }, 'Channel 19: truckers, drivers and coffee fans on the road. Messages arrive while you drive.'),
      h('div', { class: 'row' }, h('button', { class: 'btn alt', onclick: () => { s.cbQuiet = !s.cbQuiet; render(); } }, s.cbQuiet ? '🔔 Alerts on' : '🔕 Silence alerts')));
    const inp = h('input', { placeholder: 'key the mic…', maxlength: 160, style: 'width:70%' });
    const send = () => { if (!inp.value.trim()) return; G.cbSay(inp.value); inp.value = ''; render(); };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } e.stopPropagation(); });
    el.append(inp, h('button', { class: 'btn', onclick: send }, 'Send'));
    if (!log.length) el.append(h('p', {}, 'Static… nothing yet. Keep driving.'));
    for (const m of log.slice(-40).reverse()) el.append(h('div', { class: 'say' + (m.me ? ' me' : '') }, h('b', {}, m.handle + ': '), m.text, m.ai ? h('span', { class: 'small', title: 'Written by the AI', style: 'margin-left:6px;opacity:.7' }, '✨AI') : ''));
  }
  function music(el) {
    const cur = getChannel();
    el.append(h('h3', {}, '🎵 Radio Fog'), ...[['ambient', 'Ambient / Trance'], ['classical', 'Classical Strings'], ['jazz', 'Jazz Lounge'], ['noise', 'White Noise'], ['off', 'Muted']].map(([id, nm]) => h('div', { class: 'app', style: 'margin:6px 0;' + (cur === id ? 'background:#e3b93c' : ''), onclick: () => { setChannel(id); S().musicChannel = id; render(); } }, nm)));
  }
  function store(el) {
    el.append(h('h3', {}, '⬇ App Downloader'), h('p', { class: 'small' }, 'Installed apps. More arrive in later versions.'), ...APPS.map(([id, ic, nm]) => h('div', { class: 'kv' }, h('span', {}, ic + ' ' + nm), h('span', { class: 'tag' }, 'installed'))));
  }

  return { open, close, isOpen, pausesWorld, render };
}
