/* Runs the models off the main thread so the page stays responsive. */
importScripts('ml-core.js');
self.onmessage = (e) => self.HML.handle(e.data, (m) => self.postMessage(m));
