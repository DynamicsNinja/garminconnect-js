/**
 * One entry of `GET /device-service/deviceregistration/devices` (`get_devices`). Undocumented
 * shape — passed through unchecked, so this stays an honest index signature rather than a guessed
 * one. `deviceId` is the field `getDeviceSettings`/`getDeviceAlarms` key off of.
 */
export interface Device {
  deviceId?: number | string;
  [key: string]: unknown;
}

/**
 * `GET /device-service/deviceservice/device-info/settings/{device_id}` (`get_device_settings`).
 * Undocumented shape; `alarms` is the field `getDeviceAlarms` reads off each device's settings.
 */
export interface DeviceSettings {
  alarms?: unknown[];
  [key: string]: unknown;
}

/** `GET /web-gateway/device-info/primary-training-device` (`get_primary_training_device`). */
export interface PrimaryTrainingDevice {
  [key: string]: unknown;
}

/**
 * `GET /web-gateway/solar/{device_id}/{startdate}/{enddate}` (`get_device_solar_data`). The
 * envelope Garmin returns; `getDeviceSolarData` unwraps and returns only `deviceSolarInput`, per
 * upstream's `resp["deviceSolarInput"]`.
 */
export interface DeviceSolarDataResponse {
  deviceSolarInput?: unknown[];
  [key: string]: unknown;
}

/** `GET /device-service/deviceservice/mylastused` (`get_device_last_used`). */
export interface DeviceLastUsed {
  userDeviceId?: number | string;
  [key: string]: unknown;
}
