# quicvarint

![License](https://img.shields.io/npm/l/quicvarint.svg)
[![crates.io](https://img.shields.io/npm/v/quicvarint.svg)][npm]

[npm]: https://www.npmjs.com/package/quicvarint

Variable-Length Integer Encoding defined by [RFC 9000](https://www.rfc-editor.org/rfc/rfc9000.html#name-variable-length-integer-enc).

## Tables of Content

* [Features](#features)
* [Usage](#usage)
* [Security Considerations](#security-considerations)
* [License](#license)

## Features

* Decode a 2-MSB varint from a DataView or a Uint8Array
* Encode a 2-MSB varint to a Uint8Array
* Support integer between 0 and 2147483647 included
* TypeScript types

## Usage

```typescript
import { encode, decode, MAX } from "quicvarint"

// A number between 0 and MAX
const n = 1234

// Encode it to a Uint8Array
const encN = encode(n)

// Decode it and print it on console
console.log(decode(encN))
```

## Security Considerations

This software has not been audited. Please use at your sole discretion.

## License

This project is under the MIT license.

### Contribution

Unless you explicitly state otherwise, any contribution intentionally submitted for inclusion in the work by you shall be MIT licensed as above, without any additional terms or conditions.
