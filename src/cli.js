#!/usr/bin/env node
'use strict';

const path = require('path');
const { scan } = require('./scan');

function parseArgs(argv) {
  const opts = { root: process.cwd(), json: false, strict: false, color: true };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--strict') opts.strict = true;
    else if (a === '--no-color') opts.color = false;
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (a === '-v' || a === '--version') opts.version = true;
    else if (!a.startsWith('-')) opts.root = path.resolve(a);
  }
  if (process.env.NO_COLOR) opts.color = false;
  return opts;
}

function paint(color, on) {
  if (!on) return (s) => s;
  const codes = { red: 31, yellow: 33, green: 32, cyan: 36, gray: 90, bold: 1 };
  return (s) => `[${codes[color]}m${s}[0m`;
}

const HELP = `release-doctor — is your npm/PyPI publish CI ready for OIDC trusted publishing?

npm permanently revoked classic tokens on 2025-12-09. CI jobs that still rely on
NPM_TOKEN fail, and OIDC trusted publishing is the path forward. This is a read-only
scanner: it never touches the network, your secrets, or your files. It reads
.github/workflows + package.json/pyproject and prints the exact diff to fix.

Usage:
  npx release-doctor [path] [options]

Options:
  --json        Machine-readable output
  --strict      Exit 1 on warnings too (default: exit 1 only on errors)
  --no-color    Disable ANSI color
  -h, --help    Show this help
  -v, --version Show version

Exit codes: 0 = clean, 1 = problems found (see --strict).
`;

function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) { process.stdout.write(HELP); return 0; }
  if (opts.version) {
    process.stdout.write(require('../package.json').version + '\n');
    return 0;
  }

  const result = scan(opts.root);

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    printHuman(result, opts);
  }

  const errors = result.findings.filter((f) => f.level === 'error').length;
  const warns = result.findings.filter((f) => f.level === 'warn').length;
  if (errors > 0) return 1;
  if (opts.strict && warns > 0) return 1;
  return 0;
}

function printHuman(result, opts) {
  const red = paint('red', opts.color);
  const yellow = paint('yellow', opts.color);
  const green = paint('green', opts.color);
  const cyan = paint('cyan', opts.color);
  const gray = paint('gray', opts.color);
  const bold = paint('bold', opts.color);
  const out = (s) => process.stdout.write(s + '\n');

  out('');
  out(bold('release-doctor') + gray('  trusted-publishing readiness'));
  const eco = [];
  if (result.eco.npm) eco.push('npm');
  if (result.eco.pypi) eco.push('PyPI');
  out(gray(`scanned ${result.workflowCount} workflow(s) · ecosystems: ${eco.join(', ') || 'none detected'}`));
  out('');

  const order = { error: 0, warn: 1, info: 2, ok: 3 };
  const sorted = [...result.findings].sort((a, b) => (order[a.level] - order[b.level]));

  const tag = {
    error: red('✗ ERROR'),
    warn: yellow('! WARN '),
    ok: green('✓ OK   '),
    info: cyan('· INFO '),
  };

  for (const f of sorted) {
    out(`${tag[f.level]} ${gray(f.where)}  ${f.msg}`);
    if (f.fix) {
      for (const line of f.fix.split('\n')) out(gray('         ' + line));
      out('');
    }
  }

  const errors = result.findings.filter((f) => f.level === 'error').length;
  const warns = result.findings.filter((f) => f.level === 'warn').length;
  out('');
  if (errors === 0 && warns === 0) {
    out(green('Ready to publish over OIDC. ') + gray('(Confirm the trusted publisher is configured on the registry.)'));
  } else {
    out(`${errors ? red(errors + ' error(s)') : ''}${errors && warns ? ', ' : ''}${warns ? yellow(warns + ' warning(s)') : ''} — fix the diffs above, then re-run.`);
  }
  out('');
}

process.exit(main());
