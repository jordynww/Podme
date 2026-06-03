const form = document.querySelector("#search-form");
const queryInput = document.querySelector("#query");
const limitInput = document.querySelector("#limit");
const sortInput = document.querySelector("#sort");
const statusText = document.querySelector("#status");
const resultCount = document.querySelector("#result-count");
const queryFocus = document.querySelector("#query-focus");
const sourceCount = document.querySelector("#source-count");
const csvButton = document.querySelector("#csv-button");
const resultsList = document.querySelector("#results-list");
const template = document.querySelector("#result-template");

const defaultQuery = "Give me the best podcasts where I can learn everything there is to know about PE/VC";
let currentResults = [];
let activeQuery = "";
const stopWords = new Set("a about all an and are as at be best can do everything for from get give how i in into is it know learn me of on or podcast podcasts show shows that the there to want where with you".split(" "));
const forcedExpansionTerms = new Set(["artificial intelligence", "machine learning"]);

function normalize(text) {
  return text.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9/+\s-]/g, " ").replace(/\s+/g, " ").trim();
}

function expandQuery(text) {
  const n = normalize(text);
  const out = [];
  if (/\bpe\b|private equity/.test(n)) out.push("private equity", "buyouts", "investing");
  if (/\bvc\b|venture capital/.test(n)) out.push("venture capital", "startups", "company building");
  if (/\bai\b|artificial intelligence|machine learning/.test(n)) out.push("artificial intelligence", "machine learning");
  if (/founder|startup|startups/.test(n)) out.push("founders", "startups");
  return out;
}

