// Canvas primitives for the 320×240 panel. ios6_panel() in src/sim_main.cpp
// is the same shape: vertical gloss, 1 px edge, rounded corners.

(function (global) {
    const Ios6 = global.Ios6 || (global.Ios6 = {});
    const C = Ios6.colors;
    const W = Ios6.SCREEN_WIDTH;
    const H = Ios6.SCREEN_HEIGHT;

    // Adafruit GLCD 5×7, column-major, bit 0 = top. Same family as
    // scripts/gen_pixel_font.py / font_pixel_6x8. Advance is 6 px.
    const FONT5X7 = new Uint8Array([
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x5f, 0x00, 0x00, 0x00, 0x07, 0x00, 0x07, 0x00,
        0x14, 0x7f, 0x14, 0x7f, 0x14, 0x24, 0x2a, 0x7f, 0x2a, 0x12, 0x23, 0x13, 0x08, 0x64, 0x62,
        0x36, 0x49, 0x55, 0x22, 0x50, 0x00, 0x05, 0x03, 0x00, 0x00, 0x00, 0x1c, 0x22, 0x41, 0x00,
        0x00, 0x41, 0x22, 0x1c, 0x00, 0x14, 0x08, 0x3e, 0x08, 0x14, 0x08, 0x08, 0x3e, 0x08, 0x08,
        0x00, 0x50, 0x30, 0x00, 0x00, 0x08, 0x08, 0x08, 0x08, 0x08, 0x00, 0x60, 0x60, 0x00, 0x00,
        0x20, 0x10, 0x08, 0x04, 0x02, 0x3e, 0x51, 0x49, 0x45, 0x3e, 0x00, 0x42, 0x7f, 0x40, 0x00,
        0x42, 0x61, 0x51, 0x49, 0x46, 0x21, 0x41, 0x45, 0x4b, 0x31, 0x18, 0x14, 0x12, 0x7f, 0x10,
        0x27, 0x45, 0x45, 0x45, 0x39, 0x3c, 0x4a, 0x49, 0x49, 0x30, 0x01, 0x71, 0x09, 0x05, 0x03,
        0x36, 0x49, 0x49, 0x49, 0x36, 0x06, 0x49, 0x49, 0x29, 0x1e, 0x00, 0x36, 0x36, 0x00, 0x00,
        0x00, 0x56, 0x36, 0x00, 0x00, 0x08, 0x14, 0x22, 0x41, 0x00, 0x14, 0x14, 0x14, 0x14, 0x14,
        0x00, 0x41, 0x22, 0x14, 0x08, 0x02, 0x01, 0x51, 0x09, 0x06, 0x32, 0x49, 0x79, 0x41, 0x3e,
        0x7e, 0x11, 0x11, 0x11, 0x7e, 0x7f, 0x49, 0x49, 0x49, 0x36, 0x3e, 0x41, 0x41, 0x41, 0x22,
        0x7f, 0x41, 0x41, 0x22, 0x1c, 0x7f, 0x49, 0x49, 0x49, 0x41, 0x7f, 0x09, 0x09, 0x09, 0x01,
        0x3e, 0x41, 0x49, 0x49, 0x7a, 0x7f, 0x08, 0x08, 0x08, 0x7f, 0x00, 0x41, 0x7f, 0x41, 0x00,
        0x20, 0x40, 0x41, 0x3f, 0x01, 0x7f, 0x08, 0x14, 0x22, 0x41, 0x7f, 0x40, 0x40, 0x40, 0x40,
        0x7f, 0x02, 0x0c, 0x02, 0x7f, 0x7f, 0x04, 0x08, 0x10, 0x7f, 0x3e, 0x41, 0x41, 0x41, 0x3e,
        0x7f, 0x09, 0x09, 0x09, 0x06, 0x3e, 0x41, 0x51, 0x21, 0x5e, 0x7f, 0x09, 0x19, 0x29, 0x46,
        0x46, 0x49, 0x49, 0x49, 0x31, 0x01, 0x01, 0x7f, 0x01, 0x01, 0x3f, 0x40, 0x40, 0x40, 0x3f,
        0x1f, 0x20, 0x40, 0x20, 0x1f, 0x3f, 0x40, 0x38, 0x40, 0x3f, 0x63, 0x14, 0x08, 0x14, 0x63,
        0x07, 0x08, 0x70, 0x08, 0x07, 0x61, 0x51, 0x49, 0x45, 0x43, 0x00, 0x7f, 0x41, 0x41, 0x00,
        0x02, 0x04, 0x08, 0x10, 0x20, 0x00, 0x41, 0x41, 0x7f, 0x00, 0x04, 0x02, 0x01, 0x02, 0x04,
        0x40, 0x40, 0x40, 0x40, 0x40, 0x00, 0x01, 0x02, 0x04, 0x00, 0x20, 0x54, 0x54, 0x54, 0x78,
        0x7f, 0x48, 0x44, 0x44, 0x38, 0x38, 0x44, 0x44, 0x44, 0x20, 0x38, 0x44, 0x44, 0x48, 0x7f,
        0x38, 0x54, 0x54, 0x54, 0x18, 0x08, 0x7e, 0x09, 0x01, 0x02, 0x0c, 0x52, 0x52, 0x52, 0x3e,
        0x7f, 0x08, 0x04, 0x04, 0x78, 0x00, 0x44, 0x7d, 0x40, 0x00, 0x20, 0x40, 0x44, 0x3d, 0x00,
        0x7f, 0x10, 0x28, 0x44, 0x00, 0x00, 0x41, 0x7f, 0x40, 0x00, 0x7c, 0x04, 0x18, 0x04, 0x78,
        0x7c, 0x08, 0x04, 0x04, 0x78, 0x38, 0x44, 0x44, 0x44, 0x38, 0x7c, 0x14, 0x14, 0x14, 0x08,
        0x08, 0x14, 0x14, 0x18, 0x7c, 0x7c, 0x08, 0x04, 0x04, 0x08, 0x48, 0x54, 0x54, 0x54, 0x20,
        0x04, 0x3f, 0x44, 0x40, 0x20, 0x3c, 0x40, 0x40, 0x20, 0x7c, 0x1c, 0x20, 0x40, 0x20, 0x1c,
        0x3c, 0x40, 0x30, 0x40, 0x3c, 0x44, 0x28, 0x10, 0x28, 0x44, 0x0c, 0x50, 0x50, 0x50, 0x3c,
        0x44, 0x64, 0x54, 0x4c, 0x44, 0x00, 0x08, 0x36, 0x41, 0x00, 0x00, 0x00, 0x7f, 0x00, 0x00,
        0x00, 0x41, 0x36, 0x08, 0x00, 0x10, 0x08, 0x08, 0x10, 0x08,
    ]);

    function hex24(value) {
        return "#" + value.toString(16).padStart(6, "0");
    }

    function rgb565(r, g, b) {
        return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
    }

    function from565(packed) {
        const r = Math.round(((packed >> 11) & 31) * 255 / 31);
        const g = Math.round(((packed >> 5) & 63) * 255 / 63);
        const b = Math.round((packed & 31) * 255 / 31);
        return [r, g, b];
    }

    function quantizeImageData(data) {
        for (let index = 0; index < data.length; index += 4) {
            const packed = rgb565(data[index], data[index + 1], data[index + 2]);
            const rgb = from565(packed);
            data[index] = rgb[0];
            data[index + 1] = rgb[1];
            data[index + 2] = rgb[2];
        }
    }

    function countColors(data, use565) {
        const seen = new Set();
        for (let index = 0; index < data.length; index += 4) {
            if (use565) {
                seen.add(rgb565(data[index], data[index + 1], data[index + 2]));
            } else {
                seen.add((data[index] << 16) | (data[index + 1] << 8) | data[index + 2]);
            }
        }
        return seen.size;
    }

    function normalizeRadius(radius, width, height) {
        if (typeof radius === "number") {
            const cap = Math.max(0, Math.min(radius, width / 2, height / 2));
            return { tl: cap, tr: cap, br: cap, bl: cap };
        }
        const cap = (value) => Math.max(0, Math.min(value || 0, width / 2, height / 2));
        return {
            tl: cap(radius.tl),
            tr: cap(radius.tr),
            br: cap(radius.br),
            bl: cap(radius.bl),
        };
    }

    function roundRectPath(ctx, x, y, width, height, radius) {
        const corners = normalizeRadius(radius, width, height);
        ctx.beginPath();
        ctx.moveTo(x + corners.tl, y);
        ctx.lineTo(x + width - corners.tr, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + corners.tr);
        ctx.lineTo(x + width, y + height - corners.br);
        ctx.quadraticCurveTo(x + width, y + height, x + width - corners.br, y + height);
        ctx.lineTo(x + corners.bl, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - corners.bl);
        ctx.lineTo(x, y + corners.tl);
        ctx.quadraticCurveTo(x, y, x + corners.tl, y);
        ctx.closePath();
    }

    function fillRound(ctx, x, y, width, height, radius, fill) {
        roundRectPath(ctx, x, y, width, height, radius);
        ctx.fillStyle = fill;
        ctx.fill();
    }

    function panel(ctx, x, y, width, height, top, bottom, edge, radius) {
        const gradient = ctx.createLinearGradient(x, y, x, y + height);
        gradient.addColorStop(0, hex24(top));
        gradient.addColorStop(1, hex24(bottom));
        fillRound(ctx, x, y, width, height, radius, gradient);
        if (edge !== null && edge !== undefined) {
            ctx.strokeStyle = hex24(edge);
            ctx.lineWidth = 1;
            roundRectPath(ctx, x + 0.5, y + 0.5, width - 1, height - 1, radius);
            ctx.stroke();
        }
    }

    function gloss(ctx, x, y, width, height, radius, stop) {
        ctx.save();
        roundRectPath(ctx, x, y, width, height, radius);
        ctx.clip();
        const shine = ctx.createLinearGradient(x, y, x, y + height * (stop || 0.55));
        shine.addColorStop(0, "rgba(255,255,255,0.70)");
        shine.addColorStop(0.48, "rgba(255,255,255,0.16)");
        shine.addColorStop(0.5, "rgba(255,255,255,0)");
        ctx.fillStyle = shine;
        ctx.fillRect(x, y, width, height * (stop || 0.55));
        ctx.restore();
    }

    // iOS 6 candy glass: hard equator, top inner highlight, not a soft fade.
    function hardGlass(ctx, pathFn, x, y, width, height, intensity, options) {
        const bright = intensity === undefined ? 0.70 : intensity;
        const spec = options || {};
        ctx.save();
        pathFn();
        ctx.clip();
        const equator = y + Math.round(height * 0.48);
        const shine = ctx.createLinearGradient(x, y, x, equator);
        shine.addColorStop(0, "rgba(255,255,255," + bright.toFixed(2) + ")");
        shine.addColorStop(0.58, "rgba(255,255,255," + (bright * 0.40).toFixed(2) + ")");
        shine.addColorStop(1, "rgba(255,255,255," + (bright * 0.12).toFixed(2) + ")");
        ctx.fillStyle = shine;
        ctx.fillRect(x - 10, y, width + 20, Math.max(1, equator - y));
        if (spec.hairline !== false) {
            ctx.fillStyle = "rgba(255,255,255," + Math.min(0.72, bright * 0.78).toFixed(2) + ")";
            ctx.fillRect(x - 10, equator, width + 20, 1);
            ctx.fillStyle = "rgba(0,0,0,0.16)";
            ctx.fillRect(x - 10, equator + 1, width + 20, 1);
        }
        ctx.fillStyle = "rgba(255,255,255," + Math.min(0.82, bright * 0.90).toFixed(2) + ")";
        ctx.fillRect(x + Math.max(4, width * 0.12), y + 1, width * 0.76, 1);
        ctx.restore();
    }

    function family() {
        const face = Ios6.state.font;
        if (face === "barlow") {
            return '"Barlow Condensed", "Helvetica Neue", "Liberation Sans", sans-serif';
        }
        // Liberation Sans is the Helvetica/Arial-metric face on this host.
        // Helvetica Neue is what iOS 6 used; without it the canvas was falling
        // through to a geometric grotesque and reading as iOS 7.
        return '"Helvetica Neue", Helvetica, "Liberation Sans", Arial, sans-serif';
    }

    function pixelScale(size) {
        if (size >= 24) return 3;
        if (size >= 14) return 2;
        return 1;
    }

    function pixelWidth(text, scale) {
        return text.length * 6 * scale;
    }

    function drawPixelGlyph(ctx, code, x, y, scale) {
        if (code < 32 || code > 126) return;
        const base = (code - 32) * 5;
        for (let column = 0; column < 5; column += 1) {
            const bits = FONT5X7[base + column];
            for (let row = 0; row < 7; row += 1) {
                if (bits & (1 << row)) {
                    ctx.fillRect(x + column * scale, y + row * scale, scale, scale);
                }
            }
        }
    }

    function pixelText(ctx, value, x, y, color, spec) {
        const scale = pixelScale(spec.size || 8);
        const width = pixelWidth(value, scale);
        let left = x;
        if (spec.align === "center") left = Math.round(x - width / 2);
        if (spec.align === "right") left = Math.round(x - width);
        ctx.fillStyle = color;
        for (let index = 0; index < value.length; index += 1) {
            drawPixelGlyph(ctx, value.charCodeAt(index), left + index * 6 * scale, y, scale);
        }
        return width;
    }

    function text(ctx, value, x, y, color, spec) {
        const options = spec || {};
        const size = options.size || 12;
        if (Ios6.state.font === "pixel") {
            return pixelText(ctx, value, x, y, hex24(color), options);
        }
        ctx.save();
        ctx.font = (options.weight || "500") + " " + size + "px " + family();
        ctx.textBaseline = options.baseline || "top";
        ctx.textAlign = options.align || "left";
        if (options.shadow) {
            ctx.fillStyle = options.shadow;
            ctx.fillText(value, x, y + (options.shadowY === undefined ? 1 : options.shadowY), options.maxWidth);
        }
        ctx.fillStyle = hex24(color);
        ctx.fillText(value, x, y, options.maxWidth);
        const width = ctx.measureText(value).width;
        ctx.restore();
        return width;
    }

    function measureWidth(ctx, value, spec) {
        const options = spec || {};
        const size = options.size || 12;
        if (Ios6.state.font === "pixel") {
            return pixelWidth(value, pixelScale(size));
        }
        ctx.save();
        ctx.font = (options.weight || "500") + " " + size + "px " + family();
        const width = ctx.measureText(value).width;
        ctx.restore();
        return width;
    }

    function wrapLines(ctx, value, maxWidth, spec) {
        const options = spec || {};
        if (Ios6.state.font === "pixel") {
            const scale = pixelScale(options.size || 12);
            const columns = Math.max(1, Math.floor(maxWidth / (6 * scale)));
            const words = value.split(" ");
            const lines = [];
            let current = "";
            for (let index = 0; index < words.length; index += 1) {
                const next = current ? current + " " + words[index] : words[index];
                if (next.length > columns && current) {
                    lines.push(current);
                    current = words[index];
                } else {
                    current = next;
                }
            }
            if (current) lines.push(current);
            return lines;
        }
        ctx.save();
        ctx.font = (options.weight || "500") + " " + (options.size || 12) + "px " + family();
        const words = value.split(" ");
        const lines = [];
        let current = "";
        const columns = Math.max(8, Math.floor(maxWidth / 6.5));
        for (let index = 0; index < words.length; index += 1) {
            const next = current ? current + " " + words[index] : words[index];
            const measured = ctx.measureText(next).width;
            if ((measured > maxWidth || next.length > columns) && current) {
                lines.push(current);
                current = words[index];
            } else {
                current = next;
            }
        }
        if (current) lines.push(current);
        ctx.restore();
        return lines;
    }

    function lineHeight(spec) {
        if (Ios6.state.font === "pixel") return 8 * pixelScale((spec && spec.size) || 12);
        return (spec && spec.size) || 12;
    }

    function hit(x, y, width, height, action) {
        Ios6.hits.push({ x: x, y: y, w: width, h: height, action: action });
    }

    function linen(ctx, x, y, width, height, options) {
        const spec = options || {};
        ctx.fillStyle = spec.base || "#8a8476";
        ctx.fillRect(x, y, width, height);
        for (let col = x; col < x + width; col += 2) {
            ctx.fillStyle = (col + y) % 4 === 0 ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.08)";
            ctx.fillRect(col, y, 1, height);
        }
        for (let row = y; row < y + height; row += 2) {
            ctx.fillStyle = (row + x) % 4 === 0 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.07)";
            ctx.fillRect(x, row, width, 1);
        }
        if (spec.vignette) {
            const fade = ctx.createRadialGradient(160, 110, 40, 160, 120, 210);
            fade.addColorStop(0, "rgba(0,0,0,0)");
            fade.addColorStop(1, "rgba(0,0,0,0.38)");
            ctx.fillStyle = fade;
            ctx.fillRect(x, y, width, height);
        }
    }

    let grainTile = null;

    function applyGrain(ctx, x, y, width, height, alpha) {
        if (typeof document === "undefined") return;
        if (!grainTile) {
            grainTile = document.createElement("canvas");
            grainTile.width = 8;
            grainTile.height = 8;
            const tile = grainTile.getContext("2d");
            const pixels = tile.createImageData(8, 8);
            for (let index = 0; index < 64; index += 1) {
                const tone = ((index * 47) ^ (index * 13) ^ 0xa5) & 255;
                pixels.data[index * 4] = tone;
                pixels.data[index * 4 + 1] = tone;
                pixels.data[index * 4 + 2] = tone;
                pixels.data[index * 4 + 3] = 22;
            }
            tile.putImageData(pixels, 0, 0);
        }
        const pattern = ctx.createPattern(grainTile, "repeat");
        if (!pattern) return;
        ctx.save();
        ctx.globalAlpha = alpha === undefined ? 0.22 : alpha;
        ctx.fillStyle = pattern;
        ctx.fillRect(x, y, width, height);
        ctx.restore();
    }

    function wallpaper(ctx) {
        // Original photo-like field. Not Apple art. Not linen — linen is
        // Notification Center / folders, not SpringBoard.
        const sky = ctx.createLinearGradient(0, 0, 0, H);
        sky.addColorStop(0, "#7aa4b8");
        sky.addColorStop(0.22, "#4e8896");
        sky.addColorStop(0.55, "#2a6570");
        sky.addColorStop(0.82, "#163a44");
        sky.addColorStop(1, "#0b1e26");
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, W, H);

        function orb(cx, cy, radius, fill) {
            const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
            glow.addColorStop(0, fill);
            glow.addColorStop(1, "rgba(0,0,0,0)");
            ctx.fillStyle = glow;
            ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
        }
        orb(72, 18, 120, "rgba(255,244,220,0.55)");
        orb(250, 40, 90, "rgba(190,230,240,0.22)");
        orb(40, 130, 70, "rgba(255,255,255,0.10)");
        orb(200, 150, 55, "rgba(255,255,255,0.08)");
        orb(300, 190, 80, "rgba(20,60,70,0.28)");
        orb(120, 210, 90, "rgba(0,0,0,0.22)");

        applyGrain(ctx, 0, 0, W, H);

        const vignette = ctx.createRadialGradient(160, 90, 40, 160, 120, 220);
        vignette.addColorStop(0, "rgba(0,0,0,0)");
        vignette.addColorStop(1, "rgba(0,0,0,0.28)");
        ctx.fillStyle = vignette;
        ctx.fillRect(0, 0, W, H);
    }

    function pinstripe(ctx, x, y, width, height) {
        ctx.fillStyle = hex24(C.Pin);
        ctx.fillRect(x, y, width, height);
        for (let col = x; col < x + width; col += 4) {
            ctx.fillStyle = "rgba(255,255,255,0.30)";
            ctx.fillRect(col, y, 2, height);
            ctx.fillStyle = "rgba(40,50,70,0.07)";
            ctx.fillRect(col + 2, y, 1, height);
        }
    }

    function messagePaper(ctx) {
        // iOS 6 Messages paper is pale blue-grey with a fine tooth.
        // Visible stripes read as Settings.
        ctx.fillStyle = hex24(C.Backdrop);
        ctx.fillRect(0, 0, W, H);
        applyGrain(ctx, 0, 0, W, H, 0.11);
        const wash = ctx.createLinearGradient(0, 0, 0, H);
        wash.addColorStop(0, "rgba(255,255,255,0.10)");
        wash.addColorStop(1, "rgba(40,60,80,0.04)");
        ctx.fillStyle = wash;
        ctx.fillRect(0, 0, W, H);
    }

    function signalBars(ctx, x, y, filled, color) {
        // iOS 6 used five rising rectangles. Dots are iOS 7.
        const count = filled === undefined ? 4 : filled;
        const on = color === undefined ? C.White : color;
        const off = color === undefined ? "rgba(255,255,255,0.28)" : "rgba(16,20,24,0.22)";
        for (let bar = 0; bar < 5; bar += 1) {
            const height = 3 + bar * 2;
            ctx.fillStyle = bar < count ? hex24(on) : off;
            ctx.fillRect(x + bar * 4, y - height, 3, height);
        }
    }

    function wifi(ctx, x, y, color) {
        // iOS 6 status Wi‑Fi is three filled fan wedges + a pip, not stroked arcs.
        const tone = color === undefined ? C.White : color;
        ctx.save();
        ctx.fillStyle = hex24(tone);
        const cy = y + 7.4;
        const rings = [
            { outer: 7.1, inner: 5.45 },
            { outer: 4.55, inner: 2.95 },
            { outer: 2.15, inner: 0.8 },
        ];
        const start = Math.PI * 1.22;
        const end = Math.PI * 1.78;
        for (let index = 0; index < rings.length; index += 1) {
            const ring = rings[index];
            ctx.beginPath();
            ctx.arc(x, cy, ring.outer, start, end, false);
            ctx.arc(x, cy, ring.inner, end, start, true);
            ctx.closePath();
            ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(x, cy, 1.05, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    function battery(ctx, x, y, options) {
        const spec = options || {};
        const level = spec.level === undefined ? 0.72 : spec.level;
        const stroke = spec.color === undefined ? C.White : spec.color;
        const fill = spec.fill === undefined ? stroke : spec.fill;
        ctx.save();
        ctx.strokeStyle = hex24(stroke);
        ctx.lineWidth = 1;
        roundRectPath(ctx, x + 0.5, y + 1, 21, 8, 1.4);
        ctx.stroke();
        ctx.fillStyle = hex24(stroke);
        ctx.fillRect(x + 22, y + 3, 2, 4);
        fillRound(ctx, x + 2, y + 2.5, Math.max(2, Math.round(17 * level)), 5, 0.8, hex24(fill));
        ctx.restore();
    }

    function padlock(ctx, x, y) {
        ctx.save();
        ctx.strokeStyle = hex24(C.White);
        ctx.lineWidth = 1.4;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.arc(x, y + 3.2, 2.6, Math.PI, 0, false);
        ctx.stroke();
        fillRound(ctx, x - 4, y + 4, 8, 6.5, 1.2, hex24(C.White));
        ctx.restore();
    }

    function statusBar(ctx, clock, opts) {
        const options = opts || {};
        const height = Ios6.layout.StatusH;
        const filled = options.bars === undefined ? 5 : options.bars;
        if (options.light) {
            // iOS 6 Messages used the default light status bar, not black.
            const silver = ctx.createLinearGradient(0, 0, 0, height);
            silver.addColorStop(0, "#f3f3f5");
            silver.addColorStop(1, "#b4b4ba");
            ctx.fillStyle = silver;
            ctx.fillRect(0, 0, W, height);
            ctx.fillStyle = "rgba(255,255,255,0.75)";
            ctx.fillRect(0, 0, W, 1);
            ctx.fillStyle = "rgba(0,0,0,0.28)";
            ctx.fillRect(0, height - 1, W, 1);
            const ink = 0x101418;
            const carrier = options.carrier || "LilyGO";
            signalBars(ctx, 4, 13, filled, ink);
            const carrierW = text(ctx, carrier, 26, 3, ink, { size: 10, weight: "700" });
            wifi(ctx, 26 + carrierW + 7, 2, ink);
            text(ctx, clock, 160, 3, ink, { size: 10, weight: "700", align: "center" });
            text(ctx, "72%", 288, 3, ink, { size: 10, weight: "700", align: "right" });
            battery(ctx, 294, 3, { color: ink, fill: 0x4cb050 });
            return;
        }
        ctx.fillStyle = options.clear ? "rgba(0,0,0,0.48)" : hex24(C.Status);
        ctx.fillRect(0, 0, W, height);
        ctx.fillStyle = options.clear ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.10)";
        ctx.fillRect(0, height - 1, W, 1);
        signalBars(ctx, 4, 13, filled);
        wifi(ctx, 26, 3);
        text(ctx, options.carrier || "LilyGO", 38, 3, C.White, { size: 10, weight: "700" });
        if (options.lock) {
            padlock(ctx, 160, 2);
        } else {
            text(ctx, clock, 160, 3, C.White, { size: 10, weight: "700", align: "center" });
        }
        battery(ctx, 294, 3);
    }

    function navStatusChrome(ctx, options) {
        const spec = options || {};
        const left = spec.left === undefined ? 58 : spec.left;
        signalBars(ctx, left, 10, spec.bars === undefined ? 4 : spec.bars);
        text(ctx, spec.carrier || "LilyGO", left + 24, 2, C.White, {
            size: 8,
            weight: "700",
            shadow: "rgba(0,0,0,0.45)",
        });
        battery(ctx, spec.batteryX === undefined ? 236 : spec.batteryX, 1);
    }

    function navBar(ctx, y, title, options) {
        const spec = options || {};
        const height = spec.height || Ios6.layout.NavH;
        panel(ctx, -1, y, W + 2, height, C.NavTop, C.NavBottom, C.NavEdge, 0);
        // iOS 6 glass: hard equator, not a soft fade.
        const equator = y + Math.round(height * 0.48);
        const shine = ctx.createLinearGradient(0, y, 0, equator);
        shine.addColorStop(0, "rgba(255,255,255,0.52)");
        shine.addColorStop(0.70, "rgba(255,255,255,0.14)");
        shine.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = shine;
        ctx.fillRect(0, y, W, equator - y);
        ctx.fillStyle = "rgba(255,255,255,0.22)";
        ctx.fillRect(0, equator, W, 1);
        ctx.fillStyle = "rgba(0,0,0,0.10)";
        ctx.fillRect(0, equator + 1, W, 1);
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.fillRect(0, y + height - 1, W, 1);
        text(ctx, title, 160, y + Math.round((height - 14) / 2), C.White, {
            size: spec.titleSize || 14,
            weight: "700",
            align: "center",
            shadow: "rgba(0,0,0,0.62)",
            shadowY: -1,
        });
        return height;
    }

    function backButton(ctx, x, y, label, action) {
        const height = 18;
        const point = 9;
        const width = point + label.length * (Ios6.state.font === "pixel" ? 6 : 6.2) + 14;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(x + point, y);
        ctx.lineTo(x + width, y);
        ctx.quadraticCurveTo(x + width + 4, y, x + width + 4, y + 4);
        ctx.lineTo(x + width + 4, y + height - 4);
        ctx.quadraticCurveTo(x + width + 4, y + height, x + width, y + height);
        ctx.lineTo(x + point, y + height);
        ctx.quadraticCurveTo(x + 2.1, y + height * 0.60, x, y + height / 2);
        ctx.quadraticCurveTo(x + 2.1, y + height * 0.40, x + point, y);
        ctx.closePath();
        const gradient = ctx.createLinearGradient(x, y, x, y + height);
        gradient.addColorStop(0, hex24(0x6e8cb0));
        gradient.addColorStop(0.48, hex24(0x4a6a90));
        gradient.addColorStop(1, hex24(0x2a4468));
        ctx.fillStyle = gradient;
        ctx.fill();
        ctx.save();
        ctx.clip();
        const equator = y + Math.round(height * 0.48);
        const shine = ctx.createLinearGradient(x, y, x, equator);
        shine.addColorStop(0, "rgba(255,255,255,0.42)");
        shine.addColorStop(0.62, "rgba(255,255,255,0.12)");
        shine.addColorStop(1, "rgba(255,255,255,0.04)");
        ctx.fillStyle = shine;
        ctx.fillRect(x, y, width + 4, equator - y);
        ctx.fillStyle = "rgba(255,255,255,0.36)";
        ctx.fillRect(x, equator, width + 4, 1);
        ctx.fillStyle = "rgba(0,0,0,0.18)";
        ctx.fillRect(x, equator + 1, width + 4, 1);
        ctx.fillStyle = hex24(0xa9c4e0);
        ctx.fillRect(x + point + 2, y + 1, width - point - 4, 1);
        ctx.restore();
        ctx.strokeStyle = hex24(0xa9c4e0);
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.strokeStyle = hex24(C.NavEdge);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
        text(ctx, label, x + point + 4, y + 4, C.White, {
            size: 10,
            weight: "700",
            shadow: "rgba(0,0,0,0.45)",
        });
        hit(x, y, width + 4, height, action);
        return width + 4;
    }

    function navButton(ctx, x, y, width, height, label, action) {
        // Same candy glass as Messages back: 3-stop fill, equator, inner rim.
        const radius = 5;
        ctx.save();
        roundRectPath(ctx, x, y, width, height, radius);
        const gradient = ctx.createLinearGradient(x, y, x, y + height);
        gradient.addColorStop(0, hex24(0x6e8cb0));
        gradient.addColorStop(0.48, hex24(0x4a6a90));
        gradient.addColorStop(1, hex24(0x2a4468));
        ctx.fillStyle = gradient;
        ctx.fill();
        ctx.save();
        ctx.clip();
        const equator = y + Math.round(height * 0.48);
        const shine = ctx.createLinearGradient(x, y, x, equator);
        shine.addColorStop(0, "rgba(255,255,255,0.42)");
        shine.addColorStop(0.62, "rgba(255,255,255,0.12)");
        shine.addColorStop(1, "rgba(255,255,255,0.04)");
        ctx.fillStyle = shine;
        ctx.fillRect(x, y, width, equator - y);
        ctx.fillStyle = "rgba(255,255,255,0.36)";
        ctx.fillRect(x, equator, width, 1);
        ctx.fillStyle = "rgba(0,0,0,0.18)";
        ctx.fillRect(x, equator + 1, width, 1);
        ctx.fillStyle = hex24(0xa9c4e0);
        ctx.fillRect(x + 4, y + 1, width - 8, 1);
        ctx.restore();
        ctx.strokeStyle = hex24(0xa9c4e0);
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.strokeStyle = hex24(C.NavEdge);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
        text(ctx, label, x + width / 2, y + Math.round((height - 8) / 2), C.White, {
            size: 10,
            weight: "700",
            align: "center",
            shadow: "rgba(0,0,0,0.45)",
        });
        if (action) hit(x, y, width, height, action);
    }

    function glossyButton(ctx, x, y, width, height, label, selected, action) {
        if (selected) {
            panel(ctx, x, y, width, height, C.SendTop, C.SendBottom, C.SendEdge, 5);
            text(ctx, label, x + width / 2, y + Math.round((height - 8) / 2), C.White, {
                size: 10,
                weight: "700",
                align: "center",
            });
        } else {
            panel(ctx, x, y, width, height, C.ButtonTop, C.ButtonBottom, C.ButtonEdge, 5);
            text(ctx, label, x + width / 2, y + Math.round((height - 8) / 2), C.ButtonInk, {
                size: 10,
                weight: "700",
                align: "center",
            });
        }
        if (action) hit(x, y, width, height, action);
    }

    // iOS 6 Send is a convex candy capsule: curved crown glass, no
    // equator through the label. Empty uses the same geometry in silver.
    function candyGlass(ctx, x, y, width, height, intensity) {
        const bright = intensity === undefined ? 0.90 : intensity;
        ctx.save();
        roundRectPath(ctx, x, y, width, height, height / 2);
        ctx.clip();
        ctx.beginPath();
        ctx.moveTo(x - 1, y - 1);
        ctx.lineTo(x + width + 1, y - 1);
        ctx.lineTo(x + width + 1, y + height * 0.36);
        ctx.quadraticCurveTo(x + width * 0.5, y + height * 0.78, x - 1, y + height * 0.36);
        ctx.closePath();
        const glass = ctx.createLinearGradient(x, y, x, y + height * 0.58);
        glass.addColorStop(0, "rgba(255,255,255," + bright.toFixed(2) + ")");
        glass.addColorStop(0.42, "rgba(255,255,255," + (bright * 0.42).toFixed(2) + ")");
        glass.addColorStop(1, "rgba(255,255,255,0.02)");
        ctx.fillStyle = glass;
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255," + Math.min(0.94, bright * 0.98).toFixed(2) + ")";
        ctx.fillRect(x + width * 0.16, y + 1, width * 0.68, 1.15);
        const shade = ctx.createLinearGradient(x, y + height * 0.52, x, y + height);
        shade.addColorStop(0, "rgba(0,0,0,0)");
        shade.addColorStop(1, "rgba(0,0,0,0.24)");
        ctx.fillStyle = shade;
        ctx.fillRect(x, y + height * 0.52, width, height * 0.48);
        ctx.restore();
    }

    function sendButton(ctx, x, y, width, height, label, action, colors) {
        const tone = colors || {};
        const idle = tone.idle === true;
        const top = idle ? 0xd8dce2 : (tone.top === undefined ? C.SendTop : tone.top);
        const bottom = idle ? 0x9aa2aa : (tone.bottom === undefined ? C.SendBottom : tone.bottom);
        const edge = idle ? 0x6a727a : (tone.edge === undefined ? C.SendEdge : tone.edge);
        const radius = height / 2;
        ctx.save();
        ctx.shadowColor = idle ? "rgba(0,0,0,0.22)" : "rgba(0,0,0,0.44)";
        ctx.shadowBlur = idle ? 1.6 : 3.4;
        ctx.shadowOffsetY = idle ? 0.8 : 1.4;
        panel(ctx, x, y, width, height, top, bottom, edge, radius);
        ctx.restore();
        candyGlass(ctx, x, y, width, height, idle ? 0.52 : 0.92);
        if (!idle) {
            ctx.save();
            roundRectPath(ctx, x, y, width, height, radius);
            ctx.clip();
            const equator = y + Math.round(height * 0.46);
            ctx.fillStyle = "rgba(255,255,255,0.42)";
            ctx.fillRect(x, equator, width, 1);
            ctx.fillStyle = "rgba(0,0,0,0.16)";
            ctx.fillRect(x, equator + 1, width, 1);
            ctx.restore();
        }
        ctx.strokeStyle = "rgba(255,255,255," + (idle ? "0.28" : "0.50") + ")";
        ctx.lineWidth = 1;
        roundRectPath(ctx, x + 1.1, y + 1.1, width - 2.2, height - 2.2, Math.max(1, radius - 1.1));
        ctx.stroke();
        ctx.strokeStyle = hex24(edge);
        ctx.lineWidth = 1.15;
        roundRectPath(ctx, x + 0.5, y + 0.5, width - 1, height - 1, radius);
        ctx.stroke();
        text(ctx, label, x + width / 2, y + Math.round((height - 10) / 2), C.White, {
            size: 11,
            weight: "700",
            align: "center",
            shadow: idle ? "rgba(0,0,0,0.28)" : "rgba(0,0,0,0.50)",
            shadowY: 1,
        });
        if (action) hit(x, y, width, height, action);
    }

    function tokenChip(ctx, x, y, width, height, label) {
        // iOS 6 To: token is a light-blue lozenge, not the Send candy.
        const radius = height / 2;
        ctx.save();
        ctx.shadowColor = "rgba(20,40,80,0.18)";
        ctx.shadowBlur = 1.6;
        ctx.shadowOffsetY = 1;
        panel(ctx, x, y, width, height, 0xb4d4f4, 0x6a9ad8, 0x3a6aa8, radius);
        ctx.restore();
        candyGlass(ctx, x, y, width, height, 0.72);
        ctx.strokeStyle = "rgba(255,255,255,0.55)";
        ctx.lineWidth = 1;
        roundRectPath(ctx, x + 1, y + 1, width - 2, height - 2, Math.max(1, radius - 1));
        ctx.stroke();
        text(ctx, label, x + width / 2, y + Math.round((height - 10) / 2), C.White, {
            size: 11,
            weight: "700",
            align: "center",
            shadow: "rgba(20,50,90,0.28)",
        });
    }

    function plusDisc(ctx, cx, cy, radius) {
        // iOS 6 add-contact: blue plus in a thin blue ring.
        ctx.save();
        ctx.strokeStyle = hex24(0x1478e6);
        ctx.lineWidth = 1.55;
        ctx.beginPath();
        ctx.arc(cx, cy, radius - 0.7, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineCap = "round";
        ctx.lineWidth = 2.05;
        ctx.beginPath();
        ctx.moveTo(cx - 4.0, cy);
        ctx.lineTo(cx + 4.0, cy);
        ctx.moveTo(cx, cy - 4.0);
        ctx.lineTo(cx, cy + 4.0);
        ctx.stroke();
        ctx.restore();
    }

    function badge(ctx, x, y, value) {
        // iOS 6 SpringBoard badge: thick white rim, circular candy glass.
        const width = 18;
        const height = 18;
        const radius = height / 2;
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.46)";
        ctx.shadowBlur = 3.2;
        ctx.shadowOffsetY = 1.2;
        fillRound(ctx, x - 3, y - 3, width + 6, height + 6, radius + 3, hex24(C.White));
        panel(ctx, x, y, width, height, C.BadgeTop, C.BadgeBottom, C.BadgeEdge, radius);
        ctx.restore();
        ctx.save();
        roundRectPath(ctx, x, y, width, height, radius);
        ctx.clip();
        ctx.beginPath();
        ctx.moveTo(x - 1, y - 1);
        ctx.lineTo(x + width + 1, y - 1);
        ctx.lineTo(x + width + 1, y + height * 0.34);
        ctx.quadraticCurveTo(x + width * 0.5, y + height * 0.70, x - 1, y + height * 0.34);
        ctx.closePath();
        const glass = ctx.createLinearGradient(x, y, x, y + height * 0.58);
        glass.addColorStop(0, "rgba(255,255,255,0.78)");
        glass.addColorStop(0.52, "rgba(255,255,255,0.22)");
        glass.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = glass;
        ctx.fill();
        ctx.restore();
        text(ctx, String(value), x + width / 2, y + 4, C.White, {
            size: 9,
            weight: "700",
            align: "center",
            shadow: "rgba(0,0,0,0.35)",
        });
    }

    function balloonPath(ctx, x, y, width, height, mine, radius) {
        // iOS 6 fin: straight outer wall past the bottom, then a short
        // outward point and a concave hook back into the body.
        const r = Math.min(radius, width / 2, height / 2);
        ctx.beginPath();
        if (mine) {
            ctx.moveTo(x + r, y);
            ctx.lineTo(x + width - r, y);
            ctx.quadraticCurveTo(x + width, y, x + width, y + r);
            ctx.lineTo(x + width, y + height + 2.8);
            ctx.lineTo(x + width + 4.2, y + height + 4.4);
            ctx.quadraticCurveTo(x + width + 0.2, y + height + 1.5, x + width - 6.2, y + height);
            ctx.lineTo(x + r, y + height);
            ctx.quadraticCurveTo(x, y + height, x, y + height - r);
            ctx.lineTo(x, y + r);
            ctx.quadraticCurveTo(x, y, x + r, y);
        } else {
            ctx.moveTo(x + r, y);
            ctx.lineTo(x + width - r, y);
            ctx.quadraticCurveTo(x + width, y, x + width, y + r);
            ctx.lineTo(x + width, y + height - r);
            ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
            ctx.lineTo(x + 6.2, y + height);
            ctx.quadraticCurveTo(x - 0.2, y + height + 1.5, x - 4.2, y + height + 4.4);
            ctx.lineTo(x, y + height + 2.8);
            ctx.lineTo(x, y + r);
            ctx.quadraticCurveTo(x, y, x + r, y);
        }
        ctx.closePath();
    }

    function bubble(ctx, x, y, width, height, mine, viaNet) {
        // Incoming is always grey glass. Outgoing iMessage is blue; SMS is green.
        // White-on-blue is iOS 7. Mesh yellow is not iOS 6 Messages.
        const sms = viaNet === "sms";
        const top = mine ? (sms ? C.SmsTop : C.BlueTop) : C.GrayTop;
        const bottom = mine ? (sms ? C.SmsBottom : C.BlueBottom) : C.GrayBottom;
        const edge = mine ? (sms ? C.SmsEdge : C.BlueEdge) : C.GrayEdge;
        const radius = 14;
        ctx.save();
        ctx.shadowColor = "rgba(40,48,58,0.28)";
        ctx.shadowBlur = 3.5;
        ctx.shadowOffsetY = 1.6;
        balloonPath(ctx, x, y, width, height, mine, radius);
        const fill = ctx.createLinearGradient(x, y, x, y + height);
        fill.addColorStop(0, hex24(top));
        fill.addColorStop(0.42, hex24(top));
        fill.addColorStop(1, hex24(bottom));
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.restore();
        ctx.save();
        balloonPath(ctx, x, y, width, height, mine, radius);
        ctx.strokeStyle = hex24(edge);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.clip();
        // Curved candy crown only. A mid-bubble equator strikes the type.
        ctx.beginPath();
        ctx.moveTo(x - 4, y - 1);
        ctx.lineTo(x + width + 4, y - 1);
        ctx.lineTo(x + width + 4, y + height * 0.36);
        ctx.quadraticCurveTo(x + width * 0.5, y + height * 0.68, x - 4, y + height * 0.36);
        ctx.closePath();
        const shine = ctx.createLinearGradient(x, y, x, y + height * 0.58);
        shine.addColorStop(0, "rgba(255,255,255,0.94)");
        shine.addColorStop(0.50, "rgba(255,255,255,0.32)");
        shine.addColorStop(1, "rgba(255,255,255,0.02)");
        ctx.fillStyle = shine;
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.78)";
        ctx.fillRect(x + 8, y + 1, width - 16, 1);
        const shade = ctx.createLinearGradient(x, y + height * 0.72, x, y + height);
        shade.addColorStop(0, "rgba(0,0,0,0)");
        shade.addColorStop(1, "rgba(0,0,0,0.10)");
        ctx.fillStyle = shade;
        ctx.fillRect(x - 10, y + height * 0.72, width + 20, height * 0.28);
        ctx.restore();
    }

    function messageStamp(ctx, y, label, when) {
        const spec = { size: 10, weight: "700" };
        const labelW = measureWidth(ctx, label, spec);
        const left = 160 - labelW / 2 - 8;
        const right = 160 + labelW / 2 + 8;
        ctx.save();
        ctx.fillStyle = hex24(C.Meta);
        function stampDots(from, to) {
            for (let x = from; x < to; x += 4) {
                ctx.beginPath();
                ctx.arc(x, y + 6, 0.7, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        stampDots(16, left);
        stampDots(right, W - 16);
        ctx.restore();
        text(ctx, label, 160, y, C.Meta, { size: 10, weight: "700", align: "center" });
        if (when) {
            text(ctx, when, 160, y + 14, C.Meta, { size: 10, weight: "500", align: "center" });
        }
        return when ? 28 : 14;
    }

    function cameraWell(ctx, x, y, action) {
        // iOS 6 Messages: stamped dark disc in the metal, white camera.
        const size = 28;
        const cx = x + size / 2;
        const cy = y + size / 2;
        const outer = size / 2 - 0.45;
        ctx.beginPath();
        ctx.arc(cx, cy, outer + 0.55, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255,255,255,0.28)";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, outer, 0, Math.PI * 2);
        const well = ctx.createLinearGradient(cx, cy - outer, cx, cy + outer);
        well.addColorStop(0, "#2c3238");
        well.addColorStop(0.40, "#1a1e22");
        well.addColorStop(1, "#0a0c0e");
        ctx.fillStyle = well;
        ctx.fill();
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, outer - 0.4, 0, Math.PI * 2);
        ctx.clip();
        const inset = ctx.createLinearGradient(cx, cy - outer, cx, cy + 2);
        inset.addColorStop(0, "rgba(0,0,0,0.50)");
        inset.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = inset;
        ctx.fillRect(cx - outer, cy - outer, outer * 2, outer + 2);
        ctx.strokeStyle = "rgba(255,255,255,0.20)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy + 0.3, outer - 1.15, 0.12 * Math.PI, 0.88 * Math.PI);
        ctx.stroke();
        ctx.restore();
        ctx.beginPath();
        ctx.arc(cx, cy, outer, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(16,20,24,0.62)";
        ctx.lineWidth = 1.15;
        ctx.stroke();
        fillRound(ctx, cx - 7.5, cy - 2.5, 15.0, 9.4, 1.9, "#ffffff");
        fillRound(ctx, cx - 3.3, cy - 6.2, 6.6, 3.8, 1.15, "#ffffff");
        ctx.beginPath();
        ctx.arc(cx + 0.15, cy + 2.0, 2.45, 0, Math.PI * 2);
        ctx.fillStyle = "#12161a";
        ctx.fill();
        if (action) hit(x, y, size, size, action);
    }

    function composerField(ctx, x, y, width, height) {
        const radius = height / 2;
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.28)";
        ctx.shadowBlur = 1.6;
        ctx.shadowOffsetY = 1;
        panel(ctx, x, y, width, height, C.InputTop, C.InputBottom, C.InputEdge, radius);
        ctx.restore();
        ctx.save();
        roundRectPath(ctx, x, y, width, height, radius);
        ctx.clip();
        const paper = ctx.createLinearGradient(x, y, x, y + height);
        paper.addColorStop(0, hex24(C.InputTop));
        paper.addColorStop(0.20, hex24(C.InputBottom));
        paper.addColorStop(1, hex24(C.InputBottom));
        ctx.fillStyle = paper;
        ctx.fillRect(x, y, width, height);
        const inset = ctx.createLinearGradient(x, y, x, y + 13);
        inset.addColorStop(0, "rgba(0,0,0,0.58)");
        inset.addColorStop(0.42, "rgba(0,0,0,0.20)");
        inset.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = inset;
        ctx.fillRect(x, y, width, 13);
        const leftWell = ctx.createLinearGradient(x, y, x + 8, y);
        leftWell.addColorStop(0, "rgba(0,0,0,0.20)");
        leftWell.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = leftWell;
        ctx.fillRect(x, y, 8, height);
        const rightWell = ctx.createLinearGradient(x + width, y, x + width - 8, y);
        rightWell.addColorStop(0, "rgba(0,0,0,0.16)");
        rightWell.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = rightWell;
        ctx.fillRect(x + width - 8, y, 8, height);
        ctx.fillStyle = "rgba(255,255,255,0.94)";
        ctx.fillRect(x + 10, y + height - 2, width - 20, 1);
        ctx.restore();
        ctx.strokeStyle = "rgba(0,0,0,0.50)";
        ctx.lineWidth = 1;
        roundRectPath(ctx, x + 0.5, y + 0.5, width - 1, height - 1, radius);
        ctx.stroke();
    }

    function composeButton(ctx, x, y, action) {
        navButton(ctx, x, y, 30, 18, "", action);
        panel(ctx, x + 5, y + 3, 11, 12, C.White, 0xe8e8ec, 0x2b486b, 1.4);
        ctx.fillStyle = "rgba(255,255,255,0.88)";
        ctx.fillRect(x + 6, y + 4, 9, 1);
        ctx.strokeStyle = hex24(0x8aa0b8);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + 7, y + 7);
        ctx.lineTo(x + 13.5, y + 7);
        ctx.moveTo(x + 7, y + 9.4);
        ctx.lineTo(x + 13, y + 9.4);
        ctx.moveTo(x + 7, y + 11.8);
        ctx.lineTo(x + 12, y + 11.8);
        ctx.stroke();
        ctx.save();
        ctx.lineCap = "round";
        ctx.strokeStyle = hex24(C.White);
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(x + 16.5, y + 13.2);
        ctx.lineTo(x + 24.2, y + 5.2);
        ctx.stroke();
        ctx.strokeStyle = hex24(0x3a5a86);
        ctx.lineWidth = 1.35;
        ctx.beginPath();
        ctx.moveTo(x + 16.5, y + 13.2);
        ctx.lineTo(x + 23.4, y + 6.0);
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle = hex24(0xf2c14a);
        ctx.beginPath();
        ctx.moveTo(x + 22.6, y + 4.0);
        ctx.lineTo(x + 26.0, y + 6.6);
        ctx.lineTo(x + 24.0, y + 7.4);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = hex24(0x2a3038);
        ctx.beginPath();
        ctx.moveTo(x + 25.2, y + 4.6);
        ctx.lineTo(x + 26.4, y + 5.6);
        ctx.lineTo(x + 25.4, y + 6.2);
        ctx.closePath();
        ctx.fill();
    }

    function searchGlyph(ctx, x, y, color) {
        ctx.save();
        ctx.strokeStyle = hex24(color);
        ctx.lineWidth = 1.7;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.arc(x, y, 4.0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x + 3.0, y + 3.0);
        ctx.lineTo(x + 7.2, y + 7.2);
        ctx.stroke();
        ctx.restore();
    }

    function chevron(ctx, x, y) {
        ctx.save();
        ctx.strokeStyle = hex24(C.Chevron);
        ctx.lineWidth = 1.7;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 4.2, y + 4.5);
        ctx.lineTo(x, y + 9);
        ctx.stroke();
        ctx.restore();
    }

    function whitePill(ctx, x, y, width, height) {
        // iOS 6 Call/FaceTime/Contact: rounded rect, not a capsule.
        const radius = 5;
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.16)";
        ctx.shadowBlur = 1.6;
        ctx.shadowOffsetY = 1;
        panel(ctx, x, y, width, height, C.White, C.ButtonBottom, C.ButtonEdge, radius);
        ctx.restore();
        hardGlass(ctx, function () {
            roundRectPath(ctx, x, y, width, height, radius);
        }, x, y, width, height, 0.50, { hairline: false });
        ctx.save();
        roundRectPath(ctx, x, y, width, height, radius);
        ctx.clip();
        const inset = ctx.createLinearGradient(x, y, x, y + 7);
        inset.addColorStop(0, "rgba(0,0,0,0.12)");
        inset.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = inset;
        ctx.fillRect(x, y, width, 7);
        ctx.restore();
        ctx.strokeStyle = "rgba(255,255,255,0.86)";
        ctx.lineWidth = 1;
        roundRectPath(ctx, x + 1, y + 1, width - 2, height - 2, Math.max(1, radius - 1));
        ctx.stroke();
    }

    // iOS 6 Messages composer is a ~44pt metal bar. Field and Send are
    // the same 28pt capsule. Palette ChatSend* stays frozen for tests.
    function composerLayout() {
        const barH = 44;
        const barY = H - barH;
        const controlH = 28;
        const controlY = barY + Math.round((barH - controlH) / 2);
        const camera = 28;
        const sendW = 54;
        const sendX = W - sendW - 6;
        const fieldX = 38;
        const fieldW = sendX - fieldX - 4;
        return {
            barY: barY,
            barH: barH,
            cameraX: 6,
            cameraY: controlY,
            cameraSize: camera,
            fieldX: fieldX,
            fieldY: controlY,
            fieldW: fieldW,
            fieldH: controlH,
            sendX: sendX,
            sendY: controlY,
            sendW: sendW,
            sendH: controlH,
            textX: fieldX + 12,
            textY: controlY + 7,
            caretEmptyX: fieldX + 10,
            caretY: controlY + 6,
            caretH: 16,
            caretMaxX: fieldX + fieldW - 10,
        };
    }

    function composerMetal(ctx, barY) {
        const top = barY === undefined ? composerLayout().barY : barY;
        panel(ctx, -1, top, 322, H - top + 2, C.BarTop, C.BarBottom, C.BarEdge, 0);
        const metal = ctx.createLinearGradient(0, top, 0, H);
        metal.addColorStop(0, "rgba(255,255,255,0.36)");
        metal.addColorStop(0.16, "rgba(255,255,255,0.10)");
        metal.addColorStop(1, "rgba(0,0,0,0.10)");
        ctx.fillStyle = metal;
        ctx.fillRect(0, top, W, H - top);
        ctx.save();
        ctx.globalAlpha = 0.05;
        for (let row = top + 2; row < H; row += 2) {
            ctx.fillStyle = row % 4 === 0 ? "#ffffff" : "#202428";
            ctx.fillRect(0, row, W, 1);
        }
        ctx.restore();
        ctx.fillStyle = "rgba(255,255,255,0.44)";
        ctx.fillRect(0, top, W, 1);
        ctx.fillStyle = "rgba(0,0,0,0.34)";
        ctx.fillRect(0, top + 1, W, 1);
    }

    function tableGroup(ctx, x, y, width, rows, options) {
        const spec = options || {};
        const rowH = spec.rowH || 28;
        const labelX = spec.labelX || 12;
        const height = rows.length * rowH;
        panel(ctx, x, y, width, height, C.White, 0xf3f3f3, C.GrayEdge, 8);
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.fillRect(x + 8, y + 1, width - 16, 1);
        for (let index = 0; index < rows.length; index += 1) {
            const row = rows[index];
            const top = y + index * rowH;
            if (index > 0) {
                ctx.fillStyle = hex24(C.GrayEdge);
                ctx.fillRect(x + 10, top, width - 20, 1);
            }
            if (row.selected) {
                ctx.fillStyle = "rgba(49,83,124,0.12)";
                ctx.fillRect(x + 1, top + (index === 0 ? 1 : 0), width - 2, rowH);
            }
            text(ctx, row.label, x + labelX, top + 8, C.Ink, { size: 12, weight: "600" });
            if (row.value) {
                text(ctx, row.value, x + width - (row.disclosure ? 22 : 12), top + 8, C.Meta, {
                    size: 12,
                    align: "right",
                });
            }
            if (row.disclosure) chevron(ctx, x + width - 16, top + 9);
            if (row.action) hit(x, top, width, rowH, row.action);
        }
        return height;
    }

    function iosSwitch(ctx, x, y, on, action) {
        panel(ctx, x, y, 40, 18,
            on ? C.SwitchOnTop : 0xf0f0f0,
            on ? C.SwitchOnBottom : 0xb8b8b8,
            on ? C.SwitchOnEdge : 0x8a8a8a, 9);
        gloss(ctx, x, y, 40, 18, 9, 0.55);
        text(ctx, on ? "ON" : "OFF", on ? x + 7 : x + 22, y + 5,
            on ? C.White : 0x666666, { size: 8, weight: "700" });
        const knobX = on ? x + 22 : x + 2;
        panel(ctx, knobX, y + 1, 16, 16, C.White, 0xe8e8e8, 0xb0b0b0, 8);
        if (action) hit(x, y, 40, 18, action);
    }

    function sectionHeader(ctx, x, y, label) {
        text(ctx, label, x, y + 1, 0xffffff, { size: 11, weight: "700" });
        text(ctx, label, x, y, 0x4c566c, { size: 11, weight: "700" });
    }

    function iconGloss(ctx, x, y, size, radius) {
        // Classic 57px SpringBoard glass: curved cap, not a straight equator.
        // Drawn ON TOP of the glyph.
        ctx.save();
        roundRectPath(ctx, x, y, size, size, radius);
        ctx.clip();
        ctx.beginPath();
        ctx.moveTo(x - 1, y - 1);
        ctx.lineTo(x + size + 1, y - 1);
        ctx.lineTo(x + size + 1, y + size * 0.36);
        ctx.quadraticCurveTo(x + size * 0.5, y + size * 0.70, x - 1, y + size * 0.36);
        ctx.closePath();
        const glass = ctx.createLinearGradient(x, y, x, y + size * 0.62);
        glass.addColorStop(0, "rgba(255,255,255,0.64)");
        glass.addColorStop(0.48, "rgba(255,255,255,0.20)");
        glass.addColorStop(1, "rgba(255,255,255,0.02)");
        ctx.fillStyle = glass;
        ctx.fill();
        const shine = ctx.createRadialGradient(
            x + size * 0.50, y - size * 0.55, 0,
            x + size * 0.50, y - size * 0.55, size * 1.05
        );
        shine.addColorStop(0, "rgba(255,255,255,0.48)");
        shine.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = shine;
        ctx.fillRect(x, y, size, size * 0.55);
        const shade = ctx.createLinearGradient(x, y + size * 0.52, x, y + size);
        shade.addColorStop(0, "rgba(0,0,0,0)");
        shade.addColorStop(1, "rgba(0,0,0,0.26)");
        ctx.fillStyle = shade;
        ctx.fillRect(x, y + size * 0.52, size, size * 0.48);
        ctx.restore();
    }

    function appIcon(ctx, x, y, top, bottom, edge, glyph, label, action, unread) {
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.50)";
        ctx.shadowBlur = 6;
        ctx.shadowOffsetY = 2;
        panel(ctx, x, y, 48, 48, top, bottom, edge, 10);
        ctx.restore();
        if (glyph) glyph(ctx, x, y);
        iconGloss(ctx, x, y, 48, 10);
        if (label) {
            text(ctx, label, x + 24, y + 50, C.White, {
                size: 10,
                weight: "700",
                align: "center",
                shadow: "rgba(0,0,0,0.80)",
            });
        }
        if (unread) badge(ctx, x + 36, y - 4, unread);
        if (action) hit(x - 4, y - 2, 56, 66, action);
    }

    function dock(ctx, y, icons) {
        const iconLift = 24;
        const frontY = y + 30;
        const lipH = 12;
        ctx.fillStyle = "rgba(0,0,0,0.18)";
        ctx.fillRect(0, y - 4, W, H - y + 4);
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(42, y);
        ctx.lineTo(278, y);
        ctx.lineTo(320, frontY);
        ctx.lineTo(0, frontY);
        ctx.closePath();
        ctx.clip();
        const glass = ctx.createLinearGradient(0, y, 0, frontY);
        glass.addColorStop(0, "rgba(255,255,255,0.10)");
        glass.addColorStop(0.45, "rgba(230,236,242,0.22)");
        glass.addColorStop(1, "rgba(255,255,255,0.40)");
        ctx.fillStyle = glass;
        ctx.fillRect(0, y, W, frontY - y + 2);
        ctx.restore();

        ctx.beginPath();
        ctx.moveTo(42, y);
        ctx.lineTo(278, y);
        ctx.lineTo(320, frontY);
        ctx.lineTo(0, frontY);
        ctx.closePath();
        ctx.strokeStyle = "rgba(255,255,255,0.55)";
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(0, frontY);
        ctx.lineTo(320, frontY);
        ctx.lineTo(312, frontY + lipH);
        ctx.quadraticCurveTo(160, frontY + lipH + 3, 8, frontY + lipH);
        ctx.closePath();
        const lip = ctx.createLinearGradient(0, frontY, 0, frontY + lipH);
        lip.addColorStop(0, "rgba(255,255,255,0.42)");
        lip.addColorStop(0.35, "rgba(180,190,200,0.24)");
        lip.addColorStop(1, "rgba(8,12,16,0.45)");
        ctx.fillStyle = lip;
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.40)";
        ctx.fillRect(16, frontY, 288, 1);

        const slot = 308 / icons.length;
        for (let index = 0; index < icons.length; index += 1) {
            const icon = icons[index];
            const x = 6 + Math.round(slot * index + (slot - 48) / 2);
            const iconY = y - iconLift;
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(42, y);
            ctx.lineTo(278, y);
            ctx.lineTo(320, frontY);
            ctx.lineTo(0, frontY);
            ctx.closePath();
            ctx.clip();
            ctx.translate(x, iconY + 48);
            ctx.scale(1, -0.55);
            ctx.globalAlpha = 0.38;
            panel(ctx, 0, 0, 48, 48, icon.bottom, icon.top, icon.edge, 10);
            if (icon.glyph) icon.glyph(ctx, 0, 0);
            ctx.restore();
            appIcon(ctx, x, iconY, icon.top, icon.bottom, icon.edge, icon.glyph, "", icon.action, icon.unread);
        }
    }

    function unlockTrack(ctx, x, y, width, height) {
        const radius = height / 2;
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.55)";
        ctx.shadowBlur = 2;
        ctx.shadowOffsetY = 1;
        fillRound(ctx, x, y, width, height, radius, "#050608");
        ctx.restore();
        ctx.save();
        roundRectPath(ctx, x, y, width, height, radius);
        ctx.clip();
        const well = ctx.createLinearGradient(x, y, x, y + height);
        well.addColorStop(0, "#0a0c10");
        well.addColorStop(0.20, "#181c22");
        well.addColorStop(1, "#2a3038");
        ctx.fillStyle = well;
        ctx.fillRect(x, y, width, height);
        const inset = ctx.createLinearGradient(x, y, x, y + 13);
        inset.addColorStop(0, "rgba(0,0,0,0.74)");
        inset.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = inset;
        ctx.fillRect(x, y, width, 13);
        ctx.fillStyle = "rgba(255,255,255,0.10)";
        ctx.fillRect(x + 16, y + height - 2, width - 32, 1);
        ctx.restore();
        ctx.strokeStyle = "rgba(0,0,0,0.72)";
        ctx.lineWidth = 1.2;
        roundRectPath(ctx, x + 0.5, y + 0.5, width - 1, height - 1, radius);
        ctx.stroke();
    }

    function unlockKnob(ctx, x, y, width, height) {
        const radius = 7;
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.40)";
        ctx.shadowBlur = 2.4;
        ctx.shadowOffsetY = 1;
        panel(ctx, x, y, width, height, 0xffffff, 0xb8c0c8, 0x6a727a, radius);
        ctx.restore();
        hardGlass(ctx, function () {
            roundRectPath(ctx, x, y, width, height, radius);
        }, x, y, width, height, 0.72);
        ctx.strokeStyle = "rgba(255,255,255,0.72)";
        ctx.lineWidth = 1;
        roundRectPath(ctx, x + 1.2, y + 1.2, width - 2.4, height - 2.4, Math.max(1, radius - 1.2));
        ctx.stroke();
        const cx = x + width * 0.54;
        const cy = y + height / 2;
        ctx.strokeStyle = "#5a626a";
        ctx.lineWidth = 2.4;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(cx - 6, cy - 7);
        ctx.lineTo(cx + 5, cy);
        ctx.lineTo(cx - 6, cy + 7);
        ctx.stroke();
        ctx.strokeStyle = "#e4e8ec";
        ctx.lineWidth = 1.35;
        ctx.beginPath();
        ctx.moveTo(cx - 6, cy - 6);
        ctx.lineTo(cx + 3.4, cy);
        ctx.lineTo(cx - 6, cy + 6);
        ctx.stroke();
    }

    Ios6.kit = {
        hex24: hex24,
        rgb565: rgb565,
        from565: from565,
        quantizeImageData: quantizeImageData,
        countColors: countColors,
        panel: panel,
        gloss: gloss,
        hardGlass: hardGlass,
        text: text,
        measureWidth: measureWidth,
        wrapLines: wrapLines,
        lineHeight: lineHeight,
        hit: hit,
        linen: linen,
        wallpaper: wallpaper,
        signalBars: signalBars,
        battery: battery,
        iconGloss: iconGloss,
        pinstripe: pinstripe,
        messagePaper: messagePaper,
        statusBar: statusBar,
        navStatusChrome: navStatusChrome,
        navBar: navBar,
        backButton: backButton,
        navButton: navButton,
        sectionHeader: sectionHeader,
        glossyButton: glossyButton,
        sendButton: sendButton,
        tokenChip: tokenChip,
        plusDisc: plusDisc,
        badge: badge,
        bubble: bubble,
        messageStamp: messageStamp,
        cameraWell: cameraWell,
        composerField: composerField,
        composerLayout: composerLayout,
        composeButton: composeButton,
        searchGlyph: searchGlyph,
        chevron: chevron,
        whitePill: whitePill,
        composerMetal: composerMetal,
        unlockTrack: unlockTrack,
        unlockKnob: unlockKnob,
        tableGroup: tableGroup,
        iosSwitch: iosSwitch,
        appIcon: appIcon,
        dock: dock,
        fillRound: fillRound,
        roundRectPath: roundRectPath,
    };
})(window);
