/**
 * AI 互動雷雕拍照系統 - 後端 API (半自動排隊叫號版)
 * 核心功能：
 * 1. 接收前端客人上傳的照片，發放號碼牌 (Task ID)
 * 2. 提供前端輪詢 (Polling) 查詢進度
 * 3. 提供工作人員後台獲取待處理名單，並上傳完成圖
 */
const express = require('express');
const cors = require('cors');

const app = express();
// 設定連接埠，Render 會自動提供 process.env.PORT
const PORT = process.env.PORT || 10000; 

// 啟用 CORS 允許跨網域請求 (讓 Github Pages 可以連線)
app.use(cors());

// 加大接收資料的限制，因為照片轉成 Base64 字串會比較長
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ==========================================
// 核心資料庫 (記憶體暫存)
// ==========================================
// tasks 物件用來存放所有的訂單狀態
const tasks = {};
// 號碼牌計數器，從 1 開始
let ticketCounter = 1;

// 首頁狀態檢查
app.get('/', (req, res) => {
    res.status(200).send("🟢 Queue Server is running (Human-in-the-loop Mode). 系統正在使用半自動叫號模式運行中。");
});

// ==========================================
// 📱 給「前端展場機台 (客人)」使用的 API
// ==========================================

// 1. 客人拍照上傳，領取號碼牌
app.post('/api/upload', (req, res) => {
    try {
        const { image } = req.body;
        if (!image) {
            return res.status(400).json({ error: '未提供圖片資料' });
        }

        // 產生三位數號碼牌 (例如: 001, 002, 015)
        const taskId = String(ticketCounter).padStart(3, '0');
        ticketCounter++;

        // 將任務存入暫存清單
        tasks[taskId] = {
            id: taskId,
            sourceImage: image, // 客人的原始照片
            status: 'pending',  // 狀態：處理中 (pending) / 已完成 (completed)
            resultImage: null,  // 畫好的雷雕圖會存在這
            createdAt: new Date().toLocaleTimeString('zh-TW', { hour12: false }) // 紀錄建立時間
        };

        console.log(`🎫 新任務建立：排隊號碼 #${taskId}`);
        
        // 回傳號碼牌給前端
        res.json({ success: true, taskId: taskId });
    } catch (error) {
        console.error("上傳處理發生錯誤:", error);
        res.status(500).json({ error: '伺服器錯誤，請稍後再試' });
    }
});

// 2. 客人網頁不斷輪詢，查詢圖片畫好了沒
app.get('/api/status/:taskId', (req, res) => {
    const taskId = req.params.taskId;
    const task = tasks[taskId];
    
    // 如果找不到這張號碼牌
    if (!task) {
        return res.status(404).json({ error: '找不到該號碼牌的任務' });
    }

    // 回傳該任務目前的狀態與結果圖片
    res.json({ 
        success: true, 
        status: task.status, 
        resultImage: task.resultImage 
    });
});


// ==========================================
// 💻 給「現場工作人員 (後台)」使用的 API
// ==========================================

// 3. 取得所有「還在排隊中」的照片名單
app.get('/api/admin/tasks', (req, res) => {
    // 從 tasks 中挑選出 status 為 'pending' 的任務
    const pendingTasks = Object.values(tasks)
        .filter(t => t.status === 'pending')
        .sort((a, b) => a.id.localeCompare(b.id)); // 依照號碼牌小到大排序
    
    res.json({ success: true, tasks: pendingTasks });
});

// 4. 工作人員畫好圖了，把結果上傳回傳給客人
app.post('/api/admin/upload-result/:taskId', (req, res) => {
    try {
        const taskId = req.params.taskId;
        const { resultImage } = req.body;
        const task = tasks[taskId];

        if (!task) {
            return res.status(404).json({ error: '找不到該任務，可能已被刪除' });
        }
        if (!resultImage) {
            return res.status(400).json({ error: '未提供完成圖的圖片資料' });
        }

        // 更新任務狀態與圖片
        task.status = 'completed'; 
        task.resultImage = resultImage; 

        console.log(`✅ 任務完成：號碼 #${task.id} 已成功上傳雷雕結果圖`);
        res.json({ success: true });
    } catch (error) {
        console.error("結果上傳發生錯誤:", error);
        res.status(500).json({ error: '上傳失敗，請重試' });
    }
});


// ==========================================
// 啟動伺服器
// ==========================================
app.listen(PORT, () => {
    console.log(`🚀 半自動叫號伺服器啟動成功！正在監聽 PORT: ${PORT}`);
    console.log(`等待前端機台連線中...`);
});