function extractTerms(text) {
  const words = normalize(text).replace(/\//g, " ").split(" ").filter((word) => word.length > 1 && !stopWords.has(word));
  return [...new Set([...words, ...expandQuery(text)])].slice(0, 16);
}

function searchTerms(text) {
  const terms = extractTerms(text);
  return [...new Set([terms.slice(0, 7).join(" "), ...expandQuery(text)].filter(Boolean))].slice(0, 5);
}

async function fetchPodcasts(term, limit) {
  const params = new URLSearchParams({ term, media: "podcast", entity: "podcast", country: "US", limit: String(limit) });
  const response = await fetch(`https://itunes.apple.com/search?${params}`);
  if (!response.ok) throw new Error("Search failed");
  return (await response.json()).results || [];
}

async function fetchSpotifyShows(term) {
  const params = new URLSearchParams({ q: term, limit: "10" });
  const response = await fetch(`/.netlify/functions/spotify-search?${params}`);
  if (!response.ok) throw new Error("Spotify search failed");
  return (await response.json()).shows || [];
}

async function fetchPodcastIndexFeeds(term, limit) {
  const params = new URLSearchParams({ q: term, limit: String(Math.min(limit, 40)) });
  const response = await fetch(`/.netlify/functions/podcast-index-search?${params}`);
  if (!response.ok) throw new Error("Podcast Index search failed");
  return (await response.json()).feeds || [];
}

function podcastIndexFeedToResult(feed) {
  return {
    collectionId: feed.itunesId ? `pi-itunes-${feed.itunesId}` : `pi-${feed.id}`,
    collectionName: feed.title || "Untitled podcast",
    artistName: feed.author || "Unknown creator",
    genres: Object.values(feed.categories || {}),
    trackCount: Number(feed.episodeCount || 0),
    releaseDate: feed.lastUpdateTime ? new Date(feed.lastUpdateTime * 1000).toISOString() : "",
    artworkUrl600: feed.imageUrl || "",
    artworkUrl100: feed.imageUrl || "",
    collectionViewUrl: "",
    spotifyUrl: "",
    iheartUrl: "",
    podcastIndexUrl: feed.podcastIndexUrl || "",
    feedUrl: feed.feedUrl || "",
    websiteUrl: feed.websiteUrl || ""
  };
}

function score(result, terms) {
  const title = (result.collectionName || "").toLowerCase();
  const haystack = [result.collectionName, result.artistName, ...(result.genres || [])].join(" ").toLowerCase();
  const matches = terms.filter((term) => haystack.includes(term.toLowerCase()));
  const titleHits = terms.filter((term) => title.includes(term.toLowerCase())).length;
  const genreHits = terms.filter((term) => (result.genres || []).join(" ").toLowerCase().includes(term.toLowerCase())).length;
  const episodeScore = Math.min(Number(result.trackCount || 0), 400) / 8;
  const boost = ["private equity", "venture capital", "startup investing", "startup funding", "buyout", "vc"].filter((term) => title.includes(term)).length * 10;
  const penalty = ["germany", "cybersecurity", "blockchain", "crypto", "web3", "real estate", "personal finance"].filter((term) => title.includes(term)).length * 8;
  return { score: Math.round(matches.length * 14 + titleHits * 12 + genreHits * 8 + episodeScore + boost - penalty), matches };
}

function normalizeName(value) {
  return normalize(value).replace(/\b(the|podcast|show)\b/g, "").replace(/\s+/g, " ").trim();
}

function rank(results, query, sortMode) {
  const terms = extractTerms(query);
  const requestedTerms = normalize(query)
    .replace(/\//g, " ")
    .split(" ")
    .filter((word) => word.length > 2 && !stopWords.has(word));
  const seen = new Map();
  results.forEach((result) => {
    const haystack = [result.collectionName, result.artistName, ...(result.genres || [])].join(" ").toLowerCase();
    const hasRequestedTopic = requestedTerms.length === 0 || requestedTerms.some((term) => haystack.includes(term));
    const hasOnlyForcedExpansion = terms.some((term) => forcedExpansionTerms.has(term)) && !hasRequestedTopic;
    if (hasOnlyForcedExpansion) return;

    const id = result.collectionId || normalizeName(`${result.collectionName}-${result.artistName}`);
    const nameKey = normalizeName(result.collectionName || "");
    const scored = score(result, terms);
    const shaped = {
      collectionId: id,
      collectionName: result.collectionName || "Untitled podcast",
      artistName: result.artistName || "Unknown creator",
      genres: result.genres || [],
      trackCount: Number(result.trackCount || 0),
      releaseDate: result.releaseDate || "",
      artworkUrl100: result.artworkUrl600 || result.artworkUrl100 || "",
      collectionViewUrl: result.collectionViewUrl || "",
      spotifyUrl: result.spotifyUrl || "",
      iheartUrl: result.iheartUrl || "",
      podcastIndexUrl: result.podcastIndexUrl || "",
      feedUrl: result.feedUrl || "",
      websiteUrl: result.websiteUrl || "",
      score: scored.score,
      matchedTerms: scored.matches
    };
    const existing = seen.get(id) || seen.get(nameKey);
    const merged = existing ? {
      ...existing,
      collectionName: existing.collectionName || shaped.collectionName,
      artistName: existing.artistName || shaped.artistName,
      genres: [...new Set([...(existing.genres || []), ...(shaped.genres || [])])],
      trackCount: Math.max(existing.trackCount || 0, shaped.trackCount || 0),
      releaseDate: existing.releaseDate || shaped.releaseDate,
      artworkUrl100: existing.artworkUrl100 || shaped.artworkUrl100,
      collectionViewUrl: existing.collectionViewUrl || shaped.collectionViewUrl,
      spotifyUrl: existing.spotifyUrl || shaped.spotifyUrl,
      iheartUrl: existing.iheartUrl || shaped.iheartUrl,
      podcastIndexUrl: existing.podcastIndexUrl || shaped.podcastIndexUrl,
      feedUrl: existing.feedUrl || shaped.feedUrl,
      websiteUrl: existing.websiteUrl || shaped.websiteUrl,
      score: Math.max(existing.score || 0, shaped.score || 0),
      matchedTerms: [...new Set([...(existing.matchedTerms || []), ...(shaped.matchedTerms || [])])]
    } : shaped;

    if (!existing || shaped.score > existing.score || merged.podcastIndexUrl || merged.spotifyUrl || merged.collectionViewUrl) {
      seen.set(id, merged);
      if (nameKey) seen.set(nameKey, merged);
    }
  });
  const list = [...new Map([...seen.values()].map((item) => [item.collectionId, item])).values()];
  const sorters = {
    relevance: (a, b) => b.score - a.score || b.trackCount - a.trackCount,
    episodes: (a, b) => b.trackCount - a.trackCount || b.score - a.score,
    recent: (a, b) => Date.parse(b.releaseDate || 0) - Date.parse(a.releaseDate || 0),
    name: (a, b) => a.collectionName.localeCompare(b.collectionName)
  };
  return list.sort(sorters[sortMode] || sorters.relevance);
}

function mergeSpotifyUrls(results, spotifyShows) {
  const byName = new Map();
  spotifyShows.forEach((show) => byName.set(normalizeName(show.name), show));
  return results.map((result) => {
    const exact = byName.get(normalizeName(result.collectionName));
    if (exact?.spotifyUrl) return { ...result, spotifyUrl: exact.spotifyUrl };
    const loose = spotifyShows.find((show) => {
      const spotifyName = normalizeName(show.name);
      const appleName = normalizeName(result.collectionName);
      return spotifyName.length > 8 && appleName.length > 8 && (spotifyName.includes(appleName) || appleName.includes(spotifyName));
    });
    return loose?.spotifyUrl ? { ...result, spotifyUrl: loose.spotifyUrl } : result;
  });
}

function placeholder(name) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0].toUpperCase()).join("");
  const text = encodeURIComponent(initials || "P");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><rect width="180" height="180" fill="#e6ddff"/><circle cx="132" cy="42" r="34" fill="#ffa8d7"/><text x="90" y="98" text-anchor="middle" font-family="Arial" font-size="42" font-weight="800" fill="#141229">${text}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function providers(result) {
  return [
    result.collectionViewUrl && ["Apple", "apple-link", result.collectionViewUrl],
    result.spotifyUrl && ["Spotify", "spotify-link", result.spotifyUrl],
    result.podcastIndexUrl && ["Podcast Index", "podcast-index-link", result.podcastIndexUrl],
    result.iheartUrl && ["iHeart", "iheart-link", result.iheartUrl]
  ].filter(Boolean);
}

