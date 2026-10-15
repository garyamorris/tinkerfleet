import test from 'node:test';
import assert from 'node:assert/strict';
import {safeSources} from '../src/server/sources.js';
test('citations retain bounded public HTTP links and reject executable, credentialed or malformed URLs',()=>{
 const sources=safeSources([{url:'https://example.com/article',title:'Example'},{url:'javascript:alert(1)',title:'Bad'},{url:'https://user:pass@example.com',title:'Bad'},{url:'https://example.com/article',title:'Duplicate'},{url:'https://example.com/with space',title:'Bad'},{url:'http://example.org',title:'x'.repeat(400)}]);
 assert.deepEqual(sources,[{url:'https://example.com/article',title:'Example'},{url:'http://example.org/',title:'x'.repeat(300)}]);assert.equal(safeSources(Array.from({length:30},(_,i)=>({url:`https://example.com/${i}`,title:'Example'}))).length,20);
});

test('inline source offsets are bounded to emitted text and repeated sources retain separate claim locations',()=>{
 const link={url:'https://example.com',title:'Evidence'};const sources=safeSources([{...link,startIndex:0,endIndex:3},{...link,startIndex:4,endIndex:8},{...link,startIndex:0,endIndex:3},{...link,startIndex:-1,endIndex:90}], 'one two!');
 assert.equal(sources.length,3);assert.deepEqual(sources.map(s=>[s.startIndex,s.endIndex]),[[0,3],[4,8],[undefined,undefined]]);
});
