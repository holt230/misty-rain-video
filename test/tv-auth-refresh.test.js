import test from 'node:test';
import assert from 'node:assert/strict';
import {TvPlaybackClient} from '../server/tvPlaybackClient.js';
const setup=()=>{let auth={deviceId:'test-device',refreshToken:'refresh-old',accessToken:'access-old',expiresAt:Date.now()+3600000},cleared=0;const store={getTvAuth:()=>({...auth}),saveTvAuth:value=>{auth={...value}},clearTvAuth:()=>{cleared++;auth={}}};return{client:new TvPlaybackClient(store),get auth(){return auth},get cleared(){return cleared}}};
const ok=url=>Response.json({status:200,errno:0,data:new URL(url).pathname==='/user'?{nickname:'test'}:{video_info:[{url:'https://media.example/video.mp4',resolution:'high'}]}});
test('expired access responses refresh once across concurrent calls and keep long-lived credentials',async t=>{
 const f=setup();let exchanges=0,oldCalls=0,newCalls=0;
 t.mock.method(globalThis,'fetch',async(input,options)=>{
  const url=new URL(input);
  if(url.hostname==='api.extscreen.com'){exchanges++;assert.equal(JSON.parse(options.body).refresh_token,'refresh-old');await Promise.resolve();return Response.json({code:200,data:{access_token:'access-new',refresh_token:'refresh-new',expires_in:3600}})}
  if(url.searchParams.get('access_token')==='access-old'){oldCalls++;return Response.json({status:401,errno:10001,error_info:'access_token invalid'},{status:401})}
  newCalls++;assert.equal(url.searchParams.get('access_token'),'access-new');return ok(url);
 });
 const [status,streams]=await Promise.all([f.client.getStatus(),f.client.getStreaming('episode')]);
 assert.equal(status.isAuthenticated,true);assert.equal(streams.video_list.length,1);assert.equal(exchanges,1);assert.equal(oldCalls,2);assert.equal(newCalls,2);assert.equal(f.cleared,0);assert.equal(f.auth.refreshToken,'refresh-new');
});
test('token exchange failures never erase refresh credentials',async t=>{
 const f=setup();t.mock.method(globalThis,'fetch',async input=>new URL(input).hostname==='api.extscreen.com'?Response.json({code:500,message:'temporarily unavailable'},{status:503}):Response.json({status:401,errno:11001},{status:401}));
 await assert.rejects(f.client.getStreaming('episode'),{code:'TV_TOKEN_EXCHANGE_FAILED'});assert.equal(f.auth.refreshToken,'refresh-old');assert.equal(f.cleared,0);
});
test('a provider rejecting the refreshed access token stops after one retry without clearing auth',async t=>{
 const f=setup();let exchanges=0,requests=0;t.mock.method(globalThis,'fetch',async input=>{
  if(new URL(input).hostname==='api.extscreen.com'){exchanges++;return Response.json({code:200,data:{access_token:'access-new',refresh_token:'refresh-new',expires_in:3600}})}
  requests++;return Response.json({status:401,errno:10001},{status:401});
 });
 await assert.rejects(f.client.getStreaming('episode'),{code:'QUARK_AUTH_REQUIRED'});assert.equal(exchanges,1);assert.equal(requests,2);assert.equal(f.cleared,0);assert.equal(f.auth.refreshToken,'refresh-new');
});
