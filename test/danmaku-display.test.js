import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const folder=fs.mkdtempSync('.local-runtime/danmaku-display-');
const outfile=path.resolve(folder,'display.mjs');
await build({entryPoints:['src/services/danmakuDisplay.ts'],outfile,bundle:true,format:'esm',logLevel:'silent'});
const {displayComments}=await import(pathToFileURL(outfile));
test.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
test('dense mode is visibly fuller than sparse mode while bursts remain bounded and font choice is preserved',()=>{
 const comments=Array.from({length:1000},(_,i)=>({time:i/1000,text:`弹幕${i}`,color:'#fff',mode:'rtl'}));
 assert.equal(displayComments(comments,'low',0).length,1);const dense=displayComments(comments,'normal',0,22);assert.equal(dense.length,6);assert.ok(dense.every(c=>c.style.fontSize==='22px'));
 assert.equal(displayComments([{...comments[0],time:-1},comments[0],comments[0]],'normal',0).length,1);
});
