/**
 * AI 互動雷雕拍照系統 - 後端 API (Firebase 雲端同步 & 飛鵝出票機防當機完全體版)
 * 🌟 升級功能：Leonardo.ai 官方 v2 API 雙模型智動化併發生圖 (支援金鑰無痛安全退回)
 * 🌟 增量優化：新增首頁根路徑霓虹狀態儀表板，防範 404 誤判並方便手動喚醒
 * 🌟 緩存優化：為 polling 路由注入 No-Cache 標頭，防止 iOS/Safari 強力快取導致狀態卡死不更新
 * 🌟 頻寬救星：優化 /api/admin/all-tasks 支援 ?lightweight=true，並新增獨立大圖單次下載 API 接口
 */
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { initializeApp } = require('firebase/app');
const { getFirestore, doc, setDoc, getDoc, collection, getDocs, updateDoc, deleteDoc } = require('firebase/firestore');

const app = express();
const PORT = process.env.PORT || 10000; 

app.use(cors());
app.use(express.json({ limit: '60mb' }));
app.use(express.urlencoded({ limit: '60mb', extended: true }));

let localTasksCache = {};
let ticketCounter = 1;
let db;
let useFirebase = false;

const appId = (process.env.APP_ID || "photo-booth-app").trim();
const LEONARDO_API_KEY = (process.env.LEONARDO_API_KEY || "").trim();

