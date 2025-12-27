import React, { useState, useRef, useEffect } from "react";
import {
  Send,
  Upload,
  Settings,
  Activity,
  Square,
  CheckCircle2,
} from "lucide-react";

// --- 引入 Heroicons 圖標 ---
import { SlashIcon } from "@heroicons/react/24/solid";

import { ChatBubble } from "./components/ChatBubble";
import { AnnotationModal } from "./components/AnnotationModal";
import {
  ChatMessage,
  AnnotationData,
  EditingState,
  TimeSegment,
} from "./types";

import { Utils, SummaryManager } from "./services/logic";

function App() {
  // --- State ---
  const [apiUrl, setApiUrl] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "init",
      role: "bot",
      content:
        "您好！我是 DISE AI Agent。\n您可以上傳內視鏡影片進行分析，或是直接用文字詢問我關於 DISE 的醫學知識。",
      type: "text",
      timestamp: Date.now(),
    },
  ]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // --- 狀態機 ---
  const [appState, setAppState] = useState<
    | "WAITING"
    | "AWAITING_TIME"
    | "AWAITING_SITE"
    | "READY"
    | "ANALYZING"
    | "DONE"
  >("WAITING");

  const [videoDuration, setVideoDuration] = useState(0);
  const [analysisSegments, setAnalysisSegments] = useState<TimeSegment[]>([]);
  // --- 選擇的 Site ---
  const [selectedSite, setSelectedSite] = useState<"V" | "O" | null>(null);
  const [pendingUrl, setPendingUrl] = useState("");

  // --- Logic State ---
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const allAnnotations = useRef<Map<number, AnnotationData>>(new Map());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const shouldStopRef = useRef(false);

  // --- Modal State ---
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalData, setModalData] = useState<AnnotationData | null>(null);
  const [editingState, setEditingState] = useState<EditingState | null>(null);

  // --- Helpers ---
  const addMessage = (
    role: "user" | "bot" | "system",
    content: string,
    type: "text" | "analysis_result" | "image" = "text",
    data?: any
  ) => {
    const now = Date.now();
    setMessages((prev) => [
      ...prev,
      {
        id: Date.now().toString() + Math.random(),
        role,
        content,
        type,
        data,
        timestamp: now,
      },
    ]);
  };

  const parseTimeInput = (
    input: string,
    maxDuration: number
  ): TimeSegment[] | null => {
    if (input.includes("全部") || input.toLowerCase().includes("all")) {
      return [{ start: 0, end: maxDuration > 0 ? maxDuration : 0 }];
    }

    const segments: TimeSegment[] = [];
    const parts = input.split(/[,，、]/);

    for (const part of parts) {
      const regex = /((?:\d+:)?\d+)\s*[-~to到]\s*((?:\d+:)?\d+)/;
      const match = part.match(regex);

      if (match) {
        const parseSeconds = (timeStr: string) => {
          if (timeStr.includes(":")) {
            const [m, s] = timeStr.split(":").map(Number);
            return m * 60 + s;
          }
          return Number(timeStr);
        };

        const start = parseSeconds(match[1]);
        const end = parseSeconds(match[2]);

        if (!isNaN(start) && !isNaN(end) && end > start) {
          const finalEnd = maxDuration > 0 ? Math.min(maxDuration, end) : end;
          segments.push({
            start: Math.max(0, start),
            end: finalEnd,
          });
        }
      }
    }
    return segments.length > 0 ? segments : null;
  };

  // --- Handlers ---
  const handleUploadClick = () => fileInputRef.current?.click();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !videoRef.current) return;

    const url = URL.createObjectURL(file);
    videoRef.current.src = url;
    videoRef.current.load();

    addMessage("system", `正在載入影片: ${file.name}`);

    const onLoaded = () => {
      const duration = videoRef.current?.duration || 0;
      setVideoDuration(duration);
      setAppState("AWAITING_TIME");

      const minStr = Math.floor(duration / 60);
      const secStr = Math.floor(duration % 60);

      addMessage(
        "bot",
        `影片載入完成 (長度 ${minStr}分${secStr}秒)。\n\n為了提高準確度，請告訴我您想分析的時間區間。\n例如：\n👉 輸入「0:10-0:50」\n👉 輸入「全部」分析整支影片`
      );

      videoRef.current?.removeEventListener("loadedmetadata", onLoaded);
    };
    videoRef.current.addEventListener("loadedmetadata", onLoaded);
  };

  // --- 處理 Site 選擇 ---
  const handleSiteSelection = (site: "V" | "O") => {
    setSelectedSite(site);
    addMessage(
      "user",
      site === "V" ? "分析 V-Site (軟顎)" : "分析 O-Site (口咽)"
    );

    // --- 進入分析 ---
    startAnalysis(pendingUrl || undefined, analysisSegments, site);
    setPendingUrl("");
  };

  // --- 停止分析 ---
  const handleStopAnalysis = () => {
    if (window.confirm("確定要停止目前的分析任務嗎？")) {
      shouldStopRef.current = true;
      setIsLoading(false);
      setAppState("READY");
      addMessage("system", "使用者已手動停止分析");
    }
  };

  // --- 發送請求 ---
  const startAnalysis = async (
    directUrl?: string,
    customSegments?: TimeSegment[],
    siteType?: "V" | "O",
    textContent?: string
  ) => {
    shouldStopRef.current = false;

    // --- 判斷是否「純文字聊天模式」---
    const isChatMode = !!textContent;

    const hasFile = fileInputRef.current?.files?.length;
    const targetUrl = directUrl || inputValue;
    const hasLink = targetUrl.trim().startsWith("http");
    const segmentsToUse = customSegments || analysisSegments;
    const primarySegment =
      segmentsToUse.length > 0 ? segmentsToUse[0] : { start: 0, end: 0 };

    if (!apiUrl.trim()) {
      addMessage("bot", "⚠️ 請輸入 API 網址！");
      return;
    }

    // --- 聊天模式，不檢查影片 ---
    if (!isChatMode && !hasFile && !hasLink) {
      addMessage("bot", "請先上傳影片或貼上公開連結");
      return;
    }

    if (!isChatMode) {
      setAppState("ANALYZING");
      setIsLoading(true);
      if (hasLink) {
        addMessage("bot", "正在處理影片中...");
      } else {
        addMessage("bot", "影片較大，正在背景啟動分析任務...");
      }
    } else {
      // --- 聊天模式顯示簡單的 loading ---
      setIsLoading(true);
    }

    try {
      const endpoint = `${apiUrl.replace(/\/$/, "")}/analyze`;
      let bodyData;
      let headers: HeadersInit = {
        "ngrok-skip-browser-warning": "69420",
      };

      const siteParam = siteType || "V";

      if (isChatMode) {
        // --- 純文字聊天 Payload ---
        bodyData = JSON.stringify({
          text: textContent,
        });
        headers["Content-Type"] = "application/json";
      } else if (hasFile) {
        // --- 上傳影片 FormData ---
        const formData = new FormData();
        formData.append("video", fileInputRef.current!.files![0]);
        formData.append("start_time", primarySegment.start.toString());
        formData.append("end_time", primarySegment.end.toString());
        formData.append("site", siteParam);
        bodyData = formData;
      } else if (hasLink) {
        // ---  影片連結 JSON ---
        bodyData = JSON.stringify({
          video_url: targetUrl.trim(),
          start_time: primarySegment.start,
          end_time: primarySegment.end,
          site: siteParam,
        });
        headers["Content-Type"] = "application/json";
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers: headers,
        body: bodyData,
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Server Error: ${errText}`);
      }

      const resData = await response.json();

      // --- 處理聊天回應 (task_id: "chat") ---
      if (resData.task_id === "chat") {
        addMessage("bot", resData.result.content);
        setIsLoading(false);
        return; // 聊天結束
      }

      // --- 影片輪詢邏輯 ---
      const taskId = resData.task_id;
      addMessage(
        "bot",
        `任務建立 (ID: ${taskId.slice(0, 4)}...)，分析 ${siteParam}-Site 中...`
      );

      const checkStatus = async (): Promise<any> => {
        const statusUrl = `${apiUrl.replace(/\/$/, "")}/status/${taskId}`;
        let retryCount = 0;
        const maxRetries = 10;

        while (true) {
          if (shouldStopRef.current) throw new Error("User Aborted");
          await new Promise((resolve) => setTimeout(resolve, 3000));
          try {
            const statusRes = await fetch(statusUrl, {
              headers: { "ngrok-skip-browser-warning": "69420" },
            });
            if (!statusRes.ok) {
              retryCount++;
              if (retryCount > maxRetries) throw new Error("Server unstable");
              continue;
            }
            const statusData = await statusRes.json();
            retryCount = 0;
            console.log(
              "AI Progress:",
              statusData.status,
              `(${statusData.progress}%)`
            );

            if (statusData.status === "completed") return statusData.result;
            else if (statusData.status === "failed")
              throw new Error(statusData.error || "Unknown Error");
          } catch (e) {
            retryCount++;
            if (retryCount > maxRetries) throw new Error("Network lost");
          }
        }
      };

      const result = await checkStatus();
      if (shouldStopRef.current) return;

      const worstTime = result.worst.time;
      const bestTime = result.best.time;

      // --- 接收 polygon 數據 ---
      allAnnotations.current.set(worstTime, {
        time: worstTime,
        area: result.worst.area.toString(),
        areaCategory: "Min",
        // --- 接收後端多邊形座標，沒有給空陣列 ---
        polygon: result.worst.polygon || [],
        box: null,
        srcDataUrl: result.worst.image,
        obs_pct: result.worst.obs_pct,
        v_height: result.worst.v_height,
        o_width: result.worst.o_width,
      });

      allAnnotations.current.set(bestTime, {
        time: bestTime,
        area: result.best.area.toString(),
        areaCategory: "Max",
        // --- 接收後端傳來多邊形座標 ---
        polygon: result.best.polygon || [],
        box: null,
        srcDataUrl: result.best.image,
        obs_pct: result.best.obs_pct,
        v_height: result.best.v_height,
        o_width: result.best.o_width,
      });

      const stats = {
        largest: allAnnotations.current.get(bestTime)!,
        smallest: allAnnotations.current.get(worstTime)!,
        obstructionPercent: result.worst.obs_pct,
        voteScore:
          result.worst.obs_pct > 75 ? 2 : result.worst.obs_pct > 50 ? 1 : 0,
        site: siteParam,
      };

      addMessage(
        "bot",
        `分析完成！\n 最嚴重阻塞: ${result.worst.time}s\n 最順暢時刻: ${result.best.time}s`,
        "analysis_result",
        stats
      );
      setAppState("DONE");
    } catch (error) {
      if ((error as Error).message === "User Aborted") {
        console.log("Analysis stopped by user.");
      } else {
        console.error("Critical Error:", error);
        addMessage("bot", `錯誤: ${(error as Error).message}`);
      }
      if (appState !== "DONE") setAppState("READY");
    } finally {
      setIsLoading(false);
      setSelectedSite(null);
    }
  };

  const handleSendMessage = async () => {
    if (isLoading || appState === "ANALYZING") {
      handleStopAnalysis();
      return;
    }

    const text = inputValue.trim();
    if (!text) return;

    if (appState === "AWAITING_SITE") {
      addMessage("user", text);
      setInputValue("");
      addMessage("bot", "請選擇分析 **V-Site** 還是 **O-Site**");
      return;
    }

    addMessage("user", text);
    setInputValue("");

    const isUrl = text.startsWith("http");

    // --- 允許在 WAITING / READY / DONE 狀態下聊天 ---
    if (appState === "WAITING" || appState === "READY" || appState === "DONE") {
      if (isUrl) {
        setPendingUrl(text);
        setAppState("AWAITING_TIME");
        addMessage("bot", "收到影片連結！請輸入時間區間 (例: 0:10-0:50)");
        return;
      } else {
        // --- 純文字聊天 -> 呼叫 Qwen ---
        await startAnalysis(undefined, undefined, undefined, text);
        return;
      }
    }

    if (appState === "AWAITING_TIME") {
      if (isUrl) {
        setPendingUrl(text);
        addMessage("bot", "收到新的影片連結！請重新輸入時間區間");
        return;
      }
      const segments = parseTimeInput(text, videoDuration);
      if (!segments) {
        addMessage("bot", "格式不對？請輸入「0:10-1:00」或是「全部」");
        return;
      }
      setAnalysisSegments(segments);
      addMessage("bot", `時間鎖定，請選擇部位：`);
      setAppState("AWAITING_SITE");
      return;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter") {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const openModal = async (type: "min" | "max", time: number) => {
    const data = allAnnotations.current.get(time);
    if (data) {
      setEditingState({ type, time });
      if (!data.srcDataUrl && videoRef.current) {
        setIsLoading(true);
        try {
          const { dataURL } = await Utils.getVideoFrame(videoRef.current, time);
          data.srcDataUrl = dataURL;
          allAnnotations.current.set(time, data);
        } catch (e) {
          console.error("補抓圖片失敗", e);
        } finally {
          setIsLoading(false);
        }
      }
      setModalData({ ...data });
      setIsModalOpen(true);
    }
  };

  const handleModalSave = async (updatedParts: Partial<AnnotationData>) => {
    if (!editingState || !modalData) return;
    const { time, type } = editingState;
    const original = allAnnotations.current.get(time);
    if (!original) return;

    const updatedAnnotation = { ...original, ...updatedParts };
    allAnnotations.current.set(time, updatedAnnotation);

    const newStats = SummaryManager.calculateStats(allAnnotations.current);
    newStats.largest.srcDataUrl = await SummaryManager.generateOverlayImage(
      newStats.largest
    );
    newStats.smallest.srcDataUrl = await SummaryManager.generateOverlayImage(
      newStats.smallest
    );

    addMessage("bot", `數據已修正`, "analysis_result", newStats);
    setIsModalOpen(false);
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading, appState]);

  return (
    <div className="flex flex-col h-screen bg-white font-sans text-slate-800">
      <video ref={videoRef} className="hidden" muted playsInline />
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Header */}
      <div className="fixed top-0 left-0 w-full z-50 pointer-events-none">
        <div className="flex items-center justify-between px-4 py-3 bg-white/80 backdrop-blur-md pointer-events-auto">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-full flex items-center justify-center text-white shadow-sm">
              <SlashIcon className="w-5 h-5" />
            </div>
            <h1 className="font-bold text-lg tracking-tight text-slate-700">
              DISE AI <span className="text-indigo-600">Agent</span>
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <Activity
              size={14}
              className={
                appState === "ANALYZING"
                  ? "text-green-500 animate-pulse"
                  : "text-slate-400"
              }
            />
            <span className="text-xs text-slate-500 font-medium">
              {appState === "WAITING"
                ? "等待影片"
                : appState === "AWAITING_TIME"
                ? "等待輸入時間"
                : appState === "AWAITING_SITE"
                ? "請選擇部位"
                : appState === "ANALYZING"
                ? "AI 處理中..."
                : "就緒"}
            </span>
          </div>
        </div>
      </div>

      {/* Main Messages */}
      <main className="flex-1 w-full overflow-y-auto scroll-smooth">
        <div className="max-w-3xl mx-auto px-4 pt-24 pb-48 space-y-6">
          {messages.map((msg) => (
            <ChatBubble key={msg.id} message={msg} onImageClick={openModal} />
          ))}

          {appState === "AWAITING_SITE" && (
            <div className="flex justify-center gap-4 animate-fade-in my-4">
              <button
                onClick={() => handleSiteSelection("V")}
                className="flex flex-col items-center p-4 bg-white border-2 border-slate-100 rounded-2xl shadow-sm hover:border-indigo-500 hover:bg-indigo-50 transition-all w-32 group"
              >
                <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center mb-2 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                  <span className="font-bold text-lg">V</span>
                </div>
                <span className="text-sm font-bold text-slate-700">V-Site</span>
                <span className="text-[10px] text-slate-400">Velum (軟顎)</span>
              </button>

              <button
                onClick={() => handleSiteSelection("O")}
                className="flex flex-col items-center p-4 bg-white border-2 border-slate-100 rounded-2xl shadow-sm hover:border-indigo-500 hover:bg-indigo-50 transition-all w-32 group"
              >
                <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center mb-2 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                  <span className="font-bold text-lg">O</span>
                </div>
                <span className="text-sm font-bold text-slate-700">O-Site</span>
                <span className="text-[10px] text-slate-400">
                  Oropharynx (口咽)
                </span>
              </button>
            </div>
          )}

          {isLoading && (
            <div className="flex justify-center animate-fade-in">
              <div className="bg-slate-100 border border-slate-200 text-slate-600 text-xs px-4 py-2 rounded-full flex items-center gap-2">
                <div className="w-3 h-3 border-2 border-slate-300 border-t-indigo-600 rounded-full animate-spin"></div>
                AI 正在思考中...
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* Footer */}
      <footer className="fixed bottom-0 left-0 w-full bg-gradient-to-t from-white via-white to-transparent pb-6 pt-10 z-40">
        <div className="max-w-3xl mx-auto px-4 flex flex-col gap-2">
          {/* API Config Bar */}
          <div className="flex justify-end px-2">
            <div className="flex items-center gap-2 bg-slate-50/80 backdrop-blur rounded-full px-3 py-1 border border-slate-200">
              <Settings size={12} className="text-slate-400" />
              <input
                type="text"
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
                placeholder="輸入 API URL..."
                className="bg-transparent border-none outline-none text-[10px] text-slate-600 w-32 focus:ring-0 placeholder:text-slate-300"
              />
            </div>
          </div>

          {/* Main Input Capsule */}
          <div className="relative bg-white border border-slate-200 shadow-xl shadow-slate-200/50 rounded-2xl overflow-hidden flex items-center p-2 gap-2">
            <button
              onClick={handleUploadClick}
              disabled={isLoading || appState === "ANALYZING"}
              className="p-2 rounded-lg text-slate-400 hover:bg-slate-50 hover:text-indigo-600 transition-colors"
              title="上傳影片"
            >
              <Upload size={20} />
            </button>

            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                appState === "WAITING"
                  ? "輸入醫學問題或上傳影片..."
                  : appState === "AWAITING_TIME"
                  ? "輸入時間 (例: 0:30-1:00) 或「全部」"
                  : appState === "AWAITING_SITE"
                  ? "請點擊上方按鈕選擇部位..."
                  : appState === "ANALYZING"
                  ? "分析中... 按下按鈕可停止"
                  : "輸入訊息..."
              }
              disabled={appState === "AWAITING_SITE"}
              className="flex-1 bg-transparent border-none outline-none focus:ring-0 text-slate-700 placeholder:text-slate-400 px-2"
            />

            {isLoading || appState === "ANALYZING" ? (
              <button
                onClick={handleStopAnalysis}
                className="p-2 rounded-full transition-all bg-slate-100 text-slate-600 shadow-md hover:bg-slate-200 active:scale-95"
                title="停止分析"
              >
                <Square size={18} fill="currentColor" />
              </button>
            ) : (
              <button
                onClick={handleSendMessage}
                disabled={!inputValue.trim() || appState === "AWAITING_SITE"}
                className={`p-2 rounded-full transition-all ${
                  !inputValue.trim() || appState === "AWAITING_SITE"
                    ? "bg-slate-100 text-slate-300 cursor-not-allowed"
                    : "bg-indigo-600 text-white shadow-md hover:bg-indigo-700 active:scale-95"
                }`}
                title="發送訊息"
              >
                <Send size={18} />
              </button>
            )}
          </div>

          <div className="text-center">
            <p className="text-[10px] text-slate-400">Powered by DISE AI</p>
          </div>
        </div>
      </footer>

      <AnnotationModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleModalSave}
        initialData={modalData}
      />
    </div>
  );
}

export default App;
