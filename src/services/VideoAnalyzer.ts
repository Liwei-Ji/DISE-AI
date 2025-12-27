import { ColorAlgorithm as AIModel } from "../components/AIColorAlgorithm";

export const VideoAnalyzer = {
  /**
   * 分析整部影片
   * @param videoFile 使用者上傳的影片檔案
   * @param onProgress 回調函式，用來更新進度條
   */
  async analyzeVideo(
    videoFile: File,
    onProgress: (percent: number, result: any) => void
  ) {
    return new Promise((resolve, reject) => {
      // 1. 建立隱藏的 Video 與 Canvas 元素
      const video = document.createElement("video");
      video.src = URL.createObjectURL(videoFile);
      video.muted = true;
      video.playsInline = true; // 避免手機全螢幕

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });

      const results: any[] = [];
      const FPS_TO_SAMPLE = 1; // 設定採樣率：每秒分析幾張 (例如 1 張)

      video.onloadeddata = async () => {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const duration = video.duration;
        const interval = 1 / FPS_TO_SAMPLE;

        let currentTime = 0;

        // 定義遞迴分析函式
        const processNextFrame = async () => {
          if (currentTime > duration) {
            // 分析結束
            video.src = ""; // 釋放記憶體
            resolve(results);
            return;
          }

          // 移動影片時間軸
          video.currentTime = currentTime;
        };

        video.onseeked = async () => {
          // 影片定位完成，開始截圖與分析
          if (!ctx) return;
          ctx.drawImage(video, 0, 0);

          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

          try {
            // 🚀 呼叫我們剛剛寫的 AI 全自動掃描
            const analysis = await AIModel.scanFrame(imageData);

            const resultItem = {
              time: currentTime.toFixed(2),
              area: analysis.area.toFixed(1),
              polygon: analysis.polygon, // 存下來，方便之後微調時顯示
            };

            results.push(resultItem);

            // 更新進度
            onProgress(Math.round((currentTime / duration) * 100), resultItem);
          } catch (e) {
            console.warn(`Frame at ${currentTime} failed:`, e);
          }

          // 繼續下一幀
          currentTime += interval;
          processNextFrame();
        };

        // 啟動第一幀
        processNextFrame();
      };

      video.onerror = (e) => reject(e);
    });
  },
};
