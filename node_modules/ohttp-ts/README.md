# ohttp-ts

[![NPM](https://img.shields.io/npm/v/ohttp-ts?style=flat-square)](https://www.npmjs.com/package/ohttp-ts)
[![License](https://img.shields.io/npm/l/ohttp-ts?style=flat-square)](LICENSE)

TypeScript implementation of [Oblivious HTTP (RFC 9458)](https://www.rfc-editor.org/rfc/rfc9458.html) with streaming support.

## Features

- **RFC 9458** - Oblivious HTTP
- **Chunked OHTTP** - Streaming extension ([draft-ietf-ohai-chunked-ohttp-08](https://www.ietf.org/archive/id/draft-ietf-ohai-chunked-ohttp-08.txt))
- **WebCrypto** - Works in browsers, Cloudflare Workers, Node.js 24+

## Installation

```bash
npm install ohttp-ts hpke
```

Or via CDN (no install):

```javascript
import { KeyConfig, OHTTPClient, OHTTPServer } from "https://esm.sh/ohttp-ts";
import { CipherSuite, KEM_DHKEM_X25519_HKDF_SHA256, KDF_HKDF_SHA256, AEAD_AES_128_GCM } from "https://esm.sh/hpke";
```

## Quick Start

```typescript
import { CipherSuite, KEM_DHKEM_X25519_HKDF_SHA256, KDF_HKDF_SHA256, AEAD_AES_128_GCM } from "hpke";
import { KeyConfig, OHTTPClient, OHTTPServer, KdfId, AeadId } from "ohttp-ts";

// Gateway: generate key configuration
const suite = new CipherSuite(KEM_DHKEM_X25519_HKDF_SHA256, KDF_HKDF_SHA256, AEAD_AES_128_GCM);
const keyConfig = await KeyConfig.generate(suite, 0x01, [
  { kdfId: KdfId.HKDF_SHA256, aeadId: AeadId.AES_128_GCM },
]);
const gateway = new OHTTPServer([keyConfig]);

// Client: fetch and parse gateway's public key
const publicKeyBytes = KeyConfig.serialize(keyConfig);
const clientKeyConfig = KeyConfig.parse(publicKeyBytes);
const client = new OHTTPClient(suite, clientKeyConfig);

// Client: encapsulate HTTP request
const httpRequest = new Request("https://target.example/api", {
  method: "POST",
  body: JSON.stringify({ data: "sensitive" }),
});
const { init, context } = await client.encapsulateRequest(httpRequest);

// Send to relay
const relayResponse = await fetch("https://relay.example/ohttp", init);

// Gateway: decapsulate request (received from relay)
const { request: innerRequest, context: serverContext } = await gateway.decapsulateRequest(relayRequest);
// relayRequest is what the relay receives and forwards to the gateway
// innerRequest is the original Request object

// Gateway: encapsulate response
const httpResponse = new Response(JSON.stringify({ result: "ok" }), { status: 200 });
const encapsulatedResponse = await serverContext.encapsulateResponse(httpResponse);

// Client: decapsulate response
const innerResponse = await context.decapsulateResponse(relayResponse);
// innerResponse is the original Response object
```

### Protocol Flow

```
+---------+       +-------+       +---------+    +--------+
| Client  |       | Relay |       | Gateway |    | Target |
+---------+       +-------+       +---------+    +--------+
     |                |                |             |
     | Encapsulated   |                |             |
     | Request        |                |             |
     +--------------->| Forward        |             |
     |                +--------------->| Decrypt &   |
     |                |                | Forward     |
     |                |                +------------>|
     |                |                |             |
     |                |                |<------------+
     |                |                | Encrypt     |
     |                |<---------------+ Response    |
     |<---------------+                |             |
     | Decapsulated   |                |             |
     | Response       |                |             |
```

## Binary HTTP

OHTTP encapsulates [Binary HTTP (RFC 9292)](https://www.rfc-editor.org/rfc/rfc9292.html) messages. The high-level API (`encapsulateRequest`, `decapsulateRequest`, etc.) handles encoding automatically.

For advanced use cases, the low-level bytes API is also available:

```typescript
// Low-level API: work with raw Binary HTTP bytes
const { encapsulatedRequest, context } = await client.encapsulate(binaryHttpBytes);
const { request: binaryBytes, context: serverCtx } = await gateway.decapsulate(encapsulatedRequest);
```

See [`examples/bhttp.example.ts`](examples/bhttp.example.ts) for a complete example.

### Chunked OHTTP (Streaming)

Use chunked OHTTP when:
- **Large payloads** (>1MB) that would exceed memory limits
- **Incremental sources** - data arrives over time (file uploads, network streams)
- **Early processing** - need to start processing before full body arrives
- **Memory-constrained** - Workers (128MB), mobile, edge

Use normal OHTTP when:
- **Small payloads** (<100KB)
- **Need full body** - JSON.parse(), image processing, etc.
- **Latency-sensitive** - streaming has async overhead

```typescript
// Normal: ~3x payload memory, faster for in-memory data
const client = new OHTTPClient(suite, keyConfig);

// Chunked: ~64KB constant memory, better for large/streaming data
const client = new ChunkedOHTTPClient(suite, keyConfig);
```

For streaming large requests/responses, use `ChunkedOHTTPClient`/`ChunkedOHTTPServer`:

```typescript
import { ChunkedOHTTPClient, ChunkedOHTTPServer } from "ohttp-ts";

// Setup (same key configuration as above)
const gateway = new ChunkedOHTTPServer([keyConfig]);
const client = new ChunkedOHTTPClient(suite, keyConfig);

// Client: encapsulate streaming request
const streamingRequest = new Request("https://target.example/upload", {
  method: "POST",
  body: largeReadableStream,
  // @ts-expect-error - required for streaming bodies in Node.js
  duplex: "half",
});
const { init, context } = await client.encapsulateRequest(streamingRequest);

// Send to relay (init includes duplex: "half" for streaming)
const relayResponse = await fetch("https://relay.example/ohttp", init);

// Gateway: decapsulate (body streams through)
// relayRequest is what the relay receives and forwards to the gateway
const { request: innerRequest, context: serverContext } =
  await gateway.decapsulateRequest(relayRequest);

// Process body incrementally
for await (const chunk of innerRequest.body!) {
  // Process chunk without buffering entire body
}

// Gateway: stream response back
const streamingResponse = new Response(responseStream, { status: 200 });
const encapsulatedResponse = await serverContext.encapsulateResponse(streamingResponse);

// Client: decapsulate and consume streaming response
const finalResponse = await context.decapsulateResponse(relayResponse);
for await (const chunk of finalResponse.body!) {
  // Process chunk as it arrives
}
```

**Note**: Request/Response bodies stream through without full buffering. Only the BHTTP preamble (method/status, headers) is buffered before the body can flow.

For the low-level bytes API, see [`examples/chunked.example.ts`](examples/chunked.example.ts).

## Examples

| Example | Description |
|---------|-------------|
| [`ohttp.example.ts`](examples/ohttp.example.ts) | Basic OHTTP round-trip |
| [`chunked-http.example.ts`](examples/chunked-http.example.ts) | Streaming Request/Response API |
| [`chunked.example.ts`](examples/chunked.example.ts) | Low-level bytes API |
| [`bhttp.example.ts`](examples/bhttp.example.ts) | Request/Response API (non-streaming) |
| [`mlkem.example.ts`](examples/mlkem.example.ts) | Post-quantum with ML-KEM-768 |

## Post-Quantum Support

For post-quantum key encapsulation (ML-KEM), use `@panva/hpke-noble`:

```bash
npm install @panva/hpke-noble
```

```typescript
import { CipherSuite } from "hpke";
import { KEM_ML_KEM_768, KDF_HKDF_SHA256, AEAD_AES_128_GCM } from "@panva/hpke-noble";

const suite = new CipherSuite(KEM_ML_KEM_768, KDF_HKDF_SHA256, AEAD_AES_128_GCM);
// Use with KeyConfig.generate(), OHTTPClient, OHTTPServer as usual
```

## Security Considerations

**Not audited.** Use at your own risk.

- **Replay protection** is out of scope (RFC 9458 Section 6.5)
- **Decryption errors are opaque** to prevent oracle attacks

## License

MIT
