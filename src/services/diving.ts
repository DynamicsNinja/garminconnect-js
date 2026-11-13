import type { GarminClient } from "../client.js";
import type { QueryParams } from "../http/fetcher.js";
import { GarminError } from "../errors.js";
import { formatDate } from "../util/date.js";
import { pathSegment } from "../util/validate.js";
import type {
  DiveLog, DiveLogPage, DiveLogFilters, DiveNumberingOptions, DiveUpdateOptions,
  CreateDiveLogInput, DiveLogChanges, DiveGear, DiveGearSummary, DiveGearInput,
  DiveGearFilters, DiverCertificationInput, DiverCertificationFields,
  DiverPrivacy, DiverPrivacyChanges, DiveImage, DiveImageUploadOptions,
  DiveImageUploadResult,
} from "../types/diving.js";

export interface DivingHost {
  readonly client: GarminClient;
}

export function getDiveLogs(host: DivingHost, filters: DiveLogFilters = {}): Promise<DiveLogPage | null> {
  const { filter, dlnEligible, ...rest } = filters;
  for (const [key, value] of Object.entries({ requestedPage: filters.requestedPage, resultsPerPage: filters.resultsPerPage })) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0 || (key === "resultsPerPage" && value === 0))) {
      throw new GarminError(`Invalid ${key}`);
    }
  }
  return host.client.connectapi("/diving/v1/dive/summary", {
    params: { ...filter, ...rest, dlnEligible: dlnEligible === undefined ? undefined : String(dlnEligible) },
  });
}

export function getDiveLog(host: DivingHost, diveActivityId: string | number): Promise<DiveLog | null> {
  return host.client.connectapi(`/diving/v1/dive/detail/${id(diveActivityId)}`);
}

export function getDiveLogByConnectActivityId(host: DivingHost, connectActivityId: string | number): Promise<DiveLog | null> {
  return host.client.connectapi(`/diving/v1/dive/detail/by/connectid/${id(connectActivityId)}`);
}

export function getDiveTags(host: DivingHost): Promise<Record<string, number> | null> {
  return host.client.connectapi("/diving/v1/dive/tags");
}

export function getCurrentMaxDiveNumber(host: DivingHost): Promise<number | null> {
  return host.client.connectapi("/userprofile-service/userprofile/currentMaxDiveNumber");
}

export function getDiverCertifications(host: DivingHost): Promise<DiveGear[] | null> {
  return host.client.connectapi("/diving/v1/gear/certifications");
}

export async function getDiverCertification(host: DivingHost, gearId: string | number, currentUserDate: string): Promise<DiveGear | null> {
  const gear = await getDiveGear(host, gearId, currentUserDate);
  if (gear && gear.type !== "CERTIFICATION") throw new GarminError("Dive gear is not a certification");
  return gear;
}

export function getDiveGearSummaries(host: DivingHost, filters: DiveGearFilters = {}): Promise<DiveGearSummary[] | null> {
  return host.client.connectapi("/diving/v1/gear/summary", { params: {
    ...filters.filter, "gear-types": filters.gearTypes, "gear-status": filters.gearStatus,
    "current-user-date": filters.currentUserDate === undefined ? undefined : formatDate(filters.currentUserDate),
  } });
}

export function getDiveGear(host: DivingHost, gearId: string | number, currentUserDate: string): Promise<DiveGear | null> {
  return host.client.connectapi(`/diving/v1/gear/${id(gearId)}`, { params: dateParams(currentUserDate) });
}

export function getDiverPrivacy(host: DivingHost): Promise<DiverPrivacy | null> {
  return host.client.connectapi("/diving/v1/player/privacy");
}

