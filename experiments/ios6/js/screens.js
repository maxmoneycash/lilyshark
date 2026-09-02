(function (global) {
    const Ios6 = global.Ios6 || (global.Ios6 = {});
    const C = Ios6.colors;
    const L = Ios6.layout;
    const K = () => Ios6.kit;
    const W = Ios6.SCREEN_WIDTH;
    const H = Ios6.SCREEN_HEIGHT;

    function clockText() {
        const now = Ios6.state.now;
        const hours = now.getHours();
        const minutes = String(now.getMinutes()).padStart(2, "0");
        const twelve = hours % 12 || 12;
        return twelve + ":" + minutes;
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

    function glyphMessage(ctx, x, y) {
        K().panel(ctx, x + 10, y + 14, 28, 20, C.White, 0xe8e8e8, 0xc0c0c0, 4);
        ctx.fillStyle = K().hex24(C.BlueBottom);
        ctx.beginPath();
        ctx.moveTo(x + 16, y + 34);
        ctx.lineTo(x + 16, y + 40);
        ctx.lineTo(x + 24, y + 34);
        ctx.fill();
    }

    function glyphNodes(ctx, x, y) {
        ctx.fillStyle = K().hex24(C.White);
        ctx.beginPath();
        ctx.arc(x + 24, y + 16, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(x + 24, y + 34, 12, 8, 0, 0, Math.PI * 2);
        ctx.fill();
    }

    function glyphMap(ctx, x, y) {
        ctx.strokeStyle = K().hex24(C.White);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x + 12, y + 32);
        ctx.lineTo(x + 20, y + 14);
        ctx.lineTo(x + 28, y + 28);
        ctx.lineTo(x + 36, y + 16);
        ctx.stroke();
        ctx.fillStyle = K().hex24(0xffe36b);
        ctx.beginPath();
        ctx.arc(x + 24, y + 22, 3, 0, Math.PI * 2);
        ctx.fill();
    }

    function glyphTraffic(ctx, x, y) {
        ctx.fillStyle = K().hex24(C.White);
        for (let index = 0; index < 5; index += 1) {
            const bar = 6 + ((index * 13) % 18);
            ctx.fillRect(x + 10 + index * 6, y + 36 - bar, 4, bar);
        }
    }

    function glyphRadio(ctx, x, y) {
        ctx.strokeStyle = K().hex24(C.White);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x + 24, y + 26, 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x + 24, y + 26, 12, -Math.PI * 0.7, -Math.PI * 0.3);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x + 24, y + 26, 12, Math.PI * 0.3, Math.PI * 0.7);
        ctx.stroke();
    }

    function glyphSpectrum(ctx, x, y) {
        const gradient = ctx.createLinearGradient(x + 10, 0, x + 38, 0);
        gradient.addColorStop(0, "#103a78");
        gradient.addColorStop(0.5, "#45c7d8");
        gradient.addColorStop(1, "#ffe36b");
        ctx.fillStyle = gradient;
        ctx.fillRect(x + 10, y + 14, 28, 22);
    }

    function glyphCapture(ctx, x, y) {
        K().panel(ctx, x + 12, y + 16, 24, 18, C.White, 0xdddddd, 0xbbbbbb, 3);
        ctx.fillStyle = K().hex24(C.BadgeBottom);
        ctx.beginPath();
        ctx.arc(x + 24, y + 25, 5, 0, Math.PI * 2);
        ctx.fill();
    }

    function glyphSettings(ctx, x, y) {
        ctx.strokeStyle = K().hex24(C.White);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x + 24, y + 24, 8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        for (let spoke = 0; spoke < 6; spoke += 1) {
            const angle = spoke * Math.PI / 3;
            ctx.moveTo(x + 24 + Math.cos(angle) * 11, y + 24 + Math.sin(angle) * 11);
            ctx.lineTo(x + 24 + Math.cos(angle) * 15, y + 24 + Math.sin(angle) * 15);
        }
        ctx.stroke();
    }

    function glyphField(ctx, x, y) {
        ctx.fillStyle = K().hex24(C.Lily);
        ctx.fillRect(x + 14, y + 14, 20, 8);
        ctx.fillStyle = K().hex24(C.White);
        ctx.fillRect(x + 14, y + 24, 20, 12);
    }

    function drawLock(ctx) {
        K().wallpaper(ctx);
        K().statusBar(ctx, clockText(), { clear: true, carrier: "LilyGO" });
        K().text(ctx, clockText(), 160, 36, C.White, {
            size: 44,
            weight: "200",
            align: "center",
            shadow: "rgba(0,0,0,0.45)",
        });
        K().text(ctx, dateText(), 160, 90, C.White, {
            size: 13,
            weight: "500",
            align: "center",
            shadow: "rgba(0,0,0,0.45)",
        });

        const trackX = 10;
        const trackY = 198;
        const trackW = 248;
        const trackH = 32;
        K().panel(ctx, trackX, trackY, trackW, trackH, 0x5a6168, 0x2c3136, 0x1a1d20, 16);
        const slide = Ios6.state.unlockSlide;
        const knobW = 46;
        const knobX = trackX + 2 + slide;
        K().text(ctx, "slide to unlock", trackX + 24 + slide * 0.15, trackY + 9, 0xc8c8c8, {
            size: 14,
            weight: "400",
            align: "left",
        });
        const shimmer = Ios6.state.shimmer;
        ctx.save();
        ctx.beginPath();
        ctx.rect(trackX + 50, trackY + 4, 200, 24);
        ctx.clip();
        const shine = ctx.createLinearGradient(trackX + shimmer - 40, 0, trackX + shimmer + 40, 0);
        shine.addColorStop(0, "rgba(255,255,255,0)");
        shine.addColorStop(0.5, "rgba(255,255,255,0.55)");
        shine.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = shine;
        ctx.fillRect(trackX, trackY, trackW, trackH);
        ctx.restore();
        K().panel(ctx, knobX, trackY + 2, knobW, trackH - 4, C.ButtonTop, C.ButtonBottom, C.ButtonEdge, 14);
        K().gloss(ctx, knobX, trackY + 2, knobW, trackH - 4, 14, 0.5);
        ctx.fillStyle = K().hex24(C.ButtonInk);
        ctx.beginPath();
        ctx.moveTo(knobX + 18, trackY + 10);
        ctx.lineTo(knobX + 28, trackY + 16);
        ctx.lineTo(knobX + 18, trackY + 22);
        ctx.fill();
        Ios6.state.unlockTrack = { x: trackX, y: trackY, w: trackW, h: trackH, knobW: knobW };

        const cameraX = 266;
        K().panel(ctx, cameraX, trackY, 44, trackH, 0x3a4048, 0x1c2024, 0x0e1012, 10);
        K().gloss(ctx, cameraX, trackY, 44, trackH, 10, 0.28);
        K().panel(ctx, cameraX + 10, trackY + 8, 24, 16, C.ButtonTop, C.ButtonBottom, C.ButtonEdge, 3);
        ctx.fillStyle = K().hex24(C.ButtonTop);
        ctx.fillRect(cameraX + 18, trackY + 6, 8, 3);
        ctx.fillStyle = K().hex24(C.BadgeBottom);
        ctx.beginPath();
        ctx.arc(cameraX + 22, trackY + 16, 4, 0, Math.PI * 2);
        ctx.fill();
        K().hit(cameraX, trackY, 44, trackH, go("settings"));
    }

    function iconCell(column, row) {
        return {
            x: 16 + column * 76,
            y: 22 + row * 70,
        };
    }

    function drawHome(ctx) {
        K().wallpaper(ctx);
        K().statusBar(ctx, clockText(), { clear: true });
        const apps = [
            { label: "Messages", top: 0x7fe07a, bottom: 0x1b9a22, edge: 0x0e6a14, glyph: glyphMessage, go: "messages", unread: 2 },
            { label: "Nodes", top: 0xf6ae43, bottom: 0xc46a12, edge: 0x8a4a0c, glyph: glyphNodes, go: "nodes" },
            { label: "Field", top: 0xff7ab3, bottom: 0xc01860, edge: 0x8a1048, glyph: glyphField, go: "field" },
            { label: "Traffic", top: 0x6ad0d8, bottom: 0x1a6a88, edge: 0x0e4058, glyph: glyphTraffic, go: "kit" },
            { label: "Radio", top: 0x8a93a0, bottom: 0x3a4048, edge: 0x22262c, glyph: glyphRadio, go: "radio" },
            { label: "Spectrum", top: 0x8a6adf, bottom: 0x3a2088, edge: 0x241058, glyph: glyphSpectrum, go: "kit" },
            { label: "Capture", top: 0xf06c65, bottom: 0xa01820, edge: 0x6a1014, glyph: glyphCapture, go: "settings" },
            { label: "Settings", top: 0xd0d4d8, bottom: 0x6a7078, edge: 0x404448, glyph: glyphSettings, go: "settings" },
        ];
        for (let index = 0; index < apps.length; index += 1) {
            const cell = iconCell(index % 4, Math.floor(index / 4));
            const app = apps[index];
            K().appIcon(ctx, cell.x, cell.y, app.top, app.bottom, app.edge, app.glyph, app.label,
                go(app.go), app.unread);
        }
        K().dock(ctx, 188, [
            { top: 0x7fe07a, bottom: 0x1b9a22, edge: 0x0e6a14, glyph: glyphMessage, action: go("messages"), unread: 2 },
            { top: 0xf6ae43, bottom: 0xc46a12, edge: 0x8a4a0c, glyph: glyphNodes, action: go("nodes") },
            { top: 0x6ad0d8, bottom: 0x1a6a88, edge: 0x0e4058, glyph: glyphMap, action: go("field") },
            { top: 0x8a93a0, bottom: 0x3a4048, edge: 0x22262c, glyph: glyphRadio, action: go("radio") },
        ]);
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.beginPath();
        ctx.arc(154, 182, 2.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.28)";
        ctx.beginPath();
        ctx.arc(166, 182, 2.4, 0, Math.PI * 2);
        ctx.fill();
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

    const THREADS = {
        everyone: {
            name: "EVERYONE",
            messages: [
                { from: "FJELL", text: "anyone on LongFast", mine: false },
                { from: "ME", text: "here. walnut creek", mine: true },
                { from: "HYTTA", text: "copy. lunch at 13", mine: false },
                { from: "FJELL", text: "trail is clear", mine: false },
                { from: "ME", text: "moving north", mine: true, acked: true },
            ],
        },
        fjell: {
            name: "FJELL",
            messages: [
                { from: "FJELL", text: "trailhead in 10", mine: false },
                { from: "ME", text: "COPY, TEN MINUTES", mine: true, acked: true },
            ],
        },
        hytta: {
            name: "HYTTA",
            unread: 1,
            messages: [
                { from: "HYTTA", text: "bring water", mine: false },
            ],
        },
    };

    const PEERS = ["everyone", "fjell", "hytta"];

    function activeThread() {
        return THREADS[Ios6.state.peer];
    }

    function drawMessages(ctx) {
        const kit = K();
        kit.messagePaper(ctx);
        kit.panel(ctx, -1, -2, 322, 26, C.NavTop, C.NavBottom, C.NavEdge, 0);
        const thread = activeThread();
        kit.text(ctx, thread.name, 160, 5, C.White, {
            size: 12,
            weight: "700",
            align: "center",
            shadow: "rgba(0,0,0,0.5)",
        });

        const shown = PEERS.length;
        const tabW = W / shown;
        for (let index = 0; index < shown; index += 1) {
            const key = PEERS[index];
            const peer = THREADS[key];
            const selected = key === Ios6.state.peer;
            const x = index * tabW;
            kit.panel(ctx, x + 2, L.ChatTabY, tabW - 4, L.ChatTabH,
                selected ? C.SendTop : C.ButtonTop,
                selected ? C.SendBottom : C.ButtonBottom,
                selected ? C.SendEdge : C.ButtonEdge, 5);
            kit.text(ctx, peer.name, x + tabW / 2, L.ChatTabY + 4,
                selected ? C.White : C.ButtonInk, {
                    size: 8,
                    weight: "700",
                    align: "center",
                });
            if (peer.unread && !selected) {
                kit.badge(ctx, x + tabW - 18, L.ChatTabY + 2, peer.unread);
            }
            kit.hit(x, L.ChatTabY, tabW, L.ChatTabH, function () {
                Ios6.state.peer = key;
                Ios6.redraw();
            });
        }
        ctx.fillStyle = kit.hex24(C.Rule);
        ctx.fillRect(0, L.ChatRuleY, W, 1);

        const link = Ios6.state.peer === "everyone" ? "SNR -8.6" : "SNR -12.7";
        kit.text(ctx, link, 312, L.ChatMetaY, C.Meta, { size: 8, align: "right" });

        const messages = thread.messages.slice();
        const spec = { size: 12, weight: "500" };
        const scroll = Ios6.state.chatScroll || 0;
        let cursor = L.ChatMetaY - 6;
        let painted = 0;
        const start = messages.length - 1 - scroll;
        for (let index = start; index >= 0; index -= 1) {
            const line = messages[index];
            const previous = index > 0 ? messages[index - 1] : null;
            const sameSpeaker = previous && previous.mine === line.mine &&
                (line.mine || previous.from === line.from);
            const named = !sameSpeaker && !line.mine && Ios6.state.peer === "everyone";
            const lines = kit.wrapLines(ctx, line.text, 216, spec);
            const textH = lines.length * kit.lineHeight(spec);
            const textW = Math.max.apply(null, lines.map(function (row) {
                return kit.measureWidth(ctx, row, spec);
            }));
            const width = Math.min(236, Math.max(48, Math.ceil(textW + 20)));
            const bubbleH = textH + L.ChatBubblePad;
            const header = named ? L.ChatNameH : 0;
            const delivered = line.mine && line.acked ? L.ChatDeliveredH : 0;
            if (cursor - bubbleH - header - delivered < L.ChatMsgY) break;
            cursor -= delivered;
            const bubbleY = cursor - bubbleH;
            const bubbleX = line.mine ? 310 - width : 10;
            kit.bubble(ctx, bubbleX, bubbleY, width, bubbleH, line.mine, line.viaNet);
            for (let row = 0; row < lines.length; row += 1) {
                kit.text(ctx, lines[row], bubbleX + 10, bubbleY + 6 + row * kit.lineHeight(spec), C.Ink, spec);
            }
            if (delivered) {
                kit.text(ctx, "DELIVERED", 310, bubbleY + bubbleH + 1, C.Meta, { size: 8, align: "right" });
            }
            if (header) {
                kit.text(ctx, line.from, 12, bubbleY - 10, C.Meta, { size: 8 });
            }
            cursor = bubbleY - header - L.ChatBubbleGap;
            painted += 1;
        }
        Ios6.state.messagesVisible = painted;
        const olderLeft = start - painted + 1;
        if (olderLeft > 0 || scroll > 0) {
            kit.panel(ctx, L.ChatOlderBtnX, L.ChatOlderY, L.ChatOlderBtnW, L.ChatOlderH,
                C.OlderTop, C.OlderBottom, C.OlderEdge, 5);
            kit.text(ctx, "OLDER", L.ChatOlderBtnX + L.ChatOlderBtnW / 2, L.ChatOlderY + 5, C.White, {
                size: 8,
                weight: "700",
                align: "center",
            });
            kit.panel(ctx, L.ChatNewerBtnX, L.ChatOlderY, L.ChatNewerBtnW, L.ChatOlderH,
                C.OlderTop, C.OlderBottom, C.OlderEdge, 5);
            kit.text(ctx, "NEWER", L.ChatNewerBtnX + L.ChatNewerBtnW / 2, L.ChatOlderY + 5, C.White, {
                size: 8,
                weight: "700",
                align: "center",
            });
            if (olderLeft > 0) {
                kit.hit(L.ChatOlderBtnX, L.ChatOlderY, L.ChatOlderBtnW, L.ChatOlderH, function () {
                    Ios6.state.chatScroll = scroll + 1;
                    Ios6.redraw();
                });
            }
            if (scroll > 0) {
                kit.hit(L.ChatNewerBtnX, L.ChatOlderY, L.ChatNewerBtnW, L.ChatOlderH, function () {
                    Ios6.state.chatScroll = Math.max(0, scroll - 1);
                    Ios6.redraw();
                });
            }
        }

        if (Ios6.state.txFailed) {
            kit.text(ctx, "TX FAILED", 10, L.ChatMetaY, C.Fault, { size: 8, weight: "700" });
        }

        kit.panel(ctx, -1, 180, 322, 44, C.BarTop, C.BarBottom, C.BarEdge, 0);
        kit.panel(ctx, 6, 186, 250, 30, C.InputTop, C.InputBottom, C.InputEdge, 15);
        const draft = Ios6.state.draft;
        kit.text(ctx, draft || "TYPE A MESSAGE", 18, 194,
            draft ? C.Ink : C.Placeholder, {
                size: draft ? 12 : 8,
                weight: draft ? "600" : "500",
            });
        if (draft) {
            const left = Math.max(0, 39 - draft.length);
            kit.text(ctx, String(left), 248, 196, left < 10 ? C.Fault : 0x8a8a8a, {
                size: 8,
                align: "right",
            });
        }
        kit.sendButton(ctx, L.ChatSendX, L.ChatSendY, L.ChatSendW, L.ChatSendH, "SEND", function () {
            Ios6.sendDraft();
        });
        kit.hit(6, 186, 250, 30, function () {
            Ios6.state.composerFocus = true;
        });
    }

    function drawNodes(ctx) {
        K().pinstripe(ctx, 0, 0, W, H);
        K().statusBar(ctx, clockText());
        K().navBar(ctx, L.StatusH, "Nodes");
        K().backButton(ctx, 4, L.StatusH + 5, "Home", go("home"));
        K().navButton(ctx, 252, L.StatusH + 5, 62, 18, "Chat", go("messages"));

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
        messages: { id: "messages", title: "Messages", hint: "The agent/ios6-chat-ui layout. Type, then SEND.", draw: drawMessages },
        nodes: { id: "nodes", title: "Nodes", hint: "A row opens that conversation.", draw: drawNodes },
        radio: { id: "radio", title: "Radio", hint: "LISTEN toggles the receiver caption.", draw: drawRadio },
        settings: { id: "settings", title: "Settings", hint: "The switch mirrors the RGB565 checkbox.", draw: drawSettings },
        kit: { id: "kit", title: "Kit", hint: "Shared primitives. Edit js/kit.js and refresh.", draw: drawKit },
    };

    Ios6.threads = THREADS;
})(window);