function render(results) {
  resultsList.textContent = "";
  resultCount.textContent = String(results.length);
  if (!results.length) {
    const empty = document.createElement("li");
    empty.className = "empty-state";
    empty.textContent = "No results yet. Try a broader topic, market, person, or learning goal.";
    resultsList.append(empty);
    return;
  }
  results.forEach((result, index) => {
    const node = template.content.cloneNode(true);
    const card = node.querySelector(".result-card");
    card.style.setProperty("--rank-color", index < 3 ? "#e74fa3" : "#6e5be8");
    const artworkImg = node.querySelector(".artwork");
    artworkImg.src = result.artworkUrl100 || placeholder(result.collectionName);
    artworkImg.alt = result.collectionName || "Podcast artwork";
    node.querySelector(".rank").textContent = `#${index + 1}`;
    node.querySelector(".score").textContent = `${result.score} match score`;
    node.querySelector("h2").textContent = result.collectionName || "Untitled";
    node.querySelector(".creator").textContent = result.artistName || "Unknown";
    node.querySelector(".meta").textContent = `${result.trackCount || "?"} episodes`;
    const tags = node.querySelector(".tags");
    tags.textContent = "";
    (result.matchedTerms.length ? result.matchedTerms : result.genres).slice(0, 5).forEach((tag) => {
      const pill = document.createElement("span");
      pill.textContent = tag || "";
      tags.append(pill);
    });
    const actions = node.querySelector(".result-actions");
    actions.textContent = "";
    providers(result).forEach(([name, className, href]) => {
      if (!href) return;
      const link = document.createElement("a");
      link.className = `provider-link ${className}`;
      link.href = href;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = name;
      actions.append(link);
    });
    node.querySelectorAll(".feedback-button").forEach((button) => {
      button.addEventListener("click", () => submitFeedback(button, result, index + 1));
    });
    resultsList.append(node);
  });
}

function syncUrl(query) {
  history.replaceState(null, "", `#${new URLSearchParams({ q: query, limit: limitInput.value, sort: sortInput.value })}`);
}

