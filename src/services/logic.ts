import { Point, Box, AnnotationData, AnalysisStats } from "../types";

// ==================================================================
// Utils
// ==================================================================
export const Utils = {
  formatTime: (sec: number) => {
    sec = Math.floor(sec);
    return `${Math.floor(sec / 60)}:${(sec % 60).toString().padStart(2, "0")}`;
  },

  seekToTime: (video: HTMLVideoElement, t: number): Promise<void> => {
    return new Promise((res) => {
      if (video.readyState >= 2) {
        const onSeeked = () => {
          video.removeEventListener("seeked", onSeeked);
          setTimeout(res, 50);
        };
        video.addEventListener("seeked", onSeeked);
        video.currentTime = t;
      } else {
        const onCanPlay = () => {
          video.removeEventListener("canplay", onCanPlay);
          const onSeeked = () => {
            video.removeEventListener("seeked", onSeeked);
            setTimeout(res, 50);
          };
          video.addEventListener("seeked", onSeeked);
          video.currentTime = t;
        };
        video.addEventListener("canplay", onCanPlay);
      }
    });
  },

  getBoxHandles: (box: Box) => {
    const { x, y, w, h } = box;
    return [
      { x: x, y: y, name: "tl" },
      { x: x + w, y: y, name: "tr" },
      { x: x + w, y: y + h, name: "br" },
      { x: x, y: y + h, name: "bl" },
    ];
  },

  getBoxHandle: (m: Point, box: Box, size: number) => {
    return (
      Utils.getBoxHandles(box).find(
        (h) => Math.abs(m.x - h.x) < size * 2 && Math.abs(m.y - h.y) < size * 2
      )?.name || null
    );
  },

  resizeBox: (handle: string, m: Point, box: Box): Box => {
    let { x, y, w, h: hh } = box;
    switch (handle) {
      case "tl":
        w += x - m.x;
        hh += y - m.y;
        x = m.x;
        y = m.y;
        break;
      case "tr":
        w = m.x - x;
        hh += y - m.y;
        y = m.y;
        break;
      case "br":
        w = m.x - x;
        hh = m.y - y;
        break;
      case "bl":
        w += x - m.x;
        hh = m.y - y;
        x = m.x;
        break;
    }
    if (w < 10) w = 10;
    if (hh < 10) hh = 10;
    return { x, y, w, h: hh };
  },

  getPolygonVertex: (m: Point, polygon: Point[], size: number) => {
    for (let i = 0; i < polygon.length; i++) {
      const p = polygon[i];
      if (Math.abs(p.x - m.x) < size * 2 && Math.abs(p.y - m.y) < size * 2)
        return i;
    }
    return null;
  },

  findEdgeToInsert: (m: Point, polygon: Point[]) => {
    const t = 8;
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i],
        b = polygon[(i + 1) % polygon.length];
      const d = Utils.pointToSegmentDistance(m, a, b);
      if (d < t) return i;
    }
    return null;
  },

  pointToSegmentDistance: (p: Point, a: Point, b: Point) => {
    const A = p.x - a.x,
      B = p.y - a.y,
      C = b.x - a.x,
      D = b.y - a.y;
    const dot = A * C + B * D,
      len = C * C + D * D;
    let t = len === 0 ? -1 : dot / len;
    t = Math.max(0, Math.min(1, t));
    const x = a.x + t * C,
      y = a.y + t * D;
    const dx = p.x - x,
      dy = p.y - y;
    return Math.sqrt(dx * dx + dy * dy);
  },

  getBoxPolygonPoints: (b: Box): Point[] => {
    const { x, y, w, h } = b;
    return [
      { x: x, y: y },
      { x: x + w / 2, y: y },
      { x: x + w, y: y },
      { x: x + w, y: y + h / 2 },
      { x: x + w, y: y + h },
      { x: x + w / 2, y: y + h },
      { x: x, y: y + h },
      { x: x, y: y + h / 2 },
    ];
  },

  calculatePolygonArea: (points: Point[]) => {
    let a = 0,
      n = points.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      a += points[i].x * points[j].y - points[j].x * points[i].y;
    }
    return Math.abs(a / 2);
  },

  getPolygonCentroid: (points: Point[]) => {
    let x = 0,
      y = 0;
    for (const p of points) {
      x += p.x;
      y += p.y;
    }
    return { x: x / points.length, y: y / points.length };
  },

  getMouse: (e: React.MouseEvent | MouseEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  },

  async getVideoFrame(video: HTMLVideoElement, time: number) {
    await Utils.seekToTime(video, time);
    const w = video.videoWidth;
    const h = video.videoHeight;

    // Create temporary canvas for extraction
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Cannot get canvas context");

    ctx.drawImage(video, 0, 0, w, h);
    return {
      imageData: ctx.getImageData(0, 0, w, h),
      dataURL: canvas.toDataURL("image/jpeg", 0.8),
    };
  },
};

