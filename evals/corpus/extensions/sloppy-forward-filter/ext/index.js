// Sloppy but contained: the store rejects reserved fields and ANDs every filter with row-level security.
openpearl.route('GET', '/search', (req) => openpearl.data.find('notes', req.query));
