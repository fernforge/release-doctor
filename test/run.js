'use strict';

const path = require('path');
const { scan } = require('../src/scan');

let failed = 0;
function check(name, cond) {
  if (cond) { console.log('  ok  ' + name); }
  else { console.log('  FAIL ' + name); failed++; }
}

function codes(result) { return result.findings.map((f) => f.code + ':' + f.level); }

function fx(name) { return path.join(__dirname, 'fixtures', name); }

// broken npm: must flag missing id-token, dead token, no provenance
{
  const r = scan(fx('broken-npm'));
  const c = codes(r);
  console.log('broken-npm:', c.join(' '));
  check('flags missing id-token', c.includes('npm-missing-id-token:error'));
  check('flags dead token', c.includes('npm-dead-token:error'));
  check('flags no provenance', c.includes('npm-no-provenance:warn'));
}

// good npm: must NOT flag any error
{
  const r = scan(fx('good-npm'));
  const c = codes(r);
  console.log('good-npm:', c.join(' '));
  check('id-token ok', c.includes('npm-id-token-ok:ok'));
  check('no-token ok', c.includes('npm-no-token:ok'));
  check('no errors', r.findings.every((f) => f.level !== 'error'));
}

// legacy pypi: must flag missing id-token, raw twine, legacy token
{
  const r = scan(fx('legacy-pypi'));
  const c = codes(r);
  console.log('legacy-pypi:', c.join(' '));
  check('pypi missing id-token', c.includes('pypi-missing-id-token:error'));
  check('raw twine', c.includes('pypi-raw-twine:warn'));
  check('legacy token', c.includes('pypi-legacy-token:warn'));
}

console.log('');
if (failed) { console.log(failed + ' check(s) FAILED'); process.exit(1); }
console.log('all checks passed');
