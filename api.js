const express = require("express");
const puppeteer = require("puppeteer");
const cors = require("cors");

const app = express();

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());

// Helper function to clean stream count strings
const cleanStreamCount = (streamCount) => {
  if (!streamCount) return 0;
  return parseInt(streamCount.replace(/,/g, "")) || 0;
};

// Helper function to validate Spotify artist ID
const isValidSpotifyId = (id) => {
  return typeof id === "string" && id.length === 22;
};

app.get("/api", async (req, res) => {
  try {
    const artistId = req.query.artistId || "";
    
    if (!isValidSpotifyId(artistId)) {
      return res.status(400).json({ 
        error: "Invalid Spotify artist ID" 
      });
    }

    console.log(`Fetching data for artist ID: ${artistId}`);

    const browser = await puppeteer.launch({ 
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      headless: "new"
    });
    
    const page = await browser.newPage();

    // Set viewport and user agent
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Navigate to artist page
    await page.goto(`https://open.spotify.com/artist/${artistId}`, { 
      waitUntil: "networkidle0",
      timeout: 60000 
    });

    // Wait for content to load
    await page.waitForSelector('[data-testid="track-list"]', { 
      timeout: 60000 
    });

    // Expand track list if possible
    try {
      const seeMoreButton = await page.$('button[aria-expanded="false"]');
      if (seeMoreButton) {
        await seeMoreButton.click();
        await page.waitForTimeout(2000); // Wait for expansion animation
      }
    } catch (error) {
      console.warn("No 'See more' button found or unable to click it");
    }

    // Extract track list data
    const trackListData = await page.evaluate(() => {
      const trackListElement = document.querySelector('[data-testid="track-list"]');
      if (!trackListElement) return [];

      const trackRows = trackListElement.querySelectorAll('[data-testid="tracklist-row"]');
      if (!trackRows || trackRows.length === 0) return [];

      return Array.from(trackRows).map((row, index) => {
        // Extract track details
        const trackNameElement = row.querySelector('[data-testid="internal-track-link"] .encore-text-body-medium');
        const trackImageElement = row.querySelector('[aria-colindex="2"] img');
        const trackPlaysElement = row.querySelector('[aria-colindex="3"] .encore-text-body-small');

        const trackDurationElement = row.querySelector('[aria-colindex="4"] .encore-text-body-small');
        const trackLinkElement = row.querySelector('[data-testid="internal-track-link"]');

        // Get track ID from href
        const trackUrl = trackLinkElement ? trackLinkElement.getAttribute('href') : null;
        const trackId = trackUrl ? trackUrl.split('/').pop() : null;

        return {
          image: trackImageElement ? trackImageElement.src : null,
          name: trackNameElement ? trackNameElement.innerText : "Unknown",
          stream_count: trackPlaysElement ? trackPlaysElement.innerText : "0",
          duration: trackDurationElement ? trackDurationElement.innerText : "0",
        };
      });
    });

    // Extract monthly listeners
    let monthlyListeners = "N/A";
    try {
      monthlyListeners = await page.$eval(
        ".Ydwa1P5GkCggtLlSvphs, [data-testid='monthly-listeners-label']", 
        (el) => el.textContent.trim()
      );
    } catch (err) {
      console.warn("Monthly listeners element not found");
    }

    // Extract artist name
    let artistName = "Unknown Artist";
    try {
      artistName = await page.$eval(
        "h1[data-testid='entityTitle']",
        (el) => el.textContent.trim()
      );
    } catch (err) {
      console.warn("Artist name element not found");
    }

    // Clean up and process data
    const processedTracks = trackListData.map(track => ({
      ...track,
      stream_count_numeric: cleanStreamCount(track.stream_count)
    }));

    // Calculate total streams
    const totalStreams = processedTracks.reduce(
      (sum, track) => sum + track.stream_count_numeric, 
      0
    );

    await browser.close();

    // Send response
    res.status(200).json({
      success: true,
      trackListData,
      monthlyListeners,
    });

  } catch (error) {
    console.error("Error in Spotify scraper:", error);
    
    res.status(500).json({ 
      success: false,
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ status: "OK" });
});

const PORT = process.env.PORT || 2000;

app.listen(PORT, () => {
  console.log(`Spotify Scraper API running on port ${PORT}`);
});

module.exports = app;