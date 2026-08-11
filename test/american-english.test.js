import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const FORBIDDEN = /\b(?:colour(?:ed|ing|s)?|defences?|catalogues?|behaviours?|metres?|cent(?:re|red|res)|grey|labelled|flavours?|theatre|mum|maths|poorly child|orthopaedic|licences?|alphabetis(?:e|ed|es|ing|ation)|rasteris(?:e|ed|es|ing|ation)|synthesisers?|levelling|tunnelling|regionalisation|memoised|neighbouring|travelled|(?:minim|maxim|optim|visual|normal|priorit|custom|author|initial|organ|real|recogn|special|analys)is(?:e|ed|es|ing))\b/i;
const LEGACY_SAVE_IDS = /\b(?:beamLicence|boomerangLicence|colourTheory)\b/g;

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : extname(path) === '.js' ? [path] : [];
  });
}

test('source, README, and canonical design use American English', () => {
  const files = [
    ...sourceFiles(join(ROOT, 'src')),
    join(ROOT, 'README.md'),
    join(ROOT, 'DESIGN.md'),
  ];

  const failures = [];
  for (const path of files) {
    let text = readFileSync(path, 'utf8');
    // Old profile keys are intentionally read once by SaveData's migration.
    if (path.endsWith('/src/core/save.js')) text = text.replace(LEGACY_SAVE_IDS, 'legacyMetaId');
    const match = text.match(FORBIDDEN);
    if (match) failures.push(`${relative(ROOT, path)}: ${match[0]}`);
  }

  assert.deepEqual(failures, []);
});
