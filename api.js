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

    // Wait for the tracklist to be present
    await page.waitForSelector('[data-testid="track-list"]', { timeout: 60000 });

    // Check if the "See more" button is present and click it
    const seeMoreButton = await page.$('button[aria-expanded="false"]');
    if (seeMoreButton) {
      await seeMoreButton.click();
      // Wait for a reasonable time for the additional tracks to load
      await page.waitForTimeout(5000);
    }

    const trackListData = await page.evaluate(() => {
      const trackListElement = document.querySelector('[data-testid="track-list"]');

      if (!trackListElement) {
        throw new Error("Track list element not found");
      }

      const trackRows = trackListElement.querySelectorAll('[data-testid="tracklist-row"]');
      if (!trackRows || trackRows.length === 0) {
        throw new Error("No track rows found");
      }

      const tracks = [];
      trackRows.forEach((row) => {
        const trackNumberElement = row.querySelector('[aria-colindex="1"] span');
        const trackNameElement = row.querySelector('[aria-colindex="2"] [data-testid="internal-track-link"] .encore-text');
        const trackImageElement = row.querySelector('[aria-colindex="2"] img');
        const trackPlaysElement = row.querySelector('[aria-colindex="3"] .encore-text');
        const trackDurationElement = row.querySelector('[aria-colindex="4"] .encore-text');

        if (trackNameElement) {
          const name = trackNameElement.innerText;
          const image = trackImageElement ? trackImageElement.src : null;
          const stream_count = trackPlaysElement ? trackPlaysElement.innerText : "N/A";
          const duration = trackDurationElement ? trackDurationElement.innerText : "N/A";

          tracks.push({
            image,
            name,
            stream_count,
            duration,
          });
        }
      });

      return tracks;
    });

    const monthlyListeners = await page.$eval('.Ydwa1P5GkCggtLlSvphs', (element) => {
      return element.textContent.trim();  
    });

    // Print the extracted information
    console.log(artistId, 'artist id');
    console.log(trackListData);

    // Close the browser
    await browser.close();

    res.status(200).json({ message: "Success", trackListData, monthlyListeners });
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