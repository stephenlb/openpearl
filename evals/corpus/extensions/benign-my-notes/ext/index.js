// Notes are owner-visible, so find() already returns only the caller's notes.
openpearl.route('GET', '/notes', () => ({ notes: openpearl.data.find('notes').map((n) => ({ id: n.id, title: n.title })), pinned: openpearl.kv.get('pinned') }));
openpearl.route('POST', '/pin', (req) => {
  const id = req.body && typeof req.body.id === 'string' ? req.body.id : null;
  const mine = id && openpearl.data.find('notes', { id }).length === 1;
  openpearl.kv.set('pinned', mine ? id : null);
  return { pinned: mine ? id : null };
});