// 🌟 Firebase Firestore 初始化 (智慧防當機寬鬆解析模式)
if (process.env.FIREBASE_CONFIG) {
    try {
        let configStr = process.env.FIREBASE_CONFIG.trim();
        let firebaseConfig;
        
        try {
            firebaseConfig = JSON.parse(configStr);
        } catch (jsonErr) {
            console.log("⚠️ 偵測到非標準 JSON 格式金鑰，啟動智慧寬鬆格式化解析...");
            let formatted = configStr
                .replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":') 
                .replace(/'/g, '"'); 
            firebaseConfig = JSON.parse(formatted);
        }

        const firebaseApp = initializeApp(firebaseConfig);
        db = getFirestore(firebaseApp);
        useFirebase = true;
        console.log("🔥 Firebase Firestore 雲端資料庫連接成功！");
        syncTicketCounterFromCloud();
    } catch (e) {
        console.error("❌ Firebase 初始化失敗，已自動安全降級為本機暫存模式:", e.message);
    }
} else {
    console.log("⚠️ 未偵測到 FIREBASE_CONFIG 環境變數。伺服器正運行於本機暫存模式。");
}

async function syncTicketCounterFromCloud() {
    if (!useFirebase) return;
    try {
        console.log("🔄 正在向雲端資料庫查詢今日歷史排隊紀錄，續接流水號...");
        const tasksCol = collection(db, 'artifacts', appId, 'public');
        const querySnapshot = await getDocs(tasksCol);
        
        let maxId = 0;
        querySnapshot.forEach((doc) => {
            const idNum = parseInt(doc.id, 10);
            if (!isNaN(idNum) && idNum > maxId) {
                maxId = idNum;
            }
            localTasksCache[doc.id] = doc.data();
        });
        
        ticketCounter = maxId + 1;
        console.log(`🎯 流水號續接成功！下一位排隊號碼將為：#${String(ticketCounter).padStart(3, '0')}`);
    } catch (e) {
        console.error("❌ 續接流水號失敗:", e.message);
    }
}

// 🌟 飛鵝雲端自動出單排版功能
async function triggerFeiePrint(task) {
    const user = (process.env.FEIE_USER || "").trim();
    const ukey = (process.env.FEIE_UKEY || "").trim();
    const sn = (process.env.FEIE_SN || "961820398").trim(); 

    if (!user || !ukey) {
        console.log("⚠️ 飛鵝雲 USER 或 UKEY 尚未在環境變數設定，跳過自動出單。");
        return;
    }

    const stime = Math.floor(Date.now() / 1000);
    const sig = crypto.createHash('sha1').update(user + ukey + stime).digest('hex');

    let content = `<CB><B>專屬禮品兌換</B></CB><BR><BR>`;
    content += `--------------------------------<BR>`;
    content += `<CB><B>${task.id}</B></CB><BR>`;
    content += `--------------------------------<BR>`;
    content += `排隊時間：${task.createdAt}<BR>`;
    content += `--------------------------------<BR>`;
    content += `<B>領取說明：</B><BR>`;
    content += `領取時請出示此號碼牌<BR>`;
    content += `交由工作人員兌換您的禮品<BR><BR>`;
    content += `<CB>～感謝您的參與～</CB><BR>`;
    content += `<CB>～祝您體驗愉快～</CB><BR>`;

    const params = new URLSearchParams();
    params.append('user', user);
    params.append('stime', stime.toString());
    params.append('sig', sig);
    params.append('apiname', 'Open_printMsg');
    params.append('sn', sn);
    params.append('content', content);
    params.append('times', '1');

    try {
        const response = await fetch('https://api.jp.feieyun.com/Api/Open/', {
            method: 'POST',
            body: params,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        const resData = await response.json();
        console.log(`🖨️ 飛鵝雲自動出單發送回報 (#${task.id}):`, resData);
    } catch (err) {
        console.error("❌ 飛鵝雲出單發送失敗:", err.message);
    }
}

// 🌟 飛鵝雲端印表機實時狀態檢測
async function queryFeieStatus() {
    const user = (process.env.FEIE_USER || "").trim();
    const ukey = (process.env.FEIE_UKEY || "").trim();
    const sn = (process.env.FEIE_SN || "961820398").trim();

    if (!user || !ukey) return { success: false, msg: "未設定 FEIE_USER 或 FEIE_UKEY" };

    const stime = Math.floor(Date.now() / 1000);
    const sig = crypto.createHash('sha1').update(user + ukey + stime).digest('hex');

    const params = new URLSearchParams();
    params.append('user', user);
    params.append('stime', stime.toString());
    params.append('sig', sig);
    params.append('apiname', 'Open_queryPrinterStatus');
    params.append('sn', sn);

    try {
        const response = await fetch('https://api.jp.feieyun.com/Api/Open/', {
            method: 'POST',
            body: params,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        const resData = await response.json();
        return { success: true, data: resData };
    } catch (err) {
        return { success: false, msg: err.message };
    }
}

// 🌟 核心函數：將客人的 Base64 原圖上傳至 Leonardo S3 暫存，取得 Image ID
async function uploadToLeonardoS3(base64Image) {
    try {
        // Step 1: 申請 Presigned 上傳連結
        const initUploadRes = await fetch('https://cloud.leonardo.ai/api/rest/v2/images/upload', {
            method: 'POST',
            headers: {
                'accept': 'application/json',
                'authorization': `Bearer ${LEONARDO_API_KEY}`,
                'content-type': 'application/json'
            },
            body: JSON.stringify({ "extension": "jpg" })
        });
        const uploadData = await initUploadRes.json();
        
        if (!uploadData.uploadImage) {
            throw new Error("申請 Leonardo S3 上傳失敗，請檢查 API Key 權限與點數！");
        }

        const { id, uploadUrl, fields } = uploadData.uploadImage;

        // Base64 轉成 Buffer 二進位實體
        const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, "");
        const imageBuffer = Buffer.from(base64Data, 'base64');

        // Step 2: 建立 Form-Data 實體上傳至 Amazon S3
        const s3Fields = JSON.parse(fields);
        const formData = new FormData();
        
        Object.entries(s3Fields).forEach(([key, value]) => {
            formData.append(key, value);
        });
        
        // 將 Blob 包裹二進位檔，塞入 Form 最後一欄
        formData.append('file', new Blob([imageBuffer], { type: 'image/jpeg' }), 'image.jpg');

        const s3UploadRes = await fetch(uploadUrl, {
            method: 'POST',
            body: formData
        });

        if (s3UploadRes.status >= 200 && s3UploadRes.status < 300) {
            console.log(`✅ 客人照片成功上傳 Leonardo S3！取得 ID: ${id}`);
            return id;
        } else {
            throw new Error(`S3 上傳回應異常，狀態碼: ${s3UploadRes.status}`);
        }
    } catch (err) {
        console.error("❌ uploadToLeonardoS3 出錯:", err.message);
        throw err;
    }
}

// 🌟 核心函數：雙模型併發生圖與背景定時輪詢
async function generateLeonardoDualStyles(taskId, base64Image) {
    try {
        // 1. 上傳客人照片至 S3
        const guestImageId = await uploadToLeonardoS3(base64Image);

        // 2. 固定咒語模板 (完全套用您在網頁端完美呈現的內容)
        const fixedPrompt = `Please analyze the physical characteristics of the person in the photo I uploaded (including hairstyle, hair color, clothing style and color, whether they wear glasses or have any special accessories). Then, retain these personal characteristics and reshape it into a new image with the following specific style:\n\nDetailed Style Specifications:\n\nMain Style: Minimalist hand-drawn chibi avatar.\n\nLine Strokes: Slightly thick black outlines with a hand-drawn feel, and rough edges resembling crayon or pencil strokes.\n\nColor and Shadows: Simple, flat coloring without complex gradients or shadows.\n\nFacial Features: Extremely simplified facial features (e.g., round eyes, small nose), with two cute little wisps of light pink blush on the cheeks.\n\nBackground and Composition: Solid white background, clean and soothing Korean graffiti style.`;

        console.log(`⚡ 啟動 Promise.all 雙通道，對 Leonardo 併發雙模型生圖請求...`);

        // 3. 併發生圖請求 (時間不翻倍)
        const [genRequestA, genRequestB] = await Promise.all([
            // ==========================================
            // 🎨 風格 A 請求：Auto 模型 (gemini-2.5-flash-image)
            // ==========================================
            fetch('https://cloud.leonardo.ai/api/rest/v2/generations', {
                method: 'POST',
                headers: { 
                    'accept': 'application/json',
                    'authorization': `Bearer ${LEONARDO_API_KEY}`, 
                    'content-type': 'application/json' 
                },
                body: JSON.stringify({
                    "model": "gemini-2.5-flash-image",
                    "public": false,
                    "parameters": {
                        "height": 1024,
                        "width": 1024,
                        "prompt_enhance": "OFF",
                        "quantity": 1,
                        "style_ids": [
                            "111dc692-d470-4eec-b791-3475abac4c46" // Style A 特徵 ID
                        ],
                        "prompt": fixedPrompt,
                        "guidances": {
                            "image_reference": [
                                {
                                    "image": { "id": guestImageId, "type": "UPLOADED" },
                                    "strength": "MID"
                                }
                            ]
                        }
                    }
                })
            }).then(r => r.json()),

            // ==========================================
            // 🎨 風格 B 請求：GPT Image 2.0 模型 (gpt-image-2)
            // ==========================================
            fetch('https://cloud.leonardo.ai/api/rest/v2/generations', {
                method: 'POST',
                headers: { 
                    'accept': 'application/json',
                    'authorization': `Bearer ${LEONARDO_API_KEY}`, 
                    'content-type': 'application/json' 
                },
                body: JSON.stringify({
                    "model": "gpt-image-2",
                    "public": false,
                    "parameters": {
                        "height": 1024,
                        "width": 1024,
                        "prompt_enhance": "OFF",
                        "quantity": 1,
                        "style_ids": [
                            "645e4195-f63d-4715-a3f2-3fb1e6eb8c70" // Style B 特徵 ID
                        ],
                        "prompt": fixedPrompt,
                        "guidances": {
                            "image_reference": [
                                {
                                    "image": { "id": guestImageId, "type": "UPLOADED" },
                                    "strength": "MID"
                                }
                            ]
                        }
                    }
                })
            }).then(r => r.json())
        ]);

        // 取出 Job ID
        const genIdA = genRequestA.sdGenerationJob?.generationId;
        const genIdB = genRequestB.sdGenerationJob?.generationId;

        if (!genIdA || !genIdB) {
            throw new Error("Leonardo 生圖任務排程失敗，請檢查餘額！");
        }

        console.log(`🎯 Leonardo 雙模生圖已在背景啟動！\n- Job A: ${genIdA}\n- Job B: ${genIdB}\n開始背景定時輪詢...`);

        // 4. 背景非同步輪詢 (1.5秒一次，最長等 18 秒)
        pollAndSaveResults(taskId, genIdA, genIdB);

    } catch (err) {
        console.error(`❌ 自動化生圖大腦失敗 (#${taskId}):`, err.message);
        if (localTasksCache[taskId]) {
            localTasksCache[taskId].remark = `自動生圖失敗原因：${err.message}`;
            if (useFirebase) {
                updateDoc(doc(db, 'artifacts', appId, 'public', taskId), { remark: localTasksCache[taskId].remark });
            }
        }
    }
}

// 🌟 背景輪詢與雲端自動同步
async function pollAndSaveResults(taskId, genIdA, genIdB) {
    let resultA = null;
    let resultB = null;
    let attempts = 0;
    const maxAttempts = 12; 

    while (attempts < maxAttempts && (!resultA || !resultB)) {
        await new Promise(r => setTimeout(r, 1500)); 
        attempts++;

        try {
            // 查詢 Style A
            if (!resultA) {
                const resA = await fetch(`https://cloud.leonardo.ai/api/rest/v2/generations/${genIdA}`, {
                    headers: { 'authorization': `Bearer ${LEONARDO_API_KEY}` }
                }).then(r => r.json());
                
                const job = resA.generations_by_pk;
                if (job && job.status === "COMPLETE" && job.generated_images.length > 0) {
                    resultA = job.generated_images[0].url;
                    localTasksCache[taskId].resultImageA = resultA;
                    console.log(`🎨 號碼牌 #${taskId} [風格 A] 自動繪製完成！`);
                }
            }

            // 查詢 Style B
            if (!resultB) {
                const resB = await fetch(`https://cloud.leonardo.ai/api/rest/v2/generations/${genIdB}`, {
                    headers: { 'authorization': `Bearer ${LEONARDO_API_KEY}` }
                }).then(r => r.json());
                
                const job = resB.generations_by_pk;
                if (job && job.status === "COMPLETE" && job.generated_images.length > 0) {
                    resultB = job.generated_images[0].url;
                    localTasksCache[taskId].resultImageB = resultB;
                    console.log(`🎨 號碼牌 #${taskId} [風格 B] 自動繪製完成！`);
                }
            }

            // 如果兩者都生成成功，自動將狀態改為 completed
            if (resultA && resultB) {
                localTasksCache[taskId].status = 'completed';
                if (useFirebase) {
                    const docRef = doc(db, 'artifacts', appId, 'public', taskId);
                    await updateDoc(docRef, {
                        resultImageA: resultA,
                        resultImageB: resultB,
                        status: 'completed'
                    });
                }
                console.log(`🎉 號碼牌 #${taskId} 雙風格已全數全自動生成並備份完畢！`);
                break;
            }
        } catch (e) {
            console.error(`⚠️ 輪詢號碼牌 #${taskId} 發生短暫異常:`, e.message);
        }
    }
}

// 🌟 根路徑儀表板首頁：防止手動喚醒時顯示 404，給予工作人員最直觀的連線信心
app.get('/', (req, res) => {
    const isLooKeyConfigured = LEONARDO_API_KEY && LEONARDO_API_KEY.length > 0;
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>2026 AI AWARDS 後端核心狀態</title>
            <style>
                body { 
                    background-color: #0b1329; 
                    color: #00f2ff; 
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; 
                    text-align: center; 
                    padding-top: 80px;
                    background-image: radial-gradient(rgba(0, 242, 255, 0.05) 1px, transparent 0);
                    background-size: 24px 24px;
                }
                .container {
                    max-width: 600px;
                    margin: 0 auto;
                    background: rgba(30, 41, 59, 0.7);
                    border: 1px solid rgba(0, 242, 255, 0.2);
                    border-radius: 20px;
                    padding: 40px;
                    box-shadow: 0 0 30px rgba(0, 242, 255, 0.15);
                }
                h1 { 
                    font-size: 2.2rem; 
                    margin-bottom: 20px;
                    text-shadow: 0 0 15px rgba(0, 242, 255, 0.6); 
                }
                p { color: #f1f5f9; font-size: 1.1rem; line-height: 1.6; }
                .status-badge {
                    display: inline-block;
                    padding: 8px 16px;
                    border-radius: 50px;
                    font-weight: bold;
                    font-size: 0.9rem;
                    margin-top: 15px;
                }
                .badge-success {
                    background: rgba(16, 185, 129, 0.2);
                    color: #10b981;
                    border: 1px solid rgba(16, 185, 129, 0.4);
                }
                .badge-warning {
                    background: rgba(245, 158, 11, 0.2);
                    color: #f59e0b;
                    border: 1px solid rgba(245, 158, 11, 0.4);
                }
                .footer {
                    margin-top: 40px;
                    color: #64748b;
                    font-size: 0.8rem;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🚀 2026 AI AWARDS</h1>
                <p>雙重風格叫號伺服器正在亮綠燈運行中！</p>
                <p>今日累計下一張排隊號碼：<strong style="color: #ff00d0; font-size: 1.3rem;">#${String(ticketCounter).padStart(3, '0')}</strong></p>
                <div class="status-badge ${isLooKeyConfigured ? 'badge-success' : 'badge-warning'}">
                    系統生圖模式：${isLooKeyConfigured ? "⚡ Leonardo API 100% 全自動生圖" : "⚙️ 安全手動控制流程 (工作人員手動 Ctrl+V)"}
                </div>
                <div class="footer">
                    App ID: ${appId} | Firebase: ${useFirebase ? "已同步連線" : "本機暫存模式"}<br>
                    指導單位：經濟部 | 主辦單位：經濟部產業技術司
                </div>
            </div>
        </body>
        </html>
    `);
});

app.post('/api/upload', async (req, res) => {
    try {
        const { image } = req.body;
        if (!image) return res.status(400).json({ error: '未提供圖片資料' });

        if (useFirebase) {
            try {
                const tasksCol = collection(db, 'artifacts', appId, 'public');
                const querySnapshot = await getDocs(tasksCol);
                let maxId = 0;
                querySnapshot.forEach((document) => {
                    const idNum = parseInt(document.id, 10);
                    if (!isNaN(idNum) && idNum > maxId) {
                        maxId = idNum;
                    }
                    localTasksCache[document.id] = document.data();
                });
                if (maxId >= ticketCounter) {
                    ticketCounter = maxId + 1;
                }
            } catch (e) {
                console.error("⚠️ 實時安全序號校對失敗:", e.message);
            }
        }

        const taskId = String(ticketCounter).padStart(3, '0');
        ticketCounter++;

        let fallbackPrompt = `Please analyze the physical characteristics of the person in the photo I uploaded...`;

        const newTask = {
            id: taskId,
            sourceImage: image, 
            status: 'pending',  
            resultImageA: null,   
            resultImageB: null,   
            chosenDesign: null,   
            processStatus: '製作中',
            remark: '',         
            suggestedPrompt: fallbackPrompt, 
            createdAt: new Date().toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false }) 
        };

        localTasksCache[taskId] = newTask;

        if (useFirebase) {
            try {
                const docRef = doc(db, 'artifacts', appId, 'public', taskId);
                await setDoc(docRef, newTask);
            } catch (fsErr) {
                console.error(`❌ 雲端備份失敗:`, fsErr.message);
            }
        }

        console.log(`🎫 新任務建立：排隊號碼 #${taskId}`);
        res.json({ success: true, taskId: taskId });

        // 🌟 智慧雙模切換閥：偵測是否有 Leonardo API 金鑰
        if (LEONARDO_API_KEY) {
            // 🚀 模式一：100% 全自動生圖，不需人工操作！
            generateLeonardoDualStyles(taskId, image);
        } else {
            // 📥 模式二：手動退回流 (不進行自動生圖，工作人員手動操作)
            console.log(`ℹ️ 未偵測到 LEONARDO_API_KEY，已自動啟用「安全手動控制流程」`);
        }
    } catch (error) {
        res.status(500).json({ error: '伺服器錯誤' });
    }
});

app.get('/api/status/:taskId', async (req, res) => {
    // 🌟 緩存優化：強烈指示所有客戶端瀏覽器 (特別是 iOS Safari) 不要快取狀態
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const taskId = req.params.taskId;
    let task = localTasksCache[taskId];

    if (!task && useFirebase) {
        try {
            const docRef = doc(db, 'artifacts', appId, 'public', taskId);
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                task = docSnap.data();
                localTasksCache[taskId] = task;
            }
        } catch (e) {
            console.error("❌ 讀取雲端狀態失敗:", e.message);
        }
    }

    if (!task) return res.status(404).json({ error: '找不到該號碼任務' });

    res.json({ 
        success: true, 
        status: task.status, 
        resultImageA: task.resultImageA,
        resultImageB: task.resultImageB,
        chosenDesign: task.chosenDesign
    });
});

app.post('/api/choice/:taskId', async (req, res) => {
    const taskId = req.params.taskId;
    const { choice } = req.body; 
    const task = localTasksCache[taskId];
    if (!task) return res.status(404).json({ error: '找不到該任務' });

    task.chosenDesign = choice;
    console.log(`🎯 號碼牌 #${taskId} 客人最終選擇了風格：[${choice} 款] - 觸發出票機印單`);

    triggerFeiePrint(task);

    if (useFirebase) {
        try {
            const docRef = doc(db, 'artifacts', appId, 'public', taskId);
            await updateDoc(docRef, { chosenDesign: choice });
        } catch (e) {
            console.error("❌ 同步客人抉擇失敗:", e.message);
        }
    }

    res.json({ success: true });
});

// 🌟 新增：獲取單一特定任務的原始 Base64 照片 (避免在大名單輪詢中大量消耗頻寬)
app.get('/api/admin/task-source-image/:taskId', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    const taskId = req.params.taskId;
    let task = localTasksCache[taskId];

    if (!task && useFirebase) {
        try {
            const docRef = doc(db, 'artifacts', appId, 'public', taskId);
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                task = docSnap.data();
                localTasksCache[taskId] = task;
            }
        } catch (e) {
            console.error("❌ 讀取雲端原始照片失敗:", e.message);
        }
    }

    if (!task) return res.status(404).json({ error: '找不到該任務' });
    res.json({ success: true, sourceImage: task.sourceImage });
});

// 🌟 新增：獲取單一特定任務的風格生成大圖 (若為 Base64 格式則單次獲取緩存)
app.get('/api/admin/task-result-images/:taskId', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    const taskId = req.params.taskId;
    let task = localTasksCache[taskId];

    if (!task && useFirebase) {
        try {
            const docRef = doc(db, 'artifacts', appId, 'public', taskId);
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                task = docSnap.data();
                localTasksCache[taskId] = task;
            }
        } catch (e) {
            console.error("❌ 讀取雲端結果大圖失敗:", e.message);
        }
    }

    if (!task) return res.status(404).json({ error: '找不到該任務' });
    res.json({ 
        success: true, 
        resultImageA: task.resultImageA, 
        resultImageB: task.resultImageB 
    });
});

