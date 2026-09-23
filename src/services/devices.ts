import { GarminConnectionError, GarminError } from "../errors.js";
import type { GarminClient } from "../client.js";
import { formatDate } from "../util/date.js";
import type {
  Device,
  DeviceLastUsed,
  DeviceSettings,
  DeviceSolarDataResponse,
  PrimaryTrainingDevice,
} from "../types/devices.js";

/** Devices, device settings, primary training device, solar data, alarms, last-used. */
export interface DevicesHost {
  readonly client: GarminClient;
}

/**
 * Mirrors upstream's implicit `int(device_id)` coercion + positivity check before the value is
 * re-stringified into the URL path. `Number(...)` (not `parseInt`) is used deliberately so a
 * partially-numeric string like `"123abc"` is rejected instead of silently truncated, matching
 * Python's `int("123abc")` raising `ValueError` rather than reading `123`.
 */
function validateDeviceId(deviceId: number | string): string {
  const n = Number(deviceId);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new GarminError(`Invalid device id: "${String(deviceId)}"`);
  }
  return String(n);
}

/**
 * Upstream `get_devices`. `null_behaviour`: passes through unchecked. Undocumented shape — see
 * `Device` in `src/types/devices.ts`.
 */
export async function getDevices(host: DevicesHost): Promise<Device[] | null> {
  return host.client.connectapi<Device[]>("/device-service/deviceregistration/devices");
}

/**
 * Upstream `get_device_settings`. `deviceId` is coerced to an int, validated positive, and
 * re-stringified before being placed in the path (see `validateDeviceId`), matching upstream's
 * `_validate_device_id`-style handling in `get_device_settings`. `null_behaviour`: passes through
 * unchecked. Call sequence: obtain `device_id` from a `getDevices()` entry's `deviceId` field
 * first, then pass it here.
 */
export async function getDeviceSettings(
  host: DevicesHost,
  deviceId: number | string,
): Promise<DeviceSettings | null> {
  const id = validateDeviceId(deviceId);
  return host.client.connectapi<DeviceSettings>(
    `/device-service/deviceservice/device-info/settings/${id}`,
  );
}

/** Upstream `get_primary_training_device`. `null_behaviour`: passes through unchecked. */
export async function getPrimaryTrainingDevice(
  host: DevicesHost,
): Promise<PrimaryTrainingDevice | null> {
  return host.client.connectapi<PrimaryTrainingDevice>(
    "/web-gateway/device-info/primary-training-device",
  );
}

/**
 * Upstream `get_device_solar_data`. Unlike every other method in this service, this one RAISES
 * (`GarminConnectionError`, mirroring upstream's `GarminConnectConnectionError`) when the response
 * is falsy or missing the `deviceSolarInput` key, and returns `resp["deviceSolarInput"]` — NOT the
 * whole envelope. `enddate` defaults to `startdate`, and `singleDayView` is sent `"true"` exactly
 * when `enddate` was omitted (i.e. it tracks omission, not date equality — an explicit
 * `enddate === startdate` still sends `singleDayView=false`, matching upstream). Both dates are
 * routed through `formatDate`.
 */
export async function getDeviceSolarData(
  host: DevicesHost,
  deviceId: number | string,
  startdate: string | Date,
  enddate?: string | Date,
): Promise<unknown[]> {
  const id = validateDeviceId(deviceId);
  const start = formatDate(startdate);
  const singleDayView = enddate === undefined;
  const end = singleDayView ? start : formatDate(enddate);
  const resp = await host.client.connectapi<DeviceSolarDataResponse>(
    `/web-gateway/solar/${id}/${start}/${end}`,
    { params: { singleDayView: String(singleDayView) } },
  );
  if (!resp || !("deviceSolarInput" in resp)) {
    throw new GarminConnectionError("No device solar input data received");
  }
  return resp.deviceSolarInput ?? [];
}

/** Upstream `get_device_last_used`. `null_behaviour`: passes through unchecked. */
export async function getDeviceLastUsed(host: DevicesHost): Promise<DeviceLastUsed | null> {
  return host.client.connectapi<DeviceLastUsed>("/device-service/deviceservice/mylastused");
}

/**
 * Upstream `get_device_alarms`. No HTTP path of its own: calls `getDevices()` once, then
 * `getDeviceSettings(device.deviceId)` **once per device** (an N+1 fan-out — ported faithfully and
 * sequentially; parallelizing it would be a behavioural change from upstream). Concatenates each
 * device's `alarms` list; a device with no `alarms` (or `null`) contributes nothing, matching
 * upstream's `if device_alarms is not None: alarms += device_alarms`. A device entry missing
 * `deviceId` throws `GarminError` rather than silently skipping, mirroring upstream's implicit
 * `device["deviceId"]` dict access, which would raise `KeyError` in the same situation.
 */
export async function getDeviceAlarms(host: DevicesHost): Promise<unknown[]> {
  const devices = await getDevices(host);
  const alarms: unknown[] = [];
  for (const device of devices ?? []) {
    if (device.deviceId === undefined) {
      throw new GarminError("getDeviceAlarms: device entry missing deviceId");
    }
    const settings = await getDeviceSettings(host, device.deviceId);
    const deviceAlarms = settings?.alarms;
    if (deviceAlarms != null) {
      alarms.push(...deviceAlarms);
    }
  }
  return alarms;
}
