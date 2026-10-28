import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
async function urls(base, apiBase) {
  const result = await build({ entryPoints:['src/services/appUrl.ts'], bundle:true, write:false, format:'esm',
    define:{'import.meta.env':JSON.stringify({ BASE_URL:base, VITE_API_BASE_PATH:apiBase })} });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
}
test('normal deployments preserve API, static assets and native install links', async () => {
  for (const base of ['/', '/misty-rain/']) {
    const { withAppBase } = await urls(base);
    for (const path of ['api/auth/session','api/player/sessions/a/media','brand-mark.png','install/ios.mobileconfig']) assert.equal(withAppBase('/'+path), base+path);
    assert.equal(withAppBase(base+'api/catalog'),base+'api/catalog');
  }
});
test('a preview frontend shares authenticated media/subtitle/API URLs while retaining its own assets and installer',async()=>{
  const { withAppBase,apiUrl }=await urls('/misty-rain-preview/','/misty-rain/');
  for(const path of ['api/auth/session','api/player/sessions/a/media','api/player/subtitles/a','api/site/icon/180.png?v=1']) assert.equal(apiUrl('/'+path),'/misty-rain/'+path);
  for(const path of ['brand-mark.png','install/ios.mobileconfig']) assert.equal(apiUrl('/'+path),'/misty-rain-preview/'+path);
  assert.equal(withAppBase('/misty-rain/api/catalog'),'/misty-rain/api/catalog');
  assert.equal(withAppBase('/misty-rain-preview/brand-mark.png'),'/misty-rain-preview/brand-mark.png');
  for(const value of ['https://quark.example/signed?token=example','blob:https://video.test/abc','data:text/vtt,WEBVTT','#/watch/id','']) assert.equal(withAppBase(value),value);
});
test('API overrides cannot send login credentials to other origins or ambiguous paths',async()=>{
  for(const invalid of ['https://other.example/','//other.example/','/path/../','/path/?query','/path/#hash']) {
    const {apiUrl}=await urls('/preview/',invalid);assert.equal(apiUrl('/api/auth/login'),'/preview/api/auth/login');
  }
});
