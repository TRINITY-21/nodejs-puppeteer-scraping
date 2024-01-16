const express = require("express");
const puppeteer = require("puppeteer");

const app = express();

app.get("/api", async (req, res) => {
  try {
    const artistId = req.query.artistId || "";

    const browser = await puppeteer.launch({ args: ["--no-sandbox"] });
    let page = await browser.newPage();

    // Use the artistId in the URL
    await page.goto(`https://open.spotify.com/artist/${artistId}`, { waitUntil: 'domcontentloaded' });

    // Wait for the grid container to be present
    await page.waitForSelector('[data-testid="grid-container"]', { timeout: 60000 });

    const trackList = await page.evaluate((artistId) => {
      const trackListElement = document.querySelector('[data-testid="grid-container"] [aria-label="popular tracks"]');
      if (!trackListElement) {
        throw new Error("Popular tracks element not found");
      }

      const trackRows = trackListElement.querySelectorAll('[data-testid="tracklist-row"]');
      if (!trackRows || trackRows.length === 0) {
        throw new Error("No track rows found");
      }

      const tracks = [];
      trackRows.forEach((row, index) => {
        const trackNumberElement = row.querySelector('[aria-colindex="1"] span');
        const trackNameElement = row.querySelector('[aria-colindex="2"] [data-testid="internal-track-link"] .Text__TextElement-sc-if376j-0');
        const trackPlaysElement = row.querySelector('[aria-colindex="3"] .Text__TextElement-sc-if376j-0');
        const trackDurationElement = row.querySelector('[aria-colindex="4"] .Text__TextElement-sc-if376j-0');

        if (trackNumberElement && trackNameElement && trackPlaysElement && trackDurationElement) {
          const trackNumber = trackNumberElement.innerText;
          const trackName = trackNameElement.innerText;
          const trackPlays = trackPlaysElement.innerText;
          const trackDuration = trackDurationElement.innerText;

          tracks.push({
            trackNumber,
            trackName,
            trackPlays,
            trackDuration,
          });
        }
      });

      return tracks;
    }, artistId);

    // Print the extracted information
    console.log(artistId, 'artist id');
    console.log(trackList);

    // Close the browser
    await browser.close();

    res.status(200).json({ message: "Success", trackList });
  } catch (error) {
    console.error("Error in Puppeteer:", error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 2000;
app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});

module.exports = app;