export function createDiveLog(host: DivingHost, input: CreateDiveLogInput, options: DiveNumberingOptions = {}): Promise<DiveLog | null> {
  fields(input, "name startTime timezone diveType diveNumber bottomTime buddy notes privateNotes excludedFromDLN diveTags poiUUID connectPrivacy profile config environment equipment location apnea social eventType freeDiveType gear media");
  if (!input.name?.trim() || !input.timezone || !input.diveType || !Number.isFinite(Date.parse(input.startTime))) {
    throw new GarminError("A manual dive needs name, startTime, timezone and diveType");
  }
  if (!object(input.profile)) throw new GarminError("A manual dive needs a profile object");
  return host.client.connectapi("/diving/v1/dive", { method: "POST", json: input, params: numbering(options) });
}

export async function updateDiveLog(host: DivingHost, diveActivityId: string | number, changes: DiveLogChanges, options: DiveUpdateOptions = {}): Promise<DiveLog | null> {
  fields(changes, "name notes privateNotes buddy diveTags excludedFromDLN number startTime timezone profile environment equipment location media gears");
  const current = await getDiveLog(host, diveActivityId);
  if (!current) throw new GarminError("Dive log returned no record");
  return patch(host, `/diving/v1/dive/${id(diveActivityId)}`, current, changes, numbering(options));
}

export function deleteDiveLog(host: DivingHost, diveActivityId: string | number, options: DiveNumberingOptions = {}): Promise<unknown> {
  return host.client.connectapi(`/diving/v1/dive/${id(diveActivityId)}`, {
    method: "DELETE", params: numbering(options),
  });
}

export function setDiveLogPrivacy(host: DivingHost, diveActivityId: string | number, typeKey: string): Promise<unknown> {
  if (!typeKey?.trim()) throw new GarminError("A privacy typeKey is required");
  return host.client.connectapi(`/diving/proxy/connect/activity-service/activity/${id(diveActivityId)}`, {
    method: "PUT", json: { typeKey },
  });
}

export function createDiveGear(host: DivingHost, input: DiveGearInput, currentUserDate: string): Promise<DiveGear | null> {
  gearInput(input);
  return host.client.connectapi("/diving/v1/gear", { method: "POST", json: input, params: dateParams(currentUserDate) });
}

export async function updateDiveGear(host: DivingHost, gearId: string | number, changes: Partial<DiveGearInput>, currentUserDate: string): Promise<DiveGear | null> {
  fields(changes, GEAR_FIELDS);
  const current = await getDiveGear(host, gearId, currentUserDate);
  if (!current) throw new GarminError("Dive gear returned no record");
  return patch(host, `/diving/v1/gear/${id(gearId)}`, current, changes, dateParams(currentUserDate));
}

export function deleteDiveGear(host: DivingHost, gearId: string | number): Promise<unknown> {
  return host.client.connectapi(`/diving/v1/gear/${id(gearId)}`, { method: "DELETE" });
}

export function bulkCreateDiveGear(host: DivingHost, inputs: DiveGearInput[], associateDiveActivityId: string | number, currentUserDate: string): Promise<DiveGear[] | null> {
  if (!Array.isArray(inputs) || !inputs.length) throw new GarminError("Bulk gear input must not be empty");
  inputs.forEach(gearInput);
  return host.client.connectapi("/diving/v1/gear/bulk", { method: "POST", json: inputs,
    params: { ...dateParams(currentUserDate), "associate-diveactivity-id": id(associateDiveActivityId) } });
}

export function createDiverCertification(host: DivingHost, input: DiverCertificationInput, currentUserDate: string): Promise<DiveGear | null> {
  fields(input, "name notes certification");
  fields(input.certification, CERT_FIELDS);
  return createDiveGear(host, { name: input.name, notes: input.notes, type: "CERTIFICATION",
    gearField: { type: "CERTIFICATION", fields: input.certification } }, currentUserDate);
}

export async function updateDiverCertification(host: DivingHost, gearId: string | number, changes: Partial<DiverCertificationInput>, currentUserDate: string): Promise<DiveGear | null> {
  fields(changes, "name notes certification");
  if (changes.certification) fields(changes.certification, CERT_FIELDS);
  const current = await getDiverCertification(host, gearId, currentUserDate);
  if (!current) throw new GarminError("Certification returned no record");
  const { certification, ...rest } = changes;
  return patch(host, `/diving/v1/gear/${id(gearId)}`, current, {
    ...rest, ...(certification === undefined ? {} : { gearField: { fields: certification } }),
  }, dateParams(currentUserDate));
}

