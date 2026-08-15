/** Hand-written types for the untyped @liamcottle/meshcore.js deep imports.
 *  Deep paths on purpose: the package index pulls in NodeJSSerialConnection,
 *  whose `serialport` dependency doesn't bundle for the browser. */

interface MeshCoreSelfInfo {
  type: number;
  txPower: number;
  maxTxPower: number;
  publicKey: Uint8Array;
  advLat: number; // ×1e6
  advLon: number; // ×1e6
  manualAddContacts: number;
  radioFreq: number; // kHz
  radioBw: number;
  radioSf: number;
  radioCr: number;
  name: string;
}

interface MeshCoreContact {
  publicKey: Uint8Array;
  type: number;
  flags: number;
  outPathLen: number; // -1 = flood / unknown
  outPath: Uint8Array; // 64 bytes, first outPathLen are meaningful
  advName: string;
  lastAdvert: number; // epoch s
  advLat: number; // ×1e6
  advLon: number; // ×1e6
  lastMod: number;
}

interface MeshCoreSentResponse {
  result: number;
  expectedAckCrc: number;
  estTimeout: number; // ms
}

interface MeshCoreContactMessage {
  pubKeyPrefix: Uint8Array; // 6 bytes
  pathLen: number; // 0xFF = direct
  txtType: number;
  senderTimestamp: number; // epoch s
  text: string;
}

interface MeshCoreChannelMessage {
  channelIdx: number;
  pathLen: number; // 0xFF = direct
  txtType: number;
  senderTimestamp: number; // epoch s
  text: string;
}

declare module "@liamcottle/meshcore.js/src/connection/connection.js" {
  class Connection {
    on(event: number | string, cb: (data?: never) => void): void;
    on<T>(event: number | string, cb: (data: T) => void): void;
    off(event: number | string, cb: (data?: unknown) => void): void;
    once<T>(event: number | string, cb: (data: T) => void): void;

    close(): Promise<void>;

    getSelfInfo(timeoutMillis?: number | null): Promise<MeshCoreSelfInfo>;
    getContacts(): Promise<MeshCoreContact[]>;
    sendTextMessage(
      contactPublicKey: Uint8Array,
      text: string,
      type?: number,
    ): Promise<MeshCoreSentResponse>;
    sendChannelTextMessage(channelIdx: number, text: string): Promise<void>;
    syncNextMessage(): Promise<{
      contactMessage?: MeshCoreContactMessage;
      channelMessage?: MeshCoreChannelMessage;
      channelData?: unknown;
    } | null>;
    sendFloodAdvert(): Promise<void>;
    sendZeroHopAdvert(): Promise<void>;
    setAdvertName(name: string): Promise<void>;
    setAdvertLatLong(latE6: number, lonE6: number): Promise<void>;
    setTxPower(dbm: number): Promise<void>;
    setRadioParams(freq: number, bw: number, sf: number, cr: number): Promise<void>;

    sendCommandAppStart(): Promise<void>;
    sendCommandSetDeviceTime(epochSecs: number): Promise<void>;
    sendCommandGetBatteryVoltage(): Promise<void>;
    sendCommandDeviceQuery(appTargetVer: number): Promise<void>;
    sendCommandGetChannel(channelIdx: number): Promise<void>;
    sendCommandSetChannel(
      channelIdx: number,
      name: string,
      secret: Uint8Array,
    ): Promise<void>;
    sendCommandGetStats(statsType: number): Promise<void>;
    sendCommandSendTracePath(
      tag: number,
      auth: number,
      path: Uint8Array,
    ): Promise<void>;
    sendCommandResetPath(pubKey: Uint8Array): Promise<void>;
    sendCommandRemoveContact(pubKey: Uint8Array): Promise<void>;
    sendCommandAddUpdateContact(
      publicKey: Uint8Array,
      type: number,
      flags: number,
      outPathLen: number,
      outPath: Uint8Array,
      advName: string,
      lastAdvert: number,
      advLat: number,
      advLon: number,
    ): Promise<void>;
    sendCommandShareContact(pubKey: Uint8Array): Promise<void>;
    sendCommandExportContact(pubKey?: Uint8Array | null): Promise<void>;
    sendCommandExportPrivateKey(): Promise<void>;
    sendCommandImportPrivateKey(privateKey: Uint8Array): Promise<void>;
    sendCommandReboot(): Promise<void>;
    sendCommandSendTelemetryReq(publicKey: Uint8Array): Promise<void>;
    sendCommandSyncNextMessage(): Promise<void>;
  }
  export default Connection;
}

declare module "@liamcottle/meshcore.js/src/connection/web_serial_connection.js" {
  import Connection from "@liamcottle/meshcore.js/src/connection/connection.js";
  class WebSerialConnection extends Connection {
    constructor(serialPort: unknown);
    static open(): Promise<WebSerialConnection | null>;
  }
  export default WebSerialConnection;
}

declare module "@liamcottle/meshcore.js/src/connection/web_ble_connection.js" {
  import Connection from "@liamcottle/meshcore.js/src/connection/connection.js";
  class WebBleConnection extends Connection {
    constructor(bleDevice: unknown);
    static open(): Promise<WebBleConnection | null | undefined>;
  }
  export default WebBleConnection;
}

declare module "@liamcottle/meshcore.js/src/constants.js" {
  const Constants: {
    SupportedCompanionProtocolVersion: number;
    Ble: {
      ServiceUuid: string;
      CharacteristicUuidRx: string;
      CharacteristicUuidTx: string;
    };
    StatsTypes: { Core: number; Radio: number; Packets: number };
    ResponseCodes: Record<string, number>;
    PushCodes: Record<string, number>;
    ErrorCodes: Record<string, number>;
    AdvType: { None: number; Chat: number; Repeater: number; Room: number };
    SelfAdvertTypes: { ZeroHop: number; Flood: number };
    TxtTypes: { Plain: number; CliData: number; SignedPlain: number };
  };
  export default Constants;
}

declare module "@liamcottle/meshcore.js/src/cayenne_lpp.js" {
  const CayenneLpp: {
    parse(bytes: Uint8Array): {
      channel: number;
      type: number;
      typeName?: string;
      value: unknown;
    }[];
  };
  export default CayenneLpp;
}
