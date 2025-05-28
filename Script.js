// script.js

// ================================
// TMDB Configuration
// ================================
const API_KEY       = '8efe1cdc3f6fb29ea196e7556e32abdb'; // ← your TMDB key
const API_BASE      = 'https://api.themoviedb.org/3';
const IMG_BASE      = 'https://image.tmdb.org/t/p/w500';

// Genre & Tag Mappings
const genreMap      = { all: null, Action: 28, Thriller: 53, Drama: 18, Comedy: 35 };
const tagGenreMap   = { 
  space:   878,  // Sci-Fi
  horror:  27,
  comedy:  35,
  heist:   80    // Crime
};
const tagKeywordMap = {
  space: ['space','planet','galaxy','interstellar','orbit','cosmic'],
  heist: ['heist','robbery','vault','thief','bank','break-in']
};

// ================================
// DOM References
// ================================
const filterButtons      = document.querySelectorAll('.filter-btn');
const findMovieBtn       = document.getElementById('find-movie-btn');
const seenItBtn          = document.getElementById('seen-it-btn');
const viewFavoritesBtn   = document.getElementById('view-favorites-btn');
const smartRecsBtn       = document.getElementById('smart-recs-btn');
const pacingSelect       = document.getElementById('pacing-select');
const moodCheckboxes     = document.querySelectorAll('.mood-checkbox');
const tagCheckboxes      = document.querySelectorAll('.tag-checkbox');
const presetNameInput    = document.getElementById('preset-name');
const savePresetBtn      = document.getElementById('save-preset-btn');
const loadPresetSelect   = document.getElementById('load-preset');
const deletePresetBtn    = document.getElementById('delete-preset-btn');
const movieArea          = document.getElementById('movie-recommendation-area');
const backdropDiv        = document.getElementById('backdrop');

let currentGenre = 'all';

// ================================
// Favorites Helpers
// ================================
function getFavorites() {
  return JSON.parse(localStorage.getItem('favorites') || '[]');
}
function saveFavorites(list) {
  localStorage.setItem('favorites', JSON.stringify(list));
}
function isFavorited(id) {
  return getFavorites().some(m => m.id === id);
}
function toggleFavorite(movie) {
  let favs = getFavorites();
  if (isFavorited(movie.id)) favs = favs.filter(m => m.id !== movie.id);
  else favs.push(movie);
  saveFavorites(favs);
}

// ================================
// Fetch Helpers
// ================================
async function fetchMovies(genreId, page = 1) {
  const url = new URL(`${API_BASE}/discover/movie`);
  url.search = new URLSearchParams({
    api_key:     API_KEY,
    with_genres: genreId || '',
    sort_by:     'popularity.desc',
    page
  }).toString();
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch movies');
  return (await res.json()).results;
}

async function fetchCandidates(genreId, pages = 7) {
  let all = [];
  for (let p = 1; p <= pages; p++) {
    try { all.push(...await fetchMovies(genreId, p)); }
    catch { /* skip errors */ }
  }
  // dedupe
  return Object.values(all.reduce((acc, m) => { acc[m.id] = m; return acc; }, {}));
}

async function fetchMovieDetails(id) {
  const res = await fetch(`${API_BASE}/movie/${id}?api_key=${API_KEY}`);
  if (!res.ok) throw new Error('Failed to fetch details');
  const details = await res.json();
  details.genre_ids = (details.genres||[]).map(g => g.id);
  return details;
}

async function fetchTrailerKey(movieId) {
  try {
    const res = await fetch(`${API_BASE}/movie/${movieId}/videos?api_key=${API_KEY}`);
    if (!res.ok) return null;
    const { results } = await res.json();
    const t = results.find(v => v.type === 'Trailer' && v.site === 'YouTube');
    return t ? t.key : null;
  } catch {
    return null;
  }
}

// ================================
// Read UI Preferences
// ================================
function getUserPreferences() {
  const pacing = pacingSelect.value;
  const moods  = Array.from(moodCheckboxes).filter(cb => cb.checked).map(cb => cb.value);
  const tags   = Array.from(tagCheckboxes).filter(cb => cb.checked).map(cb => cb.value);
  return { pacing, moods, tags };
}

