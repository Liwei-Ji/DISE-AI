import React, { useEffect, useRef, useState, useCallback } from "react";
import { AnnotationData, Box, Point } from "../types";

// 🟢 1. 同時引入舊邏輯與新 AI
// 把原本 logic 裡的 ColorAlgorithm 取名為 'ColorAlgo'
import {
  ColorAlgorithm as ColorAlgo,
  Utils,
  SummaryManager,
} from "../services/logic";
// 把新的 AIColorAlgorithm 取名為 'AIModel'
import { ColorAlgorithm as AIModel } from "./AIColorAlgorithm";

interface AnnotationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: Partial<AnnotationData>) => void;
  initialData: AnnotationData | null;
}

export const AnnotationModal: React.FC<AnnotationModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialData,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [mode, setMode] = useState<"box" | "polygon">("polygon");
  const [tolerance, setTolerance] = useState(30);
  const [epsilon, setEpsilon] = useState(2.0);
  const [isAutoSelectMode, setIsAutoSelectMode] = useState(false);
  const [processing, setProcessing] = useState(false);

  // 🟢 2. 新增一個狀態來控制演算法模式 ('ai' 或 'color')
  const [algoType, setAlgoType] = useState<"ai" | "color">("ai");

  const [box, setBox] = useState<Box | null>(null);
  const [polygon, setPolygon] = useState<Point[]>([]);
  const [imgElement, setImgElement] = useState<HTMLImageElement | null>(null);
  const [currentArea, setCurrentArea] = useState<string>("0");

  const draggingHandleRef = useRef<string | null>(null);
  const dragIndexRef = useRef<number | null>(null);
  const pixelCtxRef = useRef<CanvasRenderingContext2D | null>(null);

  // Initialize
  useEffect(() => {
    if (isOpen && initialData) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        setImgElement(img);
        const pCanvas = document.createElement("canvas");
        pCanvas.width = img.width;
        pCanvas.height = img.height;
        const pCtx = pCanvas.getContext("2d", { willReadFrequently: true });
        if (pCtx) {
          pCtx.drawImage(img, 0, 0);
          pixelCtxRef.current = pCtx;
        }

        if (initialData.polygon && initialData.polygon.length > 0) {
          setPolygon([...(initialData.polygon as Point[])]);
          setBox(null);
          setMode("polygon");
        } else if (initialData.box) {
          setBox({ ...initialData.box });
          setPolygon([]);
          setMode("box");
        } else {
          setPolygon([]);
          setBox(null);
          setMode("polygon");
        }
      };
      img.src = initialData.srcDataUrl;
    }
  }, [isOpen, initialData]);

  // Draw Loop
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !imgElement) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(imgElement, 0, 0);

    const HANDLE_SIZE = 8;

    if (mode === "box" && box) {
      ctx.fillStyle = "rgba(59, 130, 246, 0.2)";
      ctx.fillRect(box.x, box.y, box.w, box.h);
      ctx.strokeStyle = "#60a5fa";
      ctx.lineWidth = 2;
      ctx.strokeRect(box.x, box.y, box.w, box.h);

      const handles = Utils.getBoxHandles(box);
      ctx.fillStyle = "white";
      ctx.strokeStyle = "#2563eb";
      ctx.lineWidth = 1;
      handles.forEach((h) => {
        ctx.fillRect(
          h.x - HANDLE_SIZE / 2,
          h.y - HANDLE_SIZE / 2,
          HANDLE_SIZE,
          HANDLE_SIZE
        );
        ctx.strokeRect(
          h.x - HANDLE_SIZE / 2,
          h.y - HANDLE_SIZE / 2,
          HANDLE_SIZE,
          HANDLE_SIZE
        );
      });

      const area = box.w * box.h;
      setCurrentArea(area.toFixed(1));
    } else if (mode === "polygon" && polygon) {
      ctx.fillStyle = "rgba(59, 130, 246, 0.2)";
      ctx.strokeStyle = "#60a5fa";
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (polygon.length > 0) {
        ctx.moveTo(polygon[0].x, polygon[0].y);
        polygon.forEach((p) => ctx.lineTo(p.x, p.y));
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "white";
      ctx.strokeStyle = "#2563eb";
      ctx.lineWidth = 1;
      polygon.forEach((p) => {
        ctx.fillRect(
          p.x - HANDLE_SIZE / 2,
          p.y - HANDLE_SIZE / 2,
          HANDLE_SIZE,
          HANDLE_SIZE
        );
        ctx.strokeRect(
          p.x - HANDLE_SIZE / 2,
          p.y - HANDLE_SIZE / 2,
          HANDLE_SIZE,
          HANDLE_SIZE
        );
      });

      const area = Utils.calculatePolygonArea(polygon);
      setCurrentArea(area.toFixed(1));
    }
  }, [box, polygon, mode, imgElement]);

  useEffect(() => {
    if (imgElement && canvasRef.current) {
      canvasRef.current.width = imgElement.width;
      canvasRef.current.height = imgElement.height;
      draw();
    }
  }, [imgElement, draw]);

  // Handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!canvasRef.current || !imgElement) return;
    const m = Utils.getMouse(e, canvasRef.current);

    if (isAutoSelectMode) {
      performAutoSelect(m);
      return;
    }

    if (mode === "box" && box) {
      draggingHandleRef.current = Utils.getBoxHandle(m, box, 8);
    } else if (mode === "polygon") {
      dragIndexRef.current = Utils.getPolygonVertex(m, polygon, 8);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!canvasRef.current || !imgElement) return;
    const m = Utils.getMouse(e, canvasRef.current);

    if (mode === "box" && box && draggingHandleRef.current) {
      setBox(Utils.resizeBox(draggingHandleRef.current, m, box));
    } else if (mode === "polygon" && dragIndexRef.current !== null) {
      const newPoly = [...polygon];
      newPoly[dragIndexRef.current] = m;
      setPolygon(newPoly);
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!canvasRef.current || !imgElement) return;
    const m = Utils.getMouse(e, canvasRef.current);

    if (
      mode === "polygon" &&
      dragIndexRef.current === null &&
      !isAutoSelectMode
    ) {
      const idx = Utils.findEdgeToInsert(m, polygon);
      if (idx !== null) {
        const newPoly = [...polygon];
        newPoly.splice(idx + 1, 0, m);
        setPolygon(newPoly);
      } else if (polygon.length === 0) {
        setPolygon([m]);
      }
    }
    draggingHandleRef.current = null;
    dragIndexRef.current = null;
  };

  const toggleMode = () => {
    setIsAutoSelectMode(false);
    if (mode === "box" && box) {
      const pts = Utils.getBoxPolygonPoints(box);
      setPolygon(pts);
      setBox(null);
      setMode("polygon");
    } else if (mode === "polygon" && polygon.length > 0) {
      const xs = polygon.map((p) => p.x);
      const ys = polygon.map((p) => p.y);
      setBox({
        x: Math.min(...xs),
        y: Math.min(...ys),
        w: Math.max(...xs) - Math.min(...xs),
        h: Math.max(...ys) - Math.min(...ys),
      });
      setPolygon([]);
      setMode("box");
    } else {
      setMode(mode === "box" ? "polygon" : "box");
    }
  };

  // 🟢 3. 雙模自動選取邏輯
  const performAutoSelect = async (p: Point) => {
    if (!pixelCtxRef.current || !imgElement) return;
    setProcessing(true);

    try {
      const pixelData = pixelCtxRef.current.getImageData(
        Math.round(p.x),
        Math.round(p.y),
        1,
        1
      ).data;
      const targetColor = [pixelData[0], pixelData[1], pixelData[2]];
      const imageData = pixelCtxRef.current.getImageData(
        0,
        0,
        imgElement.width,
        imgElement.height
      );

      let points: Point[] = [];

      if (algoType === "ai") {
        console.log("🚀 [Auto Select] 使用 AI 模型推論...");
        points = await AIModel.findBoundary(
          imageData,
          p,
          targetColor,
          tolerance,
          epsilon
        );
      } else {
        console.log("🎨 [Auto Select] 使用顏色演算法 (Flood Fill)...");
        // 使用舊的邏輯
        points = await ColorAlgo.findBoundary(
          imageData,
          p,
          targetColor,
          tolerance,
          epsilon
        );
      }

      setPolygon(points);
      setMode("polygon");
      setBox(null);
      setIsAutoSelectMode(false);
    } catch (e) {
      console.error(e);
      alert(
        algoType === "ai" ? "AI 偵測失敗，請重試" : "顏色選取失敗，請調整容許值"
      );
    } finally {
      setProcessing(false);
    }
  };

  const handleSave = () => {
    if (!initialData) return;
    let areaVal = 0;
    let boxData: Box | undefined = undefined;
    let polygonData: Point[] | undefined = undefined;

    if (mode === "box" && box) {
      areaVal = box.w * box.h;
      boxData = box;
      polygonData = [];
    } else if (mode === "polygon" && polygon) {
      areaVal = Utils.calculatePolygonArea(polygon);
      polygonData = polygon;
      boxData = undefined;
    }

    onSave({
      area: areaVal.toFixed(1),
      areaCategory: SummaryManager.classifyArea(areaVal),
      box: boxData || null,
      polygon: polygonData || [],
      time: initialData.time,
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/90 backdrop-blur-sm flex flex-col items-center justify-center p-4 animate-fade-in">
      <div className="bg-white/10 backdrop-blur-lg border border-white/20 rounded-2xl p-3 mb-6 flex items-center gap-6 w-full max-w-4xl shadow-2xl ring-1 ring-black/5">
        <div className="flex items-center space-x-4 px-2 border-r border-white/10 pr-6">
          {/* 🟢 4. UI 調整：根據模式決定是否禁用 Tolerance */}
          <div
            className={`flex flex-col group ${
              algoType === "ai" ? "opacity-50 cursor-not-allowed" : ""
            }`}
          >
            <label className="text-[10px] text-blue-200 uppercase tracking-wider font-bold mb-1.5 flex justify-between">
              <span>Color Tolerance</span>
              <span className="text-white">{tolerance}</span>
            </label>
            <input
              type="range"
              min="1"
              max="100"
              value={tolerance}
              onChange={(e) => setTolerance(Number(e.target.value))}
              className="w-32 h-1.5 bg-white/20 rounded-lg appearance-none cursor-pointer accent-blue-400"
              disabled={algoType === "ai"}
            />
          </div>
          <div className="flex flex-col group">
            <label className="text-[10px] text-blue-200 uppercase tracking-wider font-bold mb-1.5 flex justify-between">
              <span>Anchor Detail</span>
              <span className="text-white">{epsilon}</span>
            </label>
            <input
              type="range"
              min="0.5"
              max="10"
              step="0.1"
              value={epsilon}
              onChange={(e) => setEpsilon(Number(e.target.value))}
              className="w-32 h-1.5 bg-white/20 rounded-lg appearance-none cursor-pointer accent-blue-400 hover:accent-blue-300"
            />
          </div>
        </div>

        <div className="flex-grow flex items-center justify-center space-x-3">
          <button
            onClick={toggleMode}
            className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-sm font-medium transition-all shadow-lg border border-slate-600"
          >
            <span>{mode === "box" ? "⬜" : "🔷"}</span>
            {mode === "box" ? "Polygon" : "Rect"}
          </button>

          {/* 🟢 5. 演算法切換按鈕 (類似 Toggle Switch) */}
          <div className="bg-slate-900 rounded-xl p-1 flex border border-slate-700">
            <button
              onClick={() => setAlgoType("color")}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                algoType === "color"
                  ? "bg-blue-600 text-white shadow"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Color
            </button>
            <button
              onClick={() => setAlgoType("ai")}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                algoType === "ai"
                  ? "bg-purple-600 text-white shadow"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              AI
            </button>
          </div>

          <button
            onClick={() => setIsAutoSelectMode(!isAutoSelectMode)}
            disabled={processing}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all shadow-lg border ${
              isAutoSelectMode
                ? "bg-yellow-500 hover:bg-yellow-400 text-white border-yellow-400 ring-2 ring-yellow-200/50"
                : algoType === "ai"
                ? "bg-gradient-to-r from-purple-600 to-pink-600 text-white"
                : "bg-gradient-to-r from-blue-600 to-indigo-600 text-white"
            } ${processing ? "opacity-70 cursor-wait" : ""}`}
          >
            <span>🪄</span>
            {processing
              ? "Processing..."
              : isAutoSelectMode
              ? "Click Object"
              : "Auto Select"}
          </button>
        </div>

        <div className="flex items-center space-x-3 border-l border-white/10 pl-6">
          <div className="flex flex-col items-end mr-2">
            <span className="text-blue-200 text-[10px] uppercase font-bold">
              Area
            </span>
            <span className="text-white font-mono text-sm font-bold">
              {currentArea}
            </span>
          </div>

          <button
            onClick={handleSave}
            className="px-5 py-2 bg-green-500 hover:bg-green-400 text-white rounded-xl text-sm font-bold shadow-lg transition-all active:scale-95"
          >
            Save
          </button>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
          >
            ✕
          </button>
        </div>
      </div>

      <div
        className={`relative rounded-lg overflow-hidden shadow-2xl ring-4 ring-slate-800 ${
          isAutoSelectMode ? "cursor-crosshair" : "cursor-default"
        }`}
      >
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          className="bg-black max-h-[80vh] max-w-full block"
        />
        {isAutoSelectMode && (
          <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-yellow-500/90 text-white px-6 py-2 rounded-full text-sm font-bold pointer-events-none backdrop-blur-md shadow-lg animate-bounce">
            {algoType === "ai"
              ? "🤖 AI Mode: Click any object"
              : "🎨 Color Mode: Click specific color"}
          </div>
        )}
      </div>
    </div>
  );
};
