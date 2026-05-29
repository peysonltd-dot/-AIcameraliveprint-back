/**
 * AI 互動雷雕拍照系統 - 後端 API (Firebase 雲端同步 & 飛鵝出票機防當機完全體版)
 * 🌟 增量加載與 Firebase 讀取歸零優化版
 */
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const Replicate = require('replicate');
const { initializeApp } = require('firebase/app');
const { getFirestore, doc, setDoc, getDoc, collection, getDocs, updateDoc, deleteDoc } = require('firebase/firestore');

const app = express();
const PORT = process.env.PORT || 10000; 

const replicate = new Replicate({
    auth: (process.env.REPLICATE_API_TOKEN || "").trim(), 
});

app.use(cors());
app.use(express.json({ limit: '60mb' }));
app.use(express.urlencoded({ limit: '60mb', extended: true }));

let localTasksCache = {};
let ticketCounter = 1;
let db;
let useFirebase = false;

// Firebase Firestore 初始化
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

const appId = (process.env.APP_ID || "photo-booth-app").trim();

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

// 飛鵝雲端自動出票
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

// 查詢印表機狀態
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

        let fallbackPrompt = `Quirky minimalist hand-drawn doodle portrait, naive art, chibi kawaii aesthetic. Extreme chibi proportions, huge oversized head, tiny small body.`;

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

        if (process.env.REPLICATE_API_TOKEN) {
            analyzeImageAndGeneratePrompt(taskId, image);
        }
    } catch (error) {
        res.status(500).json({ error: '伺服器錯誤' });
    }
});

app.get('/api/status/:taskId', async (req, res) => {
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

// 🌟 優化 1：極輕量化輪詢 API (只回傳文字 ID 列表與進度，100% 拿掉大圖 Base64，每次回傳僅 1KB)
app.get('/api/admin/all-tasks-lean', (req, res) => {
    const leanTasks = Object.values(localTasksCache).map(task => ({
        id: task.id,
        status: task.status,
        processStatus: task.processStatus || '製作中',
        remark: task.remark || '',
        suggestedPrompt: task.suggestedPrompt,
        createdAt: task.createdAt,
        chosenDesign: task.chosenDesign
    })).sort((a, b) => b.id.localeCompare(a.id));

    res.json({ success: true, tasks: leanTasks });
});

// 🌟 優化 2：獨立圖片撈取 API (只有在控制台需要顯示新卡片時，才單獨請求一次，絕不重複下載)
app.get('/api/admin/task-images/:taskId', (req, res) => {
    const taskId = req.params.taskId;
    const task = localTasksCache[taskId];
    if (!task) return res.status(404).json({ error: '找不到任務' });

    res.json({
        success: true,
        sourceImage: task.sourceImage,
        resultImageA: task.resultImageA,
        resultImageB: task.resultImageB
    });
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

// 管理員重製
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
            await updateDoc(docRef, {
                resultImageA: task.resultImageA,
                resultImageB: task.resultImageB,
                status: task.status
            });
        } catch (e) {
            console.error("❌ 同步結果圖至雲端失敗:", e.message);
        }
    }

    res.json({ success: true });
});

// LLaVA 視覺解析
async function analyzeImageAndGeneratePrompt(taskId, base64Image) {
    try {
        const promptText = `
        You are a highly precise visual analysis assistant. Output ONLY a JSON block inside curly braces, containing these exact attributes:
        {
          "gender": "man, woman, boy, or girl",
          "hairLength": "short (above shoulders), shoulder-length, or long (past shoulders)",
          "hairTexture": "straight, wavy, or curly",
          "hairStyle": "messy bun, ponytail, princess, braids, loose hair",
          "hairParting": "center-parted, side-parted, or no parting",
          "bangs": "wispy bangs, side-swept bangs, blunt bangs, or no bangs",
          "hairColor": "black, dark brown, chestnut brown, blonde, dyed pink, dyed purple, or silver grey",
          "glasses": "wearing glasses, or no glasses",
          "necklace": "wearing necklace, or no necklace",
          "earrings": "wearing earrings, or no earrings",
          "clothingColor": "black, white, red, blue, green, yellow, pink, or grey"
        }
        Output raw JSON directly. Do not wrap in markdown tags.
        `;

        let rawText = "";
        for await (const event of replicate.stream(
            "yorickvp/llava-13b:80537f9eead1a5bfa72d5ac6ea6414379be41d4d4f6679fd776e9535d1eb58bb",
            { input: { image: base64Image, prompt: promptText.trim() } }
        )) {
            rawText += event;
        }

        let cleanText = rawText.trim().replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();
        const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("無效JSON物件");

        const f = JSON.parse(jsonMatch[0]);
        let bangsText = f.bangs === 'no bangs' ? 'no bangs' : `${f.bangs}`;
        if (f.hairParting && f.hairParting !== 'no parting') bangsText += ` with a ${f.hairParting}`;

        const customPrompt = `Quirky minimalist hand-drawn doodle portrait of a ${f.gender || 'person'} with long straight ${f.hairColor || 'black'} hair styled in a ${f.hairStyle || 'loose hair'} with ${bangsText}, showing a smiling. The person is ${f.glasses || 'no glasses'}, ${f.necklace || 'no necklace'}, and ${f.earrings || 'no earrings'}. Wearing a plain unpatterned solid ${f.clothingColor || 'white'} t-shirt, absolutely no logos, no graphics, no text on shirt. Naive art, chibi kawaii aesthetic. Extreme chibi proportions, huge oversized head, tiny small body, narrow sloping shoulders. Extremely simplified facial features, simple vertical black dot eyes, tiny line nose, soft blurred pink blush on cheeks. Smooth clean bare neck, absolutely no neck lines. Clean solid color hair, no white dots, no shading. Drawn with a monoline marker brush. Flat soft colors. Solid pure white background.`;

        if (localTasksCache[taskId]) {
            localTasksCache[taskId].suggestedPrompt = customPrompt;
            if (useFirebase) {
                try {
                    const docRef = doc(db, 'artifacts', appId, 'public', taskId);
                    await updateDoc(docRef, { suggestedPrompt: customPrompt });
                } catch (fsErr) {
                    console.error("❌ 同步建議提示詞失敗:", fsErr.message);
                }
            }
        }
    } catch (err) {
        console.error(`❌ 號碼 #${taskId} LLaVA 錯誤:`, err.message);
    }
}

app.listen(PORT, () => {
    console.log(`🚀 雙重風格叫號伺服器運行中，監聽 PORT: ${PORT}`);
});
