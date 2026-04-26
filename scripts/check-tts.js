#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
);
const appJson = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));

const failures = [];

function expect(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

expect(
  Boolean(packageJson.dependencies?.['expo-audio']),
  'Missing dependency: expo-audio',
);
expect(
  Boolean(packageJson.dependencies?.['expo-secure-store']),
  'Missing dependency: expo-secure-store',
);
expect(Boolean(packageJson.devDependencies?.tsx), 'Missing devDependency: tsx');
expect(
  packageJson.scripts?.['check:tts'] === 'node scripts/check-tts.js',
  'Missing or incorrect script: check:tts',
);
expect(
  packageJson.scripts?.['test:tts'] === 'tsx --test src/tts/*.test.ts',
  'Missing or incorrect script: test:tts',
);
expect(
  Array.isArray(appJson.expo?.plugins) &&
    appJson.expo.plugins.includes('expo-secure-store'),
  'Missing app plugin: expo-secure-store',
);

if (failures.length > 0) {
  console.error('TTS scaffold check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('TTS scaffold check passed.');
