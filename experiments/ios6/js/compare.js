// Onion-skin and RGB565 pixel-diff against a dropped reference frame.
// The kit screenshot is the source of truth, not memory.

(function (global) {
    const Ios6 = global.Ios6 || (global.Ios6 = {});
    const W = Ios6.SCREEN_WIDTH;
    const H = Ios6.SCREEN_HEIGHT;

    Ios6.compare = {
        mode: "off",
        onion: 0.5,
        cropY: 0,
        image: null,
        sourceW: 0,
        sourceH: 0,
        mismatch: null,
        maxCropY: 0,
    };

    function rgb565(r, g, b) {
        return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
    }

    function referenceFrame() {
        const image = Ios6.compare.image;
        if (!image) return null;
        const off = document.createElement("canvas");
        off.width = W;
        off.height = H;
        const ctx = off.getContext("2d");
        ctx.imageSmoothingEnabled = false;
        if (image.width === W) {
            ctx.drawImage(image, 0, -Ios6.compare.cropY);
        } else {
            const scale = W / image.width;
            ctx.drawImage(
                image,
                0,
                Ios6.compare.cropY / scale,
                image.width,
                H / scale,
                0,
                0,
                W,
                H
            );
        }
        return ctx.getImageData(0, 0, W, H);
    }

    function countMismatch(lab, reference) {
        let mismatch = 0;
        for (let index = 0; index < lab.length; index += 4) {
            const left = rgb565(lab[index], lab[index + 1], lab[index + 2]);
            const right = rgb565(reference[index], reference[index + 1], reference[index + 2]);
            if (left !== right) mismatch += 1;
        }
        return mismatch;
    }

    function paintDiff(ctx, lab, reference) {
        const out = ctx.createImageData(W, H);
        for (let index = 0; index < lab.length; index += 4) {
            const left = rgb565(lab[index], lab[index + 1], lab[index + 2]);
            const right = rgb565(reference[index], reference[index + 1], reference[index + 2]);
            if (left === right) {
                out.data[index] = 16;
                out.data[index + 1] = 16;
                out.data[index + 2] = 16;
                out.data[index + 3] = 255;
            } else {
                out.data[index] = 255;
                out.data[index + 1] = 79;
                out.data[index + 2] = 157;
                out.data[index + 3] = 255;
            }
        }
        ctx.putImageData(out, 0, 0);
    }

    function apply(ctx, labFrame) {
        Ios6.compare.mismatch = null;
        const reference = referenceFrame();
        if (!reference || Ios6.compare.mode === "off") return;
        Ios6.compare.mismatch = countMismatch(labFrame.data, reference.data);
        if (Ios6.compare.mode === "ref") {
            ctx.putImageData(reference, 0, 0);
            return;
        }
        if (Ios6.compare.mode === "diff") {
            paintDiff(ctx, labFrame.data, reference.data);
            return;
        }
        const labCanvas = document.createElement("canvas");
        labCanvas.width = W;
        labCanvas.height = H;
        labCanvas.getContext("2d").putImageData(labFrame, 0, 0);
        const refCanvas = document.createElement("canvas");
        refCanvas.width = W;
        refCanvas.height = H;
        refCanvas.getContext("2d").putImageData(reference, 0, 0);
        ctx.drawImage(labCanvas, 0, 0);
        ctx.save();
        ctx.globalAlpha = Ios6.compare.onion;
        ctx.drawImage(refCanvas, 0, 0);
        ctx.restore();
    }

    function setImage(image) {
        Ios6.compare.image = image;
        Ios6.compare.sourceW = image.width;
        Ios6.compare.sourceH = image.height;
        Ios6.compare.maxCropY = Math.max(0, image.height - H);
        const crop = document.getElementById("crop-y");
        if (crop) {
            crop.max = String(Ios6.compare.maxCropY);
            Ios6.compare.cropY = Math.min(Ios6.compare.cropY, Ios6.compare.maxCropY);
            crop.value = String(Ios6.compare.cropY);
        }
    }

    function loadFile(file) {
        const url = URL.createObjectURL(file);
        const image = new Image();
        image.onload = function () {
            setImage(image);
            Ios6.redraw();
            Ios6.syncCompareReadout();
        };
        image.src = url;
    }

    function loadUrl(url) {
        const image = new Image();
        image.onload = function () {
            setImage(image);
            Ios6.redraw();
            Ios6.syncCompareReadout();
        };
        image.onerror = function () {
            Ios6.compare.image = null;
        };
        image.src = url;
    }

    Ios6.compareApi = {
        apply: apply,
        loadFile: loadFile,
        loadUrl: loadUrl,
        countMismatch: countMismatch,
        rgb565: rgb565,
    };
})(window);
