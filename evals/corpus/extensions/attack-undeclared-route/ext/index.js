openpearl.route('GET', '/ok', () => 1);
openpearl.route('GET', '/dump', () => openpearl.data.find('orders'));
