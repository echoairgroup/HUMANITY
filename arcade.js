'use strict';

(() => {
  const API = 'https://humanity-api-jyk5.onrender.com/api';
  const SOCKET_URL = 'wss://humanity-api-jyk5.onrender.com/api/party';
  const GEOJSON_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson';
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const nf = new Intl.NumberFormat('en-US');
  const state = {
    countries: [], byCode: new Map(), byName: new Map(), map: null, geo: null, geoLayer: null,
    layers: new Map(), selectedCode: null, selectedLayer: null, revealed: new Set(),
    expedition: null, expeditionMode: 'daily', clueIndex: 0, answers: [], distance: 0,
    pending: false, finished: false, mystery: null, mysteryMode: 'daily', mysteryGuesses: 0,
    socket: null, pendingAction: null, room: null, roomCode: null, playerId: null,
    resumeToken: null, reconnectAttempt: 0, reconnectTimer: null, timerMs: 30000, timerDurationMs: 30000, activeTab: 'expedition'
  };

  const norm = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const hide = (el, value) => { if (el) el.hidden = Boolean(value); };

  function toast(message) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }

  async function api(path, options = {}) {
    const response = await fetch(API + path, {
      method: options.method || 'GET',
      headers: { Accept: 'application/json', ...(options.body ? {'Content-Type':'application/json'} : {}) },
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: 'no-store'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + response.status));
    return data;
  }

  function readNickname() {
    return (localStorage.getItem('humanity-atlas-nickname') || '').trim();
  }

  function nickname(value) {
    const result = String(value || '').trim().replace(/\s+/g, ' ');
    if (result.length < 2 || result.length > 18 || !/^[\p{L}\p{N}_ .'-]+$/u.test(result)) {
      throw new Error('Choose a nickname between 2 and 18 characters.');
    }
    localStorage.setItem('humanity-atlas-nickname', result);
    return result;
  }

  function findCountry(value) {
    const text = String(value || '').trim();
    return state.byCode.get(text.toUpperCase()) || state.byName.get(norm(text)) || null;
  }

  async function loadCountries() {
    try {
      const result = await api('/bootstrap');
      state.countries = result.data.countries || [];
      state.byCode = new Map(state.countries.map(c => [String(c.code).toUpperCase(), c]));
      state.byName = new Map(state.countries.map(c => [norm(c.name), c]));
      const aliases = {
        'united states':'USA','united states of america':'USA','america':'USA',
        'united kingdom':'GBR','great britain':'GBR','uk':'GBR',
        'russia':'RUS','south korea':'KOR','north korea':'PRK',
        'czech republic':'CZE','ivory coast':'CIV','dr congo':'COD',
        'democratic republic of the congo':'COD','republic of the congo':'COG',
        'cape verde':'CPV','east timor':'TLS','turkiye':'TUR','swaziland':'SWZ'
      };
      Object.entries(aliases).forEach(([alias, code]) => {
        const country = state.byCode.get(code);
        if (country) state.byName.set(alias, country);
      });
      const list = $('#atlas-country-options');
      if (list) list.innerHTML = state.countries.map(c => '<option value="' + esc(c.name) + '"></option>').join('');
      const saved = readNickname();
      if (saved && $('#party-nickname')) $('#party-nickname').value = saved;
      if (saved && $('#expedition-nickname')) $('#expedition-nickname').value = saved;
    } catch (error) {
      console.warn('Atlas country catalogue unavailable:', error.message);
      toast('Country data is still loading. Please try again.');
    }
  }

  function switchTab(tab) {
    if (!['expedition','mystery','party'].includes(tab)) return;
    state.activeTab = tab;
    $$('.arcade-tab').forEach(b => b.classList.toggle('active', b.dataset.arcadeTab === tab));
    $$('[data-arcade-panel]').forEach(p => {
      const active = p.dataset.arcadePanel === tab;
      p.hidden = !active;
      p.classList.toggle('active', active);
    });
    if (tab === 'expedition') {
      loadDailyLeaderboard();
      requestAnimationFrame(() => state.map?.invalidateSize());
    }
    if (tab === 'party') {
      loadPublicRooms();
      loadPartyLeaderboard();
    }
  }

  function featureCountry(feature) {
    const p = feature?.properties || {};
    const candidates = ['ADM0_A3','ISO_A3','ISO_A3_EH','SOV_A3','GU_A3'];
    for (const key of candidates) {
      const code = String(p[key] || '').toUpperCase();
      if (/^[A-Z]{3}$/.test(code) && state.byCode.has(code)) return state.byCode.get(code);
    }
    for (const name of [p.ADMIN,p.NAME_EN,p.NAME,p.NAME_LONG,p.SOVEREIGNT,p.BRK_NAME]) {
      const country = findCountry(name);
      if (country) return country;
    }
    return null;
  }

  function countryStyle(feature) {
    const country = featureCountry(feature);
    if (country && state.revealed.has(country.code)) {
      return { color:'#fffdf5', weight:1, fillColor:'#9fbd8f', fillOpacity:.98 };
    }
    if (country && state.selectedCode === country.code) {
      return { color:'#a36e47', weight:2.5, fillColor:'#e7ae73', fillOpacity:1 };
    }
    return { color:'#a7c1bd', weight:.8, fillColor:'#f1ead8', fillOpacity:.98 };
  }

  function selectCountry(code, name, layer = null) {
    const country = state.byCode.get(String(code || '').toUpperCase()) || findCountry(name);
    if (!country || state.pending || state.finished) return;
    if (state.selectedLayer?.setStyle && state.selectedLayer !== layer) {
      state.selectedLayer.setStyle(countryStyle(state.selectedLayer.feature));
    }
    state.selectedCode = country.code;
    state.selectedLayer = layer || state.layers.get(country.code) || null;
    state.geoLayer?.setStyle(countryStyle);
    if (state.selectedLayer) state.selectedLayer.setStyle(countryStyle(state.selectedLayer.feature));
    $('#atlas-selected-name').textContent = country.name;
    $('#atlas-selected-country').classList.add('has-selection');
    $('#atlas-confirm').disabled = false;
    $('#atlas-country-search').value = country.name;
  }

  async function initMap() {
    if (state.map || !window.L || !$('#atlas-map')) return;
    state.map = L.map('atlas-map', {
      zoomControl:true, attributionControl:true, minZoom:1.5, maxZoom:7,
      worldCopyJump:true, scrollWheelZoom:true, zoomSnap:.5
    }).setView([20,0],1.8);
    state.map.attributionControl.setPrefix('');
    state.map.attributionControl.addAttribution('Map shapes: Natural Earth');
    try {
      if (!state.geo) {
        const response = await fetch(GEOJSON_URL, {cache:'force-cache'});
        if (!response.ok) throw new Error('Map data returned HTTP ' + response.status);
        state.geo = await response.json();
      }
      state.geoLayer = L.geoJSON(state.geo, {
        style:countryStyle,
        onEachFeature(feature, layer) {
          const country = featureCountry(feature);
          if (!country) return;
          state.layers.set(country.code,layer);
          layer.bindTooltip(country.name,{sticky:true,className:'atlas-map-tooltip'});
          layer.on('click',() => selectCountry(country.code,country.name,layer));
        }
      }).addTo(state.map);
      state.map.fitBounds(state.geoLayer.getBounds(),{padding:[12,12]});
    } catch (error) {
      console.warn('Country map unavailable:',error.message);
      $('#atlas-map').classList.add('map-unavailable');
      $('#atlas-map').innerHTML='<div class="map-fallback"><span>✥</span><strong>Your atlas is unfolding.</strong><p>Use the country search below to place your pin.</p></div>';
    }
    requestAnimationFrame(() => state.map?.invalidateSize());
  }

  function clearSelection() {
    state.selectedCode = null;
    state.selectedLayer = null;
    state.geoLayer?.setStyle(countryStyle);
    $('#atlas-selected-name').textContent = 'Nothing selected yet';
    $('#atlas-selected-country').classList.remove('has-selection');
    $('#atlas-confirm').disabled = true;
    $('#atlas-country-search').value = '';
  }

  function progress() {
    $$('#expedition-progress span').forEach((span,i) => {
      span.classList.toggle('current',i===state.clueIndex);
      span.classList.toggle('done',i<state.clueIndex);
      span.textContent=String(i+1).padStart(2,'0');
    });
    $('#expedition-clue-index').textContent='CLUE '+String(state.clueIndex+1).padStart(2,'0')+' / 05';
    $('#expedition-distance').textContent=nf.format(state.distance)+' km';
  }

  function renderClue() {
    const clue=state.expedition.prompts[state.clueIndex];
    $('#expedition-clue-title').textContent=clue.title;
    $('#expedition-clue-note').textContent=clue.note || 'Find a country that fits the clue.';
    $('#expedition-feedback').hidden=true;
    $('#atlas-next').hidden=true;
    $('#atlas-confirm').hidden=false;
    $('#atlas-confirm').disabled=true;
    $('#atlas-confirm').textContent='Confirm this country ↗';
    $('#expedition-clue-card')?.classList.remove('answered');
    state.revealed=new Set();
    clearSelection();
    state.geoLayer?.setStyle(countryStyle);
    progress();
  }

  async function startExpedition(mode) {
    if (!state.countries.length) await loadCountries();
    if (!state.countries.length) return;
    const button=$('[data-start-expedition="'+mode+'"]');
    if (button) button.disabled=true;
    try {
      const result=await api('/arcade/expedition?mode='+(mode==='practice'?'practice':'daily'));
      const alreadyDone=mode==='daily' && localStorage.getItem('humanity-atlas-daily-'+result.date);
      if (alreadyDone) {
        result = await api('/arcade/expedition?mode=practice');
      }
      state.expedition=result;
      state.expeditionMode=alreadyDone?'practice':mode;
      state.clueIndex=0; state.answers=[]; state.distance=0; state.pending=false; state.finished=false;
      $('#expedition-date').textContent=new Date(result.date+'T00:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
      $('#expedition-attempt-note').textContent=alreadyDone
        ? 'Your daily score is already saved on this device. You are starting an unlimited practice route.'
        : 'The same five clues are waiting for explorers everywhere today.';
      if (alreadyDone) toast('Daily result already submitted. Starting practice instead.');
      hide($('#expedition-intro'),true); hide($('#expedition-finish'),true); hide($('#expedition-play'),false);
      await initMap();
      renderClue();
      requestAnimationFrame(()=>state.map?.invalidateSize());
    } catch (error) { toast(error.message||'The expedition could not start.'); }
    finally { if (button) button.disabled=false; }
  }

  async function confirmAnswer() {
    if (!state.expedition || !state.selectedCode || state.pending || state.finished) return;
    state.pending=true;
    $('#atlas-confirm').disabled=true;
    $('#atlas-confirm').textContent='Checking your pin…';
    try {
      const {result}=await api('/arcade/expedition/answer',{
        method:'POST',
        body:{challengeId:state.expedition.challengeId,promptIndex:state.clueIndex,countryCode:state.selectedCode}
      });
      state.answers.push(result);
      state.distance+=result.kilometres||0;
      state.revealed=new Set((result.revealed||[]).map(x=>x.code));
      state.geoLayer?.setStyle(countryStyle);
      const feedback=$('#expedition-feedback');
      feedback.hidden=false;
      feedback.className='expedition-feedback '+(result.correct?'is-correct':'is-incorrect');
      feedback.innerHTML='<strong>'+(result.correct?'Good discovery!':'Not this time.')+'</strong><p>'+
        esc(result.countryName)+(result.correct?' fits this clue and earns <b>'+nf.format(result.kilometres)+' km</b>.':' does not fit this clue. The countries that fit are now marked on the map.')+'</p>'+
        (result.correct?'<span class="atlas-tier-stamp">'+esc(result.tier)+' discovery</span>':'');
      $('#atlas-confirm').hidden=true;
      $('#atlas-next').hidden=false;
      $('#atlas-next').textContent=state.clueIndex===4?'See expedition results →':'Next clue →';
      $('#expedition-clue-card').classList.add('answered');
      state.pending=false;
      state.finished=state.clueIndex===4;
      progress();
    } catch (error) {
      toast(error.message||'The atlas could not check your answer.');
      $('#atlas-confirm').disabled=false;
      $('#atlas-confirm').textContent='Confirm this country ↗';
      state.pending=false;
    }
  }

  function finishExpedition() {
    hide($('#expedition-play'),true);
    hide($('#expedition-finish'),false);
    $('#expedition-final-distance').textContent=nf.format(state.distance)+' km';
    const correct=state.answers.filter(x=>x.correct).length;
    $('#expedition-final-copy').textContent=correct+' of 5 discoveries matched the atlas. Less obvious countries added more distance to your route.';
    const daily=state.expeditionMode==='daily';
    hide($('#expedition-submit-form'),!daily);
    if (daily && readNickname()) $('#expedition-nickname').value=readNickname();
    if (!daily) $('#expedition-leaderboard-result').textContent='Practice runs do not enter the daily leaderboard.';
  }

  async function saveExpedition(event) {
    event.preventDefault();
    if (!state.expedition || state.expeditionMode!=='daily') return;
    const button=$('button[type="submit"]',event.currentTarget);
    try {
      const name=nickname($('#expedition-nickname').value);
      button.disabled=true; button.textContent='Saving…';
      const result=await api('/arcade/expedition/finish',{
        method:'POST',body:{challengeId:state.expedition.challengeId,nickname:name}
      });
      localStorage.setItem('humanity-atlas-daily-'+result.date,String(result.score));
      $('#expedition-leaderboard-result').textContent='Saved · '+nf.format(result.score)+' points · '+nf.format(result.totalKm)+' km';
      event.currentTarget.innerHTML='<p class="score-saved"><strong>✦ Your expedition is on the leaderboard.</strong><span>'+esc(name)+' · '+nf.format(result.score)+' points</span></p>';
      loadDailyLeaderboard();
    } catch (error) {
      toast(error.message||'Your result could not be saved.');
      button.disabled=false; button.textContent='Save score ↗';
    }
  }

  async function loadDailyLeaderboard() {
    const list=$('#expedition-leaderboard');
    if (!list) return;
    try {
      const result=await api('/arcade/leaderboard');
      list.innerHTML=result.entries.length?result.entries.map(entry=>
        '<div class="leaderboard-row"><span class="leaderboard-rank">'+String(entry.rank).padStart(2,'0')+'</span><strong>'+esc(entry.nickname)+'</strong><span>'+nf.format(entry.total_km)+' km</span><b>'+nf.format(entry.score)+' pts</b></div>'
      ).join(''):'<p class="leaderboard-empty">The atlas is waiting for its first explorers today.</p>';
    } catch (_) { list.innerHTML='<p class="leaderboard-empty">Daily standings are temporarily unavailable.</p>'; }
  }

  async function shareExpedition() {
    const text='I explored '+nf.format(state.distance)+' km in the HUMANITY Atlas Expedition. Can you beat my route?';
    const url=location.origin+location.pathname+'#games';
    try {
      if (navigator.share) await navigator.share({title:'HUMANITY Atlas Expedition',text,url});
      else { await navigator.clipboard.writeText(text+' '+url); toast('Your result was copied.'); }
    } catch (error) { if(error.name!=='AbortError') toast('Sharing is not available here.'); }
  }

  async function startMystery(mode) {
    try {
      const result=await api('/arcade/mystery?mode='+(mode==='practice'?'practice':'daily'));
      state.mystery=result; state.mysteryMode=mode; state.mysteryGuesses=0;
      hide($('#mystery-intro'),true); hide($('#mystery-play'),false);
      $('#mystery-number').textContent='01';
      $('#mystery-guesses').textContent='3 guesses remaining';
      $('#mystery-clue-stack').innerHTML='<article class="mystery-clue visible"><span>01</span><p>'+esc(result.clue)+'</p></article>';
      $('#mystery-feedback').hidden=true; hide($('#mystery-after-actions'),true);
      hide($('#mystery-guess-form'),false);
      $('#mystery-guess').value=''; $('#mystery-guess').disabled=false;
      $('#mystery-guess-form button').disabled=false; $('#mystery-guess').focus();
    } catch (error) { toast(error.message||'Mystery Country could not start.'); }
  }

  async function guessMystery(event) {
    event.preventDefault();
    const country=findCountry($('#mystery-guess').value);
    if (!country) { toast('Choose a country from the list.'); return; }
    const button=$('#mystery-guess-form button');
    button.disabled=true;
    try {
      const result=await api('/arcade/mystery/guess',{
        method:'POST',body:{challengeId:state.mystery.challengeId,countryCode:country.code}
      });
      state.mysteryGuesses++;
      $('#mystery-guess').value='';
      $('#mystery-guesses').textContent=result.guessesRemaining+' guesses remaining';
      if (result.correct) {
        $('#mystery-feedback').className='mystery-feedback success';
        $('#mystery-feedback').innerHTML='<strong>✦ Mystery solved!</strong><p>You found '+esc(result.answer)+' in '+state.mysteryGuesses+' guess'+(state.mysteryGuesses===1?'':'es')+' and earned '+nf.format(result.score)+' points.</p>';
      } else if (result.finished) {
        $('#mystery-feedback').className='mystery-feedback reveal';
        $('#mystery-feedback').innerHTML='<strong>The atlas reveals… '+esc(result.answer)+'.</strong><p>That was the final clue. Start another mystery and find somewhere new.</p>';
      } else {
        const number=state.mysteryGuesses+1;
        $('#mystery-clue-stack').insertAdjacentHTML('beforeend','<article class="mystery-clue visible"><span>'+String(number).padStart(2,'0')+'</span><p>'+esc(result.clue)+'</p></article>');
        $('#mystery-feedback').className='mystery-feedback';
        $('#mystery-feedback').innerHTML='<strong>Not quite — keep exploring.</strong><p>'+esc(country.name)+' is not the mystery country. A new clue has appeared.</p>';
      }
      $('#mystery-feedback').hidden=false;
      if (result.finished) {
        $('#mystery-guess').disabled=true;
        hide($('#mystery-guess-form'),true);
        hide($('#mystery-after-actions'),false);
      } else { button.disabled=false; $('#mystery-guess').focus(); }
    } catch (error) { toast(error.message||'The mystery could not check that guess.'); button.disabled=false; }
  }

  function connectParty(action=null) {
    if (action) state.pendingAction=action;
    if (state.socket && [WebSocket.OPEN,WebSocket.CONNECTING].includes(state.socket.readyState)) return;
    try {
      const socket=new WebSocket(SOCKET_URL);
      state.socket=socket;
      socket.addEventListener('open',()=>{
        state.reconnectAttempt=0;
        if (state.pendingAction) {
          const pending=state.pendingAction; state.pendingAction=null;
          socket.send(JSON.stringify(pending));
        } else if (state.roomCode && state.resumeToken) {
          socket.send(JSON.stringify({type:'reconnect',code:state.roomCode,resumeToken:state.resumeToken}));
        }
        loadPublicRooms();
      });
      socket.addEventListener('message',event=>{
        try { handlePartyMessage(JSON.parse(event.data)); } catch (_) { /* Ignore malformed server messages. */ }
      });
      socket.addEventListener('close',()=>{
        if (state.roomCode && state.resumeToken && state.reconnectAttempt<7) {
          const wait=Math.min(12000,800*Math.pow(2,state.reconnectAttempt++));
          clearTimeout(state.reconnectTimer);
          state.reconnectTimer=setTimeout(()=>connectParty(),wait);
        }
      });
      socket.addEventListener('error',()=>toast('Atlas Party connection was interrupted.'));
    } catch (_) { toast('Atlas Party could not connect to the game server.'); }
  }

  function partySend(message) {
    if (state.socket?.readyState===WebSocket.OPEN) state.socket.send(JSON.stringify(message));
    else connectParty(message);
  }

  function handlePartyMessage(message) {
    if (message.type==='connected') return;
    if (message.type==='joined') {
      state.roomCode=message.roomCode; state.playerId=message.playerId; state.resumeToken=message.resumeToken;
      localStorage.setItem('humanity-atlas-party-resume',JSON.stringify({
        code:message.roomCode,playerId:message.playerId,resumeToken:message.resumeToken
      }));
      $('#party-room-code-display').textContent=message.roomCode;
      hide($('#party-lobby-screen'),true); hide($('#party-room-screen'),false);
      return;
    }
    if (message.type==='room_state') { state.room=message.room; renderPartyRoom(); return; }
    if (message.type==='timer') {
      state.timerMs=message.remainingMs;
      state.timerDurationMs=message.durationMs||state.timerDurationMs;
      renderPartyTimer(message.remainingMs,message.holderId,message.durationMs);
      return;
    }
    if (message.type==='answer_accepted') { toast(message.nickname+' found '+message.country+' · +'+message.points+' points'); return; }
    if (message.type==='fuse_popped') { toast(message.nickname+' lost a life when the atlas ran out!'); return; }
    if (message.type==='game_over') { renderPartyResults(message); return; }
    if (message.type==='public_rooms_changed') { if(state.activeTab==='party') loadPublicRooms(); return; }
    if (message.type==='removed'||message.type==='room_closed') { toast(message.message||'You left this room.'); resetParty(); return; }
    if (message.type==='left_room') { resetParty(); return; }
    if (message.type==='error') toast(message.message||'That action could not be completed.');
  }

  function renderPartyTimer(milliseconds, holderId, durationMs=state.timerDurationMs) {
    const duration=Math.max(1,Number(durationMs)||30000);
    const remaining=Math.max(0,Math.min(duration,Number(milliseconds)||0));
    state.timerDurationMs=duration;
    const bar=$('#party-timer-fill');
    bar.style.width=(remaining/duration*100)+'%';
    bar.classList.toggle('urgent',remaining<7000);
    const holder=state.room?.players?.find(p=>p.id===holderId);
    const yourTurn=Boolean(state.room?.phase==='playing' && holderId===state.playerId);
    $('#party-turn-status').textContent=yourTurn?'Your turn — name a country and pass the atlas!':
      (holder?holder.nickname+' is holding the atlas…':'The atlas is moving around the crew…');
    $('#party-answer').disabled=!yourTurn;
    $('#party-pass-button').disabled=!yourTurn;
    if (yourTurn && document.activeElement!==$('#party-answer')) $('#party-answer').focus();
  }

  function renderPartyRoom() {
    const room=state.room;
    if (!room) return;
    hide($('#party-lobby-screen'),true); hide($('#party-room-screen'),false);
    $('#party-room-code-display').textContent=room.code;
    $('#party-room-visibility').textContent=room.visibility==='private'?'PRIVATE ROOM':'PUBLIC ROOM';
    $('#party-player-count').textContent=room.players.length+' / '+room.maxPlayers;
    $('#party-player-grid').innerHTML=room.players.map(player=>
      '<article class="party-player-card '+(player.isYou?'is-you ':'')+(player.id===room.currentHolderId?'is-holder':'')+'">'+
      '<span class="party-avatar">'+esc(player.nickname.slice(0,1).toUpperCase())+'</span><div class="party-player-name"><strong>'+esc(player.nickname)+(player.isYou?' <small>YOU</small>':'')+'</strong>'+
      '<span>'+(player.isHost?'HOST':(player.ready?'READY':'NOT READY'))+(player.connected?'':' · RECONNECTING')+'</span></div>'+
      '<span class="party-player-lives" aria-label="'+player.lives+' lives">'+'♥'.repeat(player.lives)+'<i>'+'♡'.repeat(3-player.lives)+'</i></span></article>'
    ).join('');
    $('#party-scoreboard').innerHTML=room.players.slice().sort((a,b)=>b.score-a.score).map(p=>
      '<div class="party-score-row"><span>'+esc(p.nickname)+'</span><b>'+nf.format(p.score)+'</b><small>'+'♥'.repeat(p.lives)+'</small></div>'
    ).join('');
    const lobby=room.phase==='lobby', playing=room.phase==='playing', finished=room.phase==='finished';
    hide($('#party-lobby-controls'),!lobby); hide($('#party-game-board'),!playing); hide($('#party-game-over'),!finished);
    hide($('#party-rematch'),!finished||!room.players.some(p=>p.isYou&&p.isHost));
    if (lobby) {
      $('#party-phase-label').textContent='LOBBY / WAITING FOR EXPLORERS';
      $('#party-phase-title').textContent='Your expedition crew.';
      $('#party-phase-note').textContent=room.players.length+' explorers have joined. Share the code and start when everyone is ready.';
      const me=room.players.find(p=>p.isYou);
      $('#party-ready').textContent=me?.ready?'I’m not ready':'I’m ready ✓';
      hide($('#party-start'),!me?.isHost);
      $('#party-start').disabled=room.players.length<2||room.players.some(p=>!p.ready);
    } else if (playing) {
      $('#party-category-title').textContent=room.category?.title||'Find a country…';
      $('#party-used-list').innerHTML=room.usedAnswers.length?room.usedAnswers.map(code=>'<span>'+esc(state.byCode.get(code)?.name || code)+'</span>').join(''):'No countries named yet.';
      renderPartyTimer(room.timerRemaining??state.timerMs,room.currentHolderId,room.timerDurationMs||state.timerDurationMs);
    } else if (finished) {
      $('#party-phase-label').textContent='PARTY COMPLETE';
      $('#party-phase-title').textContent='The atlas has landed.';
      $('#party-phase-note').textContent='The host can start a rematch with the same crew.';
    }
  }

  function renderPartyResults(message) {
    hide($('#party-game-board'),true); hide($('#party-game-over'),false);
    $('#party-game-over').innerHTML='<div class="party-winner-mark">✦</div><div class="eyebrow">THE FINAL EXPLORER</div><h3>'+
      esc(message.winner||'No winner')+' <em>wins!</em></h3><p>The compass has come to rest. Here is how your crew finished.</p>'+
      '<div class="party-final-ranking">'+message.ranking.map(item=>
        '<div><span>'+String(item.rank).padStart(2,'0')+'</span><strong>'+esc(item.nickname)+'</strong><b>'+nf.format(item.score)+' pts</b><small>'+'♥'.repeat(item.lives)+'</small></div>'
      ).join('')+'</div>';
    loadPartyLeaderboard();
  }

  function resetParty() {
    state.room=null;state.roomCode=null;state.playerId=null;state.resumeToken=null;
    localStorage.removeItem('humanity-atlas-party-resume');
    hide($('#party-room-screen'),true);hide($('#party-lobby-screen'),false);
    hide($('#party-game-over'),true);
    loadPublicRooms();
  }

  async function loadPublicRooms() {
    const list=$('#party-rooms-list'); if(!list) return;
    try {
      const result=await api('/arcade/rooms');
      list.innerHTML=result.rooms.length?result.rooms.map(room=>
        '<article class="party-public-room"><div><strong>'+esc(room.code)+'</strong><span>'+esc(room.host)+' · '+room.players+'/'+room.capacity+'</span></div>'+
        '<button type="button" class="button button-outline" data-join-room="'+esc(room.code)+'">Join ↗</button></article>'
      ).join(''):'<p class="leaderboard-empty">No open rooms right now. Create one and invite your friends.</p>';
    } catch (_) { list.innerHTML='<p class="leaderboard-empty">Public rooms are temporarily unavailable.</p>'; }
  }

  async function loadPartyLeaderboard() {
    const list=$('#party-leaderboard');if(!list)return;
    try {
      const result=await api('/arcade/party/leaderboard');
      list.innerHTML=result.entries.length?result.entries.map(entry=>
        '<div class="leaderboard-row"><span class="leaderboard-rank">'+String(entry.rank).padStart(2,'0')+'</span><strong>'+esc(entry.nickname)+'</strong><span>'+entry.games+' games</span><b>'+nf.format(entry.score)+' pts</b></div>'
      ).join(''):'<p class="leaderboard-empty">Your first party champions will appear here.</p>';
    } catch (_) { list.innerHTML='<p class="leaderboard-empty">Party standings are temporarily unavailable.</p>'; }
  }

  function initExpedition() {
    $$('[data-start-expedition]').forEach(b=>b.addEventListener('click',()=>startExpedition(b.dataset.startExpedition)));
    $('#atlas-confirm').addEventListener('click',confirmAnswer);
    $('#atlas-next').addEventListener('click',()=>{
      if(state.clueIndex===4)finishExpedition();
      else {state.clueIndex++;renderClue();}
    });
    $('#atlas-map-reset').addEventListener('click',()=>{if(state.map&&state.geoLayer)state.map.fitBounds(state.geoLayer.getBounds(),{padding:[12,12]});});
    $('#atlas-country-select').addEventListener('click',()=>{
      const c=findCountry($('#atlas-country-search').value);
      if(!c){toast('Choose a country from the list.');return;}
      selectCountry(c.code,c.name);
    });
    $('#atlas-country-search').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('#atlas-country-select').click();}});
    $('#expedition-submit-form').addEventListener('submit',saveExpedition);
    $('#expedition-share').addEventListener('click',shareExpedition);
    $('#expedition-leaderboard-refresh').addEventListener('click',loadDailyLeaderboard);
  }

  function initMystery() {
    $$('[data-start-mystery]').forEach(b=>b.addEventListener('click',()=>startMystery(b.dataset.startMystery)));
    $('#mystery-guess-form').addEventListener('submit',guessMystery);
    $('#mystery-back').addEventListener('click',()=>{hide($('#mystery-play'),true);hide($('#mystery-intro'),false);});
  }

  function initParty() {
    $('#party-create-private').addEventListener('click',()=>createRoom('private'));
    $('#party-create-public').addEventListener('click',()=>createRoom('public'));
    $('#party-join-form').addEventListener('submit',e=>{e.preventDefault();joinRoom($('#party-room-code').value);});
    $('#party-quick-play').addEventListener('click',()=>{
      try {partySend({type:'quick_play',nickname:nickname($('#party-nickname').value)});}
      catch(error){toast(error.message);}
    });
    $('#party-refresh-rooms').addEventListener('click',loadPublicRooms);
    $('#party-rooms-list').addEventListener('click',e=>{
      const b=e.target.closest('[data-join-room]');if(b)joinRoom(b.dataset.joinRoom);
    });
    $('#party-ready').addEventListener('click',()=>{
      const me=state.room?.players.find(p=>p.isYou);
      partySend({type:'ready',ready:!me?.ready});
    });
    $('#party-start').addEventListener('click',()=>partySend({type:'start_game'}));
    $('#party-answer-form').addEventListener('submit',e=>{
      e.preventDefault();const answer=$('#party-answer').value.trim();if(!answer)return;
      partySend({type:'submit_answer',answer});$('#party-answer').value='';
    });
    $('#party-leave').addEventListener('click',()=>{
      if(state.socket?.readyState===WebSocket.OPEN)state.socket.send(JSON.stringify({type:'leave_room'}));
      resetParty();
    });
    $('#party-copy-code').addEventListener('click',async()=>{
      try{await navigator.clipboard.writeText(state.roomCode||'');toast('Room code copied. Invite your friends!');}
      catch(_){toast('Room code: '+state.roomCode);}
    });
    $('#party-rematch').addEventListener('click',()=>partySend({type:'rematch'}));
    try {
      const saved=JSON.parse(localStorage.getItem('humanity-atlas-party-resume')||'null');
      if(saved?.code&&saved?.resumeToken){state.roomCode=saved.code;state.resumeToken=saved.resumeToken;connectParty();}
    } catch(_){localStorage.removeItem('humanity-atlas-party-resume');}
    setInterval(()=>{if(state.activeTab==='party')loadPublicRooms();},10000);
    loadPublicRooms();loadPartyLeaderboard();
  }

  function createRoom(visibility) {
    try { partySend({type:'create_room',visibility,nickname:nickname($('#party-nickname').value)}); }
    catch(error){toast(error.message);}
  }

  function joinRoom(code) {
    try { partySend({type:'join_room',code:String(code||'').toUpperCase(),nickname:nickname($('#party-nickname').value)}); }
    catch(error){toast(error.message);}
  }

  function initTabs() {
    $$('.arcade-tab').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.arcadeTab)));
  }

  document.addEventListener('DOMContentLoaded',async()=>{
    initTabs();initExpedition();initMystery();initParty();
    await loadCountries();
    if(location.hash==='#games')switchTab('expedition');
  });
})();
