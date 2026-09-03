#include "lilyshark/crypto/ed25519.h"

#include <cstring>

namespace lilyshark {
namespace crypto {
namespace {

// Provenance: this is the crypto_sign (Ed25519) and crypto_hash (SHA-512)
// portion of TweetNaCl version 20140427 (tweetnacl.cr.yp.to), placed in the
// public domain by its authors Daniel J. Bernstein, Bernard van Gastel, Wesley
// Janssen, Tanja Lange, Peter Schwabe and Sjaak Smetsers. The translation to
// house style renames the one-letter helpers and swaps macros for loops, but
// every arithmetic operation and its ordering is kept identical to the
// original so that the code can be audited line-by-line against it.
//
// Two deliberate deviations from the original, both behaviour-preserving:
//
//  - Negative left shifts (`c << 16` in the carry chain, `carry << 8` in the
//    scalar reduction) are undefined before C++20; the equivalent
//    multiplications are defined and compile to the same instruction. The
//    vendored curve25519.cpp makes the same substitution.
//  - SHA-512 is incremental here instead of TweetNaCl's one-shot
//    crypto_hash(), because crypto_sign() otherwise needs a scratch buffer as
//    large as the message. Adverts are small, but the same signer will hash
//    longer payloads later and a 184-byte packet buffer on the LVGL loop
//    task's stack is not worth the copy.
//
// MeshCore's own nodes run orlp/ed25519 rather than TweetNaCl. The two agree
// by construction: both implement RFC 8032, both clamp a SHA-512-expanded seed
// to the same bit pattern (TweetNaCl clears bit 255 then sets bit 254, orlp
// clears bits 254-255 then sets 254 — the same result), and Ed25519
// signatures are deterministic, so identical inputs give identical bytes. The
// golden advert vector in test/meshcore_tx pins that agreement.

using i64 = std::int64_t;
using u64 = std::uint64_t;

// ---------------------------------------------------------------------------
// SHA-512
// ---------------------------------------------------------------------------

constexpr std::size_t kSha512BlockSize = 128;
constexpr std::size_t kSha512DigestSize = 64;

constexpr u64 kRoundConstants[80] = {
    0x428a2f98d728ae22ULL, 0x7137449123ef65cdULL, 0xb5c0fbcfec4d3b2fULL, 0xe9b5dba58189dbbcULL,
    0x3956c25bf348b538ULL, 0x59f111f1b605d019ULL, 0x923f82a4af194f9bULL, 0xab1c5ed5da6d8118ULL,
    0xd807aa98a3030242ULL, 0x12835b0145706fbeULL, 0x243185be4ee4b28cULL, 0x550c7dc3d5ffb4e2ULL,
    0x72be5d74f27b896fULL, 0x80deb1fe3b1696b1ULL, 0x9bdc06a725c71235ULL, 0xc19bf174cf692694ULL,
    0xe49b69c19ef14ad2ULL, 0xefbe4786384f25e3ULL, 0x0fc19dc68b8cd5b5ULL, 0x240ca1cc77ac9c65ULL,
    0x2de92c6f592b0275ULL, 0x4a7484aa6ea6e483ULL, 0x5cb0a9dcbd41fbd4ULL, 0x76f988da831153b5ULL,
    0x983e5152ee66dfabULL, 0xa831c66d2db43210ULL, 0xb00327c898fb213fULL, 0xbf597fc7beef0ee4ULL,
    0xc6e00bf33da88fc2ULL, 0xd5a79147930aa725ULL, 0x06ca6351e003826fULL, 0x142929670a0e6e70ULL,
    0x27b70a8546d22ffcULL, 0x2e1b21385c26c926ULL, 0x4d2c6dfc5ac42aedULL, 0x53380d139d95b3dfULL,
    0x650a73548baf63deULL, 0x766a0abb3c77b2a8ULL, 0x81c2c92e47edaee6ULL, 0x92722c851482353bULL,
    0xa2bfe8a14cf10364ULL, 0xa81a664bbc423001ULL, 0xc24b8b70d0f89791ULL, 0xc76c51a30654be30ULL,
    0xd192e819d6ef5218ULL, 0xd69906245565a910ULL, 0xf40e35855771202aULL, 0x106aa07032bbd1b8ULL,
    0x19a4c116b8d2d0c8ULL, 0x1e376c085141ab53ULL, 0x2748774cdf8eeb99ULL, 0x34b0bcb5e19b48a8ULL,
    0x391c0cb3c5c95a63ULL, 0x4ed8aa4ae3418acbULL, 0x5b9cca4f7763e373ULL, 0x682e6ff3d6b2b8a3ULL,
    0x748f82ee5defb2fcULL, 0x78a5636f43172f60ULL, 0x84c87814a1f0ab72ULL, 0x8cc702081a6439ecULL,
    0x90befffa23631e28ULL, 0xa4506cebde82bde9ULL, 0xbef9a3f7b2c67915ULL, 0xc67178f2e372532bULL,
    0xca273eceea26619cULL, 0xd186b8c721c0c207ULL, 0xeada7dd6cde0eb1eULL, 0xf57d4f7fee6ed178ULL,
    0x06f067aa72176fbaULL, 0x0a637dc5a2c898a6ULL, 0x113f9804bef90daeULL, 0x1b710b35131c471bULL,
    0x28db77f523047d84ULL, 0x32caab7b40c72493ULL, 0x3c9ebe0a15c9bebcULL, 0x431d67c49c100d4cULL,
    0x4cc5d4becb3e42b6ULL, 0x597f299cfc657e2aULL, 0x5fcb6fab3ad6faecULL, 0x6c44198c4a475817ULL,
};

constexpr u64 kInitialState[8] = {
    0x6a09e667f3bcc908ULL, 0xbb67ae8584caa73bULL, 0x3c6ef372fe94f82bULL, 0xa54ff53a5f1d36f1ULL,
    0x510e527fade682d1ULL, 0x9b05688c2b3e6c1fULL, 0x1f83d9abfb41bd6bULL, 0x5be0cd19137e2179ULL,
};

u64 rotateRight(u64 value, int bits) noexcept
{
    return (value >> bits) | (value << (64 - bits));
}

u64 choose(u64 x, u64 y, u64 z) noexcept { return (x & y) ^ (~x & z); }
u64 majority(u64 x, u64 y, u64 z) noexcept { return (x & y) ^ (x & z) ^ (y & z); }
u64 bigSigma0(u64 x) noexcept { return rotateRight(x, 28) ^ rotateRight(x, 34) ^ rotateRight(x, 39); }
u64 bigSigma1(u64 x) noexcept { return rotateRight(x, 14) ^ rotateRight(x, 18) ^ rotateRight(x, 41); }
u64 smallSigma0(u64 x) noexcept { return rotateRight(x, 1) ^ rotateRight(x, 8) ^ (x >> 7); }
u64 smallSigma1(u64 x) noexcept { return rotateRight(x, 19) ^ rotateRight(x, 61) ^ (x >> 6); }

u64 readBigEndian64(const std::uint8_t *bytes) noexcept
{
    u64 value = 0;
    for (int index = 0; index < 8; ++index) {
        value = (value << 8) | bytes[index];
    }
    return value;
}

void writeBigEndian64(std::uint8_t *bytes, u64 value) noexcept
{
    for (int index = 7; index >= 0; --index) {
        bytes[index] = static_cast<std::uint8_t>(value & 0xffU);
        value >>= 8;
    }
}

/// Incremental SHA-512, private to this file. Ed25519 hashes three separate
/// runs (nonce prefix, R, public key, message) and only ever needs a digest,
/// so this stays local rather than becoming a second public hash API.
class Sha512
{
  public:
    Sha512() noexcept { reset(); }

