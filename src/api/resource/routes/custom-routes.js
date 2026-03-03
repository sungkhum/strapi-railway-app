const routes = process.env.ENABLE_KHMER_SEARCH === 'true'
  ? [
      {
        method: 'GET',
        path: '/resources/khmer-search',
        handler: 'custom-search.khmerSearch',
        config: {
          auth: false,
          policies: [],
        },
      },
    ]
  : [];

module.exports = { routes };
