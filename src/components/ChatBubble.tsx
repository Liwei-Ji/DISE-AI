import React from "react";
import ReactMarkdown from "react-markdown";
import { User } from "lucide-react";
import { SparklesIcon } from "@heroicons/react/24/solid";
import { ChatMessage } from "../types";

// 保留
import { Utils, SummaryManager } from "../services/logic";

interface ChatBubbleProps {
  message: ChatMessage;
  onImageClick: (type: "min" | "max", time: number) => void;
}

const AnalysisCard: React.FC<{
  title: string;
  imgSrc: string;
  data: any;
  type: "min" | "max";
  site?: "V" | "O";
  onImageClick: () => void;
}> = ({ title, imgSrc, data, onImageClick, type, site }) => {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden hover:shadow-xl transition-all duration-300 w-full sm:w-[48%] flex flex-col group">
      {/* Header */}
      <div
        className={`px-4 py-2 border-b border-slate-100 flex justify-between items-center ${
          type === "max" ? "bg-blue-50/50" : "bg-red-50/50"
        }`}
      >
        <h4
          className={`text-xs font-bold uppercase tracking-wider flex items-center gap-2 ${
            type === "max" ? "text-blue-600" : "text-red-600"
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full ${
              type === "max" ? "bg-blue-500" : "bg-red-500"
            }`}
          ></span>
          {title}
        </h4>
        <span className="text-[10px] font-mono text-slate-400">
          {Utils.formatTime(data.time)}
        </span>
      </div>

      {/* Image Area */}
      <div
        className="relative aspect-video bg-slate-100 cursor-pointer overflow-hidden"
        onClick={onImageClick}
      >
        <img
          src={imgSrc}
          alt={title}
          className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
        />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center backdrop-blur-[1px] opacity-0 group-hover:opacity-100">
          <button className="bg-white/90 text-slate-800 text-xs font-bold px-3 py-1.5 rounded-full shadow-lg transform translate-y-2 group-hover:translate-y-0 transition-all">
            編輯標註
          </button>
        </div>
      </div>

      {/* Data Area */}
      <div className="p-3 space-y-2 bg-white">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-[10px] text-slate-400 uppercase font-semibold">
              Area Size
            </p>
            <p className="text-lg font-bold text-slate-800 font-mono leading-none">
              {data.area}
            </p>
          </div>
          <span className="px-2 py-1 bg-slate-100 text-slate-600 text-xs rounded-md font-medium">
            {data.areaCategory}
          </span>
        </div>

        {/* 根據 Site 顯示對應數據 */}
        <div className="flex gap-2 pt-2 border-t border-slate-100">
          {/* 如果是 V-Site，只顯示 V-Height */}
          {(site === "V" || !site) && (
            <div className="flex-1 bg-slate-50 p-1.5 rounded text-center">
              <p className="text-[9px] text-slate-400 uppercase">V-Height</p>
              <p className="text-xs font-mono font-bold text-slate-700">
                {data.v_height ?? "-"}
              </p>
            </div>
          )}

          {/* 如果是 O-Site，只顯示 O-Width */}
          {(site === "O" || !site) && (
            <div className="flex-1 bg-slate-50 p-1.5 rounded text-center">
              <p className="text-[9px] text-slate-400 uppercase">O-Width</p>
              <p className="text-xs font-mono font-bold text-slate-700">
                {data.o_width ?? "-"}
              </p>
            </div>
          )}
        </div>
        <div className="pt-2 border-t border-slate-100">
          <p className="text-[10px] text-slate-400 uppercase font-semibold mb-0.5">
            Coordinate Data
          </p>
          <p
            className="text-[10px] text-slate-500 font-mono truncate"
            title={SummaryManager.getCoordText(data)}
          >
            {SummaryManager.getCoordText(data)}
          </p>
        </div>
      </div>
    </div>
  );
};

