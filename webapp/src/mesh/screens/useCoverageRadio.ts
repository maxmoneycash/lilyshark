import { useSyncExternalStore } from 'react';
import { useDeviceLink } from '../../lib/deviceLink';
import { validCoordinates } from '../../lib/meshmapper';
import { isDemo } from '../demo';
import { meshtasticBleActive } from '../meshtasticBle';
import { DeviceStatus, getSnapshot, subscribe } from '../store';

/** A transport link and a usable reported position are independent facts. */
export function useCoverageRadio() {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const link = useDeviceLink();
  const configured = !isDemo() && (state.status ?? 0) >= DeviceStatus.Configured;
  const realMeshtastic = configured && meshtasticBleActive();
  const realMeshCore = configured && !realMeshtastic && !!state.selfInfo;
  const meshtastic = realMeshtastic ? state.meshtasticRadio : undefined;
  const ownNode = realMeshtastic && state.myNodeNum !== undefined ? state.nodes.get(state.myNodeNum) : undefined;
  const linked = link.status === 'linked';
  const telemetry = linked ? link.telemetry : undefined;
  const self = realMeshCore ? state.selfInfo : undefined;
  const coordinates = realMeshtastic ? [ownNode?.lat, ownNode?.lon] : self ? [self.advLat, self.advLon] : telemetry ? [telemetry.lat, telemetry.lon] : undefined;
  const hasFix = coordinates && validCoordinates(coordinates[0], coordinates[1]) && (!self || coordinates[0] !== 0 || coordinates[1] !== 0);
  const position = hasFix ? { lat: coordinates[0]!, lon: coordinates[1]! } : undefined;
  const name = self?.name ?? ownNode?.longName ?? 'My T-Deck';
  return { state, link, linked, realMeshtastic, realMeshCore, meshtastic, ownNode, telemetry, self, position, name, connected: linked || realMeshCore || realMeshtastic };
}
