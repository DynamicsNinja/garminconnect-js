/**
 * Minimal FIT-file encoder for a weight-scale record, ported from upstream
 * python-garminconnect's `garminconnect/fit.py` (`FitEncoder`,
 * `FitEncoderWeight`). `addBodyComposition` (see
 * `src/services/bodyComposition.ts`) is the only caller: it builds a tiny
 * `.fit` binary in memory (file_id, file_creator, device_info, weight_scale
 * messages) and uploads it, exactly like upstream's `add_body_composition`.
 *
 * UNCERTAIN (inventory, `add_body_composition` row): the inventory flagged
 * "check FitEncoderWeight before assuming raw kg is correct on the wire" as
 * unresolved. Having now read `fit.py` directly (not just the inventory),
 * the answer is: `write_weight_scale`'s `weight` field IS scaled — packed as
 * `uint16(round(weight_kg * 100))` — but that scaling is a property of the
 * FIT binary format's `weight_scale` message (an official Garmin FIT SDK
 * field defined in kilograms with an implicit 1/100 resolution), not an
 * application-level unit conversion like the one that corrupted `addWeighIn`.
 * There is no evidence upstream converts lbs<->kg anywhere in this path;
 * `weight` is assumed to already be in kilograms both in `gc.py` and here.
 * LIVE-VERIFIED on 2026-09-23 (this note previously said it was not): a
 * 69.42 kg upload built by this encoder read back from `getBodyComposition`
 * as 69.42 kg. That single round-trip proves two separate things — Garmin
 * accepted the bytes, so the header and CRC are correct, and it parsed the
 * value correctly, so the x100 scaling is correct. Only the read-back could
 * distinguish the second: a wrong scale factor is accepted and misparsed
 * silently, where a wrong CRC is rejected outright.
 */

const CRC_TABLE = [
  0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00, 0x7800, 0xb401,
  0x5000, 0x9c01, 0x8801, 0x4400,
];

function calcCrc(crc: number, byte: number): number {
  let tmp = CRC_TABLE[crc & 0xf]!;
  crc = (crc >> 4) & 0x0fff;
  crc = crc ^ tmp ^ CRC_TABLE[byte & 0xf]!;
  tmp = CRC_TABLE[crc & 0xf]!;
  crc = (crc >> 4) & 0x0fff;
  return crc ^ tmp ^ CRC_TABLE[(byte >> 4) & 0xf]!;
}

interface BaseType {
  size: number;
  field: number;
  invalid: number;
  write: (buf: Buffer, offset: number, value: number) => void;
}

const ENUM: BaseType = { size: 1, field: 0x00, invalid: 0xff, write: (b, o, v) => b.writeUInt8(v, o) };
const UINT8: BaseType = { size: 1, field: 0x02, invalid: 0xff, write: (b, o, v) => b.writeUInt8(v, o) };
const UINT16: BaseType = {
  size: 2,
  field: 0x84,
  invalid: 0xffff,
  write: (b, o, v) => b.writeUInt16LE(v, o),
};
const UINT32: BaseType = {
  size: 4,
  field: 0x86,
  invalid: 0xffffffff,
  write: (b, o, v) => b.writeUInt32LE(v >>> 0, o),
};
const UINT32Z: BaseType = {
  size: 4,
  field: 0x8c, // uint32z field code
  invalid: 0x00000000,
  write: (b, o, v) => b.writeUInt32LE(v >>> 0, o),
};

interface Field {
  num: number;
  type: BaseType;
  value: number | null | undefined;
  scale: number | null;
}

function buildContentBlock(fields: Field[]): { defs: Buffer; values: Buffer } {
  const defParts: Buffer[] = [];
  const valParts: Buffer[] = [];
  for (const f of fields) {
    const def = Buffer.alloc(3);
    def.writeUInt8(f.num, 0);
    def.writeUInt8(f.type.size, 1);
    def.writeUInt8(f.type.field, 2);
    defParts.push(def);

    const val = Buffer.alloc(f.type.size);
    if (f.value === null || f.value === undefined) {
      f.type.write(val, 0, f.type.invalid);
    } else {
      const scaled = f.scale !== null ? f.value * f.scale : f.value;
      // Upstream's FitBaseType.pack calls Python's int(value), which
      // truncates toward zero — matched here with Math.trunc rather than
      // Math.round.
      f.type.write(val, 0, Math.trunc(scaled));
    }
    valParts.push(val);
  }
  return { defs: Buffer.concat(defParts), values: Buffer.concat(valParts) };
}

/** Seconds since the FIT epoch (1989-12-31T00:00:00 UTC), matching upstream's `Fit.timestamp`. */
const FIT_EPOCH_OFFSET_SECONDS = 631065600;

function fitTimestamp(d: Date): number {
  return Math.floor(d.getTime() / 1000) - FIT_EPOCH_OFFSET_SECONDS;
}

const GMSG_FILE_ID = 0;
const GMSG_DEVICE_INFO = 23;
const GMSG_WEIGHT_SCALE = 30;
const GMSG_FILE_CREATOR = 49;

const LMSG_FILE_INFO = 0;
const LMSG_FILE_CREATOR = 1;
const LMSG_DEVICE_INFO = 2;
const LMSG_WEIGHT_SCALE = 3;

const FILE_TYPE_WEIGHT = 9;

export interface WeightScaleFields {
  percentFat?: number;
  percentHydration?: number;
  visceralFatMass?: number;
  boneMass?: number;
  muscleMass?: number;
  basalMet?: number;
  activeMet?: number;
  physiqueRating?: number;
  metabolicAge?: number;
  visceralFatRating?: number;
  bmi?: number;
}