// ================================
// Scoring Function
// ================================
function smartTasteLens(movie, prefs) {
  const ids  = movie.genre_ids || [];
  const text = (movie.title + ' ' + (movie.overview || '')).toLowerCase();
  const favs = getFavorites();

  // 1) Pacing match
  let pacingMatch = 0;
  if (prefs.pacing === 'fast' && (ids.includes(28) || ids.includes(53))) pacingMatch = 1;
  else if (prefs.pacing === 'slow' && ids.includes(18)) pacingMatch = 1;
  else if (prefs.pacing === 'medium') pacingMatch = 1;

  // 2) Tag match + gating
  let matchedTags = [];
  prefs.tags.forEach(tag => {
    if (tagGenreMap[tag] != null) {
      if (tag === 'space' || tag === 'heist') {
        if (
          ids.includes(tagGenreMap[tag]) &&
          tagKeywordMap[tag].some(k => text.includes(k))
        ) matchedTags.push(tag);
      } else if (ids.includes(tagGenreMap[tag])) {
        matchedTags.push(tag);
      }
    } else if (text.includes(tag.toLowerCase())) {
      matchedTags.push(tag);
    }
  });
  const tagScore = prefs.tags.length ? matchedTags.length / prefs.tags.length : 0;

  // 3) Mood match
  const matchedMoods = prefs.moods.filter(m => text.includes(m.toLowerCase()));
  const moodScore = prefs.moods.length ? matchedMoods.length / prefs.moods.length : 0;

  // 4) Favorites overlap
  let favScore = 0;
  if (favs.length) {
    const favIds = [...new Set(favs.flatMap(f => f.genre_ids || []))];
    const overlap = favIds.filter(id => ids.includes(id)).length;
    favScore = favIds.length ? overlap / favIds.length : 0;
  }

  // 5) Average
  const totalScore = (pacingMatch + tagScore + moodScore + favScore) / 4;
  return { totalScore, pacingMatch, tagScore, moodScore, favScore, matchedTags, matchedMoods };
}

// ================================
// Create Movie Card
// ================================
async function createMovieCard(movie, reason = '', extras = []) {
  const card = document.createElement('div');
  card.classList.add('movie-card');
  if (movie.backdrop_path) {
    backdropDiv.style.backgroundImage = `url(${IMG_BASE}${movie.backdrop_path})`;
  }

  card.innerHTML = `
    <img src="${movie.poster_path ? IMG_BASE + movie.poster_path : ''}" class="movie-poster"/>
    <button class="fav-btn ${isFavorited(movie.id) ? 'favorited' : ''}">❤</button>
    <div class="movie-info">
      <h2>${movie.title} <span>(${movie.release_date?.slice(0,4) || 'N/A'})</span></h2>
      ${reason ? `<p class="reason">${reason}</p>` : ''}
      ${extras.length ? `<div class="tags">${extras.map(t => `<span>${t}</span>`).join('')}</div>` : ''}
      <button class="trailer-btn" style="display:none;">Watch Trailer</button>
      <div class="movie-links">
        <a href="https://www.themoviedb.org/movie/${movie.id}" target="_blank">More Info</a>
      </div>
    </div>
  `;

  card.querySelector('.fav-btn').addEventListener('click', () => {
    toggleFavorite(movie);
    card.querySelector('.fav-btn').classList.toggle('favorited');
  });

  const trailerBtn = card.querySelector('.trailer-btn');
  const key = await fetchTrailerKey(movie.id);
  if (key) {
    trailerBtn.style.display = 'block';
    trailerBtn.addEventListener('click', () => {
      const iframe = document.createElement('iframe');
      iframe.src = `https://www.youtube.com/embed/${key}?autoplay=1`;
      iframe.allow = 'autoplay; encrypted-media';
      card.querySelector('.movie-info').appendChild(iframe);
      trailerBtn.style.display = 'none';
    });
  }

  setTimeout(() => card.classList.add('visible'), 50);
  return card;
}