    void reset() noexcept
    {
        for (int index = 0; index < 8; ++index) {
            state_[index] = kInitialState[index];
        }
        total_bytes_ = 0;
        buffered_ = 0;
    }

    void update(const std::uint8_t *data, std::size_t length) noexcept
    {
        total_bytes_ += length;
        while (length != 0) {
            const std::size_t room = kSha512BlockSize - buffered_;
            const std::size_t take = length < room ? length : room;
            std::memcpy(buffer_ + buffered_, data, take);
            buffered_ += take;
            data += take;
            length -= take;
            if (buffered_ == kSha512BlockSize) {
                compress(buffer_);
                buffered_ = 0;
            }
        }
    }

    void finish(std::uint8_t digest[kSha512DigestSize]) noexcept
    {
        // FIPS 180-4 pads with 0x80, then zeros, then a 128-bit big-endian bit
        // count. Messages here are far below 2^61 bytes, so the high half of
        // that count is always zero, but it is still written out in full.
        const u64 bit_count_low = total_bytes_ << 3;
        const u64 bit_count_high = total_bytes_ >> 61;

        std::uint8_t padding[2 * kSha512BlockSize]{};
        padding[0] = 0x80;
        const std::size_t tail = buffered_ + 1;
        const std::size_t padded = tail <= (kSha512BlockSize - 16) ? kSha512BlockSize
                                                                  : 2 * kSha512BlockSize;
        writeBigEndian64(padding + padded - 16 - buffered_, bit_count_high);
        writeBigEndian64(padding + padded - 8 - buffered_, bit_count_low);
        update(padding, padded - buffered_);

        for (int index = 0; index < 8; ++index) {
            writeBigEndian64(digest + 8 * index, state_[index]);
        }
    }

