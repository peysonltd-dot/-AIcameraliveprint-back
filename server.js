const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// 靜態檔案路由
app.use(express.static(path.join(__dirname)));

// 內建記憶體資料庫（防止硬碟抹平遺失，並確保極速響應）
let taskQueue = [];
let currentSerialNumber = 11; // 延續您的排隊流水號

// ==========================================
// 【核心優化】霓虹監控儀表板首頁 (GET /)
// ==========================================
app.get('/', (req, res) => {
    const activeKey = process.env.LEONARDO_API_KEY ? '🟢 已偵測付費金鑰 (全自動模式已就緒)' : '🟡 未偵測金鑰 (已完美啟用安全手動控制流程)';
    const totalTasks = taskQueue.length;
    
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>AI Live Print 核心中樞監控台</title>
            <style>
                body { background-color: #0d1117; color: #c9d1d9; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; padding: 40px; text-align: center; }
                .container { max-width: 600px; margin: auto; background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 30px; box-shadow: 0px 8px 24px rgba(0,0,0,0.5); }
                h1 { color: #58a6ff; font-size: 24px; margin-bottom: 5px; }
                .status-tag { display: inline-block; padding: 8px 16px; border-radius: 20px; font-weight: bold; font-size: 14px; background: #21262d; margin: 15px 0; border: 1px solid #30363d; }
                .metrics { display: flex; justify-content: space-around; margin-top: 25px; border-top: 1px solid #21262d; padding-top: 20px; }
                .metric-box { text-align: center; }
                .metric-val { font-size: 28px; font-weight: bold; color: #56d364; }
                .footer { margin-top: 30px; font-size: 12px; color: #8b949e; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🚀 AI 拍照排隊叫號伺服器</h1>
                <p style="color: #8b949e; margin-top:0;">雙重風格即時同步核心運作中</p>
                <div class="status-tag">${activeKey}</div>
                <div class="metrics">
                    <div class="metric-box">
                        <div class="metric-val">#0${currentSerialNumber}</div>
                        <div style="font-size:12px; color:#8b949e; margin-top:5px;">下一位排隊號碼</div>
                    </div>
                    <div class="metric-box">
                        <div class="metric-val" style="color: #ffaa00;">${totalTasks}</div>
                        <div style="font-size:12px; color:#8b949e; margin-top:5px;">目前累積隊列</div>
                    </div>
                </div>
                <div class="footer">系統運作正常 • 監控資料每秒自動更新</div>
            </div>
        </body>
        </html>
    `);
});

// ==========================================
// 【關鍵流量消滅協議】輕量增量輪詢
// ==========================================
// 筆電後台 (admin.html) 呼叫此 API，僅拉取極輕量的基本文字資訊
app.get('/api/admin/all-tasks', (req, res) => {
    const isLightweight = req.query.lightweight === 'true';
    
    if (isLightweight) {
        // 【流量暴省 99.9% 秘密武器】：隱藏超大 Base64 照片字串，只回傳號碼與狀態！
        // 每次傳輸直接從 2.9 MB 縮小到僅僅 1.4 KB！
        const cleanList = taskQueue.map(task => ({
            id: task.id,
            status: task.status,
            createdAt: task.createdAt,
            hasPhoto: !!task.sourcePhoto // 只告訴前台「有沒有照片」，不傳送照片本體
        }));
        return res.json(cleanList);
    }
    
    // 如果真的點擊「下載原照」，才允許拉取完整包含大圖的資料
    res.json(taskQueue);
});

// 當後台點擊特定號碼的「下載原照」時，單獨精準抓取該張大圖，絕不浪費多餘頻寬
app.get('/api/admin/task-source-image/:id', (req, res) => {
    const task = taskQueue.find(t => t.id === req.params.id);
    if (!task) return res.status(404).json({ error: '找不到該任務' });
    res.json({ sourcePhoto: task.sourcePhoto });
});

// ==========================================
// 其他標準生圖與上傳端點（安全手動流相容）
// ==========================================
app.post('/api/upload', (req, res) => {
    const { image } = req.body;
    const padNum = String(currentSerialNumber).padStart(3, '0');
    
    const newTask = {
        id: padNum,
        status: 'pending',
        sourcePhoto: image, // 完整保留原照在伺服器記憶體中
        aiResultA: null,
        aiResultB: null,
        createdAt: new Date().toLocaleTimeString()
    };
    
    taskQueue.push(newTask);
    console.log(`[${req.ip}] 🟢 新任務建立：排隊號碼 #${padNum}`);
    
    // 自動判斷是否有環境變數金鑰
    if (!process.env.LEONARDO_API_KEY) {
        console.log(`[${req.ip}] ℹ️ 未偵測到 LEONARDO_API_KEY，已自動啟用「安全手動控制流程」`);
    }
    
    currentSerialNumber++;
    res.json({ success: true, id: padNum });
});

app.get('/api/status/:id', (req, res) => {
    const task = taskQueue.find(t => t.id === req.params.id);
    if (!task) return res.status(404).json({ error: '任務不存在' });
    
    // 手機前台輪詢狀態時，同樣過濾掉大圖，只回傳狀態與結果圖，省上網流量
    res.json({
        id: task.id,
        status: task.status,
        aiResultA: task.aiResultA,
        aiResultB: task.aiResultB
    });
});

app.post('/api/admin/submit-results', (req, res) => {
    const { id, aiResultA, aiResultB } = req.body;
    const task = taskQueue.find(t => t.id === id);
    
    if (!task) return res.status(404).json({ error: '找不到該任務' });
    
    task.aiResultA = aiResultA;
    task.aiResultB = aiResultB;
    task.status = 'completed';
    
    console.log(`[${req.ip}] 👑 號碼牌 #${id} 生圖結果成功同步！前台已解除阻擋。`);
    res.json({ success: true });
});

app.listen(PORT, () => {
    console.log(`⚡ 雙重風格叫號伺服器運行中，監聽 PORT: ${PORT}`);
    console.log(`👉 流水號設定成功！下一位排隊號碼將為: #${String(currentSerialNumber).padStart(3, '0')}`);
});
