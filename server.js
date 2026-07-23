/**
 * AI 互動雷雕拍照系統 - 後端 API (Firebase 雲端同步 & 飛鵝出票機防當機完全體版)
 * 🌟 深度排錯與長效全自動版：搭載 Leonardo API 原始 HTTP 狀態日誌與 6 分鐘背景長效輪詢
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
        if (!LEONARDO_API_KEY) {
            throw new Error("伺服器未設定 LEONARDO_API_KEY 環境變數");
        }

        console.log("📡 正在向 Leonardo.ai 發起 init-image (S3 上傳申請)...");
        const initUploadRes = await fetch('https://cloud.leonardo.ai/api/rest/v1/init-image', {
            method: 'POST',
            headers: {
                'accept': 'application/json',
                'authorization': `Bearer ${LEONARDO_API_KEY}`,
                'content-type': 'application/json'
            },
            body: JSON.stringify({ "extension": "jpg" })
        });

        const status = initUploadRes.status;
        const resText = await initUploadRes.text();
        console.log(`📡 Leonardo 原始回應碼 [${status}]: ${resText.substring(0, 300)}`);

        if (!initUploadRes.ok) {
            throw new Error(`Leonardo API 拒絕存取 [HTTP ${status}]: ${resText}`);
        }

        let uploadData;
        try {
            uploadData = JSON.parse(resText);
        } catch (e) {
            throw new Error(`無法解析 Leonardo 回應 JSON: ${resText}`);
        }

        if (!uploadData.uploadInitImage) {
            throw new Error(`Leonardo 回應欠缺 uploadInitImage 欄位: ${resText}`);
        }

        const { id, url, fields } = uploadData.uploadInitImage;
        const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, "");
        const imageBuffer = Buffer.from(base64Data, 'base64');

        const s3Fields = typeof fields === 'string' ? JSON.parse(fields) : fields;
        const formData = new FormData();
        
        Object.entries(s3Fields).forEach(([key, value]) => {
            formData.append(key, value);
        });
        
        formData.append('file', new Blob([imageBuffer], { type: 'image/jpeg' }), 'image.jpg');

        const s3UploadRes = await fetch(url, {
            method: 'POST',
            body: formData
        });

        if (s3UploadRes.status >= 200 && s3UploadRes.status < 300) {
            console.log(`✅ 客人照片成功上傳 Leonardo S3！取得 ID: ${id}`);
            return id;
        } else {
            const s3ErrText = await s3UploadRes.text();
            throw new Error(`S3 圖片儲存失敗 [HTTP ${s3UploadRes.status}]: ${s3ErrText}`);
        }
    } catch (err) {
        console.error("❌ uploadToLeonardoS3 詳細異常:", err.message);
        throw err;
    }
}

// 🌟 核心函數：雙模型併發生圖與背景定時輪詢
async function generateLeonardoDualStyles(taskId, base64Image) {
    try {
        const guestImageId = await uploadToLeonardoS3(base64Image);

        const promptA = `Please analyze the physical characteristics of the person in the photo I uploaded (including hairstyle, hair color, clothing style and color, whether they wear glasses or have any special accessories). Then, retain these personal characteristics and reshape it into a new image with the following specific style:\n\nDetailed Style Specifications:\n\nMain Style: Minimalist hand-drawn chibi avatar.\n\nLine Strokes: Slightly thick black outlines with a hand-drawn feel, and rough edges resembling crayon or pencil strokes.\n\nColor and Shadows: Simple, flat coloring without complex gradients or shadows.\n\nFacial Features: Extremely simplified facial features (e.g., round eyes, small nose), with two cute little wisps of light pink blush on the cheeks.\n\nBackground and Composition: Solid white clean background.`;
        
        const promptB = `Please analyze the physical characteristics of the person in the photo I uploaded (including hairstyle, hair color, clothing style and color, whether they wear glasses or have any special accessories). Then, retain these personal characteristics and reshape it into a new image with the following specific style:\n\nDetailed Style Specifications:\n\nMain Style: Minimalist hand-drawn chibi avatar.\n\nLine Strokes: Slightly thick black outlines with a hand-drawn feel, and rough edges resembling crayon or pencil strokes.\n\nColor and Shadows: Simple, flat coloring without complex gradients or shadows.\n\nFacial Features: Extremely simplified facial features (e.g., bean eyes, small nose), with two cute little wisps of light pink blush on the cheeks.\n\nBackground and Composition: Solid white clean background.`;

        console.log(`⚡ 啟動 Promise.all 雙通道，對 Leonardo 併發雙模型生圖請求...`);

        const [genRequestA, genRequestB] = await Promise.all([
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
                        "quality": "LOW",
                        "style_ids": [
                            "6fedbf1f-4a17-45ec-84fb-92fe524a29ef" 
                        ],
                        "prompt": promptA,
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
                        "quality": "LOW",
                        "style_ids": [
                            "645e4195-f63d-4715-a3f2-3fb1e6eb8c70" 
                        ],
                        "prompt": promptB,
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

        const genIdA = genRequestA.generate?.generationId || genRequestA.generationId || genRequestA.sdGenerationJob?.generationId;
        const genIdB = genRequestB.generate?.generationId || genRequestB.generationId || genRequestB.sdGenerationJob?.generationId;

        if (!genIdA || !genIdB) {
            console.error("生成請求回傳異常 - A:", genRequestA, "B:", genRequestB);
            throw new Error("無法取得 Leonardo 官方任務 ID，請檢查 API Key 或點數！");
        }

        console.log(`🎯 Leonardo 雙模生圖已在背景啟動！\n- Job A: ${genIdA}\n- Job B: ${genIdB}\n開始長效背景定時輪詢...`);

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

// 🌟 長效背景輪詢 (180 次 x 2秒 = 6 分鐘，大幅延長解除卡單)
async function pollAndSaveResults(taskId, genIdA, genIdB) {
    let resultA = null;
    let resultB = null;
    let attempts = 0;
    const maxAttempts = 180; 

    while (attempts < maxAttempts && (!resultA || !resultB)) {
        await new Promise(r => setTimeout(r, 2000)); 
        attempts++;

        try {
            if (!resultA) {
                const resA = await fetch(`https://cloud.leonardo.ai/api/rest/v1/generations/${genIdA}`, {
                    headers: { 'authorization': `Bearer ${LEONARDO_API_KEY}` }
                }).then(r => r.json());
                
                const jobA = resA.generations_by_pk;
                if (attempts === 1 || attempts % 10 === 0) {
                    console.log(`🔍 [進度轉播] #${taskId} A款目前狀態: ${jobA?.status || JSON.stringify(resA)}`);
                }

                if (jobA && jobA.status === "COMPLETE" && jobA.generated_images && jobA.generated_images.length > 0) {
                    resultA = jobA.generated_images[0].url;
                    localTasksCache[taskId].resultImageA = resultA;
                    console.log(`🎨 號碼牌 #${taskId} [風格 A] 自動繪製完成！`);
                } else if (jobA && jobA.status === "FAILED") {
                    console.log(`❌ [警告] #${taskId} A款已被官方標記為失敗 (FAILED)`);
                    resultA = "FAILED";
                }
            }

            if (!resultB) {
                const resB = await fetch(`https://cloud.leonardo.ai/api/rest/v1/generations/${genIdB}`, {
                    headers: { 'authorization': `Bearer ${LEONARDO_API_KEY}` }
                }).then(r => r.json());
                
                const jobB = resB.generations_by_pk;
                if (attempts === 1 || attempts % 10 === 0) {
                    console.log(`🔍 [進度轉播] #${taskId} B款目前狀態: ${jobB?.status || JSON.stringify(resB)}`);
                }

                if (jobB && jobB.status === "COMPLETE" && jobB.generated_images && jobB.generated_images.length > 0) {
                    resultB = jobB.generated_images[0].url;
                    localTasksCache[taskId].resultImageB = resultB;
                    console.log(`🎨 號碼牌 #${taskId} [風格 B] 自動繪製完成！`);
                } else if (jobB && jobB.status === "FAILED") {
                    console.log(`❌ [警告] #${taskId} B款已被官方標記為失敗 (FAILED)`);
                    resultB = "FAILED";
                }
            }

            if (resultA && resultB && resultA !== "FAILED" && resultB !== "FAILED") {
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
                    系統生圖模式：${isLooKeyConfigured ? "⚡ Leonardo API 100% 全自動生圖 (6分鐘長效等待)" : "⚙️ 安全手動控制流程"}
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

        const taskId = String(ticketCounter).padStart(3, '0');
        ticketCounter++;

        const newTask = {
            id: taskId,
            sourceImage: image, 
            status: 'pending',  
            resultImageA: null,   
            resultImageB: null,   
            chosenDesign: null,   
            processStatus: '製作中',
            remark: '',         
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

        if (LEONARDO_API_KEY) {
            generateLeonardoDualStyles(taskId, image);
        } else {
            console.log(`ℹ️ 未偵測到 LEONARDO_API_KEY，已自動啟用「安全手動控制流程」`);
        }
    } catch (error) {
        res.status(500).json({ error: '伺服器錯誤' });
    }
});

app.get('/api/status/:taskId', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
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

app.get('/api/admin/all-tasks', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    const all = Object.values(localTasksCache).sort((a, b) => a.id.localeCompare(b.id));

    if (req.query.lightweight === 'true') {
        const lightweightTasks = all.map(task => {
            const t = { ...task };
            t.hasSourceImage = !!t.sourceImage; 
            delete t.sourceImage;

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

app.get('/api/admin/task-source-image/:taskId', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    const taskId = req.params.taskId;
    let task = localTasksCache[taskId];
    res.json({ success: true, sourceImage: task?.sourceImage });
});

app.get('/api/admin/task-result-images/:taskId', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    const taskId = req.params.taskId;
    let task = localTasksCache[taskId];
    res.json({ success: true, resultImageA: task?.resultImageA, resultImageB: task?.resultImageB });
});

app.post('/api/admin/upload-result-dual/:taskId', async (req, res) => {
    const taskId = req.params.taskId;
    const { resultImageA, resultImageB } = req.body;
    const task = localTasksCache[taskId];
    if (!task) return res.status(404).json({ error: '找不到該任務' });

    if (resultImageA) task.resultImageA = resultImageA;
    if (resultImageB) task.resultImageB = resultImageB;

    if (task.resultImageA && task.resultImageB) {
        task.status = 'completed';
    }

    if (useFirebase) {
        try {
            const docRef = doc(db, 'artifacts', appId, 'public', taskId);
            await updateDoc(docRef, { 
                resultImageA: task.resultImageA, 
                resultImageB: task.resultImageB, 
                status: task.status 
            });
        } catch (e) {
            console.error("❌ 手動上傳結果同步至雲端失敗:", e.message);
        }
    }

    res.json({ success: true });
});

app.post('/api/admin/update-meta/:taskId', async (req, res) => {
    const taskId = req.params.taskId; 
    const { processStatus, remark } = req.body; 
    const task = localTasksCache[taskId];
    if (!task) return res.status(404).json({ error: '找不到該任務' });

    if (processStatus !== undefined) task.processStatus = processStatus;
    if (remark !== undefined) task.remark = remark;

    if (useFirebase) {
        try {
            await updateDoc(doc(db, 'artifacts', appId, 'public', taskId), { 
                processStatus: task.processStatus, 
                remark: task.remark 
            });
        } catch (e) {
            console.error("Firebase 更新狀態/備註失敗:", e.message);
        }
    }
    res.json({ success: true });
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
        localTasksCache = {};
        ticketCounter = 1;
        if (useFirebase) {
            const querySnapshot = await getDocs(collection(db, 'artifacts', appId, 'public'));
            const deletePromises = [];
            querySnapshot.forEach((document) => { 
                deletePromises.push(deleteDoc(doc(db, 'artifacts', appId, 'public', document.id))); 
            });
            await Promise.all(deletePromises);
        }
        res.json({ success: true, message: "所有資料已重製" });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 雙重風格叫號伺服器運行中，監聽 PORT: ${PORT}`);
});