export class FitEncoderWeight {
  #chunks: Buffer[] = [];
  #deviceInfoDefined = false;
  #weightScaleDefined = false;

  constructor() {
    this.#chunks.push(this.#header(0));
  }

  #header(dataSize: number): Buffer {
    const b = Buffer.alloc(12);
    b.writeUInt8(12, 0); // header_size
    b.writeUInt8(16, 1); // protocol_version
    b.writeUInt16LE(108, 2); // profile_version
    b.writeUInt32LE(dataSize, 4);
    b.write(".FIT", 8, "ascii");
    return b;
  }

  #recordHeader(definition: boolean, lmsgType: number): Buffer {
    return Buffer.from([(definition ? 1 << 6 : 0) | lmsgType]);
  }

  #emit(lmsgType: number, gmsgNum: number, content: Field[], defined?: { flag: boolean }): void {
    const { defs, values } = buildContentBlock(content);
    if (!defined || !defined.flag) {
      const fixed = Buffer.alloc(5);
      fixed.writeUInt8(0, 0); // reserved
      fixed.writeUInt8(0, 1); // architecture: little-endian
      fixed.writeUInt16LE(gmsgNum, 2);
      fixed.writeUInt8(content.length, 4);
      this.#chunks.push(this.#recordHeader(true, lmsgType), fixed, defs);
      if (defined) defined.flag = true;
    }
    this.#chunks.push(this.#recordHeader(false, lmsgType), values);
  }

  writeFileInfo(timeCreated: Date = new Date()): void {
    this.#emit(LMSG_FILE_INFO, GMSG_FILE_ID, [
      { num: 3, type: UINT32Z, value: null, scale: null }, // serial_number
      { num: 4, type: UINT32, value: fitTimestamp(timeCreated), scale: null },
      { num: 1, type: UINT16, value: null, scale: null }, // manufacturer
      { num: 2, type: UINT16, value: null, scale: null }, // product
      { num: 5, type: UINT16, value: null, scale: null }, // number
      { num: 0, type: ENUM, value: FILE_TYPE_WEIGHT, scale: null }, // type
    ]);
  }

  writeFileCreator(): void {
    this.#emit(LMSG_FILE_CREATOR, GMSG_FILE_CREATOR, [
      { num: 0, type: UINT16, value: null, scale: null }, // software_version
      { num: 1, type: UINT8, value: null, scale: null }, // hardware_version
    ]);
  }

  writeDeviceInfo(timestamp: Date): void {
    const defined = { flag: this.#deviceInfoDefined };
    this.#emit(
      LMSG_DEVICE_INFO,
      GMSG_DEVICE_INFO,
      [
        { num: 253, type: UINT32, value: fitTimestamp(timestamp), scale: 1 },
        { num: 3, type: UINT32Z, value: null, scale: 1 }, // serial_number
        { num: 7, type: UINT32, value: null, scale: 1 }, // cum_operating_time
        { num: 8, type: UINT32, value: null, scale: null }, // unknown/undocumented field
        { num: 2, type: UINT16, value: null, scale: 1 }, // manufacturer
        { num: 4, type: UINT16, value: null, scale: 1 }, // product
        { num: 5, type: UINT16, value: null, scale: 100 }, // software_version
        { num: 10, type: UINT16, value: null, scale: 256 }, // battery_voltage
        { num: 0, type: UINT8, value: null, scale: 1 }, // device_index
        { num: 1, type: UINT8, value: null, scale: 1 }, // device_type
        { num: 6, type: UINT8, value: null, scale: 1 }, // hardware_version
        { num: 11, type: UINT8, value: null, scale: null }, // battery_status
      ],
      defined,
    );
    this.#deviceInfoDefined = defined.flag;
  }

  writeWeightScale(timestamp: Date, weight: number, extra: WeightScaleFields = {}): void {
    const defined = { flag: this.#weightScaleDefined };
    this.#emit(
      LMSG_WEIGHT_SCALE,
      GMSG_WEIGHT_SCALE,
      [
        { num: 253, type: UINT32, value: fitTimestamp(timestamp), scale: 1 },
        { num: 0, type: UINT16, value: weight, scale: 100 },
        { num: 1, type: UINT16, value: extra.percentFat, scale: 100 },
        { num: 2, type: UINT16, value: extra.percentHydration, scale: 100 },
        { num: 3, type: UINT16, value: extra.visceralFatMass, scale: 100 },
        { num: 4, type: UINT16, value: extra.boneMass, scale: 100 },
        { num: 5, type: UINT16, value: extra.muscleMass, scale: 100 },
        { num: 7, type: UINT16, value: extra.basalMet, scale: 4 },
        { num: 9, type: UINT16, value: extra.activeMet, scale: 4 },
        { num: 8, type: UINT8, value: extra.physiqueRating, scale: 1 },
        { num: 10, type: UINT8, value: extra.metabolicAge, scale: 1 },
        { num: 11, type: UINT8, value: extra.visceralFatRating, scale: 1 },
        { num: 13, type: UINT16, value: extra.bmi, scale: 10 },
      ],
      defined,
    );
    this.#weightScaleDefined = defined.flag;
  }

  #totalSize(): number {
    return this.#chunks.reduce((n, c) => n + c.length, 0);
  }

  #crc(): Buffer {
    let crc = 0;
    for (const chunk of this.#chunks) {
      for (const byte of chunk) {
        crc = calcCrc(crc, byte);
      }
    }
    const out = Buffer.alloc(2);
    out.writeUInt16LE(crc, 0);
    return out;
  }

  finish(): Buffer {
    const dataSize = this.#totalSize() - 12;
    this.#chunks[0] = this.#header(dataSize);
    const crc = this.#crc();
    return Buffer.concat([...this.#chunks, crc]);
  }
}
