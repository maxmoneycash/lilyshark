#if os(iOS) || os(macOS)
import ModelIO
import SceneKit
import SwiftUI

/// Interactive reconstruction of the T-Deck Plus. Drag horizontally to turn it;
/// a vertical flick pages firmware screens unless `pageOnVerticalDrag` is false,
/// so a parent ScrollView can take vertical pans. Idle motion floats the handset.
struct TDeckSceneView: View {
    var screenFileName: String
    var interactive: Bool = true
    var pageOnVerticalDrag: Bool = true
    var onVerticalPage: ((Int) -> Void)? = nil

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TDeckSceneKitRepresentable(
            screenFileName: screenFileName,
            interactive: interactive,
            pageOnVerticalDrag: pageOnVerticalDrag,
            reduceMotion: reduceMotion,
            onVerticalPage: onVerticalPage
        )
        .accessibilityElement()
        .accessibilityLabel("Lilyshark T-Deck")
        .accessibilityValue(screenFileName.replacingOccurrences(of: "-", with: " "))
        .accessibilityHint(interactiveHint)
        .accessibilityAddTraits(.updatesFrequently)
    }

    private var interactiveHint: String {
        guard interactive else { return "" }
        return pageOnVerticalDrag
            ? "Drag to turn the deck. Swipe up or down to change the screen."
            : "Drag sideways to turn the deck."
    }
}

#if os(iOS)
private struct TDeckSceneKitRepresentable: UIViewRepresentable {
    var screenFileName: String
    var interactive: Bool
    var pageOnVerticalDrag: Bool
    var reduceMotion: Bool
    var onVerticalPage: ((Int) -> Void)?

    func makeCoordinator() -> TDeckSceneCoordinator { TDeckSceneCoordinator() }

    func makeUIView(context: Context) -> SCNView {
        context.coordinator.makeView()
    }

    func updateUIView(_ uiView: SCNView, context: Context) {
        context.coordinator.update(
            screenFileName: screenFileName,
            interactive: interactive,
            pageOnVerticalDrag: pageOnVerticalDrag,
            reduceMotion: reduceMotion,
            onVerticalPage: onVerticalPage
        )
    }

    static func dismantleUIView(_ uiView: SCNView, coordinator: TDeckSceneCoordinator) {
        coordinator.stop()
    }
}
#else
private struct TDeckSceneKitRepresentable: NSViewRepresentable {
    var screenFileName: String
    var interactive: Bool
    var pageOnVerticalDrag: Bool
    var reduceMotion: Bool
    var onVerticalPage: ((Int) -> Void)?

    func makeCoordinator() -> TDeckSceneCoordinator { TDeckSceneCoordinator() }

    func makeNSView(context: Context) -> SCNView {
        context.coordinator.makeView()
    }

    func updateNSView(_ nsView: SCNView, context: Context) {
        context.coordinator.update(
            screenFileName: screenFileName,
            interactive: interactive,
            pageOnVerticalDrag: pageOnVerticalDrag,
            reduceMotion: reduceMotion,
            onVerticalPage: onVerticalPage
        )
    }

    static func dismantleNSView(_ nsView: SCNView, coordinator: TDeckSceneCoordinator) {
        coordinator.stop()
    }
}
#endif

@MainActor
final class TDeckSceneCoordinator: NSObject {
    private let restYaw: Float = -0.06
    private let restPitch: Float = 0.06
    private var yaw: Float = -0.06
    private var pitch: Float = 0.06
    private var time: TimeInterval = 0
    private var lastTick: TimeInterval = 0
    private var dragging = false
    private var paging = false
    private var lastPan = CGPoint.zero
    private var panStart = CGPoint.zero
    private var currentScreen = ""
    private var interactive = true
    private var pageOnVerticalDrag = true
    private var reduceMotion = false
    private var onVerticalPage: ((Int) -> Void)?
    private var rig: SCNNode?
    private var lcdNodes: [SCNNode] = []
    private var timer: Timer?
    private weak var view: SCNView?

