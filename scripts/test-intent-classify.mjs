#!/usr/bin/env node
/**
 * Test intent classification against the Holdless server.
 * Start the server first: npm run server
 * Then run: node scripts/test-intent-classify.mjs [baseUrl]
 *
 * Example: node scripts/test-intent-classify.mjs http://localhost:3001
 */

const BASE = process.argv[2] || 'http://localhost:3001';
const CLASSIFY_URL = `${BASE.replace(/\/+$/, '')}/api/intent/classify`;

const TEST_MESSAGES = [
  'Call the vet to book a checkup for my dog',
  'I need to compare pet insurance prices',
  'Cancel my internet subscription with Comcast',
  'What\'s the weather like today?',
  'Check if the DMV has appointments next week',
  'Call the restaurant to see if they have a table for 4 tonight',
  'Look up the phone number for the hospital on Main St',
  'I want to file a claim for my car accident',
  'Just saying hi, how are you?',
  'Get me the best rate for electricity in 90024',
];

async function classify(message) {
  const res = await fetch(CLASSIFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { error: data.error || res.statusText, status: res.status };
  return data;
}

async function main() {
  console.log('Intent classification tests');
  console.log('Endpoint:', CLASSIFY_URL);
  console.log('');

  for (const message of TEST_MESSAGES) {
    process.stdout.write(`"${message.slice(0, 50)}${message.length > 50 ? '…' : ''}" → `);
    try {
      const result = await classify(message);
      if (result.error) {
        console.log('ERROR:', result.error);
        continue;
      }
      const { intent } = result;
      if (!intent) {
        console.log('(no intent)');
        continue;
      }
      console.log(
        `requires_call=${intent.requires_call} domain=${intent.domain} task=${intent.task} confidence=${intent.confidence?.toFixed(2) ?? '?'}`
      );
      if (intent.reasoning) console.log(`  reasoning: ${intent.reasoning.slice(0, 80)}…`);
    } catch (err) {
      console.log('FAIL:', err.message);
    }
  }

  console.log('\nDone.');
}

main();
