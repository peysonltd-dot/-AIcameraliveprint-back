/**
 * AI 互動雷雕拍照系統 - 後端 API (Llama 3.2 Vision 頂級髮型與細節鎖定版)
 * 核心功能：
 * 1. 接收前端客人照片，利用 Llama 3.2 Vision 進行多維度特徵提取
 * 2. 深度鎖定：綁馬尾、公主頭、辮子、中分、旁分、劉海、飾品(耳環/項鍊)、衣服色系、表情、髮色
 * 3. 動態渲染組裝 Leonardo.ai 的極簡 Q 版豆豆眼專利提示詞
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
    res.status(200).send("🟢 Queue Server is running (High-Fidelity Hair-Aware Prompt Engine Enabled). 系統正在使用頂級髮型與細節鎖定模式運行中。");
});

// ==========================================
// 📱 給「前端展場機台 (客人)」使用的 API
// ==========================================

// 1. 客人拍照上傳，領取號碼牌並觸發背景 Llama 特徵抽取
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

        console.log(`🎫 新任務建立：排隊號碼 #${taskId}，正在啟動背景 Llama-3.2-Vision 髮型與細節鎖定分析...`);
        res.json({ success: true, taskId: taskId });

        // 背景非同步調用 Llama Vision 進行圖像特徵分析，完全不卡住前台體驗
        if (process.env.REPLICATE_API_TOKEN) {
            analyzeImageAndGeneratePrompt(taskId, image);
        } else {
            console.log("⚠️ REPLICATE_API_TOKEN 未設定，將使用備用通用咒語。");
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
// 🧠 Llama 3.2 Vision 超精細特徵與特殊髮型鎖定函數
// ==========================================
async function analyzeImageAndGeneratePrompt(taskId, base64Image) {
    try {
        console.log(`[Vision AI] 正在發送分析請求給 Llama 3.2 11B Vision...`);
        
        const systemPrompt = `You are a professional image analysis assistant. Your job is to extract exact facial, hair, accessory, and clothing features from the provided portrait so we can reconstruct them in an flat illustration.
        Respond with ONLY a clean JSON object containing these keys. Do not include markdown wraps like \`\`\`json or anything else. Just the raw JSON:
        {
          "gender": "man, woman, boy, or girl",
          "hairLength": "e.g., short crop, shoulder-length hair, very long hair past shoulders, medium bob length",
          "hairTexture": "e.g., straight, wavy, tight curly",
          "hairStyle": "e.g., high ponytail (馬尾), low ponytail, half-up princess hair style (公主頭), double braids (雙辮子), single side braid (單編辮), classic loose hair style (披肩散髮), messy bun (包包頭), pigtails (雙馬尾), short undercut (男生側邊漸層)",
          "hairParting": "e.g., center-parted (中分), side-parted (旁分), no parting line (無分線)",
          "bangs": "e.g., see-through wispy bangs (空氣劉海), thick blunt bangs (齊劉海), side-swept bangs, curtain bangs (八字劉海), no bangs with forehead exposed (無劉海)",
          "hairColor": "e.g., deep black, chestnut brown, platinum blonde, vibrant dyed pink, dyed purple, grey",
          "glasses": "e.g., no glasses, thin gold wire-rimmed glasses, thick black-frame glasses, clear round glasses",
          "necklace": "e.g., no necklace, a delicate thin silver chain, a gold pendant necklace, a pearl necklace, a black lace choker",
          "earrings": "e.g., no earrings, small gold hoop earrings, simple pearl studs, long dangling silver earrings",
          "expression": "e.g., cheerful bright smile, gentle smirk, neutral calm face, joyful open-mouth laughter",
          "clothingType": "e.g., crewneck t-shirt, collared button-up shirt, casual hoodie, pullover sweater, jacket",
          "clothingColor": "solid black, pastel pink, crimson red, navy blue, pure white, olive green"
        }`;

        const response = await replicate.run(
            "meta/llama-3.2-11b-vision-instruct",
            {
                input: {
                    image: base64Image,
                    prompt: "Precisely extract gender, hairLength, hairTexture, hairStyle, hairParting, bangs, hairColor, glasses, necklace, earrings, expression, clothingType, and clothingColor. Output JSON only.",
                    system_instruction: systemPrompt,
                    max_new_tokens: 400
                }
            }
        );

        const rawText = Array.isArray(response) ? response.join("") : response;
        console.log(`[Vision AI] 原始分析結果: ${rawText}`);

        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("回傳格式不符合 JSON");

        const f = JSON.parse(jsonMatch[0]);
        console.log(`[Vision AI] 成功萃取高級細節:`, f);

        // 🌟 完美組裝：融入綁馬尾、公主頭、雙辮子、中分、旁分、劉海樣式等頂級高保真細節
        const customPrompt = `Quirky minimalist hand-drawn doodle portrait of a ${f.gender || 'person'} with ${f.hairLength || 'medium'} ${f.hairTexture || 'straight'} ${f.hairColor || 'black'} hair styled in a ${f.hairStyle || 'classic loose hair style'} with a ${f.hairParting || 'natural parting'} and ${f.bangs || 'no bangs'}, showing a ${f.expression || 'neutral calm face'}. The person is ${f.glasses || 'no glasses'}, ${f.necklace || 'no necklace'}, and ${f.earrings || 'no earrings'}. Wearing a plain unpatterned solid ${f.clothingColor || 'white'} ${f.clothingType || 't-shirt'}, absolutely no logos, no graphics, no text on shirt. Naive art, chibi kawaii aesthetic. Extreme chibi proportions, huge oversized head, tiny small body, narrow sloping shoulders. Extremely simplified facial features, simple vertical black dot eyes, tiny line nose, soft blurred pink blush on cheeks. Smooth clean bare neck, absolutely no neck lines. Clean solid color hair, no white dots, no shading. Drawn with a monoline marker brush. Flat soft colors. Solid pure white background.`;

        if (tasks[taskId]) {
            tasks[taskId].suggestedPrompt = customPrompt;
            console.log(`🎯 號碼牌 #${taskId} 的頂級高保真咒語已成功儲存！`);
        }

    } catch (err) {
        console.error(`[Vision AI] 號碼 #${taskId} 解析失敗，保留備用咒語:`, err.message);
    }
}

// 啟動伺服器
app.listen(PORT, () => {
    console.log(`🚀 頂級高保真咒語生成叫號伺服器啟動成功！正在監聽 PORT: ${PORT}`);
});
