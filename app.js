/* PlayList: paste a YouTube / YouTube Music playlist and listen.
   Playback runs through the official YouTube IFrame Player API. */
(() => {
  'use strict';

  const STORE_KEY = 'playlist-app:v1';
  const TITLE_KEY = 'playlist-app:titles:v1';
  const LEGACY_STORE_KEY = 'highway-player:v1';        // keep data saved under the old name
  const LEGACY_TITLE_KEY = 'highway-player:titles:v1';
  const SAMPLE = {
    url: 'https://music.youtube.com/playlist?list=PLgObA3pAqvOh87Z03QG8Z4xE-uqlAWSBy',
    name: 'Desi highway mix',
  };
  const SKIPPABLE_ERRORS = [5, 100, 101, 150];

  const $ = (id) => document.getElementById(id);
  const els = {
    form: $('addForm'), link: $('linkInput'), name: $('nameInput'), msg: $('formMsg'),
    sample: $('sampleBtn'), empty: $('emptyState'),
    nowList: $('nowPlaylist'), nowTitle: $('nowTitle'), nowArtist: $('nowArtist'),
    seek: $('seek'), cur: $('curTime'), dur: $('durTime'),
    play: $('playBtn'), prev: $('prevBtn'), next: $('nextBtn'),
    shuffle: $('shuffleBtn'), loop: $('loopBtn'), volume: $('volume'),
    share: $('shareBtn'), openYt: $('openYt'),
    playlists: $('playlists'), queue: $('queue'), queueCount: $('queueCount'),
  };

  const ICONS = {
    list: '<svg class="stroke" viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
    video: '<svg viewBox="0 0 24 24"><path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14z"/></svg>',
    edit: '<svg class="stroke" viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    remove: '<svg class="stroke" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  };

  /* ---------- Storage ---------- */
  const readJSON = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  };
  const writeJSON = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked */ }
  };

  const state = Object.assign(
    { playlists: [], activeId: null, volume: 80, shuffle: false, loop: true },
    readJSON(STORE_KEY, null) ?? readJSON(LEGACY_STORE_KEY, {})
  );
  const titles = readJSON(TITLE_KEY, null) ?? readJSON(LEGACY_TITLE_KEY, {});
  const save = () => writeJSON(STORE_KEY, state);
  let titleSaveTimer = 0;
  const saveTitles = () => {
    clearTimeout(titleSaveTimer);
    titleSaveTimer = setTimeout(() => writeJSON(TITLE_KEY, titles), 600);
  };

  /* ---------- Runtime state ---------- */
  let player = null;
  let ready = false;
  let needsModes = false;     // shuffle/loop must be re-applied after a playlist loads
  let currentVideo = null;
  let queueKey = '';
  let seeking = false;
  let tickTimer = 0;
  let msgTimer = 0;
  let errorStreak = 0;
  let titleRun = 0;

  const active = () => state.playlists.find((p) => p.id === state.activeId) || null;

  /* ---------- Link parsing ---------- */
  const VIDEO_ID = /^[\w-]{11}$/;
  const LIST_ID = /^(PL|OL|UU|FL|LL|RD|LM|OLAK)[\w-]{8,}$/;

  function parseLink(raw) {
    const s = (raw || '').trim();
    if (!s) return null;
    if (LIST_ID.test(s)) return { kind: 'playlist', ref: s, music: false };
    if (VIDEO_ID.test(s)) return { kind: 'video', ref: s, music: false };

    let url;
    try { url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`); } catch { return null; }
    const host = url.hostname.toLowerCase().replace(/^(www|m)\./, '');

    if (host.endsWith('spotify.com') || host.endsWith('apple.com') || host.endsWith('jiosaavn.com')) {
      return { error: 'Only YouTube and YouTube Music links can be played here. Spotify, Apple Music and JioSaavn links won\'t work.' };
    }
    if (!['youtube.com', 'music.youtube.com', 'youtu.be', 'youtube-nocookie.com'].includes(host)) {
      return { error: 'That isn\'t a YouTube link. Paste a YouTube or YouTube Music playlist URL.' };
    }

    const music = host === 'music.youtube.com';
    const list = url.searchParams.get('list');
    let v = url.searchParams.get('v');
    if (host === 'youtu.be') v = url.pathname.slice(1).split('/')[0];
    const pathMatch = url.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{11})/);
    if (pathMatch) v = pathMatch[1];

    if (list && /^[\w-]+$/.test(list)) return { kind: 'playlist', ref: list, music };
    if (v && VIDEO_ID.test(v)) return { kind: 'video', ref: v, music };
    return null;
  }

  function externalUrl(item) {
    if (item.kind === 'playlist') {
      return item.music
        ? `https://music.youtube.com/playlist?list=${item.ref}`
        : `https://www.youtube.com/playlist?list=${item.ref}`;
    }
    return item.music
      ? `https://music.youtube.com/watch?v=${item.ref}`
      : `https://www.youtube.com/watch?v=${item.ref}`;
  }

  function shareUrl(item) {
    const base = location.href.split('#')[0];
    return `${base}#${item.kind === 'playlist' ? 'list' : 'v'}=${item.ref}`;
  }

  /* ---------- Messages ---------- */
  function showMsg(text, isError = false) {
    els.msg.textContent = text;
    els.msg.classList.toggle('is-error', isError);
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => { els.msg.textContent = ''; }, 6000);
  }

  /* ---------- Playlists ---------- */
  function addLink(raw, name, { autoplay = true, quiet = false } = {}) {
    const parsed = parseLink(raw);
    if (!parsed || parsed.error) {
      showMsg(parsed?.error || 'That doesn\'t look like a YouTube playlist or video link.', true);
      return null;
    }
    const cleanName = (name || '').trim();
    let item = state.playlists.find((p) => p.kind === parsed.kind && p.ref === parsed.ref);
    if (item) {
      if (cleanName) item.name = cleanName;
      if (!quiet) showMsg(`“${item.name}” is already saved. Playing it now.`);
    } else {
      const count = state.playlists.filter((p) => p.kind === parsed.kind).length + 1;
      item = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        kind: parsed.kind,
        ref: parsed.ref,
        music: parsed.music,
        name: cleanName || (parsed.kind === 'playlist' ? `Playlist ${count}` : `Song ${count}`),
      };
      state.playlists.unshift(item);
      if (!quiet) showMsg(`Added “${item.name}”.`);
    }
    save();
    openItem(item, autoplay);
    return item;
  }

  function openItem(item, autoplay) {
    state.activeId = item.id;
    save();
    renderPlaylists();
    syncHeader();
    els.empty.hidden = true;
    if (!ready) return; // onReady will cue the active item
    errorStreak = 0;
    needsModes = true;
    queueKey = '';
    currentVideo = null;
    if (item.kind === 'playlist') {
      const opts = { list: item.ref, listType: 'playlist', index: 0 };
      autoplay ? player.loadPlaylist(opts) : player.cuePlaylist(opts);
    } else {
      autoplay ? player.loadVideoById(item.ref) : player.cueVideoById(item.ref);
    }
  }

  function removeItem(id) {
    const idx = state.playlists.findIndex((p) => p.id === id);
    if (idx < 0) return;
    const wasActive = state.activeId === id;
    state.playlists.splice(idx, 1);
    if (wasActive) {
      const fallback = state.playlists[Math.min(idx, state.playlists.length - 1)] || null;
      if (fallback) {
        openItem(fallback, false);
      } else {
        state.activeId = null;
        if (ready) player.stopVideo();
        resetNowPlaying();
      }
    }
    save();
    renderPlaylists();
    syncHeader();
  }

  function renderPlaylists() {
    els.playlists.replaceChildren();
    if (!state.playlists.length) {
      const li = document.createElement('li');
      li.className = 'empty-row';
      li.textContent = 'No playlists yet. Paste a link above.';
      els.playlists.append(li);
      return;
    }
    for (const p of state.playlists) {
      const li = document.createElement('li');
      li.dataset.id = p.id;
      li.classList.toggle('is-active', p.id === state.activeId);
      li.innerHTML = `
        <button class="pl-main" type="button" data-action="open">
          <span class="pl-icon">${p.kind === 'playlist' ? ICONS.list : ICONS.video}</span>
          <span class="pl-text"><span class="pl-name"></span><span class="pl-meta"></span></span>
        </button>
        <button class="icon-sm" type="button" data-action="rename" title="Rename" aria-label="Rename">${ICONS.edit}</button>
        <button class="icon-sm" type="button" data-action="remove" title="Remove" aria-label="Remove">${ICONS.remove}</button>`;
      li.querySelector('.pl-name').textContent = p.name;
      li.querySelector('.pl-meta').textContent =
        (p.kind === 'playlist' ? 'Playlist' : 'Single track') + (p.music ? ' · YouTube Music' : ' · YouTube');
      els.playlists.append(li);
    }
  }

  function syncHeader() {
    const item = active();
    els.openYt.hidden = !item;
    els.share.disabled = !item;
    if (item) {
      els.openYt.href = externalUrl(item);
      els.openYt.querySelector('span').textContent = item.music ? 'Open on YouTube Music' : 'Open on YouTube';
      els.nowList.textContent = item.name;
    } else {
      els.nowList.textContent = 'No playlist';
    }
  }

  function resetNowPlaying() {
    els.empty.hidden = false;
    els.nowTitle.textContent = 'Nothing playing';
    els.nowArtist.textContent = '';
    els.queue.replaceChildren();
    els.queueCount.textContent = '';
    queueKey = '';
    currentVideo = null;
    document.title = 'PlayList: your playlists, one tap away';
    setPlayingUI(false);
    setRange(els.seek, 0);
    els.cur.textContent = els.dur.textContent = '0:00';
  }

  /* ---------- Queue ---------- */
  function syncQueue() {
    const list = player?.getPlaylist?.();
    const ids = Array.isArray(list) && list.length ? list : (currentVideo ? [currentVideo] : []);
    const key = ids.join(',');
    if (key !== queueKey) {
      queueKey = key;
      renderQueue(ids);
    }
    highlightQueue();
  }

  function renderQueue(ids) {
    els.queue.replaceChildren();
    if (!ids.length) {
      const li = document.createElement('li');
      li.className = 'empty-row';
      li.textContent = 'The track list appears here once the playlist loads.';
      els.queue.append(li);
      els.queueCount.textContent = '';
      return;
    }
    const frag = document.createDocumentFragment();
    ids.forEach((id, i) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'track';
      btn.dataset.index = String(i);
      btn.dataset.vid = id;
      const num = document.createElement('span');
      num.className = 'track-num';
      num.textContent = String(i + 1);
      const img = document.createElement('img');
      img.src = `https://i.ytimg.com/vi/${encodeURIComponent(id)}/mqdefault.jpg`;
      img.alt = '';
      img.loading = 'lazy';
      img.width = 64;
      img.height = 36;
      const title = document.createElement('span');
      title.className = 'track-title';
      title.textContent = titles[id] || 'Loading title…';
      btn.append(num, img, title);
      li.append(btn);
      frag.append(li);
    });
    els.queue.append(frag);
    els.queueCount.textContent = `${ids.length} ${ids.length === 1 ? 'track' : 'tracks'}`;
    fetchTitles(ids);
  }

  function highlightQueue() {
    const idx = player?.getPlaylist?.() ? player.getPlaylistIndex() : 0;
    let current = null;
    els.queue.querySelectorAll('.track').forEach((btn) => {
      const on = Number(btn.dataset.index) === idx;
      btn.setAttribute('aria-current', on ? 'true' : 'false');
      if (on) current = btn;
    });
    if (current) {
      const li = current.parentElement;
      const top = li.offsetTop;
      const view = els.queue;
      if (top < view.scrollTop || top + li.offsetHeight > view.scrollTop + view.clientHeight) {
        view.scrollTop = top - view.clientHeight / 2 + li.offsetHeight / 2;
      }
    }
  }

  function setTrackTitle(id, title) {
    els.queue.querySelectorAll(`.track[data-vid="${CSS.escape(id)}"] .track-title`).forEach((el) => {
      el.textContent = title || `Track ${Number(el.parentElement.dataset.index) + 1}`;
    });
  }

  // The IFrame API only exposes video IDs, so titles come from a free oEmbed proxy.
  // They are cached in localStorage, and the player fills in each title as it plays.
  async function fetchTitles(ids) {
    const run = ++titleRun;
    const todo = ids.filter((id) => !titles[id]);
    let next = 0;
    const worker = async () => {
      while (next < todo.length && run === titleRun) {
        const id = todo[next++];
        try {
          const target = encodeURIComponent(`https://www.youtube.com/watch?v=${id}`);
          const res = await fetch(`https://noembed.com/embed?url=${target}`);
          const data = await res.json();
          if (data && data.title) {
            titles[id] = data.title;
            saveTitles();
            setTrackTitle(id, data.title);
          } else {
            setTrackTitle(id, null);
          }
        } catch {
          setTrackTitle(id, null);
        }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  }

  /* ---------- Now playing ---------- */
  function syncNowPlaying() {
    const data = player?.getVideoData?.() || {};
    const id = data.video_id;
    if (!id) return;
    const title = data.title || titles[id] || 'Loading…';
    els.nowTitle.textContent = title;
    els.nowArtist.textContent = data.author || '';
    if (data.title && titles[id] !== data.title) {
      titles[id] = data.title;
      saveTitles();
      setTrackTitle(id, data.title);
    }
    if (id !== currentVideo || data.title) {
      document.title = data.title ? `${data.title} · PlayList` : 'PlayList';
      updateMediaSession(id, data);
    }
    currentVideo = id;
  }

  function updateMediaSession(id, data) {
    if (!('mediaSession' in navigator) || !data.title) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: data.title,
      artist: data.author || '',
      album: active()?.name || 'PlayList',
      artwork: [{ src: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, sizes: '480x360', type: 'image/jpeg' }],
    });
  }

  /* ---------- Player events ---------- */
  function applyModes() {
    if (!player?.getPlaylist?.()) return false;
    player.setLoop(state.loop);
    player.setShuffle(state.shuffle);
    return true;
  }

  function onReady() {
    ready = true;
    player.setVolume(state.volume);
    const item = active();
    if (item) openItem(item, false);
    else resetNowPlaying();
  }

  function onStateChange(e) {
    const S = YT.PlayerState;
    const playing = e.data === S.PLAYING || e.data === S.BUFFERING;
    if (e.data === S.PLAYING) errorStreak = 0;
    setPlayingUI(playing);

    if (needsModes && applyModes()) {
      needsModes = false;
      queueKey = ''; // shuffle may have reordered the list
    }
    syncNowPlaying();
    syncQueue();

    if (e.data === S.ENDED && active()?.kind === 'video' && state.loop) {
      player.seekTo(0, true);
      player.playVideo();
    }
    if (playing) startTick(); else stopTick();
    updateTime();
  }

  function onError(e) {
    const code = e.data;
    const messages = {
      2: 'That playlist or video ID looks invalid. Check the link.',
      5: 'This track can\'t play in the browser player.',
      100: 'This track was removed or made private.',
      101: 'The owner doesn\'t allow this track to play outside YouTube.',
      150: 'The owner doesn\'t allow this track to play outside YouTube.',
      153: 'YouTube blocked the player. Open this site through a web server (http://…), not as a local file.',
    };
    const canSkip = SKIPPABLE_ERRORS.includes(code) && (player.getPlaylist?.()?.length || 0) > 1 && errorStreak < 8;
    showMsg((messages[code] || `Playback error (${code}).`) + (canSkip ? ' Skipping to the next track.' : ''), true);
    if (canSkip) {
      errorStreak++;
      setTimeout(() => player.nextVideo(), 1200);
    }
  }

  /* ---------- Transport UI ---------- */
  function setPlayingUI(playing) {
    els.play.classList.toggle('is-playing', playing);
    els.play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    els.play.title = playing ? 'Pause (Space)' : 'Play (Space)';
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
  }

  function setRange(input, pct) {
    input.style.setProperty('--p', `${Math.max(0, Math.min(100, pct))}%`);
  }

  const fmt = (sec) => {
    if (!Number.isFinite(sec) || sec < 0) sec = 0;
    sec = Math.floor(sec);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = String(sec % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
  };

  function updateTime() {
    if (!ready || seeking) return;
    const cur = player.getCurrentTime?.() || 0;
    const dur = player.getDuration?.() || 0;
    els.cur.textContent = fmt(cur);
    els.dur.textContent = fmt(dur);
    const v = dur ? (cur / dur) * 1000 : 0;
    els.seek.value = String(v);
    setRange(els.seek, v / 10);
  }
  function startTick() { if (!tickTimer) tickTimer = setInterval(updateTime, 500); }
  function stopTick() { clearInterval(tickTimer); tickTimer = 0; }

  function togglePlay() {
    if (!active()) { els.link.focus(); showMsg('Paste a playlist link first.'); return; }
    if (!ready) return;
    const s = player.getPlayerState();
    if (s === YT.PlayerState.PLAYING || s === YT.PlayerState.BUFFERING) player.pauseVideo();
    else player.playVideo();
  }
  function prev() {
    if (!ready) return;
    if (player.getCurrentTime() > 3 || !player.getPlaylist?.()) player.seekTo(0, true);
    else player.previousVideo();
  }
  function next() {
    if (!ready) return;
    if (player.getPlaylist?.()) player.nextVideo();
  }
  function seekBy(delta) {
    if (!ready) return;
    const dur = player.getDuration() || 0;
    player.seekTo(Math.max(0, Math.min(dur, player.getCurrentTime() + delta)), true);
    setTimeout(updateTime, 50);
  }

  function syncToggles() {
    els.shuffle.setAttribute('aria-pressed', String(state.shuffle));
    els.loop.setAttribute('aria-pressed', String(state.loop));
    els.volume.value = String(state.volume);
    setRange(els.volume, state.volume);
  }

  /* ---------- Wiring ---------- */
  els.form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (addLink(els.link.value, els.name.value)) {
      els.link.value = '';
      els.name.value = '';
    }
  });

  els.sample.addEventListener('click', () => addLink(SAMPLE.url, SAMPLE.name));

  els.playlists.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = btn.closest('li').dataset.id;
    const item = state.playlists.find((p) => p.id === id);
    if (!item) return;
    if (btn.dataset.action === 'open') {
      openItem(item, true);
    } else if (btn.dataset.action === 'rename') {
      const name = prompt('Rename playlist', item.name);
      if (name && name.trim()) {
        item.name = name.trim().slice(0, 60);
        save();
        renderPlaylists();
        syncHeader();
      }
    } else if (btn.dataset.action === 'remove') {
      if (confirm(`Remove “${item.name}” from your playlists?`)) removeItem(id);
    }
  });

  els.queue.addEventListener('click', (e) => {
    const btn = e.target.closest('.track');
    if (!btn || !ready) return;
    if (player.getPlaylist?.()) player.playVideoAt(Number(btn.dataset.index));
    else player.playVideo();
  });

  els.play.addEventListener('click', togglePlay);
  els.prev.addEventListener('click', prev);
  els.next.addEventListener('click', next);

  els.shuffle.addEventListener('click', () => {
    state.shuffle = !state.shuffle;
    save();
    syncToggles();
    if (ready && applyModes()) { queueKey = ''; syncQueue(); }
  });
  els.loop.addEventListener('click', () => {
    state.loop = !state.loop;
    save();
    syncToggles();
    if (ready) applyModes();
  });

  els.seek.addEventListener('input', () => {
    seeking = true;
    const dur = ready ? player.getDuration() || 0 : 0;
    els.cur.textContent = fmt((dur * Number(els.seek.value)) / 1000);
    setRange(els.seek, Number(els.seek.value) / 10);
  });
  els.seek.addEventListener('change', () => {
    if (ready) {
      const dur = player.getDuration() || 0;
      player.seekTo((dur * Number(els.seek.value)) / 1000, true);
    }
    seeking = false;
  });

  els.volume.addEventListener('input', () => {
    state.volume = Number(els.volume.value);
    setRange(els.volume, state.volume);
    if (ready) {
      player.setVolume(state.volume);
      if (state.volume > 0 && player.isMuted()) player.unMute();
    }
  });
  els.volume.addEventListener('change', save);

  els.share.addEventListener('click', async () => {
    const item = active();
    if (!item) return;
    const url = shareUrl(item);
    try {
      await navigator.clipboard.writeText(url);
      showMsg('Share link copied. Anyone who opens it gets this playlist.');
    } catch {
      showMsg(url);
    }
  });

  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t.closest && t.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Space' || e.key === 'k') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); e.shiftKey ? next() : seekBy(10); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); e.shiftKey ? prev() : seekBy(-10); }
    else if (e.key === 'n') next();
    else if (e.key === 'p') prev();
  });

  if ('mediaSession' in navigator) {
    const ms = navigator.mediaSession;
    const safe = (action, fn) => { try { ms.setActionHandler(action, fn); } catch { /* unsupported */ } };
    safe('play', () => ready && player.playVideo());
    safe('pause', () => ready && player.pauseVideo());
    safe('previoustrack', prev);
    safe('nexttrack', next);
    safe('seekbackward', () => seekBy(-10));
    safe('seekforward', () => seekBy(10));
  }

  // A shared link (#list=… or #v=…) adds that playlist on arrival.
  function importFromHash() {
    const params = new URLSearchParams(location.hash.slice(1));
    const list = params.get('list');
    const v = params.get('v');
    if (list) addLink(list, '', { autoplay: false, quiet: true });
    else if (v) addLink(v, '', { autoplay: false, quiet: true });
  }
  window.addEventListener('hashchange', importFromHash);

  /* ---------- Boot ---------- */
  syncToggles();
  renderPlaylists();
  syncHeader();
  importFromHash();
  if (!active()) resetNowPlaying();
  else els.empty.hidden = true;

  if (location.protocol === 'file:') {
    showMsg('Tip: YouTube may refuse to play when this page is opened as a file. Run a local server, as described in README.md.', true);
  }

  window.onYouTubeIframeAPIReady = () => {
    player = new YT.Player('player', {
      width: '100%',
      height: '100%',
      playerVars: {
        playsinline: 1,
        rel: 0,
        modestbranding: 1,
        ...(location.protocol.startsWith('http') ? { origin: location.origin } : {}),
      },
      events: { onReady, onStateChange, onError },
    });
  };
})();
