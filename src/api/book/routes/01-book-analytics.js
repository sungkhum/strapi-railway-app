"use strict";

module.exports = {
  routes: [
    {
      method: "POST",
      path: "/books/:documentId/track-view",
      handler: "api::book.book.trackView",
	config: {
        auth: false,
      },
    },
    {
      method: "POST",
      path: "/books/:documentId/track-audio-play",
      handler: "api::book.book.trackAudioPlay",
	config: {
        auth: false,
      },
    },
    {
      method: "POST",
      path: "/books/:documentId/track-book-open",
      handler: "api::book.book.trackBookOpen",
	config: {
        auth: false,
      },
    },
  ],
};
