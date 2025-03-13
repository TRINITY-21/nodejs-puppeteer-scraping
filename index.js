const app = require("express")();
const puppeteer = require("puppeteer");

app.get("/api", async (req, res) => {
  try {
    const artistId = req.query.artistId || "";

    const browser = await puppeteer.launch({ args: ["--no-sandbox"] });
    let page = await browser.newPage();

    // Use the artistId in the URL
    await page.goto(`https://open.spotify.com/artist/${artistId}`);
    await page.waitForSelector(".wi2HeHXOI471ZOh8ncCG");
    await page.click(".wi2HeHXOI471ZOh8ncCG");

    // Wait for navigation to complete
    // await page.waitForNavigation({ waitUntil: 'domcontentloaded' });

    await page.waitForSelector(".h4HgbO_Uu1JYg5UGANeQ");

    const trackListData = await page.$$eval(
      ".h4HgbO_Uu1JYg5UGANeQ",
      (elements) =>
        elements.map((element) => {
          const nameElement = element
            ? element.querySelector(".t_yrXoUO3qGsJS4Y6iXX")
            : null;
          const name = nameElement ? nameElement.textContent.trim() : "N/A";

          const imageElement = element ? element.querySelector("img") : null;
          const image = imageElement ? imageElement.getAttribute("src") : "N/A";

          const durationElement = element
            ? element.querySelector(".Btg2qHSuepFGBG6X0yEN")
            : null;
          const duration = durationElement
            ? durationElement.textContent.trim()
            : "N/A";

          const streamsElement = element
            ? element.querySelector(".nYg_xsOVmrVE_8qk1GCW")
            : null;
          const streams = streamsElement
            ? streamsElement.textContent.trim()
            : "N/A";

          return { name, image, duration, streams };
        })
    );

    const monthlyListeners = await page.$eval('.Ydwa1P5GkCggtLlSvphs', (element) => {
      return element.textContent.trim();  
    });

    await browser.close();

    res.status(200).json({ message: "Success", trackListData, monthlyListeners });
  } catch (error) {
    console.error("Error in Puppeteer:", error);
    res.status(500).json({ error });
  }
});
// http://104.196.44.93/api/?artistId=01DTVE3KmoPogPZaOvMqO8
// sudo lsof -i 104.196.44.93:80
app.listen(process.env.PORT || 2000, () => {
  console.log("Server started");
});

module.exports = app;
