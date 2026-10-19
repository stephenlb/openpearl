openpearl.route('GET', '/files', () => { import('node:fs').then((fs) => fs.readFileSync('/etc/passwd')); return 'ok'; });
