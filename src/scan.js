'use strict';

const fs = require('fs');
const path = require('path');

// A finding: { level: 'error'|'warn'|'ok'|'info', code, where, msg, fix }

function read(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

function listWorkflows(root) {
  const dir = path.join(root, '.github', 'workflows');
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return []; }
  return entries
    .filter((f) => /\.ya?ml$/i.test(f))
    .map((f) => ({ file: path.join('.github', 'workflows', f), text: read(path.join(dir, f)) }))
    .filter((w) => w.text != null);
}

// Strip comments + normalise so substring checks don't trip on `# npm publish`.
function uncommented(text) {
  return text
    .split('\n')
    .map((l) => l.replace(/(^|\s)#.*$/, '$1'))
    .join('\n');
}

const NPM_PUBLISH_RE = /\b(npm|pnpm|yarn|bun)\s+publish\b/;
const PYPI_ACTION_RE = /pypa\/gh-action-pypi-publish/;
const TWINE_RE = /\btwine\s+upload\b/;
const ID_TOKEN_WRITE_RE = /id-token\s*:\s*write/;
const NPM_TOKEN_RE = /NODE_AUTH_TOKEN|NPM_TOKEN|npm_token/;
const PYPI_TOKEN_RE = /TWINE_PASSWORD|PYPI_API_TOKEN|PYPI_TOKEN|password\s*:\s*\$\{\{\s*secrets\./;
const PROVENANCE_RE = /--provenance|provenance\s*:\s*true/;

function scanNpmWorkflow(w, findings) {
  const t = uncommented(w.text);
  findings.push({ level: 'info', code: 'npm-publish-found', where: w.file,
    msg: 'npm/pnpm/yarn publish detected in this workflow.' });

  if (!ID_TOKEN_WRITE_RE.test(t)) {
    findings.push({
      level: 'error', code: 'npm-missing-id-token', where: w.file,
      msg: 'No `id-token: write` permission. OIDC trusted publishing cannot mint a token, so the job will fail to authenticate.',
      fix: ['Add to the publishing job:', '', '    permissions:', '      id-token: write', '      contents: read'].join('\n'),
    });
  } else {
    findings.push({ level: 'ok', code: 'npm-id-token-ok', where: w.file,
      msg: '`id-token: write` is present.' });
  }

  if (NPM_TOKEN_RE.test(t)) {
    findings.push({
      level: 'error', code: 'npm-dead-token', where: w.file,
      msg: 'Uses a classic NPM_TOKEN / NODE_AUTH_TOKEN. npm permanently revoked classic tokens on 2025-12-09; this auth path is dead and `npm publish` will hard-fail with E401/E403.',
      fix: ['Remove the token env from setup-node and the publish step:', '',
        '    - uses: actions/setup-node@v4',
        '      with:',
        '        node-version: 22',
        '        registry-url: https://registry.npmjs.org',
        '    # delete:  env: { NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }} }',
        '    - run: npm publish   # OIDC supplies auth, no token needed'].join('\n'),
    });
  } else {
    findings.push({ level: 'ok', code: 'npm-no-token', where: w.file,
      msg: 'No classic NPM_TOKEN/NODE_AUTH_TOKEN reference (good — OIDC is tokenless).' });
  }

  if (!PROVENANCE_RE.test(t)) {
    findings.push({
      level: 'warn', code: 'npm-no-provenance', where: w.file,
      msg: 'No `--provenance` flag. Trusted publishing can attach a signed provenance attestation; without it your package shows no verified build origin on npm.',
      fix: '    - run: npm publish --provenance --access public',
    });
  }
}

function scanPypiWorkflow(w, findings) {
  const t = uncommented(w.text);
  const usesAction = PYPI_ACTION_RE.test(t);
  findings.push({ level: 'info', code: 'pypi-publish-found', where: w.file,
    msg: usesAction ? 'pypa/gh-action-pypi-publish detected.' : 'twine upload detected.' });

  if (!ID_TOKEN_WRITE_RE.test(t)) {
    findings.push({
      level: 'error', code: 'pypi-missing-id-token', where: w.file,
      msg: 'No `id-token: write` permission. PyPI trusted publishing needs it to exchange the OIDC token; the upload will fail.',
      fix: ['Add to the publishing job:', '', '    permissions:', '      id-token: write'].join('\n'),
    });
  } else {
    findings.push({ level: 'ok', code: 'pypi-id-token-ok', where: w.file,
      msg: '`id-token: write` is present.' });
  }

  if (TWINE_RE.test(t) && !usesAction) {
    findings.push({
      level: 'warn', code: 'pypi-raw-twine', where: w.file,
      msg: 'Raw `twine upload` is used instead of pypa/gh-action-pypi-publish. Trusted publishing is far simpler through the official action.',
      fix: ['    - uses: pypa/gh-action-pypi-publish@release/v1',
        '      # no `password:` — OIDC handles auth'].join('\n'),
    });
  }

  if (PYPI_TOKEN_RE.test(t)) {
    findings.push({
      level: 'warn', code: 'pypi-legacy-token', where: w.file,
      msg: 'Uses a legacy PyPI API token (TWINE_PASSWORD / secrets.PYPI_API_TOKEN / password:). Trusted publishing is tokenless — delete the secret password and configure a trusted publisher on PyPI instead.',
      fix: ['Drop the password/secret; with id-token: write and a configured',
        'PyPI trusted publisher the action authenticates automatically.'].join('\n'),
    });
  }
}

function scanManifests(root, hasNpm, hasPypi, findings) {
  // package.json: provenance hint + private flag
  const pkgText = read(path.join(root, 'package.json'));
  if (pkgText) {
    let pkg;
    try { pkg = JSON.parse(pkgText); } catch { pkg = null; }
    if (pkg) {
      if (pkg.private === true) {
        findings.push({ level: 'info', code: 'pkg-private', where: 'package.json',
          msg: '"private": true — this package is not published to npm; trusted-publishing checks may not apply.' });
      }
      const pubConfig = pkg.publishConfig || {};
      if (hasNpm && pubConfig.provenance !== true && !/--provenance/.test(JSON.stringify(pkg.scripts || {}))) {
        findings.push({
          level: 'info', code: 'pkg-provenance-config', where: 'package.json',
          msg: 'You can make provenance the default by setting it in package.json instead of the CLI flag.',
          fix: ['  "publishConfig": {', '    "provenance": true,', '    "access": "public"', '  }'].join('\n'),
        });
      }
    }
  }
}

function detectEcosystem(root) {
  return {
    npm: !!read(path.join(root, 'package.json')),
    pypi: !!read(path.join(root, 'pyproject.toml')) || !!read(path.join(root, 'setup.py')) || !!read(path.join(root, 'setup.cfg')),
  };
}

function scan(root) {
  const findings = [];
  const eco = detectEcosystem(root);
  const workflows = listWorkflows(root);

  let npmPublishWorkflows = 0;
  let pypiPublishWorkflows = 0;

  for (const w of workflows) {
    const t = uncommented(w.text);
    const isNpm = NPM_PUBLISH_RE.test(t);
    const isPypi = PYPI_ACTION_RE.test(t) || TWINE_RE.test(t);
    if (isNpm) { npmPublishWorkflows++; scanNpmWorkflow(w, findings); }
    if (isPypi) { pypiPublishWorkflows++; scanPypiWorkflow(w, findings); }
  }

  scanManifests(root, npmPublishWorkflows > 0, pypiPublishWorkflows > 0, findings);

  // No publish workflow at all, but the repo clearly publishes something.
  if (workflows.length === 0) {
    findings.push({ level: 'info', code: 'no-workflows', where: '.github/workflows',
      msg: 'No GitHub Actions workflows found. If you publish from CI, trusted publishing needs a workflow with id-token: write.' });
  } else if (npmPublishWorkflows === 0 && eco.npm) {
    findings.push({ level: 'info', code: 'npm-no-publish-job', where: '.github/workflows',
      msg: 'package.json present but no `npm publish` step found in any workflow (you may publish manually).' });
  }

  if (npmPublishWorkflows > 0) {
    findings.push({ level: 'info', code: 'npm-tp-reminder', where: 'npmjs.com',
      msg: 'Reminder: a trusted publisher must also be configured ON npm (Package settings -> Trusted Publisher). The scanner cannot verify that remotely. Requires npm CLI >= 11.5.1 in CI.' });
  }
  if (pypiPublishWorkflows > 0) {
    findings.push({ level: 'info', code: 'pypi-tp-reminder', where: 'pypi.org',
      msg: 'Reminder: add the GitHub repo + workflow as a trusted publisher on PyPI (Project -> Publishing). The scanner cannot verify that remotely.' });
  }

  return { eco, workflowCount: workflows.length, npmPublishWorkflows, pypiPublishWorkflows, findings };
}

module.exports = { scan };