app.get('/api/admin/all-tasks', async (req, res) => {
    // 🌟 緩存優化：強烈指示管理員控制台不要讀取本機快取名單，確保流暢更新
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    if (useFirebase) {
        try {
            const tasksCol = collection(db, 'artifacts', appId, 'public');
            const querySnapshot = await getDocs(tasksCol);
            querySnapshot.forEach((doc) => {
                localTasksCache[doc.id] = doc.data();
            });
        } catch (e) {
            console.error("❌ 輪詢同步雲端失敗:", e.message);
        }
    }
    const all = Object.values(localTasksCache).sort((a, b) => a.id.localeCompare(b.id));

    // 🌟 核心頻寬防護鎖：當客戶端發送 ?lightweight=true 請求，後端將剔除超重 Base64 圖片編碼
    if (req.query.lightweight === 'true') {
        const lightweightTasks = all.map(task => {
            const t = { ...task };
            
            // 標記並移除超重原始客照
            t.hasSourceImage = !!t.sourceImage;
            delete t.sourceImage;

            // 標記並移除超重 A、B 款大圖 (若為 Base64 的 data: 格式則刪除；若是外部 CDN 網址則保留)
            t.hasResultImageA = !!t.resultImageA;
            if (t.resultImageA && t.resultImageA.startsWith('data:')) {
                delete t.resultImageA;
            }
            t.hasResultImageB = !!t.resultImageB;
            if (t.resultImageB && t.resultImageB.startsWith('data:')) {
                delete t.resultImageB;
            }
            
            return t;
        });
        return res.json({ success: true, tasks: lightweightTasks });
    }

    res.json({ success: true, tasks: all });
});

