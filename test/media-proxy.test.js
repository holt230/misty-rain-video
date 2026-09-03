import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { pipeWebResponse, readWebResponseText } from '../server/http.js';
import { fetchWithResponseHeaderTimeout, QuarkGateway } from '../server/quarkGateway.js';

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

class ResponseSink extends EventEmitter {
  constructor() {
    super();
    this.statusCode = 0;
    this.headers = new Map();
    this.chunks = [];
    this.destroyed = false;
    this.writableEnded = false;
  }

  setHeader(name, value) {
    this.headers.set(String(name).toLowerCase(), value);
  }

  write(chunk) {
    this.chunks.push(Buffer.from(chunk));
    return true;
  }

  end(chunk) {
    if (chunk) this.chunks.push(Buffer.from(chunk));
    this.writableEnded = true;
  }

  destroy(error) {
    this.destroyed = true;
    this.destroyError = error;
  }
}

test('媒体响应头到达后不会被固定总时长中断', async () => {
  let index = 0;
  let requestSignal;
  const chunks = ['slow-', 'anime-', 'segment'];
  const upstream = await fetchWithResponseHeaderTimeout(async (_input, { signal }) => {
    requestSignal = signal;
    return new Response(new ReadableStream({
      async pull(controller) {
        if (index >= chunks.length) {
          controller.close();
          return;
        }
        await delay(12);
        controller.enqueue(new TextEncoder().encode(chunks[index++]));
      }
    }));
  }, 'https://media.example.test/segment', {}, 5);

  assert.equal(await upstream.text(), 'slow-anime-segment');
  assert.equal(requestSignal.aborted, false);
});

test('等待媒体响应头超过限制时返回超时', async () => {
  await assert.rejects(
    fetchWithResponseHeaderTimeout((_input, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }), 'https://media.example.test/slow-header', {}, 10),
    error => error?.name === 'TimeoutError'
  );
});

test('媒体网关正确转发 Range 与 HEAD 请求', async () => {
  const originalFetch = globalThis.fetch;
  let capturedRequest;
  globalThis.fetch = async (input, init) => {
    capturedRequest = { input, init };
    return new Response(null, {
      status: 206,
      headers: { 'content-range': 'bytes 0-99/1000' }
    });
  };
  const gateway = new QuarkGateway({
    credentialStore: { getCookie: () => '' }
  });

  try {
    const response = await gateway.fetchMedia(
      'https://media.example.test/video',
      'bytes=0-99',
      'tv',
      '',
      { method: 'HEAD' }
    );
    assert.equal(response.status, 206);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(capturedRequest.input, 'https://media.example.test/video');
  assert.equal(capturedRequest.init.method, 'HEAD');
  assert.equal(capturedRequest.init.headers.Range, 'bytes=0-99');
});

test('分片总耗时超过空闲限制仍可持续流式传输', async () => {
  let index = 0;
  const chunks = ['a', 'b', 'c', 'd'];
  const upstream = new Response(new ReadableStream({
    async pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      await delay(12);
      controller.enqueue(new TextEncoder().encode(chunks[index++]));
    }
  }), {
    headers: {
      'content-length': String(chunks.length),
      'content-type': 'video/mp4'
    }
  });
  const response = new ResponseSink();

  const result = await pipeWebResponse(upstream, response, { idleTimeoutMs: 20 });

  assert.equal(Buffer.concat(response.chunks).toString(), 'abcd');
  assert.equal(response.headers.get('content-length'), '4');
  assert.equal(response.writableEnded, true);
  assert.equal(response.destroyed, false);
  assert.equal(result.bytes, 4);
  assert.ok(result.durationMs >= 40);
});

test('分片持续无数据时取消上游并中止下游', async () => {
  const upstream = new Response(new ReadableStream({
    pull() {
      return new Promise(() => {});
    }
  }), {
    headers: { 'content-type': 'video/mp4' }
  });
  const response = new ResponseSink();

  await assert.rejects(
    pipeWebResponse(upstream, response, { idleTimeoutMs: 10 }),
    error => error?.code === 'STREAM_IDLE_TIMEOUT'
  );
  assert.equal(response.destroyed, true);
  assert.equal(response.destroyError?.code, 'STREAM_IDLE_TIMEOUT');
});

test('HLS 清单响应体无数据时不会无限等待', async () => {
  const upstream = new Response(new ReadableStream({
    pull() {
      return new Promise(() => {});
    }
  }), {
    headers: { 'content-type': 'application/vnd.apple.mpegurl' }
  });

  await assert.rejects(
    readWebResponseText(upstream, { idleTimeoutMs: 10 }),
    error => error?.code === 'STREAM_IDLE_TIMEOUT'
  );
});

test('客户端退出时立即取消仍在读取的上游分片', async () => {
  let upstreamCancelled = false;
  const upstream = new Response(new ReadableStream({
    pull() {
      return new Promise(() => {});
    },
    cancel() {
      upstreamCancelled = true;
    }
  }), {
    headers: { 'content-type': 'video/mp4' }
  });
  const response = new ResponseSink();

  const piping = pipeWebResponse(upstream, response, { idleTimeoutMs: 1_000 });
  response.emit('close');
  const result = await piping;

  assert.equal(upstreamCancelled, true);
  assert.equal(response.writableEnded, false);
  assert.equal(response.destroyed, false);
  assert.equal(result.bytes, 0);
});