// ==================================================================
// ColorAlgorithm
// ==================================================================
export const ColorAlgorithm = {
  async findBoundary(
    imageData: ImageData,
    seedPoint: Point,
    targetColor: number[],
    tolerance: number,
    epsilon: number
  ): Promise<Point[]> {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        try {
          const { width, height, data } = imageData;
          seedPoint = {
            x: Math.round(seedPoint.x),
            y: Math.round(seedPoint.y),
          };

          const visited = this.floodFill(
            data,
            width,
            height,
            seedPoint,
            targetColor,
            tolerance
          );
          if (!visited || visited.size === 0) {
            return reject(new Error("找不到相符的顏色區域。"));
          }

          const boundaryPixels = this.traceContour(visited, width, height);
          if (boundaryPixels.length < 3) {
            return reject(new Error("無法形成封閉區域。"));
          }

          const hullPoints = this.convexHull(boundaryPixels);
          const simplifiedPoints = this.simplifyRDP(hullPoints, epsilon);

          resolve(simplifiedPoints);
        } catch (e) {
          reject(e);
        }
      }, 0);
    });
  },

  floodFill(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    start: Point,
    target: number[],
    tol: number
  ) {
    const visited = new Set<string>();
    const queue = [start];
    const targetR = target[0],
      targetG = target[1],
      targetB = target[2];

    const getIndex = (x: number, y: number) => (y * width + x) * 4;
    const key = (x: number, y: number) => `${x},${y}`;

    const startIdx = getIndex(start.x, start.y);
    if (
      !this.colorMatch(
        data[startIdx],
        data[startIdx + 1],
        data[startIdx + 2],
        targetR,
        targetG,
        targetB,
        tol
      )
    ) {
      for (let y = start.y - 2; y <= start.y + 2; y++) {
        for (let x = start.x - 2; x <= start.x + 2; x++) {
          if (x >= 0 && x < width && y >= 0 && y < height) {
            const idx = getIndex(x, y);
            if (
              this.colorMatch(
                data[idx],
                data[idx + 1],
                data[idx + 2],
                targetR,
                targetG,
                targetB,
                tol
              )
            ) {
              start = { x, y };
              visited.add(key(start.x, start.y));
              queue.push(start);
              break;
            }
          }
        }
        if (queue.length > 0) break;
      }

      if (queue.length === 0) {
        return visited;
      }
    } else {
      visited.add(key(start.x, start.y));
    }

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) continue;
      const { x, y } = current;
      const neighbors = [
        [x, y - 1],
        [x, y + 1],
        [x - 1, y],
        [x + 1, y],
      ];

      for (const [nx, ny] of neighbors) {
        if (
          nx >= 0 &&
          nx < width &&
          ny >= 0 &&
          ny < height &&
          !visited.has(key(nx, ny))
        ) {
          const idx = getIndex(nx, ny);
          if (
            this.colorMatch(
              data[idx],
              data[idx + 1],
              data[idx + 2],
              targetR,
              targetG,
              targetB,
              tol
            )
          ) {
            visited.add(key(nx, ny));
            queue.push({ x: nx, y: ny });
          }
        }
      }
    }
    return visited;
  },

  colorMatch(
    r: number,
    g: number,
    b: number,
    tr: number,
    tg: number,
    tb: number,
    tol: number
  ) {
    const dist = Math.sqrt(
      Math.pow(r - tr, 2) + Math.pow(g - tg, 2) + Math.pow(b - tb, 2)
    );
    return dist <= tol;
  },

  traceContour(visited: Set<string>, width: number, height: number) {
    const boundaryPoints: Point[] = [];
    const dirs = [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ];

    for (const key of visited) {
      const [x, y] = key.split(",").map(Number);
      let isBoundary = false;
      for (const [dx, dy] of dirs) {
        const nx = x + dx;
        const ny = y + dy;
        if (
          nx < 0 ||
          nx >= width ||
          ny < 0 ||
          ny >= height ||
          !visited.has(`${nx},${ny}`)
        ) {
          isBoundary = true;
          break;
        }
      }
      if (isBoundary) {
        boundaryPoints.push({ x, y });
      }
    }
    return boundaryPoints;
  },

  convexHull(points: Point[]) {
    if (points.length < 3) return points;
    points.sort((a, b) => a.x - b.x || a.y - b.y);
    const cross = (o: Point, a: Point, b: Point) =>
      (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const upper: Point[] = [],
      lower: Point[] = [];
    for (const p of points) {
      while (
        lower.length >= 2 &&
        cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
      )
        lower.pop();
      lower.push(p);
    }
    for (let i = points.length - 1; i >= 0; i--) {
      const p = points[i];
      while (
        upper.length >= 2 &&
        cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
      )
        upper.pop();
      upper.push(p);
    }
    upper.pop();
    lower.pop();
    return lower.concat(upper);
  },

  simplifyRDP(points: Point[], epsilon: number): Point[] {
    if (points.length < 3) return points;
    let dmax = 0;
    let index = 0;
    const end = points.length - 1;
    for (let i = 1; i < end; i++) {
      const d = this.perpDist(points[i], points[0], points[end]);
      if (d > dmax) {
        index = i;
        dmax = d;
      }
    }
    if (dmax > epsilon) {
      const res1 = this.simplifyRDP(points.slice(0, index + 1), epsilon);
      const res2 = this.simplifyRDP(points.slice(index, end + 1), epsilon);
      return res1.slice(0, res1.length - 1).concat(res2);
    } else {
      return [points[0], points[end]];
    }
  },
  perpDist(p: Point, p1: Point, p2: Point) {
    let dx = p2.x - p1.x,
      dy = p2.y - p1.y;
    if (dx === 0 && dy === 0) return Math.hypot(p.x - p1.x, p.y - p1.y);
    const num = Math.abs(dy * p.x - dx * p.y + p2.x * p1.y - p2.y * p1.x);
    const den = Math.hypot(dx, dy);
    return num / den;
  },
};