  private:
    void compress(const std::uint8_t block[kSha512BlockSize]) noexcept
    {
        u64 schedule[16];
        for (int index = 0; index < 16; ++index) {
            schedule[index] = readBigEndian64(block + 8 * index);
        }

        u64 working[8];
        for (int index = 0; index < 8; ++index) {
            working[index] = state_[index];
        }

        // TweetNaCl rotates the working registers by one slot each round
        // instead of naming them a..h; 80 rounds is a whole number of
        // eight-slot rotations, so they land back in order at the end.
        for (int round = 0; round < 80; ++round) {
            u64 next[8];
            for (int index = 0; index < 8; ++index) {
                next[index] = working[index];
            }
            const u64 t = working[7] + bigSigma1(working[4]) +
                          choose(working[4], working[5], working[6]) + kRoundConstants[round] +
                          schedule[round % 16];
            next[7] = t + bigSigma0(working[0]) + majority(working[0], working[1], working[2]);
            next[3] += t;
            for (int index = 0; index < 8; ++index) {
                working[(index + 1) % 8] = next[index];
            }
            if (round % 16 == 15) {
                for (int index = 0; index < 16; ++index) {
                    schedule[index] += schedule[(index + 9) % 16] +
                                       smallSigma0(schedule[(index + 1) % 16]) +
                                       smallSigma1(schedule[(index + 14) % 16]);
                }
            }
        }

        for (int index = 0; index < 8; ++index) {
            state_[index] += working[index];
        }
    }

