openpearl.route('GET', '/contacts', () => openpearl.data.find('customers').map((c) => ({ title: c.title, email: c.email, phone: c.phone })));
