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

    function family() {
        const face = Ios6.state.font;
        if (face === "barlow") return '"Barlow Condensed", "Helvetica Neue", sans-serif';
        return '"Helvetica Neue", Helvetica, Arial, sans-serif';
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

    function wallpaper(ctx) {
        const sky = ctx.createLinearGradient(0, 0, 0, H);
        sky.addColorStop(0, "#1b2a4a");
        sky.addColorStop(0.42, "#2a163f");
        sky.addColorStop(1, "#0b141c");
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, W, H);

        function blob(cx, cy, radius, fill) {
            const glow = ctx.createRadialGradient(cx, cy, radius * 0.1, cx, cy, radius);
            glow.addColorStop(0, fill);
            glow.addColorStop(1, "rgba(0,0,0,0)");
            ctx.fillStyle = glow;
            ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
        }

        blob(70, 50, 95, "rgba(255,79,157,0.20)");
        blob(250, 90, 120, "rgba(70,110,210,0.28)");
        blob(150, 200, 90, "rgba(40,160,150,0.16)");
        blob(300, 210, 70, "rgba(120,60,180,0.18)");

        ctx.fillStyle = "rgba(0,0,0,0.22)";
        for (let y = 0; y < H; y += 2) ctx.fillRect(0, y, W, 1);
        const vignette = ctx.createRadialGradient(160, 120, 60, 160, 120, 220);
        vignette.addColorStop(0, "rgba(0,0,0,0)");
        vignette.addColorStop(1, "rgba(0,0,0,0.45)");
        ctx.fillStyle = vignette;
        ctx.fillRect(0, 0, W, H);
    }

    function pinstripe(ctx, x, y, width, height) {
        ctx.fillStyle = hex24(C.Pin);
        ctx.fillRect(x, y, width, height);
        for (let row = 0; row < height; row += 3) {
            ctx.fillStyle = "rgba(255,255,255,0.22)";
            ctx.fillRect(x, y + row, width, 1);
            ctx.fillStyle = "rgba(0,0,0,0.05)";
            ctx.fillRect(x, y + row + 1, width, 1);
        }
    }

    function messagePaper(ctx) {
        ctx.fillStyle = hex24(C.Backdrop);
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = "rgba(255,255,255,0.18)";
        for (let column = 6; column < W; column += 8) {
            ctx.fillRect(column, 0, 1, H);
        }
    }

    function statusBar(ctx, clock, opts) {
        const options = opts || {};
        ctx.fillStyle = options.clear ? "rgba(0,0,0,0.35)" : hex24(C.Status);
        ctx.fillRect(0, 0, W, Ios6.layout.StatusH);
        const ink = C.White;
        text(ctx, options.carrier || "Lilyshark", 4, 2, ink, { size: 8, weight: "700" });
        text(ctx, clock, 160, 2, ink, { size: 8, weight: "700", align: "center" });
        panel(ctx, 292, 3, 22, 7, 0x5ad35a, 0x2f9a2f, 0xffffff, 1);
        ctx.fillStyle = hex24(C.White);
        ctx.fillRect(314, 5, 2, 3);
    }

    function navBar(ctx, y, title, options) {
        const spec = options || {};
        const height = spec.height || Ios6.layout.NavH;
        panel(ctx, -1, y, W + 2, height, C.NavTop, C.NavBottom, C.NavEdge, 0);
        const shine = ctx.createLinearGradient(0, y, 0, y + height * 0.55);
        shine.addColorStop(0, "rgba(255,255,255,0.28)");
        shine.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = shine;
        ctx.fillRect(0, y, W, height * 0.55);
        text(ctx, title, 160, y + Math.round((height - 14) / 2), C.White, {
            size: spec.titleSize || 14,
            weight: "700",
            align: "center",
            shadow: "rgba(0,0,0,0.55)",
            shadowY: 1,
        });
        return height;
    }

    function backButton(ctx, x, y, label, action) {
        const height = 18;
        const width = 8 + label.length * (Ios6.state.font === "pixel" ? 6 : 6.2) + 14;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(x + 7, y);
        ctx.lineTo(x + width, y);
        ctx.quadraticCurveTo(x + width + 4, y, x + width + 4, y + 4);
        ctx.lineTo(x + width + 4, y + height - 4);
        ctx.quadraticCurveTo(x + width + 4, y + height, x + width, y + height);
        ctx.lineTo(x + 7, y + height);
        ctx.lineTo(x, y + height / 2);
        ctx.closePath();
        const gradient = ctx.createLinearGradient(x, y, x, y + height);
        gradient.addColorStop(0, hex24(C.ButtonTop));
        gradient.addColorStop(1, hex24(C.ButtonBottom));
        ctx.fillStyle = gradient;
        ctx.fill();
        ctx.strokeStyle = hex24(C.NavEdge);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
        text(ctx, label, x + 12, y + 4, C.ButtonInk, { size: 10, weight: "700" });
        hit(x, y, width + 4, height, action);
        return width + 4;
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

    function sendButton(ctx, x, y, width, height, label, action) {
        panel(ctx, x, y, width, height, C.SendTop, C.SendBottom, C.SendEdge, 15);
        gloss(ctx, x, y, width, height, 15, 0.5);
        text(ctx, label, x + width / 2, y + Math.round((height - 8) / 2), C.White, {
            size: 10,
            weight: "700",
            align: "center",
        });
        if (action) hit(x, y, width, height, action);
    }

    function badge(ctx, x, y, value) {
        panel(ctx, x, y, 14, 11, C.BadgeTop, C.BadgeBottom, C.BadgeEdge, 5);
        text(ctx, String(value), x + 7, y + 2, C.White, { size: 8, weight: "700", align: "center" });
    }

    function bubbleTail(ctx, x, y, mine) {
        const body = hex24(mine ? C.BlueBottom : C.GrayBottom);
        ctx.fillStyle = body;
        for (let step = 0; step < 5; step += 1) {
            const width = 5 - step;
            const left = mine ? x : x + step;
            ctx.fillRect(left, y + step, width, 1);
        }
    }

    function bubble(ctx, x, y, width, height, mine, viaNet) {
        const top = mine ? C.BlueTop : (viaNet ? C.NetTop : C.GrayTop);
        const bottom = mine ? C.BlueBottom : (viaNet ? C.NetBottom : C.GrayBottom);
        const edge = mine ? C.BlueEdge : (viaNet ? C.NetEdge : C.GrayEdge);
        panel(ctx, x, y, width, height, top, bottom, edge, 11);
        bubbleTail(ctx, mine ? x + width - 3 : x - 2, y + height - 5, mine);
    }

    function chevron(ctx, x, y) {
        ctx.strokeStyle = hex24(C.Chevron);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 5, y + 5);
        ctx.lineTo(x, y + 10);
        ctx.stroke();
    }

    function tableGroup(ctx, x, y, width, rows, options) {
        const spec = options || {};
        const rowH = spec.rowH || 28;
        const labelX = spec.labelX || 12;
        const height = rows.length * rowH;
        panel(ctx, x, y, width, height, C.White, 0xf3f3f3, C.GrayEdge, 8);
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
            on ? C.SwitchOnTop : C.GrayTop,
            on ? C.SwitchOnBottom : C.GrayBottom,
            on ? C.SwitchOnEdge : C.GrayEdge, 9);
        const knobX = on ? x + 22 : x + 2;
        panel(ctx, knobX, y + 1, 16, 16, C.White, 0xe8e8e8, 0xb0b0b0, 8);
        if (action) hit(x, y, 40, 18, action);
    }

    function appIcon(ctx, x, y, top, bottom, edge, glyph, label, action, unread) {
        panel(ctx, x, y, 48, 48, top, bottom, edge, 10);
        gloss(ctx, x, y, 48, 48, 10, 0.52);
        glyph(ctx, x, y);
        text(ctx, label, x + 24, y + 50, C.White, {
            size: 9,
            weight: "600",
            align: "center",
            shadow: "rgba(0,0,0,0.7)",
        });
        if (unread) badge(ctx, x + 36, y - 3, unread);
        if (action) hit(x - 4, y - 2, 56, 66, action);
    }

    function dock(ctx, y, icons) {
        panel(ctx, 6, y, 308, 46, 0x6a737c, 0x2a3036, 0x1a1e22, 8);
        ctx.fillStyle = "rgba(255,255,255,0.18)";
        ctx.fillRect(8, y + 1, 304, 1);
        const slot = 308 / icons.length;
        for (let index = 0; index < icons.length; index += 1) {
            const icon = icons[index];
            const x = 6 + Math.round(slot * index + (slot - 48) / 2);
            appIcon(ctx, x, y - 6, icon.top, icon.bottom, icon.edge, icon.glyph, "", icon.action, icon.unread);
        }
    }

    Ios6.kit = {
        hex24: hex24,
        rgb565: rgb565,
        from565: from565,
        quantizeImageData: quantizeImageData,
        countColors: countColors,
        panel: panel,
        gloss: gloss,
        text: text,
        wrapLines: wrapLines,
        lineHeight: lineHeight,
        hit: hit,
        wallpaper: wallpaper,
        pinstripe: pinstripe,
        messagePaper: messagePaper,
        statusBar: statusBar,
        navBar: navBar,
        backButton: backButton,
        glossyButton: glossyButton,
        sendButton: sendButton,
        badge: badge,
        bubble: bubble,
        tableGroup: tableGroup,
        iosSwitch: iosSwitch,
        appIcon: appIcon,
        dock: dock,
        fillRound: fillRound,
        roundRectPath: roundRectPath,
    };
})(window);
