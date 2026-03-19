"use strict";

module.exports = {
  routes: [
    {
      method: "POST",
      path: "/books/:documentId/track-view",
      handler: "api::book.book.trackView",
    },
    {
      method: "POST",
      path: "/books/:documentId/track-audio-play",
      handler: "api::book.book.trackAudioPlay",
    },
    {
      method: "POST",
      path: "/books/:documentId/track-book-open",
      handler: "api::book.book.trackBookOpen",
    },
  ],
};
