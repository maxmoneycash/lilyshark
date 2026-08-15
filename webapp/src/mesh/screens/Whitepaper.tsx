import { useState } from "react";
import { t, useLangTick } from "../i18n";

/**
 * WHITEPAPER — the Lilyshark document inside the terminal. The PDF lives in
 * public/ and opens in an inline reader; it can also be downloaded.
 */

const PDF_URL = "/lilyshark-whitepaper.pdf";

export default function Whitepaper() {
	useLangTick();
	const [reading, setReading] = useState(false);

	return (
		<div className="panel" style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
			<div className="panel-title">
				<span>WHITEPAPER</span>
				<span className="dim" style={{ marginLeft: "auto" }}>
					lilyshark-whitepaper.pdf
				</span>
			</div>
			<div className="panel-actions">
				<button type="button" onClick={() => setReading((v) => !v)}>
					{reading ? t("CERRAR LECTOR") : t("ABRIR LECTOR")}
				</button>
				<a href={PDF_URL} download="lilyshark-whitepaper.pdf">
					<button type="button">{t("DESCARGAR PDF")}</button>
				</a>
				<span className="dim" style={{ alignSelf: "center" }}>
					{t("Wireshark para la malla de radio: captura LoRa en el T-Deck, análisis en la web, capturas y punteros off-grid sobre Shelby.")}
				</span>
			</div>
			{reading && (
				<iframe
					title="Lilyshark whitepaper"
					src={PDF_URL}
					style={{
						border: "none",
						borderTop: "1px solid var(--border)",
						flex: 1,
						minHeight: "60vh",
						background: "var(--panel)",
					}}
				/>
			)}
		</div>
	);
}
