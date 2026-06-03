const crypto = require("crypto");

const PODCAST_INDEX_SEARCH_URL = "https://api.podcastindex.org/api/1.0/search/byterm";

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300"
    },
    body: JSON.stringify(body)
  };
}

function authHeaders() {
  const apiKey = process.env.PODCAST_INDEX_KEY;
  const apiSecret = process.env.PODCAST_INDEX_SECRET;

  if (!apiKey || !apiSecret) {
    throw new Error("Missing Podcast Index environment variables");
  }

  const authDate = Math.floor(Date.now() / 1000).toString();
  const signature = crypto
    .createHash("sha1")
    .update(apiKey + apiSecret + authDate)
    .digest("hex");

  return {
    "User-Agent": "Podme/1.0",
    "X-Auth-Date": authDate,
    "X-Auth-Key": apiKey,
    Authorization: signature
  };
}

exports.handler = async function handler(event) {
  try {
    const query = event.queryStringParameters?.q?.trim();
    const max = Math.min(Number(event.queryStringParameters?.limit || 20), 40);

    if (!query) {
      return json(400, { error: "Missing q query parameter" });
    }

    const params = new URLSearchParams({
      q: query,
      max: String(max),
      clean: "true"
    });

    const response = await fetch(`${PODCAST_INDEX_SEARCH_URL}?${params.toString()}`, {
      headers: authHeaders()
    });

    if (!response.ok) {
      const errorBody = await response.text();
      return json(response.status, {
        error: "Podcast Index search request failed",
        podcastIndexStatus: response.status,
        podcastIndexBody: errorBody
      });
    }

    const data = await response.json();
    const feeds = (data.feeds || []).map((feed) => ({
      id: feed.id,
      title: feed.title,
      author: feed.author,
      description: feed.description,
      feedUrl: feed.url || feed.originalUrl || "",
      websiteUrl: feed.link || "",
      podcastIndexUrl: feed.id ? `https://podcastindex.org/podcast/${feed.id}` : "",
      imageUrl: feed.artwork || feed.image || "",
      episodeCount: feed.episodeCount || 0,
      lastUpdateTime: feed.lastUpdateTime || 0,
      itunesId: feed.itunesId || null,
      categories: feed.categories || {}
    })).filter((feed) => feed.title);

    return json(200, { feeds });
  } catch (error) {
    return json(500, {
      error: "Podcast Index search unavailable",
      detail: error.message
    });
  }
};
