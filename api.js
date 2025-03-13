const express = require("express");
const cors = require("cors");
const puppeteer = require("puppeteer");

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

// Helper function to auto-scroll the page to load all elements
const autoScroll = async (page) => {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 100;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  });
  
  // Wait for any additional elements to load after scrolling
  await page.waitForTimeout(1000);
};

app.get("/api", async (req, res) => {
  let browser;
  try {
    const artistId = req.query.artistId || "";
    
    if (!isValidSpotifyId(artistId)) {
      return res.status(400).json({ 
        error: "Invalid Spotify artist ID" 
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
        "--window-size=1920,1080"
      ],
      headless: "new",
      defaultViewport: { width: 1920, height: 1080 }
    });
    
    const page = await browser.newPage();

    // Set various browser options to avoid detection
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1'
    });

    // Navigate to artist page with additional options
    await page.goto(`https://open.spotify.com/artist/${artistId}`, { 
      waitUntil: "domcontentloaded",  // Changed from networkidle0 to load faster
      timeout: 90000  // Increased timeout
    });
    
    console.log("Initial page load complete");
    
    // Try multiple selectors for track list with fallbacks
    const trackListSelectors = [
      '[data-testid="track-list"]',
      '.main-shelf-content',
      'section[aria-label="Popular"]',
      'section.artist-popular-tracks',
      'div[data-testid="artist-page"] section'
    ];
    
    let trackListElement = null;
    
    // Try each selector with a reasonable timeout
    for (const selector of trackListSelectors) {
      try {
        console.log(`Trying to find tracks with selector: ${selector}`);
        await page.waitForSelector(selector, { timeout: 10000 });
        trackListElement = await page.$(selector);
        if (trackListElement) {
          console.log(`Found tracks with selector: ${selector}`);
          break;
        }
      } catch (error) {
        console.log(`Selector ${selector} not found: ${error.message}`);
      }
    }
    
    if (!trackListElement) {
      // Take a screenshot for debugging
      await page.screenshot({ path: 'spotify-debug.png' });
      console.log("Created debug screenshot as spotify-debug.png");
      
      // Dump page HTML for debugging
      const pageContent = await page.content();
      console.log("Page content snippet:", pageContent.substring(0, 500) + "...");
      
      throw new Error("Could not find track list with any known selector");
    }

    // First, check if we already have all track items (normally 10)
    const initialTrackCount = await page.evaluate(() => {
      const trackRows = document.querySelectorAll('[data-testid="tracklist-row"]');
      return trackRows.length;
    });
    console.log(`Initial track count: ${initialTrackCount}`);
    
    // Attempt to load more tracks only if we have less than 10
    if (initialTrackCount < 10) {
      console.log("Track count is less than 10, attempting to load more tracks");
      
      // Define the "See more" button selectors
      const seeMoreSelectors = [
        'button.wi2HeHXOI471ZOh8ncCG[aria-expanded="false"]', 
        'button[aria-expanded="false"] div.e-9640-text',
        'button[aria-expanded="false"]'
      ];
      
      // Try multiple methods to click the button until we get 10 tracks
      let attemptCount = 0;
      const maxAttempts = 3;
      let tracksLoaded = initialTrackCount;
      
      while (tracksLoaded < 10 && attemptCount < maxAttempts) {
        attemptCount++;
        console.log(`Attempt ${attemptCount} to click "See more" button`);
        
        // Try each selector
        for (const selector of seeMoreSelectors) {
          try {
            const buttonExists = await page.evaluate((sel) => {
              const button = document.querySelector(sel);
              return !!button;
            }, selector);
            
            if (buttonExists) {
              console.log(`Found button with selector: ${selector}`);
              
              // Click the button
              await page.click(selector).catch(e => {
                console.warn(`Failed to click with page.click(): ${e.message}`);
                return false;
              });
              
              // Also try JavaScript click as a backup
              await page.evaluate((sel) => {
                const button = document.querySelector(sel);
                if (button) {
                  button.click();
                  console.log("Clicked via JavaScript");
                  return true;
                }
                return false;
              }, selector);
              
              // Wait for content to update
              await page.waitForTimeout(3000);
              
              // Check if tracks increased
              tracksLoaded = await page.evaluate(() => {
                return document.querySelectorAll('[data-testid="tracklist-row"]').length;
              });
              
              console.log(`After attempt ${attemptCount}, track count: ${tracksLoaded}`);
              
              if (tracksLoaded >= 10) {
                console.log("Successfully loaded 10 or more tracks!");
                break;
              }
            }
          } catch (error) {
            console.error(`Error with selector ${selector}:`, error);
          }
        }
        
        // If we've tried all selectors but still don't have 10 tracks, wait and try again
        if (tracksLoaded < 10) {
          console.log("Waiting before next attempt...");
          await page.waitForTimeout(2000);
        }
      }
      
      // Final waiting period to ensure all content is loaded
      await page.waitForTimeout(2000);
    } else {
      console.log("Already have 10 or more tracks, no need to click 'See more'");
    }

    // Ensure page is scrolled to show all content
    await autoScroll(page);

    // If track list is found, try different methods to extract tracks
    console.log("Extracting tracks using different methods...");
    
    // Try different track row selectors
    const trackRowSelectors = [
      '[data-testid="tracklist-row"]',
      'div[role="row"]',
      'div[data-testid="track-row"]',
      '.tracklist-row',
      'div[aria-rowindex]'
    ];
    
    let trackListData = [];
    
    // Try each selector to find track rows
    for (const selector of trackRowSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 5000 });
        
        const trackCount = await page.evaluate((sel) => {
          return document.querySelectorAll(sel).length;
        }, selector);
        
        console.log(`Found ${trackCount} tracks with selector: ${selector}`);
        
        if (trackCount > 0) {
          // Extract track data using this selector
          // First, get and log the HTML structure of a track row for debugging
          const rowHtml = await page.evaluate((rowSelector) => {
            const row = document.querySelector(rowSelector);
            return row ? row.outerHTML : "No row found";
          }, selector);
          // console.log("Track row HTML structure:", rowHtml.substring(0, 500) + "...");
          
          // Now extract the track data with improved selectors
          trackListData = await page.evaluate((rowSelector) => {
            const trackRows = document.querySelectorAll(rowSelector);
            if (!trackRows || trackRows.length === 0) return [];
            
            return Array.from(trackRows).map((row, index) => {
              try {
                // Track name - multiple possible selectors with more robust detection
                let trackName = "Unknown";
                
                // Try specific selectors first
                const nameSelectors = [
                  '[data-testid="internal-track-link"] .encore-text-body-medium',
                  '[data-testid="internal-track-link"] span',
                  '.tracklist-name',
                  'a[href^="/track/"] .encore-text-body-medium',
                  '.encore-text-body-medium a'
                ];
                
                for (const selector of nameSelectors) {
                  const el = row.querySelector(selector);
                  if (el && el.innerText && el.innerText.trim()) {
                    trackName = el.innerText.trim();
                    // If we found a non-numeric name, we're done
                    if (isNaN(parseInt(trackName))) {
                      break;
                    }
                  }
                }
                
                // If we still have a numeric or unknown name, try all links in the row
                if (trackName === "Unknown" || !isNaN(parseInt(trackName))) {
                  const links = row.querySelectorAll('a');
                  for (const link of links) {
                    // Skip links with numeric text or empty text
                    if (link.innerText && 
                        link.innerText.trim() && 
                        isNaN(parseInt(link.innerText.trim()))) {
                      trackName = link.innerText.trim();
                      break;
                    }
                  }
                }
                
                // If still not found, try all spans that might contain the track name
                // Often track names are in spans with longer text
                if (trackName === "Unknown" || !isNaN(parseInt(trackName))) {
                  const spans = Array.from(row.querySelectorAll('span'))
                    .filter(span => {
                      const text = span.innerText?.trim();
                      return text && 
                             text.length > 2 && 
                             isNaN(parseInt(text)) &&
                             !text.includes(':') &&  // Not a time format
                             !text.match(/[\d,]+/); // Not a number with commas
                    });
                  
                  if (spans.length > 0) {
                    // Sort by length and pick the longest as it's likely the track name
                    spans.sort((a, b) => b.innerText.length - a.innerText.length);
                    trackName = spans[0].innerText.trim();
                  }
                }
                
                // Track image
                const trackImage = row.querySelector('img')?.src || null;
                
                // Track link and ID
                const trackLink = row.querySelector('a[href^="/track/"]')?.getAttribute('href') || null;
                const trackId = trackLink ? trackLink.split('/').pop() : null;
                
                // Get all spans in the row to find stream count and duration
                // They often appear as bare text in span elements
                const allSpans = Array.from(row.querySelectorAll('.encore-text-body-small'));
                
                // Log spans for debugging
                console.log(`Track ${index} spans:`, allSpans.map(span => span.innerText).join(' | '));
                
                // Stream count - look for numeric patterns
                let streamCount = "0";
                for (const span of allSpans) {
                  const text = span.innerText;
                  // Match patterns like "1,234,567" or "1.2M"
                  if (text && (text.match(/[\d,]+/) || text.match(/[\d\.]+[KMB]/i))) {
                    // Avoid matching things like track numbers or durations (e.g., "3:45")
                    if (!text.includes(':') && text.length > 1) {
                      streamCount = text;
                      break;
                    }
                  }
                }
                
                // Duration - look for time format (e.g., "3:45")
                let duration = "0";
                for (const span of allSpans) {
                  const text = span.innerText;
                  // Match time format pattern (e.g., "3:45")
                  if (text && text.match(/\d+:\d+/)) {
                    duration = text;
                    break;
                  }
                }
                
                // Try looking for specific positions in the DOM
                // Often the spans are arranged in order, with stream count being the second-to-last span
                if (streamCount === "0" && allSpans.length > 2) {
                  const possibleStreamCount = allSpans[allSpans.length - 2]?.innerText;
                  if (possibleStreamCount && !possibleStreamCount.includes(':')) {
                    streamCount = possibleStreamCount;
                  }
                }
                
                // Often the duration is the last span
                if (duration === "0" && allSpans.length > 1) {
                  const possibleDuration = allSpans[allSpans.length - 1]?.innerText;
                  if (possibleDuration && possibleDuration.includes(':')) {
                    duration = possibleDuration;
                  }
                }
                
                return {
                  image: trackImage,
                  name: trackName,
                  stream_count: streamCount,
                  duration: duration,
                  track_id: trackId
                };
              } catch (err) {
                console.log(`Error extracting track ${index}:`, err);
                return {
                  name: `Unknown (Row ${index+1})`,
                  stream_count: "0",
                  duration: "0"
                };
              }
            });
          }, selector);
          
          // If we have tracks, no need to try other selectors
          if (trackListData.length > 0) {
            break;
          }
        }
      } catch (error) {
        console.log(`Track row selector ${selector} not found or error: ${error.message}`);
      }
    }
    
    // If we still don't have tracks, try one last approach with generic DOM traversal
    if (trackListData.length === 0) {
      console.log("Trying generic track extraction as last resort");
      
      trackListData = await page.evaluate(() => {
        // Look for any links that might be tracks
        const trackLinks = Array.from(document.querySelectorAll('a[href*="/track/"]'));
        return trackLinks.map(link => {
          const name = link.innerText || "Unknown";
          const trackId = link.href.split('/').pop();
          return {
            name,
            track_id: trackId,
            stream_count: "N/A",
            duration: "N/A" 
          };
        });
      });
    }

    // Extract monthly listeners
    let monthlyListeners = "N/A";
    try {
      monthlyListeners = await page.evaluate(() => {
        // Try multiple selectors for monthly listeners
        const selectors = [
          ".Ydwa1P5GkCggtLlSvphs", 
          "[data-testid='monthly-listeners-label']",
          ".stats-listeners",
          "div:contains('monthly listeners')"
        ];
        
        for (const selector of selectors) {
          const el = document.querySelector(selector);
          if (el) return el.textContent.trim();
        }
        
        // Last resort: look for text containing "monthly listeners"
        const elements = document.querySelectorAll('*');
        for (const el of elements) {
          if (el.textContent && el.textContent.includes('monthly listeners')) {
            return el.textContent.trim();
          }
        }
        
        return "N/A";
      });
    } catch (err) {
      console.warn("Monthly listeners element not found:", err.message);
    }

    // Extract artist name with improved selectors
    let artistName = "Unknown Artist";
    try {
      artistName = await page.evaluate(() => {
        // Try multiple selectors for artist name
        const selectors = [
          "h1[data-testid='entityTitle']",
          "h1.encore-text-title-large",
          "h1.Type__TypeElement-sc-goli3j-0",
          "h1",
          ".artist-header h1",
          ".artist-name",
          "h1.artist"
        ];
        
        for (const selector of selectors) {
          const el = document.querySelector(selector);
          if (el && el.innerText && el.innerText.trim()) {
            return el.innerText.trim();
          }
        }
        
        // If still not found, try looking for the largest heading on the page
        const h1s = document.querySelectorAll('h1');
        if (h1s.length > 0) {
          // Sort by text length and take the longest as it's likely the artist name
          const sortedH1s = Array.from(h1s).sort((a, b) => 
            (b.innerText?.length || 0) - (a.innerText?.length || 0)
          );
          return sortedH1s[0]?.innerText?.trim() || "Unknown Artist";
        }
        
        return "Unknown Artist";
      });
    } catch (err) {
      console.warn("Artist name element not found:", err.message);
    }

    // Clean up and process data
    const processedTracks = trackListData.map(track => ({
      ...track,
      stream_count_numeric: cleanStreamCount(track.stream_count)
    }));

    // Calculate total streams
    const totalStreams = processedTracks.reduce(
      (sum, track) => sum + (track.stream_count_numeric || 0), 
      0
    );

    // Add screenshot for debugging
    let screenshot = null;
    try {
      screenshot = await page.screenshot({ encoding: 'base64' });
    } catch (err) {
      console.warn("Screenshot failed:", err.message);
    }

    // Close browser
    await browser.close();

    // Send response
    res.status(200).json({
      success: true,
      artist: {
        id: artistId,
        name: artistName,
        monthlyListeners
      },
      tracks: processedTracks,
      stats: {
        totalTracks: processedTracks.length,
        totalStreams
      },
      debug: {
        timestamp: new Date().toISOString(),
        screenCaptured: !!screenshot
      }
    });

  } catch (error) {
    console.error("Error in Spotify scraper:", error);
    
    res.status(500).json({ 
      success: false,
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  } finally {
    // Ensure browser is closed even if there's an error
    if (browser) {
      await browser.close().catch(e => console.error("Error closing browser:", e));
    }
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ status: "OK" });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Spotify Scraper API running on port ${PORT}`);
});

module.exports = app;