async function search() {
  const query = queryInput.value.trim() || defaultQuery;
  const limit = Number(limitInput.value);
  const terms = searchTerms(query);
  const spotifyPromise = Promise.all(terms.map((term) => fetchSpotifyShows(term)))
    .then((batches) => ({ ok: true, batches }))
    .catch((error) => ({ ok: false, error }));
  const podcastIndexPromise = Promise.all(terms.map((term) => fetchPodcastIndexFeeds(term, limit)))
    .then((batches) => ({ ok: true, batches }))
    .catch((error) => ({ ok: false, error }));
  activeQuery = query;
  queryFocus.textContent = extractTerms(query).slice(0, 3).join(", ") || "podcasts";
  statusText.textContent = "Searching Apple, Spotify, and Podcast Index in parallel...";
  sourceCount.textContent = "Apple";
  resultsList.setAttribute("aria-busy", "true");
  syncUrl(query);
  try {
    const [appleBatches, podcastIndexResult] = await Promise.all([
      Promise.all(terms.map((term) => fetchPodcasts(term, limit))),
      podcastIndexPromise
    ]);
    const podcastIndexResults = podcastIndexResult.ok
      ? podcastIndexResult.batches.flat().map(podcastIndexFeedToResult)
      : [];
    currentResults = rank([...appleBatches.flat(), ...podcastIndexResults], query, sortInput.value).slice(0, limit);
    render(currentResults);
    if (!currentResults.length) {
      statusText.textContent = "No podcasts found. Try simpler keywords.";
      return;
    }
    const activeSources = ["Apple"];
    if (podcastIndexResult.ok && podcastIndexResults.length) activeSources.push("Podcast Index");
    sourceCount.textContent = activeSources.join(" + ");
    statusText.textContent = `Found ${currentResults.length} podcasts. Spotify verification is finishing...`;
    const spotifyResult = await spotifyPromise;
    if (spotifyResult.ok) {
      currentResults = mergeSpotifyUrls(currentResults, spotifyResult.batches.flat());
      render(currentResults);
      const spotifyCount = currentResults.filter((result) => result.spotifyUrl).length;
      const finalSources = [...activeSources];
      if (spotifyCount) finalSources.push("Spotify");
      sourceCount.textContent = finalSources.join(" + ");
      statusText.textContent = spotifyCount
        ? `Found ${currentResults.length} podcasts and verified ${spotifyCount} Spotify links.`
        : `Found ${currentResults.length} podcasts. No verified Spotify matches found for this query.`;
    } else {
      statusText.textContent = `Found ${currentResults.length} podcasts. Spotify verification is unavailable until the Netlify Function and environment variables are live.`;
    }
  } catch {
    currentResults = [];
    render(currentResults);
    statusText.textContent = "Live search was unavailable. Try again when the network is reachable.";
  } finally {
    resultsList.removeAttribute("aria-busy");
  }
}

function encodeForm(data) {
  return new URLSearchParams(data).toString();
}

async function submitFeedback(button, result, rankNumber) {
  const originalText = button.textContent;
  const vote = button.dataset.vote;
  button.disabled = true;
  button.textContent = vote === "up" ? "✓" : "✓";

  const payload = {
    "form-name": "podme-feedback",
    vote,
    query: activeQuery || queryInput.value.trim(),
    rank: String(rankNumber),
    podcast: result.collectionName || "",
    creator: result.artistName || "",
    appleUrl: result.collectionViewUrl || "",
    spotifyUrl: result.spotifyUrl || "",
    podcastIndexUrl: result.podcastIndexUrl || "",
    score: String(result.score || 0),
    pageUrl: window.location.href,
    submittedAt: new Date().toISOString()
  };

  try {
    await fetch("/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: encodeForm(payload)
    });
  } catch {
    button.textContent = "Saved locally";
  }

  window.setTimeout(() => {
    button.disabled = false;
    button.textContent = originalText;
  }, 1800);
}

function csv() {
  const rows = [["Rank", "Podcast", "Creator", "Episodes", "Apple Link", "Spotify Link", "Podcast Index Link", "iHeart Link", "Score"]];
  currentResults.forEach((result, index) => {
    const row = [
      index + 1,
      result.collectionName || "",
      result.artistName || "",
      result.trackCount || 0,
      result.collectionViewUrl || "",
      result.spotifyUrl || "",
      result.podcastIndexUrl || "",
      result.iheartUrl || "",
      result.score || 0
    ];
    rows.push(row);
  });
  return rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  search();
});
sortInput.addEventListener("input", () => {
  currentResults = rank(currentResults, queryInput.value, sortInput.value).slice(0, Number(limitInput.value));
  render(currentResults);
});
csvButton.addEventListener("click", () => {
  if (!currentResults.length) return;
  const blob = new Blob([csv()], { type: "text/csv" });
  const link = document.createElement("a");
  link.download = "podme-results.csv";
  link.href = URL.createObjectURL(blob);
  link.click();
  URL.revokeObjectURL(link.href);
});

const params = new URLSearchParams(location.hash.slice(1));
if (params.get("q")) queryInput.value = params.get("q");
if (params.get("limit")) limitInput.value = params.get("limit");
if (params.get("sort")) sortInput.value = params.get("sort");
render([]);
