import os
import cv2
import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from flask import Flask, request, jsonify
from flask_cors import CORS
from torchvision import transforms
import base64
import uuid
import threading
import time
import gdown

# ==== 設定 ====
app = Flask(__name__)
CORS(app) # 允許跨域請求

MODEL_PATH = 'unet_model_balanced.pth'
IMG_SIZE = 256
THRESHOLD = 0.5
TOTAL_SCOPE_AREA = 58365 
FRAME_STEP = 5  # 稍微調小一點步長，提高精確度
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

# 全域變數：用來存任務狀態 (In-Memory Database)
# 結構: { 'task_id': { 'status': 'processing', 'progress': 0, 'result': None, 'error': None } }
TASKS = {}

# ==== 模型定義 (保持不變) ====
class DoubleConv(nn.Module):
    def __init__(self, in_channels, out_channels):
        super(DoubleConv, self).__init__()
        self.conv = nn.Sequential(
            nn.Conv2d(in_channels, out_channels, 3, 1, 1, bias=False),
            nn.BatchNorm2d(out_channels),
            nn.ReLU(inplace=True),
            nn.Conv2d(out_channels, out_channels, 3, 1, 1, bias=False),
            nn.BatchNorm2d(out_channels),
            nn.ReLU(inplace=True),
        )
    def forward(self, x): return self.conv(x)

