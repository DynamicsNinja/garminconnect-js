/** Dive-specific wire contracts. Optional read fields reflect missing/null Garmin values. */
export type DiveId = string | number;
export type DiveVisibility = "ONLY_ME" | "FRIENDS" | "EVERYONE";
export type DiveObject = Record<string, unknown>;

export interface DiveImage {
  imageUUID: string;
  [key: string]: unknown;
}
export interface DiveMedia {
  images?: DiveImage[] | null;
  videos?: unknown[] | null;
  [key: string]: unknown;
}
export interface DiveLogSummary {
  id: number;
  connectActivityId?: number | null;
  name?: string | null;
  number?: number | null;
  startTime?: string | null;
  timezone?: string | null;
  diveType?: string | null;
  bottomTime?: number | null;
  maxDepth?: number | null;
  excludedFromDLN?: boolean | null;
  diveTags?: string[] | null;
  [key: string]: unknown;
}
export interface DiveLogPage {
  totalCount: number;
  pageSize?: number;
  pageNumber?: number;
  diveActivities: DiveLogSummary[];
  [key: string]: unknown;
}
export interface DiveLog extends DiveLogSummary {
  playerId?: number | null;
  profile?: (DiveObject & {
    maxDepth?: number | null;
    averageDepth?: number | null;
    surfaceInterval?: number | null;
    bottomTime?: number | null;
  }) | null;
  location?: DiveObject | null;
  equipment?: DiveObject | null;
  environment?: (DiveObject & {
    maxTemperature?: number | null;
    minTemperature?: number | null;
    avgTemperature?: number | null;
    waterType?: string | null;
    waterDensity?: number | null;
  }) | null;
  media?: DiveMedia | null;
  gears?: DiveGearSummary[] | null;
  notes?: string | null;
  privateNotes?: string | null;
}
export interface DiveLogFilters {
  requestedPage?: number;
  resultsPerPage?: number;
  startDateTime?: string;
  endDateTime?: string;
  dlnEligible?: boolean;
  /** Wire strings; no undocumented list encoding is inferred. */
  gearIds?: string;
  connectActivityIds?: string;
  filter?: Record<string, string>;
}
export type DiveGearType =
  | "BOOTS"
  | "BCD"
  | "CAMERA"
  | "DIVE_COMPUTER"
  | "EXPOSURE_SUIT"
  | "FIN"
  | "GLOVE"
  | "HOOD"
  | "LIGHT"
  | "MASK"
  | "REBREATHER"
  | "REGULATOR"
  | "SNORKEL"
  | "SPEAR"
  | "TANK"
  | "TRANSMITTER"
  | "UNDERGARMENT"
  | "WEIGHT"
  | "SCOOTER"
  | "CUTTING_TOOL"
  | "BUOY"
  | "SPOOL"
  | "SLATE"
  | "CERTIFICATION"
  | "OTHER";
export interface DiveGearSummary {
  gearId: number;
  name?: string | null;
  type?: DiveGearType | null;
  status?: string | null;
  creationTs?: string | null;
  serialNumber?: string | null;
  stats?: (DiveObject & {
    numAssociatedDives?: number | null;
    totalAssociatedDiveTime?: number | null;
  }) | null;
  [key: string]: unknown;
}
/** Numeric values are native wire units unless a field name includes units. */
export interface DiveGearFieldMap {
  BOOTS: { thicknessInMM?: number };
  BCD: { design?: string; type?: string };
  CAMERA: Record<string, unknown>;
  DIVE_COMPUTER: { airIntegrated?: boolean };
  EXPOSURE_SUIT: {
    suitType?: string;
    customSuitType?: string;
    length?: string;
    thicknessInMM?: number;
  };
  FIN: { type?: string };
  GLOVE: { type?: string; thicknessInMM?: number };
  HOOD: { thicknessInMM?: number };
  LIGHT: {
    type?: string;
    format?: string;
    bulb?: string;
    rechargeable?: boolean;
    lumenOutput?: number;
    burnTimeMins?: number;
  };
  MASK: { type?: string };
  REBREATHER: {
    o2SensorModel?: string;
    o2SensorInstallationDate?: string;
    o2SensorReplacementDate?: string;
    notes?: string;
  };
  REGULATOR: { type?: string; connectorType?: string; o2ServiceFlag?: boolean };
  SNORKEL: { type?: string };
  SPEAR: {
    type?: string;
    length?: number;
    lengthUnit?: string;
    style?: string;
  };
  TANK: {
    material?: string;
    materialNotes?: string;
    tankSize?: number;
    tankSizeUnit?: string;
    operationPressure?: number;
    pressureUnit?: string;
    o2ServiceFlag?: boolean;
    lastVisualInspectionDate?: string;
    nextVisualInspectionDate?: string;
    lastHydroServiceDate?: string;
    nextHydroServiceDate?: string;
    minBuoyancy?: number;
    maxBuoyancy?: number;
  };
  TRANSMITTER: Record<string, unknown>;
  UNDERGARMENT: { type?: string; notes?: string };
  WEIGHT: { type?: string };
  SCOOTER: {
    speed?: number;
    speedUnit?: string;
    depth?: number;
    depthUnit?: string;
    runTimeMins?: number;
    type?: string;
    batteryNotes?: string;
  };
  CUTTING_TOOL: {
    type?: string;
    edgeTypes?: string[];
    material?: string;
    tip?: string;
    foldingKnife?: boolean;
  };
  BUOY: {
    type?: string;
    color?: string;
    reflective?: boolean;
    flagType?: string;
  };
  SPOOL: {
    type?: string;
    length?: number;
    lengthUnit?: string;
    lineColor?: string;
  };
  SLATE: { type?: string };
  CERTIFICATION: DiverCertificationFields;
  OTHER: Record<string, unknown>;
}
export type DiveGearField = {
  [K in DiveGearType]: { type: K; fields: DiveGearFieldMap[K] };
}[DiveGearType];
export interface DiveGear extends DiveGearSummary {
  desc?: string | null;
  brand?: string | null;
  model?: string | null;
  gearField?: {
    type: DiveGearType;
    fields: DiveObject | DiverCertificationFields;
  } | null;
  notes?: string | null;
  media?: DiveMedia | null;
}
export interface DiveGearFilters {
  gearTypes?: string;
  gearStatus?: string;
  currentUserDate?: string;
  filter?: Record<string, string>;
}
export interface DiverCertificationFields {
  diverName?: string;
  diverId?: string;
  certificationDate?: string;
  certificationType?: string;
  certificationId?: string;
  certificationAgency?: string;
  category?: "RECREATIONAL" | "APNEA" | "TECHNICAL" | "PROFESSIONAL" | "OTHER";
  instructorName?: string;
  instructorId?: string;
  diveShopName?: string;
  diveShopAddress?: string;
  diveShopWebsite?: string;
  certificationQRCode?: string;
  addToAllDives?: boolean;
  sortOrder?: number;
  images?: DiveImage[];
}
export interface DiverPrivacy {
  profile: {
    badgeVisibility: DiveVisibility;
    showBottomTime: boolean;
    showDiveNumber: boolean;
    visibility: DiveVisibility;
  };
  activity: {
    advFieldsVisibility: DiveVisibility;
    locationVisibility: DiveVisibility;
    visibility: DiveVisibility;
  };
}
