/**
 * OHTTP (Oblivious HTTP, RFC 9458) client for encrypting service
 * requests and decrypting responses using HPKE.
 *
 * Wraps the `ohttp-ts` library by Thibault Meunier (Cloudflare).
 */
/** Configuration for enabling OHTTP. `true` uses defaults; an object allows custom relay/key config. */
export type OhttpOption = boolean | {
    relayUrl?: string;
    publicKeyConfig?: Uint8Array;
};
/**
 * OHTTP client that encrypts requests and decrypts responses.
 *
 * Fetches the server's HPKE key config from `GET /ohttp-keys`
 * and uses it to encapsulate requests as `message/ohttp-req`.
 */
export declare class OhttpClient {
    private readonly gatewayUrl;
    private ohttpClient;
    private readonly pinnedKeyConfig;
    /**
     * @param gatewayUrl - URL where the OHTTP gateway accepts encapsulated requests
     *   and serves `/ohttp-keys`. May include a reverse-proxy path prefix (e.g.
     *   `https://api.example.com/discovery`); the prefix is preserved on outer
     *   requests but stripped from the inner OHTTP request path (which always
     *   uses just the supplied per-call `path`).
     *   Must be HTTPS in production — without it (or a pinned `publicKeyConfig`),
     *   an active network attacker can replace the OHTTP key config.
     * @param options.relayUrl - Optional OHTTP relay URL. When set, encapsulated
     *   requests are sent here instead of the gateway. `/ohttp-keys` is still
     *   fetched from `gatewayUrl`.
     * @param options.publicKeyConfig - Optional pinned key config bytes
     *   (`application/ohttp-keys` format). When set, `/ohttp-keys` is never fetched.
     */
    constructor(gatewayUrl: string, options?: {
        relayUrl?: string;
        publicKeyConfig?: Uint8Array;
    });
    private relayUrl?;
    /**
     * Send an OHTTP-encapsulated GET request and return the decrypted JSON response.
     */
    get<T>(path: string): Promise<T>;
    /**
     * Send an OHTTP-encapsulated POST request and return the decrypted JSON response.
     */
    post<T>(path: string, body: unknown): Promise<T>;
    private send;
    /** Fetch (or use pinned) key config and create the OHTTPClient. */
    private ensureClient;
    private invalidate;
}
//# sourceMappingURL=ohttp-client.d.ts.map