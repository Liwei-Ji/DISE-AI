import * as tf from "@tensorflow/tfjs";
// 引入 CPU 後端
import "@tensorflow/tfjs-backend-cpu";

export interface Point {
  x: number;
  y: number;
}

export const ColorAlgorithm = {
  model: null as tf.LayersModel | null,
  modelUrl: "/tfjs_model/model.json",
  MODEL_SIZE: 256,

  async loadModel() {
    if (!this.model) {
      console.log("正在初始化 AI 核心 (CPU 模式)...");

      try {
        // 🔥 強制設定為 CPU 後端，跳過所有 GPU 檢查
        // 這能解決 'Failed to compile fragment shader' 的所有問題
        await tf.setBackend("cpu");
        await tf.ready(); // 等待後端準備就緒

        console.log(`目前使用後端: ${tf.getBackend()}`); // 應該要顯示 'cpu'

        console.log("正在載入模型檔案...");
        this.model = await tf.loadLayersModel(this.modelUrl);
        console.log("AI 模型載入成功！");

        // 模型預熱 (Warm up)
        tf.tidy(() => {
          const dummy = tf.zeros([1, this.MODEL_SIZE, this.MODEL_SIZE, 3]);
          this.model!.predict(dummy) as tf.Tensor;
        });

        console.log("模型預熱完成，系統就緒。");
      } catch (e) {
        console.error("嚴重錯誤：無法初始化 CPU 模型", e);
        throw new Error("AI 核心啟動失敗");
      }
    }
  },

  async findBoundary(
    imageData: ImageData,
    seedPoint: Point,
    targetColor: number[] = [],
    tolerance: number = 0,
    epsilon: number = 2.0
  ): Promise<Point[]> {
    await this.loadModel();
    if (!this.model) throw new Error("Model not ready");

    // 使用 tf.tidy 自動管理記憶體 (這在 CPU 模式下依然很重要)
    const { maskData, scaleX, scaleY } = tf.tidy(() => {
      const inputTensor = tf.browser
        .fromPixels(imageData)
        .resizeBilinear([this.MODEL_SIZE, this.MODEL_SIZE])
        .div(255.0) // 正規化 0-1
        .expandDims(0);

      const prediction = this.model!.predict(inputTensor) as tf.Tensor;
      // 取得二值化數據
      const data = prediction.squeeze().greater(0.5).dataSync();

      const sX = imageData.width / this.MODEL_SIZE;
      const sY = imageData.height / this.MODEL_SIZE;

      return { maskData: data, scaleX: sX, scaleY: sY };
    });

    // CPU 後處理
    const scaledSeed = { x: seedPoint.x / scaleX, y: seedPoint.y / scaleY };
    const edgePoints = this.extractEdgesFromMask(
      maskData,
      this.MODEL_SIZE,
      this.MODEL_SIZE
    );

    if (edgePoints.length === 0) throw new Error("AI 未偵測到任何區域");

    const detectionRadius = this.MODEL_SIZE / 2;
    const validPoints = edgePoints.filter((p) => {
      const dist = Math.sqrt(
        Math.pow(p.x - scaledSeed.x, 2) + Math.pow(p.y - scaledSeed.y, 2)
      );
      return dist < detectionRadius;
    });

    const finalPoints = validPoints.length > 10 ? validPoints : edgePoints;
    const hullPoints = this.convexHull(finalPoints);

    const originalSizePoints = hullPoints.map((p) => ({
      x: p.x * scaleX,
      y: p.y * scaleY,
    }));

    return this.simplifyRDP(originalSizePoints, epsilon);
  },

  async scanFrame(
    imageData: ImageData
  ): Promise<{ area: number; polygon: Point[] }> {
    await this.loadModel();
    if (!this.model) throw new Error("Model not ready");

    const { maskData, scaleX, scaleY } = tf.tidy(() => {
      const inputTensor = tf.browser
        .fromPixels(imageData)
        .resizeBilinear([this.MODEL_SIZE, this.MODEL_SIZE])
        .div(255.0)
        .expandDims(0);

      const prediction = this.model!.predict(inputTensor) as tf.Tensor;
      const data = prediction.squeeze().greater(0.5).dataSync();

      const sX = imageData.width / this.MODEL_SIZE;
      const sY = imageData.height / this.MODEL_SIZE;

      return { maskData: data, scaleX: sX, scaleY: sY };
    });

    let whitePixels = 0;
    // 使用 fast loop
    const len = maskData.length;
    for (let i = 0; i < len; i++) {
      if (maskData[i]) whitePixels++;
    }

    const realArea = whitePixels * scaleX * scaleY;

    let originalSizePoints: Point[] = [];
    // 只有當偵測到的區域夠大時才計算輪廓，節省 CPU 資源
    if (whitePixels > 20) {
      const edgePoints = this.extractEdgesFromMask(
        maskData,
        this.MODEL_SIZE,
        this.MODEL_SIZE
      );
      if (edgePoints.length > 0) {
        const hullPoints = this.convexHull(edgePoints);
        originalSizePoints = this.simplifyRDP(
          hullPoints.map((p) => ({
            x: p.x * scaleX,
            y: p.y * scaleY,
          })),
          3.0
        ); // 稍微增加 epsilon 以加速 CPU 運算
      }
    }

    return {
      area: parseFloat(realArea.toFixed(1)),
      polygon: originalSizePoints,
    };
  },

  extractEdgesFromMask(
    data: Int32Array | Uint8Array | Float32Array,
    width: number,
    height: number
  ): Point[] {
    const points: Point[] = [];
    // 減少邊界檢查次數的優化寫法
    const w_minus_1 = width - 1;
    const h_minus_1 = height - 1;

    for (let y = 1; y < h_minus_1; y++) {
      const y_offset = y * width;
      const y_minus_offset = (y - 1) * width;
      const y_plus_offset = (y + 1) * width;

      for (let x = 1; x < w_minus_1; x++) {
        const idx = y_offset + x;
        if (data[idx]) {
          // 只要有一個鄰居是黑的(0)，就是邊緣
          if (
            !data[y_minus_offset + x] ||
            !data[y_plus_offset + x] ||
            !data[y_offset + x - 1] ||
            !data[y_offset + x + 1]
          ) {
            points.push({ x, y });
          }
        }
      }
    }
    return points;
  },

  convexHull(points: Point[]): Point[] {
    if (points.length < 3) return points;
    points.sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
    const cross = (o: Point, a: Point, b: Point) =>
      (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

    const lower: Point[] = [];
    for (let p of points) {
      while (
        lower.length >= 2 &&
        cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
      ) {
        lower.pop();
      }
      lower.push(p);
    }
    const upper: Point[] = [];
    for (let i = points.length - 1; i >= 0; i--) {
      const p = points[i];
      while (
        upper.length >= 2 &&
        cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
      ) {
        upper.pop();
      }
      upper.push(p);
    }
    upper.pop();
    lower.pop();
    return lower.concat(upper);
  },

  simplifyRDP(points: Point[], epsilon: number): Point[] {
    if (points.length <= 2) return points;
    let dmax = 0;
    let index = 0;
    const end = points.length - 1;

    // 效能優化：避免在迴圈中重複計算
    const p1 = points[0];
    const p2 = points[end];
    const normalLength = Math.sqrt(
      Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2)
    );

    for (let i = 1; i < end; i++) {
      const d = this.perpendicularDistance(points[i], p1, p2, normalLength);
      if (d > dmax) {
        index = i;
        dmax = d;
      }
    }
    if (dmax > epsilon) {
      const recResults1 = this.simplifyRDP(points.slice(0, index + 1), epsilon);
      const recResults2 = this.simplifyRDP(points.slice(index), epsilon);
      return recResults1.slice(0, recResults1.length - 1).concat(recResults2);
    } else {
      return [p1, p2];
    }
  },

  perpendicularDistance(p: Point, p1: Point, p2: Point, normalLength?: number) {
    let area = Math.abs(
      0.5 *
        (p1.x * p2.y +
          p2.x * p.y +
          p.x * p1.y -
          p2.x * p1.y -
          p.x * p2.y -
          p1.x * p.y)
    );
    // 如果沒有傳入預先計算好的長度，則計算
    let bottom =
      normalLength ??
      Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
    if (bottom === 0) return 0;
    return (area / bottom) * 2;
  },
};
