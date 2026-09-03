/**
 * Which protocol a capture profile id means.
 *
 * This existed three times over — in the dissection tree, in the
 * conversation follower, and in the display filter — and all three said
 * profile 4 was Reticulum. That was true of the firmware they were written
 * against and false of this one, where profile 4 is MESHTASTIC BAY MF, the
 * Bay Area community's Medium Range Fast slot. Three copies meant one wrong
 * fact appearing three times, and each copy's own tests certifying it.
 *
 * So there is one table now, and its authority is named: the profile list in
 * src/core/builtin_profiles.cpp. When a profile is added or repurposed there,
 * this is the single place that has to follow.
 */

/** The protocols a profile can name. */
export type ProfileProtocol = "meshtastic" | "meshcore" | "reticulum" | "custom" | "unknown";

/**
 * Profile id to protocol, mirroring src/core/builtin_profiles.cpp:
 *   1 MESHTASTIC US LF, 2 MESHCORE US, 3 MESHCORE LEGACY,
 *   4 MESHTASTIC BAY MF, 5 RNODE EXAMPLE US.
 * Id 0 means the firmware named no profile at all, which is not the same as
 * naming one we do not recognise: the first is silence, the second is a
 * profile this build predates.
 */
export function profileProtocol(profileId: number | null | undefined): ProfileProtocol {
	if (profileId === null || profileId === undefined || profileId === 0) return "unknown";
	switch (profileId) {
		case 1:
		case 4:
			return "meshtastic";
		case 2:
		case 3:
			return "meshcore";
		case 5:
			return "reticulum";
		default:
			return "custom";
	}
}
