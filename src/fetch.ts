import urlib = require('url');

import handleUsingChrome from './chrome';
import cachedRequest from './cached-request';
import jsdom = require('jsdom');
const { JSDOM } = jsdom;

import { knownEmbedHosts, UAString } from './constants';

export const fetch = async (req: any, res: any) => {
  console.log('received request');
  console.log(req);

  // set CORS headers
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Authorization');
  res.header('Access-Control-Max-Age', '1728000');

  if (req.method === "OPTIONS") {
    res.status(200).send();
    return;
  }

  const url = req.query.url;
  if (!url) {
    res.status(400).json({ error: 'provide a URL to fetch' });
    return;
  }
  const parsed = urlib.parse(url);
  if (parsed.protocol && ['http:', 'https:'].indexOf(parsed.protocol) === -1) {
    res.status(400).json({ error: 'invalid URL' });
    return;
  }

  let output;
  if (isTruish(req.query.prerender)) {
    const host = 'functions.config().browser.host'; // TODO: make this configurable
    output = await handleUsingChrome(url, host);
  } else {
    output = await cachedRequest({
      url: url,
      headers: {
        'User-Agent': UAString
      }
    });
  }

  const { error, response, body } = output;

  if (error) {
    res.status(500).json({ error: error });
    return;
  }

  if (!response) {
    res.status(500).json({ error: 'invalid response' });
    return;
  }

  const fields: any = {};

  // get the http status code
  fields['status'] = response.statusCode;

  // get headers
  if (req.query.header) {
    fields['headers'] = queryHeaders(response, req.query.header);
  }

  // if response is not a html page end early
  if (response.headers['content-type'] && !response.headers['content-type'].match(/html|xml/i)) {
    res.status(200).json(fields);
    return;
  }

  // continue to parse the DOM
  const dom = new JSDOM(body);
  const document = dom.window.document;

  if (req.query.selector) {
    try {
      fields['selectors'] = queryElements(document, req.query.selector);
    } catch (e) {
      console.log(e);
      res.status(400).json({ error: 'invalid selector - fix and try again'});
      return;
    }
  }

  // add search results
  if (req.query.contains) {
    const bodyText = document.body.textContent || '';
    fields['contains'] = {}

    let contains: (string | string[]) = req.query.contains;
    if (!Array.isArray(contains)) {
      contains = [ contains ];
    }
    contains.forEach((word) => {
      try {
        const regex = new RegExp(word);
        fields['contains'][word] = regex.test(bodyText);
      } catch (e) {
        console.error('invalid regex');
      }
    });
  }

  const basic = {
    title: getTitle(document),
    description: getDesc(document),
    canonicalURL: getCanonicalURL(document),
    icons: getIcons(document),
    logo: getLogo(document),
    twitter: getTwitter(document),
  };

  if (isTruish(req.query.og)) {
    fields['opengraph'] = getOpenGraph(document);
  }

  if (!isTruish(req.query.embed)) {
    res.status(200).json(Object.assign({}, basic, fields));
    return;
  }

  try {
    const embed: any = await getEmbed(document, basic.canonicalURL || url);
    fields['embed'] = embed;
    res.status(200).json(Object.assign({}, basic, fields));
  } catch (e) {
    res.status(400).json({ error: e });
  }
}

function getTitle(document: Document) {
  const ogTitle = document.querySelector('meta[property="og:title"]');
  if (ogTitle) {
    const title = ogTitle.getAttribute('content') || ogTitle.getAttribute('value');
    return title && title.trim();
  }

  const title = document.querySelector('title');
  if (title) {
    return (title.textContent || '').trim();
  }

  return null;
}

function getDesc(document: Document) {
  const ogDesc = document.querySelector('meta[property="og:description"]');
  if (ogDesc) {
    const desc = ogDesc.getAttribute('content') || ogDesc.getAttribute('value');
    return desc && desc.trim();
  }

  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) {
    return (metaDesc.getAttribute('content') || '').trim();
  }

  return null;
}

function getCanonicalURL(document: Document) {
  const canonicalLink = document.querySelector('link[rel="canonical"]');
  if (!canonicalLink) {
    return null;
  }

  const href = canonicalLink.getAttribute('href');
  return href && href.trim();
}

function getIcons(document: Document) {
  const icons = document.querySelectorAll('link[rel$=icon]');
  return Array.prototype.map.call(icons, (icon) => {
    const href = icon.getAttribute('href');
    return href && href.trim();
  });
}

function getLogo(document: Document) {
  const ogLogo = document.querySelector('meta[property="og:logo"]');
  if (ogLogo) {
    const value = ogLogo.getAttribute('content') || ogLogo.getAttribute('value');
    return value && value.trim();
  }

  const ogImage = document.querySelector('meta[property="og:image"]');
  if (ogImage) {
    const value = ogImage.getAttribute('content') || ogImage.getAttribute('value');
    return value && value.trim();
  }

  return null;
}