export async function deleteDiverCertification(host: DivingHost, gearId: string | number, currentUserDate: string): Promise<unknown> {
  if (!(await getDiverCertification(host, gearId, currentUserDate))) throw new GarminError("Certification returned no record");
  return deleteDiveGear(host, gearId);
}

export function reorderDiverCertifications(host: DivingHost, orderedGearIds: (string | number)[]): Promise<unknown> {
  const ids = orderedGearIds.map((value) => {
    const numeric = Number(id(value));
    if (!Number.isSafeInteger(numeric)) throw new GarminError("Certification reorder requires safe integer gear IDs");
    return numeric;
  });
  if (!ids.length || new Set(ids).size !== ids.length) throw new GarminError("Provide a nonempty list of unique certification IDs");
  return host.client.connectapi("/diving/v1/gear/certifications/reorder", { method: "PUT", json: ids });
}

export function uploadDiveImage(host: DivingHost, file: Blob, filename: string, options: DiveImageUploadOptions): Promise<DiveImageUploadResult | null> {
  if (!file.size || !filename.trim() || !["DIVE_ACTIVITY", "DIVE_GEAR"].includes(options.category)) {
    throw new GarminError("Provide a nonempty image, filename and supported Dive category");
  }
  const query = new URLSearchParams({ category: options.category, "source-platform": options.sourcePlatform ?? "DIVE_ANDROID" });
  return host.client.upload(file.slice(0, file.size, "application/octet-stream"), filename, `/diving/proxy/media/v2/images?${query.toString()}`, {
    timeoutMs: options.timeoutMs,
  }) as Promise<DiveImageUploadResult | null>;
}

export async function addDiveLogImage(host: DivingHost, diveActivityId: string | number, image: DiveImage): Promise<DiveLog | null> {
  imageRef(image);
  const current = await getDiveLog(host, diveActivityId);
  if (!current) throw new GarminError("Dive log returned no record");
  return patch(host, `/diving/v1/dive/${id(diveActivityId)}`, current,
    { media: { images: appendImage(current.media?.images, image) } });
}

export async function addDiveGearImage(host: DivingHost, gearId: string | number, image: DiveImage, currentUserDate: string): Promise<DiveGear | null> {
  imageRef(image);
  const current = await getDiveGear(host, gearId, currentUserDate);
  if (!current) throw new GarminError("Dive gear returned no record");
  return patch(host, `/diving/v1/gear/${id(gearId)}`, current,
    { media: { images: appendImage(current.media?.images, image) } }, dateParams(currentUserDate));
}

export async function addDiverCertificationImage(host: DivingHost, gearId: string | number, image: DiveImage, currentUserDate: string): Promise<DiveGear | null> {
  imageRef(image);
  const current = await getDiverCertification(host, gearId, currentUserDate);
  if (!current) throw new GarminError("Certification returned no record");
  const existing = (current.gearField?.fields as DiverCertificationFields | undefined)?.images;
  return patch(host, `/diving/v1/gear/${id(gearId)}`, current,
    { gearField: { fields: { images: appendImage(existing, image) } } }, dateParams(currentUserDate));
}

export async function updateDiverPrivacy(host: DivingHost, changes: DiverPrivacyChanges): Promise<unknown> {
  fields(changes, "profile activity");
  if (changes.profile) fields(changes.profile, "badgeVisibility showBottomTime showDiveNumber visibility");
  if (changes.activity) fields(changes.activity, "advFieldsVisibility locationVisibility visibility");
  const current = await getDiverPrivacy(host);
  if (!current) throw new GarminError("Diver privacy returned no record");
  return host.client.connectapi("/diving/v1/player/privacy", { method: "POST", json: {
    ...current, profile: { ...current.profile, ...defined(changes.profile) }, activity: { ...current.activity, ...defined(changes.activity) },
  } });
}

