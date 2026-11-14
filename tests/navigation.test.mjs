import test from 'node:test';
import assert from 'node:assert/strict';
import { readRoute, routeHash } from '../apps/web/src/lib/navigation.ts';
test('shared links round-trip a company or business theme',()=>{
  assert.deepEqual(readRoute(routeHash('research','BRK.B')),{page:'research',symbol:'BRK.B',theme:''});
  assert.deepEqual(readRoute(routeHash('market-map','','power')),{page:'market-map',symbol:'',theme:'power'});
});
test('unknown or malformed links recover to a valid page without accepting arbitrary ticker text',()=>{
  assert.equal(readRoute('#unknown').page,'dashboard');
  assert.equal(readRoute('#research?symbol=%3Cscript%3E').symbol,'');
  assert.equal(readRoute('#market-map?theme=../../').theme,'');
});
