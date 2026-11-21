export type MUGENFileType = "sff" | "air" | "act" | "def" | "cns" | "cmd";

export interface SffImage {
  group: number;
  image: number;
  xOffset: number;
  yOffset: number;
  width: number;
  height: number;
  pixelIndices: Uint8Array; // Raw 8-bit palette indices decoded from PCX/LZ5
  isSharedPalette: boolean;
  comment: string;
  palette?: Uint8Array;
  isCompressed?: boolean;
  format?: string;
}

export interface SffPalette {
  group: number;
  item: number;
  data: Uint8Array; // 1024 bytes RGBA
}

export interface SffData {
  version: string;
  numGroups: number;
  numImages: number;
  images: SffImage[];
  isV2?: boolean;
  palettes?: SffPalette[];
}

export interface AirData {
  actions: Record<number, AirAction>;
}

export interface AirAction {
  id: number;
  name?: string;
  loopstartIndex?: number;
  elements: AirElement[];
  clsn1: ClsnBox[]; // Default Attack boxes - Red
  clsn2: ClsnBox[]; // Default Defense boxes - Blue
}

export interface AirElement {
  group: number;
  image: number;
  xOffset: number;
  yOffset: number;
  time: number;
  flip: string;
  color: string;
  clsn1?: ClsnBox[]; // Frame-specific Attack boxes - Red
  clsn2?: ClsnBox[]; // Frame-specific Defense boxes - Blue
}

export interface ClsnBox {
  id: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
