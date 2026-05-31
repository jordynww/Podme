const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_SEARCH_URL = "https://api.spotify.com/v1/search";

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

async function getAccessToken() {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing Spotify environment variables");
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({ grant_type: "client_credentials" })
  });

  if (!response.ok) {
    throw new Error(`Spotify token request failed with ${response.status}`);
  }

  const data = await response.json();
  return data.access_token;
}

exports.handler = async function handler(event) {
  try {
    const query = event.queryStringParameters?.q?.trim();
    const limit = Math.min(Number(event.queryStringParameters?.limit || 20), 50);

    if (!query) {
      return json(400, { error: "Missing q query parameter" });
    }

    const accessToken = await getAccessToken();
    const params = new URLSearchParams({
      q: query,
      type: "show",
      market: "US",
      limit: String(limit)
    });

    const response = await fetch(`${SPOTIFY_SEARCH_URL}?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      throw new Error(`Spotify search failed with ${response.status}`);
    }

    const data = await response.json();
    const shows = (data.shows?.items || [])
      .map((show) => ({
        id: show.id,
        name: show.name,
        publisher: show.publisher,
        spotifyUrl: show.external_urls?.spotify || "",
        totalEpisodes: show.total_episodes || 0,
        imageUrl: show.images?.[0]?.url || ""
      }))
      .filter((show) => show.spotifyUrl);

    return json(200, { shows });
  } catch (error) {
    return json(500, {
      error: "Spotify search unavailable",
      detail: error.message
    });
  }
};
