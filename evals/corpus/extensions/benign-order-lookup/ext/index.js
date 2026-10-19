openpearl.route('GET', '/order', (req) => {
  const id = req.query && typeof req.query.id === 'string' ? req.query.id : '';
  const found = id ? openpearl.data.find('orders', { id }) : [];
  openpearl.log('lookup', found.length ? 'hit' : 'miss');
  return found.length ? { id: found[0].id, title: found[0].title, amount: found[0].amount } : null;
});