    func makeView() -> SCNView {
        let view = SCNView()
        self.view = view
        view.backgroundColor = .clear
        view.antialiasingMode = .multisampling4X
        view.autoenablesDefaultLighting = false
        view.allowsCameraControl = false
        view.isPlaying = true
        #if os(iOS)
        view.isOpaque = false
        #endif
        loadScene(into: view)
        addPan(to: view)
        startTimer()
        return view
    }

    func update(screenFileName: String, interactive: Bool, pageOnVerticalDrag: Bool, reduceMotion: Bool, onVerticalPage: ((Int) -> Void)?) {
        self.interactive = interactive
        self.pageOnVerticalDrag = pageOnVerticalDrag
        self.reduceMotion = reduceMotion
        self.onVerticalPage = onVerticalPage
        applyScreen(screenFileName)
        view?.isPlaying = !reduceMotion || dragging
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        view?.scene = nil
    }

    private func loadScene(into view: SCNView) {
        let scene = SCNScene()
        scene.background.contents = nil
        let hasEnvironment = Self.installBlenderEnvironment(in: scene)

        let cameraNode = SCNNode()
        let camera = SCNCamera()
        camera.usesOrthographicProjection = true
        camera.orthographicScale = 0.072
        camera.zNear = 0.001
        camera.zFar = 8
        cameraNode.camera = camera
        cameraNode.position = vec(0, 0.02, 1.2)
        cameraNode.look(at: vec(0, 0.018, 0))
        scene.rootNode.addChildNode(cameraNode)

        if !hasEnvironment {
            let ambient = SCNNode()
            ambient.light = SCNLight()
            ambient.light?.type = .ambient
            ambient.light?.intensity = 400
            ambient.light?.color = MeshTheme.scnWhite
            scene.rootNode.addChildNode(ambient)

            let hemi = SCNNode()
            hemi.light = SCNLight()
            hemi.light?.type = .directional
            hemi.light?.intensity = 700
            hemi.eulerAngles = vec(-0.4, 0.35, 0)
            scene.rootNode.addChildNode(hemi)

            for (x, y, z, intensity) in [(-0.3, 0.2, 0.5, 900), (0.3, 0.1, -0.3, 600), (0.2, -0.2, 0.4, 350)] {
                let node = SCNNode()
                node.light = SCNLight()
                node.light?.type = .directional
                node.light?.intensity = CGFloat(intensity)
                node.position = vec(Float(x), Float(y), Float(z))
                node.look(at: vec(0, 0, 0))
                scene.rootNode.addChildNode(node)
            }
        }

        let rig = SCNNode()
        rig.name = "TDeckRig"
        self.rig = rig
        scene.rootNode.addChildNode(rig)

        let content = SCNNode()
        content.name = "TDeckContent"
        if let url = TDeckScreen.modelURL {
            let loaded = (try? SCNScene(url: url, options: nil))
                ?? SCNSceneSource(url: url, options: nil)?.scene(options: nil)
            if let model = loaded {
                for child in model.rootNode.childNodes {
                    content.addChildNode(child)
                }
            }
        }
        let loadedSize = content.boundingBox
        if loadedSize.max.x - loadedSize.min.x < 0.001 {
            let placeholder = SCNBox(width: 0.073, height: 0.115, length: 0.022, chamferRadius: 0.004)
            placeholder.firstMaterial = SCNMaterial()
            placeholder.firstMaterial?.diffuse.contents = MeshTheme.scnAccent
            let node = SCNNode(geometry: placeholder)
            node.name = "LilysharkLCD"
            content.addChildNode(node)
        }
        // The USDZ lies flat with the screen facing -Y and the antenna along
        // +Z. Pitch it forward so the screen faces the camera and the antenna
        // points up, matching the website.
        content.eulerAngles = vec(-Float.pi / 2, 0, 0)
        rig.addChildNode(content)
        lcdNodes = Self.findLCDNodes(in: content)
        applyScreen(currentScreen.isEmpty ? "home" : currentScreen)
        frameModel(content, camera: camera, cameraNode: cameraNode)
        view.scene = scene
        applyPose()
    }

