const API_BASE = 'https://rou.plove523.dpdns.org';
const apiURL = path => path.startsWith('http') ? path : `${API_BASE}${path}`;

const state = {
  route: 'home', page: 1, totalPages: 1, sections: [], items: [], loading: false,
  series: null, episode: null, hls: null, playbackRun: 0, prewarmedEpisodes: new Set(),
  currentTag: null, tagOrder: 'createdAt', tagPage: 1, tagTotalPages: 1, tagItems: [],
  seriesSort: 'updated',
};

const $ = (selector) => document.querySelector(selector);
const catalog = $('#catalog');
const homeView = $('#homeView');
const libraryView = $('#libraryView');
const template = $('#cardTemplate');
const searchInput = $('#searchInput');
const refreshButton = $('#refreshButton');
const prevButton = $('#prevButton');
const nextButton = $('#nextButton');
const pageInput = $('#pageInput');
const pageTotal = $('#pageTotal');
const catalogView = $('#catalogView');
const detailView = $('#detailView');
const playerShell = $('#playerShell');
const videoPlayer = $('#videoPlayer');
const playerState = $('#playerState');
const retryButton = $('#retryButton');
const nextEpisodeButton = $('#nextEpisodeButton');
const detailTitle = $('#detailTitle');
const seriesTitle = $('#seriesTitle');
const seriesPanel = $('#seriesPanel');
const episodeLabel = $('#episodeLabel');
const detailStats = $('#detailStats');
const detailTags = $('#detailTags');
const episodeList = $('#episodeList');
const subnavBar = $('#subnavBar');
const librarySortGroup = $('#librarySortGroup');
const tagView = $('#tagView');
const tagHeading = $('#tagHeading');
const tagSubheading = $('#tagSubheading');
const tagCatalog = $('#tagCatalog');
const sortGroup = $('#sortGroup');
const tagPrevButton = $('#tagPrevButton');
const tagNextButton = $('#tagNextButton');
const tagPageInput = $('#tagPageInput');
const tagPageTotal = $('#tagPageTotal');

function setBusy(value) {
  state.loading = value;
  refreshButton.disabled = value;
  prevButton.disabled = value || state.page <= 1;
  nextButton.disabled = value || state.page >= state.totalPages;
  pageInput.disabled = value;
  if (tagPrevButton) {
    tagPrevButton.disabled = value || state.tagPage <= 1;
    tagNextButton.disabled = value || state.tagPage >= state.tagTotalPages;
    tagPageInput.disabled = value;
  }
}

