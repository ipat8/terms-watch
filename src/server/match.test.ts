import assert from 'node:assert/strict';
import { buildMatchers, findMatches, parseNameList, parseTerms } from './match.ts';

assert.deepEqual(parseTerms('["sublink", "gift code", "Sublink"]'), ['sublink', 'gift code']);
assert.deepEqual(parseTerms('sublink, gift code\ngiveaway'), ['sublink', 'gift code', 'giveaway']);
assert.deepEqual(parseTerms(''), []);

const m = buildMatchers(['sublink', 'gift code', 'giveaway', 'c++'], { wholeWord: true, caseSensitive: false });
assert.deepEqual(findMatches('Got a Gift Code from the GIVEAWAY', m), ['gift code', 'giveaway']);
assert.deepEqual(findMatches('sublinked', m), []);
assert.deepEqual(findMatches('check sublink.gg', m), ['sublink']);
assert.deepEqual(findMatches('I write c++ daily', m), ['c++']);

const cs = buildMatchers(['Widget'], { wholeWord: true, caseSensitive: true });
assert.deepEqual(findMatches('widget', cs), []);
assert.deepEqual(findMatches('Widget', cs), ['Widget']);

assert.ok(parseNameList('AutoModerator, u/SomeBot').has('somebot'));

console.log('all match tests passed');
