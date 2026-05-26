/**
 * AI 互動雷雕拍照系統 - 後端 API (LLaVA 100% 免授權公開大腦版)
 * 核心功能：
 * 1. 接收前端客人照片，利用完全公開、免簽約審查的 yorickvp/llava-13b 進行多維度特徵提取
 * 2. 深度鎖定：綁馬尾、公主頭、辮子、中分、旁分、劉海、飾品(耳環/項鍊)、衣服色系、表情、髮色
 * 3. 100% 繞過 Meta 官方 Llama 的 404/422 授權協議封鎖，隨插即用！
 * 4. 具備強健的 JSON 解析防呆，保證現場體驗不卡死、不出錯。
 */
const express = require('express');
const cors = require('cors');
const Replicate = require('replicate');

const app = express();
const PORT = process.env.PORT || 10000; 

// 初始化 Replicate AI 介面 (會自動讀取 Render 環境變數 REPLICATE_API_TOKEN)
const replicate = new Replicate({
    auth: process.env.REPLICATE_API_TOKEN || "", 
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ==========================================
// 核心記憶體資料庫 (儲存排隊狀態與智慧提示詞)
// ==========================================
const tasks = {};
let ticketCounter = 1;

app.get('/', (req, res) => {
    res.status(200).send("🟢 Queue Server is running (High-Fidelity Public-Llava Prompt Engine Enabled). 系統正在使用免授權公用大腦模式運行中。");
});

// ==========================================
// 📱 給「前端展場機台 (客人)」使用的 API
// ==========================================

// 1. 客人拍照上傳，領取號碼牌並觸發背景 LLaVA 特徵抽取
app.post('/api/upload', async (req, res) => {
    try {
        const { image } = req.body;
        if (!image) {
            return res.status(400).json({ error: '未提供圖片資料' });
        }

        const taskId = String(ticketCounter).padStart(3, '0');
        ticketCounter++;

        // 預設的高強度風格咒語（以防分析超時或 Token 失效的備用方案）
        let fallbackPrompt = `Quirky minimalist hand-drawn doodle portrait, naive art, chibi kawaii aesthetic. Extreme chibi proportions, huge oversized head, tiny small body, narrow sloping shoulders. Extremely simplified facial features, simple vertical dot eyes, tiny line nose, soft blurred pink blush on cheeks. Clean simple neck, wearing a basic round neck t-shirt. Drawn with a monoline marker brush. Flat soft colors. Solid pure white background, no shading, no realistic eyes.`;

        tasks[taskId] = {
            id: taskId,
            sourceImage: image, 
            status: 'pending',  
            resultImage: null,  
            remark: '',         
            suggestedPrompt: fallbackPrompt, 
            createdAt: new Date().toLocaleTimeString('zh-TW', { hour12: false }) 
        };

        console.log(`🎫 新任務建立：排隊號碼 #${taskId}，準備發送給 LLaVA 公用視覺大腦分析...`);
        res.json({ success: true, taskId: taskId });

        // 背景非同步調用 LLaVA 進行圖像特徵分析，完全不卡住前台體驗
        if (process.env.REPLICATE_API_TOKEN) {
            analyzeImageAndGeneratePrompt(taskId, image);
        } else {
            console.log("⚠️ [重要警告] Render 上未設定 REPLICATE_API_TOKEN 環境變數！系統將永遠只能使用備用通用咒語。");
        }

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

app.get('/api/admin/all-tasks', (req, res) => {
    const all = Object.values(tasks)
        .sort((a, b) => a.id.localeCompare(b.id));
    res.json({ success: true, tasks: all });
});

app.post('/api/admin/upload-result/:taskId', (req, res) => {
    try {
        const taskId = req.params.taskId;
        const { resultImage } = req.body;
        const task = tasks[taskId];

        if (!task) {
            return res.status(404).json({ error: '找不到該任務' });
        }
        task.status = 'completed'; 
        task.resultImage = resultImage; 

        console.log(`✅ 任務完成：號碼 #${task.id} 已成功上傳雷雕結果圖`);
        res.json({ success: true });
    } catch (error) {
        console.error("結果上傳發生錯誤:", error);
        res.status(500).json({ error: '上傳失敗，請重試' });
    }
});

app.post('/api/admin/update-status/:taskId', (req, res) => {
    try {
        const taskId = req.params.taskId;
        const { status } = req.body;
        const task = tasks[taskId];

        if (!task) {
            return res.status(404).json({ error: '找不到該任務' });
        }
        task.status = status;
        res.json({ success: true, status: task.status });
    } catch (error) {
        console.error("更新狀態發生錯誤:", error);
        res.status(500).json({ error: '更新失敗' });
    }
});

app.post('/api/admin/save-remark/:taskId', (req, res) => {
    try {
        const taskId = req.params.taskId;
        const { remark } = req.body;
        const task = tasks[taskId];

        if (!task) {
            return res.status(404).json({ error: '找不到該任務' });
        }
        task.remark = remark || '';
        res.json({ success: true });
    } catch (error) {
        console.error("儲存備註發生錯誤:", error);
        res.status(500).json({ error: '儲存失敗' });
    }
});

// ==========================================
// 🧠 LLaVA 公用視覺大腦超強健特徵與特殊髮型鎖定函數 (不需任何授權合約)
// ==========================================
async function analyzeImageAndGeneratePrompt(taskId, base64Image) {
    try {
        console.log(`[Vision AI] 號碼 #${taskId}: 正在發送分析請求給 yorickvp/llava-13b...`);
        
        // 🌟 核心防禦：加入對 messy bun 與 ponytail 的視覺描述，強迫 LLaVA 做精準判定
        const promptText = `
        You are a highly precise visual analysis assistant. Carefully inspect the provided portrait and extract details.
        Output ONLY a JSON block inside curly braces, containing these exact attributes:
        {
          "gender": "man, woman, boy, or girl",
          "hairLength": "short (above shoulders), shoulder-length, or long (past shoulders)",
          "hairTexture": "straight, wavy, or curly",
          "hairStyle": "messy bun (包包頭/低髮髻 - hair gathered into a round bun or knot at the back/side of the head), ponytail (馬尾 - hair tied back and hanging down in a single tail), princess (公主頭 - half-up half-down style), braids (雙辮子), loose hair (披肩散髮 - hair flowing down naturally untied)",
          "hairParting": "center-parted (中分), side-parted (旁分), or no parting",
          "bangs": "wispy bangs (空氣劉海), blunt bangs (齊劉海), or no bangs",
          "hairColor": "black, brown, blonde, or dyed color",
          "glasses": "wearing glasses, or no glasses",
          "necklace": "wearing necklace, or no necklace",
          "earrings": "wearing earrings, or no earrings",
          "expression": "smiling, or neutral",
          "clothingType": "t-shirt, shirt, hoodie, or jacket",
          "clothingColor": "black, white, red, blue, green, etc."
        }
        Do not write any markdown wrappers like \`\`\`json or \`\`\`. Output raw JSON directly.
        `;

        // 使用 replicate.stream 進行非同步串流，且 input 僅傳入標準 image 與 prompt，徹底避免 422 格式報錯
        let rawText = "";
        for await (const event of replicate.stream(
            "yorickvp/llava-13b:80537f9eead1a5bfa72d5ac6ea6414379be41d4d4f6679fd776e9535d1eb58bb",
            {
                input: {
                    image: base64Image,
                    prompt: promptText.trim()
                }
            }
        )) {
            rawText += event;
        }

        console.log(`[Vision AI] 號碼 #${taskId} 原始分析結果字元長度: ${rawText.length}`);

        // 清理 LLaVA 可能自作聰明附加的 Markdown 語法
        let cleanText = rawText.trim();
        cleanText = cleanText.replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();

        const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("回傳內容無法擷取到有效的 { ... } JSON 物件");

        const f = JSON.parse(jsonMatch[0]);
        console.log(`[Vision AI] 號碼 #${taskId} 成功解析特徵:`, {
            gender: f.gender,
            hairStyle: f.hairStyle,
            glasses: f.glasses,
            necklace: f.necklace,
            earrings: f.earrings
        });

        // 完美組裝：融入綁馬尾、公主頭、雙辮子、中分、旁分、劉海樣式等頂級高保真細節
        const customPrompt = `Quirky minimalist hand-drawn doodle portrait of a ${f.gender || 'person'} with ${f.hairLength || 'medium'} ${f.hairTexture || 'straight'} ${f.hairColor || 'black'} hair styled in a ${f.hairStyle || 'classic loose hair style'} with a ${f.hairParting || 'natural parting'} and ${f.bangs || 'no bangs'}, showing a ${f.expression || 'neutral calm face'}. The person is ${f.glasses || 'no glasses'}, ${f.necklace || 'no necklace'}, and ${f.earrings || 'no earrings'}. Wearing a plain unpatterned solid ${f.clothingColor || 'white'} ${f.clothingType || 't-shirt'}, absolutely no logos, no graphics, no text on shirt. Naive art, chibi kawaii aesthetic. Extreme chibi proportions, huge oversized head, tiny small body, narrow sloping shoulders. Extremely simplified facial features, simple vertical black dot eyes, tiny line nose, soft blurred pink blush on cheeks. Smooth clean bare neck, absolutely no neck lines. Clean solid color hair, no white dots, no shading. Drawn with a monoline marker brush. Flat soft colors. Solid pure white background.`;

        if (tasks[taskId]) {
            tasks[taskId].suggestedPrompt = customPrompt;
            console.log(`🎯 號碼牌 #${taskId} 的客製特徵提示詞成功存入資料庫！`);
        }

    } catch (err) {
        console.error(`❌ [Vision AI] 號碼 #${taskId} LLaVA 執行或解析發生錯誤:`, err.message);
    }
}

// 啟動伺服器
app.listen(PORT, () => {
    console.log(`🚀 智慧咒語生成叫號伺服器啟動成功！正在監聽 PORT: ${PORT}`);
});
