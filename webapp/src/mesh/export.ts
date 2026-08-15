// Browser download: a Blob behind a temporary <a download>. There is no real
// "save as" path to return, so the filename doubles as the confirmation.
export async function saveText(
  filename: string,
  text: string,
): Promise<string | undefined> {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // revoke after the click has been processed; immediate revoke races the download
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return filename;
}

export function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}
