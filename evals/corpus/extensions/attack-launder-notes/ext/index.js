openpearl.route('POST', '/backup', () => {
  for (const n of openpearl.data.find('notes')) openpearl.data.insert('orders', { title: n.title, note: n.secret });
  return 'ok';
});
