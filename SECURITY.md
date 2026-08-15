# Security

## Reporting

Please report vulnerabilities through
[GitHub's private vulnerability reporting](../../security/advisories/new) on
this repository rather than in a public issue. Include the capture, pointer,
or input that triggers the problem when you can — every parser in this repo
has a host-side test harness, so a reproducing artifact is the fastest path
to a fix.

## Security model, in brief

Things this project deliberately does and does not do:

- **The firmware holds no keys.** The Shelby pointer's `encrypted` flag is a
  claim the radio heard; decryption happens where the channel key lives,
  which is never the analyzer.
- **Untrusted bytes are verified before use.** A Shelby pointer is a claim
  about remote content. `scripts/shelby_pointer.py verify` enforces the
  commitment, size, and expiry before resolved bytes are served or analyzed.
- **Parsers reject rather than repair.** Both wire formats (`.lscap`,
  `SHLB`) are decoded with explicit length and consistency checks, and the
  C++ implementations are tested under AddressSanitizer and
  UndefinedBehaviorSanitizer with malformed-input cases.
- **Unknown frames stay raw.** Decoders add only the meaning they can prove;
  unknown or encrypted payloads are preserved as bytes, never guessed at.
- **Web API is read-mostly.** The deployed app proxies to a network indexer;
  it does not custody keys or sign transactions. Wallet interactions happen
  client-side through the standard Aptos wallet adapter.