// ================================
// Adaptive Smart Recs
// ================================
async function showAdaptiveRecs() {
  movieArea.innerHTML = '';
  backdropDiv.style.backgroundImage = '';

  const prefs = getUserPreferences();
  let candidates = [];

  if (prefs.tags.length) {
    // For each selected tag, fetch that genre's movies
    for (const tag of prefs.tags) {
      if (tagGenreMap[tag]) {
        candidates.push(...await fetchCandidates(tagGenreMap[tag]));
      }
    }
  } else {
    candidates = await fetchCandidates(genreMap[currentGenre]);
  }

  // Dedupe
  candidates = Object.values(candidates.reduce((acc, m) => { acc[m.id] = m; return acc; }, {}));

  if (!candidates.length) {
    movieArea.innerHTML = '<p>No candidates found.</p>';
    return;
  }

  // Fetch full details
  const detailed = await Promise.all(candidates.map(c => fetchMovieDetails(c.id).catch(() => null)));
  const valid = detailed.filter(d => d);

  // Score and sort
  const scored = valid
    .map(m => ({ movie: m, ...smartTasteLens(m, prefs) }))
    .filter(e => e.totalScore > 0)
    .sort((a, b) => b.totalScore - a.totalScore)
    .slice(0, 5);

  if (!scored.length) {
    movieArea.innerHTML = '<p>No smart recommendations found.</p>';
    return;
  }

  // Display
  for (const e of scored) {
    const parts = [];
    if (e.pacingMatch) parts.push(`${prefs.pacing} pacing`);
    if (e.tagScore)    parts.push(`tags ${Math.round(e.tagScore * 100)}%`);
    if (e.moodScore)   parts.push(`mood ${Math.round(e.moodScore * 100)}%`);
    if (e.favScore)    parts.push(`fav overlap ${Math.round(e.favScore * 100)}%`);

    const reason = `Fit: ${Math.round(e.totalScore * 100)}% (${parts.join(', ')})`;
    const extras = [...e.matchedTags, ...e.matchedMoods];
    movieArea.appendChild(await createMovieCard(e.movie, reason, extras));
  }
}

// ================================
// Random & Favorites
// ================================
async function showRandomMovie() {
  movieArea.innerHTML = '';
  try {
    const list = await fetchMovies(genreMap[currentGenre], Math.floor(Math.random() * 3) + 1);
    const pick = list[Math.floor(Math.random() * list.length)];
    movieArea.appendChild(await createMovieCard(pick));
  } catch {
    movieArea.innerHTML = '<p>Something went wrong.</p>';
  }
}

async function showFavorites() {
  movieArea.innerHTML = '';
  backdropDiv.style.backgroundImage = '';
  const favs = getFavorites();
  if (!favs.length) {
    movieArea.innerHTML = '<p>No favorites yet.</p>';
    return;
  }
  for (const fav of favs) {
    movieArea.appendChild(await createMovieCard(fav));
  }
}

// ================================
// Taste Preset Logic
// ================================
function saveCurrentTaste() {
  const name = presetNameInput.value.trim();
  if (!name) return alert('Please enter a name for your taste.');
  const prefs = getUserPreferences();
  const presets = JSON.parse(localStorage.getItem('tastePresets') || '{}');
  presets[name] = prefs;
  localStorage.setItem('tastePresets', JSON.stringify(presets));
  updatePresetDropdown();
  presetNameInput.value = '';
}

function loadTaste(name) {
  const presets = JSON.parse(localStorage.getItem('tastePresets') || '{}');
  if (!presets[name]) return;
  const { pacing, moods, tags } = presets[name];
  pacingSelect.value = pacing;
  moodCheckboxes.forEach(cb => cb.checked = moods.includes(cb.value));
  tagCheckboxes.forEach(cb => cb.checked = tags.includes(cb.value));
  presetNameInput.value = name;
}

function updatePresetDropdown() {
  const select = loadPresetSelect;
  const presets = JSON.parse(localStorage.getItem('tastePresets') || '{}');
  select.innerHTML = '<option value="">-- Select a saved taste --</option>';
  Object.keys(presets).forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  });
}

function deleteSelectedTaste() {
  const name = loadPresetSelect.value;
  if (!name) return alert('Please select a preset to delete.');
  if (!confirm(`Delete "${name}"?`)) return;
  const presets = JSON.parse(localStorage.getItem('tastePresets') || '{}');
  delete presets[name];
  localStorage.setItem('tastePresets', JSON.stringify(presets));
  updatePresetDropdown();
  presetNameInput.value = '';
}

// ================================
// Event Listeners
// ================================
function handleFilterClick(e) {
  filterButtons.forEach(b => b.classList.remove('active'));
  e.target.classList.add('active');
  currentGenre = e.target.dataset.genre;
  showRandomMovie();
}

document.addEventListener('DOMContentLoaded', () => {
  showRandomMovie();
  updatePresetDropdown();
  deletePresetBtn.addEventListener('click', deleteSelectedTaste);
});

filterButtons.forEach(btn => btn.addEventListener('click', handleFilterClick));
findMovieBtn.addEventListener('click', showRandomMovie);
seenItBtn.addEventListener('click', showRandomMovie);
viewFavoritesBtn.addEventListener('click', showFavorites);
smartRecsBtn.addEventListener('click', showAdaptiveRecs);
savePresetBtn.addEventListener('click', saveCurrentTaste);
loadPresetSelect.addEventListener('change', e => { if (e.target.value) loadTaste(e.target.value); });
