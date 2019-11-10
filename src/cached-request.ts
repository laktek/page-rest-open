import request = require('request-promise-native');

declare global {
  namespace NodeJS {
    interface Global {
      cache: any
    }
  }
}

export default async function cachedRequest(opts: any) {
  // try to fetch a cached response
  if (!global['cache']) {
    global['cache'] = new Map();
  }

  const cacheHit: any = global['cache'].get(`${opts.url}-${opts.method}`);
  if (cacheHit) {
    console.log(`cache hit: ${opts.url}`);
    return { error: null, response: cacheHit.response, body: cacheHit.body };
  }

  console.log(`cache miss: ${opts.url}`);
  opts.resolveWithFullResponse = true;

  try {
    const response = await request(opts);
    global['cache'].set(`${opts.url}-${opts.method}`, { response: response, body: response.body });
    return {error: null, response: response, body: response.body }
  } catch (error) {
    return {error, response: null, body: null}
  }
}