    /// Blender 4.5's material-preview HDRI (forest.exr), pre-rotated to Y-up so
    /// SceneKit samples it the way Blender's viewport does. With it the model is
    /// lit by the environment alone, matching the website. Falls back to flat
    /// white plus lamps when the texture is missing.
    private static func installBlenderEnvironment(in scene: SCNScene) -> Bool {
        guard let url = TDeckScreen.environmentURL else {
            scene.lightingEnvironment.contents = MeshTheme.scnWhite
            scene.lightingEnvironment.intensity = 1.4
            return false
        }
        scene.lightingEnvironment.contents = MDLURLTexture(url: url, name: "blender-forest")
        scene.lightingEnvironment.intensity = 1
        return true
    }

    private func frameModel(_ rig: SCNNode, camera: SCNCamera, cameraNode: SCNNode) {
        let box = rig.boundingBox
        let lo = box.min
        let hi = box.max
        let sx = hi.x - lo.x
        let sy = hi.y - lo.y
        let sz = hi.z - lo.z
        guard sx > 0 || sy > 0 || sz > 0 else { return }
        let cx = (lo.x + hi.x) / 2
        let cy = (lo.y + hi.y) / 2
        let cz = (lo.z + hi.z) / 2
        rig.position = vec(Float(-cx), Float(-cy), Float(-cz))
        // Crop the whip so the handset fills the stage, matching the website.
        let handset = Swift.min(Double(sy), 0.13)
        camera.orthographicScale = CGFloat(Swift.max(handset * 0.62, 0.04))
        let lookY = Float(-sy * 0.22)
        cameraNode.position = vec(0, lookY, 1.2)
        cameraNode.look(at: vec(0, lookY, 0))
    }

    private static func findLCDNodes(in root: SCNNode) -> [SCNNode] {
        var found: [SCNNode] = []
        root.enumerateChildNodes { node, _ in
            let name = node.name ?? ""
            let materialNames = (node.geometry?.materials ?? []).compactMap(\.name).joined(separator: " ")
            if name.localizedCaseInsensitiveContains("LilysharkLCD")
                || name.localizedCaseInsensitiveContains("LCD")
                || materialNames.localizedCaseInsensitiveContains("LCD") {
                found.append(node)
            }
        }
        // The model's own LCD glass takes the firmware frame, like the
        // website retexturing the same mesh. The LilysharkLCD box is the
        // placeholder used when the model failed to load.
        let glass = found.filter { ($0.name ?? "").localizedCaseInsensitiveContains("LCD_glass") }
        if !glass.isEmpty { return glass }
        let overlay = found.filter { ($0.name ?? "").localizedCaseInsensitiveContains("LilysharkLCD") }
        return overlay.isEmpty ? found : overlay
    }

    private func applyScreen(_ fileName: String) {
        guard fileName != currentScreen else { return }
        currentScreen = fileName
        guard let url = TDeckScreen.imageURL(for: fileName) else { return }
        #if os(iOS)
        let contents: Any? = UIImage(contentsOfFile: url.path)
        #else
        let contents: Any? = NSImage(contentsOf: url)
        #endif
        guard let contents else { return }
        let targets = lcdNodes.isEmpty ? Array((rig?.childNodes ?? [])) : lcdNodes
        for node in targets {
            apply(contents, to: node)
        }
        #if os(iOS)
        view?.setNeedsDisplay()
        #else
        view?.needsDisplay = true
        #endif
    }

    private func apply(_ contents: Any, to node: SCNNode) {
        if let geometry = node.geometry {
            if geometry.materials.isEmpty {
                geometry.firstMaterial = SCNMaterial()
            }
            for material in geometry.materials {
                material.lightingModel = .constant
                material.diffuse.contents = contents
                material.emission.contents = contents
                material.emission.intensity = 1
                material.multiply.contents = nil
                material.transparent.contents = nil
                material.diffuse.wrapS = .clamp
                material.diffuse.wrapT = .clamp
                material.isDoubleSided = false
            }
        }
        for child in node.childNodes {
            apply(contents, to: child)
        }
    }

