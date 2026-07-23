const express = require("express");
const cors = require("cors");
const puppeteer = require("puppeteer");

const app = express();

app.use(cors());
app.use(express.json());

const cleanStreamCount = (streamCount) => {
  if (!streamCount) return 0;
  return parseInt(String(streamCount).replace(/,/g, ""), 10) || 0;
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isValidSpotifyId = (id) => typeof id === "string" && id.length === 22;

const formatDuration = (ms) => {
  if (!ms && ms !== 0) return "0";
  const totalSeconds = Math.floor(Number(ms) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
};

const acceptCookies = async (page) => {
  await page.evaluate(() => {
    const ot = document.querySelector("#onetrust-accept-btn-handler");
    if (ot) {
      ot.click();
      return;
    }
    const texts = ["accept cookies", "accept all", "accept", "agree", "allow all"];
    const buttons = Array.from(document.querySelectorAll("button, [role='button']"));
    const match = buttons.find((btn) =>
      texts.includes((btn.textContent || "").trim().toLowerCase())
    );
    if (match) match.click();
  }).catch(() => {});
};

const waitForArtistOverview = (page, artistId, timeoutMs = 45000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      page.off("response", onResponse);
      reject(new Error("Timed out waiting for Spotify artist overview data"));
    }, timeoutMs);

    async function onResponse(response) {
      try {
        const url = response.url();
        if (!url.includes("api-partner.spotify.com/pathfinder")) return;

        const request = response.request();
        const postData = request.postData() || "";
        if (!postData.includes("queryArtistOverview")) return;
        if (!postData.includes(artistId)) return;
        if (!response.ok()) return;

        const json = await response.json();
        const artistUnion = json?.data?.artistUnion;
        if (!artistUnion) return;

        clearTimeout(timer);
        page.off("response", onResponse);
        resolve(artistUnion);
      } catch (_) {
        // Ignore non-JSON / aborted responses and keep waiting.
      }
    }

    page.on("response", onResponse);
  });

const mapTopTracks = (artistUnion) => {
  const items = artistUnion?.discography?.topTracks?.items || [];
  return items.slice(0, 10).map((item) => {
    const track = item?.track || {};
    const image =
      track?.albumOfTrack?.coverArt?.sources?.[0]?.url ||
      track?.albumOfTrack?.coverArt?.sources?.slice(-1)?.[0]?.url ||
      null;
    const playcount = track?.playcount != null ? String(track.playcount) : "0";

    return {
      image,
      name: track?.name || "Unknown",
      stream_count: Number(playcount).toLocaleString("en-US"),
      stream_count_raw: playcount,
      duration: formatDuration(track?.duration?.totalMilliseconds),
      track_id: track?.id || (track?.uri ? track.uri.split(":").pop() : null),
    };
  });
};

app.get("/api", async (req, res) => {
  let browser;
  try {
    const artistId = req.query.artistId || "";

    if (!isValidSpotifyId(artistId)) {
      return res.status(400).json({
        error: "Invalid Spotify artist ID",
      });
    }

    console.log(`Fetching data for artist ID: ${artistId}`);

    browser = await puppeteer.launch({
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--disable-gpu",
        "--window-size=1920,1080",
      ],
      headless: true,
      defaultViewport: { width: 1920, height: 1080 },
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36"
    );
    await page.setExtraHTTPHeaders({
      "Accept-Language": "en-US,en;q=0.9",
    });

    // Start listening before navigation so we do not miss the overview response.
    const overviewPromise = waitForArtistOverview(page, artistId);

    await page.goto(`https://open.spotify.com/artist/${artistId}`, {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });

    await acceptCookies(page);
    await delay(500);

    const artistUnion = await overviewPromise;
    console.log("Captured Spotify queryArtistOverview response");

    const artistName = artistUnion?.profile?.name || "Unknown Artist";
    const monthlyListenersNumeric =
      artistUnion?.stats?.monthlyListeners != null
        ? Number(artistUnion.stats.monthlyListeners)
        : null;
    const monthlyListeners =
      monthlyListenersNumeric != null
        ? `${monthlyListenersNumeric.toLocaleString("en-US")} monthly listeners`
        : "N/A";

    const trackListData = mapTopTracks(artistUnion).map((track) => ({
      ...track,
      stream_count_numeric: cleanStreamCount(track.stream_count_raw || track.stream_count),
    }));

    const totalStreams = trackListData.reduce(
      (sum, track) => sum + (track.stream_count_numeric || 0),
      0
    );

    await browser.close();
    browser = null;

    return res.status(200).json({
      success: true,
      artist: {
        id: artistId,
        name: artistName,
        monthlyListeners,
        monthlyListenersNumeric,
      },
      trackListData,
      stats: {
        totalTracks: trackListData.length,
        totalStreams,
      },
      monthlyListeners,
      debug: {
        timestamp: new Date().toISOString(),
        source: "pathfinder.queryArtistOverview",
      },
    });
  } catch (error) {
    console.error("Error in Spotify scraper:", error);

    res.status(500).json({
      success: false,
      error: error.message,
      details: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  } finally {
    if (browser) {
      await browser.close().catch((e) => console.error("Error closing browser:", e));
    }
  }
});

app.get("/api/health", (req, res) => {
  res.status(200).json({ status: "OK" });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Spotify Scraper API running on port ${PORT}`);
});

module.exports = app;
