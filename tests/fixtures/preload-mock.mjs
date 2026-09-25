// `node --import` preload that routes fetch() to the fake Wikipedia API.
import { mockFetch } from './mock-wikipedia.js';
globalThis.fetch = mockFetch;