    private func addPan(to view: SCNView) {
        #if os(iOS)
        let pan = UIPanGestureRecognizer(target: self, action: #selector(handlePan(_:)))
        pan.maximumNumberOfTouches = 1
        pan.delegate = self
        view.addGestureRecognizer(pan)
        #else
        let pan = NSPanGestureRecognizer(target: self, action: #selector(handleMacPan(_:)))
        view.addGestureRecognizer(pan)
        #endif
    }

    #if os(iOS)
    @objc private func handlePan(_ gesture: UIPanGestureRecognizer) {
        handle(translation: gesture.translation(in: gesture.view), state: gesture.state.rawValue, isEnded: gesture.state == .ended || gesture.state == .cancelled)
        if gesture.state == .ended || gesture.state == .cancelled {
            gesture.setTranslation(.zero, in: gesture.view)
        }
    }
    #else
    @objc private func handleMacPan(_ gesture: NSPanGestureRecognizer) {
        let translation = gesture.translation(in: gesture.view)
        handle(translation: CGPoint(x: translation.x, y: -translation.y), state: gesture.state.rawValue, isEnded: gesture.state == .ended || gesture.state == .cancelled)
    }
    #endif

    private func handle(translation: CGPoint, state: Int, isEnded: Bool) {
        guard interactive else { return }
        if state == 1 { // began
            panStart = translation
            lastPan = translation
            dragging = false
            paging = false
            return
        }
        let dx = translation.x - panStart.x
        let dy = translation.y - panStart.y
        if !dragging && !paging {
            if pageOnVerticalDrag, abs(dy) > abs(dx) && abs(dy) > 8 {
                paging = true
            } else if abs(dx) > 8 {
                dragging = true
                lastPan = translation
            }
        }
        if dragging {
            yaw += Float(translation.x - lastPan.x) * 0.012
            pitch = max(-0.65, min(0.65, pitch + Float(translation.y - lastPan.y) * 0.008))
            lastPan = translation
            applyPose()
        }
        if isEnded {
            if paging, abs(dy) > 40 {
                onVerticalPage?(dy < 0 ? 1 : -1)
            }
            dragging = false
            paging = false
        }
    }

    private func startTimer() {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 1.0 / 30.0, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
    }

    private func tick() {
        let now = CACurrentMediaTime()
        let dt = lastTick == 0 ? 1.0 / 30.0 : min(now - lastTick, 0.04)
        lastTick = now
        guard !reduceMotion, !dragging else {
            applyPose()
            return
        }
        time += dt
        let settle = Float(1 - exp(-4.2 * dt))
        yaw += (restYaw - yaw) * settle
        pitch += (restPitch - pitch) * settle
        applyPose()
    }

    private func applyPose() {
        guard let rig else { return }
        let breathe: Float = (reduceMotion || dragging) ? 0 : 1
        let t = Float(time)
        rig.eulerAngles = vec(
            pitch + sin(t * 0.55) * 0.012 * breathe,
            yaw,
            -0.03 + sin(t * 0.4) * 0.008 * breathe
        )
        rig.position = vec(0, sin(t * 0.7) * 0.0015 * breathe, 0)
    }

    private func vec(_ x: Float, _ y: Float, _ z: Float) -> SCNVector3 {
        #if os(macOS)
        SCNVector3(CGFloat(x), CGFloat(y), CGFloat(z))
        #else
        SCNVector3(x, y, z)
        #endif
    }
}

#if os(iOS)
extension TDeckSceneCoordinator: UIGestureRecognizerDelegate {
    /// Inside a scrolling welcome, only sideways drags belong to the model.
    func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        guard !pageOnVerticalDrag, let pan = gestureRecognizer as? UIPanGestureRecognizer else {
            return true
        }
        let velocity = pan.velocity(in: pan.view)
        return abs(velocity.x) >= abs(velocity.y)
    }
}
#endif

private extension MeshTheme {
    static var scnWhite: Any {
        #if os(iOS)
        UIColor.white
        #else
        NSColor.white
        #endif
    }

    static var scnAccent: Any {
        #if os(iOS)
        UIColor(red: 1, green: 0.22, blue: 0.62, alpha: 1)
        #else
        NSColor(red: 1, green: 0.22, blue: 0.62, alpha: 1)
        #endif
    }
}
#endif
