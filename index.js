const app = require("express")();
let puppeteer;

puppeteer = require("puppeteer");


app.get("/api", async (req, res) => {
  let options = {};

  try {
    let browser = await puppeteer.launch();

    let page = await browser.newPage();
    const artistId = "01DTVE3KmoPogPZaOvMqO8"
    await page.goto('https://open.spotify.com/artist/'+artistId);
    await page.waitForSelector('.wi2HeHXOI471ZOh8ncCG');
    await page.click('.wi2HeHXOI471ZOh8ncCG');
    await page.waitForSelector('.h4HgbO_Uu1JYg5UGANeQ'); 

    const trackListData = await page.$$eval('.h4HgbO_Uu1JYg5UGANeQ', (elements) =>
    elements.map((element) => {
      const name = element?.querySelector('.t_yrXoUO3qGsJS4Y6iXX')?.textContent?.trim() ?? 'N/A';
      const image = element.querySelector('img')?.getAttribute('src') || 'N/A';
      const duration = element.querySelector('.Btg2qHSuepFGBG6X0yEN')?.textContent?.trim() ?? 'N/A';
      const streams = element.querySelector('.ieTwfQ')?.textContent?.trim() ?? 'N/A';
   
      return { name, image, duration, streams }; 
    })
  );
 
    await browser.close(); 

    res.status(200).json({ message: 'Success', trackListData });
 
  } catch (error) { 
    console.error('Error in Puppeteer:', error);
    res.status(500).json({ error });
  }
}

);

app.listen(process.env.PORT || 3000, () => {
  console.log("Server started");
});

module.exports = app;
