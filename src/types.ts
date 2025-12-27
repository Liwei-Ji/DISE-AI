export interface Point {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AnnotationData {
  time: number;
  area: string;
  areaCategory?: "Min" | "Max" | string;
  polygon: Point[] | any[];
  box: Box | any;
  srcDataUrl: string;
  obs_pct?: number;
  v_height?: number; // 軟顎高度 (V-site)
  o_width?: number; // 側壁寬度 (O-site)
}

export interface AnalysisStats {
  smallest: AnnotationData;
  largest: AnnotationData;
  obstructionPercent: number;
  voteScore: number;
  error?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "bot" | "system";
  content: string;
  type: "text" | "analysis_result" | "image";
  data?: any;
  timestamp: number;
}

export interface EditingState {
  type: "min" | "max";
  time: number;
}

export interface TimeSegment {
  start: number;
  end: number;
}
