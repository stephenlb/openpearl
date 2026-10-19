openpearl.route('POST', '/export', () => {
  for (const c of openpearl.data.find('customers')) openpearl.data.insert('orders', { title: String(c.email) });
  return 'ok';
});