class UNet(nn.Module):
    def __init__(self, in_channels=3, out_channels=1):
        super(UNet, self).__init__()
        self.ups = nn.ModuleList()
        self.downs = nn.ModuleList()
        self.pool = nn.MaxPool2d(kernel_size=2, stride=2)
        features = [64, 128, 256, 512]
        for feature in features:
            self.downs.append(DoubleConv(in_channels, feature))
            in_channels = feature
        for feature in reversed(features):
            self.ups.append(nn.ConvTranspose2d(feature*2, feature, kernel_size=2, stride=2))
            self.ups.append(DoubleConv(feature*2, feature))
        self.bottleneck = DoubleConv(features[-1], features[-1]*2)
        self.final_conv = nn.Conv2d(features[0], out_channels, kernel_size=1)
    def forward(self, x):
        skip_connections = []
        for down in self.downs:
            x = down(x)
            skip_connections.append(x)
            x = self.pool(x)
        x = self.bottleneck(x)
        skip_connections = skip_connections[::-1]
        for idx in range(0, len(self.ups), 2):
            x = self.ups[idx](x)
            skip_connection = skip_connections[idx//2]
            if x.shape != skip_connection.shape:
                x = transforms.functional.resize(x, size=skip_connection.shape[2:])
            concat_skip = torch.cat((skip_connection, x), dim=1)
            x = self.ups[idx+1](concat_skip)
        return self.final_conv(x)

# ==== 載入模型 ====
model = UNet().to(DEVICE)
if os.path.exists(MODEL_PATH):
    model.load_state_dict(torch.load(MODEL_PATH, map_location=DEVICE))
    model.eval()
    print("✅ Model Loaded Successfully")
else:
    print("❌ Model Not Found")

# ==== 工具函式 ====
def get_weight(t, start, end):
    total = end - start
    if total <= 0: return 1.0
    norm_t = (t - start) / total
    if norm_t < 0.15: return norm_t / 0.15
    if norm_t > 0.85: return (1 - norm_t) / 0.15
    return 1.0

def frame_to_base64(frame):
    _, buffer = cv2.imencode('.jpg', frame)
    return base64.b64encode(buffer).decode('utf-8')

# 背景處理函式
def process_video_task(task_id, file_path, user_start, user_end):
    try:
        print(f"🚀 Start processing task: {task_id}")
        
        # 1. 讀取影片資訊
        cap = cv2.VideoCapture(file_path)
        if not cap.isOpened():
            raise Exception("Cannot open video file")

        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        fps = cap.get(cv2.CAP_PROP_FPS)
        if fps == 0: fps = 30 # fallback
        duration = total_frames / fps
        
        # 2. 決定分析區間 (Logic Update)
        # 如果使用者有指定有效區間 (end > start)，就用使用者的
        # 否則回退到預設邏輯 (避開頭尾 5%)
        if user_end > user_start:
            valid_start = float(user_start)
            valid_end = float(user_end)
            print(f"🎯 Using User Interval: {valid_start}s ~ {valid_end}s")
        else:
            valid_start = duration * 0.05
            valid_end = duration * 0.95
            print(f"⚙️ Using Auto Interval: {valid_start:.2f}s ~ {valid_end:.2f}s")

        normalize = transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
        results = []
        
        # 計算總共需要處理的幀數 (用來算進度)
        frames_to_process = range(0, total_frames, FRAME_STEP)
        total_steps = len(frames_to_process)

        # 3. 逐幀分析
        for i, frame_idx in enumerate(frames_to_process):
            # 更新進度 (0~90%) - 留 10% 給後處理
            progress = int((i / total_steps) * 90)
            TASKS[task_id]['progress'] = progress

            current_time = frame_idx / fps
            
            # 關鍵過濾：只分析指定時間內的幀
            if current_time < valid_start or current_time > valid_end:
                continue

            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
            ret, frame = cap.read()
            if not ret: break

            # 推理
            img_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            img_resized = cv2.resize(img_rgb, (IMG_SIZE, IMG_SIZE))
            tensor = transforms.functional.to_tensor(img_resized)
            tensor = normalize(tensor).unsqueeze(0).to(DEVICE)

            with torch.no_grad():
                out = model(tensor)
                mask = (torch.sigmoid(out) > THRESHOLD).float().squeeze().cpu().numpy()
            
            defect_size = np.sum(mask)
            airway_area = max(0, TOTAL_SCOPE_AREA - defect_size)
            
            results.append({
                "time": round(current_time, 2),
                "frame": frame_idx,
                "airway_area": int(airway_area),
                "defect_size": int(defect_size)
            })

        cap.release()

        # 如果沒有任何結果 (例如時間設錯，或影片太短)，要防呆
        if len(results) == 0:
             raise Exception("No frames analyzed. Please check time interval.")

        df = pd.DataFrame(results)
        
        # 4. 數據後處理
        TASKS[task_id]['progress'] = 92
        df['airway_smooth'] = df['airway_area'].rolling(window=15, center=True).mean().fillna(df['airway_area'])
        df['obs_pct'] = ((TOTAL_SCOPE_AREA - df['airway_smooth']) / TOTAL_SCOPE_AREA * 100).clip(0, 100).round(2)
        
        # 權重計算 (只在有效區間內計算權重)
        df['weight'] = df['time'].apply(lambda t: get_weight(t, valid_start, valid_end))
        df['weighted_score'] = df['airway_smooth'] * df['weight']
        
        # 5. 找出 Top-1
        worst_row = df.loc[df['airway_smooth'].idxmin()]
        best_row = df.loc[df['weighted_score'].idxmax()]

        # 6. 抓圖回傳
        TASKS[task_id]['progress'] = 95
        cap = cv2.VideoCapture(file_path)
        
        cap.set(cv2.CAP_PROP_POS_FRAMES, worst_row['frame'])
        _, frame_worst = cap.read()
        img_worst_b64 = frame_to_base64(frame_worst)
        
        cap.set(cv2.CAP_PROP_POS_FRAMES, best_row['frame'])
        _, frame_best = cap.read()
        img_best_b64 = frame_to_base64(frame_best)
        
        cap.release()
        
        # 刪除暫存檔 (每個任務有自己的暫存檔，避免衝突)
        if os.path.exists(file_path):
            os.remove(file_path)

        # 7. 完成
        TASKS[task_id]['result'] = {
            "worst": {
                "time": worst_row['time'],
                "area": int(worst_row['airway_smooth']),
                "obs_pct": worst_row['obs_pct'],
                "image": f"data:image/jpeg;base64,{img_worst_b64}"
            },
            "best": {
                "time": best_row['time'],
                "area": int(best_row['airway_smooth']),
                "obs_pct": best_row['obs_pct'],
                "image": f"data:image/jpeg;base64,{img_best_b64}"
            },
            "chart_data": df[['time', 'airway_smooth', 'obs_pct']].to_dict(orient='records')
        }
        TASKS[task_id]['status'] = 'completed'
        TASKS[task_id]['progress'] = 100
        print(f"✅ Task {task_id} Completed")

    except Exception as e:
        print(f"❌ Task {task_id} Failed: {str(e)}")
        TASKS[task_id]['status'] = 'failed'
        TASKS[task_id]['error'] = str(e)
        # 發生錯誤也要嘗試刪除檔案
        if os.path.exists(file_path):
            os.remove(file_path)

# ==== API 路由 ====

# 1. 提交分析請求 (只回傳 Task ID)
@app.route('/analyze', methods=['POST'])
def analyze_request():
    # 接收時間參數
    start_time = float(request.form.get('start_time', 0))
    end_time = float(request.form.get('end_time', 0))

    task_id = str(uuid.uuid4())
    temp_path = f"temp_{task_id}.mp4"

    # A. 處理上傳檔案
    if 'video' in request.files:
        file = request.files['video']
        file.save(temp_path)
        
        TASKS[task_id] = {'status': 'pending', 'progress': 0, 'result': None}
        thread = threading.Thread(
            target=process_video_task, 
            args=(task_id, temp_path, start_time, end_time)
        )
        thread.start()
        return jsonify({'task_id': task_id, 'status': 'pending'})

    # B. 處理網址 (包含 Google Drive)
    elif request.json and 'video_url' in request.json:
        video_url = request.json['video_url']
        # 從 JSON 裡也要讀取時間 (如果前端是傳 JSON)
        # 注意：這裡要覆蓋上面的預設值，因為如果是 JSON 請求，form data 會是空的
        start_time = float(request.json.get('start_time', 0))
        end_time = float(request.json.get('end_time', 0))
        
        TASKS[task_id] = {'status': 'downloading', 'progress': 0, 'result': None}
        
        # 定義背景下載與執行函式
        def download_and_process(tid, url, path, s_time, e_time):
            try:
                print(f"⬇️ Downloading from URL: {url}")
                
                # 判斷 Google Drive
                if 'drive.google.com' in url:
                    # fuzzy=True 讓它能處理 /view?usp=sharing 這種網址
                    output = gdown.download(url, path, quiet=False, fuzzy=True)
                    if not output:
                        raise Exception("Google Drive download failed")
                else:
                    # 其他直連網址 (Direct Link)
                    import requests
                    r = requests.get(url, stream=True)
                    if r.status_code == 200:
                        with open(path, 'wb') as f:
                            for chunk in r.iter_content(chunk_size=1024):
                                f.write(chunk)
                    else:
                        raise Exception(f"Download failed: {r.status_code}")

                # 下載成功後，轉交給原本的分析函式
                # 注意：這時狀態會從 downloading 變成 processing (在 process_video_task 內部變更)
                process_video_task(tid, path, s_time, e_time)
                
            except Exception as e:
                print(f"❌ Download Failed: {str(e)}")
                TASKS[tid]['status'] = 'failed'
                TASKS[tid]['error'] = str(e)
                if os.path.exists(path): os.remove(path)

        # 啟動執行緒
        thread = threading.Thread(
            target=download_and_process,
            args=(task_id, video_url, temp_path, start_time, end_time)
        )
        thread.start()

        return jsonify({'task_id': task_id, 'status': 'pending'})
    
    return jsonify({'error': 'No video provided'}), 400

# 2. 查詢任務狀態 (Polling)
@app.route('/status/<task_id>', methods=['GET'])
def check_status(task_id):
    task = TASKS.get(task_id)
    if not task:
        return jsonify({'error': 'Task not found'}), 404
    
    return jsonify(task)

if __name__ == '__main__':
    # threaded=True 讓 Flask 能夠處理併發請求 (雖然我們已經手動開 thread，但加上這參數比較保險)
    app.run(port=5000, debug=True, threaded=True)