function patch<T>(host: DivingHost, path: string, current: unknown, changes: unknown, params?: QueryParams): Promise<T | null> {
  const operations = divePatch(current, changes);
  if (!operations.length) throw new GarminError("Provide at least one Dive change");
  return host.client.connectapi(path, { method: "PATCH", json: operations, params,
    headers: { "Content-Type": "application/json-patch+json" } });
}

function divePatch(current: unknown, changes: unknown, prefix = ""): { op: "add" | "replace"; path: string; value: unknown }[] {
  if (!object(changes)) throw new GarminError("Dive changes must be an object");
  const old = object(current) ? current : {};
  const operations: { op: "add" | "replace"; path: string; value: unknown }[] = [];
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) continue;
    if (value === null) throw new GarminError(`Null clearing is not verified for ${prefix}/${key}`);
    if (["__proto__", "prototype", "constructor"].includes(key)) throw new GarminError("Unsafe Dive field");
    const path = `${prefix}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`;
    if (object(value) && !object(old[key])) divePatch({}, value, path);
    if (typeof value === "number" && !Number.isFinite(value)) throw new GarminError(`Non-finite Dive value at ${path}`);
    if (object(value) && object(old[key])) operations.push(...divePatch(old[key], value, path));
    else operations.push({ op: key in old ? "replace" : "add", path, value });
  }
  return operations;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function defined(value: unknown): Record<string, unknown> {
  return object(value) ? Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) : {};
}
function numbering(options: DiveUpdateOptions): QueryParams {
  return Object.fromEntries(Object.entries(options).map(([key, value]) => {
    if (!["renumberThisDive", "renumberSubsequentDives"].includes(key) || (value !== undefined && typeof value !== "boolean")) throw new GarminError("Invalid Dive numbering option");
    return [key, value === undefined ? undefined : String(value)];
  }));
}
function dateParams(date: string): QueryParams { return { "current-user-date": formatDate(date) }; }
const GEAR_FIELDS = "name type brand model desc notes size serialNumber dateOfFirstUse status lastServiceDate serviceIntervalDays lastServicedBy purchaseDate purchasePrice purchaseCurrency purchasedFrom warrantyEndDate surfaceWeight surfaceWeightUnit buoyancy buoyancyUnit havingProblem stats gearField media";
const CERT_FIELDS = "diverName diverId certificationDate certificationType certificationId certificationAgency category instructorName instructorId diveShopName diveShopAddress diveShopWebsite certificationQRCode addToAllDives sortOrder images";
function fields(value: unknown, allowed: string): void {
  if (!object(value) || !Object.values(value).some((item) => item !== undefined)) throw new GarminError("Provide a nonempty Dive input");
  for (const [key, item] of Object.entries(value)) {
    if (!allowed.split(" ").includes(key)) throw new GarminError(`Unsupported Dive field: ${key}`);
    if (item === null) throw new GarminError(`Null clearing is not verified for ${key}`);
  }
}
function gearInput(input: DiveGearInput): void {
  fields(input, GEAR_FIELDS);
  if (!input.name?.trim() || !input.type) throw new GarminError("Dive gear requires name and type");
  if (input.gearField && input.gearField.type !== input.type) throw new GarminError("Gear field type must match gear type");
  if (input.gearField?.type === "CERTIFICATION") fields(input.gearField.fields, CERT_FIELDS);
}
function imageRef(image: DiveImage): void {
  if (!image?.imageUUID?.trim()) throw new GarminError("An uploaded imageUUID is required");
}
function appendImage(images: DiveImage[] | null | undefined, image: DiveImage): DiveImage[] {
  return images?.some((item) => item.imageUUID === image.imageUUID) ? [...images] : [...(images ?? []), image];
}
function id(value: string | number): string {
  if ((typeof value === "number" && !Number.isSafeInteger(value)) || !/^[0-9]+$/.test(String(value))) {
    throw new GarminError("Dive identifiers must be numeric IDs, not Connect gear UUIDs or paths");
  }
  return pathSegment(value);
}