function getTwitter(document: Document) {
  const site = document.querySelector('meta[name="twitter:site"]');
  if (site) {
    const value = site.getAttribute('content') || site.getAttribute('value');
    return value && value.trim();
  }

  const creator = document.querySelector('meta[name="twitter:creator"]');
  if (creator) {
    const value = creator.getAttribute('content') || creator.getAttribute('value');
    return value && value.trim();
  }

  return null;
}

function queryHeaders(response: Response, headers: string[] | string) {
  if (!Array.isArray(headers)) {
    headers = [ headers ];
  }

  // restrict number of selectors to 10
  const limit = 10;
  headers = headers.slice(0, limit);

  // convert all response headers to lower case

  const output: any = {};
  headers.forEach((header) => {
    output[header] = response.headers.get(header.toLowerCase()) || response.headers.get(header);
  });

  return output;
}

function queryElements(document: Document, selectors: string[] | string) {
  if (!Array.isArray(selectors)) {
    selectors = [ selectors ];
  }

  // restrict number of selectors to 10
  const limit = 10;
  selectors = selectors.slice(0, limit);

  const output: any = {};

  selectors.forEach((selector) => {
    const elements = document.querySelectorAll(selector);
    output[selector] = Array.prototype.map.call(elements, (el) => {
      const attrs: any = {}
      for (var i = 0; i < el.attributes.length; i++) {
        attrs[el.attributes[i].name] = el.attributes[i].value;
      }
      return { text: el.textContent.trim(), attrs: attrs }
    });
  });

  return output;
}

function getOpenGraph(document: Document) {
  const props = [
    'title',
    'type',
    'image',
    'url',
    'audio',
    'description',
    'determiner',
    'locale',
    'locale:alternate',
    'site_name',
    'video',
    'image:url',
    'image:secure_url',
    'image:type',
    'image:width',
    'image:height',
    'image:alt',
    'video:url',
    'video:secure_url',
    'video:type',
    'video:width',
    'video:height',
    'video:alt',
    'audio:secure_url',
    'audio:type',
  ];

  const articleProps = [
    'published_time',
    'modified_time',
    'expiration_time',
    'published',
    'publisher',
    'modified',
    'expiration',
    'author',
    'section',
    'section_url',
    'top-level-section',
    'tag'
  ]

  const output: any = {};

  props.forEach((prop) => {
    const tag = document.querySelector(`meta[property=\"og:${prop}\"], meta[name=\"og:${prop}\"]`);
    if (tag) {
      const value = tag.getAttribute('content') || tag.getAttribute('value');
      output[prop] = value && value.trim();
    }
  });

  if (output['type'] === 'article') {
    output['article'] = {};
    articleProps.forEach((prop) => {
      const tag = document.querySelector(`meta[property=\"article:${prop}\"]`);
      if (tag) {
        const value = tag.getAttribute('content') || tag.getAttribute('value');
        output['article'][prop] = value && value.trim();
      }
    });
  }

  return output;
}

function getEmbed(document: Document, url: string) {
  return new Promise(async (resolve, reject) => {
    let endpoint = null;

    const parsed = urlib.parse(url);

    // special case for GitHub gists
    if ((parsed.host || '').indexOf('gist.github.com') === 0) {
      resolve(`<script src="${url}.js"></script>`);
    }

    const domain = (() => {
      let h = (parsed.hostname || '').split('.');
      h.shift();
      return h.join('.');
    })();

    if (knownEmbedHosts[domain]) {
      endpoint = `${knownEmbedHosts[domain]}?url=${url}&format=json`;
    } else {
      const oembed = document.querySelector('link[type="application/json+oembed"]');
      if (oembed) {
        endpoint = oembed.getAttribute('href');
      }
    }

    if (!endpoint) {
      resolve(null);
    }

    const { error, response, body } = await cachedRequest({
      url: endpoint,
      headers: {
        'User-Agent': UAString
      }
    });

    if (error) {
      reject(error);
    }
    if (response.statusCode > 400) {
      reject(`error fetching ${endpoint} - ${response.statusCode}`);
    }

    let parsedBody;
    try {
      parsedBody = JSON.parse(body);
    } catch (e) {
      reject(`error parsing ${endpoint} - ${e}`);
    }

    resolve(parsedBody && parsedBody.html);
  });
}

function isTruish(value: any) {
  if (value === undefined || value === null) {
    return false;
  }

  if (value === '1' || value === 't' || value === 'true' || value === 'on') {
    return true;
  }

  return false;
}
