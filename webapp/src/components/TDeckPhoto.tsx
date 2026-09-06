import "./tdeck-photo.css";

export const TDECK_IMAGE = "/intro/tdeck.webp";
// Measured display aperture in the same front-facing photo used by Intro.
export const TDECK_SCREEN = {
  left: 0.0619,
  top: 0.3656,
  width: 0.8704,
  height: 0.2921,
};

export function TDeckPhoto({
  screen = "/intro/fw/home.png",
  alt,
}: {
  screen?: string;
  alt: string;
}) {
  return (
    <div className="tdeck-photo" role="img" aria-label={alt}>
      <img
        className="tdeck-photo-body"
        src={TDECK_IMAGE}
        width={517}
        height={1116}
        alt=""
        draggable={false}
      />
      <img
        className="tdeck-photo-screen"
        src={screen}
        width={320}
        height={240}
        alt=""
        draggable={false}
        style={{
          left: `${TDECK_SCREEN.left * 100}%`,
          top: `${TDECK_SCREEN.top * 100}%`,
          width: `${TDECK_SCREEN.width * 100}%`,
          height: `${TDECK_SCREEN.height * 100}%`,
        }}
      />
    </div>
  );
}