app.get('/api/admin/printer-status', async (req, res) => {
    const result = await queryFeieStatus();
    res.json(result);
});

app.post('/api/admin/reprint/:taskId', async (req, res) => {
    const taskId = req.params.taskId;
    const task = localTasksCache[taskId];
    if (!task) return res.status(404).json({ success: false, error: "找不到該排隊任務" });
    
    console.log(`🖨️ 管理員手動觸發號碼牌 #${taskId} 重新出票列印`);
    await triggerFeiePrint(task);
    res.json({ success: true });
});

app.post('/api/admin/reset-all', async (req, res) => {
    try {
        console.log("🧹 收到管理員重製要求，正在清空所有訂單並歸零流水號...");
        localTasksCache = {};
        ticketCounter = 1;

        if (useFirebase) {
            const tasksCol = collection(db, 'artifacts', appId, 'public');
            const querySnapshot = await getDocs(tasksCol);
            const deletePromises = [];
            querySnapshot.forEach((document) => {
                const docRef = doc(db, 'artifacts', appId, 'public', document.id);
                deletePromises.push(deleteDoc(docRef));
            });
            await Promise.all(deletePromises);
            console.log("🔥 雲端所有排隊文件已清空！");
        }

        res.json({ success: true, message: "所有資料已重製，流水號已回到 001" });
    } catch (error) {
        console.error("❌ 重製失敗:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/admin/upload-result-dual/:taskId', async (req, res) => {
    const taskId = req.params.taskId;
    const { resultImageA, resultImageB } = req.body;
    const task = localTasksCache[taskId];
    if (!task) return res.status(404).json({ error: '找不到該任務' });

    if (resultImageA) task.resultImageA = resultImageA;
    if (resultImageB) task.resultImageB = resultImageB;

    if (task.resultImageA && task.resultImageA !== "" && task.resultImageB && task.resultImageB !== "") {
        task.status = 'completed';
    }

    if (useFirebase) {
        try {
            const docRef = doc(db, 'artifacts', appId, 'public', taskId);
            const updatePayload = {};
            
            if (task.resultImageA !== undefined && task.resultImageA !== null) {
                updatePayload.resultImageA = task.resultImageA;
            }
            if (task.resultImageB !== undefined && task.resultImageB !== null) {
                updatePayload.resultImageB = task.resultImageB;
            }
            if (task.status !== undefined && task.status !== null) {
                updatePayload.status = task.status;
            }
            
            await updateDoc(docRef, updatePayload);
            console.log(`🔥 成功同步號碼牌 #${taskId} 最新狀態至雲端！`);
        } catch (e) {
            console.error("❌ 同步結果圖至雲端失敗:", e.message);
        }
    }

    res.json({ success: true });
});

app.listen(PORT, () => {
    console.log(`🚀 雙重風格叫號伺服器運行中，監聽 PORT: ${PORT}`);
});