export const ChatBubble: React.FC<ChatBubbleProps> = ({
  message,
  onImageClick,
}) => {
  // 輔助函式 正確格式化 timestamp
  const formatMessageTime = (timestamp?: number) => {
    if (!timestamp) return "";
    return new Date(timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  };

  if (message.role === "system") {
    return (
      <div className="flex justify-center my-6">
        <div className="flex items-center gap-2 bg-slate-100 text-slate-500 text-xs px-4 py-1.5 rounded-full border border-slate-200 shadow-sm">
          <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-pulse"></span>
          {message.content}
        </div>
      </div>
    );
  }

  const isUser = message.role === "user";

  return (
    <div
      className={`flex w-full ${
        isUser ? "justify-end" : "justify-start"
      } animate-slide-up gap-4`}
    >
      {!isUser && (
        // AI 頭像
        <div className="w-8 h-8 flex-shrink-0 mt-1 flex items-center justify-center text-indigo-600">
          <SparklesIcon className="w-5 h-5" />
        </div>
      )}

      <div
        className={`flex flex-col max-w-[90%] sm:max-w-[85%] ${
          isUser ? "items-end" : "items-start"
        }`}
      >
        <div
          className={`text-sm leading-relaxed relative ${
            isUser
              ? "bg-blue-600 text-white rounded-2xl rounded-br-none px-5 py-3.5 shadow-sm" // User 維持氣泡
              : "bg-transparent text-slate-700 px-0 py-0 w-full" // Bot 移除氣泡 (透明背景)
          }`}
        >
          {message.type === "text" && (
            <ReactMarkdown
            components={{
              // 針對 Tailwind CSS 修正列表樣式 (因為 Tailwind 會預設移除 list-style)
              ol: ({ node, ...props }) => (
                <ol className="list-decimal pl-5 my-2 space-y-1" {...props} />
              ),
              ul: ({ node, ...props }) => (
                <ul className="list-disc pl-5 my-2 space-y-1" {...props} />
              ),
              li: ({ node, ...props }) => <li className="pl-1" {...props} />,
              
              // 設定粗體樣式 (讓 Bot 的粗體字變成深藍色，User 的變成黃色)
              strong: ({ node, ...props }) => (
                <strong
                  className={`font-bold ${
                    isUser ? "text-yellow-300" : "text-indigo-700"
                  }`}
                  {...props}
                />
              ),
              
              // 設定段落間距
              p: ({ node, ...props }) => <p className="mb-2 last:mb-0" {...props} />,
              
              // 設定連結樣式
              a: ({ node, ...props }) => (
                <a className="underline hover:text-indigo-400" {...props} />
              ),
            }}
          >
            {message.content}
          </ReactMarkdown>
        )}

          {message.type === "analysis_result" && message.data && (
            <div className="w-full min-w-[300px] sm:min-w-[500px] mt-2">
              <div className="flex items-center gap-2 mb-4 pb-2 border-b border-slate-100">
                <span className="text-lg">📊</span>
                <span className="font-bold text-slate-800">分析報告</span>
              </div>

              <div className="flex flex-wrap gap-4 mb-4">
                <AnalysisCard
                  title="Max Area (通暢)"
                  imgSrc={message.data.largest.srcDataUrl}
                  data={message.data.largest}
                  type="max"
                  site={message.data.site}
                  onImageClick={() =>
                    onImageClick("max", message.data.largest.time)
                  }
                />
                <AnalysisCard
                  title="Min Area (阻塞)"
                  imgSrc={message.data.smallest.srcDataUrl}
                  data={message.data.smallest}
                  type="min"
                  site={message.data.site}
                  onImageClick={() =>
                    onImageClick("min", message.data.smallest.time)
                  }
                />
              </div>

              <div className="mt-4 bg-gradient-to-r from-indigo-50 to-blue-50 rounded-xl p-4 border border-indigo-100">
                <div className="flex justify-between items-start mb-2">
                  <h5 className="text-xs font-bold text-indigo-800 uppercase tracking-wider">
                    Summary
                  </h5>
                  <span className="px-2 py-0.5 bg-white text-indigo-600 text-[10px] font-bold rounded shadow-sm border border-indigo-100">
                    AUTO-GENERATED
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-6 mt-2">
                  <div className="flex flex-col">
                    <span className="text-xs text-indigo-400 font-medium">
                      阻塞百分比 (Obstruction)
                    </span>
                    <div className="flex items-baseline gap-1">
                      <span className="text-2xl font-bold text-indigo-700 tracking-tight">
                        {message.data.obstructionPercent.toFixed(1) || "0.0"}
                      </span>
                      <span className="text-sm text-indigo-500">%</span>
                    </div>
                  </div>
                  <div className="flex flex-col border-l border-indigo-200 pl-6">
                    <span className="text-xs text-indigo-400 font-medium">
                      VOTE Score
                    </span>
                    <div className="flex items-baseline gap-1">
                      <span className="text-2xl font-bold text-indigo-700 tracking-tight">
                        {message.data.voteScore || "0"}
                      </span>
                      <span className="text-sm text-indigo-500">/ 2</span>
                    </div>
                  </div>
                </div>
              </div>
              <p className="text-[10px] text-slate-400 mt-3 text-center italic">
                * 點擊上方圖片可進入手動標註模式修正錨點
              </p>
            </div>
          )}
        </div>

        {/* Timestamp */}
        <span className="text-[10px] text-slate-300 mt-1 px-1">
          {isUser ? "You" : "AI Assistant"} •{" "}
          {message.timestamp
            ? formatMessageTime(message.timestamp)
            : "Just now"}
        </span>
      </div>
    </div>
  );
};