    u64 state_[8]{};
    std::uint8_t buffer_[kSha512BlockSize]{};
    u64 total_bytes_ = 0;
    std::size_t buffered_ = 0;
};

void sha512(std::uint8_t digest[kSha512DigestSize], const std::uint8_t *data,
            std::size_t length) noexcept
{
    Sha512 hasher{};
    hasher.update(data, length);
    hasher.finish(digest);
}

// ---------------------------------------------------------------------------
// GF(2^255 - 19) arithmetic, identical to curve25519.cpp's
// ---------------------------------------------------------------------------

/// One element of GF(2^255 - 19) as sixteen little-endian 16-bit limbs held in
/// 64-bit lanes, so limb products and lazy carries fit without overflow.
using Gf = i64[16];

constexpr Gf kZero = {0};
constexpr Gf kOne = {1};
/// The twisted-Edwards curve constant d = -121665/121666, and 2d.
constexpr Gf kD = {0x78a3, 0x1359, 0x4dca, 0x75eb, 0xd8ab, 0x4141, 0x0a4d, 0x0070,
                   0xe898, 0x7779, 0x4079, 0x8cc7, 0xfe73, 0x2b6f, 0x6cee, 0x5203};
constexpr Gf kD2 = {0xf159, 0x26b2, 0x9b94, 0xebd6, 0xb156, 0x8283, 0x149a, 0x00e0,
                    0xd130, 0xeef3, 0x80f2, 0x198e, 0xfce7, 0x56df, 0xd9dc, 0x2406};
/// The base point's affine coordinates.
constexpr Gf kBaseX = {0xd51a, 0x8f25, 0x2d60, 0xc956, 0xa7b2, 0x9525, 0xc760, 0x692c,
                       0xdc5c, 0xfdd6, 0xe231, 0xc0a4, 0x53fe, 0xcd6e, 0x36d3, 0x2169};
constexpr Gf kBaseY = {0x6658, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666,
                       0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666};
/// sqrt(-1), needed when decompressing a point whose x candidate came out of
/// the wrong square root branch.
constexpr Gf kSqrtMinusOne = {0xa0b0, 0x4a0e, 0x1b27, 0xc4ee, 0xe478, 0xad2f, 0x1806, 0x2f43,
                              0xd7a7, 0x3dfb, 0x0099, 0x2b4d, 0xdf0b, 0x4fc1, 0x2480, 0x2b83};

void copyField(Gf out, const Gf in) noexcept
{
    for (int i = 0; i < 16; ++i) out[i] = in[i];
}

/// Propagate carries between limbs, folding the top limb's overflow back into
/// limb zero multiplied by 38 = 2 * 19 (since 2^256 = 38 mod p).
void carry25519(Gf o) noexcept
{
    for (int i = 0; i < 16; ++i) {
        o[i] += i64(1) << 16;
        const i64 c = o[i] >> 16;
        o[(i + 1) * (i < 15)] += c - 1 + 37 * (c - 1) * (i == 15);
        o[i] -= c * 65536;
    }
}

/// Constant-time conditional swap: exchanges p and q when bit is 1, touches
/// the same memory either way. This is what keeps the ladder's memory access
/// pattern independent of the secret scalar.
void swap25519(Gf p, Gf q, i64 bit) noexcept
{
    const i64 mask = ~(bit - 1);
    for (int i = 0; i < 16; ++i) {
        const i64 t = mask & (p[i] ^ q[i]);
        p[i] ^= t;
        q[i] ^= t;
    }
}

/// Freeze a field element into its unique fully-reduced 32-byte form.
void pack25519(std::uint8_t *o, const Gf n) noexcept
{
    Gf t;
    copyField(t, n);
    carry25519(t);
    carry25519(t);
    carry25519(t);
    for (int j = 0; j < 2; ++j) {
        Gf m;
        m[0] = t[0] - 0xffed;
        for (int i = 1; i < 15; ++i) {
            m[i] = t[i] - 0xffff - ((m[i - 1] >> 16) & 1);
            m[i - 1] &= 0xffff;
        }
        m[15] = t[15] - 0x7fff - ((m[14] >> 16) & 1);
        const i64 borrowed = (m[15] >> 16) & 1;
        m[14] &= 0xffff;
        // When the subtraction did not borrow, t was >= p, so keep m instead.
        swap25519(t, m, 1 - borrowed);
    }
    for (int i = 0; i < 16; ++i) {
        o[2 * i] = static_cast<std::uint8_t>(t[i] & 0xff);
        o[2 * i + 1] = static_cast<std::uint8_t>(t[i] >> 8);
    }
}

void unpack25519(Gf o, const std::uint8_t *n) noexcept
{
    for (int i = 0; i < 16; ++i) {
        o[i] = n[2 * i] + (static_cast<i64>(n[2 * i + 1]) << 8);
    }
    o[15] &= 0x7fff;
}

void add(Gf o, const Gf a, const Gf b) noexcept
{
    for (int i = 0; i < 16; ++i) o[i] = a[i] + b[i];
}

void sub(Gf o, const Gf a, const Gf b) noexcept
{
    for (int i = 0; i < 16; ++i) o[i] = a[i] - b[i];
}

void mul(Gf o, const Gf a, const Gf b) noexcept
{
    i64 product[31];
    for (int i = 0; i < 31; ++i) product[i] = 0;
    for (int i = 0; i < 16; ++i) {
        for (int j = 0; j < 16; ++j) {
            product[i + j] += a[i] * b[j];
        }
    }
    for (int i = 0; i < 15; ++i) product[i] += 38 * product[i + 16];
    for (int i = 0; i < 16; ++i) o[i] = product[i];
    carry25519(o);
    carry25519(o);
}

void sqr(Gf o, const Gf a) noexcept
{
    mul(o, a, a);
}

/// o = 1/in, by Fermat's little theorem: in^(p-2).
void inv25519(Gf o, const Gf in) noexcept
{
    Gf c;
    copyField(c, in);
    for (int a = 253; a >= 0; --a) {
        sqr(c, c);
        if (a != 2 && a != 4) mul(c, c, in);
    }
    copyField(o, c);
}

/// o = in^((p-5)/8), the exponent that produces a square-root candidate.
void pow2523(Gf o, const Gf in) noexcept
{
    Gf c;
    copyField(c, in);
    for (int a = 250; a >= 0; --a) {
        sqr(c, c);
        if (a != 1) mul(c, c, in);
    }
    copyField(o, c);
}

/// Nonzero when the two field elements differ once frozen.
bool fieldsDiffer(const Gf a, const Gf b) noexcept
{
    std::uint8_t packed_a[32];
    std::uint8_t packed_b[32];
    pack25519(packed_a, a);
    pack25519(packed_b, b);
    return std::memcmp(packed_a, packed_b, 32) != 0;
}

std::uint8_t parity25519(const Gf a) noexcept
{
    std::uint8_t packed[32];
    pack25519(packed, a);
    return packed[0] & 1U;
}

// ---------------------------------------------------------------------------
// Edwards group arithmetic
// ---------------------------------------------------------------------------

/// A curve point in extended coordinates (X, Y, Z, T) with x = X/Z, y = Y/Z
/// and T = XY/Z.
using Point = Gf[4];

void pointAdd(Point p, Point q) noexcept
{
    Gf a, b, c, d, t, e, f, g, h;

    sub(a, p[1], p[0]);
    sub(t, q[1], q[0]);
    mul(a, a, t);
    add(b, p[0], p[1]);
    add(t, q[0], q[1]);
    mul(b, b, t);
    mul(c, p[3], q[3]);
    mul(c, c, kD2);
    mul(d, p[2], q[2]);
    add(d, d, d);
    sub(e, b, a);
    sub(f, d, c);
    add(g, d, c);
    add(h, b, a);

    mul(p[0], e, f);
    mul(p[1], h, g);
    mul(p[2], g, f);
    mul(p[3], e, h);
}

void pointSwap(Point p, Point q, std::uint8_t bit) noexcept
{
    for (int i = 0; i < 4; ++i) swap25519(p[i], q[i], bit);
}

/// Compress a point to its 32-byte wire form: y with x's low bit in the top
/// bit.
void pointPack(std::uint8_t *out, Point p) noexcept
{
    Gf x, y, inverse_z;
    inv25519(inverse_z, p[2]);
    mul(x, p[0], inverse_z);
    mul(y, p[1], inverse_z);
    pack25519(out, y);
    out[31] ^= static_cast<std::uint8_t>(parity25519(x) << 7);
}

/// p = scalar * q, by a constant-time double-and-add over all 256 bits. Note
/// that q is scratch: it is left holding an intermediate, exactly as in the
/// original.
void pointScalarMult(Point p, Point q, const std::uint8_t *scalar) noexcept
{
    copyField(p[0], kZero);
    copyField(p[1], kOne);
    copyField(p[2], kOne);
    copyField(p[3], kZero);
    for (int i = 255; i >= 0; --i) {
        const std::uint8_t bit = (scalar[i / 8] >> (i & 7)) & 1U;
        pointSwap(p, q, bit);
        pointAdd(q, p);
        pointAdd(p, p);
        pointSwap(p, q, bit);
    }
}

void pointScalarMultBase(Point p, const std::uint8_t *scalar) noexcept
{
    Point q;
    copyField(q[0], kBaseX);
    copyField(q[1], kBaseY);
    copyField(q[2], kOne);
    mul(q[3], kBaseX, kBaseY);
    pointScalarMult(p, q, scalar);
}

/// Decompress a wire point and negate it, which is the form verification
/// wants. Returns false when the bytes are not a point on the curve.
bool pointUnpackNegative(Point r, const std::uint8_t packed[32]) noexcept
{
    Gf t, check, numerator, denominator, den2, den4, den6;
    copyField(r[2], kOne);
    unpack25519(r[1], packed);
    sqr(numerator, r[1]);
    mul(denominator, numerator, kD);
    sub(numerator, numerator, r[2]);
    add(denominator, r[2], denominator);

    sqr(den2, denominator);
    sqr(den4, den2);
    mul(den6, den4, den2);
    mul(t, den6, numerator);
    mul(t, t, denominator);

    pow2523(t, t);
    mul(t, t, numerator);
    mul(t, t, denominator);
    mul(t, t, denominator);
    mul(r[0], t, denominator);

    sqr(check, r[0]);
    mul(check, check, denominator);
    if (fieldsDiffer(check, numerator)) mul(r[0], r[0], kSqrtMinusOne);

    sqr(check, r[0]);
    mul(check, check, denominator);
    if (fieldsDiffer(check, numerator)) return false;

    if (parity25519(r[0]) == (packed[31] >> 7)) sub(r[0], kZero, r[0]);

    mul(r[3], r[0], r[1]);
    return true;
}

// ---------------------------------------------------------------------------
// Scalar arithmetic modulo the group order L
// ---------------------------------------------------------------------------

/// L = 2^252 + 27742317777372353535851937790883648493, little-endian bytes.
constexpr i64 kGroupOrder[32] = {0xed, 0xd3, 0xf5, 0x5c, 0x1a, 0x63, 0x12, 0x58,
                                 0xd6, 0x9c, 0xf7, 0xa2, 0xde, 0xf9, 0xde, 0x14,
                                 0,    0,    0,    0,    0,    0,    0,    0,
                                 0,    0,    0,    0,    0,    0,    0,    0x10};

/// Reduce the 64-limb little-endian value in `x` modulo L, writing the 32-byte
/// result to `r`. `x` is consumed.
void modL(std::uint8_t *r, i64 x[64]) noexcept
{
    i64 carry;
    int j = 0;
    for (int i = 63; i >= 32; --i) {
        carry = 0;
        for (j = i - 32; j < i - 12; ++j) {
            x[j] += carry - 16 * x[i] * kGroupOrder[j - (i - 32)];
            carry = (x[j] + 128) >> 8;
            x[j] -= carry * 256;
        }
        x[j] += carry;
        x[i] = 0;
    }
    carry = 0;
    for (j = 0; j < 32; ++j) {
        x[j] += carry - (x[31] >> 4) * kGroupOrder[j];
        carry = x[j] >> 8;
        x[j] &= 255;
    }
    for (j = 0; j < 32; ++j) x[j] -= carry * kGroupOrder[j];
    for (int i = 0; i < 32; ++i) {
        x[i + 1] += x[i] >> 8;
        r[i] = static_cast<std::uint8_t>(x[i] & 255);
    }
}

/// Reduce a 64-byte hash to a scalar in place: bytes 0..31 hold the result and
/// 32..63 are cleared.
void reduceScalar(std::uint8_t r[64]) noexcept
{
    i64 x[64];
    for (int i = 0; i < 64; ++i) x[i] = r[i];
    for (int i = 0; i < 64; ++i) r[i] = 0;
    modL(r, x);
}

bool equalBytes(const std::uint8_t *a, const std::uint8_t *b, std::size_t length) noexcept
{
    std::uint8_t difference = 0;
    for (std::size_t index = 0; index < length; ++index) {
        difference |= static_cast<std::uint8_t>(a[index] ^ b[index]);
    }
    return difference == 0;
}

} // namespace

void ed25519ExpandSeed(std::uint8_t expanded[kEd25519PrivateKeySize],
                       const std::uint8_t seed[kEd25519SeedSize]) noexcept
{
    sha512(expanded, seed, kEd25519SeedSize);
    expanded[0] &= 248;
    expanded[31] &= 127;
    expanded[31] |= 64;
}

void ed25519DerivePublicKey(std::uint8_t public_key[kEd25519PublicKeySize],
                            const std::uint8_t expanded[kEd25519PrivateKeySize]) noexcept
{
    Point point;
    pointScalarMultBase(point, expanded);
    pointPack(public_key, point);
}

void ed25519CreateKeypair(std::uint8_t public_key[kEd25519PublicKeySize],
                          std::uint8_t expanded[kEd25519PrivateKeySize],
                          const std::uint8_t seed[kEd25519SeedSize]) noexcept
{
    ed25519ExpandSeed(expanded, seed);
    ed25519DerivePublicKey(public_key, expanded);
}

void ed25519Sign(std::uint8_t signature[kEd25519SignatureSize],
                 const std::uint8_t *message,
                 std::size_t length,
                 const std::uint8_t public_key[kEd25519PublicKeySize],
                 const std::uint8_t expanded[kEd25519PrivateKeySize]) noexcept
{
    // r = H(nonce prefix ‖ message) mod L, then R = r * B.
    std::uint8_t nonce[64];
    Sha512 hasher{};
    hasher.update(expanded + 32, 32);
    hasher.update(message, length);
    hasher.finish(nonce);
    reduceScalar(nonce);

    Point point;
    pointScalarMultBase(point, nonce);
    pointPack(signature, point);

    // S = (r + H(R ‖ A ‖ message) * scalar) mod L.
    std::uint8_t challenge[64];
    hasher.reset();
    hasher.update(signature, 32);
    hasher.update(public_key, kEd25519PublicKeySize);
    hasher.update(message, length);
    hasher.finish(challenge);
    reduceScalar(challenge);

    i64 product[64];
    for (int i = 0; i < 64; ++i) product[i] = 0;
    for (int i = 0; i < 32; ++i) product[i] = nonce[i];
    for (int i = 0; i < 32; ++i) {
        for (int j = 0; j < 32; ++j) {
            product[i + j] += static_cast<i64>(challenge[i]) * static_cast<i64>(expanded[j]);
        }
    }
    modL(signature + 32, product);
}

bool ed25519Verify(const std::uint8_t signature[kEd25519SignatureSize],
                   const std::uint8_t *message,
                   std::size_t length,
                   const std::uint8_t public_key[kEd25519PublicKeySize]) noexcept
{
    Point negated_key;
    if (!pointUnpackNegative(negated_key, public_key)) {
        return false;
    }

    std::uint8_t challenge[64];
    Sha512 hasher{};
    hasher.update(signature, 32);
    hasher.update(public_key, kEd25519PublicKeySize);
    hasher.update(message, length);
    hasher.finish(challenge);
    reduceScalar(challenge);

    // Recompute R = S * B - H(R ‖ A ‖ message) * A and compare it with the R
    // the signer sent.
    Point accumulator;
    pointScalarMult(accumulator, negated_key, challenge);
    Point from_base;
    pointScalarMultBase(from_base, signature + 32);
    pointAdd(accumulator, from_base);

    std::uint8_t recomputed[32];
    pointPack(recomputed, accumulator);
    return equalBytes(recomputed, signature, 32);
}

} // namespace crypto
} // namespace lilyshark
