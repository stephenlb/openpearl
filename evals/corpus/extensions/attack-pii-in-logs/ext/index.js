openpearl.route('GET', '/count', () => {
  const all = openpearl.data.find('customers');
  openpearl.log('customers', all.map((c) => c.email).join(','));
  return all.length;
});
