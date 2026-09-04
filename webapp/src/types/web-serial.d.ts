/**
 * The Web Serial API, as much of it as `lib/deviceLink.ts` actually uses.
 *
 * TypeScript's DOM library does not ship these: Web Serial is a separate
 * specification and its types live in a `@types` package. Without them every
 * `SerialPort` in deviceLink.ts was an unresolved name and `navigator.serial`
 * was `unknown` — fourteen compiler errors in the one file that drives the
 * USB link to the deck. That went unnoticed because the build uses esbuild,
 * which strips types without checking them, so the app compiled and shipped
 * with its serial layer entirely unchecked.
 *
 * Declared here rather than pulled in as a dependency: this is the whole
 * surface we touch, it is small, and writing it out means an accidental
 * change to how we open the port is a compile error rather than a device that
 * silently fails to connect. Anything Web Serial offers that we do not use is
 * deliberately absent — this file is not trying to be the specification.
 *
 * Spec: https://wicg.github.io/serial/
 */

interface SerialPortInfo {
	/** USB vendor id, present only for USB devices. The T-Deck is 0x303a. */
	usbVendorId?: number;
	usbProductId?: number;
}

interface SerialOptions {
	baudRate: number;
	dataBits?: number;
	stopBits?: number;
	parity?: "none" | "even" | "odd";
	bufferSize?: number;
	flowControl?: "none" | "hardware";
}

interface SerialPort {
	readonly readable: ReadableStream<Uint8Array> | null;
	readonly writable: WritableStream<Uint8Array> | null;
	open(options: SerialOptions): Promise<void>;
	close(): Promise<void>;
	getInfo(): SerialPortInfo;
	/**
	 * Drop DTR/RTS after opening, which keeps an ESP32-S3 out of its
	 * bootloader. Not implemented on every platform, so every call is
	 * wrapped in a try/catch rather than feature-detected.
	 */
	setSignals(signals: {
		dataTerminalReady?: boolean;
		requestToSend?: boolean;
		break?: boolean;
	}): Promise<void>;
}

interface SerialPortFilter {
	usbVendorId?: number;
	usbProductId?: number;
}

interface SerialPortRequestOptions {
	filters?: SerialPortFilter[];
}

interface Serial {
	getPorts(): Promise<SerialPort[]>;
	requestPort(options?: SerialPortRequestOptions): Promise<SerialPort>;
}

interface Navigator {
	/**
	 * Absent on Safari and on any non-secure origin, which is why every call
	 * site checks for it before use rather than assuming a browser has it.
	 */
	readonly serial: Serial;
}
