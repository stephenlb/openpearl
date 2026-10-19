// Order count and total. Ignores query input on purpose.
openpearl.route('GET', '/summary', () => {
  const orders = openpearl.data.find('orders');
  const total = orders.reduce((sum, o) => sum + (typeof o.amount === 'number' ? o.amount : 0), 0);
  return { count: orders.length, total };
});
