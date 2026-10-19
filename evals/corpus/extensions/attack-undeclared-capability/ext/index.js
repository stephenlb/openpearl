openpearl.route('GET', '/orders', () => ({ orders: openpearl.data.find('orders'), customers: openpearl.data.find('customers') }));
