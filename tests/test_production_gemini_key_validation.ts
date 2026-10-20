import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

console.log('--- RUNNING REGRESSION TESTS: Production Gemini API Key Validation (AH.64) ---');

// 1. Static AST / Code Inspection of server.ts
const serverTsPath = path.resolve('server.ts');
const serverContent = fs.readFileSync(serverTsPath, 'utf8');

// Verify validateGeminiApiKey is exported and defined exactly as required
assert.ok(serverContent.includes('export function validateGeminiApiKey(rawKey?: string | null): string {'), 'server.ts must export validateGeminiApiKey');
assert.ok(serverContent.includes('/[^\\x20-\\x7E]/.test(apiKey)'), 'server.ts must use printable-ASCII regex /[^\\x20-\\x7E]/');
assert.ok(serverContent.includes('validateGeminiApiKey(process.env.GEMINI_API_KEY)'), 'server.ts must invoke validateGeminiApiKey inside models getter');

// Verify the initialization path: GoogleGenAI constructor must receive validated key
const modelsGetterRegex = /get\s+models\(\)\s*\{[\s\S]*?validateGeminiApiKey\(process\.env\.GEMINI_API_KEY\)[\s\S]*?new\s+GoogleGenAI\(\{\s*apiKey\s*\}\)/;
assert.ok(modelsGetterRegex.test(serverContent), 'GoogleGenAI constructor must be guarded by validateGeminiApiKey');

// Dynamically extract and evaluate validateGeminiApiKey function logic directly from server.ts
const funcMatch = serverContent.match(/export function validateGeminiApiKey[\s\S]*?\n\}/);
assert.ok(funcMatch, 'Could not extract validateGeminiApiKey from server.ts');

const extractedCode = funcMatch[0]
  .replace('export function validateGeminiApiKey(rawKey?: string | null): string {', 'function validateGeminiApiKey(rawKey) {');
const validateGeminiApiKey = new Function(extractedCode + '; return validateGeminiApiKey;')();

// Test 1: Valid clean printable-ASCII key is accepted and returned
{
  const cleanKey = 'AIzaSyA-ExampleKey_1234567890Test';
  const result = validateGeminiApiKey(cleanKey);
  assert.equal(result, cleanKey, 'Valid key should be returned unchanged');
  console.log('? PASS: Clean printable-ASCII key is accepted');
}

// Test 2: Surrounding whitespace is safely trimmed
{
  const rawWithPadding = '  AIzaSyA-TrimmedKey_9876543210   ';
  const result = validateGeminiApiKey(rawWithPadding);
  assert.equal(result, 'AIzaSyA-TrimmedKey_9876543210', 'Surrounding whitespace should be trimmed');
  console.log('? PASS: Surrounding whitespace is trimmed safely');
}

// Test 3: Missing, null, or undefined credential throws required error
{
  assert.throws(
    () => validateGeminiApiKey(undefined),
    {
      name: 'Error',
      message: 'GEMINI_API_KEY environment variable is required to use the Gemini API.'
    },
    'undefined key must throw missing error'
  );

  assert.throws(
    () => validateGeminiApiKey(null),
    {
      name: 'Error',
      message: 'GEMINI_API_KEY environment variable is required to use the Gemini API.'
    },
    'null key must throw missing error'
  );

  assert.throws(
    () => validateGeminiApiKey(''),
    {
      name: 'Error',
      message: 'GEMINI_API_KEY environment variable is required to use the Gemini API.'
    },
    'empty string must throw missing error'
  );
  console.log('? PASS: Missing/null/empty credentials rejected safely');
}

// Test 4: Whitespace-only credential throws required error after trimming
{
  assert.throws(
    () => validateGeminiApiKey('   \t  \n  '),
    {
      name: 'Error',
      message: 'GEMINI_API_KEY environment variable is required to use the Gemini API.'
    },
    'whitespace-only string must throw missing error'
  );
  console.log('? PASS: Whitespace-only credential rejected safely');
}

// Test 5: Internal newline characters (CR, LF, CRLF) are rejected
{
  const malformedCases = [
    'AIzaSy\nTestKey',
    'AIzaSy\rTestKey',
    'AIzaSy\r\nTestKey'
  ];

  for (const badKey of malformedCases) {
    assert.throws(
      () => validateGeminiApiKey(badKey),
      {
        name: 'Error',
        message: 'Configured GEMINI_API_KEY contains invalid header characters.'
      },
      'Newline characters must be rejected'
    );
  }
  console.log('? PASS: Internal LF, CR, CRLF rejected as invalid header characters');
}

// Test 6: Control characters (NUL, internal tab, DEL 0x7F, ESC) are rejected
{
  const controlCases = [
    'AIzaSy\0TestKey',
    'AIzaSy\tTestKey',
    'AIzaSy' + String.fromCharCode(0x7F) + 'TestKey',
    'AIzaSy' + String.fromCharCode(0x1B) + 'TestKey'
  ];

  for (const badKey of controlCases) {
    assert.throws(
      () => validateGeminiApiKey(badKey),
      {
        name: 'Error',
        message: 'Configured GEMINI_API_KEY contains invalid header characters.'
      },
      'Control characters must be rejected'
    );
  }
  console.log('? PASS: NUL, tab, DEL, ESC rejected as invalid header characters');
}

// Test 7: Extended Latin-1 (0x80 - 0xFF) and non-ASCII Unicode (> 0xFF) are rejected
{
  const unicodeCases = [
    'AIzaSy\u00E9TestKey', // é (Latin-1)
    'AIzaSy\u00A0TestKey', // Non-breaking space
    'AIzaSy\u201CTestKey', // Smart quote “
    'AIzaSy\u2014TestKey', // Em-dash —
    'AIzaSy\uD83D\uDD11TestKey' // Emoji ??
  ];

  for (const badKey of unicodeCases) {
    assert.throws(
      () => validateGeminiApiKey(badKey),
      {
        name: 'Error',
        message: 'Configured GEMINI_API_KEY contains invalid header characters.'
      },
      'Latin-1 and Unicode characters must be rejected'
    );
  }
  console.log('? PASS: Latin-1 and multibyte Unicode characters rejected');
}

// Test 8: Error message never echoes or leaks the credential payload
{
  const secretPattern = 'LEAK_SENSITIVE_PAYLOAD_TEST';
  try {
    validateGeminiApiKey('AIzaSy' + secretPattern + '\nMALFORMED');
    assert.fail('Should have thrown');
  } catch (err: any) {
    assert.ok(!err.message.includes(secretPattern), 'Error message must not contain any part of the credential');
    assert.equal(err.message, 'Configured GEMINI_API_KEY contains invalid header characters.');
  }
  console.log('? PASS: Error messages do not leak credential contents');
}

// Test 9: SDK bypass verification: Malformed key prevents GoogleGenAI instantiation
{
  let sdkInstantiated = false;
  class MockGoogleGenAI {
    constructor(opts: any) {
      sdkInstantiated = true;
    }
  }

  function simulateGetter(envKey: string | undefined) {
    const apiKey = validateGeminiApiKey(envKey);
    return new MockGoogleGenAI({ apiKey });
  }

  assert.throws(() => simulateGetter('AIzaSyBad\nKey'));
  assert.equal(sdkInstantiated, false, 'SDK must not be instantiated when validation fails');
  console.log('? PASS: GoogleGenAI SDK instantiation is bypassed upon validation failure');
}

console.log('--- ALL 9 REGRESSION TESTS PASSED SUCCESSFULLY ---');
