import { describe, bench } from 'vitest'
import { decode, encode, read } from '../src'

// Tests taken from https://github.com/quic-go/quic-go/blob/09bb613c6679ba130e950214a178ded510741578/quicvarint/varint_test.go
// There are no test vectors on RFC 9000
// This is to confirm the implementation is working as expected

const MAX_VARINT_1 = 0x3f
const MAX_VARINT_2 = 0x3fff
const MAX_VARINT_4 = 0x3fffffff
const MAX_VARINT_8 = 0x7fffffff

const tests = [
    { name: '1 byte', input: MAX_VARINT_1 },
    { name: '2 byte', input: MAX_VARINT_2 },
    { name: '4 byte', input: MAX_VARINT_4 },
    { name: '8 byte', input: MAX_VARINT_8 },
]

const randomValues = (num: number, maxValue: number) => {
    const values = new Array<{ v: number; b: Uint8Array }>()
    for (let i = 0; i < num; i++) {
        const v = Math.floor(Math.random() * maxValue)
        values.push({ v, b: encode(v) })
    }
    return values
}

describe('Benchmarking 1024 read', () => {
    tests.forEach(({ name, input }) => {
        const inputs = randomValues(1024, input).map((v) => new DataView(v.b.buffer))
        bench(name, () => {
            for (const input of inputs) {
                read(input, 0)
            }
        })
    })
})

describe('Benchmarking 1024 encode', () => {
    tests.forEach(({ name, input }) => {
        const inputs = randomValues(1024, input)
        bench(name, () => {
            for (const input of inputs) {
                encode(input.v)
            }
        })
    })
})

describe('Benchmarking 1024 decode', () => {
    tests.forEach(({ name, input }) => {
        const inputs = randomValues(1024, input)
        bench(name, () => {
            for (const input of inputs) {
                decode(input.b)
            }
        })
    })
})
