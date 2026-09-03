(function (global) {
    const Ios6 = global.Ios6 || (global.Ios6 = {});
    const C = Ios6.colors;
    const L = Ios6.layout;
    const K = () => Ios6.kit;
    const W = Ios6.SCREEN_WIDTH;
    const H = Ios6.SCREEN_HEIGHT;

    function clockText(withMeridiem) {
        const now = Ios6.state.now;
        const hours = now.getHours();
        const minutes = String(now.getMinutes()).padStart(2, "0");
        const twelve = hours % 12 || 12;
        const clock = twelve + ":" + minutes;
        if (!withMeridiem) return clock;
        return clock + (hours >= 12 ? " PM" : " AM");
    }

    function dateText() {
        return Ios6.state.now.toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
        });
    }

    function go(name) {
        return function () {
            Ios6.open(name);
        };
    }

    function openInbox() {
        return function () {
            Ios6.state.messagesInbox = true;
            Ios6.open("messages");
        };
    }

    function openThread(peer) {
        return function () {
            Ios6.state.peer = peer;
            Ios6.state.messagesInbox = false;
            Ios6.state.messagesCompose = false;
            Ios6.state.chatScroll = 0;
            Ios6.open("messages");
        };
    }

    function glyphMessage(ctx, x, y) {
        // iOS 6 Messages: lime/forest 45° backslash bands, darker mid
        // green and brighter lime at the foot, cool white oval, left hook.
        ctx.save();
        K().roundRectPath(ctx, x, y, 48, 48, 10);
        ctx.clip();
        const green = ctx.createLinearGradient(x, y, x, y + 48);
        green.addColorStop(0, "#4aaa4c");
        green.addColorStop(0.40, "#2f8a32");
        green.addColorStop(1, "#62dc4a");
        ctx.fillStyle = green;
        ctx.fillRect(x, y, 48, 48);
        ctx.save();
        ctx.translate(x + 24, y + 24);
        ctx.rotate(-Math.PI / 4);
        const pitch = 5.6;
        for (let stripe = -64; stripe < 64; stripe += pitch) {
            ctx.fillStyle = Math.round(stripe / pitch) % 2 === 0
                ? "rgba(122,232,92,0.55)"
                : "rgba(36,110,40,0.42)";
            ctx.fillRect(-58, stripe, 116, pitch * 0.58);
        }
        ctx.restore();
        ctx.restore();

        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.34)";
        ctx.shadowBlur = 2.4;
        ctx.shadowOffsetY = 1.2;
        ctx.beginPath();
        ctx.ellipse(x + 24.0, y + 19.6, 18.8, 10.8, 0, 0, Math.PI * 2);
        const body = ctx.createLinearGradient(x, y + 8, x, y + 33);
        body.addColorStop(0, "#ffffff");
        body.addColorStop(0.58, "#e8eef4");
        body.addColorStop(1, "#c8d6e2");
        ctx.fillStyle = body;
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x + 14.8, y + 27.2);
        ctx.lineTo(x + 10.4, y + 33.6);
        ctx.quadraticCurveTo(x + 17.2, y + 31.2, x + 21.0, y + 28.4);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        ctx.strokeStyle = "rgba(36,44,52,0.28)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(x + 24.0, y + 19.6, 18.8, 10.8, 0, 0, Math.PI * 2);
        ctx.stroke();

        ctx.save();
        ctx.beginPath();
        ctx.ellipse(x + 24.0, y + 19.6, 18.8, 10.8, 0, 0, Math.PI * 2);
        ctx.clip();
        ctx.beginPath();
        ctx.moveTo(x + 5, y + 6);
        ctx.lineTo(x + 43, y + 6);
        ctx.lineTo(x + 43, y + 15.6);
        ctx.quadraticCurveTo(x + 24.0, y + 23.4, x + 5, y + 15.6);
        ctx.closePath();
        const bubbleGlass = ctx.createLinearGradient(x, y + 7, x, y + 24);
        bubbleGlass.addColorStop(0, "rgba(255,255,255,0.99)");
        bubbleGlass.addColorStop(0.50, "rgba(255,255,255,0.42)");
        bubbleGlass.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = bubbleGlass;
        ctx.fill();
        ctx.restore();
    }

    function glyphNodes(ctx, x, y) {
        function person(cx, cy, headR, shoulderW, shoulderH) {
            ctx.beginPath();
            ctx.arc(cx, cy, headR, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.ellipse(cx, cy + headR + shoulderH * 0.12, shoulderW, shoulderH, 0, Math.PI, 0, true);
            ctx.fill();
        }
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.28)";
        ctx.shadowBlur = 2;
        ctx.shadowOffsetY = 1;
        ctx.fillStyle = "rgba(255,255,255,0.78)";
        person(x + 31.6, y + 17.4, 5.2, 9.0, 7.0);
        ctx.fillStyle = "#ffffff";
        person(x + 18.4, y + 16.0, 6.4, 10.4, 7.6);
        ctx.restore();
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.beginPath();
        ctx.ellipse(x + 16.4, y + 13.8, 2.6, 1.7, 0, 0, Math.PI * 2);
        ctx.fill();
    }

    function glyphMap(ctx, x, y) {
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.22)";
        ctx.shadowBlur = 2;
        ctx.shadowOffsetY = 1;
        ctx.beginPath();
        ctx.moveTo(x + 9, y + 16);
        ctx.lineTo(x + 19, y + 11);
        ctx.lineTo(x + 19, y + 36);
        ctx.lineTo(x + 9, y + 40);
        ctx.closePath();
        ctx.fillStyle = "#c4d890";
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x + 19, y + 11);
        ctx.lineTo(x + 30, y + 15);
        ctx.lineTo(x + 30, y + 39);
        ctx.lineTo(x + 19, y + 36);
        ctx.closePath();
        ctx.fillStyle = "#e8f2c4";
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x + 30, y + 15);
        ctx.lineTo(x + 40, y + 11);
        ctx.lineTo(x + 40, y + 36);
        ctx.lineTo(x + 30, y + 39);
        ctx.closePath();
        ctx.fillStyle = "#b4cc78";
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = "rgba(255,255,255,0.40)";
        ctx.fillRect(x + 19, y + 12, 1, 24);
        ctx.fillRect(x + 30, y + 16, 1, 22);
        ctx.strokeStyle = "rgba(255,255,255,0.88)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x + 13, y + 34);
        ctx.lineTo(x + 24, y + 16);
        ctx.lineTo(x + 36, y + 32);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x + 24, y + 15, 3.4, 0, Math.PI * 2);
        ctx.fillStyle = K().hex24(0xe01830);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x + 20.8, y + 16.8);
        ctx.lineTo(x + 24, y + 24.8);
        ctx.lineTo(x + 27.2, y + 16.8);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x + 23.2, y + 13.8, 1.15, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.72)";
        ctx.fill();
    }

    function glyphTraffic(ctx, x, y) {
        const bars = [11, 17, 13, 21, 15];
        for (let index = 0; index < bars.length; index += 1) {
            const bar = bars[index];
            const bx = x + 9 + index * 7;
            const by = y + 36 - bar;
            const fill = ctx.createLinearGradient(bx, by, bx, by + bar);
            fill.addColorStop(0, "#ffffff");
            fill.addColorStop(0.45, "#e8eef2");
            fill.addColorStop(1, "#9aa2aa");
            K().fillRound(ctx, bx, by, 5.2, bar, 1.4, fill);
            ctx.fillStyle = "rgba(255,255,255,0.70)";
            ctx.fillRect(bx + 1, by + 1, 3.2, 1);
        }
    }

    function glyphRadio(ctx, x, y) {
        const cx = x + 24;
        const cy = y + 25;
        ctx.save();
        ctx.strokeStyle = K().hex24(C.White);
        ctx.lineWidth = 2.45;
        ctx.lineCap = "round";
        ctx.shadowColor = "rgba(0,0,0,0.22)";
        ctx.shadowBlur = 1.6;
        ctx.shadowOffsetY = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, 6.0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, 11.4, -Math.PI * 0.78, -Math.PI * 0.22);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, 11.4, Math.PI * 0.22, Math.PI * 0.78);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, 16.6, -Math.PI * 0.72, -Math.PI * 0.28);
        ctx.stroke();
        ctx.restore();
        ctx.beginPath();
        ctx.arc(cx, cy, 2.6, 0, Math.PI * 2);
        const pip = ctx.createRadialGradient(cx - 0.6, cy - 0.8, 0.2, cx, cy, 2.6);
        pip.addColorStop(0, "#ffffff");
        pip.addColorStop(1, "#c8ccd0");
        ctx.fillStyle = pip;
        ctx.fill();
    }

    function glyphSpectrum(ctx, x, y) {
        const hues = [0x3a6ad8, 0x2ab0c8, 0x48c060, 0xf0d040, 0xf07038];
        for (let index = 0; index < hues.length; index += 1) {
            const bx = x + 9 + index * 6;
            const fill = ctx.createLinearGradient(bx, y + 14, bx, y + 36);
            fill.addColorStop(0, K().hex24(hues[index]));
            fill.addColorStop(1, "rgba(0,0,0,0.28)");
            K().fillRound(ctx, bx, y + 14, 5, 22, 1.5, fill);
            ctx.fillStyle = "rgba(255,255,255,0.35)";
            ctx.fillRect(bx + 1, y + 15, 3, 1);
        }
    }

    function glyphCapture(ctx, x, y) {
        const body = ctx.createLinearGradient(x + 7, y + 14, x + 7, y + 38);
        body.addColorStop(0, "#f7f8fa");
        body.addColorStop(0.45, "#d4d8de");
        body.addColorStop(1, "#8a9098");
        K().fillRound(ctx, x + 7, y + 15, 34, 22, 5, body);
        ctx.fillStyle = "rgba(255,255,255,0.78)";
        ctx.fillRect(x + 11, y + 16, 26, 1);
        ctx.fillStyle = K().hex24(0xc8ccd2);
        K().fillRound(ctx, x + 27, y + 11, 9, 5, 1.4, K().hex24(0xe8eaee));
        ctx.beginPath();
        ctx.arc(x + 24, y + 26, 7.6, 0, Math.PI * 2);
        ctx.fillStyle = K().hex24(0x1c2228);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x + 24, y + 26, 6.2, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255,255,255,0.22)";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x + 24, y + 26, 4.6, 0, Math.PI * 2);
        const lens = ctx.createRadialGradient(x + 22, y + 24, 0.4, x + 24, y + 26, 4.6);
        lens.addColorStop(0, "#d0e8f8");
        lens.addColorStop(0.38, "#4a88b8");
        lens.addColorStop(1, "#122030");
        ctx.fillStyle = lens;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x + 22.2, y + 23.8, 1.35, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.82)";
        ctx.fill();
    }

    function glyphSettings(ctx, x, y) {
        function gear(ox, oy, fill) {
            ctx.save();
            ctx.translate(x + 24 + ox, y + 24 + oy);
            ctx.fillStyle = fill;
            for (let spoke = 0; spoke < 8; spoke += 1) {
                ctx.rotate(Math.PI / 4);
                K().roundRectPath(ctx, -2.5, -14.6, 5.0, 8.6, 1.4);
                ctx.fill();
            }
            ctx.beginPath();
            ctx.arc(0, 0, 7.8, 0, Math.PI * 2);
            ctx.arc(0, 0, 3.1, 0, Math.PI * 2, true);
            ctx.fill("evenodd");
            ctx.restore();
        }
        gear(0.8, 1.0, "rgba(0,0,0,0.24)");
        gear(-0.5, -0.6, "#f8fafc");
        const metal = ctx.createLinearGradient(x + 10, y + 10, x + 38, y + 38);
        metal.addColorStop(0, "#f2f4f6");
        metal.addColorStop(0.48, "#c8ced4");
        metal.addColorStop(1, "#6a7078");
        gear(0, 0, metal);
        ctx.beginPath();
        ctx.arc(x + 24, y + 24, 3.1, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(20,24,28,0.35)";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x + 23, y + 22.8, 1.1, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.40)";
        ctx.fill();
    }

    function glyphField(ctx, x, y) {
        const paper = ctx.createLinearGradient(x + 11, y + 10, x + 11, y + 40);
        paper.addColorStop(0, "#fff6d8");
        paper.addColorStop(1, "#f0dca0");
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.22)";
        ctx.shadowBlur = 2;
        ctx.shadowOffsetY = 1;
        K().fillRound(ctx, x + 11, y + 10, 26, 30, 2.6, paper);
        ctx.restore();
        const binding = ctx.createLinearGradient(x + 11, y + 10, x + 11, y + 18);
        binding.addColorStop(0, "#f8b0c8");
        binding.addColorStop(1, "#d05070");
        ctx.fillStyle = binding;
        ctx.fillRect(x + 11, y + 10, 26, 7);
        ctx.fillStyle = "rgba(255,255,255,0.50)";
        ctx.fillRect(x + 11, y + 10, 26, 2);
        ctx.strokeStyle = "rgba(180, 140, 40, 0.42)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let row = 0; row < 3; row += 1) {
            ctx.moveTo(x + 15, y + 22 + row * 5);
            ctx.lineTo(x + 33, y + 22 + row * 5);
        }
        ctx.stroke();
    }

    function drawLockClock(ctx, value, cx, y) {
        const chars = String(value).split("");
        ctx.save();
        ctx.font = "100 58px \"Inter Thin\", \"Helvetica Neue\", \"Liberation Sans\", sans-serif";
        ctx.textBaseline = "top";
        ctx.textAlign = "left";
        let width = 0;
        const widths = chars.map(function (ch) {
            const w = ctx.measureText(ch).width + (ch === ":" ? 1 : 2);
            width += w;
            return w;
        });
        let left = Math.round(cx - width / 2);
        chars.forEach(function (ch, index) {
            ctx.fillStyle = "rgba(0,0,0,0.35)";
            ctx.fillText(ch, left, y + 2);
            ctx.fillStyle = "#ffffff";
            ctx.fillText(ch, left, y);
            left += widths[index];
        });
        ctx.restore();
    }

    function drawLock(ctx) {
        K().wallpaper(ctx);
        K().statusBar(ctx, clockText(), { clear: true, carrier: "LilyGO", lock: true });
        drawLockClock(ctx, clockText(), 160, 34);
        K().text(ctx, dateText(), 160, 96, C.White, {
            size: 13,
            weight: "500",
            align: "center",
            shadow: "rgba(0,0,0,0.50)",
        });

        const glass = ctx.createLinearGradient(0, 184, 0, H);
        glass.addColorStop(0, "rgba(28,34,42,0.62)");
        glass.addColorStop(0.22, "rgba(10,12,16,0.88)");
        glass.addColorStop(1, "rgba(0,0,0,0.94)");
        ctx.fillStyle = glass;
        ctx.fillRect(0, 184, W, H - 184);
        ctx.fillStyle = "rgba(255,255,255,0.22)";
        ctx.fillRect(0, 184, W, 1);
        ctx.fillStyle = "rgba(0,0,0,0.40)";
        ctx.fillRect(0, 185, W, 1);

        const trackX = 8;
        const trackY = 198;
        const trackW = 250;
        const trackH = 30;
        K().unlockTrack(ctx, trackX, trackY, trackW, trackH);
        const slide = Ios6.state.unlockSlide;
        const knobW = 48;
        const knobX = trackX + 2 + slide;
        ctx.save();
        ctx.beginPath();
        ctx.rect(trackX + knobW + 4, trackY + 2, trackW - knobW - 10, trackH - 4);
        ctx.clip();
        K().text(ctx, "slide to unlock", trackX + knobW + 14 + slide * 0.12, trackY + 7, 0x9aa2aa, {
            size: 15,
            weight: "400",
            align: "left",
        });
        const shimmer = Ios6.state.shimmer;
        const shine = ctx.createLinearGradient(trackX + shimmer - 36, 0, trackX + shimmer + 36, 0);
        shine.addColorStop(0, "rgba(255,255,255,0)");
        shine.addColorStop(0.5, "rgba(255,255,255,0.78)");
        shine.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = shine;
        ctx.fillRect(trackX, trackY, trackW, trackH);
        ctx.restore();

        K().unlockKnob(ctx, knobX, trackY + 2, knobW, trackH - 4);
        Ios6.state.unlockTrack = { x: trackX, y: trackY, w: trackW, h: trackH, knobW: knobW };

        const cameraX = 266;
        const kit = K();
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.35)";
        ctx.shadowBlur = 2;
        ctx.shadowOffsetY = 1;
        kit.panel(ctx, cameraX, trackY, 46, trackH, 0x4a525c, 0x181c22, 0x080a0c, 8);
        ctx.restore();
        kit.hardGlass(ctx, function () {
            kit.roundRectPath(ctx, cameraX, trackY, 46, trackH, 8);
        }, cameraX, trackY, 46, trackH, 0.28, { hairline: false });
        const cx = cameraX + 23;
        const cy = trackY + 15;
        kit.fillRound(ctx, cx - 9, cy - 4, 18, 12, 2.2, "#f4f6f8");
        kit.fillRound(ctx, cx - 4, cy - 8, 8, 5, 1.2, "#f4f6f8");
        ctx.beginPath();
        ctx.arc(cx, cy + 1.4, 3.4, 0, Math.PI * 2);
        ctx.fillStyle = "#1a1e24";
        ctx.fill();
        kit.hit(cameraX, trackY, 46, trackH, go("settings"));
    }

    function iconCell(column, row) {
        return {
            x: 14 + column * 76,
            y: 20 + row * 68,
        };
    }

    function drawHome(ctx) {
        K().wallpaper(ctx);
        K().statusBar(ctx, clockText(), { clear: true });
        const apps = [
            { label: "Messages", top: 0x6ee66a, bottom: 0x169a22, edge: 0x0c6a14, glyph: glyphMessage, go: "messages", unread: 2, inbox: true },
            { label: "Nodes", top: 0xf8b44a, bottom: 0xc46a10, edge: 0x8a4a0c, glyph: glyphNodes, go: "nodes" },
            { label: "Field", top: 0xff86b8, bottom: 0xc01860, edge: 0x8a1048, glyph: glyphField, go: "field" },
            { label: "Traffic", top: 0x6ad8e0, bottom: 0x1a6a88, edge: 0x0e4058, glyph: glyphTraffic, go: "kit" },
            { label: "Radio", top: 0x9aa2aa, bottom: 0x3a4248, edge: 0x22262c, glyph: glyphRadio, go: "radio" },
            { label: "Spectrum", top: 0x9a78e8, bottom: 0x3a2088, edge: 0x241058, glyph: glyphSpectrum, go: "kit" },
            { label: "Capture", top: 0x8a929a, bottom: 0x3a4248, edge: 0x22262c, glyph: glyphCapture, go: "settings" },
            { label: "Settings", top: 0xd8dce0, bottom: 0x6a7078, edge: 0x404448, glyph: glyphSettings, go: "settings" },
        ];
        for (let index = 0; index < apps.length; index += 1) {
            const cell = iconCell(index % 4, Math.floor(index / 4));
            const app = apps[index];
            K().appIcon(ctx, cell.x, cell.y, app.top, app.bottom, app.edge, app.glyph, app.label,
                app.inbox ? openInbox() : go(app.go), app.unread);
        }
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.beginPath();
        ctx.arc(154, 158, 2.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.32)";
        ctx.beginPath();
        ctx.arc(166, 158, 2.4, 0, Math.PI * 2);
        ctx.fill();
        K().dock(ctx, 190, [
            { top: 0x6ee66a, bottom: 0x169a22, edge: 0x0c6a14, glyph: glyphMessage, action: openInbox(), unread: 2 },
            { top: 0xf8b44a, bottom: 0xc46a10, edge: 0x8a4a0c, glyph: glyphNodes, action: go("nodes") },
            { top: 0x88c868, bottom: 0x2a6820, edge: 0x184818, glyph: glyphMap, action: go("field") },
            { top: 0x9aa2aa, bottom: 0x3a4248, edge: 0x22262c, glyph: glyphRadio, action: go("radio") },
        ]);
    }

    function drawField(ctx) {
        K().pinstripe(ctx, 0, 0, W, H);
        K().statusBar(ctx, clockText());
        K().navBar(ctx, L.StatusH, "Home");
        K().backButton(ctx, 4, L.StatusH + 5, "Home", go("home"));
        K().navButton(ctx, 252, L.StatusH + 5, 62, 18, "Setup", go("settings"));

        K().panel(ctx, 10, 48, 300, 72, C.GrayTop, C.GrayBottom, C.GrayEdge, 8);
        K().text(ctx, "LISTENING", 22, 56, C.Lily, { size: 10, weight: "700" });
        K().text(ctx, "LongFast", 22, 70, C.Ink, { size: 16, weight: "700" });
        K().text(ctx, "906.875 MHz   SF7   250k", 22, 90, C.Meta, { size: 11 });
        K().text(ctx, "RSSI", 236, 56, C.Meta, { size: 10, align: "right" });
        K().text(ctx, "−68", 292, 54, C.Ink, { size: 22, weight: "200", align: "right" });
        for (let bar = 0; bar < 8; bar += 1) {
            const lit = bar < 6;
            ctx.fillStyle = lit ? K().hex24(C.Lime) : "rgba(0,0,0,0.12)";
            ctx.fillRect(214 + bar * 10, 100 - bar, 8, 10 + bar);
        }

        K().sectionHeader(ctx, 16, 124, "RADIO");
        K().tableGroup(ctx, 10, 136, 300, [
            { label: "Last RX", value: "RIDGE  ·  MESH", disclosure: true, action: go("nodes") },
            { label: "Link", value: "HOPS 1   SNR −12.7" },
            { label: "Heard", value: "4 nodes", disclosure: true, action: go("nodes") },
        ], { rowH: 24 });
        K().sectionHeader(ctx, 16, 210, "LOCATION");
        K().tableGroup(ctx, 10, 220, 300, [
            { label: "GPS", value: "37.7749 N  ·  ON", disclosure: true, action: go("radio") },
        ], { rowH: 18 });
    }

    function titleCase(value) {
        return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
    }

    const THREADS = {
        everyone: {
            name: "Everyone",
            service: "imessage",
            when: "Now",
            messages: [
                { from: "FJELL", text: "anyone on LongFast", mine: false },
                { from: "ME", text: "here. walnut creek", mine: true },
                { from: "HYTTA", text: "copy. lunch at 13", mine: false },
                { from: "FJELL", text: "trail is clear", mine: false },
                { from: "ME", text: "moving north", mine: true, acked: true },
            ],
        },
        fjell: {
            name: "Fjell",
            service: "sms",
            when: "4:20 PM",
            messages: [
                { from: "FJELL", text: "trailhead in 10", mine: false },
                { from: "ME", text: "COPY, TEN MINUTES", mine: true, acked: true },
            ],
        },
        hytta: {
            name: "Hytta",
            service: "imessage",
            unread: 1,
            when: "Yesterday",
            messages: [
                { from: "HYTTA", text: "bring water", mine: false },
            ],
        },
    };

    const PEERS = ["everyone", "fjell", "hytta"];

    function activeThread() {
        return THREADS[Ios6.state.peer] || THREADS.everyone;
    }

    function serviceLabel(thread) {
        return thread.service === "sms" ? "Text Message" : "iMessage";
    }

    function paintMessagesComposer(ctx, thread, onSend) {
        const kit = K();
        const row = kit.composerLayout();
        const sms = thread.service === "sms";
        kit.composerMetal(ctx, row.barY);
        kit.cameraWell(ctx, row.cameraX, row.cameraY, go("settings"));
        kit.composerField(ctx, row.fieldX, row.fieldY, row.fieldW, row.fieldH);
        const draft = Ios6.state.draft;
        const placeholder = serviceLabel(thread);
        kit.text(ctx, draft || placeholder, row.textX, row.textY,
            draft ? C.Ink : C.Placeholder, {
                size: 12,
                weight: draft ? "500" : "400",
            });
        if (Ios6.state.composerFocus) {
            const caretX = draft
                ? row.textX + kit.measureWidth(ctx, draft, { size: 12, weight: "500" })
                : row.caretEmptyX;
            ctx.fillStyle = kit.hex24(0x1478e6);
            ctx.fillRect(Math.min(caretX, row.caretMaxX), row.caretY, 1.4, row.caretH);
        }
        // Zach/Mamma: focused conversation Send is full service candy.
        // Empty New Message stays dusty. Draft always uses frozen Send*/Sms*.
        const candy = !!draft || (Ios6.state.composerFocus && !Ios6.state.messagesCompose);
        const sendTone = !candy ? (sms ? {
            idle: true,
            top: 0xb4c898,
            bottom: 0x6a8a4c,
            edge: 0x4e6a38,
        } : {
            idle: true,
            top: 0xa8c0d8,
            bottom: 0x5a7498,
            edge: 0x4a6080,
        }) : (sms ? {
            top: C.SmsTop,
            bottom: C.SmsBottom,
            edge: C.SmsEdge,
        } : {
            top: C.SendTop,
            bottom: C.SendBottom,
            edge: C.SendEdge,
        });
        kit.sendButton(ctx, row.sendX, row.sendY, row.sendW, row.sendH, "Send", onSend, sendTone);
        kit.hit(row.fieldX, row.fieldY, row.fieldW, row.fieldH, function () {
            Ios6.state.composerFocus = true;
        });
        return row;
    }

    function threadVia(thread, line) {
        if (line.viaNet) return line.viaNet;
        return thread.service === "sms" ? "sms" : "imessage";
    }

    function lastAckedMineIndex(messages) {
        for (let index = messages.length - 1; index >= 0; index -= 1) {
            if (messages[index].mine && messages[index].acked) return index;
        }
        return -1;
    }

    function stampTime() {
        return Ios6.state.now.toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
        });
    }

    function drawMessagesInbox(ctx) {
        const kit = K();
        ctx.fillStyle = "#d0d0d4";
        ctx.fillRect(0, 0, W, H);
        kit.statusBar(ctx, clockText(true), { light: true, carrier: "LilyGO" });
        kit.navBar(ctx, L.StatusH, "Messages");
        kit.navButton(ctx, 6, L.StatusH + 5, 44, 18, "Edit");
        kit.composeButton(ctx, 284, L.StatusH + 5, function () {
            Ios6.state.messagesCompose = true;
            Ios6.state.messagesInbox = false;
            Ios6.state.composeTo = "";
            Ios6.state.draft = "";
            Ios6.state.composerFocus = true;
            Ios6.redraw();
        });
        const searchY = L.StatusH + L.NavH;
        const searchBar = ctx.createLinearGradient(0, searchY, 0, searchY + 28);
        searchBar.addColorStop(0, "#b4b6be");
        searchBar.addColorStop(0.45, "#8e9098");
        searchBar.addColorStop(1, "#6a6c74");
        ctx.fillStyle = searchBar;
        ctx.fillRect(0, searchY, W, 28);
        ctx.fillStyle = "rgba(255,255,255,0.32)";
        ctx.fillRect(0, searchY, W, 1);
        ctx.fillStyle = "rgba(0,0,0,0.34)";
        ctx.fillRect(0, searchY + 27, W, 1);
        kit.panel(ctx, 8, searchY + 4, 304, 20, C.InputTop, C.InputBottom, C.InputEdge, 10);
        ctx.save();
        kit.roundRectPath(ctx, 8, searchY + 4, 304, 20, 10);
        ctx.clip();
        const paper = ctx.createLinearGradient(0, searchY + 4, 0, searchY + 24);
        paper.addColorStop(0, kit.hex24(C.InputTop));
        paper.addColorStop(0.22, "#f2f2f2");
        paper.addColorStop(1, kit.hex24(C.InputBottom));
        ctx.fillStyle = paper;
        ctx.fillRect(8, searchY + 4, 304, 20);
        const inset = ctx.createLinearGradient(0, searchY + 4, 0, searchY + 14);
        inset.addColorStop(0, "rgba(40,40,44,0.24)");
        inset.addColorStop(0.48, "rgba(40,40,44,0.08)");
        inset.addColorStop(1, "rgba(40,40,44,0)");
        ctx.fillStyle = inset;
        ctx.fillRect(8, searchY + 4, 304, 12);
        ctx.fillStyle = "rgba(255,255,255,0.88)";
        ctx.fillRect(16, searchY + 21, 288, 1);
        ctx.restore();
        kit.searchGlyph(ctx, 22, searchY + 14, C.Placeholder);
        kit.text(ctx, "Search", 34, searchY + 7, C.Placeholder, { size: 12 });

        const rowH = 44;
        const tableY = searchY + 28;
        ctx.fillStyle = kit.hex24(C.White);
        ctx.fillRect(0, tableY, W, H - tableY);
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.fillRect(0, tableY, W, 1);
        for (let index = 0; index < PEERS.length; index += 1) {
            const key = PEERS[index];
            const thread = THREADS[key];
            const last = thread.messages[thread.messages.length - 1];
            const top = tableY + index * rowH;
            ctx.fillStyle = "#c4c8ce";
            ctx.fillRect(20, top + rowH - 1, W - 20, 1);
            if (thread.unread) {
                ctx.fillStyle = kit.hex24(0x147efb);
                ctx.beginPath();
                ctx.arc(10, top + 22, 3.6, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = "rgba(255,255,255,0.62)";
                ctx.beginPath();
                ctx.ellipse(9.0, top + 20.4, 1.8, 1.2, 0, 0, Math.PI * 2);
                ctx.fill();
            }
            kit.text(ctx, thread.name, 22, top + 7, C.Ink, {
                size: 14,
                weight: thread.unread ? "800" : "500",
            });
            kit.text(ctx, last ? last.text : "", 22, top + 25, 0x8a9098, {
                size: 12,
                maxWidth: 220,
            });
            kit.text(ctx, thread.when, 298, top + 9, 0x5078a0, { size: 11, align: "right" });
            kit.chevron(ctx, 306, top + 17);
            kit.hit(0, top, W, rowH, openThread(key));
        }
    }

    function drawMessagesCompose(ctx) {
        const kit = K();
        kit.messagePaper(ctx);
        kit.statusBar(ctx, clockText(true), { light: true, carrier: "LilyGO" });
        kit.navBar(ctx, L.StatusH, "New Message");
        kit.navButton(ctx, 252, L.StatusH + 5, 62, 18, "Cancel", function () {
            Ios6.state.messagesCompose = false;
            Ios6.state.messagesInbox = true;
            Ios6.state.composeTo = "";
            Ios6.redraw();
        });
        const toBarY = L.StatusH + L.NavH;
        const toBarH = 26;
        ctx.fillStyle = kit.hex24(C.White);
        ctx.fillRect(0, toBarY, W, toBarH);
        ctx.fillStyle = kit.hex24(C.Rule);
        ctx.fillRect(0, toBarY + toBarH - 1, W, 1);
        kit.text(ctx, "To:", 8, toBarY + 6, C.Meta, { size: 13, weight: "500" });
        const tokenKey = Ios6.state.composeTo;
        const token = tokenKey && THREADS[tokenKey];
        let caretX = 32;
        if (token) {
            const nameSpec = { size: 11, weight: "700" };
            const chipW = Math.ceil(kit.measureWidth(ctx, token.name, nameSpec) + 18);
            kit.tokenChip(ctx, 32, toBarY + 4, chipW, 18, token.name);
            caretX = 32 + chipW + 4;
        }
        ctx.fillStyle = kit.hex24(0x1478e6);
        ctx.fillRect(caretX, toBarY + 6, 1.4, 14);
        kit.plusDisc(ctx, 304, toBarY + 13, 9);
        kit.hit(292, toBarY, 24, toBarH, function () {
            const keys = ["", "fjell", "hytta", "everyone"];
            const current = Ios6.state.composeTo || "";
            const next = keys[(keys.indexOf(current) + 1) % keys.length];
            Ios6.state.composeTo = next;
            if (next) Ios6.state.peer = next;
            Ios6.redraw();
        });

        const thread = token || THREADS.everyone;
        paintMessagesComposer(ctx, thread, function () {
            if (tokenKey) Ios6.state.peer = tokenKey;
            Ios6.sendDraft();
        });
        Ios6.state.messagesVisible = 0;
    }

    function drawMessages(ctx) {
        if (Ios6.state.messagesInbox) {
            drawMessagesInbox(ctx);
            Ios6.state.messagesVisible = 0;
            return;
        }
        if (Ios6.state.messagesCompose) {
            drawMessagesCompose(ctx);
            return;
        }

        const kit = K();
        kit.messagePaper(ctx);
        const thread = activeThread();
        kit.statusBar(ctx, clockText(true), { light: true, carrier: "LilyGO" });
        kit.navBar(ctx, L.StatusH, thread.name);
        kit.backButton(ctx, 4, L.StatusH + 5, "Messages", function () {
            Ios6.state.messagesInbox = true;
            Ios6.redraw();
        });
        kit.navButton(ctx, 268, L.StatusH + 5, 48, 18, "Edit");
        if (Ios6.state.messagesStatusChrome) {
            kit.navStatusChrome(ctx, { carrier: "LilyGO" });
        }
        kit.hit(100, L.StatusH, 120, L.NavH, function () {
            Ios6.state.messagesStatusChrome = !Ios6.state.messagesStatusChrome;
            const box = document.getElementById("messages-chrome");
            if (box) box.checked = Ios6.state.messagesStatusChrome;
            Ios6.redraw();
        });

        const group = Ios6.state.peer === "everyone";
        const toBarY = L.StatusH + L.NavH;
        const stripH = group ? 18 : 26;
        const transcriptTop = toBarY + stripH;
        if (group) {
            const toFill = ctx.createLinearGradient(0, toBarY, 0, toBarY + stripH);
            toFill.addColorStop(0, "#ffffff");
            toFill.addColorStop(1, "#ececf0");
            ctx.fillStyle = toFill;
            ctx.fillRect(0, toBarY, W, stripH);
            ctx.fillStyle = "rgba(255,255,255,0.85)";
            ctx.fillRect(0, toBarY, W, 1);
            ctx.fillStyle = kit.hex24(C.Rule);
            ctx.fillRect(0, toBarY + stripH - 1, W, 1);
            const toTextY = toBarY + 4;
            kit.text(ctx, "To:", 8, toTextY, C.Meta, { size: 11, weight: "700" });
            kit.text(ctx, "Fjell, Hytta", 30, toTextY, C.Ink, { size: 11 });
            kit.text(ctx, "Details", 312, toTextY, 0x1478e6, {
                size: 11,
                weight: "700",
                align: "right",
            });
        } else {
            const stripFill = ctx.createLinearGradient(0, toBarY, 0, toBarY + stripH);
            stripFill.addColorStop(0, "#f7f7f9");
            stripFill.addColorStop(1, "#c8c8ce");
            ctx.fillStyle = stripFill;
            ctx.fillRect(0, toBarY, W, stripH);
            ctx.fillStyle = "rgba(255,255,255,0.80)";
            ctx.fillRect(0, toBarY, W, 1);
            ctx.fillStyle = kit.hex24(C.Rule);
            ctx.fillRect(0, toBarY + stripH - 1, W, 1);
            const actions = [
                { label: "Call", chevron: false },
                { label: "FaceTime", chevron: false },
                { label: "Contact", chevron: true },
            ];
            const pad = 5;
            const gap = 4;
            const btnH = 20;
            const btnY = toBarY + 3;
            const btnW = Math.floor((W - pad * 2 - gap * 2) / 3);
            for (let index = 0; index < actions.length; index += 1) {
                const action = actions[index];
                const x = pad + index * (btnW + gap);
                kit.whitePill(ctx, x, btnY, btnW, btnH);
                const labelX = action.chevron ? x + btnW / 2 - 5 : x + btnW / 2;
                kit.text(ctx, action.label, labelX, btnY + 5, 0x3a5078, {
                    size: 11,
                    weight: "700",
                    align: "center",
                });
                if (action.chevron) {
                    const chevronX = x + btnW - 12;
                    const chevronY = btnY + 6;
                    ctx.strokeStyle = kit.hex24(0x3a5078);
                    ctx.lineWidth = 1.5;
                    ctx.lineCap = "round";
                    ctx.lineJoin = "round";
                    ctx.beginPath();
                    ctx.moveTo(chevronX, chevronY);
                    ctx.lineTo(chevronX + 3.5, chevronY + 4);
                    ctx.lineTo(chevronX, chevronY + 8);
                    ctx.stroke();
                }
            }
        }

        const messages = thread.messages.slice();
        const spec = { size: 12, weight: "500" };
        const scroll = Ios6.state.chatScroll || 0;
        const lastAcked = lastAckedMineIndex(messages);
        let cursor = L.ChatMetaY - 6;
        let painted = 0;
        let topContentY = cursor;
        const start = messages.length - 1 - scroll;
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, transcriptTop, W, L.ChatMetaY - transcriptTop + 10);
        ctx.clip();
        for (let index = start; index >= 0; index -= 1) {
            const line = messages[index];
            const lines = kit.wrapLines(ctx, line.text, 216, spec);
            const textH = lines.length * kit.lineHeight(spec);
            const textW = Math.max.apply(null, lines.map(function (row) {
                return kit.measureWidth(ctx, row, spec);
            }));
            const width = Math.min(236, Math.max(48, Math.ceil(textW + 20)));
            const bubbleH = textH + L.ChatBubblePad;
            const header = 0;
            const delivered = line.mine && index === lastAcked ? L.ChatDeliveredH : 0;
            if (cursor - bubbleH - header - delivered < transcriptTop) break;
            cursor -= delivered;
            const bubbleY = cursor - bubbleH;
            const bubbleX = line.mine ? 310 - width : 10;
            kit.bubble(ctx, bubbleX, bubbleY, width, bubbleH, line.mine, threadVia(thread, line));
            for (let row = 0; row < lines.length; row += 1) {
                kit.text(ctx, lines[row], bubbleX + 10, bubbleY + 6 + row * kit.lineHeight(spec), C.Ink, spec);
            }
            if (delivered) {
                kit.text(ctx, "Delivered", 310, bubbleY + bubbleH + 1, C.Meta, { size: 10, align: "right" });
            }
            if (header) {
                kit.text(ctx, titleCase(line.from), 12, bubbleY - 10, C.Meta, { size: 10 });
            }
            cursor = bubbleY - header - L.ChatBubbleGap;
            topContentY = bubbleY - header;
            painted += 1;
        }
        const olderLeft = start - painted + 1;
        if (olderLeft === 0 && topContentY - transcriptTop >= 28) {
            kit.messageStamp(ctx, Math.max(transcriptTop + 2, topContentY - 30),
                serviceLabel(thread), stampTime());
        }
        if (olderLeft > 0 || scroll > 0) {
            const pillY = transcriptTop + 2;
            if (topContentY - transcriptTop >= L.ChatOlderH + 6) {
                kit.panel(ctx, L.ChatOlderBtnX, pillY, L.ChatOlderBtnW, L.ChatOlderH,
                    C.OlderTop, C.OlderBottom, C.OlderEdge, 9);
                kit.text(ctx, "Older", L.ChatOlderBtnX + L.ChatOlderBtnW / 2, pillY + 5, C.White, {
                    size: 8,
                    weight: "700",
                    align: "center",
                });
                kit.panel(ctx, L.ChatNewerBtnX, pillY, L.ChatNewerBtnW, L.ChatOlderH,
                    C.OlderTop, C.OlderBottom, C.OlderEdge, 9);
                kit.text(ctx, "Newer", L.ChatNewerBtnX + L.ChatNewerBtnW / 2, pillY + 5, C.White, {
                    size: 8,
                    weight: "700",
                    align: "center",
                });
            }
        }
        ctx.restore();
        Ios6.state.messagesVisible = painted;
        if (olderLeft > 0) {
            kit.hit(0, transcriptTop, W, 18, function () {
                Ios6.state.chatScroll = scroll + 1;
                Ios6.redraw();
            });
        }
        if (scroll > 0) {
            kit.hit(L.ChatNewerBtnX, transcriptTop, L.ChatNewerBtnW, L.ChatOlderH, function () {
                Ios6.state.chatScroll = Math.max(0, scroll - 1);
                Ios6.redraw();
            });
        }

        if (Ios6.state.txFailed) {
            kit.text(ctx, "TX FAILED", 10, L.ChatMetaY, C.Fault, { size: 8, weight: "700" });
        }

        paintMessagesComposer(ctx, thread, function () {
            Ios6.sendDraft();
        });
    }

    function drawNodes(ctx) {
        K().pinstripe(ctx, 0, 0, W, H);
        K().statusBar(ctx, clockText());
        K().navBar(ctx, L.StatusH, "Nodes");
        K().backButton(ctx, 4, L.StatusH + 5, "Home", go("home"));
        K().navButton(ctx, 252, L.StatusH + 5, 62, 18, "Chat", openInbox());

        const rows = [
            { name: "RIDGE", snr: "−8.2", age: "2m", tone: C.Lime },
            { name: "CAMP", snr: "−11.0", age: "5m", tone: C.Lime },
            { name: "FJELL", snr: "−16.4", age: "18m", tone: C.Amber },
            { name: "HYTTA", snr: "—", age: "2h", tone: C.Fault },
        ];
        const group = rows.map(function (row, index) {
            return {
                label: row.name,
                value: row.snr + "   " + row.age,
                disclosure: true,
                selected: Ios6.state.nodeIndex === index,
                action: function () {
                    Ios6.state.nodeIndex = index;
                    if (row.name === "FJELL") Ios6.state.peer = "fjell";
                    if (row.name === "HYTTA") Ios6.state.peer = "hytta";
                    Ios6.state.messagesInbox = false;
                    Ios6.open("messages");
                },
            };
        });
        K().tableGroup(ctx, 10, 48, 300, group, { rowH: 32, labelX: 30 });
        for (let index = 0; index < rows.length; index += 1) {
            ctx.fillStyle = K().hex24(rows[index].tone);
            ctx.beginPath();
            ctx.arc(22, 48 + 16 + index * 32, 4, 0, Math.PI * 2);
            ctx.fill();
        }
        K().text(ctx, "Green inside 5 minutes. Amber to 30. Red beyond.", 16, 186, C.Meta, { size: 10 });
        K().tableGroup(ctx, 10, 204, 300, [
            { label: "Everyone", value: "broadcast", disclosure: true, action: function () {
                Ios6.state.peer = "everyone";
                Ios6.state.messagesInbox = false;
                Ios6.open("messages");
            } },
        ], { rowH: 28 });
    }

    function drawRadio(ctx) {
        const felt = ctx.createLinearGradient(0, 0, 0, H);
        felt.addColorStop(0, "#2a1c18");
        felt.addColorStop(1, "#120c0a");
        ctx.fillStyle = felt;
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = "rgba(255,255,255,0.03)";
        for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
        K().statusBar(ctx, clockText());
        K().navBar(ctx, L.StatusH, "Radio");
        K().backButton(ctx, 4, L.StatusH + 5, "Home", go("home"));

        K().panel(ctx, 16, 50, 288, 64, 0x0c1a14, 0x06100c, 0x1a2a22, 6);
        ctx.fillStyle = "rgba(102,240,90,0.08)";
        ctx.fillRect(18, 52, 284, 60);
        K().text(ctx, "906.875", 160, 56, C.Lime, {
            size: 28,
            weight: "300",
            align: "center",
        });
        K().text(ctx, "MHZ   SF7   250K   CR4/5", 160, 92, 0x4a8a52, {
            size: 10,
            align: "center",
        });

        K().text(ctx, "RSSI", 24, 124, 0xc8b8a8, { size: 10, weight: "700" });
        for (let bar = 0; bar < 16; bar += 1) {
            const lit = bar < 11;
            const top = bar > 12 ? C.Fault : (bar > 8 ? C.Amber : C.Lime);
            ctx.fillStyle = lit ? K().hex24(top) : "rgba(255,255,255,0.08)";
            ctx.fillRect(24 + bar * 17, 140, 14, 18);
        }
        K().text(ctx, "−68 dBm    SNR −8.6", 24, 164, 0xc8b8a8, { size: 11 });

        K().sendButton(ctx, 70, 186, 180, 36, "LISTEN", function () {
            Ios6.state.listening = !Ios6.state.listening;
            Ios6.redraw();
        });
        K().text(ctx, Ios6.state.listening ? "SX1262 receiving" : "receiver idle", 160, 226,
            Ios6.state.listening ? C.Lime : 0xc8b8a8, { size: 10, align: "center" });
    }

    function drawSettings(ctx) {
        K().pinstripe(ctx, 0, 0, W, H);
        K().statusBar(ctx, clockText());
        K().navBar(ctx, L.StatusH, "Settings");
        K().backButton(ctx, 4, L.StatusH + 5, "Home", go("home"));

        K().sectionHeader(ctx, 16, 42, "NETWORK");
        K().tableGroup(ctx, 10, 54, 300, [
            { label: "Radio Profile", value: "LongFast", disclosure: true, action: go("radio") },
            { label: "Capture", value: "Off", disclosure: true },
            { label: "Device", value: "Ready", disclosure: true },
        ], { rowH: 24 });

        K().sectionHeader(ctx, 16, 132, "DEVICE");
        K().tableGroup(ctx, 10, 144, 300, [
            { label: "Display", value: "Input", disclosure: true },
            { label: "Help", value: "Keys", disclosure: true },
            { label: "About", value: "Alpha", disclosure: true },
        ], { rowH: 24 });

        const rgb = Ios6.state.rgb565;
        K().text(ctx, "RGB565 preview", 16, 222, C.Meta, { size: 11 });
        K().iosSwitch(ctx, 256, 218, rgb, function () {
            Ios6.state.rgb565 = !Ios6.state.rgb565;
            document.getElementById("rgb565").checked = Ios6.state.rgb565;
            if (Ios6.applyScale) Ios6.applyScale();
            Ios6.redraw();
        });
    }

    function drawKit(ctx) {
        K().pinstripe(ctx, 0, 0, W, H);
        K().statusBar(ctx, clockText());
        K().navBar(ctx, L.StatusH, "Kit");
        K().backButton(ctx, 4, L.StatusH + 5, "Home", go("home"));

        K().glossyButton(ctx, 10, 48, 64, 20, "Normal", false);
        K().glossyButton(ctx, 78, 48, 64, 20, "Selected", true);
        K().navButton(ctx, 146, 48, 48, 20, "Nav");
        K().sendButton(ctx, 198, 46, 52, 24, "SEND");
        K().badge(ctx, 256, 50, 3);
        K().iosSwitch(ctx, 274, 49, true);

        K().bubble(ctx, 10, 78, 140, 28, false, false);
        K().text(ctx, "received", 20, 85, C.Ink, { size: 12 });
        K().bubble(ctx, 170, 78, 140, 28, true, false);
        K().text(ctx, "sent", 180, 85, C.Ink, { size: 12 });

        K().tableGroup(ctx, 10, 116, 300, [
            { label: "Grouped row", value: "value", disclosure: true },
            { label: "Another row", value: "on", selected: true },
        ], { rowH: 26 });

        K().panel(ctx, 10, 176, 90, 26, C.OlderTop, C.OlderBottom, C.OlderEdge, 5);
        K().text(ctx, "OLDER", 55, 183, C.White, { size: 10, weight: "700", align: "center" });
        K().panel(ctx, 108, 176, 90, 26, C.NavTop, C.NavBottom, C.NavEdge, 5);
        K().text(ctx, "NAV", 153, 183, C.White, { size: 10, weight: "700", align: "center" });
        K().panel(ctx, 206, 176, 104, 26, C.BarTop, C.BarBottom, C.BarEdge, 5);
        K().text(ctx, "BAR", 258, 183, C.White, { size: 10, weight: "700", align: "center" });

        K().text(ctx, "ios6_panel + 4 bpp type + corner AA", 12, 212, C.Meta, { size: 11 });
        K().text(ctx, "Same 76,800 pixels as HOME. More of the 65,536 colours.", 12, 226, C.Meta, { size: 10 });
    }

    Ios6.screens = {
        lock: { id: "lock", title: "Lock", hint: "Drag the slider. The camera well on the right opens Capture.", draw: drawLock },
        home: { id: "home", title: "Home", hint: "SpringBoard icons open the other drafts.", draw: drawHome },
        field: { id: "field", title: "Field", hint: "HOME’s radio facts, in grouped iOS 6 chrome.", draw: drawField },
        messages: { id: "messages", title: "Messages", hint: "iOS 6 iMessage. Home opens the inbox. Type, then Send. Blue is iMessage, green is SMS. The camera well opens Capture. Tap the title for status chrome.", draw: drawMessages },
        nodes: { id: "nodes", title: "Nodes", hint: "A row opens that conversation.", draw: drawNodes },
        radio: { id: "radio", title: "Radio", hint: "LISTEN toggles the receiver caption.", draw: drawRadio },
        settings: { id: "settings", title: "Settings", hint: "The switch mirrors the RGB565 checkbox.", draw: drawSettings },
        kit: { id: "kit", title: "Kit", hint: "Shared primitives. Edit js/kit.js and refresh.", draw: drawKit },
    };

    Ios6.threads = THREADS;
})(window);
