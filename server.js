/**
 * AI 互動雷雕拍照系統 - 後端 API (半自動排隊叫號進度自訂版)
 * 核心功能：
 * 1. 接收前端客人上傳的照片，發放號碼牌 (Task ID)
 * 2. 提供前端與控制後台輪詢 (Polling) 查詢進度
 * 3. 完美支援控制台自訂狀態分流：製作中、已完成、已取消、儲存備註
 */
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 10000; 

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ==========================================
// 核心資料庫 (記憶體暫存)
// ==========================================
const tasks = {};
let ticketCounter = 1;

app.get('/', (req, res) => {
    res.status(200).send("🟢 Queue Server is running (Progress Control Mode). 系統正在使用半自動叫號進度控制模式運行中。");
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

        const taskId = String(ticketCounter).padStart(3, '0');
        ticketCounter++;

        tasks[taskId] = {
            id: taskId,
            sourceImage: image, 
            status: 'pending',  // 狀態：pending (製作中), completed (已完成), cancelled (已取消)
            resultImage: null,  
            remark: '',         
            createdAt: new Date().toLocaleTimeString('zh-TW', { hour12: false }) 
        };

        console.log(`🎫 新任務建立：排隊號碼 #${taskId}`);
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
    
    if (!task) {
        return res.status(404).json({ error: '找不到該號碼牌的任務' });
    }

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
    const pendingTasks = Object.values(tasks)
        .filter(t => t.status === 'pending')
        .sort((a, b) => a.id.localeCompare(b.id)); 
    res.json({ success: true, tasks: pendingTasks });
});

// 4. 取得所有照片清單 (待處理 + 已完成 + 已取消) 給控制台
app.get('/api/admin/all-tasks', (req, res) => {
    const all = Object.values(tasks)
        .sort((a, b) => a.id.localeCompare(b.id));
    res.json({ success: true, tasks: all });
});

// 5. 工作人員上傳成果雷雕圖 (上傳時會自動將狀態改為已完成)
app.post('/api/admin/upload-result/:taskId', (req, res) => {
    try {
        const taskId = req.params.taskId;
        const { resultImage } = req.body;
        const task = tasks[taskId];

        if (!task) {
            return res.status(404).json({ error: '找不到該任務' });
        }
        if (!resultImage) {
            return res.status(400).json({ error: '未提供完成圖的圖片資料' });
        }

        task.status = 'completed'; 
        task.resultImage = resultImage; 

        console.log(`✅ 任務完成：號碼 #${task.id} 已成功上傳雷雕結果圖並變更狀態為 completed`);
        res.json({ success: true });
    } catch (error) {
        console.error("結果上傳發生錯誤:", error);
        res.status(500).json({ error: '上傳失敗，請重試' });
    }
});

// 🌟 6. 新增：手動更新任務進度狀態 (製作中, 已完成, 已取消)
app.post('/api/admin/update-status/:taskId', (req, res) => {
    try {
        const taskId = req.params.taskId;
        const { status } = req.body;
        const task = tasks[taskId];

        if (!task) {
            return res.status(404).json({ error: '找不到該任務' });
        }

        if (['pending', 'completed', 'cancelled'].includes(status)) {
            task.status = status;
            console.log(`🔄 任務進度更換：號碼 #${task.id} 狀態更新為 [${status}]`);
            res.json({ success: true, status: task.status });
        } else {
            res.status(400).json({ error: '無效的狀態數值' });
        }
    } catch (error) {
        console.error("更新進度狀態發生錯誤:", error);
        res.status(500).json({ error: '更新失敗' });
    }
});

// 7. 保存備註資訊 API
app.post('/api/admin/save-remark/:taskId', (req, res) => {
    try {
        const taskId = req.params.taskId;
        const { remark } = req.body;
        const task = tasks[taskId];

        if (!task) {
            return res.status(404).json({ error: '找不到該任務' });
        }

        task.remark = remark || '';
        console.log(`📝 任務 #${task.id} 備註已更新為: ${task.remark}`);
        res.json({ success: true });
    } catch (error) {
        console.error("儲存備註發生錯誤:", error);
        res.status(500).json({ error: '儲存失敗' });
    }
});

// ==========================================
// 啟動伺服器
// ==========================================
app.listen(PORT, () => {
    console.log(`🚀 半自動叫號伺服器啟動成功！正在監聽 PORT: ${PORT}`);
});
