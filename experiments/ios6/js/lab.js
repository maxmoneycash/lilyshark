(function (global) {
    const Ios6 = global.Ios6 || (global.Ios6 = {});
    const W = Ios6.SCREEN_WIDTH;
    const H = Ios6.SCREEN_HEIGHT;

    Ios6.state = {
        screen: "home",
        scale: 2,
        font: "helvetica",
        rgb565: false,
        peer: "everyone",
        chatScroll: 0,
        messagesVisible: 0,
        messagesStatusChrome: false,
        messagesInbox: false,
        draft: "",
        composerFocus: false,
        txFailed: false,
        nodeIndex: -1,
        listening: true,
        unlockSlide: 0,
        unlockTrack: null,
        dragging: false,
        shimmer: 40,
        now: new Date(),
        colorCount: 0,
    };
    Ios6.hits = [];

    const FONT_LABEL = {
        helvetica: "Helvetica",
        barlow: "Barlow",
        pixel: "Pixel 6×8",
    };

    function canvas() {
        return document.getElementById("panel");
    }

    function logicalCanvas() {
        if (!Ios6.logical) {
            Ios6.logical = document.createElement("canvas");
            Ios6.logical.width = W;
            Ios6.logical.height = H;
        }
        return Ios6.logical;
    }

    function displayBacking() {
        if (Ios6.state.rgb565 || Ios6.state.font === "pixel") return 1;
        return Ios6.state.scale;
    }

    function applyScale() {
        const node = canvas();
        const scale = Ios6.state.scale;
        const backing = displayBacking();
        if (node.width !== W * backing || node.height !== H * backing) {
            node.width = W * backing;
            node.height = H * backing;
        }
        node.style.width = (W * scale) + "px";
        node.style.height = (H * scale) + "px";
        node.classList.toggle("device-pixels", Ios6.state.rgb565 || Ios6.state.font === "pixel");
        document.getElementById("scale-readout").textContent = scale + "×";
        document.querySelectorAll("#scale-row button").forEach(function (button) {
            button.setAttribute("aria-pressed", button.getAttribute("data-scale") === String(scale));
        });
    }
    Ios6.applyScale = applyScale;

    function paintFrame(ctx, width, height, recordHits) {
        const savedHits = Ios6.hits;
        if (recordHits) Ios6.hits = [];
        else Ios6.hits = [];
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, width, height);
        ctx.setTransform(width / W, 0, 0, height / H, 0, 0);
        ctx.imageSmoothingEnabled = Ios6.state.font !== "pixel";
        const screen = Ios6.screens[Ios6.state.screen];
        if (screen) screen.draw(ctx);
        ctx.restore();
        if (!recordHits) Ios6.hits = savedHits;
    }

    function syncScreenList() {
        const list = document.getElementById("screen-list");
        list.replaceChildren();
        Ios6.SCREEN_ORDER.forEach(function (id) {
            const screen = Ios6.screens[id];
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = screen.title;
            button.setAttribute("aria-current", id === Ios6.state.screen ? "page" : "false");
            button.addEventListener("click", function () {
                Ios6.open(id);
            });
            list.appendChild(button);
        });
        const meta = Ios6.screens[Ios6.state.screen];
        document.getElementById("hint").textContent = meta ? meta.hint : "";
        document.getElementById("font-readout").textContent = FONT_LABEL[Ios6.state.font];
    }

    Ios6.open = function (id) {
        if (!Ios6.screens[id]) return;
        Ios6.state.screen = id;
        Ios6.state.composerFocus = id === "messages";
        Ios6.state.unlockSlide = 0;
        if (location.hash !== "#" + id) location.hash = id;
        Ios6.redraw();
        syncScreenList();
    };

    Ios6.sendDraft = function () {
        const draft = Ios6.state.draft.trim();
        if (!draft) return;
        const thread = Ios6.threads[Ios6.state.peer];
        if (!thread) return;
        thread.messages.push({
            from: "ME",
            text: draft,
            mine: true,
            acked: true,
            viaNet: thread.service === "sms" ? "sms" : "imessage",
        });
        Ios6.state.chatScroll = 0;
        Ios6.state.draft = "";
        Ios6.redraw();
    };

    Ios6.redraw = function () {
        applyScale();
        Ios6.state.now = new Date();
        const node = canvas();
        const logical = logicalCanvas();
        const displayCtx = node.getContext("2d");
        const logicalCtx = logical.getContext("2d");

        paintFrame(displayCtx, node.width, node.height, true);
        if (Ios6.state.rgb565) {
            const frame = displayCtx.getImageData(0, 0, W, H);
            Ios6.kit.quantizeImageData(frame.data);
            displayCtx.putImageData(frame, 0, 0);
        }

        paintFrame(logicalCtx, W, H, false);
        if (Ios6.state.rgb565) {
            const frame = logicalCtx.getImageData(0, 0, W, H);
            Ios6.kit.quantizeImageData(frame.data);
            logicalCtx.putImageData(frame, 0, 0);
        }
        const labFrame = logicalCtx.getImageData(0, 0, W, H);
        Ios6.state.colorCount = Ios6.kit.countColors(labFrame.data, Ios6.state.rgb565);
        document.getElementById("color-count").textContent =
            Ios6.state.colorCount.toLocaleString("en-US");
        if (Ios6.compareApi) Ios6.compareApi.apply(logicalCtx, labFrame);
        if (Ios6.compare.mode !== "off" && Ios6.compare.image && node.width !== W) {
            displayCtx.save();
            displayCtx.setTransform(1, 0, 0, 1, 0, 0);
            displayCtx.imageSmoothingEnabled = false;
            displayCtx.clearRect(0, 0, node.width, node.height);
            displayCtx.drawImage(logical, 0, 0, node.width, node.height);
            displayCtx.restore();
        }
        Ios6.syncCompareReadout();
    };

    Ios6.syncCompareReadout = function () {
        const node = document.getElementById("mismatch");
        if (!node) return;
        if (!Ios6.compare.image) {
            node.textContent = "no reference";
            return;
        }
        if (Ios6.compare.mismatch === null) {
            node.textContent = Ios6.compare.sourceW + "×" + Ios6.compare.sourceH;
            return;
        }
        const pct = ((Ios6.compare.mismatch / (W * H)) * 100).toFixed(1);
        node.textContent = Ios6.compare.mismatch.toLocaleString("en-US") +
            " px (" + pct + "%)";
    };

    function eventToPanel(event) {
        const rect = canvas().getBoundingClientRect();
        return {
            x: (event.clientX - rect.left) * W / rect.width,
            y: (event.clientY - rect.top) * H / rect.height,
        };
    }

    function hitAt(x, y) {
        for (let index = Ios6.hits.length - 1; index >= 0; index -= 1) {
            const region = Ios6.hits[index];
            if (x >= region.x && x < region.x + region.w &&
                y >= region.y && y < region.y + region.h) {
                return region;
            }
        }
        return null;
    }

    function onPointerDown(event) {
        const point = eventToPanel(event);
        if (Ios6.state.screen === "lock") {
            const track = Ios6.state.unlockTrack;
            if (track && point.y >= track.y && point.y <= track.y + track.h &&
                point.x >= track.x && point.x <= track.x + track.w) {
                if (point.x > track.x + track.w * 0.72) {
                    Ios6.open("home");
                    return;
                }
                Ios6.state.dragging = true;
                canvas().setPointerCapture(event.pointerId);
                return;
            }
        }
        const region = hitAt(point.x, point.y);
        if (region && region.action) region.action();
    }

    function onPointerMove(event) {
        if (!Ios6.state.dragging || Ios6.state.screen !== "lock") return;
        const track = Ios6.state.unlockTrack;
        if (!track) return;
        const point = eventToPanel(event);
        const max = track.w - track.knobW - 4;
        Ios6.state.unlockSlide = Math.max(0, Math.min(max, point.x - track.x - track.knobW / 2));
        Ios6.redraw();
    }

    function onPointerUp() {
        if (!Ios6.state.dragging) return;
        Ios6.state.dragging = false;
        const track = Ios6.state.unlockTrack;
        const max = track ? track.w - track.knobW - 4 : 0;
        if (Ios6.state.unlockSlide > max * 0.72) {
            Ios6.open("home");
        } else {
            Ios6.state.unlockSlide = 0;
            Ios6.redraw();
        }
    }

    function onKeyDown(event) {
        if (Ios6.state.screen !== "messages") return;
        if (event.key === "Enter") {
            Ios6.sendDraft();
            event.preventDefault();
            return;
        }
        if (event.key === "Backspace") {
            Ios6.state.draft = Ios6.state.draft.slice(0, -1);
            Ios6.redraw();
            event.preventDefault();
            return;
        }
        if (event.key === "Tab") {
            const order = ["everyone", "fjell", "hytta"];
            if (Ios6.state.messagesInbox) {
                Ios6.state.messagesInbox = false;
            } else {
                const index = order.indexOf(Ios6.state.peer);
                Ios6.state.peer = order[(index + 1) % order.length];
            }
            Ios6.redraw();
            event.preventDefault();
            return;
        }
        if (event.key.length === 1 && Ios6.state.draft.length < 39) {
            Ios6.state.messagesInbox = false;
            Ios6.state.draft += event.key;
            Ios6.redraw();
            event.preventDefault();
        }
    }

    function tick(now) {
        Ios6.state.shimmer = 40 + ((now / 12) % 260);
        if (Ios6.state.screen === "lock" && !Ios6.state.dragging) Ios6.redraw();
        requestAnimationFrame(tick);
    }

    async function loadFaces() {
        const faces = [
            new FontFace("Barlow Condensed", "url(../../assets/fonts/BarlowCondensed-Medium.ttf)", { weight: "500" }),
            new FontFace("Barlow Condensed", "url(../../assets/fonts/BarlowCondensed-Bold.ttf)", { weight: "700" }),
            new FontFace("IBM Plex Mono", "url(../../assets/fonts/IBMPlexMono-SemiBold.ttf)", { weight: "600" }),
            new FontFace("Inter Thin", "url(fonts/Inter-Thin.woff2)", { weight: "100" }),
        ];
        try {
            await Promise.all(faces.map(function (face) {
                return face.load().then(function (loaded) {
                    document.fonts.add(loaded);
                });
            }));
        } catch (_error) {
            // file:// or a missing face still runs on Helvetica / Arial
        }
    }

    function bind() {
        document.getElementById("font-face").addEventListener("change", function (event) {
            Ios6.state.font = event.target.value;
            applyScale();
            Ios6.redraw();
            syncScreenList();
        });
        document.getElementById("rgb565").addEventListener("change", function (event) {
            Ios6.state.rgb565 = event.target.checked;
            applyScale();
            Ios6.redraw();
        });
        document.getElementById("messages-chrome").addEventListener("change", function (event) {
            Ios6.state.messagesStatusChrome = event.target.checked;
            Ios6.redraw();
        });
        document.querySelectorAll("#scale-row button").forEach(function (button) {
            button.addEventListener("click", function () {
                Ios6.state.scale = Number(button.getAttribute("data-scale"));
                applyScale();
                Ios6.redraw();
            });
        });
        document.getElementById("compare-mode").addEventListener("change", function (event) {
            Ios6.compare.mode = event.target.value;
            Ios6.redraw();
        });
        document.getElementById("onion").addEventListener("input", function (event) {
            Ios6.compare.onion = Number(event.target.value) / 100;
            Ios6.redraw();
        });
        document.getElementById("crop-y").addEventListener("input", function (event) {
            Ios6.compare.cropY = Number(event.target.value);
            Ios6.redraw();
        });
        document.getElementById("ref-file").addEventListener("change", function (event) {
            const file = event.target.files && event.target.files[0];
            if (file) Ios6.compareApi.loadFile(file);
        });
        const node = canvas();
        node.addEventListener("pointerdown", onPointerDown);
        node.addEventListener("pointermove", onPointerMove);
        node.addEventListener("pointerup", onPointerUp);
        node.addEventListener("pointercancel", onPointerUp);
        node.addEventListener("wheel", function (event) {
            if (Ios6.state.screen !== "messages" || Ios6.state.messagesInbox) return;
            const thread = Ios6.threads[Ios6.state.peer];
            const maxScroll = thread ? Math.max(0, thread.messages.length - 1) : 0;
            if (event.deltaY < 0) {
                Ios6.state.chatScroll = Math.min(maxScroll, (Ios6.state.chatScroll || 0) + 1);
            } else if (event.deltaY > 0) {
                Ios6.state.chatScroll = Math.max(0, (Ios6.state.chatScroll || 0) - 1);
            }
            Ios6.redraw();
            event.preventDefault();
        }, { passive: false });
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("hashchange", function () {
            const id = location.hash.replace("#", "");
            if (id && id !== Ios6.state.screen && Ios6.screens[id]) Ios6.open(id);
        });
    }

    Ios6.selftest = function () {
        const report = { screens: {}, send: false };
        Ios6.SCREEN_ORDER.forEach(function (id) {
            Ios6.state.screen = id;
            Ios6.state.unlockSlide = 0;
            Ios6.redraw();
            const frame = logicalCanvas().getContext("2d").getImageData(0, 0, W, H);
            let ink = 0;
            for (let index = 0; index < frame.data.length; index += 4) {
                if (frame.data[index] | frame.data[index + 1] | frame.data[index + 2]) ink += 1;
            }
            report.screens[id] = {
                colors: Ios6.state.colorCount,
                painted: ink,
                blank: ink < 200,
            };
        });
        Ios6.state.peer = "everyone";
        Ios6.state.chatScroll = 0;
        Ios6.state.messagesInbox = false;
        Ios6.state.screen = "messages";
        Ios6.redraw();
        report.everyoneBubbles = Ios6.state.messagesVisible;
        Ios6.state.messagesStatusChrome = true;
        Ios6.redraw();
        report.chromeOn = Ios6.state.messagesStatusChrome === true &&
            Ios6.state.colorCount > 200;
        Ios6.state.messagesStatusChrome = false;
        const before = Ios6.threads.everyone.messages.length;
        Ios6.state.draft = "hello ridge";
        Ios6.sendDraft();
        const last = Ios6.threads.everyone.messages[Ios6.threads.everyone.messages.length - 1];
        report.send = Ios6.threads.everyone.messages.length === before + 1 &&
            last.text === "hello ridge" && last.mine === true;
        Ios6.state.screen = "home";
        Ios6.state.rgb565 = false;
        Ios6.redraw();
        report.homeFull = Ios6.state.colorCount;
        Ios6.state.rgb565 = true;
        Ios6.redraw();
        report.home565 = Ios6.state.colorCount;
        report.ok = !Ios6.SCREEN_ORDER.some(function (id) {
            return report.screens[id].blank;
        }) && report.send && report.everyoneBubbles >= 3 && report.chromeOn &&
            report.home565 > 200 && report.homeFull >= report.home565;
        return report;
    };

    Ios6.start = async function () {
        bind();
        applyScale();
        await loadFaces();
        Ios6.compareApi.loadUrl("reference/chat.png");
        if (/\bchrome=1\b/.test(location.search)) {
            Ios6.state.messagesStatusChrome = true;
            const box = document.getElementById("messages-chrome");
            if (box) box.checked = true;
        }
        const initial = location.hash.replace("#", "");
        Ios6.open(Ios6.screens[initial] ? initial : "home");
        if (/\bselftest=1\b/.test(location.search)) {
            const report = Ios6.selftest();
            const pre = document.createElement("pre");
            pre.id = "selftest";
            pre.textContent = JSON.stringify(report, null, 2);
            document.body.appendChild(pre);
        }
        requestAnimationFrame(tick);
    };

    document.addEventListener("DOMContentLoaded", function () {
        Ios6.start();
    });
})(window);
