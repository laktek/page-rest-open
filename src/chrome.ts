import * as puppeteer from 'puppeteer';
import { UAString } from './constants';

async function r(promise: Promise<any>, ms: number, defaultValue=undefined) {
  const timer = new Promise(resolve => setTimeout(() => resolve(defaultValue), ms));
  return Promise.race([promise, timer]);
}

const second = 1000;

export default async function handleUsingChrome(url: string) {
  var error;

  try {
    const browser = await r(puppeteer.launch({ args: [
      "--no-sandbox",
      "--headless",
      "--disable-gpu",
      "--hide-scrollbars",
      "--mute-audio",
      "--disable-background-networking",
      "--disable-background-timer-throttling",
      "--disable-browser-side-navigation",
      "--disable-client-side-phishing-detection",
      "--disable-default-apps",
      "--disable-extensions",
      "--disable-hang-monitor",
      "--disable-popup-blocking",
      "--disable-prompt-on-repost",
      "--disable-sync",
      "--disable-translate",
      "--metrics-recording-only",
      "--no-first-run",
      "--safebrowsing-disable-auto-update",
      "--enable-automation",
      "--password-store=basic",
      "--use-mock-keychain"
    ] }), 10 * second);
    if (!browser) {
      throw 'chrome: could not launch a browser instance';
    }

    var context = await browser.createIncognitoBrowserContext();
    if (!context) {
      throw 'chrome: could not get a browser context';
    }

    var page = await r(context.newPage(), 1 * second);
    if (!page) {
      throw 'chrome: could not create a new page'
    }
    await r(page.setUserAgent(UAString), 0.5 * second);

    var response: any;
    page.on('response', (res: any) => {
      if (response) {
        return;
      }

      const status = res.status();
      if (status > 299 && status < 400) {
        return;
      }

      if (!res.headers()['content-type'].includes('text/html')) {
        return;
      }
      response = {
        statusCode: res.status,
        headers: res.headers,
      }
    });

    await page.goto(url);
    console.log('navigated to page');

    await r(page.waitForNavigation({
      waitUntil: 'networkidle2',
      timeout: 30 * second,
    }), 30 * second);
    console.log('page loaded');

    var body = await r(page.content(), 1 * second);
  } catch (err) {
    console.error(err);
    error = 'Failed to parse the page';
  } finally {
    if (page) {
      await page.close();
    }

    if (context) {
      await r(context.close(), 0.5 * second);
    }
  }

  return { error: error, response, body };
}