function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}` : `${minutes}:${String(rest).padStart(2, '0')}`;
}

function formatViews(value) {
  return `${Number(value || 0).toLocaleString('zh-CN')} 次观看`;
}

function itemHref(item) {
  if (item.kind === 'video') return `?route=video&id=${encodeURIComponent(item.id)}`;
  const episode = item.firstEpisodeId ? `&episode=${encodeURIComponent(item.firstEpisodeId)}` : '';
  return `?route=series&id=${encodeURIComponent(item.id)}${episode}`;
}

function createCard(item, portrait = false) {
  const card = template.content.firstElementChild.cloneNode(true);
  card.classList.toggle('portrait-card', portrait);
  card.querySelectorAll('a').forEach((link) => {
    link.href = itemHref(item);
    link.title = item.title;
  });
  const frame = card.querySelector('.frame');
  frame.setAttribute('aria-label', item.title);
  const image = frame.querySelector('img');
  image.src = apiURL(item.cover);
  image.alt = item.title;
  image.addEventListener('load', () => frame.classList.add('ready'));
  image.addEventListener('error', () => frame.querySelector('.frame-state').textContent = '封面读取失败');
  card.querySelector('.title').textContent = item.title;
  const labels = item.labels || [];
  card.querySelector('.quality').textContent = item.kind === 'series' ? `${item.episodeCount || labels.find((value) => value.includes('集')) || '剧集'}` : (labels.find((value) => /P$/.test(value)) || '720P');
  card.querySelector('.duration').textContent = item.kind === 'series' ? '' : (item.durationSeconds ? formatDuration(item.durationSeconds) : (labels.find((value) => /分|小时|秒/.test(value)) || (item.viewCount ? formatViews(item.viewCount) : '')));
  const metadata = card.querySelector('.metadata');
  const metaList = [...(item.tags || labels)];
  if (item.viewCount) metaList.unshift(formatViews(item.viewCount));
  for (const value of metaList.filter((value) => !/P$|分|小时|秒/.test(value)).slice(0, 3)) {
    const span = document.createElement('span');
    span.textContent = value;
    metadata.append(span);
  }

  // iPhone 首屏优先：不在 touchstart / hover 时预拉视频，避免浏览列表就占满带宽。

  return card;
}


function renderHome() {
  homeView.replaceChildren();
  const query = searchInput.value.trim().toLocaleLowerCase();
  const fragment = document.createDocumentFragment();
  let visibleCount = 0;
  for (const section of state.sections) {
    const items = section.items.filter((item) => item.title.toLocaleLowerCase().includes(query));
    if (!items.length) continue;
    visibleCount += items.length;
    const wrapper = document.createElement('section');
    wrapper.className = 'home-section';
    const heading = document.createElement('div');
    heading.className = 'section-heading';
    const title = document.createElement('h2');
    title.textContent = section.title;
    heading.append(title);
    const grid = document.createElement('div');
    const portrait = items.every((item) => item.kind === 'series');
    grid.className = `catalog home-grid${portrait ? ' portrait-grid' : ''}`;
    grid.append(...items.map((item) => createCard(item, portrait)));
    wrapper.append(heading, grid);
    fragment.append(wrapper);
  }
  if (!visibleCount) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = query ? '首页没有匹配内容' : '没有读取到首页内容';
    fragment.append(empty);
  }
  homeView.append(fragment);
}

function renderLibrary() {
  catalog.replaceChildren();
  const query = searchInput.value.trim().toLocaleLowerCase();
  const items = state.items.filter((item) => item.title.toLocaleLowerCase().includes(query));
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = query ? '当前页没有匹配内容' : '没有读取到内容';
    catalog.append(empty);
    return;
  }
  catalog.append(...items.map((item) => createCard({ ...item, kind: 'series' }, true)));
}

function updateSubnav(activeRoute, tag = null) {
  if (!subnavBar) return;
  subnavBar.querySelectorAll('.subnav-item').forEach((item) => {
    let active = false;
    if (activeRoute === 'home' && item.dataset.route === 'home') active = true;
    else if (activeRoute === 'series' && item.dataset.route === 'series') active = true;
    else if (activeRoute === 'tag' && item.dataset.tag === tag) active = true;
    item.classList.toggle('active', active);
    if (active) {
      item.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  });
}

function renderTag() {
  tagCatalog.replaceChildren();
  const query = searchInput.value.trim().toLocaleLowerCase();
  const items = state.tagItems.filter((item) => item.title.toLocaleLowerCase().includes(query));
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = query ? '当前分类没有匹配内容' : '没有读取到内容';
    tagCatalog.append(empty);
    return;
  }
  tagCatalog.append(...items.map((item) => createCard({ ...item, kind: 'video' }, false)));
}

async function loadTag(tag, page = 1, order = 'createdAt', updateHistory = true) {
  state.route = 'tag';
  state.currentTag = tag;
  state.tagPage = page;
  state.tagOrder = order;

  catalogView.hidden = false;
  homeView.hidden = true;
  libraryView.hidden = true;
  tagView.hidden = false;
  detailView.hidden = true;
  $('.toolbar').hidden = false;
  updateSubnav('tag', tag);

  tagHeading.textContent = tag;
  tagSubheading.textContent = '正在读取视频列表...';

  if (sortGroup) {
    sortGroup.querySelectorAll('.sort-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.order === order);
    });
  }

  if (updateHistory) {
    const url = new URL(location.href);
    url.search = '';
    url.searchParams.set('route', 'tag');
    url.searchParams.set('tag', tag);
    url.searchParams.set('page', page);
    url.searchParams.set('order', order);
    history.pushState({ route: 'tag', tag, page, order }, '', url);
  }

  if (state.loading) return;
  setBusy(true);
  try {
    const response = await fetch(apiURL(`/api/tag?tag=${encodeURIComponent(tag)}&page=${page}&order=${order}`));
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '分类读取失败');
    state.tagPage = data.page;
    state.tagTotalPages = data.totalPages;
    state.tagItems = data.items;

    tagHeading.textContent = tag;
    tagSubheading.textContent = `${Number(data.total || 0).toLocaleString('zh-CN')} 部影片 · 第 ${data.page} 頁`;

    tagPageInput.value = state.tagPage;
    tagPageInput.max = state.tagTotalPages;
    tagPageTotal.textContent = `/ ${state.tagTotalPages}`;

    renderTag();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (error) {
    state.tagItems = [];
    tagSubheading.textContent = error.message;
    renderTag();
    console.error(error);
  } finally {
    setBusy(false);
  }
}

const HOME_CACHE_KEY = 'plove.entry2.home.v1';
const HOME_CACHE_MAX_AGE = 10 * 60 * 1000;

function readHomeCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(HOME_CACHE_KEY) || 'null');
    if (!cached || !Array.isArray(cached.sections) || !cached.savedAt) return null;
    return cached;
  } catch (_) {
    return null;
  }
}

function writeHomeCache(sections) {
  try {
    localStorage.setItem(HOME_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), sections }));
  } catch (_) {}
}

async function loadHome(refresh = false, updateHistory = true) {
  state.route = 'home';
  catalogView.hidden = false;
  homeView.hidden = false;
  libraryView.hidden = true;
  tagView.hidden = true;
  detailView.hidden = true;
  $('.toolbar').hidden = false;
  updateSubnav('home');

  if (updateHistory) {
    const url = new URL(location.href); url.search = ''; history.pushState({ route: 'home' }, '', url);
  }

  if (state.loading) return;

  const cached = !refresh ? readHomeCache() : null;
  if (cached?.sections?.length) {
    state.sections = cached.sections;
    renderHome();
    if (Date.now() - cached.savedAt < HOME_CACHE_MAX_AGE) {
      // 先立即展示缓存，再静默刷新，不阻塞用户。
      setTimeout(() => {
        fetch(apiURL('/api/home'))
          .then(r => r.ok ? r.json() : Promise.reject(new Error('refresh failed')))
          .then(data => {
            if (Array.isArray(data.sections) && data.sections.length) {
              state.sections = data.sections;
              writeHomeCache(data.sections);
              renderHome();
            }
          })
          .catch(() => {});
      }, 100);
      return;
    }
  }

  setBusy(true);
  try {
    const response = await fetch(apiURL(`/api/home${refresh ? '?refresh=1' : ''}`));
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '首页读取失败');
    state.sections = data.sections;
    writeHomeCache(data.sections);
    renderHome();
  } catch (error) {
    state.sections = [];
    renderHome();
    console.error(error);
  } finally {
    setBusy(false);
  }
}

async function loadLibrary(page = 1, sort = state.seriesSort, updateHistory = true) {
  state.route = 'series';
  state.seriesSort = sort;
  catalogView.hidden = false;
  homeView.hidden = true;
  libraryView.hidden = false;
  tagView.hidden = true;
  detailView.hidden = true;
  $('.toolbar').hidden = false;
  updateSubnav('series');

  if (librarySortGroup) {
    librarySortGroup.querySelectorAll('.sort-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.sort === sort);
    });
  }

  if (updateHistory) {
    const url = new URL(location.href);
    url.search = '';
    url.searchParams.set('route', 'library');
    url.searchParams.set('page', page);
    url.searchParams.set('sort', sort);
    history.pushState({ route: 'series', page, sort }, '', url);
  }

  if (state.loading) return;
  setBusy(true);
  try {
    const response = await fetch(apiURL(`/api/catalog?page=${page}&sort=${encodeURIComponent(sort)}&tag=AI短劇`));
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'AI短剧读取失败');
    Object.assign(state, { page: data.page, totalPages: data.totalPages, items: data.items });
    pageInput.value = state.page;
    pageInput.max = state.totalPages;
    pageTotal.textContent = `/ ${state.totalPages}`;
    renderLibrary();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (error) {
    state.items = [];
    renderLibrary();
    console.error(error);
  } finally {
    setBusy(false);
  }
}



function applyFrame(element, data) {
  const columns = data.spriteWidth / data.width;
  const rows = data.spriteHeight / data.height;
  const x = data.spriteWidth === data.width ? 0 : (data.x / (data.spriteWidth - data.width)) * 100;
  const y = data.spriteHeight === data.height ? 0 : (data.y / (data.spriteHeight - data.height)) * 100;
  element.style.backgroundImage = `url("${apiURL(data.spriteUrl)}")`;
  element.style.backgroundSize = `${columns * 100}% ${rows * 100}%`;
  element.style.backgroundPosition = `${x}% ${y}%`;
}

async function loadFrame(element, id) {
  try {
    const response = await fetch(apiURL(`/api/frame/${encodeURIComponent(id)}`));
    if (!response.ok) throw new Error('No frame');
    applyFrame(element, await response.json());
  } catch (error) {
    console.warn('Preview frame unavailable', error);
  }
}

function destroyPlayer() {
  if (state.hls) state.hls.destroy();
  state.hls = null;
  videoPlayer.pause();
  videoPlayer.removeAttribute('src');
  videoPlayer.load();
}

function showPlayerState(message, isError = false) {
  playerState.textContent = message;
  playerState.hidden = !message;
  playerState.classList.toggle('error', isError);
  retryButton.hidden = !isError;
}

function warmEpisode(id, segments = 1) {
  return fetch(apiURL(`/api/prewarm/${encodeURIComponent(id)}?segments=${segments}`), { method: 'POST' })
    .then((response) => {
      if (!response.ok) throw new Error(`Prewarm HTTP ${response.status}`);
      return response.json();
    });
}

async function prepareStream(id) {
  const run = ++state.playbackRun;
  destroyPlayer();
  videoPlayer.classList.remove('ready');
  playerShell.style.backgroundImage = '';
  nextEpisodeButton.hidden = true;
  showPlayerState('正在连接视频...');
  loadFrame(playerShell, id);
  warmEpisode(id, 2).catch((error) => console.warn('Current episode prewarm failed', error));
  try {
    const response = await fetch(apiURL(`/api/playback/${encodeURIComponent(id)}`));
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '播放地址读取失败');
    if (run !== state.playbackRun) return;
    const nativeHls = videoPlayer.canPlayType('application/vnd.apple.mpegurl');
    const appleWebKit = /Apple/i.test(navigator.vendor || '') || /iPad|iPhone|iPod/i.test(navigator.userAgent);
    if (nativeHls && appleWebKit) {
      showPlayerState('正在缓冲首段...');
      videoPlayer.src = apiURL(data.manifestUrl);
      videoPlayer.load();
    } else if (window.Hls?.isSupported()) {
      state.hls = new window.Hls({
        progressive: true,             // 边下边播，不用等整片下载完才解码，首帧出画面暴减 50%~70%
        enableWorker: true,            // Web Worker 多线程异步解封装
        startFragPrefetch: true,       // manifest 解析完瞬间立即预拉首个切片
        maxBufferLength: 60,           // 目标向前缓冲 60 秒（原 30 秒翻倍）
        maxMaxBufferLength: 120,       // 最大向前缓冲 120 秒
        maxBufferSize: 60 * 1000 * 1000,// 60MB 内存缓冲池
        backBufferLength: 90,          // 保留后退 90 秒缓存，倒退拖拽 0 延迟
        maxBufferHole: 0.5,
        highBufferWatchdogPeriod: 2,
        nudgeOffset: 0.1,
        nudgeMaxRetry: 5,
        lowLatencyMode: false,
      });
      state.hls.loadSource(apiURL(data.manifestUrl));
      state.hls.attachMedia(videoPlayer);
      state.hls.on(window.Hls.Events.ERROR, (_event, details) => {
        if (run !== state.playbackRun || !details.fatal) return;
        if (details.type === window.Hls.ErrorTypes.NETWORK_ERROR) state.hls.startLoad();
        else if (details.type === window.Hls.ErrorTypes.MEDIA_ERROR) state.hls.recoverMediaError();
        else showPlayerState('播放失败，请重试', true);
      });
    } else if (nativeHls) {
      videoPlayer.src = apiURL(data.manifestUrl);
      videoPlayer.load();
    } else throw new Error('当前浏览器不支持 HLS 播放');
  } catch (error) {
    if (run === state.playbackRun) showPlayerState(error.message || '播放失败，请重试', true);
  }
}

function setStats(duration, views) {
  detailStats.replaceChildren(...[formatDuration(duration), formatViews(views)].map((value) => {
    const span = document.createElement('span');
    span.textContent = value;
    return span;
  }));
}

function updateEpisodeUi(episode) {
  state.episode = episode;
  episodeLabel.textContent = `第 ${episode.episode} 集`;
  detailTitle.textContent = episode.title;
  setStats(episode.durationSeconds, episode.views);
  episodeList.querySelectorAll('button').forEach((button) => button.classList.toggle('active', button.dataset.id === episode.id));
  const url = new URL(location.href);
  url.searchParams.set('episode', episode.id);
  history.replaceState(null, '', url);
}

function getNextEpisode() {
  const episodes = state.series?.episodes;
  const index = episodes?.findIndex((episode) => episode.id === state.episode?.id);
  return index >= 0 ? episodes[index + 1] || null : null;
}

async function startPlayback(episode) {
  updateEpisodeUi(episode);
  await prepareStream(episode.id);
}

function prewarmNextEpisode() {
  const next = getNextEpisode();
  if (!next || state.prewarmedEpisodes.has(next.id)) return;
  state.prewarmedEpisodes.add(next.id);
  warmEpisode(next.id, 2).catch(() => state.prewarmedEpisodes.delete(next.id));
}


function renderEpisodes(series) {
  episodeList.replaceChildren();
  for (const episode of series.episodes) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.id = episode.id;
    button.textContent = `第 ${episode.episode} 集`;
    button.title = episode.title;
    button.addEventListener('click', () => startPlayback(episode));
    episodeList.append(button);
  }
}

function showDetail() {
  catalogView.hidden = true;
  detailView.hidden = false;
  $('.toolbar').hidden = true;
}

async function loadSeries(id) {
  state.route = 'detail';
  showDetail();
  // 立即清空上次残留的标题和选集，避免旧内容闪烁
  seriesTitle.textContent = '正在读取剧集...';
  detailTitle.textContent = '正在读取...';
  episodeLabel.textContent = '当前视频';
  episodeList.replaceChildren();
  detailTags.replaceChildren();
  const requestedId = new URL(location.href).searchParams.get('episode');
  const earlyPlayback = /^[a-z0-9]{12,40}$/.test(requestedId || '') ? prepareStream(requestedId) : null;
  try {
    const response = await fetch(apiURL(`/api/series/${encodeURIComponent(id)}`));
    const series = await response.json();
    if (!response.ok || !series.episodes.length) throw new Error(series.error || '剧集读取失败');
    state.series = series;
    document.title = `${series.title} · Plove 提醒`;
    seriesTitle.textContent = series.title;
    detailTags.replaceChildren(...series.tags.slice(0, 6).map((value) => Object.assign(document.createElement('span'), { textContent: value })));
    renderEpisodes(series);
    const selected = series.episodes.find((episode) => episode.id === requestedId) || series.episodes[0];
    if (selected.id === requestedId && earlyPlayback) { updateEpisodeUi(selected); await earlyPlayback; }
    else await startPlayback(selected);
  } catch (error) {
    seriesTitle.textContent = '剧集读取失败';
    detailTitle.textContent = error.message;
    showPlayerState('无法读取这个剧集', true);
  }
}


async function loadVideo(id) {
  state.route = 'detail';
  state.episode = { id };
  showDetail();
  seriesPanel.hidden = true;
  // 立即清空上次残留的标题
  detailTitle.textContent = '正在读取...';
  episodeLabel.textContent = '单集视频';
  document.querySelector('.watch-layout').classList.add('single-video');
  const playback = prepareStream(id);
  try {
    const response = await fetch(apiURL(`/api/video/${encodeURIComponent(id)}`));
    const video = await response.json();
    if (!response.ok) throw new Error(video.error || '视频信息读取失败');
    state.episode = video;
    document.title = `${video.title} · Plove 提醒`;
    episodeLabel.textContent = '单集视频';
    detailTitle.textContent = video.title;
    setStats(video.durationSeconds, video.views);
    await playback;
  } catch (error) {
    detailTitle.textContent = error.message;
    showPlayerState('无法读取这个视频', true);
  }
}

videoPlayer.addEventListener('loadeddata', () => { videoPlayer.classList.add('ready'); showPlayerState(''); prewarmNextEpisode(); });
videoPlayer.addEventListener('playing', () => { nextEpisodeButton.hidden = true; showPlayerState(''); prewarmNextEpisode(); });
videoPlayer.addEventListener('timeupdate', () => {
  if (state.series && state.episode && videoPlayer.duration > 0) {
    if (videoPlayer.currentTime / videoPlayer.duration >= 0.75) {
      prewarmNextEpisode();
    }
  }
});
videoPlayer.addEventListener('ended', () => {
  const next = getNextEpisode();
  if (!next) return;
  nextEpisodeButton.textContent = `播放下一集 · 第 ${next.episode} 集`;
  nextEpisodeButton.hidden = false;
});

videoPlayer.addEventListener('error', () => showPlayerState('播放失败，请重试', true));
retryButton.addEventListener('click', () => state.episode && prepareStream(state.episode.id));
nextEpisodeButton.addEventListener('click', () => {
  const next = getNextEpisode();
  if (next) startPlayback(next);
});
searchInput.addEventListener('input', () => {
  if (state.route === 'home') renderHome();
  else if (state.route === 'series') renderLibrary();
  else if (state.route === 'tag') renderTag();
});

refreshButton.addEventListener('click', () => {
  if (state.route === 'home') loadHome(true, false);
  else if (state.route === 'series') loadLibrary(state.page, state.seriesSort, false);
  else if (state.route === 'tag') loadTag(state.currentTag, state.tagPage, state.tagOrder, false);
});

prevButton.addEventListener('click', () => loadLibrary(state.page - 1, state.seriesSort));
nextButton.addEventListener('click', () => loadLibrary(state.page + 1, state.seriesSort));
pageInput.addEventListener('change', () => loadLibrary(Math.max(1, Math.min(state.totalPages, Number(pageInput.value) || 1)), state.seriesSort));

if (librarySortGroup) {
  librarySortGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('.sort-btn');
    if (!btn) return;
    const sort = btn.dataset.sort;
    if (sort === state.seriesSort) return;
    loadLibrary(1, sort);
  });
}

if (tagPrevButton) tagPrevButton.addEventListener('click', () => loadTag(state.currentTag, state.tagPage - 1, state.tagOrder));
if (tagNextButton) tagNextButton.addEventListener('click', () => loadTag(state.currentTag, state.tagPage + 1, state.tagOrder));
if (tagPageInput) tagPageInput.addEventListener('change', () => loadTag(state.currentTag, Math.max(1, Math.min(state.tagTotalPages, Number(tagPageInput.value) || 1)), state.tagOrder));

if (sortGroup) {
  sortGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('.sort-btn');
    if (!btn || !state.currentTag) return;
    const order = btn.dataset.order;
    if (order === state.tagOrder) return;
    loadTag(state.currentTag, 1, order);
  });
}

if (subnavBar) {
  subnavBar.addEventListener('click', (e) => {
    const link = e.target.closest('.subnav-item');
    if (!link) return;
    e.preventDefault();
    const route = link.dataset.route;
    if (route === 'home') loadHome();
    else if (route === 'series') loadLibrary(1, 'updated');
    else if (route === 'tag') {
      const tag = link.dataset.tag;
      loadTag(tag, 1, 'createdAt');
    }
  });
}

function dispatchRoute() {
  const url = new URL(location.href);
  const route = url.searchParams.get('route') || 'home';
  const id = url.searchParams.get('id') || '';

  if (route === 'series' && id) {
    loadSeries(id);
  } else if (route === 'video' && id) {
    loadVideo(id);
  } else if (route === 'tag') {
    const tag = url.searchParams.get('tag') || '';
    const page = Number(url.searchParams.get('page')) || 1;
    const order = url.searchParams.get('order') || 'createdAt';
    loadTag(tag, page, order, false);
  } else if (route === 'library') {
    const page = Number(url.searchParams.get('page')) || 1;
    const sort = url.searchParams.get('sort') || 'updated';
    loadLibrary(page, sort, false);
  } else {
    loadHome(false, false);
  }
}

window.addEventListener('popstate', dispatchRoute);
dispatchRoute();
