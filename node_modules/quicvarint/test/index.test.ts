import { describe, it, expect } from 'vitest'
import { MIN, MAX, decode, encode, length, read } from '../src'
import vectors from './fixtures/vectors.json'

// Tests taken from https://github.com/quic-go/quic-go/blob/09bb613c6679ba130e950214a178ded510741578/quicvarint/varint_test.go
// There are no test vectors on RFC 9000
// This is to confirm the implementation is working as expected

// Tests for limits
describe('Limits', () => {
    it('should have correct MIN and MAX values', () => {
        expect(MIN).toBe(0)
        expect(MAX).toBe((1 << 30) - 1 + (1 << 30))
    })
})

const hex_decode = (s: string): Uint8Array => {
    const matches = s.match(/.{1,2}/g)
    return Uint8Array.from(matches ?? [], (b) => parseInt(b, 16))
}

const tests = vectors.map((v) => ({
    ...v,
    bytes: hex_decode(v.bytes),
}))

// Tests for parsing
describe('Parsing', () => {
    tests.forEach(({ name, bytes: input, value: expected, length }) => {
        it(`should correctly parse ${name}`, () => {
            const result = decode(input)
            expect(result.value).toBe(expected)
            expect(result.usize).toBe(length)
        })
    })
})

// Tests for encoding
describe('Varint Encoding', () => {
    tests.forEach(({ name, value: input, bytes: expected, minimal_encoding, length }) => {
        it(`should correctly encode ${name}`, () => {
            if (minimal_encoding) {
                expect(encode(input)).toEqual(expected)
            }
            expect(encode(input, length)).toEqual(expected)
        })
    })

    it('should throw when encoding a too large number', () => {
        expect(() => encode(MAX + 1)).toThrow()
    })
})

// Tests for length
describe('Length', () => {
    tests
        .filter((t) => t.minimal_encoding)
        .forEach(({ name, value: input, length: expected }) => {
            it(`should return correct length for ${name}`, () => {
                expect(length(input)).toBe(expected)
            })
        })

    it('should throw on too large number', () => {
        expect(() => length(MAX + 1)).toThrow()
    })
})

// Tests for read() - DataView API
describe('Read', () => {
    tests.forEach(({ name, bytes, value: expected, length: expectedLength }) => {
        it(`should correctly read ${name}`, () => {
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
            const result = read(view, 0)
            expect(result.value).toBe(expected)
            expect(result.usize).toBe(expectedLength)
        })
    })

    it('should read from non-zero offset', () => {
        // prefix byte + 2-byte varint (15293 = 0x7bbd -> 0x3bbd with prefix 01)
        const data = new Uint8Array([0xff, 0x7b, 0xbd])
        const view = new DataView(data.buffer)
        const result = read(view, 1)
        expect(result.value).toBe(15293)
        expect(result.usize).toBe(2)
    })

    it('should throw on truncated 2-byte varint', () => {
        // 0x40 = prefix 01 (2-byte) but only 1 byte available
        const data = new Uint8Array([0x40])
        const view = new DataView(data.buffer)
        expect(() => read(view, 0)).toThrow()
    })

    it('should throw on truncated 4-byte varint', () => {
        // 0x80 = prefix 10 (4-byte) but only 2 bytes available
        const data = new Uint8Array([0x80, 0x00])
        const view = new DataView(data.buffer)
        expect(() => read(view, 0)).toThrow()
    })

    it('should throw on truncated 8-byte varint', () => {
        // 0xc0 = prefix 11 (8-byte) but only 4 bytes available
        const data = new Uint8Array([0xc0, 0x00, 0x00, 0x00])
        const view = new DataView(data.buffer)
        expect(() => read(view, 0)).toThrow()
    })
})

// Tests for encode() edge cases
describe('Encode edge cases', () => {
    it('should throw when len is too small for value', () => {
        // 1000 requires 2 bytes minimum, but we request 1
        expect(() => encode(1000, 1)).toThrow()
    })

    it('should throw when len is too small for 4-byte value', () => {
        // 16384 requires 4 bytes minimum
        expect(() => encode(16384, 2)).toThrow()
    })
})

// Tests for decode() edge cases
describe('Decode edge cases', () => {
    it('should decode 4-byte value with high bit in masked byte', () => {
        // 0x9f 0xff 0xff 0xff = (0x1f << 24) | 0xffffff = 536870911
        const input = new Uint8Array([0x9f, 0xff, 0xff, 0xff])
        const result = decode(input)
        expect(result.value).toBe(536870911)
        expect(result.value).toBeGreaterThan(0)
    })

    it('should throw on 8-byte value exceeding MAX (2^31-1)', () => {
        // 0xc0 00 00 00 80 00 00 00 = 2147483648 which is > MAX
        // This should throw, not return negative
        const input = new Uint8Array([0xc0, 0x00, 0x00, 0x00, 0x80, 0x00, 0x00, 0x00])
        expect(() => decode(input)).toThrow()
    })
})
