#include "lilyshark/crypto/curve25519.h"

namespace lilyshark {
namespace crypto {
namespace {

// Provenance: this is the crypto_scalarmult/curve25519 portion of TweetNaCl
// version 20140427 (tweetnacl.cr.yp.to), placed in the public domain by its
// authors Daniel J. Bernstein, Bernard van Gastel, Wesley Janssen, Tanja
// Lange, Peter Schwabe and Sjaak Smetsers. The translation to house style
// renames the one-letter helpers and swaps macros for loops, but every
// arithmetic operation and its ordering is kept identical to the original so
// that the code can be audited line-by-line against it.

using i64 = std::int64_t;

/// One element of GF(2^255 - 19) as sixteen little-endian 16-bit limbs held
/// in 64-bit lanes, so limb products and lazy carries fit without overflow.
using Gf = i64[16];

/// The curve constant (486662 - 2) / 4 = 121665 used by the Montgomery
/// ladder's doubling formula.
constexpr Gf k121665 = {0xDB41, 1};

/// Propagate carries between limbs, folding the top limb's overflow back
/// into limb zero multiplied by 38 = 2 * 19 (since 2^256 = 38 mod p).
void carry25519(Gf o) noexcept
{
    for (int i = 0; i < 16; ++i) {
        o[i] += i64(1) << 16;
        const i64 c = o[i] >> 16;
        o[(i + 1) * (i < 15)] += c - 1 + 37 * (c - 1) * (i == 15);
        // The original shifts c left, but c can be negative here and a
        // negative left shift is undefined before C++20; the equivalent
        // multiplication is defined and compiles to the same instruction.
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

/// Freeze a field element into its unique fully-reduced 32-byte form. The
/// two subtraction passes and the swap-based select keep this constant-time.
void pack25519(std::uint8_t *o, const Gf n) noexcept
{
    Gf t;
    for (int i = 0; i < 16; ++i) t[i] = n[i];
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

/// Load 32 little-endian bytes as a field element, masking the top bit as
/// RFC 7748 requires for received u-coordinates.
void unpack25519(Gf o, const std::uint8_t *n) noexcept
{
    for (int i = 0; i < 16; ++i) {
        o[i] = n[2 * i] + (i64(n[2 * i + 1]) << 8);
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

/// Schoolbook multiply into 31 partial limbs, then fold the high half down
/// by 38 and carry twice. Safe when o aliases a or b because the product
/// lives in t until the final copy.
void mul(Gf o, const Gf a, const Gf b) noexcept
{
    i64 t[31];
    for (int i = 0; i < 31; ++i) t[i] = 0;
    for (int i = 0; i < 16; ++i) {
        for (int j = 0; j < 16; ++j) t[i + j] += a[i] * b[j];
    }
    for (int i = 0; i < 15; ++i) t[i] += 38 * t[i + 16];
    for (int i = 0; i < 16; ++i) o[i] = t[i];
    carry25519(o);
    carry25519(o);
}

void sqr(Gf o, const Gf a) noexcept
{
    mul(o, a, a);
}

/// Invert by raising to p - 2, with the exponent's two zero bits (positions
/// 2 and 4) skipped in the square-and-multiply chain.
void inv25519(Gf o, const Gf in) noexcept
{
    Gf c;
    for (int i = 0; i < 16; ++i) c[i] = in[i];
    for (int a = 253; a >= 0; --a) {
        sqr(c, c);
        if (a != 2 && a != 4) mul(c, c, in);
    }
    for (int i = 0; i < 16; ++i) o[i] = c[i];
}

} // namespace

void x25519ClampPrivateKey(std::uint8_t scalar[kX25519KeySize]) noexcept
{
    scalar[0] &= 248;
    scalar[31] = static_cast<std::uint8_t>((scalar[31] & 127) | 64);
}

void x25519(std::uint8_t out[kX25519KeySize],
            const std::uint8_t scalar[kX25519KeySize],
            const std::uint8_t point[kX25519KeySize]) noexcept
{
    std::uint8_t z[32];
    for (int i = 0; i < 32; ++i) z[i] = scalar[i];
    x25519ClampPrivateKey(z);

    Gf x;
    unpack25519(x, point);

    // The ladder's working pairs: (a, c) tracks bit-off state and (b, d)
    // bit-on state, swapped each step so the same formulas serve both.
    Gf a{}, b, c{}, d{};
    Gf e, f;
    for (int i = 0; i < 16; ++i) b[i] = x[i];
    a[0] = 1;
    d[0] = 1;

    for (int i = 254; i >= 0; --i) {
        const i64 bit = (z[i >> 3] >> (i & 7)) & 1;
        swap25519(a, b, bit);
        swap25519(c, d, bit);
        add(e, a, c);
        sub(a, a, c);
        add(c, b, d);
        sub(b, b, d);
        sqr(d, e);
        sqr(f, a);
        mul(a, c, a);
        mul(c, b, e);
        add(e, a, c);
        sub(a, a, c);
        sqr(b, a);
        sub(c, d, f);
        mul(a, c, k121665);
        add(a, a, d);
        mul(c, c, a);
        mul(a, d, f);
        mul(d, b, x);
        sqr(b, e);
        swap25519(a, b, bit);
        swap25519(c, d, bit);
    }

    inv25519(c, c);
    mul(a, a, c);
    pack25519(out, a);
}

void x25519Base(std::uint8_t out[kX25519KeySize],
                const std::uint8_t scalar[kX25519KeySize]) noexcept
{
    // The base point is u = 9.
    const std::uint8_t base[kX25519KeySize] = {9};
    x25519(out, scalar, base);
}

} // namespace crypto
} // namespace lilyshark