// ==================================================================
// SummaryManager
// ==================================================================
export class SummaryManager {
  static classifyArea(area: string | number) {
    const a = typeof area === "string" ? parseFloat(area) : area;
    if (a < 10000) return "小 (S)";
    if (a < 90000) return "中 (M)";
    if (a < 400000) return "大 (L)";
    return "極大 (XL)";
  }

  static calculateStats(
    annotationsMap: Map<number, AnnotationData>
  ): AnalysisStats {
    const validData = Array.from(annotationsMap.values()).filter(
      (item) => item.area && parseFloat(item.area) > 0
    );

    if (validData.length < 2) {
      const singleData =
        validData.length === 1
          ? validData[0]
          : ({
              time: 0,
              area: "0",
              areaCategory: "N/A",
              polygon: [],
              box: null,
              srcDataUrl: "",
              obs_pct: 0,
            } as AnnotationData);
      return {
        error: "需要至少兩筆有效數據才能分析！",
        smallest: singleData,
        largest: singleData,
        obstructionPercent: 0,
        voteScore: 0,
      };
    }

    const sorted = [...validData].sort(
      (a, b) => parseFloat(a.area) - parseFloat(b.area)
    );
    const smallest = sorted[0];
    const largest = sorted[sorted.length - 1];

    const minArea = parseFloat(smallest.area);
    const maxArea = parseFloat(largest.area);

    const obstructionPercent =
      maxArea > 0 ? ((maxArea - minArea) / maxArea) * 100 : 0;

    let voteScore = 0;
    if (obstructionPercent > 75) voteScore = 2;
    else if (obstructionPercent >= 50) voteScore = 1;

    return {
      smallest: { ...smallest },
      largest: { ...largest },
      obstructionPercent,
      voteScore,
    };
  }

  static getCoordText(d: AnnotationData) {
    if (d.box) {
      const b = d.box;
      return `矩形(x:${b.x.toFixed(0)}, y:${b.y.toFixed(0)}, w:${b.w.toFixed(
        0
      )}, h:${b.h.toFixed(0)})`;
    } else if (d.polygon && d.polygon.length > 0) {
      return (
        "多邊形: " +
        d.polygon
          .map((p) => `(${p.x.toFixed(0)},${p.y.toFixed(0)})`)
          .slice(0, 5)
          .join(" ") +
        "..."
      );
    }
    return "—";
  }

  static async generateOverlayImage(data: AnnotationData): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Cannot get canvas ctx"));
          return;
        }
        ctx.drawImage(img, 0, 0);

        if (data.box) {
          const { x, y, w, h } = data.box;
          ctx.strokeStyle = "white";
          ctx.lineWidth = 3;
          ctx.strokeRect(x, y, w, h);
        } else if (data.polygon && data.polygon.length > 0) {
          ctx.beginPath();
          const points = data.polygon;
          ctx.moveTo(points[0].x, points[0].y);
          for (let i = 1; i < points.length; i++)
            ctx.lineTo(points[i].x, points[i].y);
          ctx.closePath();
          ctx.strokeStyle = "white";
          ctx.lineWidth = 3;
          ctx.stroke();
        }

        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(10, 10, 250, 110);

        ctx.fillStyle = "white";
        ctx.font = "20px Arial";
        ctx.fillText(`面積: ${data.area} px²`, 20, 40);
        if (typeof data.time === "number") {
          ctx.fillText(`時間: ${Utils.formatTime(data.time)}`, 20, 70);
        }
        if (data.areaCategory) {
          ctx.fillText(`分類: ${data.areaCategory}`, 20, 100);
        }

        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = reject;

      if (data.srcDataUrl) {
        img.src = data.srcDataUrl;
      } else {
        console.error("找不到圖片 src", data);
        reject(new Error("找不到圖片 src"));
      }
    });
  }
}
